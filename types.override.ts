export type SourceStatus = 'success'|'partial'|'browser'|'blocked'|'failed';

export type ShopSource = {
  id: string;
  name: string;
  country: string;
  baseUrl: string;
  priority: 1|2|3;
  languages?: string[];
  currencyHints?: string[];
  sitemapHints?: string[];
  feedUrl?: string;
};

export type RawOffer = {
  sourceId: string;
  merchant: string;
  merchantCountry: string;
  url: string;
  imageUrl?: string;
  brand?: string;
  name?: string;
  color?: string;
  sizes?: string[];
  currency?: string;
  price?: number;
  rrp?: number;
  shipping?: number;
  returnCost?: number;
  availability?: string;
  description?: string;
};

export type NormalizedOffer = RawOffer & {
  brand: string;
  name: string;
  currency: string;
  price: number;
  rrp: number;
  priceEur: number;
  rrpEur: number;
  shippingEur: number;
  returnCostEur: number|null;
  effectiveCostEur: number;
  nominalDiscountPct: number;
  effectiveDiscountPct: number;
  sizeFit: 'confirmed'|'probable'|'unconfirmed'|'no';
  productFitScore: number;
  marketPriceEur?: number;
  score: number;
  class: 'Top Deal'|'Strong Deal'|'Good Deal'|'Near Miss';
  reason?: string;
};

export type SourceCoverage = {
  sourceId: string;
  name: string;
  status: SourceStatus;
  discoveredUrls: number;
  parsedOffers: number;
  elapsedMs: number;
  note?: string;
  technicalPath?: string[];
  httpStatuses?: number[];
};

export type RunReport = {
  startedAt: string;
  finishedAt: string;
  plannedSources: number;
  attemptedSources: number;
  success: number;
  partial: number;
  browser: number;
  blocked: number;
  failed: number;
  rawOffers: number;
  normalizedOffers: number;
  screenedOffers?: number;
  distinctOffers?: number;
  confirmedSizeOffers?: number;
  qualifiedDeals: number;
  nearMisses: number;
  coverage: SourceCoverage[];
};
