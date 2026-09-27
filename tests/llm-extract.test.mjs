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

  assert.equal(request.model, 'gpt-5.6-luna');
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
