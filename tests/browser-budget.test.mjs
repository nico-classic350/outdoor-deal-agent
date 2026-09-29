import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const { readFileSync } = require('node:fs');
  module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  }).outputText, filename);
};
const { dailyBrowserSessionLimit } = require('../lib/browser-budget.ts');

test('Browserless session admissions have a conservative, bounded daily default', () => {
  assert.equal(dailyBrowserSessionLimit({}), 24);
  assert.equal(dailyBrowserSessionLimit({ BROWSERLESS_DAILY_SESSION_LIMIT: '0' }), 0);
  assert.equal(dailyBrowserSessionLimit({ BROWSERLESS_DAILY_SESSION_LIMIT: '8' }), 8);
  assert.equal(dailyBrowserSessionLimit({ BROWSERLESS_DAILY_SESSION_LIMIT: '999' }), 120);
  assert.equal(dailyBrowserSessionLimit({ BROWSERLESS_DAILY_SESSION_LIMIT: 'invalid' }), 24);
});
