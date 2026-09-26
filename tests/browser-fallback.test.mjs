import test from 'node:test';
import assert from 'node:assert/strict';
import { browserFallbackConfig } from '../lib/browser-config.mjs';

test('browser fallback is disabled without endpoint or token', () => {
  const cfg = browserFallbackConfig({});
  assert.equal(cfg.configured, false);
  assert.equal(cfg.mode, 'disabled');
});

test('Browserless Cloud token selects Amsterdam content and unblock endpoints', () => {
  const cfg = browserFallbackConfig({ BROWSERLESS_API_TOKEN: 'secret' });
  assert.equal(cfg.configured, true);
  assert.equal(cfg.mode, 'browserless-cloud');
  assert.equal(cfg.baseUrl, 'https://production-ams.browserless.io');
  assert.match(cfg.contentUrl, /\/content\?token=secret$/);
  assert.match(cfg.unblockUrl, /\/unblock\?token=secret$/);
});

test('legacy content URL remains supported', () => {
  const cfg = browserFallbackConfig({ BROWSERLESS_CONTENT_URL: 'https://example.test/content?token=x' });
  assert.equal(cfg.configured, true);
  assert.equal(cfg.mode, 'legacy-url');
  assert.equal(cfg.contentUrl, 'https://example.test/content?token=x');
  assert.equal(cfg.unblockUrl, null);
});
