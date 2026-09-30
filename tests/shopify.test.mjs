import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url), ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { shopifyProductToOffer, ingestShopify } = require('../lib/shopify.ts');
const { normalizeOffer } = require('../lib/normalize.ts');

const source = { id: 'goldwin-eu', name: 'Goldwin Europe', country: 'DE', baseUrl: 'https://eu.goldwin.global', priority: 2 };
const cfg = { origin: 'https://eu.goldwin.global', collections: ['men-bottoms'], currency: 'EUR', brand: 'Goldwin' };
const product = {
  title: 'Pertex Shield Hiking Pants', handle: 'pertex-hiking-pants', vendor: '', product_type: 'Trekking Pants',
  options: [{ name: 'Color' }, { name: 'Size' }], images: [{ src: 'https://cdn.example/p.jpg' }],
  variants: [
    { option1: 'Black', option2: 'M', price: '159.00', compare_at_price: '320.00', available: true },
    { option1: 'Black', option2: 'L', price: '159.00', compare_at_price: '320.00', available: true },
    { option1: 'Black', option2: 'XL', price: '189.00', compare_at_price: '320.00', available: false },
  ],
};

test('a Shopify product becomes an offer with compare-at evidence and only available sizes', async () => {
  const offer = shopifyProductToOffer(product, cfg, source);
  assert.equal(offer.url, 'https://eu.goldwin.global/products/pertex-hiking-pants');
  assert.equal(offer.price, 159);
  assert.equal(offer.rrp, 320);
  assert.equal(offer.rrpSource, 'shopify:compare_at_price');
  assert.deepEqual(offer.sizes, ['M', 'L']);
  assert.equal(offer.brand, 'Goldwin');
  const normalized = await normalizeOffer(offer);
  assert.equal(normalized.sizeFit, 'confirmed');
  assert.equal(normalized.rrpVerified, true);
  assert.ok(normalized.effectiveDiscountPct > 40);
});

test('sold-out products and products without a lower price carry no evidence', () => {
  assert.equal(shopifyProductToOffer({ ...product, variants: product.variants.map(v => ({ ...v, available: false })) }, cfg, source), null);
  const full = shopifyProductToOffer({ ...product, variants: [{ option2: 'L', price: '200.00', compare_at_price: null, available: true }] }, cfg, source);
  assert.equal(full.rrp, undefined);
  assert.equal(full.rrpSource, undefined);
});

test('collection JSON is paged and de-duplicated', async () => {
  const calls = [];
  const fetcher = async url => { calls.push(url); return { ok: true, status: 200, json: async () => ({ products: [product, product] }) }; };
  const result = await ingestShopify(source, cfg, Date.now() + 10000, fetcher);
  assert.equal(result.offers.length, 1);
  assert.equal(calls.length, 1, 'fewer than 250 products ends paging');
  assert.match(calls[0], /\/collections\/men-bottoms\/products\.json\?limit=250&page=1$/);
});
