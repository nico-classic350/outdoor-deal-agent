import { createHmac, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { modelKey } from './product-rules.mjs';
import type { NormalizedOffer } from './types';

// "Nicht relevant – ausblenden": the recipient hides a trouser model they have
// already looked at. The key is the model (brand + model name, size and colour
// stripped), so the same trousers stay hidden at every shop and on later days;
// models with a generic name fall back to the product URL.
// Links in the mail are signed (HMAC derived from CRON_SECRET), so nobody can
// hide or unhide arbitrary keys, and they only open a confirmation page: mail
// security scanners prefetch GET links, the actual change needs a POST.

type Sql = ReturnType<typeof neon>;
export const PUBLIC_BASE_URL = 'https://outdoor-deal-agent.vercel.app';

// Generic words differ between shops ("Pants" vs "Hose", "Softshellhose",
// "Herren", "Ms"); without them the same model gets the same key everywhere.
const GENERIC = /^(?:pants?|trousers?|hosen?|\p{L}*hosen?|herren|men|mens|ms|m|man|uomo|homme|hombre|pantalon[eis]?|pantalones|byxor|bukser|broek)$/iu;

export function hideKey(offer: Pick<NormalizedOffer, 'brand' | 'name' | 'color' | 'url' | 'sourceId'>): string {
  const key = modelKey(offer);
  if (!key.startsWith('model|')) return key;
  const [, brand, title] = key.split('|');
  const words = title.split(' ').filter(w => w && !GENERIC.test(w));
  return words.length ? `model|${brand}|${words.join(' ')}` : key;
}

function secret(): string | null {
  const base = process.env.CRON_SECRET;
  return base ? createHmac('sha256', base).update('outdoor-deal-agent/hide-link/v1').digest('hex') : null;
}

export function signHideKey(key: string, signingSecret = secret()): string | null {
  return signingSecret ? createHmac('sha256', signingSecret).update(key).digest('base64url').slice(0, 32) : null;
}

export function verifyHideKey(key: string, signature: string, signingSecret = secret()): boolean {
  const expected = signHideKey(key, signingSecret);
  if (!expected || typeof signature !== 'string' || signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64url');
export const fromB64 = (value: string) => Buffer.from(String(value || ''), 'base64url').toString('utf8');

/** Confirmation link for the mail; null when no signing secret is configured. */
export function hideLink(offer: Pick<NormalizedOffer, 'brand' | 'name' | 'color' | 'url' | 'sourceId'>, signingSecret = secret()): string | null {
  const key = hideKey(offer);
  const signature = signHideKey(key, signingSecret);
  if (!signature) return null;
  const label = `${offer.brand} ${String(offer.name || '').split('|')[0].trim()}`.slice(0, 120);
  return `${PUBLIC_BASE_URL}/api/hide?k=${b64(key)}&l=${b64(label)}&s=${signature}`;
}

export async function ensureHiddenTable(sql: Sql) {
  await sql`CREATE TABLE IF NOT EXISTS agent_hidden_offers (
    hide_key text PRIMARY KEY, label text NOT NULL, hidden_at timestamptz NOT NULL DEFAULT now())`;
}

export async function loadHiddenKeys(sql: Sql | null = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null): Promise<Set<string>> {
  if (!sql) return new Set();
  try {
    const present = await sql`SELECT to_regclass('public.agent_hidden_offers') AS t` as any[];
    if (!present[0]?.t) return new Set();
    const rows = await sql`SELECT hide_key FROM agent_hidden_offers` as any[];
    return new Set(rows.map(r => String(r.hide_key)));
  } catch { return new Set(); }
}

export async function listHidden(sql: Sql): Promise<{ key: string; label: string; hiddenAt: string }[]> {
  await ensureHiddenTable(sql);
  const rows = await sql`SELECT hide_key, label, hidden_at FROM agent_hidden_offers ORDER BY hidden_at DESC LIMIT 200` as any[];
  return rows.map(r => ({ key: String(r.hide_key), label: String(r.label), hiddenAt: new Date(r.hidden_at).toISOString() }));
}

export async function setHidden(sql: Sql, key: string, label: string, hidden: boolean) {
  await ensureHiddenTable(sql);
  if (hidden) await sql`INSERT INTO agent_hidden_offers(hide_key, label) VALUES (${key}, ${label.slice(0, 200)})
    ON CONFLICT (hide_key) DO UPDATE SET label=EXCLUDED.label`;
  else await sql`DELETE FROM agent_hidden_offers WHERE hide_key=${key}`;
}

export function withoutHidden<T extends Pick<NormalizedOffer, 'brand' | 'name' | 'color' | 'url' | 'sourceId'>>(offers: T[], hidden: Set<string>): T[] {
  return hidden.size ? offers.filter(o => !hidden.has(hideKey(o))) : offers;
}
