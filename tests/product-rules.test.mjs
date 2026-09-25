import test from 'node:test';
import assert from 'node:assert/strict';
import { productEligible, sizeEvidence, selectOffers } from '../lib/product-rules.mjs';

test('rejects the warm cross-country tights and touring ski pants from the live run', () => {
  assert.equal(productEligible('Odlo Zeroweight Pro Windproof Warm Tights Langlaufhose'), false);
  assert.equal(productEligible('Herren Mercury DST Hose', 'Softshellhose für lange, klassische Skitouren'), false);
  assert.equal(productEligible('Herren Korp Lite Hose', 'Leicht elastische Hose für Trekkingtouren'), true);
  assert.equal(productEligible('Herren Outdoorhose', 'Leichte Wanderhose für Reisen'), true);
  assert.equal(productEligible('Damen Wanderhose'), false);
  assert.equal(productEligible('Herren Trekkinghose Zip-off'), false);
});

test('waist and inseam must be explicit and within the requested range', () => {
  assert.equal(sizeEvidence(['W33 L32']), 'confirmed');
  assert.equal(sizeEvidence(['34/30']), 'confirmed');
  assert.equal(sizeEvidence(['W33 L34']), 'unconfirmed');
  assert.equal(sizeEvidence(['33/34']), 'unconfirmed');
  assert.equal(sizeEvidence(['W32 L32']), 'unconfirmed');
  assert.equal(sizeEvidence(['33']), 'probable');
  assert.equal(sizeEvidence(['EU 50']), 'probable');
  assert.equal(sizeEvidence(['L']), 'unconfirmed');
  assert.equal(sizeEvidence([]), 'unconfirmed');
});

test('same product URL is one candidate despite card titles and tracking parameters', () => {
  const url = 'https://www.bergfreunde.de/odlo-zeroweight-pro-windproof-warm-tights-langlaufhose/';
  const base = { sourceId: 'bergfreunde', brand: 'Odlo', name: 'bis 60% Odlo Warm Tights', url, sizeFit: 'unconfirmed',
    class: 'Strong Deal', effectiveDiscountPct: 60, effectiveCostEur: 59.98, score: 57 };
  const { deals, near } = selectOffers([base, { ...base, name: 'entfernen loader vergleichen bis 60%', url: url + '?utm_source=test' }]);
  assert.equal(deals.length, 0);
  assert.equal(near.length, 1);
  assert.match(near[0].reason, /nicht bestätigt/);
});

test('a confirmed, correctly sized offer can qualify while an unknown size cannot', () => {
  const base = { sourceId: 'bergzeit', brand: 'Haglöfs', name: 'Herren Korp Lite Hose', url: 'https://www.bergzeit.de/p/korp/1/',
    sizeFit: 'unconfirmed', class: 'Strong Deal', effectiveDiscountPct: 54, effectiveCostEur: 54, score: 58 };
  assert.equal(selectOffers([base]).deals.length, 0);
  const confirmed = { ...base, sizeFit: 'confirmed', score: 75 };
  assert.deepEqual(selectOffers([base, confirmed]).deals, [confirmed]);
});
