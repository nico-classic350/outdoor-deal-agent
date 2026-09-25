import { PROFILE } from '../config/profile';
import { RawOffer, NormalizedOffer } from './types';
import { eurValue } from './fx';
import { inferSizeFit } from './size';
import { productFitScore } from './fit';
import { dealScore, dealClass } from './score';
import { productEligible } from './product-rules.mjs';

function brandOf(o:RawOffer){
  const hay=`${o.brand||''} ${o.name||''}`.toLowerCase();
  return PROFILE.brands.find(b=>hay.includes(b.toLowerCase().replace('adidas terrex','terrex'))) || '';
}
export async function normalizeOffer(o:RawOffer):Promise<NormalizedOffer|null>{
  const brand=brandOf(o); if(!brand || !o.name || !o.currency || !o.price || !o.rrp || o.rrp<=o.price) return null;
  if (!productEligible(o.name,o.description)) return null;
  if (/out.of.stock|sold.out|ausverkauft|nicht.verfügbar/i.test(o.availability || '')) return null;
  const text=`${o.name} ${o.description||''}`; const fit=productFitScore(text); if(fit<45) return null;
  const sizeFit=inferSizeFit(o.sizes); if(sizeFit==='no') return null;
  const priceEur=await eurValue(o.price,o.currency), rrpEur=await eurValue(o.rrp,o.currency);
  const shippingEur=o.shipping?await eurValue(o.shipping,o.currency):0;
  const returnCostEur=o.returnCost==null?null:await eurValue(o.returnCost,o.currency);
  const effectiveCostEur=priceEur+shippingEur+(returnCostEur||0);
  const nominalDiscountPct=(1-priceEur/rrpEur)*100;
  const effectiveDiscountPct=(1-effectiveCostEur/rrpEur)*100;
  const base={...o,brand,name:o.name,currency:o.currency,price:o.price,rrp:o.rrp,priceEur,rrpEur,shippingEur,returnCostEur,effectiveCostEur,nominalDiscountPct,effectiveDiscountPct,sizeFit,productFitScore:fit};
  const score=dealScore(base as any), klass=dealClass(effectiveDiscountPct,sizeFit,fit);
  return {...base,score,class:klass};
}
