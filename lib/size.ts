import { sizeEvidence } from './product-rules.mjs';

export function inferSizeFit(sizes:string[]|undefined): 'confirmed'|'probable'|'unconfirmed'|'no' {
  return sizeEvidence(sizes);
}
