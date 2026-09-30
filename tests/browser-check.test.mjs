import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { browserFallbackConfig, normalizeBrowserlessToken } from '../lib/browser-config.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const { readFileSync } = require('node:fs');
  module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  }).outputText, filename);
};

test('pasted Browserless tokens are normalized before use and only the issue is reported', () => {
  assert.deepEqual(normalizeBrowserlessToken('abc123'), { token: 'abc123', issue: null });
  assert.deepEqual(normalizeBrowserlessToken('abc123\n'), { token: 'abc123', issue: 'whitespace-trimmed' });
  assert.deepEqual(normalizeBrowserlessToken(' "abc123" '), { token: 'abc123', issue: 'quotes-removed' });
  assert.equal(normalizeBrowserlessToken('abc 123').issue, 'contains-whitespace');
  const cfg = browserFallbackConfig({ BROWSERLESS_API_TOKEN: 'abc123\r\n' });
  assert.equal(new URL(cfg.contentUrl).searchParams.get('token'), 'abc123');
  assert.equal(new URL(cfg.playwrightUrl).searchParams.get('token'), 'abc123');
  assert.equal(cfg.tokenIssue, 'whitespace-trimmed');
  assert.equal(browserFallbackConfig({}).tokenIssue, null);
});

test('provider check classifies statuses and never needs the token in its result', async () => {
  const { classifyProviderStatus, tokenFingerprint, runBrowserCheck } = require('../lib/browser-check.ts');
  assert.equal(classifyProviderStatus(200), 'accepted');
  assert.equal(classifyProviderStatus(401), 'auth-rejected');
  assert.equal(classifyProviderStatus(403), 'auth-rejected');
  assert.equal(classifyProviderStatus(429), 'rate-limited');
  assert.equal(classifyProviderStatus(500), 'provider-error');
  const fp = tokenFingerprint('secret-token-value');
  assert.equal(fp.length, 12);
  assert.ok(!fp.includes('secret'));
  // Without a database the per-day cost cap cannot be enforced: no provider call.
  const saved = { ...process.env };
  delete process.env.DATABASE_URL;
  process.env.BROWSERLESS_API_TOKEN = 'x';
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('unexpected'); };
  try {
    assert.deepEqual(await runBrowserCheck(), { error: 'database-required-for-cost-cap' });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = saved;
  }
});
