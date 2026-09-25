import { PROFILE } from '../config/profile';
import { productEligible } from './product-rules.mjs';
export function productFitScore(text:string): number {
  if (!productEligible(text)) return 0;
  const t = text.toLowerCase();
  if (PROFILE.excludedProductTerms.some(x=>t.includes(x))) return 0;
  let score = 55;
  const plus = ['stretch','lightweight','leicht','packable','schnelltrock','quick dry','abrasion','robust','travel','trekking','hiking','regular fit'];
  const minus = ['heavyweight','reinforced knee','alpine','mountaineering','expedition','gaiter','snow'];
  for (const p of plus) if (t.includes(p)) score += 5;
  for (const m of minus) if (t.includes(m)) score -= 10;
  return Math.max(0,Math.min(100,score));
}
