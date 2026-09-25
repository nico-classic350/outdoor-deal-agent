import test from 'node:test';
import assert from 'node:assert/strict';
import { productEligible, sizeEvidence, selectOffers, dealTier } from '../lib/product-rules.mjs';

test('rejects explicit product mismatches while allowing eligible outdoor trousers', () => {
  assert.equal(productEligible('Odlo Zeroweight Pro Windproof Warm Tights Langlaufhose'), false);
  assert.equal(productEligible('Herren Mercury DST Hose', 'Softshellhose für lange, klassische Skitouren'), false);
  assert.equal(productEligible('Herren Korp Lite Hose', 'Leicht elastische Hose für Trekkingtouren'), true);
  assert.equal(productEligible('Herren Outdoorhose', 'Leichte Wanderhose für Reisen'), true);
  assert.equal(productEligible('Damen Wanderhose'), false);
  assert.equal(productEligible('Herren Trekkinghose Zip-off'), false);
});

test('unknown size stays reviewable while explicit incompatible size is rejected', () => {
  assert.equal(sizeEvidence(['W33 L32']), 'confirmed');
  assert.equal(sizeEvidence(['34/30']), 'confirmed');
  assert.equal(sizeEvidence(['33']), 'probable');
  assert.equal(sizeEvidence(['EU 50']), 'probable');
  assert.equal(sizeEvidence(['L']), 'unconfirmed');
  assert.equal(sizeEvidence([]), 'unconfirmed');

  assert.equal(sizeEvidence(['S']), 'no');
  assert.equal(sizeEvidence(['XS','S']), 'no');
  assert.equal(sizeEvidence(['W32 L32']), 'no');
  assert.equal(sizeEvidence(['W33 L34']), 'no');
  assert.equal(sizeEvidence(['33/34']), 'no');

  assert.equal(sizeEvidence(['S','L']), 'unconfirmed');
  assert.equal(sizeEvidence(['W32 L32','L']), 'unconfirmed');
});

test('deal tier depends on discount and product fit, not whether size data is readable', () => {
  assert.equal(dealTier(58, 80), 'Top Deal');
  assert.equal(dealTier(58, 60), 'Strong Deal');
  assert.equal(dealTier(47, 55), 'Strong Deal');
  assert.equal(dealTier(42, 80), 'Good Deal');
  assert.equal(dealTier(42, 60), 'Near Miss');
});

test('same product URL is one candidate despite card titles and tracking parameters', () => {
  const url = 'https://www.bergfreunde.de/hagloefs-korp-lite-hose/';
  const base = { sourceId: 'bergfreunde', brand: 'Haglöfs', name: 'Herren Korp Lite Hose', url,
    sizeFit: 'unconfirmed', class: 'Near Miss', effectiveDiscountPct: 55, effectiveCostEur: 59.98,
    productFitScore: 80, score: 57 };
  const { deals, near } = selectOffers([base, { ...base, name: 'Herren Korp Lite Hose Sale', url: url + '?utm_source=test' }]);
  assert.equal(deals.length, 1);
  assert.equal(near.length, 0);
});

test('a strong deal can qualify with unknown size, but explicit incompatible size cannot', () => {
  const base = { sourceId: 'bergzeit', brand: 'Haglöfs', name: 'Herren Korp Lite Hose',
    url: 'https://www.bergzeit.de/p/korp/1/', sizeFit: 'unconfirmed', class: 'Near Miss',
    effectiveDiscountPct: 54, effectiveCostEur: 54, productFitScore: 65, score: 58 };
  assert.equal(selectOffers([base]).deals.length, 1);

  const explicitNo = { ...base, sizeFit: 'no', score: 30 };
  assert.equal(selectOffers([explicitNo]).deals.length, 0);
});
