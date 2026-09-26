import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const { readFileSync } = require('node:fs');
  const source = readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  module._compile(outputText, filename);
};

const { browserExtract } = require('../lib/browser.ts');
const shop = { id: 'test-shop', name: 'Test Shop', country: 'DE', baseUrl: 'https://shop.example' };

test('blocked shop records unblock and content attempts before accepting a product', async () => {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.BROWSERLESS_API_TOKEN;
  const previousPlaywright = process.env.BROWSERLESS_PLAYWRIGHT;
  const requests = [];
  process.env.BROWSERLESS_API_TOKEN = 'test-token';
  process.env.BROWSERLESS_PLAYWRIGHT = 'false';
  globalThis.fetch = async (url) => {
    requests.push(new URL(url).pathname);
    if (url.includes('/unblock?')) {
      return { ok: true, status: 200, json: async () => ({ content: '' }) };
    }
    return { ok: true, status: 200, text: async () => '<script type="application/ld+json">{"@type":"Product","name":"Odlo Hiking Pants","offers":{"price":99,"priceCurrency":"EUR"}}</script>' };
  };
  try {
    const result = await browserExtract(shop, shop.baseUrl, { blocked: true, deadline: Date.now() + 5000 });
    assert.deepEqual(requests, ['/unblock', '/content']);
    assert.equal(result.mode, 'content');
    assert.equal(result.offers.length, 1);
    assert.ok(result.steps.includes('unblock-content'));
    assert.ok(result.steps.includes('content-rendered'));
    assert.ok(result.steps.some(step => step.startsWith('unblock-elapsed-')));
    assert.ok(result.elapsedMs >= 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.BROWSERLESS_API_TOKEN;
    else process.env.BROWSERLESS_API_TOKEN = previousToken;
    if (previousPlaywright === undefined) delete process.env.BROWSERLESS_PLAYWRIGHT;
    else process.env.BROWSERLESS_PLAYWRIGHT = previousPlaywright;
  }
});

test('expired source budget avoids Browserless requests', async () => {
  const previousToken = process.env.BROWSERLESS_API_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.BROWSERLESS_API_TOKEN = 'test-token';
  globalThis.fetch = async () => { throw new Error('unexpected network request'); };
  try {
    const result = await browserExtract(shop, shop.baseUrl, { deadline: Date.now() - 1 });
    assert.equal(result.offers.length, 0);
    assert.ok(result.steps.includes('browser-budget-exhausted'));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.BROWSERLESS_API_TOKEN;
    else process.env.BROWSERLESS_API_TOKEN = previousToken;
  }
});
