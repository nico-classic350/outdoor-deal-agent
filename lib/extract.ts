import * as cheerio from 'cheerio';
import { RawOffer, ShopSource } from './types';

function absolute(base:string, value?:string){
  if(!value) return '';
  try{return new URL(value,base).toString()}catch{return ''}
}
function num(value:any):number|undefined{
  if(value==null) return undefined;
  const s=String(value).replace(/\s/g,'').replace(/[^0-9,.-]/g,'');
  if(!s) return undefined;
  const normalized=s.includes(',')&&s.includes('.')?s.replace(/\./g,'').replace(',','.'):s.replace(',','.');
  const n=Number(normalized); return Number.isFinite(n)&&n>0?n:undefined;
}
function text(value:any){return String(value??'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
function productNodes(value:any,out:any[]=[]):any[]{
  if(!value) return out;
  if(Array.isArray(value)){ for(const x of value) productNodes(x,out); return out; }
  if(typeof value!=='object') return out;
  const type=value['@type'];
  if(type==='Product'||(Array.isArray(type)&&type.includes('Product'))) out.push(value);
  for(const v of Object.values(value)) if(v&&typeof v==='object') productNodes(v,out);
  return out;
}
function offerOf(product:any){
  const raw=Array.isArray(product?.offers)?product.offers[0]:product?.offers;
  if(!raw) return {};
  if(raw['@type']==='AggregateOffer') return raw.offers?.[0] ? {...raw,...raw.offers[0]} : raw;
  return raw;
}
function rrpOf(product:any,offer:any,price?:number){
  const candidates=[product?.rrp,product?.listPrice,product?.originalPrice,offer?.highPrice,offer?.listPrice,offer?.originalPrice,
    offer?.priceSpecification?.referencePrice,offer?.priceSpecification?.listPrice]
    .map(num).filter((x):x is number=>Boolean(x));
  const valid=candidates.filter(x=>!price||x>price);
  return valid.length?Math.max(...valid):undefined;
}

export function extractJsonLd(html:string, source:ShopSource, pageUrl:string):RawOffer[]{
  const $=cheerio.load(html); const result:RawOffer[]=[]; const seen=new Set<string>();
  $('script[type="application/ld+json"]').each((_,el)=>{
    try{
      const parsed=JSON.parse($(el).html()||'null');
      for(const p of productNodes(parsed)){
        const o=offerOf(p); const url=absolute(pageUrl,o?.url||p?.url||pageUrl); if(!url||seen.has(url)) continue;
        const price=num(o?.price??o?.lowPrice??p?.offers?.price); if(!price) continue;
        const rrp=rrpOf(p,o,price);
        const brand=text(p?.brand?.name??p?.brand);
        const name=text(p?.name); if(!name) continue;
        const imageRaw=Array.isArray(p?.image)?p.image[0]:p?.image?.url??p?.image;
        const availability=text(o?.availability).split('/').pop()||'unknown';
        const color=text(p?.color)||undefined;
        const size=text(p?.size)||undefined;
        seen.add(url);
        result.push({sourceId:source.id,merchant:source.name,merchantCountry:source.country,url,
          imageUrl:absolute(pageUrl,text(imageRaw))||undefined,brand:brand||undefined,name,color,
          sizes:size?[size]:[],currency:text(o?.priceCurrency)||'EUR',price,rrp,
          availability,description:text(p?.description)});
      }
    }catch{}
  });
  return result;
}

export function extractHtmlFallback(html:string, source:ShopSource, pageUrl:string):RawOffer[]{
  const $=cheerio.load(html); const out:RawOffer[]=[]; const seen=new Set<string>();
  const cards=$( [
    'article', '[itemtype*="Product"]', '[class*="product-card"]', '[class*="productCard"]',
    '[class*="product-tile"]', '[class*="productTile"]', '[class*="product-item"]', '[class*="productItem"]',
    '[data-testid*="product"]', '[data-product-id]', '[data-product-sku]'
  ].join(',') );
  cards.slice(0,120).each((_,el)=>{
    const card=$(el);
    const a=card.find('a[href]').first();
    const url=absolute(pageUrl,a.attr('href')); if(!url||seen.has(url)) return;
    const blob=text(card.text()); if(blob.length<8) return;

    const explicitPriceValues = card.find('[itemprop="price"], [data-price], [data-testid*="price"], [class*="price"]').map((_,node)=>{
      const item=$(node);
      return num(item.attr('content') || item.attr('data-price') || item.text());
    }).get().filter((x):x is number=>Boolean(x));
    const currencyValues=[...blob.matchAll(/(\d{1,4}(?:[.,]\d{2})?)\s*(?:€|EUR)/gi)]
      .map(m=>num(m[1])).filter((x):x is number=>Boolean(x));
    const values=[...explicitPriceValues,...currencyValues].filter(x=>x>0);
    if(!values.length) return;

    const price=Math.min(...values), rrp=values.length>1?Math.max(...values):undefined;
    let name=text(card.find('[itemprop="name"],[data-testid*="name"],[data-testid*="title"],h2,h3,h4,[class*="title"],[class*="name"]').first().text())||text(a.text());
    if(!name) return;
    const brand=text(card.find('[itemprop="brand"],[data-testid*="brand"],[class*="brand"]').first().text())||undefined;
    const img=card.find('img').first();
    const srcset=img.attr('srcset')||img.attr('data-srcset')||card.find('source[srcset]').first().attr('srcset');
    const image=img.attr('src')||img.attr('data-src')||img.attr('data-lazy-src')||srcset?.split(',')[0]?.trim().split(/\s+/)[0];
    seen.add(url);
    out.push({sourceId:source.id,merchant:source.name,merchantCountry:source.country,url,
      imageUrl:absolute(pageUrl,image)||undefined,brand,name,currency:'EUR',price,rrp:rrp&&rrp>price?rrp:undefined,
      availability:/ausverkauft|sold out|out of stock|nicht verfügbar|épuisé|esaurito/i.test(blob)?'out_of_stock':'unknown',
      description:blob.slice(0,800),sizes:[]});
  });
  return out;
}
