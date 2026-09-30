import type { ShopifySource } from '../lib/shopify';

// Registered shops that run on Shopify and serve euro prices in their public
// collection JSON (verified with the diagnose mode of browser-crawl.yml).
// The crawler reads these collections directly on Vercel; no browser needed.
export const SHOPIFY_SOURCES: Record<string, ShopifySource> = {};
