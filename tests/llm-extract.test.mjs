import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const { readFileSync } = require('node:fs');
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  module._compile(outputText, filename);
};

const { llmExtractFromHtml } = require('../lib/llm-extract.ts');
const { browserExtract } = require('../lib/browser.ts');
const { crawlSource } = require('../lib/crawl.ts');
const shop = { id: 'mammut-eu', name: 'Mammut EU', country: 'DE', baseUrl: 'https://www.mammut.com' };
const pageUrl = 'https://www.mammut.com/de/de/category/trekking-pants';
const html = '<main><article><a href="/de/de/products/kento-pants-men">Mammut Kento Pants Men</a><p>Sale price € 54,70 · UVP € 119,95</p></article></main>';

function responseFor(offer) {
  return {
    ok: true,
    json: async () => ({ output_text: JSON.stringify({ offers: [offer] }) }),
  };
}

const validOffer = {
  url: 'https://www.mammut.com/de/de/products/kento-pants-men',
  name: 'Mammut Kento Pants Men',
  nameEvidence: 'Mammut Kento Pants Men',
  brand: 'Mammut',
  price: 54.7,
  priceCurrency: 'EUR',
  priceEvidence: 'Sale price € 54,70',
  rrp: 119.95,
  rrpCurrency: 'EUR',
  rrpEvidence: 'UVP € 119,95',
};

test('shadow mode reports evidence-validated offers but never passes them into the crawler', async () => {
  let request;
  const result = await llmExtractFromHtml(shop, pageUrl, html, {
    mode: 'shadow', apiKey: 'test-key', shops: ['mammut-eu'],
    fetcher: async (_url, options) => { request = JSON.parse(options.body); return responseFor(validOffer); },
  });

  assert.equal(request.model, 'gpt-6-luna');
  assert.equal(request.reasoning.effort, 'none');
  assert.equal(result.outcome, 'success');
  assert.equal(result.observedOffers.length, 1);
  assert.equal(result.offers.length, 0);
  assert.equal(result.observedOffers[0].price, 54.7);
  assert.equal(result.observedOffers[0].rrp, 119.95);
  assert.deepEqual(result.observedOffers[0].sizes, []);
  assert.equal(result.observedOffers[0].availability, 'unknown');
});

test('active mode still rejects off-shop URLs and prices without exact currency evidence', async () => {
  const offShop = { ...validOffer, url: 'https://example.org/deal' };
  const wrongPrice = { ...validOffer, price: 54.71 };
  const run = async (offer) => llmExtractFromHtml(shop, pageUrl, html, {
    mode: 'active', apiKey: 'test-key', shops: ['mammut-eu'],
    fetcher: async () => responseFor(offer),
  });

  assert.equal((await run(offShop)).offers.length, 0);
  assert.equal((await run(wrongPrice)).offers.length, 0);
});

test('disabled mode does not call the model', async () => {
  let called = false;
  const result = await llmExtractFromHtml(shop, pageUrl, html, {
    mode: 'off', apiKey: 'test-key', fetcher: async () => { called = true; throw new Error('unexpected request'); },
  });
  assert.equal(called, false);
  assert.equal(result.outcome, 'disabled');
});

test('Czech shop candidates preserve explicit CZK price evidence', async () => {
  const source={id:'4camping',name:'4camping',country:'CZ',baseUrl:'https://www.4camping.cz'};
  const url='https://www.4camping.cz/panske-kalhoty/odlo-pants';
  const page='<main><div class="catalog-entry"><a href="/panske-kalhoty/odlo-pants">Odlo Hiking Pants</a><span>Aktuálně 1 299 Kč · Původní cena 2 599 Kč</span></div></main>';
  const offer={url,name:'Odlo Hiking Pants',nameEvidence:'Odlo Hiking Pants',brand:'Odlo',
    price:1299,priceCurrency:'CZK',priceEvidence:'Aktuálně 1 299 Kč',rrp:null,rrpCurrency:null,rrpEvidence:null};
  const result=await llmExtractFromHtml(source,url,page,{mode:'shadow',shops:['4camping'],apiKey:'test-key',
    fetcher:async()=>responseFor(offer)});
  assert.equal(result.candidateCount,1);
  assert.equal(result.observedOffers[0].price,1299);
  assert.equal(result.observedOffers[0].currency,'CZK');
});

test('API failure records only bounded status and error code', async () => {
  const result=await llmExtractFromHtml(shop,pageUrl,html,{mode:'shadow',shops:['mammut-eu'],apiKey:'test-key',
    fetcher:async()=>({ok:false,status:400,json:async()=>({error:{type:'invalid_request_error',code:'model_not_found',message:'secret data'}})})});
  assert.equal(result.outcome,'api-error');
  assert.equal(result.httpStatus,400);
  assert.equal(result.apiErrorCode,'model_not_found');
  assert.equal(JSON.stringify(result).includes('secret data'),false);
});

test('a timed-out LLM request is identified without logging its input', async () => {
  const result=await llmExtractFromHtml(shop,pageUrl,html,{mode:'shadow',shops:['mammut-eu'],apiKey:'test-key',
    fetcher:async()=>{ const error=new Error('sensitive request details'); error.name='TimeoutError'; throw error; }});
  assert.equal(result.outcome,'api-error');
  assert.equal(result.apiErrorCode,'timeout');
  assert.equal(JSON.stringify(result).includes('sensitive request details'),false);
});

test('browser fallback runs the allowlisted LLM in shadow mode without publishing its offers', async () => {
  const keys = ['BROWSERLESS_API_TOKEN', 'BROWSERLESS_PLAYWRIGHT', 'LLM_EXTRACTION_MODE', 'LLM_EXTRACTION_SHOPS', 'OPENAI_API_KEY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  process.env.BROWSERLESS_API_TOKEN = 'browser-test';
  process.env.BROWSERLESS_PLAYWRIGHT = 'false';
  process.env.LLM_EXTRACTION_MODE = 'shadow';
  process.env.LLM_EXTRACTION_SHOPS = 'mammut-eu';
  process.env.OPENAI_API_KEY = 'llm-test';
  const sourceHtml = '<main><div class="catalog-entry"><a href="/de/de/products/kento-pants-men">Mammut Kento Pants Men</a><span>Sale price € 54,70 · UVP € 119,95</span></div></main>';
  let modelCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/content?')) return { ok: true, status: 200, text: async () => sourceHtml };
    if (String(url) === 'https://api.openai.com/v1/responses') {
      modelCalls += 1;
      return responseFor(validOffer);
    }
    throw new Error(`unexpected request: ${url}`);
  };

  try {
    const result = await browserExtract(shop, pageUrl, { deadline: Date.now() + 8000 });
    assert.equal(modelCalls, 1);
    assert.equal(result.offers.length, 0);
    assert.ok(result.steps.includes('llm-pilot-shadow-success-candidates-1-offers-1'));
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('direct 200 HTML can be observed by LLM without changing published offers', async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.OPENAI_API_KEY;
  const previousToken = process.env.BROWSERLESS_API_TOKEN;
  delete process.env.BROWSERLESS_API_TOKEN;
  process.env.OPENAI_API_KEY = 'test-key';
  const source = { id:'4camping', name:'4camping', country:'CZ', baseUrl:'https://www.4camping.cz' };
  const productUrl = 'https://www.4camping.cz/panske-kalhoty/odlo-pants';
  const listing = '<main><div class="catalog-entry"><a href="/panske-kalhoty/odlo-pants">Odlo Hiking Pants</a><span>Sale price € 54,70 · UVP € 119,95</span></div></main>';
  let modelCalls = 0;
  globalThis.fetch = async url => {
    const u = String(url);
    if (u.endsWith('/robots.txt')) return {ok:false,status:404};
    if (u.endsWith('/sitemap.xml')) return {ok:true,status:200,text:async()=>`<loc>${productUrl}</loc>`};
    if (u.endsWith('/sitemap_index.xml')) return {ok:false,status:404};
    if (u === productUrl) return {ok:true,status:200,text:async()=>listing};
    if (u === 'https://api.openai.com/v1/responses') {
      modelCalls++;
      return responseFor({...validOffer,url:productUrl,name:'Odlo Hiking Pants',nameEvidence:'Odlo Hiking Pants',brand:'Odlo'});
    }
    throw new Error(`unexpected request: ${u}`);
  };
  try {
    const result = await crawlSource(source);
    assert.equal(modelCalls,1);
    assert.ok(result.coverage.technicalPath.includes('llm-direct-shadow-success-candidates-1-offers-1'));
    assert.equal(result.offers.length,0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousToken === undefined) delete process.env.BROWSERLESS_API_TOKEN;
    else process.env.BROWSERLESS_API_TOKEN = previousToken;
  }
});
