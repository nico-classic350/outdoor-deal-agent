import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require=createRequire(import.meta.url), ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(readFileSync(filename,'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const {extractTargetedListing,targetedListingUrls}=require('../lib/targeted.ts');
const {extractHtmlFallback,extractJsonLd}=require('../lib/extract.ts');
const {normalizeOffer,normalizeOfferChecked}=require('../lib/normalize.ts');

test('normalization diagnostics distinguish missing evidence from disallowed brands',async()=>{
  const base={sourceId:'shop',merchant:'Shop',merchantCountry:'DE',url:'https://shop.example/p',
    name:'Mammut Runbold Pants Men',currency:'EUR',price:70};
  assert.equal((await normalizeOfferChecked({...base,name:'Unknown Pants Men'})).reason,'brand-not-allowed');
  assert.equal((await normalizeOfferChecked({...base,price:undefined})).reason,'price-missing');
  assert.equal((await normalizeOfferChecked({...base,currency:undefined})).reason,'currency-missing');
  assert.equal((await normalizeOfferChecked(base)).reason,'discount-unverified');
});

test('Mammut product card is discovered without doubling screen reader price',()=>{
  const html=`<article data-e2e-test="product-card-container"><a href="/de/de/products/1022-02580/runbold-iv-pants-men">
    <div data-e2e-test="product-card-info-name-section">Runbold IV Pants Men</div></a>
    <div class="product-price"><span aria-hidden="true">€120</span><span class="visuallyHidden">€120</span></div></article>`;
  const source={id:'mammut-eu',name:'Mammut EU',country:'DE',baseUrl:'https://www.mammut.com'};
  const offers=extractTargetedListing(html,source,'https://www.mammut.com/de/de/category/5834-10/wanderhosen');
  assert.equal(offers.length,1);assert.equal(offers[0].price,120);assert.equal(offers[0].rrp,undefined);
  assert.equal(offers[0].brand,'Mammut');
});

test('Lundhags listing discovers the brand and records only an explicit discount badge',()=>{
  const html=`<article class="product-card"><a href="/lundhags-hoforsst-softshell-pants-light/">Lundhags Hoforsst Softshell Pants Light</a>
    <span class="discount-badge">−60%</span><span class="price">67,98 €</span></article>`;
  const offers=extractTargetedListing(html,{id:'bergfreunde',name:'Bergfreunde',country:'DE'},'https://www.bergfreunde.de/outlet/');
  assert.equal(offers.length,1);
  assert.equal(offers[0].brand,'Lundhags');
  assert.equal(offers[0].observedDiscountPct,60);
  assert.equal(offers[0].rrp,undefined);
});

test('Bergzeit paired old/current price qualifies without inventing a size',async()=>{
  const product='https://www.bergzeit.de/p/runbold/123456/';
  const html=`<script type="application/ld+json">{"itemListElement":[{"url":"${product}"}]}</script>
    <script>elementsList:[{"data":{"productId":"123456","brand":{"name":"Mammut"},"name":"Runbold Pants Men","price":{"current":"60,00 €","old":"120,00 €"}}}]</script>`;
  const offers=extractTargetedListing(html,{id:'bergzeit',name:'Bergzeit',country:'DE'},
    'https://www.bergzeit.de/herren/bekleidung/hosen/');
  assert.equal(offers.length,1);
  assert.equal(offers[0].rrpSource,'merchant:listing-old-price');
  assert.deepEqual(offers[0].sizes,[]);
  const normalized=await normalizeOffer(offers[0]);
  assert.equal(normalized?.sizeFit,'unconfirmed');
  assert.ok(normalized?.rrpVerified);
});

test('men’s sale discovery includes broad outdoor and softshell categories before brand pages',()=>{
  const urls=targetedListingUrls({id:'bergfreunde',baseUrl:'https://www.bergfreunde.de'});
  assert.deepEqual(urls.slice(0,3),[
    'https://www.bergfreunde.de/outlet/outdoor-hosen/fuer--maenner/',
    'https://www.bergfreunde.de/outlet/softshellhosen/fuer--maenner/',
    'https://www.bergfreunde.de/outlet/trekkinghosen/fuer--maenner/',
  ]);
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

test('variant-specific L in stock and an explicit merchant discount are extracted',()=>{
  const product={'@type':'Product',name:'Hoforsst Softshell Pants Light',brand:'Lundhags',
    offers:{'@type':'Offer',price:67.98,priceCurrency:'EUR',size:'L Regular',availability:'https://schema.org/InStock'}};
  const html=`<span class="discount-badge">−60%</span><script type="application/ld+json">${JSON.stringify(product)}</script>`;
  const offer=extractJsonLd(html,{id:'bergfreunde',name:'Bergfreunde',country:'DE'},'https://www.bergfreunde.de/pants')[0];
  assert.equal(offer.sizeAvailability,'available');
  assert.equal(offer.observedDiscountPct,60);
  assert.equal(offer.rrp,undefined);
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

test('available L variant can qualify using displayed discount with no RRP',async()=>{
  const offer=await normalizeOffer({sourceId:'bergfreunde',merchant:'Bergfreunde',merchantCountry:'DE',url:'https://www.bergfreunde.de/pants',
    brand:'Lundhags',name:'Hoforsst Softshell Pants Light',currency:'EUR',price:67.98,shipping:0,sizes:['L Regular'],
    sizeAvailability:'available',observedDiscountPct:60,discountSource:'merchant:displayed-discount'});
  assert.equal(offer?.sizeFit,'confirmed');
  assert.equal(offer?.discountVerified,true);
  assert.equal(offer?.rrp,null);
});

test('shipping reduces an explicitly displayed merchant discount without inventing an RRP',async()=>{
  const offer=await normalizeOffer({sourceId:'bergfreunde',merchant:'Bergfreunde',merchantCountry:'DE',
    url:'https://www.bergfreunde.de/pants',brand:'Lundhags',name:'Hoforsst Softshell Pants Light',
    currency:'EUR',price:67.98,shipping:3.95,sizes:['L Regular'],sizeAvailability:'available',
    observedDiscountPct:60,discountSource:'merchant:displayed-discount'});
  assert.equal(offer?.rrp,null);
  assert.ok(offer && offer.effectiveDiscountPct < 60 && offer.effectiveDiscountPct > 55);
});

test('a long trekking trouser survives incidental mentions of shorts and waterproof pockets',async()=>{
  const offer=await normalizeOffer({sourceId:'bergfreunde',merchant:'Bergfreunde',merchantCountry:'DE',
    url:'https://www.bergfreunde.de/pants',brand:'Lundhags',name:'Herren Trekking Pants Light',
    description:'Leichte Trekkinghose mit wasserdichter Tasche; passende Shorts separat erhältlich',
    currency:'EUR',price:60,rrp:120,rrpSource:'merchant:reference-price',sizes:[]});
  assert.ok(offer);
  assert.equal(offer.sizeFit,'unconfirmed');
});

test('brands match without diacritics and removed labels are rejected',async()=>{
  const offer={sourceId:'bergfreunde',merchant:'Bergfreunde',merchantCountry:'DE',url:'https://www.bergfreunde.de/keb',
    name:'Keb Trousers M Wanderhose',currency:'EUR',price:99,shipping:0,sizes:['50'],
    observedDiscountPct:50,discountSource:'merchant:displayed-discount'};
  assert.equal((await normalizeOffer({...offer,brand:'Fjallraven'}))?.brand,'Fjällräven');
  assert.equal((await normalizeOffer({...offer,brand:undefined,name:'Haglofs Mid Standard Pant Herren Wanderhose'}))?.brand,'Haglöfs');
  assert.equal((await normalizeOfferChecked({...offer,brand:'Stoic'})).reason,'brand-not-allowed');
  assert.equal((await normalizeOfferChecked({...offer,brand:'Adidas Terrex'})).reason,'brand-not-allowed');
});
