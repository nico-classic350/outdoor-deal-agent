import { ShopSource, RawOffer, SourceCoverage } from './types';
import { extractJsonLd, extractHtmlFallback } from './extract';
import { PROFILE } from '../config/profile';
import { ingestFeed } from './feed';
import { browserExtract, browserFallbackConfigured, browserFallbackMode } from './browser';
import { targetedListingUrls, extractTargetedListing } from './targeted';
import { ingestGlobetrotterOfficialFeed } from './globetrotter-feed';
import { ingestAwinProductFeed } from './awin-feed';

const UA='Mozilla/5.0 (compatible; OutdoorDealAgent/0.1; +https://example.invalid/bot)';
const BRAND_TERMS=PROFILE.brands.map(x=>x.toLowerCase().replace('adidas terrex','terrex'));
const SOURCE_BUDGET_MS = Math.max(20000, Math.min(90000, Number(process.env.SOURCE_BUDGET_MS || 45000)));
const GENERIC_URL_LIMIT = Math.max(8, Math.min(30, Number(process.env.GENERIC_URL_LIMIT || 20)));
const BROWSER_FALLBACK_URL_LIMIT = Math.max(1, Math.min(3, Number(process.env.BROWSER_FALLBACK_URL_LIMIT || 2)));

async function get(url:string, ms=10000){
  return fetch(url,{headers:{'user-agent':UA,'accept-language':'de-DE,de;q=0.9,en;q=0.5'},redirect:'follow',signal:AbortSignal.timeout(ms)});
}
function absolute(base:string,u:string){try{return new URL(u,base).toString()}catch{return ''}}

async function sitemapUrls(source:ShopSource, deadline=Date.now()+15000):Promise<string[]> {
  const candidates = source.sitemapHints?.length ? source.sitemapHints.map(x=>absolute(source.baseUrl,x)) : [absolute(source.baseUrl,'/sitemap.xml'),absolute(source.baseUrl,'/sitemap_index.xml')];
  const urls:string[]=[];
  for(const sm of candidates){
    if(Date.now() >= deadline) break;
    try{
      const r=await get(sm,8000); if(!r.ok) continue; const xml=await r.text();
      const locs=[...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1].replace(/&amp;/g,'&'));
      const nested=locs.filter(x=>/sitemap/i.test(x)).slice(0,6);
      if(nested.length){
        for(const n of nested){ if(Date.now() >= deadline) break; try{const rr=await get(n,6000); if(!rr.ok) continue; const xx=await rr.text(); urls.push(...[...xx.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1].replace(/&amp;/g,'&')))}catch{} }
      } else urls.push(...locs);
    }catch{}
  }
  const filtered=urls.filter(u=>{
    const s=u.toLowerCase(); return BRAND_TERMS.some(b=>s.includes(b.replace(/[^a-z0-9]/g,''))||s.includes(b)) || /(herren|men|pants|hose|hosen|trousers|outdoor|trekking|wandern|sale|outlet)/.test(s);
  });
  return [...new Set(filtered)].slice(0,120);
}

export async function crawlSource(source:ShopSource):Promise<{offers:RawOffer[],coverage:SourceCoverage}> {
  const start=Date.now(); const deadline=start+SOURCE_BUDGET_MS; let discovered:string[]=[]; const offers:RawOffer[]=[];
  const budgetRemaining=()=>Date.now()<deadline;
  const technicalPath:string[]=[]; const httpStatuses:number[]=[];
  const coverage=(status:SourceCoverage['status'], note?:string):SourceCoverage=>({
    sourceId:source.id,name:source.name,status,discoveredUrls:discovered.length,parsedOffers:offers.length,
    elapsedMs:Date.now()-start,note,technicalPath:[...new Set(technicalPath)],httpStatuses:[...new Set(httpStatuses)]
  });
  const browserFallback = async (urls:string[], blocked=false) => {
    technicalPath.push('browser-fallback',`browser-mode-${browserFallbackMode()}`);
    for(const url of [...new Set(urls)].slice(0,BROWSER_FALLBACK_URL_LIMIT)){
      if(!budgetRemaining()) { technicalPath.push('source-budget-exhausted'); break; }
      const result=await browserExtract(source,url,{blocked});
      if(result.httpStatus) httpStatuses.push(result.httpStatus);
      if(result.mode!=='none') technicalPath.push(`browser-${result.mode}`);
      if(result.offers.length){
        offers.push(...result.offers);
        technicalPath.push('browser-success');
      } else {
        technicalPath.push('browser-empty');
      }
      if(offers.length) break;
    }
    return offers.length>0;
  };

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
        if(!budgetRemaining()) { technicalPath.push('source-budget-exhausted'); break; }
        try{
          technicalPath.push('listing-http-fetch');
          const r=await get(url,7000); httpStatuses.push(r.status);
          if(!r.ok) continue;
          const html=await r.text();
          const x=extractTargetedListing(html,source,url);
          if(x.length) technicalPath.push('listing-card-extraction');
          offers.push(...x);
        }catch{ technicalPath.push('listing-http-error'); }
      }
      const unique=[...new Map(offers.map(o=>[o.url.toLowerCase(),o])).values()];
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
    discovered=await sitemapUrls(source, Math.min(deadline, Date.now()+15000));
    if(!discovered.length){
      technicalPath.push('base-url-fallback');
      discovered=[source.baseUrl];
    } else {
      technicalPath.push('sitemap-urls');
    }

    for(const url of discovered.slice(0,GENERIC_URL_LIMIT)){
      if(!budgetRemaining()) { technicalPath.push('source-budget-exhausted'); break; }
      try{
        technicalPath.push('http-fetch');
        const r=await get(url,7000);
        httpStatuses.push(r.status);
        if(r.status===403||r.status===429){
          technicalPath.push(`http-${r.status}`);
          if(!browserFallbackConfigured()){
            technicalPath.push('browser-fallback-disabled');
            return {offers,coverage:coverage('blocked',`HTTP ${r.status}; Browserless token not configured`)};
          }
          const succeeded=await browserFallback([url],true);
          return {offers,coverage:coverage(succeeded?'browser':'blocked',succeeded?'Browserless unblock fallback succeeded':`HTTP ${r.status}; Browserless fallback returned no parseable product data`)};
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
      if(!browserFallbackConfigured()){
        technicalPath.push('browser-fallback-disabled');
        return {offers,coverage:coverage('failed','No parseable data; Browserless token not configured')};
      }
      const candidates=discovered.length ? discovered : [source.baseUrl];
      const succeeded=await browserFallback(candidates,false);
      return {offers,coverage:coverage(succeeded?'browser':'failed',succeeded?'Browserless rendered-page fallback succeeded':'No parseable data after Browserless fallback')};
    }
    const status = discovered.length>1?'success':'partial';
    return {offers,coverage:coverage(status,'Direct crawl produced parseable product data')};
  } catch(e:any){
    technicalPath.push('fatal-error');
    return {offers,coverage:coverage('failed',String(e?.message||e))};
  }
}
