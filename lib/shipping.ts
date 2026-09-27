import * as cheerio from 'cheerio';
import type { RawOffer } from './types';

const BERGFREUNDE_SHIPPING = 'https://www.bergfreunde.de/lieferung-und-zahlung/';

export function bergfreundeGermanShipping(html: string): { fee: number; freeFrom: number; freeReturns: boolean } | null {
  const $ = cheerio.load(html);
  const pageText = $('body').text().replace(/\s+/g, ' ');
  const row = $('tr').map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
    .get().find(text => /\bDeutschland\b/i.test(text) && /Versandkostenfrei\s+ab/i.test(text))
    || pageText.match(/Deutschland(?:\s*,\s*Frankreich)?\s+\d{1,2}[,.]\d{2}\s*€\s+Versandkostenfrei\s+ab\s+\d{2,3}\s*€/i)?.[0];
  if (!row) return null;
  const fee = row.match(/\bDeutschland(?:\s*,\s*Frankreich)?\s*(\d{1,2}[,.]\d{2})\s*€/i);
  const threshold = row.match(/Versandkostenfrei\s+ab\s*(\d{2,3})\s*€/i);
  if (!fee || !threshold) return null;
  const amount = Number(fee[1].replace(',', '.'));
  const freeFrom = Number(threshold[1]);
  if (!Number.isFinite(amount) || amount < 0 || amount > 20 || freeFrom < 30 || freeFrom > 300) return null;
  return { fee: amount, freeFrom, freeReturns: /Deutschland\s+kostenfrei\s+zurücksenden/i.test($.text()) };
}

export async function fillVerifiedShipping(offers: RawOffer[], fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!offers.some(o => o.sourceId === 'bergfreunde' && o.currency === 'EUR' && o.shipping == null)) return false;
  try {
    const response = await fetcher(BERGFREUNDE_SHIPPING, { signal: AbortSignal.timeout(3500) });
    if (!response.ok || new URL(response.url).hostname !== 'www.bergfreunde.de') return false;
    const policy = bergfreundeGermanShipping(await response.text());
    if (!policy) return false;
    for (const offer of offers) {
      if (offer.sourceId !== 'bergfreunde' || offer.currency !== 'EUR' || !Number.isFinite(offer.price)) continue;
      if (offer.shipping == null) offer.shipping = offer.price! >= policy.freeFrom ? 0 : policy.fee;
      if (offer.returnCost == null && policy.freeReturns) offer.returnCost = 0;
    }
    return true;
  } catch { return false; }
}
