import type { SourceCoverage } from './types';

export function diagnoseCoverage(c:SourceCoverage):SourceCoverage['diagnosticCode']|undefined{
  // A transient 403/429 in one path must not hide successfully extracted offers.
  if(c.status==='blocked' && c.parsedOffers===0)return 'blocked';
  if(c.parsedOffers===0)return 'parser-empty';
  if(!c.eligibleOffers)return 'no-relevant-products';
  // Normalization also accepts an explicitly displayed merchant discount.
  // pricedOffers therefore establishes price evidence even without an RRP.
  if(!c.pricedOffers)return 'no-reference-price';
  if(!c.availableSizeOffers)return 'size-unverified';
  if(!c.qualifiedOffers)return 'no-qualified-deal';
  return undefined;
}
