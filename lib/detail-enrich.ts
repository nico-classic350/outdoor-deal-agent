import { RawOffer, ShopSource } from './types';
import { extractJsonLd, extractHtmlFallback } from './extract';
import { productEligible } from './product-rules.mjs';
import { PROFILE } from '../config/profile';

// Listing pages rarely show sizes and often omit the crossed-out price. Every
// premium trouser's product page is read once (bounded by time, not count): its
// JSON-LD lists each variant with size, stock and (often) the reference price.
// Only variants at the listing price count, so a size that is buyable at a
// different price never confirms the deal.
// No count limit by default; 0 switches the step off. The time budget
// (DETAIL_BUDGET_MS in crawl.ts) decides how many pages fit into one run.
const limitEnv = Number(process.env.DETAIL_ENRICH_LIMIT ?? Infinity);
export const DETAIL_ENRICH_LIMIT = Number.isFinite(limitEnv) ? Math.max(0, limitEnv) : Infinity;
const DETAIL_CONCURRENCY = Math.max(1, Math.min(10, Number(process.env.DETAIL_CONCURRENCY || 6)));

export type DetailFetch = (url: string) => Promise<string | null>;

const fold = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o');
const BRANDS = PROFILE.brands.map(fold);
const hasEvidence = (o: RawOffer) => Boolean((o.rrp && o.rrpSource) || (o.discountSource && Number(o.observedDiscountPct) >= 40));
const isPremium = (o: RawOffer) => BRANDS.some(b => fold(`${o.brand || ''} ${o.name || ''}`).includes(b));
const samePrice = (a?: number, b?: number) => a != null && b != null && Math.abs(Number(a) - Number(b)) <= Math.max(0.02 * Number(b), 0.5);
const words = (value?: string) => new Set(fold(value || '').split(/[^a-z0-9]+/).filter(w => w.length > 2));
function similarName(a?: string, b?: string) {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return false;
  let shared = 0; for (const w of x) if (y.has(w)) shared++;
  return shared / Math.min(x.size, y.size) >= 0.6;
}

export function detailCandidates(offers: RawOffer[], limit = DETAIL_ENRICH_LIMIT): RawOffer[] {
  const seen = new Set<string>();
  const eligible = offers.filter(o => o.url && o.name && productEligible(o.name, o.description) && isPremium(o)
    && !/out.of.stock|sold.out|ausverkauft/i.test(o.availability || ''));
  // Deals first (evidence but no sizes), then trousers lacking any price
  // evidence, then the rest (stock check), so a tight budget serves deals.
  const ranked = [
    ...eligible.filter(o => hasEvidence(o) && !(o.sizes || []).length),
    ...eligible.filter(o => !hasEvidence(o)),
    ...eligible.filter(o => hasEvidence(o) && (o.sizes || []).length),
  ];
  const out: RawOffer[] = [];
  for (const o of ranked) {
    const key = o.url.split('?')[0].split('#')[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); out.push(o);
    if (out.length >= limit) break;
  }
  return out;
}

export function mergeDetail(offer: RawOffer, html: string, source: ShopSource): { sizes: boolean; evidence: boolean; soldOut: boolean } {
  const result = { sizes: false, evidence: false, soldOut: false };
  const variants = extractJsonLd(html, source, offer.url).filter(v => similarName(v.name, offer.name) || !v.name);
  const atPrice = variants.filter(v => samePrice(v.price, offer.price));
  if (variants.length && variants.every(v => /OutOfStock|SoldOut|Discontinued/i.test(v.availability || ''))) {
    offer.availability = 'out_of_stock'; result.soldOut = true; return result;
  }
  const sizes = [...new Set(atPrice.filter(v => v.sizeAvailability === 'available').flatMap(v => v.sizes || []).filter(Boolean))];
  if (sizes.length && !(offer.sizes || []).length) {
    offer.sizes = sizes; offer.sizeAvailability = 'available'; result.sizes = true;
  }
  if (!hasEvidence(offer)) {
    const withReference = atPrice.find(v => v.rrp && v.rrpSource && v.rrp > Number(offer.price));
    // HTML fallback only for the product itself: same name and same price.
    const fallback = withReference ? undefined : extractHtmlFallback(html, source, offer.url)
      .find(v => v.rrp && v.rrpSource && similarName(v.name, offer.name) && samePrice(v.price, offer.price));
    const reference = withReference || fallback;
    if (reference) {
      offer.rrp = reference.rrp; offer.rrpSource = `detail:${reference.rrpSource}`; result.evidence = true;
    }
  }
  return result;
}

export async function enrichFromDetailPages(source: ShopSource, offers: RawOffer[], fetchHtml: DetailFetch,
  deadline: number, limit = DETAIL_ENRICH_LIMIT): Promise<{ fetched: number; sizes: number; evidence: number; soldOut: number }> {
  const stats = { fetched: 0, sizes: 0, evidence: 0, soldOut: 0 };
  const queue = detailCandidates(offers, limit);
  const worker = async () => {
    for (let o = queue.shift(); o; o = queue.shift()) {
      if (Date.now() > deadline - 1500) return;
      let html: string | null = null;
      try { html = await fetchHtml(o.url); } catch { html = null; }
      if (!html) continue;
      stats.fetched++;
      const r = mergeDetail(o, html, source);
      stats.sizes += Number(r.sizes); stats.evidence += Number(r.evidence); stats.soldOut += Number(r.soldOut);
    }
  };
  await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker));
  return stats;
}
