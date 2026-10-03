import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url), ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { detailCandidates, mergeDetail, enrichFromDetailPages } = require('../lib/detail-enrich.ts');
const { selectOffers } = await import('../lib/product-rules.mjs');

const source = { id: 'scandinavian-outdoor', name: 'Scandinavian Outdoor', country: 'DE', baseUrl: 'https://www.scandinavian-outdoor.de', priority: 2 };
const page = (offers) => `<html><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Fjällräven Keb Trousers M',
  brand: { name: 'Fjällräven' }, offers })}</script></html>`;
const offer = (extra = {}) => ({ sourceId: source.id, merchant: source.name, merchantCountry: 'DE', url: 'https://www.scandinavian-outdoor.de/keb',
  name: 'Fjällräven Keb Trousers M', brand: 'Fjällräven', currency: 'EUR', price: 120, sizes: [], ...extra });

test('product page adds the strikethrough reference and in-stock sizes at the listing price', () => {
  const o = offer();
  const html = page([
    { '@type': 'Offer', price: 120, priceCurrency: 'EUR', availability: 'https://schema.org/InStock', size: { name: '50' },
      priceSpecification: [{ '@type': 'UnitPriceSpecification', priceType: 'https://schema.org/StrikethroughPrice', price: 240 }] },
    { '@type': 'Offer', price: 120, priceCurrency: 'EUR', availability: 'https://schema.org/OutOfStock', size: '52' },
    { '@type': 'Offer', price: 180, priceCurrency: 'EUR', availability: 'https://schema.org/InStock', size: '54' },
  ]);
  const r = mergeDetail(o, html, source);
  assert.deepEqual(o.sizes, ['50']);
  assert.equal(o.sizeAvailability, 'available');
  assert.equal(o.rrp, 240);
  assert.equal(o.rrpSource, 'detail:offer.priceSpecification.strikethrough');
  assert.deepEqual(r, { sizes: true, evidence: true, soldOut: false });
});

test('a sold-out product page marks the offer sold out', () => {
  const o = offer();
  mergeDetail(o, page([{ '@type': 'Offer', price: 120, priceCurrency: 'EUR', availability: 'https://schema.org/OutOfStock', size: 'L' }]), source);
  assert.equal(o.availability, 'out_of_stock');
});

test('candidates are premium trousers, deals without sizes first, bounded', async () => {
  const deal = offer({ url: 'https://www.scandinavian-outdoor.de/a', observedDiscountPct: 50, discountSource: 'merchant:displayed-discount' });
  const plain = offer({ url: 'https://www.scandinavian-outdoor.de/b' });
  const other = offer({ url: 'https://www.scandinavian-outdoor.de/c', name: 'Noname Trekking Pants', brand: 'Noname' });
  assert.deepEqual(detailCandidates([plain, other, deal], 5).map(o => o.url), [deal.url, plain.url]);
  const seen = [];
  const stats = await enrichFromDetailPages(source, [plain, deal], async url => { seen.push(url); return null; }, Date.now() + 5000, 1);
  assert.equal(seen.length, 1);
  assert.equal(stats.fetched, 0);
});

test('"bis" badges qualify only with a confirmed or probable size', () => {
  const base = { sourceId: 's', url: 'https://x/1', brand: 'Bergans', name: 'Bergans Rabot Pants', currency: 'EUR', price: 70,
    discountVerified: true, rrpVerified: false, discountSource: 'merchant:displayed-discount-upto', observedDiscountPct: 50,
    effectiveDiscountPct: 50, productFitScore: 80, score: 80, effectiveCostEur: 70, shippingKnown: true };
  const unchecked = selectOffers([{ ...base, sizeFit: 'unconfirmed' }]);
  assert.equal(unchecked.deals.length, 0);
  assert.match(unchecked.near[0].reason, /bis/);
  assert.equal(selectOffers([{ ...base, sizeFit: 'confirmed' }]).deals.length, 1);
});

test('implausible discounts above 85 % are near misses', () => {
  const base = { sourceId: 's', url: 'https://x/2', brand: 'Haglöfs', name: 'Haglöfs Mid Slim Pant', currency: 'EUR', price: 110,
    discountVerified: true, rrpVerified: false, discountSource: 'merchant:displayed-discount', observedDiscountPct: 98,
    effectiveDiscountPct: 98, productFitScore: 80, score: 90, effectiveCostEur: 110, shippingKnown: true, sizeFit: 'unconfirmed' };
  const result = selectOffers([base]);
  assert.equal(result.deals.length, 0);
  assert.match(result.near[0].reason, /85/);
});
