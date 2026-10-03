import { RawOffer, ShopSource } from './types';

// Shopify stores publish their catalogue as JSON (`/collections/<handle>/products.json`).
// It carries the sale price, the merchant's compare-at price and per-variant
// availability, so price evidence and available sizes come from the shop's own
// data instead of page parsing. No browser and no tokens are needed.
export type ShopifySource = {
  origin: string;            // e.g. https://eu.goldwin.global
  collections: string[];     // collection handles with men's trousers or sale items
  currency: 'EUR';           // verified via the diagnose run; other currencies are not configured
  brand?: string;            // for single-brand stores whose vendor field is empty
  sizeMap?: Record<string, string>; // brand-specific size systems mapped to letters ("3" -> "L")
};

type ShopifyVariant = { title?: string; price?: string; compare_at_price?: string | null; available?: boolean;
  option1?: string | null; option2?: string | null; option3?: string | null };
type ShopifyProduct = { title?: string; handle?: string; vendor?: string; product_type?: string; body_html?: string;
  options?: { name?: string; position?: number }[]; variants?: ShopifyVariant[]; images?: { src?: string }[] };

const SIZE_OPTION = /^(size|sizes|größe|groesse|grösse|taille|taglia|taglia_id|taglie|talla|maat|storlek|størrelse|koko|rozmiar|velikost|waist|bundweite|länge|inseam)$/i;
const MAX_PAGES = 4;

function money(value: unknown): number | undefined {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function shopifyProductToOffer(product: ShopifyProduct, cfg: ShopifySource, source: ShopSource): RawOffer | null {
  const variants = (product.variants || []).filter(v => v.available !== false);
  if (!product.title || !product.handle || !variants.length) return null;
  // The cheapest selectable variant is the offer; its own compare-at price is the reference.
  const priced = variants.map(v => ({ v, price: money(v.price), rrp: money(v.compare_at_price) }))
    .filter(x => x.price) as { v: ShopifyVariant; price: number; rrp?: number }[];
  if (!priced.length) return null;
  priced.sort((a, b) => a.price - b.price);
  const best = priced[0];
  const rrp = best.rrp && best.rrp > best.price ? best.rrp : undefined;
  const sizeIndexes = (product.options || []).map((o, i) => SIZE_OPTION.test(String(o.name || '').trim()) ? i : -1).filter(i => i >= 0);
  const sizes = sizeIndexes.length
    ? [...new Set(variants.flatMap(v => sizeIndexes.map(i => [v.option1, v.option2, v.option3][i]).filter(Boolean) as string[]))]
    : [];
  // "L (3)": the letter decides the fit, the shop's own label stays visible.
  const labelled = cfg.sizeMap ? sizes.map(size => cfg.sizeMap![size.trim()] ? `${cfg.sizeMap![size.trim()]} (${size.trim()})` : size) : sizes;
  return {
    sourceId: source.id,
    merchant: source.name,
    merchantCountry: source.country,
    url: `${cfg.origin}/products/${product.handle}`,
    imageUrl: product.images?.[0]?.src,
    brand: product.vendor || cfg.brand,
    name: product.title,
    currency: cfg.currency,
    price: best.price,
    rrp,
    rrpSource: rrp ? 'shopify:compare_at_price' : undefined,
    sizes: labelled,
    sizeAvailability: sizes.length ? 'available' : undefined,
    availability: 'in_stock',
    description: stripHtml(`${product.product_type || ''} ${product.body_html || ''}`).slice(0, 500),
  };
}

export async function ingestShopify(source: ShopSource, cfg: ShopifySource, deadline: number,
  fetcher: typeof fetch = fetch): Promise<{ offers: RawOffer[]; pages: number; statuses: number[] }> {
  const offers = new Map<string, RawOffer>();
  const statuses: number[] = [];
  let pages = 0;
  for (const handle of cfg.collections) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (Date.now() > deadline - 2000) return { offers: [...offers.values()], pages, statuses };
      const url = `${cfg.origin}/collections/${encodeURIComponent(handle)}/products.json?limit=250&page=${page}`;
      const response = await fetcher(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; OutdoorDealAgent/1.0; +https://outdoor-deal-agent.vercel.app/)', accept: 'application/json' },
        signal: AbortSignal.timeout(Math.max(1000, Math.min(10000, deadline - Date.now()))),
      });
      statuses.push(response.status);
      if (!response.ok) break;
      const json = await response.json() as { products?: ShopifyProduct[] };
      const products = Array.isArray(json?.products) ? json.products : [];
      pages++;
      for (const product of products) {
        const offer = shopifyProductToOffer(product, cfg, source);
        if (offer && !offers.has(offer.url)) offers.set(offer.url, offer);
      }
      if (products.length < 250) break;
    }
  }
  return { offers: [...offers.values()], pages, statuses };
}
