import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require=createRequire(import.meta.url), ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(readFileSync(filename,'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const {extractTargetedListing}=require('../lib/targeted.ts');
const {extractHtmlFallback,extractJsonLd}=require('../lib/extract.ts');
const {normalizeOffer}=require('../lib/normalize.ts');

test('Mammut product card is discovered without doubling screen reader price',()=>{
  const html=`<article data-e2e-test="product-card-container"><a href="/de/de/products/1022-02580/runbold-iv-pants-men">
    <div data-e2e-test="product-card-info-name-section">Runbold IV Pants Men</div></a>
    <div class="product-price"><span aria-hidden="true">€120</span><span class="visuallyHidden">€120</span></div></article>`;
  const source={id:'mammut-eu',name:'Mammut EU',country:'DE',baseUrl:'https://www.mammut.com'};
  const offers=extractTargetedListing(html,source,'https://www.mammut.com/de/de/category/5834-10/wanderhosen');
  assert.equal(offers.length,1);assert.equal(offers[0].price,120);assert.equal(offers[0].rrp,undefined);
  assert.equal(offers[0].brand,'Mammut');
});

test('two incidental prices do not establish a reference price',()=>{
  const source={id:'test',name:'Test',country:'DE'};
  const html='<article><a href="/pants">Herren Trekkinghose</a><span>59,00 €</span><span>129,00 €</span></article>';
  const offer=extractHtmlFallback(html,source,'https://shop.example')[0];
  assert.equal(offer.rrp,undefined);
});

test('JSON-LD does not transfer a model-level reference across variants',()=>{
  const product={ '@type':'Product', name:'Herren Wanderhose',listPrice:200,
    offers:[{price:50,priceCurrency:'EUR',size:'W33 L32'},
      {price:60,priceCurrency:'EUR',size:'W34 L32',originalPrice:120}]};
  const html=`<script type="application/ld+json">${JSON.stringify(product)}</script>`;
  const offers=extractJsonLd(html,{id:'shop',name:'Shop',country:'DE'},'https://shop.example/p');
  assert.equal(offers.length,2);
  assert.equal(offers[0].rrp,undefined);
  assert.equal(offers[1].rrp,120);
});

test('Awin preserves each variant price and RRP as one observation',async()=>{
  const {ingestAwinProductFeed}=require('../lib/awin-feed.ts');
  const original=globalThis.fetch, old=process.env.AWIN_DATAFEED_API_KEY;
  process.env.AWIN_DATAFEED_API_KEY='test';
  const list='Advertiser ID,Advertiser Name,Membership Status,Feed ID,Feed Name,Language,Vertical,Last Imported,URL\n13759,engelhorn,Joined,1,engelhorn,German,Sport,2026-09-26,https://feed.example/data.csv\n';
  const csv='brand_name,product_name,merchant_category,gender,in_stock,search_price,rrp_price,delivery_cost,currency,size,size_stock_status,merchant_deep_link,parent_product_id,colour\n'
    +'Mammut,Runbold Pants Men,Men Pants,male,1,60,100,0,EUR,W33 L32,W33 L32:in_stock,https://merchant.example/p,model-1,black\n'
    +'Mammut,Runbold Pants Men,Men Pants,male,1,70,140,0,EUR,W34 L32,W34 L32:in_stock,https://merchant.example/p,model-1,black\n';
  globalThis.fetch=async url=>new Response(String(url).includes('/list/')?list:csv,{status:200});
  try{
    const result=await ingestAwinProductFeed({id:'engelhorn',name:'engelhorn',country:'DE'});
    assert.equal(result.offers.length,2);
    assert.deepEqual(result.offers.map(o=>[o.price,o.rrp]),[[60,100],[70,140]]);
    assert.ok(result.offers.every(o=>o.rrpSource==='awin:rrp_price'&&o.sizeAvailability==='available'));
  }finally{globalThis.fetch=original;if(old===undefined)delete process.env.AWIN_DATAFEED_API_KEY;else process.env.AWIN_DATAFEED_API_KEY=old}
});

test('unverified size and unknown shipping cannot become a confirmed deal',async()=>{
  const base={sourceId:'mammut-eu',merchant:'Mammut EU',merchantCountry:'DE',url:'https://www.mammut.com/p',
    brand:'Mammut',name:'Runbold Pants Men',currency:'EUR',price:50,rrp:120,rrpSource:'feed:rrp',sizes:['W33 L32']};
  const unknown=await normalizeOffer(base);
  assert.equal(unknown.sizeFit,'unconfirmed'); assert.equal(unknown.shippingKnown,false);
  const confirmed=await normalizeOffer({...base,shipping:0,sizeAvailability:'available'});
  assert.equal(confirmed.sizeFit,'confirmed');assert.equal(confirmed.rrpVerified,true);
  assert.equal(await normalizeOffer({...base,color:'white',shipping:0,sizeAvailability:'available'}),null);
  assert.equal(await normalizeOffer({...base,brand:undefined,name:'Grab Pants Men',shipping:0,sizeAvailability:'available'}),null);
});
