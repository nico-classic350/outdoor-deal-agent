import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url), ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { wooProductToOffer, ingestWooCommerce, magentoItemToOffer, ingestMagento } = require('../lib/commerce-apis.ts');

const source = { id: 'shop', name: 'Shop', country: 'DE', baseUrl: 'https://shop.example', priority: 2 };

test('WooCommerce Store API prices use the minor unit and regular price as evidence', () => {
  const cfg = { type: 'woocommerce', origin: 'https://shop.example', queries: [{ on_sale: 'true' }] };
  const offer = wooProductToOffer({ name: 'Fjällräven Keb Trousers M', permalink: 'https://shop.example/keb', is_in_stock: true,
    prices: { price: '11995', regular_price: '23995', currency_code: 'EUR', currency_minor_unit: 2 },
    attributes: [{ name: 'Größe', terms: [{ name: '48' }, { name: '50' }] }] }, cfg, source);
  assert.equal(offer.price, 119.95);
  assert.equal(offer.rrp, 239.95);
  assert.equal(offer.rrpSource, 'woocommerce:regular_price');
  assert.deepEqual(offer.sizes, ['48', '50']);
  assert.equal(offer.sizeAvailability, undefined, 'attribute terms are not per-variant stock');
  assert.equal(wooProductToOffer({ name: 'X', permalink: 'https://shop.example/x', prices: { price: '1000', regular_price: '2000', currency_code: 'SEK' } }, cfg, source), null);
});

test('WooCommerce paging stops on a short page', async () => {
  const calls = [];
  const fetcher = async url => { calls.push(url); return { ok: true, status: 200, json: async () => [] }; };
  await ingestWooCommerce(source, { type: 'woocommerce', origin: 'https://shop.example', queries: [{ on_sale: 'true', search: 'hose' }] }, Date.now() + 10000, fetcher);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/wp-json\/wc\/store\/v1\/products\?per_page=100&page=1&on_sale=true&search=hose$/);
});

test('Magento GraphQL items use final vs regular price and in-stock size variants', async () => {
  const cfg = { type: 'magento', origin: 'https://shop.example', searches: ['pantaloni'] };
  const item = { name: 'Montura Vertigo Pants', url_key: 'montura-vertigo', url_suffix: '.html', stock_status: 'IN_STOCK',
    price_range: { minimum_price: { regular_price: { value: 200, currency: 'EUR' }, final_price: { value: 110, currency: 'EUR' } } },
    configurable_options: [{ attribute_code: 'taglia', label: 'Taglia', values: [{ label: 'M' }, { label: 'L' }] }],
    variants: [{ attributes: [{ code: 'taglia', label: 'M' }], product: { stock_status: 'OUT_OF_STOCK' } },
      { attributes: [{ code: 'taglia', label: 'L' }], product: { stock_status: 'IN_STOCK' } }] };
  const offer = magentoItemToOffer(item, cfg, source);
  assert.equal(offer.url, 'https://shop.example/montura-vertigo.html');
  assert.equal(offer.price, 110);
  assert.equal(offer.rrp, 200);
  assert.deepEqual(offer.sizes, ['L']);
  assert.equal(offer.sizeAvailability, 'available');
  let body;
  const fetcher = async (url, init) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ data: { products: { items: [item] } } }) }; };
  const result = await ingestMagento(source, cfg, Date.now() + 10000, fetcher);
  assert.equal(result.offers.length, 1);
  assert.equal(body.variables.search, 'pantaloni');
});
