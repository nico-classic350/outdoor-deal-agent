import { neon } from '@neondatabase/serverless';
import { RawOffer, SourceCoverage } from './types';

// Browser observations collected by the GitHub Actions Playwright crawler.
// Vercel batches merge a fresh snapshot into the shop's direct crawl; if the
// Actions run is late or failed, the batch simply runs without it.
export const SNAPSHOT_MAX_AGE_HOURS = 30;

export type BrowserSnapshot = {
  shopId: string;
  collectedAt: string;
  offers: RawOffer[];
  coverage: Pick<SourceCoverage, 'status' | 'parsedOffers' | 'httpStatuses' | 'technicalPath' | 'elapsedMs'>;
};

type Sql = ReturnType<typeof neon>;

export async function ensureSnapshotTable(sql: Sql) {
  await sql`CREATE TABLE IF NOT EXISTS agent_browser_snapshots(
    shop_id text NOT NULL,
    collected_date text NOT NULL,
    collected_at timestamptz NOT NULL,
    offers jsonb NOT NULL,
    coverage jsonb NOT NULL,
    PRIMARY KEY (shop_id, collected_date)
  )`;
}

export async function saveSnapshot(sql: Sql, snapshot: BrowserSnapshot) {
  const date = snapshot.collectedAt.slice(0, 10);
  await sql`INSERT INTO agent_browser_snapshots(shop_id, collected_date, collected_at, offers, coverage)
    VALUES (${snapshot.shopId}, ${date}, ${snapshot.collectedAt},
      ${JSON.stringify(snapshot.offers)}::jsonb, ${JSON.stringify(snapshot.coverage)}::jsonb)
    ON CONFLICT (shop_id, collected_date) DO UPDATE SET
      collected_at=EXCLUDED.collected_at, offers=EXCLUDED.offers, coverage=EXCLUDED.coverage`;
}

/** Latest snapshot per shop younger than SNAPSHOT_MAX_AGE_HOURS. Read-only; missing table → empty. */
export async function loadFreshSnapshots(sql: Sql, shopIds: string[], now = new Date()): Promise<Map<string, BrowserSnapshot>> {
  const result = new Map<string, BrowserSnapshot>();
  if (!shopIds.length) return result;
  const present = await sql`SELECT to_regclass('public.agent_browser_snapshots') AS t` as any[];
  if (!present[0]?.t) return result;
  const since = new Date(now.getTime() - SNAPSHOT_MAX_AGE_HOURS * 3600_000).toISOString();
  const rows = await sql`SELECT DISTINCT ON (shop_id) shop_id, collected_at, offers, coverage
    FROM agent_browser_snapshots
    WHERE shop_id = ANY(${shopIds}) AND collected_at >= ${since}
    ORDER BY shop_id, collected_at DESC` as any[];
  for (const row of rows) {
    result.set(row.shop_id, {
      shopId: row.shop_id,
      collectedAt: new Date(row.collected_at).toISOString(),
      offers: Array.isArray(row.offers) ? row.offers : [],
      coverage: row.coverage || {},
    });
  }
  return result;
}

/**
 * Merge snapshot offers into a direct crawl result. Direct observations win on
 * the same URL (they are fresher) but take over the snapshot's product-page
 * checks (sizes, reference price, stock) at the same price; snapshot offers must belong to the shop.
 */
export function mergeSnapshot(
  crawl: { offers: RawOffer[]; coverage: SourceCoverage },
  snapshot: BrowserSnapshot | undefined,
): { offers: RawOffer[]; coverage: SourceCoverage; added: number } {
  if (!snapshot) return { ...crawl, added: 0 };
  const path = crawl.coverage.technicalPath || (crawl.coverage.technicalPath = []);
  const known = new Set(crawl.offers.map(offer => offer.url));
  // The nightly run checks every premium trouser's product page; carry its
  // sizes, reference price and sold-out state over to the same offer (same
  // URL and price) when the Vercel crawl could not check that page itself.
  const byUrl = new Map(snapshot.offers.filter(o => o && o.url && o.sourceId === crawl.coverage.sourceId).map(o => [o.url, o]));
  let enriched = 0;
  for (const offer of crawl.offers) {
    const s = byUrl.get(offer.url);
    if (!s || Math.abs(Number(s.price) - Number(offer.price)) > Math.max(0.02 * Number(offer.price), 0.5)) continue;
    let changed = false;
    if (s.sizeAvailability === 'available' && (s.sizes || []).length && offer.sizeAvailability !== 'available') {
      offer.sizes = [...s.sizes]; offer.sizeAvailability = 'available'; changed = true;
    }
    if (s.rrp && s.rrpSource && !offer.rrpSource && s.rrp > Number(offer.price)) { offer.rrp = s.rrp; offer.rrpSource = s.rrpSource; changed = true; }
    if (/out.of.stock/i.test(s.availability || '') && !/out.of.stock/i.test(offer.availability || '')) { offer.availability = s.availability; changed = true; }
    if (changed) enriched++;
  }
  const additions = snapshot.offers.filter(offer =>
    offer && offer.sourceId === crawl.coverage.sourceId && offer.url && !known.has(offer.url) && (known.add(offer.url), true));
  path.push('actions-browser-snapshot', `actions-browser-snapshot-age-${Math.max(0, Math.round((Date.now() - Date.parse(snapshot.collectedAt)) / 3600_000))}h`);
  if (enriched) path.push(`actions-snapshot-enriched-${enriched}`);
  if (!additions.length) {
    path.push('actions-browser-snapshot-no-new-offers');
    return { ...crawl, added: 0 };
  }
  path.push('actions-browser-success', `actions-browser-offers-${additions.length}`);
  const offers = [...crawl.offers, ...additions];
  const coverage: SourceCoverage = {
    ...crawl.coverage,
    parsedOffers: offers.length,
    status: crawl.coverage.status === 'failed' || crawl.coverage.status === 'blocked' ? 'browser' : crawl.coverage.status,
    note: `${crawl.coverage.note ? `${crawl.coverage.note}; ` : ''}${additions.length} offers from GitHub Actions Chromium snapshot`,
  };
  return { offers, coverage, added: additions.length };
}
