import test from 'node:test';
import assert from 'node:assert/strict';
import { browserFallbackConfig } from '../lib/browser-config.mjs';

test('browser fallback is disabled without endpoint or token', () => {
  const cfg = browserFallbackConfig({});
  assert.equal(cfg.configured, false);
  assert.equal(cfg.mode, 'disabled');
  assert.equal(cfg.usePlaywright, false);
});

test('Browserless Cloud token selects Amsterdam REST and Playwright endpoints', () => {
  const cfg = browserFallbackConfig({ BROWSERLESS_API_TOKEN: 'secret' });
  assert.equal(cfg.configured, true);
  assert.equal(cfg.mode, 'browserless-cloud');
  assert.equal(cfg.baseUrl, 'https://production-ams.browserless.io');
  assert.match(cfg.contentUrl, /\/content\?token=secret$/);
  assert.match(cfg.unblockUrl, /\/unblock\?token=secret$/);
  assert.match(cfg.playwrightUrl, /^wss:\/\/production-ams\.browserless\.io\?/);
  assert.match(cfg.playwrightUrl, /token=secret/);
  assert.match(cfg.playwrightUrl, /blockAds=true/);
  assert.match(cfg.stealthPlaywrightUrl, /^wss:\/\/production-ams\.browserless\.io\/stealth\?/);
  assert.equal(cfg.useUnblock, true);
  assert.equal(cfg.usePlaywright, true);
});

test('legacy content URL remains supported without Playwright', () => {
  const cfg = browserFallbackConfig({ BROWSERLESS_CONTENT_URL: 'https://example.test/content?token=x' });
  assert.equal(cfg.configured, true);
  assert.equal(cfg.mode, 'legacy-url');
  assert.equal(cfg.contentUrl, 'https://example.test/content?token=x');
  assert.equal(cfg.unblockUrl, null);
  assert.equal(cfg.playwrightUrl, null);
  assert.equal(cfg.usePlaywright, false);
});

test('unblock and Playwright can be disabled explicitly', () => {
  const cfg = browserFallbackConfig({
    BROWSERLESS_API_TOKEN: 'secret',
    BROWSERLESS_UNBLOCK: 'false',
    BROWSERLESS_PLAYWRIGHT: 'false',
  });
  assert.equal(cfg.useUnblock, false);
  assert.equal(cfg.usePlaywright, false);
});
