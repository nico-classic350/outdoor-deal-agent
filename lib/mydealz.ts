import { RawOffer, ShopSource } from './types';
import { labelledReferencePrice } from './extract';

// mydealz publishes RSS feeds for groups and for a user's keyword alerts. They
// are meant for feed readers, so reading them is allowed, and they reach deals
// from shops whose own pages block automated visits. Each item names the
// merchant and the deal price; a reference price counts only when the post
// labels it (UVP, statt, PVG/VGP = next best price elsewhere).
export const MYDEALZ_PUBLIC_FEEDS = ['https://www.mydealz.de/rss/gruppe/outdoor'];
const MAX_AGE_DAYS = 10;
const LETTERS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];

export type MydealzItem = { title: string; link: string; merchant?: string; price?: number; description: string;
  category?: string; imageUrl?: string; published?: Date };

function cdata(value: string | undefined) {
  return String(value ?? '').replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
}

function decode(value: string) {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
}

function stripHtml(value: string) {
  return decode(value.replace(/<br\s*\/?>/gi, ' ').replace(/<\/(?:p|li)>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function euro(value: string | undefined): number | undefined {
  const m = String(value ?? '').match(/(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?/);
  if (!m) return undefined;
  const n = Number(`${m[1].replace(/\./g, '')}.${m[2] ?? '0'}`);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function parseMydealzFeed(xml: string): MydealzItem[] {
  const items = String(xml || '').match(/<item[\s>][\s\S]*?<\/item>/g) || [];
  return items.map(item => {
    const tag = (name: string) => (item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1];
    const merchant = item.match(/<pepper:merchant\b([^>]*)\/?>/)?.[1] || '';
    const attr = (name: string) => decode((merchant.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1] || '') || undefined;
    const published = tag('pubDate') ? new Date(tag('pubDate')!) : undefined;
    return {
      // Hot feeds prefix the community temperature ("102° - ").
      title: decode(cdata(tag('title'))).replace(/^-?\d+°\s*-\s*/, '').trim(),
      link: decode(cdata(tag('link'))),
      merchant: attr('name'),
      price: euro(attr('price')),
      description: stripHtml(cdata(tag('description'))),
      category: cdata(tag('category')) || undefined,
      imageUrl: decode((item.match(/<media:content[^>]*url="([^"]+)"/) || [])[1] || '') || undefined,
      published: published && !Number.isNaN(published.getTime()) ? published : undefined,
    };
  }).filter(item => item.title && /^https:\/\/www\.mydealz\.de\//.test(item.link));
}

// Reference prices as mydealz posts write them: "PVG: 79,99 €", "VGP 120 €",
// "Vergleichspreis 99 €", plus the generic UVP/statt labels.
export function mydealzReferencePrice(text: string): { value: number; source: string } | undefined {
  const pvg = String(text || '').match(/\b(?:PVG|VGP|Vergleichspreis|nächstbester Preis)\b\s*:?\s*(?:ab\s*)?(\d{1,4}(?:[.,]\d{2})?)\s*(?:€|EUR)/i);
  if (pvg) return { value: euro(pvg[1])!, source: 'mydealz:price-comparison' };
  const labelled = labelledReferencePrice(text);
  return labelled ? { value: labelled, source: 'mydealz:labelled-reference-price' } : undefined;
}

// "Gr. S-4XL", "XS bis XL", "Größen 46 - 56" → the sizes the post says are offered.
export function mydealzSizes(text: string): string[] {
  const out = new Set<string>();
  const letter = LETTERS.join('|').replace('XXL', 'XXL|2XL');
  for (const m of String(text || '').matchAll(new RegExp(`\\b(${letter})\\s*(?:-|–|bis)\\s*(${letter})\\b`, 'gi'))) {
    const from = LETTERS.indexOf(m[1].toUpperCase().replace('2XL', 'XXL'));
    const to = LETTERS.indexOf(m[2].toUpperCase().replace('2XL', 'XXL'));
    if (from >= 0 && to >= from) LETTERS.slice(from, to + 1).forEach(size => out.add(size));
  }
  for (const m of String(text || '').matchAll(/\b(4[0-9]|5[0-9]|6[0-4])\s*(?:-|–|bis)\s*(4[0-9]|5[0-9]|6[0-4])\b/g)) {
    for (let size = Number(m[1]); size <= Number(m[2]); size += 2) out.add(String(size));
  }
  return [...out];
}

export function mydealzItemToOffer(item: MydealzItem, source: ShopSource, now = Date.now()): RawOffer | null {
  if (item.published && now - item.published.getTime() > MAX_AGE_DAYS * 86400000) return null;
  const text = `${item.title} ${item.description}`;
  if (/\b(?:abgelaufen|expired)\b/i.test(item.title)) return null;
  const price = item.price ?? euro(item.description.match(/^(\d{1,4}(?:[.,]\d{2})?)\s*€/)?.[1]);
  if (!price) return null;
  const reference = mydealzReferencePrice(item.description);
  const rrp = reference && reference.value > price ? reference.value : undefined;
  const sizes = mydealzSizes(text);
  return {
    sourceId: source.id,
    merchant: item.merchant ? `${item.merchant} (via mydealz)` : source.name,
    merchantCountry: source.country,
    url: item.link,
    imageUrl: item.imageUrl,
    name: item.title,
    currency: 'EUR',
    price,
    rrp,
    rrpSource: rrp ? reference!.source : undefined,
    sizes,
    sizeAvailability: sizes.length ? 'available' : 'unknown',
    availability: 'in_stock',
    description: item.description.slice(0, 500),
  };
}

export function mydealzFeedUrls(env: Record<string, string | undefined> = process.env): string[] {
  const personal = String(env.MYDEALZ_ALERT_FEED_URL || '').trim();
  return [...(/^https:\/\/www\.mydealz\.de\//.test(personal) ? [personal] : []), ...MYDEALZ_PUBLIC_FEEDS];
}

export async function ingestMydealz(source: ShopSource, deadline: number, fetcher: typeof fetch = fetch,
  urls: string[] = mydealzFeedUrls()): Promise<{ offers: RawOffer[]; statuses: number[]; feeds: number }> {
  const offers = new Map<string, RawOffer>();
  const statuses: number[] = [];
  let feeds = 0;
  for (const url of urls) {
    if (Date.now() > deadline - 2000) break;
    try {
      const response = await fetcher(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; OutdoorDealAgent/1.0; +https://outdoor-deal-agent.vercel.app/)', accept: 'application/rss+xml, application/xml' },
        signal: AbortSignal.timeout(Math.max(1000, Math.min(10000, deadline - Date.now()))),
      });
      statuses.push(response.status);
      if (!response.ok) continue;
      feeds++;
      for (const item of parseMydealzFeed(await response.text())) {
        const offer = mydealzItemToOffer(item, source);
        if (offer && !offers.has(offer.url)) offers.set(offer.url, offer);
      }
    } catch { statuses.push(0); }
  }
  return { offers: [...offers.values()], statuses, feeds };
}
