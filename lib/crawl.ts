import { ShopSource, RawOffer, SourceCoverage } from './types';
import { extractJsonLd, extractHtmlFallback } from './extract';
import { PROFILE } from '../config/profile';
import { ingestFeed } from './feed';
import { browserExtract, browserFallbackConfigured, browserFallbackMode } from './browser';
import { targetedListingUrls, extractTargetedListing, nextListingPage } from './targeted';
import { ingestGlobetrotterOfficialFeed } from './globetrotter-feed';
import { llmExtractFromHtml } from './llm-extract';
import { productEligible } from './product-rules.mjs';
import { rankDiscoveryUrls } from './discovery.mjs';
import robotsParser from 'robots-parser';
import { browserStartUrls } from '../config/browser-cohort';
import { SHOP_BRAND } from '../config/shops';
import { SHOPIFY_SOURCES } from '../config/shopify-sources';
import { ingestShopify } from './shopify';
import { COMMERCE_SOURCES } from '../config/commerce-sources';
import { ingestCommerceApi } from './commerce-apis';

const UA='Mozilla/5.0 (compatible; OutdoorDealAgent/1.0; +https://outdoor-deal-agent.vercel.app/)';
const robotsCache=new Map<string,Promise<ReturnType<typeof robotsParser>|null>>();
const BRAND_TERMS=PROFILE.brands.flatMap(x=>[x.toLowerCase(),x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ø/g,'o')]);
const SOURCE_BUDGET_MS = Math.max(20000, Math.min(90000, Number(process.env.SOURCE_BUDGET_MS || 45000)));
const GENERIC_URL_LIMIT = Math.max(8, Math.min(30, Number(process.env.GENERIC_URL_LIMIT || 20)));
const BROWSER_FALLBACK_URL_LIMIT = Math.max(1, Math.min(3, Number(process.env.BROWSER_FALLBACK_URL_LIMIT || 2)));
const EARLY_BROWSER_EMPTY_HTTP_THRESHOLD = Math.max(1, Math.min(5, Number(process.env.EARLY_BROWSER_EMPTY_HTTP_THRESHOLD || 2)));
const LLM_DIRECT_SHADOW_SHOPS = new Set(['4camping', 'rab-eu', 'peakperformance-eu']);

async function get(url:string, source:ShopSource, ms=10000, deadline=Infinity){
  let current=url;
  for(let redirects=0;redirects<4;redirects++){
    if(!safeShopUrl(source,current)) throw new Error('shop-domain-mismatch');
    if(Date.now() >= deadline) throw new Error('source-budget-exhausted');
    const response=await fetch(current,{headers:{'user-agent':UA,'accept-language':'de-DE,de;q=0.9,en;q=0.5'},
      redirect:'manual',signal:AbortSignal.timeout(Math.max(1,Math.min(ms,deadline-Date.now())))});
    if(response.status>=300&&response.status<400&&response.headers.get('location')){
      current=new URL(response.headers.get('location')!,current).toString();continue;
    }
    return response;
  }
  throw new Error('too-many-shop-redirects');
}
function absolute(base:string,u:string){try{return new URL(u,base).toString()}catch{return ''}}
function safeShopUrl(source:ShopSource, url:string){
  try{
    const u=new URL(url), base=new URL(source.baseUrl);
    return u.protocol==='https:' && (u.hostname===base.hostname || u.hostname===base.hostname.replace(/^www\./,''));
  }catch{return false}
}
async function allowedByRobots(source:ShopSource,url:string,deadline:number){
  if(!safeShopUrl(source,url)) return false;
  const origin=new URL(source.baseUrl).origin;
  if(!robotsCache.has(origin)) robotsCache.set(origin,(async()=>{
    try{
      const robotsUrl=new URL('/robots.txt',origin).toString();
      const response=await get(robotsUrl,source,2500,deadline);
      return response.ok?robotsParser(robotsUrl,await response.text()):null;
    }catch{return null}
  })());
  const rules=await robotsCache.get(origin)!;
  return rules?.isAllowed(url,'OutdoorDealAgent')!==false;
}

async function sitemapUrls(source:ShopSource, deadline=Date.now()+15000):Promise<string[]> {
  const candidates = source.sitemapHints?.length ? source.sitemapHints.map(x=>absolute(source.baseUrl,x)) : [absolute(source.baseUrl,'/sitemap.xml'),absolute(source.baseUrl,'/sitemap_index.xml')];
  const urls:string[]=[];
  for(const sm of candidates){
    if(Date.now() >= deadline) break;
    try{
      const r=await get(sm,source,8000,deadline); if(!r.ok) continue; const xml=await r.text();
      const locs=[...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1].replace(/&amp;/g,'&'));
      const nested=locs.filter(x=>/sitemap/i.test(x)&&safeShopUrl(source,x)).slice(0,6);
      if(nested.length){
        for(const n of nested){ if(Date.now() >= deadline) break; try{const rr=await get(n,source,6000,deadline); if(!rr.ok) continue; const xx=await rr.text(); urls.push(...[...xx.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1].replace(/&amp;/g,'&')))}catch{} }
      } else urls.push(...locs);
    }catch{}
  }
  const filtered=urls.filter(u=>{
    if(!safeShopUrl(source,u)) return false;
    const s=u.toLowerCase(); return BRAND_TERMS.some(b=>s.includes(b.replace(/[^a-z0-9]/g,''))||s.includes(b)) || /(herren|men|pants|hose|hosen|trousers|outdoor|trekking|wandern|sale|outlet|kalhoty|panske|spodnie|meskie|pantaloni|pantalon)/.test(s);
  });
  return rankDiscoveryUrls(filtered,PROFILE.brands,120);
}

export async function crawlSource(source:ShopSource):Promise<{offers:RawOffer[],coverage:SourceCoverage}> {
  const result=await crawlSourceUnbranded(source);
  const storeBrand=SHOP_BRAND[source.id];
  if(storeBrand) for(const offer of result.offers) if(!offer.brand) offer.brand=storeBrand;
  return result;
}

async function crawlSourceUnbranded(source:ShopSource):Promise<{offers:RawOffer[],coverage:SourceCoverage}> {
  const start=Date.now(); const deadline=start+SOURCE_BUDGET_MS; let discovered:string[]=[]; const offers:RawOffer[]=[];
  const expandedDiscovery=process.env.DISCOVERY_STRATEGY==='expanded' ||
    (process.env.DISCOVERY_STRATEGY!=='baseline' && source.id==='bergfreunde');
  const budgetRemaining=()=>Date.now()<deadline;
  const technicalPath:string[]=[]; const httpStatuses:number[]=[];
  let parseEmptyHttp200 = 0;
  let earlyBrowserTried = false;
  let browserAttempted = false;
  let directLlmTried = false;
  const coverage=(status:SourceCoverage['status'], note?:string):SourceCoverage=>({
    sourceId:source.id,name:source.name,status,discoveredUrls:discovered.length,parsedOffers:offers.length,
    elapsedMs:Date.now()-start,note,technicalPath:[...new Set(technicalPath)],httpStatuses:[...new Set(httpStatuses)]
  });
  const browserFallback = async (urls:string[], blocked=false) => {
    if(browserAttempted){technicalPath.push('browser-already-attempted');return false;}
    browserAttempted=true;
    technicalPath.push('browser-fallback',`browser-mode-${browserFallbackMode()}`);
    const before=offers.length;
    for(const url of [...new Set(urls)].filter(url=>safeShopUrl(source,url)).slice(0,BROWSER_FALLBACK_URL_LIMIT)){
      if(!budgetRemaining()) { technicalPath.push('source-budget-exhausted'); break; }
      if(!await allowedByRobots(source,url,deadline)){technicalPath.push('robots-denied');continue}
      const result=await browserExtract(source,url,{blocked,deadline});
      if(result.httpStatus) httpStatuses.push(result.httpStatus);
      if(result.mode!=='none') technicalPath.push(`browser-${result.mode}`);
      for(const step of result.steps || []) technicalPath.push(`browser-${step}`);
      if(result.elapsedMs != null) technicalPath.push(`browser-elapsed-${Math.round(result.elapsedMs/1000)}s`);
      if(result.offers.length){
        offers.push(...result.offers);
        technicalPath.push('browser-success');
      } else {
        technicalPath.push('browser-empty');
      }
      if(result.steps?.includes('provider-rate-limited')) {
        technicalPath.push('browser-provider-rate-limited');
        break;
      }
      if(result.steps?.includes('browser-daily-limit-exhausted')) {
        technicalPath.push('browser-daily-limit-exhausted');
        break;
      }
      if(result.steps?.includes('provider-auth-rejected') || result.steps?.includes('provider-auth-circuit-open')){
        technicalPath.push('browser-provider-auth-rejected');
        break;
      }
      if(offers.length>before) break;
    }
    return offers.length>before;
  };

  try{
    const shopify=SHOPIFY_SOURCES[source.id];
    if(shopify){
      technicalPath.push('shopify-json');
      try{
        const result=await ingestShopify(source,shopify,deadline);
        httpStatuses.push(...result.statuses);
        discovered=shopify.collections.map(handle=>`${shopify.origin}/collections/${handle}`);
        if(result.offers.length){
          offers.push(...result.offers);
          technicalPath.push('shopify-json-success');
          return {offers,coverage:coverage('success','Shopify collection JSON (compare-at price, available sizes)')};
        }
        technicalPath.push('shopify-json-empty');
      }catch{ technicalPath.push('shopify-json-error'); }
    }

    const commerce=COMMERCE_SOURCES[source.id];
    if(commerce){
      technicalPath.push(`${commerce.type}-api`);
      try{
        const result=await ingestCommerceApi(source,commerce,deadline);
        httpStatuses.push(...result.statuses);
        discovered=[`${commerce.origin} (${commerce.type} API)`];
        if(result.offers.length){
          offers.push(...result.offers);
          technicalPath.push(`${commerce.type}-api-success`);
          return {offers,coverage:coverage('success',`${commerce.type} storefront API (sale and regular price)`)};
        }
        technicalPath.push(`${commerce.type}-api-empty`);
      }catch{ technicalPath.push(`${commerce.type}-api-error`); }
    }

    if(source.id==='globetrotter'){
      technicalPath.push('official-affiliate-feed');
      try{
        const feedOffers=await ingestGlobetrotterOfficialFeed(source,deadline);
        offers.push(...feedOffers);
        discovered=['official-product-feed'];
        technicalPath.push('official-affiliate-feed-success');
        // This feed has no UVP. Keep its products for coverage, and continue
        // discovering sources that can supply a real reference price.
        technicalPath.push('official-feed-no-reference-price');
      }catch(e:any){
        technicalPath.push('official-affiliate-feed-failed');
      }
    }

    const targeted=targetedListingUrls(source);
    if(targeted.length){
      technicalPath.push('targeted-brand-listings');
      discovered=[...targeted];
      const firstPass=expandedDiscovery ? (source.id==='bergfreunde'?3:1) : targeted.length;
      const queue=targeted.slice(0,firstPass);
      const later=targeted.slice(firstPass);
      const visited=new Set<string>();
      let extraPages=0;
      while(queue.length||later.length){
        const url=queue.shift()||later.shift()!;
        if(visited.has(url)) continue;
        visited.add(url);
        if(!budgetRemaining() || (expandedDiscovery && deadline-Date.now()<10000)) {
          technicalPath.push('source-budget-exhausted'); break;
        }
        if(!await allowedByRobots(source,url,deadline)){technicalPath.push('robots-denied');continue}
        try{
          technicalPath.push('listing-http-fetch');
          const r=await get(url,source,7000,deadline); httpStatuses.push(r.status);
          if(!r.ok) continue;
          const html=await r.text();
          const x=extractTargetedListing(html,source,url);
          if(x.length) technicalPath.push('listing-card-extraction');
          offers.push(...x);
          if(expandedDiscovery && x.length>=8 && extraPages<6){
            const next=nextListingPage(html,url);
            if(next && !visited.has(next) && !discovered.includes(next)){
              queue.push(next);discovered.push(next);extraPages++;
              technicalPath.push('listing-pagination-discovered');
            }
          }
        }catch{ technicalPath.push('listing-http-error'); }
      }
      const unique=[...new Map(offers.map(o=>[`${o.url.toLowerCase()}|${o.sizes.join('/')}|${o.price}|${o.rrp||''}`,o])).values()];
      offers.splice(0,offers.length,...unique);
      // Listing badges are useful price evidence but listings do not prove a
      // purchasable size. Validate a bounded number of strong discounts on the
      // product page and attach the badge only to the exact matching price.
      // Listings do not establish that size L is actually buyable. Inspect a
      // bounded, broader set of eligible detail pages rather than assuming a
      // listing card's generic size labels apply to its discounted variant.
      const discounted=offers.filter(o=>productEligible(o.name,o.description) && o.discountSource&&Number(o.observedDiscountPct)>=40)
        .sort((a,b)=>Number(b.observedDiscountPct)-Number(a.observedDiscountPct)).slice(0,8);
      const detailOffers:RawOffer[]=[];
      for(const candidate of discounted){
        if(!budgetRemaining()) {technicalPath.push('source-budget-exhausted');break;}
        if(!await allowedByRobots(source,candidate.url,deadline)){technicalPath.push('robots-denied');continue;}
        try{
          technicalPath.push('discount-product-detail-fetch');
          const response=await get(candidate.url,source,7000,deadline);httpStatuses.push(response.status);
          if(!response.ok) continue;
          const html=await response.text();
          const parsed=extractJsonLd(html,source,candidate.url);
          const variants=parsed.length?parsed:extractHtmlFallback(html,source,candidate.url);
          const samePrice=variants.filter(v=>Math.abs(Number(v.price)-Number(candidate.price))<0.011);
          detailOffers.push(...samePrice.map(v=>v.rrpSource?v:{...v,
            observedDiscountPct:candidate.observedDiscountPct,discountSource:'merchant:displayed-discount'}));
          if(samePrice.length) technicalPath.push('discount-detail-variant-validated');
        }catch{technicalPath.push('discount-product-detail-error');}
      }
      if(detailOffers.length){
        const detailedUrls=new Set(detailOffers.map(o=>o.url.toLowerCase()));
        offers.splice(0,offers.length,...offers.filter(o=>!detailedUrls.has(o.url.toLowerCase())),...detailOffers);
      }
      if(offers.some(o=>o.rrpSource || (o.discountSource&&Number(o.observedDiscountPct)>=40))){
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
      if(!await allowedByRobots(source,url,deadline)){technicalPath.push('robots-denied');continue}
      try{
        technicalPath.push('http-fetch');
        const r=await get(url,source,7000,deadline);
        httpStatuses.push(r.status);
        if(r.status===403||r.status===429){
          technicalPath.push(`http-${r.status}`);
          if(offers.some(o=>productEligible(o.name,o.description))){
            technicalPath.push('browser-skipped-existing-products');
            return {offers,coverage:coverage('partial','Direct or official feed already supplied relevant products')};
          }
          if(!browserFallbackConfigured()){
            technicalPath.push('browser-fallback-disabled');
            return {offers,coverage:coverage('blocked',`HTTP ${r.status}; Browserless token not configured`)};
          }
          const succeeded=await browserFallback([...browserStartUrls(source.id),url],true);
          return {offers,coverage:coverage(succeeded?'browser':'blocked',succeeded?'Browserless unblock/Playwright fallback succeeded':`HTTP ${r.status}; Browserless fallback returned no parseable product data`)};
        }
        if(!r.ok) continue;
        const html=await r.text();
        technicalPath.push('json-ld');
        let x=extractJsonLd(html,source,url);
        if(!x.length){
          technicalPath.push('html-fallback');
          x=extractHtmlFallback(html,source,url);
        }
        if(x.length) {
          technicalPath.push('parsed-product-data');
          offers.push(...x);
          continue;
        }

        if (!directLlmTried && LLM_DIRECT_SHADOW_SHOPS.has(source.id) && deadline-Date.now()>7000) {
          directLlmTried = true;
          // One bounded observation per shop; direct HTML is available even when Browserless is throttled.
          // Never promote these candidates into the crawl until their evidence has been reviewed.
          const extraction=await llmExtractFromHtml(source,url,html,{
            mode:'shadow',shops:[...LLM_DIRECT_SHADOW_SHOPS],timeoutMs:Math.min(9000,deadline-Date.now()-1000),
          });
          technicalPath.push(`llm-direct-shadow-${extraction.outcome}-candidates-${extraction.candidateCount}-offers-${extraction.observedOffers.length}`);
          if(extraction.httpStatus) technicalPath.push(`llm-direct-http-${extraction.httpStatus}`);
          if(extraction.apiErrorCode) technicalPath.push(`llm-direct-error-${extraction.apiErrorCode}`);
          if(extraction.attempted) console.info(JSON.stringify({event:'llm-direct-shadow',sourceId:source.id,
            outcome:extraction.outcome,candidates:extraction.candidateCount,offers:extraction.observedOffers.length,
            elapsedMs:extraction.elapsedMs,httpStatus:extraction.httpStatus,apiErrorCode:extraction.apiErrorCode}));
        }

        parseEmptyHttp200 += 1;
        const enoughBudgetForBrowser = deadline - Date.now() > 18000;
        if (!earlyBrowserTried && !offers.some(o=>productEligible(o.name,o.description)) && browserFallbackConfigured() && parseEmptyHttp200 >= EARLY_BROWSER_EMPTY_HTTP_THRESHOLD && enoughBudgetForBrowser) {
          earlyBrowserTried = true;
          technicalPath.push('browser-early-escalation');
          const succeeded = await browserFallback([...browserStartUrls(source.id), url], false);
          if (succeeded) {
            return { offers, coverage: coverage('browser', 'Early Browserless rendered-page/Playwright fallback succeeded after parse-empty HTTP pages') };
          }
          technicalPath.push('browser-early-empty');
        }
      }catch{
        technicalPath.push('http-error');
      }
    }
    if(!offers.some(o=>o.rrpSource || (o.discountSource&&Number(o.observedDiscountPct)>=40))){
      if(technicalPath.includes('robots-denied') && !httpStatuses.length)
        return {offers,coverage:coverage('blocked','Robots rules disallow these product pages')};
      if(!browserFallbackConfigured()){
        technicalPath.push('browser-fallback-disabled');
        return {offers,coverage:coverage(offers.length?'partial':'failed',offers.length?'Products parsed, but no verified reference price':'No parseable data; Browserless token not configured')};
      }
      if(offers.some(o=>productEligible(o.name,o.description))){
        // The nightly GitHub Actions browser has no per-session cost: when direct
        // pages found products but no price evidence, render the shop's configured
        // sale/outlet pages, which carry the struck-through prices.
        const startUrls=browserStartUrls(source.id);
        if(browserFallbackMode()==='local-playwright' && startUrls.length && !browserAttempted){
          technicalPath.push('browser-start-pages-for-evidence');
          const succeeded=await browserFallback(startUrls,false);
          return {offers,coverage:coverage(succeeded?'browser':'partial',succeeded?'Sale/outlet pages rendered for price evidence':'Relevant products parsed, but no verified reference price')};
        }
        technicalPath.push('browser-skipped-existing-products');
        return {offers,coverage:coverage('partial','Relevant products parsed; browser session reserved for empty or blocked shops')};
      }
      if(browserAttempted){
        technicalPath.push('browser-already-attempted');
        return {offers,coverage:coverage(offers.length?'partial':'failed','Browser fallback already attempted for this shop')};
      }
      const candidates=[...browserStartUrls(source.id),...(discovered.length && safeShopUrl(source,discovered[0]) ? discovered : [source.baseUrl])];
      const succeeded=await browserFallback(candidates,false);
      return {offers,coverage:coverage(succeeded?'browser':offers.length?'partial':'failed',succeeded?'Browserless rendered-page/Playwright fallback succeeded':offers.length?'Products parsed, but no verified reference price':'No parseable data after Browserless fallback')};
    }
    const status = discovered.length>1?'success':'partial';
    return {offers,coverage:coverage(status,'Direct crawl produced parseable product data')};
  } catch(e:any){
    technicalPath.push('fatal-error');
    return {offers,coverage:coverage('failed',String(e?.message||e))};
  }
}
