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

const { browserExtract, authenticatedUnblockEndpoint } = require('../lib/browser.ts');
const shop = { id: 'test-shop', name: 'Test Shop', country: 'DE', baseUrl: 'https://shop.example' };

test('unblock session uses a credential only on the configured Browserless host', () => {
  const base = 'https://production-ams.browserless.io';
  const ws = authenticatedUnblockEndpoint('wss://production-ams.browserless.io/p/session/devtools/browser/id', base, 'secret');
  assert.equal(new URL(ws).searchParams.get('token'), 'secret');
  assert.equal(authenticatedUnblockEndpoint('wss://attacker.example/p/session', base, 'secret'), null);
  assert.equal(authenticatedUnblockEndpoint('wss://production-ams.browserless.io:444/p/session', base, 'secret'), null);
  assert.equal(authenticatedUnblockEndpoint('ws://production-ams.browserless.io/p/session', base, 'secret'), null);
});

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

test('provider 429 stops further Browserless escalation for this shop', async () => {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.BROWSERLESS_API_TOKEN;
  process.env.BROWSERLESS_API_TOKEN = 'test-token';
  const requests = [];
  globalThis.fetch = async url => {
    requests.push(new URL(url).pathname);
    return { ok: false, status: 429, headers: { get: () => null } };
  };
  try {
    const blocked = await browserExtract(shop, shop.baseUrl, { blocked: true, deadline: Date.now() + 5000 });
    const empty = await browserExtract(shop, shop.baseUrl, { deadline: Date.now() + 5000 });
    assert.deepEqual(requests, ['/unblock', '/unblock', '/content', '/content']);
    assert.equal(blocked.httpStatus, 429);
    assert.equal(empty.httpStatus, 429);
    assert.ok(blocked.steps.includes('provider-rate-limited'));
    assert.ok(empty.steps.includes('provider-rate-limited'));
    assert.ok(blocked.steps.includes('provider-retry'));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.BROWSERLESS_API_TOKEN;
    else process.env.BROWSERLESS_API_TOKEN = previousToken;
  }
});

test('one transient provider 429 can recover without starting Playwright', async () => {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.BROWSERLESS_API_TOKEN;
  process.env.BROWSERLESS_API_TOKEN = 'test-token';
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return requests === 1
      ? { ok: false, status: 429, headers: { get: () => '0.1' } }
      : { ok: true, status: 200, text: async () => '<script type="application/ld+json">{"@type":"Product","name":"Odlo Hiking Pants","offers":{"price":99,"priceCurrency":"EUR"}}</script>' };
  };
  try {
    const result = await browserExtract(shop, shop.baseUrl, { deadline: Date.now() + 6000 });
    assert.equal(requests, 2);
    assert.equal(result.offers.length, 1);
    assert.ok(result.steps.includes('provider-retry'));
    assert.ok(!result.steps.includes('provider-rate-limited'));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.BROWSERLESS_API_TOKEN;
    else process.env.BROWSERLESS_API_TOKEN = previousToken;
  }
});

test('provider 401 opens a credential-scoped circuit across shops',async()=>{
  const oldFetch=globalThis.fetch,oldToken=process.env.BROWSERLESS_API_TOKEN;
  process.env.BROWSERLESS_API_TOKEN='test-rejected-token-unique';
  let requests=0;
  globalThis.fetch=async()=>{requests++;return {ok:false,status:401,headers:{get:()=>null}}};
  try{
    const first=await browserExtract(shop,shop.baseUrl,{blocked:true,deadline:Date.now()+5000});
    const second=await browserExtract({...shop,id:'another-shop'},shop.baseUrl,{deadline:Date.now()+5000});
    assert.equal(requests,1);
    assert.ok(first.steps.includes('provider-auth-rejected'));
    assert.ok(second.steps.includes('provider-auth-circuit-open'));
  }finally{
    globalThis.fetch=oldFetch;
    if(oldToken===undefined)delete process.env.BROWSERLESS_API_TOKEN;
    else process.env.BROWSERLESS_API_TOKEN=oldToken;
  }
});
