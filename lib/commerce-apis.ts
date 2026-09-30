import { RawOffer, ShopSource } from './types';

// Public storefront APIs of common shop systems. Like the Shopify adapter they
// return structured sale and regular prices (and, where exposed, sizes), so no
// browser, page parsing or model tokens are needed. Every configured source is
// verified with the diagnose run (euro prices, reachable without login).
export type WooCommerceSource = {
  type: 'woocommerce';
  origin: string;
  /** Store API query parameters, e.g. { on_sale: 'true', search: 'hose' } or { category: 'herren-hosen' }. */
  queries: Record<string, string>[];
  brand?: string;
};
export type MagentoSource = {
  type: 'magento';
  origin: string;
  /** Full-text searches run against the GraphQL products query (e.g. 'wanderhose', 'pantaloni trekking'). */
  searches: string[];
  urlSuffix?: string;
  brand?: string;
};
export type CommerceSource = WooCommerceSource | MagentoSource;

const UA = 'Mozilla/5.0 (compatible; OutdoorDealAgent/1.0; +https://outdoor-deal-agent.vercel.app/)';
const SIZE_NAME = /^(size|größe|groesse|grösse|taglia|talla|taille|storlek|koko|maat|velikost|rozmiar|bundweite)$/i;
const MAX_PAGES = 3;

function timeout(deadline: number, cap = 10000) {
  return AbortSignal.timeout(Math.max(1000, Math.min(cap, deadline - Date.now())));
}

function stripHtml(value: unknown) {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// --- WooCommerce Store API (/wp-json/wc/store/v1/products) -------------------

type WooProduct = {
  name?: string; permalink?: string; short_description?: string; is_in_stock?: boolean; on_sale?: boolean;
  prices?: { price?: string; regular_price?: string; currency_code?: string; currency_minor_unit?: number };
  images?: { src?: string }[];
  attributes?: { name?: string; terms?: { name?: string }[] }[];
  brands?: { name?: string }[];
};

export function wooProductToOffer(product: WooProduct, cfg: WooCommerceSource, source: ShopSource): RawOffer | null {
  const prices = product.prices;
  if (!product.name || !product.permalink || !prices || product.is_in_stock === false) return null;
  if (String(prices.currency_code || '').toUpperCase() !== 'EUR') return null;
  const unit = 10 ** Number(prices.currency_minor_unit ?? 2);
  const price = Number(prices.price) / unit;
  const regular = Number(prices.regular_price) / unit;
  if (!Number.isFinite(price) || price <= 0) return null;
  const rrp = Number.isFinite(regular) && regular > price ? regular : undefined;
  const sizes = (product.attributes || []).filter(a => SIZE_NAME.test(String(a.name || '').trim()))
    .flatMap(a => (a.terms || []).map(t => String(t.name || '').trim()).filter(Boolean));
  return {
    sourceId: source.id, merchant: source.name, merchantCountry: source.country,
    url: product.permalink, imageUrl: product.images?.[0]?.src,
    brand: product.brands?.[0]?.name || cfg.brand, name: stripHtml(product.name),
    currency: 'EUR', price, rrp, rrpSource: rrp ? 'woocommerce:regular_price' : undefined,
    // Store API lists attribute terms, not per-variant stock: sizes stay unconfirmed.
    sizes, availability: 'in_stock', description: stripHtml(product.short_description).slice(0, 500),
  };
}

export async function ingestWooCommerce(source: ShopSource, cfg: WooCommerceSource, deadline: number,
  fetcher: typeof fetch = fetch): Promise<{ offers: RawOffer[]; statuses: number[] }> {
  const offers = new Map<string, RawOffer>();
  const statuses: number[] = [];
  for (const query of cfg.queries) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (Date.now() > deadline - 2000) return { offers: [...offers.values()], statuses };
      const params = new URLSearchParams({ per_page: '100', page: String(page), ...query });
      const response = await fetcher(`${cfg.origin}/wp-json/wc/store/v1/products?${params}`,
        { headers: { 'user-agent': UA, accept: 'application/json' }, signal: timeout(deadline) });
      statuses.push(response.status);
      if (!response.ok) break;
      const products = await response.json() as WooProduct[];
      if (!Array.isArray(products)) break;
      for (const product of products) {
        const offer = wooProductToOffer(product, cfg, source);
        if (offer && !offers.has(offer.url)) offers.set(offer.url, offer);
      }
      if (products.length < 100) break;
    }
  }
  return { offers: [...offers.values()], statuses };
}

// --- Magento 2 GraphQL (/graphql) --------------------------------------------

type MagentoMoney = { value?: number; currency?: string };
type MagentoItem = {
  name?: string; url_key?: string; url_suffix?: string; stock_status?: string;
  small_image?: { url?: string };
  price_range?: { minimum_price?: { regular_price?: MagentoMoney; final_price?: MagentoMoney } };
  configurable_options?: { attribute_code?: string; label?: string; values?: { label?: string; value_index?: number }[] }[];
  variants?: { attributes?: { code?: string; label?: string; value_index?: number }[]; product?: { stock_status?: string } }[];
};

const MAGENTO_QUERY = `query($search: String!, $page: Int!) {
  products(search: $search, pageSize: 100, currentPage: $page) {
    total_count
    items {
      name url_key url_suffix stock_status
      small_image { url }
      price_range { minimum_price { regular_price { value currency } final_price { value currency } } }
      ... on ConfigurableProduct {
        configurable_options { attribute_code label values { label value_index } }
        variants { attributes { code label value_index } product { stock_status } }
      }
    }
  }
}`;

export function magentoItemToOffer(item: MagentoItem, cfg: MagentoSource, source: ShopSource): RawOffer | null {
  const min = item.price_range?.minimum_price;
  const final = min?.final_price, regular = min?.regular_price;
  if (!item.name || !item.url_key || !final?.value || item.stock_status === 'OUT_OF_STOCK') return null;
  if (String(final.currency || '').toUpperCase() !== 'EUR') return null;
  const price = Number(final.value);
  const rrp = regular?.value && Number(regular.value) > price && String(regular.currency || '').toUpperCase() === 'EUR'
    ? Number(regular.value) : undefined;
  const sizeOption = (item.configurable_options || []).find(o => SIZE_NAME.test(String(o.label || '').trim()) || /size|groesse|taglia|talla/i.test(String(o.attribute_code || '')));
  const sizes = sizeOption ? [...new Set((item.variants || [])
    .filter(v => v.product?.stock_status !== 'OUT_OF_STOCK')
    .flatMap(v => (v.attributes || []).filter(a => a.code === sizeOption.attribute_code).map(a => String(a.label || '').trim()))
    .filter(Boolean))] : [];
  return {
    sourceId: source.id, merchant: source.name, merchantCountry: source.country,
    url: `${cfg.origin}/${item.url_key}${item.url_suffix ?? cfg.urlSuffix ?? '.html'}`,
    imageUrl: item.small_image?.url, brand: cfg.brand, name: stripHtml(item.name),
    currency: 'EUR', price, rrp, rrpSource: rrp ? 'magento:regular_price' : undefined,
    sizes, sizeAvailability: sizes.length ? 'available' : undefined, availability: 'in_stock',
  };
}

export async function ingestMagento(source: ShopSource, cfg: MagentoSource, deadline: number,
  fetcher: typeof fetch = fetch): Promise<{ offers: RawOffer[]; statuses: number[] }> {
  const offers = new Map<string, RawOffer>();
  const statuses: number[] = [];
  for (const search of cfg.searches) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (Date.now() > deadline - 2000) return { offers: [...offers.values()], statuses };
      const response = await fetcher(`${cfg.origin}/graphql`, {
        method: 'POST', headers: { 'user-agent': UA, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ query: MAGENTO_QUERY, variables: { search, page } }), signal: timeout(deadline, 15000),
      });
      statuses.push(response.status);
      if (!response.ok) break;
      const json = await response.json() as { data?: { products?: { total_count?: number; items?: MagentoItem[] } } };
      const items = json?.data?.products?.items || [];
      for (const item of items) {
        const offer = magentoItemToOffer(item, cfg, source);
        if (offer && !offers.has(offer.url)) offers.set(offer.url, offer);
      }
      if (items.length < 100) break;
    }
  }
  return { offers: [...offers.values()], statuses };
}

export async function ingestCommerceApi(source: ShopSource, cfg: CommerceSource, deadline: number, fetcher: typeof fetch = fetch) {
  return cfg.type === 'woocommerce' ? ingestWooCommerce(source, cfg, deadline, fetcher) : ingestMagento(source, cfg, deadline, fetcher);
}
