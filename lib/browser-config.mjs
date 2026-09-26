export function browserFallbackConfig(env = process.env) {
  const legacyUrl = env.BROWSERLESS_CONTENT_URL || '';
  if (legacyUrl) {
    return {
      configured: true,
      mode: 'legacy-url',
      baseUrl: null,
      contentUrl: legacyUrl,
      unblockUrl: null,
      useUnblock: false,
      proxy: null,
    };
  }

  const token = env.BROWSERLESS_API_TOKEN || env.BROWSERLESS_TOKEN || '';
  if (!token) {
    return {
      configured: false,
      mode: 'disabled',
      baseUrl: null,
      contentUrl: null,
      unblockUrl: null,
      useUnblock: false,
      proxy: null,
    };
  }

  const baseUrl = String(env.BROWSERLESS_BASE_URL || 'https://production-ams.browserless.io').replace(/\/+$/, '');
  const qs = new URLSearchParams({ token });
  const proxy = env.BROWSERLESS_PROXY || '';
  if (proxy) qs.set('proxy', proxy);

  return {
    configured: true,
    mode: 'browserless-cloud',
    baseUrl,
    contentUrl: `${baseUrl}/content?${qs.toString()}`,
    unblockUrl: `${baseUrl}/unblock?${qs.toString()}`,
    useUnblock: env.BROWSERLESS_UNBLOCK !== 'false',
    proxy: proxy || null,
  };
}
