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
export type RejectionReason = 'brand-not-allowed'|'name-missing'|'currency-missing'|'price-missing'|'discount-unverified'|'product-mismatch'|
  'sold-out'|'excluded-color'|'low-product-fit'|'incompatible-size';
export async function normalizeOfferChecked(o:RawOffer):Promise<{offer:NormalizedOffer|null;reason?:RejectionReason}>{
  const brand=brandOf(o);
  if (!o.name) return {offer:null,reason:'name-missing'};
  if (!brand) return {offer:null,reason:'brand-not-allowed'};
  if (!o.currency) return {offer:null,reason:'currency-missing'};
  if (!Number.isFinite(o.price) || Number(o.price)<=0) return {offer:null,reason:'price-missing'};
  const rrp=o.rrp && o.rrp>o.price && o.rrpSource ? o.rrp : undefined;
  const rrpVerified=Boolean(rrp&&o.rrpSource);
  const discountVerified=Boolean(o.discountSource && Number.isFinite(o.observedDiscountPct) && o.observedDiscountPct!>=40);
  if(!rrpVerified&&!discountVerified) return {offer:null,reason:'discount-unverified'};
  if (!productEligible(o.name,o.description)) return {offer:null,reason:'product-mismatch'};
  if (/out.of.stock|sold.out|ausverkauft|nicht.verfügbar/i.test(o.availability || '')) return {offer:null,reason:'sold-out'};
  const color=(o.color||'').toLowerCase();
  if(/white|weiß|weiss|blanc|bianco|neon|fluorescen|knall/i.test(color)) return {offer:null,reason:'excluded-color'};
  const colorBonus=/navy|dark blue|light blue|blue|black|schwarz|blau|grey|gray|grau/i.test(color)?5:0;
  // Category suitability is decided above; fit ranks eligible trousers rather
  // than silently excluding a genuine outdoor/trekking/softshell product.
  const fit=Math.min(100,productFitScore(o.name,o.description)+colorBonus);
  const sizeFit=inferSizeFit(o.sizes); if(sizeFit==='no') return {offer:null,reason:'incompatible-size'};
  const priceEur=await eurValue(o.price,o.currency), rrpEur=rrp?await eurValue(rrp,o.currency):null;
  const shippingKnown=o.shipping!=null;
  const shippingEur=shippingKnown?await eurValue(o.shipping!,o.currency):0;
  const returnCostEur=o.returnCost==null?null:await eurValue(o.returnCost,o.currency);
  const effectiveCostEur=priceEur+shippingEur+(returnCostEur||0);
  const nominalDiscountPct=rrpEur ? (1-priceEur/rrpEur)*100 : Number(o.observedDiscountPct);
  // A merchant badge is valid evidence without an RRP. Use its implied ratio
  // only to subtract delivery/return costs; never expose it as a verified RRP.
  const effectiveDiscountPct=rrpEur ? (1-effectiveCostEur/rrpEur)*100
    : (1-(effectiveCostEur/priceEur)*(1-Number(o.observedDiscountPct)/100))*100;
  const trustedSizeFit=o.sizeAvailability==='available'?sizeFit:sizeFit==='confirmed'?'unconfirmed':sizeFit;
  const base={...o,brand,name:o.name,currency:o.currency,price:o.price,rrp:rrp??null,priceEur,rrpEur,shippingEur,shippingKnown,rrpVerified,discountVerified,returnCostEur,effectiveCostEur,nominalDiscountPct,effectiveDiscountPct,sizeFit:trustedSizeFit,productFitScore:fit};
  const score=dealScore(base as any), klass=dealClass(effectiveDiscountPct,trustedSizeFit,fit);
  return {offer:{...base,score,class:klass}};
}
export async function normalizeOffer(o:RawOffer):Promise<NormalizedOffer|null>{
  return (await normalizeOfferChecked(o)).offer;
}
