// Bounded, read-only test batch. No database writes, finalization or email.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const require=createRequire(import.meta.url);
const ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(readFileSync(filename,'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);

// The baseline deliberately excludes paid Browserless/LLM calls. It can run
// without either credential and cannot consume the production provider quota.
delete process.env.BROWSERLESS_API_TOKEN;
delete process.env.BROWSERLESS_TOKEN;
delete process.env.BROWSERLESS_CONTENT_URL;
delete process.env.OPENAI_API_KEY;
process.env.LLM_EXTRACTION_MODE='off';

const {SHOPS}=require('../config/shops.ts');
const {crawlSource}=require('../lib/crawl.ts');
const {normalizeOfferChecked}=require('../lib/normalize.ts');
const {productEligible}=require('../lib/product-rules.mjs');
const strategy=process.env.DISCOVERY_STRATEGY==='expanded'?'expanded':'baseline';
const cohort=['bergfreunde','bergzeit','4camping','mammut-eu'];
const results=[];
for(const id of cohort){
  const source=SHOPS.find(shop=>shop.id===id);
  if(!source)throw new Error(`missing source: ${id}`);
  const {offers,coverage}=await crawlSource(source);
  const checked=await Promise.allSettled(offers.map(normalizeOfferChecked));
  const reasons={};
  for(const result of checked){
    const reason=result.status==='rejected'?'conversion-error':result.value.reason;
    if(reason)reasons[reason]=(reasons[reason]||0)+1;
  }
  const record={sourceId:id,status:coverage.status,rawOffers:offers.length,
    uniqueProductUrls:new Set(offers.map(offer=>offer.url)).size,
    relevantOffers:offers.filter(offer=>offer.name&&productEligible(offer.name,offer.description)).length,
    priceEvidenceOffers:offers.filter(offer=>offer.name && productEligible(offer.name,offer.description) &&
      (Boolean(offer.rrp && offer.rrp>Number(offer.price) && offer.rrpSource) ||
        Boolean(offer.discountSource && Number.isFinite(offer.observedDiscountPct) && Number(offer.observedDiscountPct)>=40))).length,
    normalizedOffers:checked.filter(result=>result.status==='fulfilled'&&result.value.offer).length,
    reasons,httpStatuses:coverage.httpStatuses,technicalPath:coverage.technicalPath,elapsedMs:coverage.elapsedMs};
  results.push(record);
  console.log(`[benchmark] ${JSON.stringify(record)}`);
}
const summary={strategy:`${strategy}-direct-only`,cohort,results,totals:{
  rawOffers:results.reduce((n,x)=>n+x.rawOffers,0),
  uniqueProductUrls:results.reduce((n,x)=>n+x.uniqueProductUrls,0),
  relevantOffers:results.reduce((n,x)=>n+x.relevantOffers,0),
  priceEvidenceOffers:results.reduce((n,x)=>n+x.priceEvidenceOffers,0),
  normalizedOffers:results.reduce((n,x)=>n+x.normalizedOffers,0),
}};
const out=`observability/discovery-${strategy}.json`;
mkdirSync(dirname(out),{recursive:true});
writeFileSync(out,JSON.stringify(summary,null,2)+'\n');
console.log(`[benchmark-total] ${JSON.stringify(summary.totals)}`);
