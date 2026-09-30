import type { CommerceSource } from '../lib/commerce-apis';

// Registered shops whose public WooCommerce Store API or Magento 2 GraphQL
// endpoint serves euro prices without login (verified with the diagnose mode of
// browser-crawl.yml). Read directly on Vercel; no browser and no tokens.
export const COMMERCE_SOURCES: Record<string, CommerceSource> = {
  // Magento 2 GraphQL, euro prices verified on 30 September 2026.
  'snowcountry': { type: 'magento', origin: 'https://www.snowcountry.eu', searches: ['wandelbroek heren', 'outdoorbroek heren', 'softshell broek heren'] },
  'maxisport': { type: 'magento', origin: 'https://www.maxisport.com', searches: ['pantaloni trekking uomo', 'pantaloni montagna uomo', 'pantalone outdoor uomo'] },
};
