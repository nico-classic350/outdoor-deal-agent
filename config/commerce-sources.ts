import type { CommerceSource } from '../lib/commerce-apis';

// Registered shops whose public WooCommerce Store API or Magento 2 GraphQL
// endpoint serves euro prices without login (verified with the diagnose mode of
// browser-crawl.yml). Read directly on Vercel; no browser and no tokens.
export const COMMERCE_SOURCES: Record<string, CommerceSource> = {};
