import * as cheerio from 'cheerio';
import { PROFILE } from '../config/profile';
import { RawOffer, ShopSource } from './types';

const BRAND_SLUG: Record<string,string> = {
  "Arc'teryx":"arcteryx","Odlo":"odlo","Dynafit":"dynafit","Ortovox":"ortovox",
  "La Sportiva":"la-sportiva","Mammut":"mammut","Norrøna":"norrona","Rab":"rab",
  "Patagonia":"patagonia","Haglöfs":"hagloefs","Black Diamond":"black-diamond",
  "Peak Performance":"peak-performance","Houdini":"houdini","Adidas Terrex":"adidas-terrex",
  "66°North":"66-north","Goldwin":"goldwin","Tilak":"tilak"
};

export function targetedListingUrls(source: ShopSource): string[] {
  const urls:string[]=[];
  for (const brand of PROFILE.brands) {
    const slug=BRAND_SLUG[brand] || brand.toLowerCase().replace(/[^a-z0-9]+/g,'-');
    if(source.id==='bergfreunde'){
      urls.push(`https://www.bergfreunde.de/outlet/marken/${slug}/outdoor-hosen/fuer--maenner/`);
    } else if(source.id==='bergzeit'){
      urls.push(`https://www.bergzeit.de/herren/bekleidung/hosen/?filter.marke=${encodeURIComponent(brand)}`);
    } else if(source.id==='globetrotter'){
      urls.push(`https://www.globetrotter.de/marken/${slug}/outdoor-bekleidung/outdoorhosen/`);
    } else if(source.id==='sport-schuster'){
      urls.push(`https://www.sport-schuster.de/${slug}-hosen/`);
    }
  }
  return urls;
}

function moneyValues(s:string):number[]{
  const vals=[...s.matchAll(/(?:UVP[:\s]*)?(\d{1,4}(?:[.,]\d{2})?)\s*€/gi)]
    .map(m=>Number(m[1].replace('.','').replace(',','.')))
    .filter(n=>Number.isFinite(n)&&n>5&&n<5000);
  return [...new Set(vals)];
}
function clean(s:string){return s.replace(/\s+/g,' ').trim()}
function abs(base:string,href:string){try{return new URL(href,base).toString()}catch{return ''}}
function findBrand(s:string){
  const low=s.toLowerCase();
  return PROFILE.brands.find(b=>low.includes(b.toLowerCase().replace('’',"'"))) ||
    PROFILE.brands.find(b=>low.includes(b.toLowerCase().replace(/[^a-z0-9]/g,''))) || '';
}
function likelyProductText(s:string){
  return /(hose|hosen|pant|pants|trouser|jogger)/i.test(s) &&
    !/(damen|women|girl|kinder|shorts?\b|zip[- ]?off|regenhose|hardshell|skihose|ski pants|bib\b)/i.test(s);
}

export function extractTargetedListing(html:string, source:ShopSource, pageUrl:string):RawOffer[] {
  const $=cheerio.load(html);
  const out:RawOffer[]=[];
  const seen=new Set<string>();

  $('a[href]').each((_,el)=>{
    const a=$(el);
    const href=abs(pageUrl,a.attr('href')||'');
    if(!href || !href.startsWith('http')) return;

    let card=a.closest('article,li,[data-testid*="product"],[class*="product"],[class*="tile"],[class*="card"]').first();
    if(!card.length) card=a.parent();
    let blob=clean(card.text());
    if(blob.length<15 || blob.length>1800) blob=clean(a.text());
    if(!likelyProductText(blob)) return;

    const brand=findBrand(blob);
    if(!brand) return;

    const prices=moneyValues(blob);
    if(!prices.length) return;
    const price=Math.min(...prices);
    const rrp=Math.max(...prices);

    let name=clean(a.text());
    if(name.length<5 || name.length>220) {
      name=clean(card.find('h2,h3,h4,[class*="name"],[class*="title"]').first().text());
    }
    if(name.length<5) name=blob.slice(0,180);
    name=name.replace(/\b\d{1,4}(?:[.,]\d{2})?\s*€.*$/,'').trim();

    const key=(href+'|'+name).toLowerCase();
    if(seen.has(key)) return; seen.add(key);

    const sizes=[...new Set((blob.match(/\b(?:XXS|XS|S|M|L|XL|XXL|XXXL|(?:2[8-9]|3[0-9]|4[0-2])(?:[-/]?(?:SHORT|REG|LONG|R|L))?)\b/gi)||[]).map(x=>x.toUpperCase()))];
    const img=card.find('img').first();
    const imageUrl=img.attr('src')||img.attr('data-src')||img.attr('srcset')?.split(' ')[0];

    out.push({
      sourceId:source.id, merchant:source.name, merchantCountry:source.country,
      url:href, imageUrl:imageUrl?abs(pageUrl,imageUrl):undefined,
      brand, name, sizes, currency:'EUR', price, rrp:rrp>=price?rrp:price,
      availability:/ausverkauft|nicht verfügbar|sold out/i.test(blob)?'out_of_stock':'unknown',
      description:blob.slice(0,500)
    });
  });

  return out.slice(0,80);
}
