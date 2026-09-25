import { NormalizedOffer } from './types';
const sizePoints = {confirmed:100, probable:75, unconfirmed:45, no:0};
export function dealScore(o: Omit<NormalizedOffer,'score'|'class'>): number {
  const marketAdv = o.marketPriceEur && o.marketPriceEur > 0 ? Math.max(0, Math.min(100, ((o.marketPriceEur-o.effectiveCostEur)/o.marketPriceEur)*200)) : 50;
  const discount = Math.max(0,Math.min(100,o.effectiveDiscountPct*1.5));
  const merchant = o.returnCostEur === null ? 65 : 85;
  return Math.round(sizePoints[o.sizeFit]*0.30 + o.productFitScore*0.25 + marketAdv*0.20 + discount*0.15 + merchant*0.10);
}
export function dealClass(effectiveDiscountPct:number, sizeFit:string, fit:number): NormalizedOffer['class'] {
  if (sizeFit !== 'confirmed') return 'Near Miss';
  if (effectiveDiscountPct >= 55 && sizeFit==='confirmed' && fit>=70) return 'Top Deal';
  if (effectiveDiscountPct >= 45) return 'Strong Deal';
  if (effectiveDiscountPct >= 40 && fit>=75) return 'Good Deal';
  return 'Near Miss';
}
