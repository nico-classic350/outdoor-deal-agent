import * as cheerio from 'cheerio';
import { RawOffer, ShopSource } from './types';

function absolute(base:string, value?:string){
  if(!value) return '';
  try{return new URL(value,base).toString()}catch{return ''}
}
function num(value:any):number|undefined{
  if(value==null) return undefined;
  // A price component may repeat the same amount for visual and screen-reader
  // markup. Read one amount rather than concatenating all digits in its text.
  const s=String(value).match(/\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?/)?.[0];
  if(!s) return undefined;
  const normalized=s.includes(',')&&s.includes('.')?s.replace(/[.\s]/g,'').replace(',','.')
    : s.replace(',','.');
  const n=Number(normalized); return Number.isFinite(n)&&n>0?n:undefined;
}
function text(value:any){return String(value??'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
function discountFrom($:any,scope:any){
  const labels=scope.find('[data-testid*="discount" i],[data-testid*="badge" i],[class*="discount" i],[class*="rabatt" i],[class*="percent" i],[class*="badge" i],[class*="sale-badge" i],[data-e2e-test*="discount" i]')
    .map((_:number,node:any)=>text($(node).text())).get();
  for(const label of labels){
    const match=label.match(/(?:−|-|–)?\s*(\d{1,2})\s*%/);
    const value=match?Number(match[1]):0;
    if(value>=40&&value<100) return value;
  }
  return undefined;
}
function productNodes(value:any,out:any[]=[]):any[]{
  if(!value) return out;
  if(Array.isArray(value)){ for(const x of value) productNodes(x,out); return out; }
  if(typeof value!=='object') return out;
  const type=value['@type'];
  if(type==='Product'||(Array.isArray(type)&&type.includes('Product'))) out.push(value);
  for(const v of Object.values(value)) if(v&&typeof v==='object') productNodes(v,out);
  return out;
}
function offersOf(product:any):any[]{
  const raw=product?.offers;
  if(!raw) return [];
  const outer=Array.isArray(raw)?raw:[raw];
  return outer.flatMap(o=>o?.['@type']==='AggregateOffer' ? (Array.isArray(o.offers)?o.offers:o.offers?[o.offers]:[]) : [o]);
}
function rrpOf(product:any,offer:any,price?:number,productReferenceAllowed=true){
  const fields=[...(productReferenceAllowed ? [['product.rrp',product?.rrp],['product.listPrice',product?.listPrice],
    ['product.originalPrice',product?.originalPrice]] : []),['offer.listPrice',offer?.listPrice],
    ['offer.originalPrice',offer?.originalPrice],
    ['offer.priceSpecification.referencePrice',offer?.priceSpecification?.referencePrice]] as const;
  return fields.map(([source,value])=>({source,value:num(value)}))
    .find(x=>x.value!=null && (!price || x.value>price));
}

export function extractJsonLd(html:string, source:ShopSource, pageUrl:string):RawOffer[]{
  const $=cheerio.load(html); const result:RawOffer[]=[]; const seen=new Set<string>();
  const pageDiscount=discountFrom($,$('body'));
  let totalProducts=0;
  $('script[type="application/ld+json"]').each((_,el)=>{
    try{
      const parsed=JSON.parse($(el).html()||'null');
      const products=productNodes(parsed); totalProducts+=products.length;
      for(const p of products) for(const o of offersOf(p)){
        const url=absolute(pageUrl,o?.url||p?.url||pageUrl);
        const variantKey=`${url}|${text(o?.sku||o?.size||p?.size)}|${o?.price??''}`;
        if(!url||seen.has(variantKey)) continue;
        const price=num(o?.price??o?.lowPrice??p?.offers?.price); if(!price) continue;
        // A model-level reference cannot safely be paired with an arbitrary
        // variant price when the JSON-LD contains multiple offers.
        const reference=rrpOf(p,o,price,offersOf(p).length===1);
        const brand=text(p?.brand?.name??p?.brand);
        const name=text(p?.name); if(!name) continue;
        const imageRaw=Array.isArray(p?.image)?p.image[0]:p?.image?.url??p?.image;
        const availability=text(o?.availability).split('/').pop()||'unknown';
        const color=text(p?.color)||undefined;
        const size=text(o?.size||p?.size)||undefined;
        seen.add(variantKey);
        const discount=reference?undefined:pageDiscount;
        const inStock=/InStock|LimitedAvailability/i.test(availability);
        result.push({sourceId:source.id,merchant:source.name,merchantCountry:source.country,url,
          imageUrl:absolute(pageUrl,text(imageRaw))||undefined,brand:brand||undefined,name,color,
          sizes:size?[size]:[],currency:text(o?.priceCurrency)||'EUR',price,rrp:reference?.value,rrpSource:reference?.source,
          observedDiscountPct:discount,discountSource:discount?'merchant:displayed-discount':undefined,
          sizeAvailability:size&&inStock?'available':'unknown',availability,description:text(p?.description)});
      }
    }catch{}
  });
  // A page-level promo badge is only safe when the document represents one product.
  if(totalProducts>1) for(const offer of result){offer.observedDiscountPct=undefined;offer.discountSource=undefined;}
  return result;
}

export function extractHtmlFallback(html:string, source:ShopSource, pageUrl:string):RawOffer[]{
  const $=cheerio.load(html); const out:RawOffer[]=[]; const seen=new Set<string>();
  const cards=$( [
    'article', '[itemtype*="Product"]', '[data-e2e-test="product-card-container"]', '[class*="product-card"]', '[class*="productCard"]',
    '[class*="product-tile"]', '[class*="productTile"]', '[class*="product-item"]', '[class*="productItem"]',
    '[data-testid*="product"]', '[data-product-id]', '[data-product-sku]'
  ].join(',') );
  cards.slice(0,120).each((_,el)=>{
    const card=$(el);
    const a=card.find('[data-e2e-test="product-card-info-name-section"]').closest('a[href]').first().length
      ? card.find('[data-e2e-test="product-card-info-name-section"]').closest('a[href]').first()
      : card.find('a[href]').first();
    const url=absolute(pageUrl,a.attr('href')); if(!url||seen.has(url)) return;
    const blob=text(card.text()); if(blob.length<8) return;

    const explicitPriceValues = card.find('[itemprop="price"], [data-price], [data-testid*="price"], [class*="product-price"]').map((_,node)=>{
      const item=$(node);
      return num(item.attr('content') || item.attr('data-price') || item.text());
    }).get().filter((x):x is number=>Boolean(x));
    const currencyValues=[...blob.matchAll(/(\d{1,4}(?:[.,]\d{2})?)\s*(?:€|EUR)/gi)]
      .map(m=>num(m[1])).filter((x):x is number=>Boolean(x));
    const values=explicitPriceValues.length?explicitPriceValues:currencyValues;
    if(!values.length) return;

    const price=values[0];
    const reference=num(card.find('del,s,[data-testid*="original-price"],[class*="oldPrice"],[class*="originalPrice"]').first().text());
    const displayedDiscount=discountFrom($,card);
    const rrp=reference && reference>price?reference:undefined;
    let name=text(card.find('[data-e2e-test="product-card-info-name-section"],[itemprop="name"],[data-testid*="name"],[data-testid*="title"],h2,h3,h4,[class*="title"],[class*="name"]').first().text())||text(a.text());
    if(!name) return;
    const brand=text(card.find('[itemprop="brand"],[data-testid*="brand"],[class*="brand"]').first().text())||undefined;
    const img=card.find('img').first();
    const srcset=img.attr('srcset')||img.attr('data-srcset')||card.find('source[srcset]').first().attr('srcset');
    const image=img.attr('src')||img.attr('data-src')||img.attr('data-lazy-src')||srcset?.split(',')[0]?.trim().split(/\s+/)[0];
    seen.add(url);
    out.push({sourceId:source.id,merchant:source.name,merchantCountry:source.country,url,
      imageUrl:absolute(pageUrl,image)||undefined,brand,name,currency:'EUR',price,rrp,rrpSource:rrp?'html:marked-reference-price':undefined,
      observedDiscountPct:!rrp&&displayedDiscount?displayedDiscount:undefined,
      discountSource:!rrp&&displayedDiscount?'merchant:displayed-discount':undefined,
      availability:/ausverkauft|sold out|out of stock|nicht verfügbar|épuisé|esaurito/i.test(blob)?'out_of_stock':'unknown',
      description:blob.slice(0,800),sizes:[]});
  });
  return out;
}
