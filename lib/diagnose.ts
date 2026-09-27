import type { SourceCoverage } from './types';

export function diagnoseCoverage(c:SourceCoverage):SourceCoverage['diagnosticCode']|undefined{
  // A transient 403/429 in one path must not hide successfully extracted offers.
  if(c.status==='blocked' && c.parsedOffers===0)return 'blocked';
  if(c.parsedOffers===0)return 'parser-empty';
  if(!c.eligibleOffers)return 'no-relevant-products';
  // The raw price-evidence count must not be confused with fully normalized offers.
  if(!(c.priceEvidenceOffers??c.pricedOffers))return 'no-reference-price';
  if(!c.pricedOffers)return 'selection-filtered';
  if(!c.availableSizeOffers)return 'size-unverified';
  if(!c.qualifiedOffers)return 'no-qualified-deal';
  return undefined;
}
