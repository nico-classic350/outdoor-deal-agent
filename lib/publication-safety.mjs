import { productEligible, selectOffers } from './product-rules.mjs';

/** Apply current publication gates to persisted candidates, including old runs. */
export function screenForPublication(candidates, minDiscount) {
  const eligible = (Array.isArray(candidates) ? candidates : [])
    .filter(o => o && typeof o.name === 'string' && productEligible(o.name, o.description));
  return { candidates: eligible, ...selectOffers(eligible, minDiscount) };
}
