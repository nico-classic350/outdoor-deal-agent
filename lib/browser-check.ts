import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { browserFallbackConfig } from './browser-config.mjs';
import { reserveBrowserSession } from './browser-budget';

// A single, bounded Browserless credential check. It proves or disproves that
// the token deployed in this environment is accepted by the provider, without
// crawling a shop, writing batches or sending mail.
//
// Cost guard: at most one provider request per token and UTC day, at most
// MAX_CHECKS_PER_DAY requests per day overall, and every request also takes a
// slot from the shared daily Browserless session budget. Later callers get the
// stored result. The token itself is never stored or returned; the table keys
// on a short SHA-256 fingerprint so a replaced token can be checked once.
export const MAX_CHECKS_PER_DAY = 3;
const CHECK_URL = 'https://example.com/';

export type BrowserCheckOutcome =
  | 'accepted' | 'auth-rejected' | 'rate-limited' | 'provider-error' | 'network-error'
  | 'session-budget-exhausted' | 'pending';

export type BrowserCheckResult = {
  runDate: string;
  outcome: BrowserCheckOutcome;
  httpStatus: number | null;
  renderedBytes: number | null;
  checkedAt: string | null;
  cached: boolean;
};

export function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}

export function classifyProviderStatus(status: number): BrowserCheckOutcome {
  if (status >= 200 && status < 300) return 'accepted';
  if (status === 401 || status === 403) return 'auth-rejected';
  if (status === 429) return 'rate-limited';
  return 'provider-error';
}

let schemaPromise: Promise<void> | null = null;
function ensureSchema(sql: ReturnType<typeof neon>) {
  if (!schemaPromise) {
    schemaPromise = sql`CREATE TABLE IF NOT EXISTS agent_browser_provider_checks(
      run_date text NOT NULL,
      token_fp text NOT NULL,
      outcome text NOT NULL,
      http_status integer,
      rendered_bytes integer,
      checked_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (run_date, token_fp)
    )`.then(() => {}).catch(error => { schemaPromise = null; throw error; });
  }
  return schemaPromise;
}

function rowResult(row: any, cached: boolean): BrowserCheckResult {
  return {
    runDate: row.run_date,
    outcome: row.outcome,
    httpStatus: row.http_status ?? null,
    renderedBytes: row.rendered_bytes ?? null,
    checkedAt: row.checked_at ? new Date(row.checked_at).toISOString() : null,
    cached,
  };
}

/** Latest stored check for the currently deployed token today, without calling the provider. */
export async function latestBrowserCheck(): Promise<BrowserCheckResult | null> {
  const cfg = browserFallbackConfig();
  const token = cfg.unblockUrl ? new URL(cfg.unblockUrl).searchParams.get('token') : null;
  if (!token || !process.env.DATABASE_URL) return null;
  const sql = neon(process.env.DATABASE_URL);
  try {
    // Health must stay read-only: do not create the table here.
    const present = await sql`SELECT to_regclass('public.agent_browser_provider_checks') AS t` as any[];
    if (!present[0]?.t) return null;
    const runDate = new Date().toISOString().slice(0, 10);
    const rows = await sql`SELECT * FROM agent_browser_provider_checks
      WHERE run_date=${runDate} AND token_fp=${tokenFingerprint(token)}` as any[];
    return rows[0] ? rowResult(rows[0], true) : null;
  } catch {
    return null;
  }
}

export async function runBrowserCheck(): Promise<BrowserCheckResult | { error: string }> {
  const cfg = browserFallbackConfig();
  if (cfg.mode !== 'browserless-cloud' || !cfg.contentUrl) return { error: 'browserless-not-configured' };
  // Without the database the per-day cap cannot be enforced; refuse rather than spend units.
  if (!process.env.DATABASE_URL) return { error: 'database-required-for-cost-cap' };
  const token = new URL(cfg.contentUrl).searchParams.get('token') || '';
  const fp = tokenFingerprint(token);
  const runDate = new Date().toISOString().slice(0, 10);
  const sql = neon(process.env.DATABASE_URL);
  await ensureSchema(sql);

  const existing = await sql`SELECT * FROM agent_browser_provider_checks
    WHERE run_date=${runDate} AND token_fp=${fp}` as any[];
  if (existing[0]) return rowResult(existing[0], true);

  // Claim atomically: only one concurrent caller per token/day, capped per day.
  const claimed = await sql`INSERT INTO agent_browser_provider_checks(run_date, token_fp, outcome)
    SELECT ${runDate}, ${fp}, 'pending'
    WHERE (SELECT count(*) FROM agent_browser_provider_checks WHERE run_date=${runDate}) < ${MAX_CHECKS_PER_DAY}
    ON CONFLICT (run_date, token_fp) DO NOTHING
    RETURNING run_date` as any[];
  if (!claimed.length) {
    const again = await sql`SELECT * FROM agent_browser_provider_checks
      WHERE run_date=${runDate} AND token_fp=${fp}` as any[];
    return again[0] ? rowResult(again[0], true) : { error: 'daily-check-limit-reached' };
  }

  let outcome: BrowserCheckOutcome;
  let httpStatus: number | null = null;
  let renderedBytes: number | null = null;
  if (!(await reserveBrowserSession())) {
    outcome = 'session-budget-exhausted';
  } else {
    try {
      const response = await fetch(cfg.contentUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/html' },
        body: JSON.stringify({ url: CHECK_URL, gotoOptions: { waitUntil: 'domcontentloaded', timeout: 10000 } }),
        signal: AbortSignal.timeout(20000),
      });
      httpStatus = response.status;
      outcome = classifyProviderStatus(response.status);
      const body = await response.text();
      if (outcome === 'accepted') {
        renderedBytes = body.length;
        // A 2xx without a rendered document is not proof of a working browser.
        if (!/example domain/i.test(body)) outcome = 'provider-error';
      }
    } catch {
      // Never surface error messages: fetch errors can echo the token-bearing URL.
      outcome = 'network-error';
    }
  }

  const rows = await sql`UPDATE agent_browser_provider_checks
    SET outcome=${outcome}, http_status=${httpStatus}, rendered_bytes=${renderedBytes}, checked_at=now()
    WHERE run_date=${runDate} AND token_fp=${fp}
    RETURNING *` as any[];
  return rowResult(rows[0], false);
}
