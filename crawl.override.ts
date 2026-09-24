import { ShopSource, RawOffer, SourceCoverage } from './types';
import { extractJsonLd, extractHtmlFallback } from './extract';
import { PROFILE } from '../config/profile';
import { ingestFeed } from './feed';
import { browserExtract } from './browser';
import { targetedListingUrls, extractTargetedListing } from './targeted';
import { ingestGlobetrotterOfficialFeed } from './globetrotter-feed';
import { ingestAwinProductFeed } from './awin-feed';

const UA='Mozilla/5.0 (compatible; OutdoorDealAgent/0.1; +https://example.invalid/bot)';
const BRAND_TERMS=PROFILE.brands.map(x=>x.toLowerCase().replace('adidas terrex','terrex'));

async function get(url:string, ms=10000){
  return fetch(url,{headers:{'user-agent':UA,'accept-language':'de-DE,de;q=0.9,en;q=0.5'},redirect:'follow',signal:AbortSignal.timeout(ms)});
}
function absolute(base:string,u:string){try{return new URL(u,base).toString()}catch{return ''}}

async function sitemapUrls(source:ShopSource):Promise<string[]> {
  const candidates = source.sitemapHints?.length ? source.sitemapHints.map(x=>absolute(source.baseUrl,x)) : [absolute(source.baseUrl,'/sitemap.xml'),absolute(source.baseUrl,'/sitemap_index.xml')];
  const urls:string[]=[];
  for(const sm of candidates){
    try{
      const r=await get(sm,8000); if(!r.ok) continue; const xml=await r.text();
      const locs=[...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1].replace(/&amp;/g,'&'));
      const nested=locs.filter(x=>/sitemap/i.test(x)).slice(0,20);
      if(nested.length){
        for(const n of nested){ try{const rr=await get(n,8000); if(!rr.ok) continue; const xx=await rr.text(); urls.push(...[...xx.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1].replace(/&amp;/g,'&')))}catch{} }
      } else urls.push(...locs);
    }catch{}
  }
  const filtered=urls.filter(u=>{
    const s=u.toLowerCase(); return BRAND_TERMS.some(b=>s.includes(b.replace(/[^a-z0-9]/g,''))||s.includes(b)) || /(herren|men|pants|hose|hosen|trousers|outdoor|trekking|wandern|sale|outlet)/.test(s);
  });
  return [...new Set(filtered)].slice(0,120);
}

export async function crawlSource(source:ShopSource):Promise<{offers:RawOffer[],coverage:SourceCoverage}> {
  const start=Date.now(); let discovered:string[]=[]; const offers:RawOffer[]=[];
  const technicalPath:string[]=[]; const httpStatuses:number[]=[];
  const coverage=(status:SourceCoverage['status'], note?:string):SourceCoverage=>({
    sourceId:source.id,name:source.name,status,discoveredUrls:discovered.length,parsedOffers:offers.length,
    elapsedMs:Date.now()-start,note,technicalPath:[...new Set(technicalPath)],httpStatuses:[...new Set(httpStatuses)]
  });

  try{
    if(source.id==='globetrotter'){
      technicalPath.push('official-affiliate-feed');
      try{
        const feedOffers=await ingestGlobetrotterOfficialFeed(source);
        offers.push(...feedOffers);
        discovered=['official-product-feed'];
        technicalPath.push('official-affiliate-feed-success');
        return {offers,coverage:coverage('success','Official Globetrotter product data feed')};
      }catch(e:any){
        technicalPath.push('official-affiliate-feed-failed');
      }
    }

    technicalPath.push('awin-check');
    try{
      const awin=await ingestAwinProductFeed(source);
      if(awin.configured){
        technicalPath.push('awin-product-feed');
        if(awin.offers.length){
          offers.push(...awin.offers);
          discovered=['awin-product-feed'];
          technicalPath.push('awin-product-feed-success');
          return {offers,coverage:coverage('success',awin.note)};
        }
        technicalPath.push('awin-feed-empty');
      } else {
        technicalPath.push('awin-not-configured-or-unmapped');
      }
    }catch(e:any){
      technicalPath.push('awin-feed-failed');
    }

    const targeted=targetedListingUrls(source);
    if(targeted.length){
      technicalPath.push('targeted-brand-listings');
      discovered=targeted;
      for(const url of targeted){
        try{
          technicalPath.push('listing-http-fetch');
          const r=await get(url,9000); httpStatuses.push(r.status);
          if(!r.ok) continue;
          const html=await r.text();
          const x=extractTargetedListing(html,source,url);
          if(x.length) technicalPath.push('listing-card-extraction');
          offers.push(...x);
        }catch{ technicalPath.push('listing-http-error'); }
      }
      const unique=[...new Map(offers.map(o=>[(o.url+'|'+o.name).toLowerCase(),o])).values()];
      offers.splice(0,offers.length,...unique);
      if(offers.length){
        return {offers,coverage:coverage('success','Targeted brand listing crawl produced product cards')};
      }
      technicalPath.push('targeted-listings-empty','generic-fallback');
      discovered=[];
    }

    technicalPath.push('feed-check');
    const feedOffers=await ingestFeed(source);
    if(feedOffers.length){
      offers.push(...feedOffers);
      technicalPath.push('feed-success');
      discovered=[source.feedUrl || source.baseUrl];
      return {offers,coverage:coverage('success','Structured feed')};
    }

    technicalPath.push('sitemap-discovery');
    discovered=await sitemapUrls(source);
    if(!discovered.length){
      technicalPath.push('base-url-fallback');
      discovered=[source.baseUrl];
    } else {
      technicalPath.push('sitemap-urls');
    }

    for(const url of discovered.slice(0,60)){
      try{
        technicalPath.push('http-fetch');
        const r=await get(url,9000);
        httpStatuses.push(r.status);
        if(r.status===403||r.status===429){
          technicalPath.push(`http-${r.status}`,'browser-fallback');
          const bx=await browserExtract(source,url); offers.push(...bx);
          if(bx.length) technicalPath.push('browser-success'); else technicalPath.push('browser-failed');
          return {offers,coverage:coverage(bx.length?'browser':'blocked',bx.length?'Browser fallback succeeded':`HTTP ${r.status}; browser fallback failed`)};
        }
        if(!r.ok) continue;
        const html=await r.text();
        technicalPath.push('json-ld');
        let x=extractJsonLd(html,source,url);
        if(!x.length){
          technicalPath.push('html-fallback');
          x=extractHtmlFallback(html,source,url);
        }
        if(x.length) technicalPath.push('parsed-product-data');
        offers.push(...x);
      }catch{
        technicalPath.push('http-error');
      }
    }
    if(!offers.length){
      technicalPath.push('browser-fallback');
      const bx=await browserExtract(source,source.baseUrl); offers.push(...bx);
      if(bx.length) technicalPath.push('browser-success'); else technicalPath.push('browser-failed');
      return {offers,coverage:coverage(bx.length?'browser':'failed',bx.length?'Browser fallback succeeded':'No parseable data after browser fallback')};
    }
    const status = discovered.length>1?'success':'partial';
    return {offers,coverage:coverage(status,'Direct crawl produced parseable product data')};
  } catch(e:any){
    technicalPath.push('fatal-error');
    return {offers,coverage:coverage('failed',String(e?.message||e))};
  }
}
