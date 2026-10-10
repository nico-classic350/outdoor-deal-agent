import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url), ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { hideKey, hideLink, signHideKey, verifyHideKey, withoutHidden, fromB64 } = require('../lib/hidden-offers.ts');
const { renderRunEmail } = await import('../lib/email-template.ts');

const secret = 'test-secret';
const offer = (extra = {}) => ({ sourceId: 'bergfreunde', brand: 'Bergans', name: 'Bergans - Rabot Softshell Pants - Softshellhose - Black | 50 (EU)',
  color: 'Black', url: 'https://www.bergfreunde.de/bergans-rabot/?aid=1', merchant: 'Bergfreunde', effectiveCostEur: 85, priceEur: 85, rrpEur: 170,
  effectiveDiscountPct: 50, sizeFit: 'probable', sizes: ['50'], shippingKnown: true, shippingEur: 0, returnCostEur: 0, class: 'Strong Deal', score: 70, ...extra });

test('hide links are signed and only valid for their own model', () => {
  const key = hideKey(offer());
  const sig = signHideKey(key, secret);
  assert.ok(verifyHideKey(key, sig, secret));
  assert.equal(verifyHideKey('model|mammut|eiger pants', sig, secret), false);
  assert.equal(verifyHideKey(key, sig, 'other-secret'), false);
  assert.equal(verifyHideKey(key, '', secret), false);
  const link = new URL(hideLink(offer(), secret));
  assert.equal(link.origin + link.pathname, 'https://outdoor-deal-agent.vercel.app/api/hide');
  assert.equal(fromB64(link.searchParams.get('k')), key);
  assert.ok(verifyHideKey(fromB64(link.searchParams.get('k')), link.searchParams.get('s'), secret));
  assert.equal(hideLink(offer(), null), null, 'no link without a signing secret');
});

test('a hidden model disappears at every shop, other models stay', () => {
  const hidden = new Set([hideKey(offer())]);
  const sameModelElsewhere = offer({ sourceId: 'bergzeit', name: 'Rabot Softshell Pants', url: 'https://www.bergzeit.de/p/bergans-rabot/1/', color: undefined });
  const other = offer({ name: 'Bergans Breheimen Softshell Pants', url: 'https://www.bergfreunde.de/breheimen/' });
  assert.deepEqual(withoutHidden([offer(), sameModelElsewhere, other], hidden).map(o => o.name), ['Bergans Breheimen Softshell Pants']);
});

test('the mail carries a hide link for deals and near misses', () => {
  const report = { startedAt: 'a', finishedAt: 'b', plannedSources: 1, attemptedSources: 1, success: 1, partial: 0, browser: 0, blocked: 0, failed: 0,
    rawOffers: 1, normalizedOffers: 1, confirmedSizeOffers: 0, coverage: [] };
  const html = renderRunEmail('2026-10-10', [offer()], [offer({ name: 'Bergans Breheimen Pants' })], report, { hideLink: o => hideLink(o, secret) });
  assert.equal((html.match(/Nicht relevant – ausblenden/g) || []).length, 2);
  assert.match(html, /href="https:\/\/outdoor-deal-agent\.vercel\.app\/api\/hide\?k=/);
  assert.equal((renderRunEmail('2026-10-10', [offer()], [], report).match(/ausblenden/g) || []).length, 0);
});
