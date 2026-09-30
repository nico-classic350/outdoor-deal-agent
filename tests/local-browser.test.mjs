import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { browserFallbackConfig, localBrowserRuntime } from '../lib/browser-config.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  }).outputText, filename);
};

test('local Chromium runtime is opt-in and never active on Vercel', () => {
  assert.equal(localBrowserRuntime({}), false);
  assert.equal(localBrowserRuntime({ BROWSER_RUNTIME: 'local' }), true);
  assert.equal(localBrowserRuntime({ BROWSER_RUNTIME: 'local', VERCEL: '1' }), false);
  const cfg = browserFallbackConfig({ BROWSER_RUNTIME: 'local', BROWSERLESS_API_TOKEN: 'ignored' });
  assert.equal(cfg.mode, 'local-playwright');
  assert.equal(cfg.contentUrl, null);
  assert.equal(cfg.useUnblock, false);
  assert.equal(browserFallbackConfig({ BROWSER_RUNTIME: 'local', VERCEL: '1' }).mode, 'disabled');
});

test('snapshot merge adds only new same-shop offers and marks the source', () => {
  const { mergeSnapshot } = require('../lib/browser-snapshots.ts');
  const crawl = { offers: [{ sourceId: 'rab-eu', url: 'https://rab.example/a', price: 50 }],
    coverage: { sourceId: 'rab-eu', name: 'Rab', status: 'failed', discoveredUrls: 0, parsedOffers: 1, elapsedMs: 1, technicalPath: [] } };
  const snapshot = { shopId: 'rab-eu', collectedAt: new Date().toISOString(), coverage: {}, offers: [
    { sourceId: 'rab-eu', url: 'https://rab.example/a', price: 99 },
    { sourceId: 'rab-eu', url: 'https://rab.example/b', price: 60 },
    { sourceId: 'other', url: 'https://other.example/c', price: 10 },
  ] };
  const merged = mergeSnapshot(crawl, snapshot);
  assert.equal(merged.added, 1);
  assert.equal(merged.offers.length, 2);
  assert.equal(merged.offers[0].price, 50, 'direct observation wins on the same URL');
  assert.equal(merged.coverage.status, 'browser');
  assert.equal(merged.coverage.parsedOffers, 2);
  assert.ok(merged.coverage.technicalPath.includes('actions-browser-success'));
  assert.equal(mergeSnapshot(crawl, undefined).added, 0);
});

const chromium = process.env.CHROMIUM_EXECUTABLE_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
test('local Chromium renders JavaScript product cards', { skip: !existsSync(chromium) && 'no local Chromium binary' }, async () => {
  const page = `<!doctype html><html><body><main id="list"></main><script>
    setTimeout(() => { document.getElementById('list').innerHTML = [1,2].map(i =>
      '<article class="product-card"><a href="/p/hose-' + i + '"><h3>Rab Incline Pants Men ' + i + '</h3></a>' +
      '<span class="price">59,95 €</span> <span class="price">119,95 €</span></article>').join(''); }, 150);
  </script></body></html>`;
  const server = createServer((_, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/herren/hosen`;
  const saved = { ...process.env };
  process.env.BROWSER_RUNTIME = 'local';
  delete process.env.VERCEL;
  process.env.CHROMIUM_EXECUTABLE_PATH = chromium;
  const { browserExtract } = require('../lib/browser.ts');
  const { closeLocalBrowser } = require('../lib/local-browser.ts');
  try {
    const source = { id: 'rab-eu', name: 'Rab', country: 'DE', baseUrl: url, priority: 1 };
    const result = await browserExtract(source, url, { deadline: Date.now() + 30000 });
    assert.equal(result.mode, 'playwright');
    assert.ok(result.steps.includes('local-chromium'));
    assert.equal(result.offers.length, 2);
    assert.equal(result.offers[0].price, 59.95);
    assert.equal(result.renderedHtml, undefined, 'rendered HTML is not returned');
  } finally {
    await closeLocalBrowser();
    server.close();
    process.env = saved;
  }
});

test('local Chromium reads listing-item and Shopware cards with euro prefix prices', { skip: !existsSync(chromium) && 'no local Chromium binary' }, async () => {
  const page = `<!doctype html><html><body><main>
    <div itemprop="itemListElement" itemscope itemtype="http://schema.org/ListItem" id="product-card-1">
      <a href="/eu/mens-incline-pants"><img src="/a.jpg"><h3>Rab Incline AS Pants Men</h3></a>
      <span class="old">€130.00</span> <span class="price">€77.95</span></div>
    <div class="product--box box--minimal"><a class="product--title" href="/wanderhose-xxl">Maier Sports Nil Hose Herren</a>
      <span class="price--default">59,95 €</span> <span class="price--pseudo">UVP 99,95 €</span></div>
    <div itemscope itemtype="http://schema.org/ListItem"><a href="/eu/sale">Sale</a></div>
    <div class="product--box"><a href="/us-only">Trekking Pants</a><span>$ 49.99</span></div>
  </main></body></html>`;
  const server = createServer((_, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/eu/mens/pants`;
  const saved = { ...process.env };
  process.env.BROWSER_RUNTIME = 'local';
  delete process.env.VERCEL;
  process.env.CHROMIUM_EXECUTABLE_PATH = chromium;
  const { browserExtract } = require('../lib/browser.ts');
  const { closeLocalBrowser } = require('../lib/local-browser.ts');
  try {
    const source = { id: 'rab-eu', name: 'Rab', country: 'NL', baseUrl: url, priority: 1 };
    const result = await browserExtract(source, url, { deadline: Date.now() + 30000 });
    const byName = Object.fromEntries(result.offers.map(o => [o.name, o]));
    assert.equal(byName['Rab Incline AS Pants Men']?.price, 77.95);
    assert.equal(byName['Maier Sports Nil Hose Herren']?.price, 59.95);
    assert.ok(!result.offers.some(o => o.url.endsWith('/us-only')), 'non-euro prices are ignored');
  } finally {
    await closeLocalBrowser();
    server.close();
    process.env = saved;
  }
});

test('browser start URLs are same-shop listing pages', async () => {
  const { BROWSER_START_URLS } = require('../config/browser-cohort.ts');
  const { SHOPS } = require('../config/shops.ts');
  for (const [id, urls] of Object.entries(BROWSER_START_URLS)) {
    const shop = SHOPS.find(s => s.id === id);
    assert.ok(shop, `${id} exists`);
    for (const u of urls) assert.equal(new URL(u).hostname, new URL(shop.baseUrl).hostname, `${u} stays on ${id}`);
  }
});

test('outlet cards keep the struck-through price as reference-price evidence', () => {
  const { extractHtmlFallback } = require('../lib/extract.ts');
  const html = `<main><article id="product-1"><a href="/de-de/p/ascent-hose-1.html"><img src="/i.jpg"></a>
    <div>-45 %</div><h3>Odlo Ascent Light Wanderhose Herren</h3>
    <p class="flex font-bold"><span>60,45 €</span> <span class="line-through text-grey-40">109,95 €</span></p></article>
    <article id="product-2"><a href="/p/full.html"></a><h3>Odlo Brensholmen Hose</h3><p><span>89,95 €</span></p></article></main>`;
  const source = { id: 'odlo-eu', name: 'Odlo EU', country: 'DE', baseUrl: 'https://www.odlo.com', priority: 1 };
  const [discounted, full] = extractHtmlFallback(html, source, 'https://www.odlo.com/de-de/c/outlet/herren/hosen-tights');
  assert.equal(discounted.price, 60.45);
  assert.equal(discounted.rrp, 109.95);
  assert.equal(discounted.rrpSource, 'html:marked-reference-price');
  assert.equal(full.rrp, undefined);
});

test('single-brand store names are valid profile brands', () => {
  const { SHOP_BRAND, SHOPS } = require('../config/shops.ts');
  const { PROFILE } = require('../config/profile.ts');
  for (const [id, brand] of Object.entries(SHOP_BRAND)) {
    assert.ok(SHOPS.some(s => s.id === id), `${id} exists`);
    assert.ok(PROFILE.brands.includes(brand), `${brand} is a profile brand`);
  }
});
