import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const { readFileSync } = require('node:fs');
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  });
  module._compile(outputText, filename);
};
const { diagnoseCoverage } = require('../lib/diagnose.ts');

test('recovered 403/429 is not diagnosed as blocked when products were parsed', () => {
  assert.equal(diagnoseCoverage({ status: 'partial', httpStatuses: [403, 429, 200], parsedOffers: 235,
    eligibleOffers: 128, verifiedReferenceOffers: 0 }), 'no-reference-price');
});

test('unrecovered block remains a block', () => {
  assert.equal(diagnoseCoverage({ status: 'blocked', httpStatuses: [403], parsedOffers: 0 }), 'blocked');
});

test('a verified merchant discount is not misdiagnosed as a missing reference price', () => {
  assert.equal(diagnoseCoverage({ status: 'success', parsedOffers: 124, eligibleOffers: 75,
    pricedOffers: 45, verifiedReferenceOffers: 0, availableSizeOffers: 0 }), 'no-qualified-deal');
});

test('price evidence can exist even when a later selection rule rejects every product', () => {
  assert.equal(diagnoseCoverage({ status:'partial', parsedOffers: 10, eligibleOffers: 5,
    priceEvidenceOffers: 3, pricedOffers: 0 }), 'selection-filtered');
});
