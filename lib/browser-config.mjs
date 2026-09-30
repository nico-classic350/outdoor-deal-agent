// Dashboard copy/paste commonly adds a trailing newline, spaces or wrapping
// quotes. Browserless compares the query token byte for byte, so such a value
// yields HTTP 401 on every endpoint. Normalize it and report only the fact.
export function normalizeBrowserlessToken(raw) {
  const original = String(raw || '');
  let token = original.trim();
  let issue = token !== original ? 'whitespace-trimmed' : null;
  const quoted = token.match(/^(['"])(.*)\1$/);
  if (quoted) { token = quoted[2].trim(); issue = 'quotes-removed'; }
  if (/\s/.test(token)) issue = 'contains-whitespace';
  return { token, issue };
}

// Local Chromium is only for the GitHub Actions browser crawler. It is never
// enabled on Vercel, where no browser binary is bundled.
export function localBrowserRuntime(env = process.env) {
  return env.BROWSER_RUNTIME === 'local' && !env.VERCEL;
}

export function browserFallbackConfig(env = process.env) {
  if (localBrowserRuntime(env)) {
    return {
      configured: true,
      mode: 'local-playwright',
      baseUrl: null,
      contentUrl: null,
      unblockUrl: null,
      playwrightUrl: null,
      stealthPlaywrightUrl: null,
      useUnblock: false,
      usePlaywright: true,
      proxy: null,
      tokenIssue: null,
    };
  }
  const { token, issue: tokenIssue } = normalizeBrowserlessToken(env.BROWSERLESS_API_TOKEN || env.BROWSERLESS_TOKEN || '');
  const legacyUrl = env.BROWSERLESS_CONTENT_URL || '';
  // An old content-only URL must not silently disable Playwright after a
  // current Cloud token has been configured in Vercel.
  if (legacyUrl && !token) {
    return {
      configured: true,
      mode: 'legacy-url',
      baseUrl: null,
      contentUrl: legacyUrl,
      unblockUrl: null,
      playwrightUrl: null,
      stealthPlaywrightUrl: null,
      useUnblock: false,
      usePlaywright: false,
      proxy: null,
      tokenIssue: null,
    };
  }

  if (!token) {
    return {
      configured: false,
      mode: 'disabled',
      baseUrl: null,
      contentUrl: null,
      unblockUrl: null,
      playwrightUrl: null,
      stealthPlaywrightUrl: null,
      useUnblock: false,
      usePlaywright: false,
      proxy: null,
      tokenIssue: null,
    };
  }

  const baseUrl = String(env.BROWSERLESS_BASE_URL || 'https://production-ams.browserless.io').replace(/\/+$/, '');
  const qs = new URLSearchParams({ token });
  const proxy = env.BROWSERLESS_PROXY || '';
  if (proxy) qs.set('proxy', proxy);
  const wsBase = baseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  const wsQs = new URLSearchParams(qs);
  wsQs.set('blockAds', 'true');
  wsQs.set('timeout', String(Math.max(10000, Math.min(30000, Number(env.BROWSERLESS_PLAYWRIGHT_TIMEOUT_MS || 20000)))));

  return {
    configured: true,
    mode: 'browserless-cloud',
    baseUrl,
    contentUrl: `${baseUrl}/content?${qs.toString()}`,
    unblockUrl: `${baseUrl}/unblock?${qs.toString()}`,
    playwrightUrl: `${wsBase}?${wsQs.toString()}`,
    stealthPlaywrightUrl: `${wsBase}/stealth?${wsQs.toString()}`,
    useUnblock: env.BROWSERLESS_UNBLOCK !== 'false',
    usePlaywright: env.BROWSERLESS_PLAYWRIGHT !== 'false',
    proxy: proxy || null,
    tokenIssue,
  };
}
