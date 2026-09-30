import { neon } from '@neondatabase/serverless';

// A provider session is an admission-control unit, not Browserless's billed
// usage unit (which can also depend on duration and plan). The database makes
// the cap effective across independent cron functions and delayed retries.
let schemaPromise: Promise<void> | null = null;

// Browserless is opt-in since the GitHub Actions Chromium crawler replaced it:
// without an explicit positive limit no paid provider session is admitted.
export function dailyBrowserSessionLimit(env = process.env): number {
  const value = Number(env.BROWSERLESS_DAILY_SESSION_LIMIT ?? 0);
  return Number.isFinite(value) ? Math.max(0, Math.min(120, Math.floor(value))) : 0;
}

export async function reserveBrowserSession(): Promise<boolean> {
  // Tests and isolated local pilots have no production database. Production
  // batches require DATABASE_URL to persist their results anyway.
  if (!process.env.DATABASE_URL) return true;
  const cap = dailyBrowserSessionLimit();
  if (cap === 0) return false;
  const sql = neon(process.env.DATABASE_URL);
  if (!schemaPromise) {
    schemaPromise = sql`CREATE TABLE IF NOT EXISTS agent_browser_session_budget(
      run_date text PRIMARY KEY,
      session_count integer NOT NULL
    )`.then(() => {}).catch(error => { schemaPromise = null; throw error; });
  }
  try {
    await schemaPromise;
    const day = new Date().toISOString().slice(0, 10);
    const rows = await sql`INSERT INTO agent_browser_session_budget(run_date,session_count)
      VALUES (${day},1)
      ON CONFLICT (run_date) DO UPDATE SET session_count=agent_browser_session_budget.session_count+1
      WHERE agent_browser_session_budget.session_count < ${cap}
      RETURNING session_count`;
    return rows.length > 0;
  } catch {
    // The browser is optional; failing closed preserves the core direct crawl.
    return false;
  }
}
