import { PROFILE } from '../config/profile';
import { RawOffer, NormalizedOffer } from './types';
import { eurValue } from './fx';
import { inferSizeFit } from './size';
import { productFitScore } from './fit';
import { dealScore, dealClass } from './score';
import { productEligible } from './product-rules.mjs';

function brandOf(o:RawOffer){
  const clean=(v:string)=>v.toLowerCase().replace(/[’']/g,"'").trim();
  const known=PROFILE.brands.find(b=>clean(o.brand||'')===clean(b));
  if(known) return known;
  const title=clean(o.name||'');
  return PROFILE.brands.find(b=>{
    const term=clean(b).replace('adidas terrex','terrex').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return new RegExp(`(?:^|[^a-zà-ž])${term}(?=$|[^a-zà-ž])`,'i').test(title);
  })||'';
}
export async function normalizeOffer(o:RawOffer):Promise<NormalizedOffer|null>{
  const brand=brandOf(o); if(!brand || !o.name || !o.currency || !o.price || !o.rrp || o.rrp<=o.price) return null;
  if (!productEligible(o.name,o.description)) return null;
  if (/out.of.stock|sold.out|ausverkauft|nicht.verfügbar/i.test(o.availability || '')) return null;
  const color=(o.color||'').toLowerCase();
  if(/white|weiß|weiss|blanc|bianco|neon|fluorescen|knall/i.test(color)) return null;
  const text=`${o.name} ${o.description||''}`;
  const colorBonus=/navy|dark blue|light blue|blue|black|schwarz|blau|grey|gray|grau/i.test(color)?5:0;
  const fit=Math.min(100,productFitScore(text)+colorBonus); if(fit<45) return null;
  const sizeFit=inferSizeFit(o.sizes); if(sizeFit==='no') return null;
  const priceEur=await eurValue(o.price,o.currency), rrpEur=await eurValue(o.rrp,o.currency);
  const shippingKnown=o.shipping!=null;
  const shippingEur=shippingKnown?await eurValue(o.shipping!,o.currency):0;
  const returnCostEur=o.returnCost==null?null:await eurValue(o.returnCost,o.currency);
  const effectiveCostEur=priceEur+shippingEur+(returnCostEur||0);
  const nominalDiscountPct=(1-priceEur/rrpEur)*100;
  const effectiveDiscountPct=(1-effectiveCostEur/rrpEur)*100;
  const rrpVerified=Boolean(o.rrpSource);
  const trustedSizeFit=o.sizeAvailability==='available'?sizeFit:sizeFit==='confirmed'?'unconfirmed':sizeFit;
  const base={...o,brand,name:o.name,currency:o.currency,price:o.price,rrp:o.rrp,priceEur,rrpEur,shippingEur,shippingKnown,rrpVerified,returnCostEur,effectiveCostEur,nominalDiscountPct,effectiveDiscountPct,sizeFit:trustedSizeFit,productFitScore:fit};
  const score=dealScore(base as any), klass=dealClass(effectiveDiscountPct,trustedSizeFit,fit);
  return {...base,score,class:klass};
}
