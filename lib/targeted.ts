import * as cheerio from 'cheerio';
import { PROFILE } from '../config/profile';
import { RawOffer, ShopSource } from './types';
import { extractHtmlFallback } from './extract';

const BRAND_SLUG: Record<string,string> = {
  "Arc'teryx":"arcteryx","Odlo":"odlo","Dynafit":"dynafit","Ortovox":"ortovox",
  "La Sportiva":"la-sportiva","Mammut":"mammut","Norrøna":"norrona","Rab":"rab",
  "Patagonia":"patagonia","Haglöfs":"hagloefs","Fjällräven":"fjaellraven","Klättermusen":"klattermusen",
  "Bergans":"bergans","Lundhags":"lundhags","Mountain Equipment":"mountain-equipment","Montura":"montura",
  "Peak Performance":"peak-performance","Houdini":"houdini",
  "66°North":"66-north","Goldwin":"goldwin","Tilak":"tilak"
};

export function targetedListingUrls(source: ShopSource): string[] {
  if(source.id==='mammut-eu') return ['https://www.mammut.com/de/de/category/5834-10/wanderhosen'];
  // Broad men's sale pages cover brands and product families missing from a
  // fixed list of brand-filtered URLs. They are ordinary HTTP requests.
  const urls:string[]=source.id==='bergfreunde' ? [
    'https://www.bergfreunde.de/outlet/outdoor-hosen/fuer--maenner/',
    'https://www.bergfreunde.de/outlet/softshellhosen/fuer--maenner/',
    'https://www.bergfreunde.de/outlet/trekkinghosen/fuer--maenner/',
  ] : [];
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
  return [...new Set(urls)];
}

function moneyValues(s:string):number[]{
  const vals=[...s.matchAll(/(?:UVP[:\s]*)?(\d{1,4}(?:[.,]\d{2})?)\s*€/gi)]
    .map(m=>Number(m[1].replace('.','').replace(',','.')))
    .filter(n=>Number.isFinite(n)&&n>5&&n<5000);
  return [...new Set(vals)];
}
function clean(s:string){return s.replace(/\s+/g,' ').trim()}
function abs(base:string,href:string){try{return new URL(href,base).toString()}catch{return ''}}
function canonicalProductUrl(raw:string){
  try{
    const u=new URL(raw);
    u.hash='';
    // Product listing query parameters here represent variants/tracking, not distinct products.
    u.search='';
    return u.toString();
  }catch{return raw}
}
function fold(s:string){return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ø/g,'o').replace(/æ/g,'ae').replace(/’/g,"'")}
function findBrand(s:string){
  const folded=fold(s);
  const byFold=PROFILE.brands.find(b=>folded.includes(fold(b)));
  if(byFold) return byFold;
  const low=s.toLowerCase();
  return PROFILE.brands.find(b=>low.includes(b.toLowerCase().replace('’',"'"))) ||
    PROFILE.brands.find(b=>low.includes(b.toLowerCase().replace(/[^a-z0-9]/g,''))) || '';
}
function likelyProductText(s:string){
  return /(hose|hosen|pant|pants|trouser|jogger)/i.test(s) &&
    !/(damen|women|girl|kinder|shorts?\b|zip[- ]?off|regenhose|hardshell|skihose|ski pants|bib\b)/i.test(s);
}


function parseEuroText(v:any):number|undefined{
  if(v==null) return undefined;
  const m=String(v).match(/(\d{1,4}(?:[.,]\d{1,2})?)/);
  if(!m) return undefined;
  const n=Number(m[1].replace('.','').replace(',','.'));
  return Number.isFinite(n)?n:undefined;
}
// "bis -50 %" / "up to 50%" badges: the discount applies only to some variants.
const UP_TO=/\b(?:bis(?:\s+zu)?|up\s+to|jusqu'?\s*[àa]|fino\s+al|hasta)\b[^%\d]{0,6}\d{1,2}\s*%/i;
function displayedDiscount($:any,card:any){
  const labels=card.find('[data-testid*="discount" i],[data-testid*="badge" i],[class*="discount" i],[class*="rabatt" i],[class*="percent" i],[class*="badge" i],[class*="sale-badge" i],[data-e2e-test*="discount" i]')
    .map((_:number,node:any)=>clean($(node).text())).get();
  for(const label of labels){
    const match=label.match(/(?:−|-|–)?\s*(\d{1,2})\s*%/);
    const pct=match?Number(match[1]):0;
    if(pct>=40&&pct<=80) return {pct,upTo:UP_TO.test(label)};
  }
  return undefined;
}

function extractBalancedJsonArray(html:string, marker:string):any[] {
  const startMarker=html.indexOf(marker);
  if(startMarker<0) return [];
  const start=html.indexOf('[',startMarker+marker.length);
  if(start<0) return [];
  let depth=0, inString=false, escape=false;
  for(let i=start;i<html.length;i++){
    const ch=html[i];
    if(inString){
      if(escape){escape=false;continue;}
      if(ch==='\\\\'){escape=true;continue;}
      if(ch==='"') inString=false;
      continue;
    }
    if(ch==='"'){inString=true;continue;}
    if(ch==='[') depth++;
    else if(ch===']'){
      depth--;
      if(depth===0){
        const raw=html.slice(start,i+1);
        try{return JSON.parse(raw)}catch{return []}
      }
    }
  }
  return [];
}

function bergzeitUrlMap(html:string):Map<string,{url:string,image?:string,description?:string}>{
  const map=new Map<string,{url:string,image?:string,description?:string}>();
  const $=cheerio.load(html);
  $('script[type="application/ld+json"]').each((_,el)=>{
    try{
      const j=JSON.parse($(el).html()||'null');
      const items=Array.isArray(j?.itemListElement)?j.itemListElement:[];
      for(const it of items){
        const u=String(it?.url||'');
        const m=u.match(/\/(\d{6,})\/?$/);
        if(m) map.set(m[1],{url:u,image:it?.image,description:it?.description});
      }
    }catch{}
  });
  return map;
}

function extractBergzeitState(html:string, source:ShopSource):RawOffer[]{
  const elements=extractBalancedJsonArray(html,'elementsList:');
  if(!elements.length) return [];
  const urls=bergzeitUrlMap(html);
  const out:RawOffer[]=[];
  for(const el of elements){
    const d=el?.data||el;
    const brand=String(d?.brand?.name||'').trim();
    if(!PROFILE.brands.some(b=>b.toLowerCase().replace('’',"'")===brand.toLowerCase().replace('’',"'"))) continue;
    const name=String(d?.name||'').trim();
    const desc=String(d?.description||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
    if(!likelyProductText(name+' '+desc)) continue;
    const productId=String(d?.productId||d?.id||'');
    const info=urls.get(productId);
    const price=parseEuroText(d?.price?.current) ?? Number(d?.price?.priceForSchemaOrgOffer);
    const old=parseEuroText(d?.price?.old) ?? parseEuroText(d?.price?.previous) ?? price;
    if(!Number.isFinite(price)||!price||!Number.isFinite(old)||!old) continue;
    // Listing state exposes a representative variant, not complete live size availability.
    // Leave sizes unconfirmed until the product detail/variant endpoint is validated.
    const sizes:string[]=[];
    const image=d?.images?.[0]?.src || info?.image;
    if(!info?.url) continue;
    const url=info.url;
    out.push({
      sourceId:source.id,merchant:source.name,merchantCountry:source.country,
      url,imageUrl:image,brand,name,sizes,currency:'EUR',price,rrp:old>price?old:undefined,
      rrpSource:old>price?'merchant:listing-old-price':undefined,
      availability:'unknown',description:desc || info?.description
    });
  }
  return out;
}

export function extractTargetedListing(html:string, source:ShopSource, pageUrl:string):RawOffer[] {
  if(source.id==='mammut-eu') return extractHtmlFallback(html,source,pageUrl)
    .filter(x=>/\/products\//.test(x.url) && /\b(?:pants?|hosen?)\b/i.test(x.name||''))
    .map(x=>({...x,brand:'Mammut'}));
  if(source.id==='bergzeit') return extractBergzeitState(html,source);
  const $=cheerio.load(html);
  const out:RawOffer[]=[];
  const seen=new Set<string>();

  $('a[href]').each((_,el)=>{
    const a=$(el);
    const href=canonicalProductUrl(abs(pageUrl,a.attr('href')||''));
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
    const badge=displayedDiscount($,card);
    const discount=badge?.pct;
    const upTo=Boolean(badge&&(badge.upTo||UP_TO.test(clean(a.text()))||UP_TO.test(blob.slice(0,60))));
    // Listing text often repeats the price and includes neighboring variants.
    // A highest number from the card is not a verified reference price.

    let name=clean(a.text());
    if(name.length<5 || name.length>220) {
      name=clean(card.find('h2,h3,h4,[class*="name"],[class*="title"]').first().text());
    }
    if(name.length<5) name=blob.slice(0,180);
    name=name.replace(/\b\d{1,4}(?:[.,]\d{2})?\s*€.*$/,'').trim();

    const key=href.toLowerCase();
    if(seen.has(key)) return; seen.add(key);

    // Listing pages are discovery only. Never treat incidental text or a displayed
    // variant as confirmed live size availability; validate sizes on the product detail.
    const sizes:string[]=[];
    const img=card.find('img').first();
    const imageUrl=img.attr('src')||img.attr('data-src')||img.attr('srcset')?.split(' ')[0];

    out.push({
      sourceId:source.id, merchant:source.name, merchantCountry:source.country,
      url:href, imageUrl:imageUrl?abs(pageUrl,imageUrl):undefined,
      brand, name, sizes, currency:'EUR', price,
      observedDiscountPct:discount,discountSource:discount?(upTo?'merchant:displayed-discount-upto':'merchant:displayed-discount'):undefined,
      availability:/ausverkauft|nicht verfügbar|sold out/i.test(blob)?'out_of_stock':'unknown',
      description:blob.slice(0,500)
    });
  });

  return out.slice(0,80);
}

// Follow only an explicitly linked next page of the same listing. Never guess
// pagination parameters or broaden the crawl to another category/host.
export function nextListingPage(html:string,pageUrl:string):string|null {
  const $=cheerio.load(html);
  const current=new URL(pageUrl);
  const candidates=$('a[rel="next"],a[aria-label],nav a[href], [class*="pagination"] a[href]').toArray();
  for(const node of candidates){
    const a=$(node);
    const label=`${a.attr('rel')||''} ${a.attr('aria-label')||''} ${a.text()}`.trim();
    let next:URL;
    try{next=new URL(a.attr('href')||'',pageUrl)}catch{continue}
    if(next.protocol!=='https:' || next.host!==current.host ||
       !next.pathname.startsWith(current.pathname.replace(/\/\d+\/?$/,'/'))) continue;
    const currentPath=current.pathname.replace(/\/+$/,'');
    const basePath=currentPath.replace(/\/\d+$/,'');
    const priorPathNumber=Number(currentPath.match(/\/(\d+)$/)?.[1]||1);
    const nextPathNumber=Number(next.pathname.replace(/\/+$/,'').match(/\/(\d+)$/)?.[1]);
    if(next.pathname.replace(/\/+$/,'')===`${basePath}/${priorPathNumber+1}` &&
       nextPathNumber===priorPathNumber+1 && nextPathNumber<=5 &&
       next.search===current.search &&
       (/(?:\bnext\b|\bnächste\b|\bweiter\b|[→›»])/i.test(label)||label===String(nextPathNumber))){
      next.hash='';return next.toString();
    }
    if(next.pathname.replace(/\/+$/,'')!==currentPath) continue;
    const changed=[...new Set([...next.searchParams.keys(),...current.searchParams.keys()])]
      .filter(key=>next.searchParams.get(key)!==current.searchParams.get(key));
    if(changed.length!==1 || !/^(?:page|p|currentPage|pageNumber)$/i.test(changed[0])) continue;
    const number=Number(next.searchParams.get(changed[0]));
    const prior=Number(current.searchParams.get(changed[0])||1);
    if(!Number.isInteger(number)||number!==prior+1||number>5) continue;
    if(!/(?:\bnext\b|\bnächste\b|\bweiter\b|[→›»])/i.test(label) && label!==String(number)) continue;
    next.hash='';
    return next.toString();
  }
  return null;
}
