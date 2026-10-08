import { sizeEvidence } from './product-rules.mjs';

export function inferSizeFit(sizes:string[]|undefined, merchantCountry?:string): 'confirmed'|'probable'|'unconfirmed'|'no' {
  return sizeEvidence(sizes, merchantCountry==='FR' ? 'fr' : 'de');
}
