import type { ShopifySource } from '../lib/shopify';

// Registered shops that run on Shopify and serve euro prices in their public
// collection JSON (verified with the diagnose mode of browser-crawl.yml on
// 30 September 2026). The crawler reads these collections directly on Vercel;
// no browser needed. 66°North (USD for the US runner) and Houdini (password
// page) were surveyed and are not configured.
export const SHOPIFY_SOURCES: Record<string, ShopifySource> = {
  'df-sport': { origin: 'https://df-sportspecialist.it', collections: ['prodotti-in-offerta', 'montagna'], currency: 'EUR' },
  'sportit': { origin: 'https://www.sportit.com', collections: ['promo-outlet', 'pantaloni-abbigliamento'], currency: 'EUR' },
};
