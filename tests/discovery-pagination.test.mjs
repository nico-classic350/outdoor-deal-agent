import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require=createRequire(import.meta.url), ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(readFileSync(filename,'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const {nextListingPage,extractTargetedListing}=require('../lib/targeted.ts');
const {crawlSource}=require('../lib/crawl.ts');
const {normalizeOfferChecked}=require('../lib/normalize.ts');

test('pagination follows only an explicit next page of the same listing',()=>{
  const url='https://www.bergfreunde.de/outlet/outdoor-hosen/fuer--maenner/';
  assert.equal(nextListingPage('<a rel="next" href="?page=2">Weiter</a>',url),`${url}?page=2`);
  assert.equal(nextListingPage('<nav><a href="/outlet/outdoor-hosen/fuer--maenner/2/">2</a></nav>',url),`${url}2/`);
  assert.equal(nextListingPage('<nav><a href="/outlet/outdoor-hosen/fuer--maenner/3/">3</a></nav>',`${url}2/`),`${url}3/`);
  assert.equal(nextListingPage('<nav><a href="?page=3">3</a></nav>',`${url}?page=2`),`${url}?page=3`);
  assert.equal(nextListingPage('<a rel="next" href="https://other.example/?page=2">Weiter</a>',url),null);
  assert.equal(nextListingPage('<a rel="next" href="/outlet/jacken/?page=2">Weiter</a>',url),null);
  assert.equal(nextListingPage('<a rel="next" href="?sort=popular">Weiter</a>',url),null);
});

test('Bergzeit prior price is evidence only when explicitly paired with current price',async()=>{
  const old=process.env.DISCOVERY_STRATEGY;
  const source={id:'bergzeit',name:'Bergzeit',country:'DE'};
  const html=`<script type="application/ld+json">{"itemListElement":[{"url":"https://www.bergzeit.de/p/runbold/123456/"}]}</script>
    <script>elementsList:[{"data":{"productId":"123456","brand":{"name":"Mammut"},"name":"Runbold Pants Men","price":{"current":"60,00 €","old":"120,00 €"}}}]</script>`;
  try{
    delete process.env.DISCOVERY_STRATEGY;
    const baseline=extractTargetedListing(html,source,'https://www.bergzeit.de/herren/bekleidung/hosen/');
    assert.equal((await normalizeOfferChecked(baseline[0])).reason,'discount-unverified');
    process.env.DISCOVERY_STRATEGY='expanded';
    const candidate=extractTargetedListing(html,source,'https://www.bergzeit.de/herren/bekleidung/hosen/');
    assert.equal(candidate[0].rrpSource,'merchant:listing-old-price');
    assert.ok((await normalizeOfferChecked(candidate[0])).offer);
  }finally{
    if(old===undefined)delete process.env.DISCOVERY_STRATEGY;
    else process.env.DISCOVERY_STRATEGY=old;
  }
});

test('expanded discovery adds unique relevant observations without changing baseline path',async()=>{
  const originalFetch=globalThis.fetch, old=process.env.DISCOVERY_STRATEGY;
  const base='https://www.bergfreunde.de/outlet/outdoor-hosen/fuer--maenner/';
  const page=(start,next)=>Array.from({length:8},(_,i)=>`<article class="product-card"><a href="/stoic-wanderhose-${start+i}/">Stoic Wanderhose Herren ${start+i}</a><span>69,95 €</span></article>`).join('')+
    (next?'<nav><a rel="next" href="/outlet/outdoor-hosen/fuer--maenner/2/">Weiter</a></nav>':'');
  globalThis.fetch=async url=>{
    const u=String(url);
    if(u.endsWith('/robots.txt')) return {ok:false,status:404};
    if(u===base) return {ok:true,status:200,text:async()=>page(1,true)};
    if(u===`${base}2/`) return {ok:true,status:200,text:async()=>page(9,false)};
    return {ok:false,status:404};
  };
  const source={id:'bergfreunde',name:'Bergfreunde',country:'DE',baseUrl:'https://www.bergfreunde.de'};
  try{
    delete process.env.DISCOVERY_STRATEGY;
    const baseline=await crawlSource(source);
    process.env.DISCOVERY_STRATEGY='expanded';
    const candidate=await crawlSource(source);
    assert.equal(baseline.offers.length,8);
    assert.equal(candidate.offers.length,16);
    assert.ok(candidate.coverage.technicalPath.includes('listing-pagination-discovered'));
    assert.ok(!baseline.coverage.technicalPath.includes('listing-pagination-discovered'));
  }finally{
    globalThis.fetch=originalFetch;
    if(old===undefined) delete process.env.DISCOVERY_STRATEGY;
    else process.env.DISCOVERY_STRATEGY=old;
  }
});

test('Bergzeit detail requires its own variant reference before replacing listing evidence',async()=>{
  const oldFetch=globalThis.fetch,oldStrategy=process.env.DISCOVERY_STRATEGY;
  const listing='https://www.bergzeit.de/herren/bekleidung/hosen/?filter.marke=Mammut';
  const product='https://www.bergzeit.de/p/runbold/123456/';
  const html=`<script type="application/ld+json">{"itemListElement":[{"url":"${product}"}]}</script>
    <script>elementsList:[{"data":{"productId":"123456","brand":{"name":"Mammut"},"name":"Runbold Pants Men","price":{"current":"60,00 €","old":"120,00 €"}}}]</script>`;
  const detail=`<script type="application/ld+json">{"@type":"Product","name":"Runbold Pants Men","brand":"Mammut",
    "offers":{"@type":"Offer","price":"60.00","priceCurrency":"EUR","size":"L","originalPrice":"120.00","availability":"https://schema.org/InStock"}}</script>`;
  const requested=[];
  globalThis.fetch=async url=>{
    const u=String(url);requested.push(u);
    if(u.endsWith('/robots.txt'))return {ok:false,status:404};
    if(u===listing)return {ok:true,status:200,text:async()=>html};
    if(u===product)return {ok:true,status:200,text:async()=>detail};
    return {ok:false,status:404};
  };
  process.env.DISCOVERY_STRATEGY='expanded';
  try{
    const result=await crawlSource({id:'bergzeit',name:'Bergzeit',country:'DE',baseUrl:'https://www.bergzeit.de'});
    const matching=result.offers.filter(offer=>offer.url===product);
    assert.ok(requested.includes(product));
    assert.ok(matching.some(offer=>offer.rrpSource==='offer.originalPrice'&&offer.sizes.includes('L')));
    assert.ok(matching.some(offer=>offer.sizeAvailability==='available'));
  }finally{
    globalThis.fetch=oldFetch;
    if(oldStrategy===undefined)delete process.env.DISCOVERY_STRATEGY;
    else process.env.DISCOVERY_STRATEGY=oldStrategy;
  }
});
