import type { SourceCoverage } from './types';

export function diagnoseCoverage(c:SourceCoverage):SourceCoverage['diagnosticCode']|undefined{
  if(c.status==='blocked'||c.httpStatuses?.some(status=>status===403||status===429))return 'blocked';
  if(c.parsedOffers===0)return 'parser-empty';
  if(!c.eligibleOffers)return 'no-relevant-products';
  if(!c.verifiedReferenceOffers)return 'no-reference-price';
  if(!c.availableSizeOffers)return 'size-unverified';
  if(!c.qualifiedOffers)return 'no-qualified-deal';
  return undefined;
}
