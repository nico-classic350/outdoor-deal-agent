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
  // The reference price must be tied to this offer/variant, never inferred from nearby prices.
  rrpSource?: string;
  observedDiscountPct?: number;
  discountSource?: string;
  shipping?: number;
  returnCost?: number;
  sizeAvailability?: 'available'|'unknown';
  availability?: string;
  description?: string;
};

export type NormalizedOffer = RawOffer & {
  brand: string;
  name: string;
  currency: string;
  price: number;
  rrp: number|null;
  priceEur: number;
  rrpEur: number|null;
  shippingEur: number;
  returnCostEur: number|null;
  effectiveCostEur: number;
  shippingKnown: boolean;
  rrpVerified: boolean;
  discountVerified: boolean;
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
  eligibleOffers?: number;
  /** Raw observations with a variant-linked RRP or an explicit merchant discount. */
  priceEvidenceOffers?: number;
  rejectionReasons?: Record<string,number>;
  pricedOffers?: number;
  verifiedReferenceOffers?: number;
  availableSizeOffers?: number;
  qualifiedOffers?: number;
  diagnosticCode?: 'blocked'|'parser-empty'|'no-relevant-products'|'no-reference-price'|'selection-filtered'|'size-unverified'|'no-qualified-deal';
  elapsedMs: number;
  note?: string;
  technicalPath?: string[];
  httpStatuses?: number[];
};

export type RunReport = {
  startedAt: string;
  finishedAt: string;
  /** Latest completion timestamp across all batches; stable across finalizer retries. */
  batchSnapshotAt?: string;
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
  comparison?: ReturnType<typeof import('./coverage-delta').compareCoverage>;
};
