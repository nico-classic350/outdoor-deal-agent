import type { ShopifySource } from '../lib/shopify';

// Registered shops that run on Shopify and serve euro prices in their public
// collection JSON (verified with the diagnose mode of browser-crawl.yml on
// 30 September 2026). The crawler reads these collections directly on Vercel;
// no browser needed. 66°North (USD for the US runner) and Houdini (password
// page) were surveyed and are not configured.
export const SHOPIFY_SOURCES: Record<string, ShopifySource> = {
  'df-sport': { origin: 'https://df-sportspecialist.it', collections: ['prodotti-in-offerta', 'montagna'], currency: 'EUR' },
  // Goldwin Europe renders prices the browser path misreads; its JSON is exact.
  // Goldwin numbers its trouser sizes 1–5; size 3 measures 82 cm at the waist
  // on the EU product pages (≈ L), so 2/3/4 map to M/L/XL.
  'goldwin-eu': { origin: 'https://eu.goldwin.global', collections: ['men-bottoms-full-length', 'sale-24ss'], currency: 'EUR', brand: 'Goldwin',
    sizeMap: { '1': 'S', '2': 'M', '3': 'L', '4': 'XL', '5': 'XXL' } },
  // Sport Förg: large German retailer; sale first, then all trousers (brand from vendor).
  'foerg': { origin: 'https://foerg.de', collections: ['sale', 'hosen'], currency: 'EUR' },
  'sportit': { origin: 'https://www.sportit.com', collections: ['promo-outlet', 'pantaloni-abbigliamento'], currency: 'EUR' },
};
