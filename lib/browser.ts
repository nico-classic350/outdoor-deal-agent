import { RawOffer, ShopSource } from './types';
import { extractHtmlFallback, extractJsonLd } from './extract';
import { browserFallbackConfig } from './browser-config.mjs';

export type BrowserFallbackResult = {
  offers: RawOffer[];
  mode: 'content' | 'unblock' | 'none';
  httpStatus?: number;
};

export function browserFallbackConfigured() {
  return browserFallbackConfig().configured;
}

export function browserFallbackMode() {
  return browserFallbackConfig().mode;
}

function parseRenderedHtml(source: ShopSource, url: string, html: string): RawOffer[] {
  const json = extractJsonLd(html, source, url);
  return json.length ? json : extractHtmlFallback(html, source, url);
}

async function contentRequest(source: ShopSource, url: string): Promise<BrowserFallbackResult> {
  const cfg = browserFallbackConfig();
  if (!cfg.contentUrl) return { offers: [], mode: 'none' };

  const response = await fetch(cfg.contentUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/html' },
    body: JSON.stringify({
      url,
      bestAttempt: true,
      waitForTimeout: 800,
      gotoOptions: { waitUntil: 'domcontentloaded', timeout: 12000 },
      rejectResourceTypes: ['image', 'media', 'font'],
    }),
    signal: AbortSignal.timeout(18000),
  });
  if (!response.ok) return { offers: [], mode: 'content', httpStatus: response.status };
  const html = await response.text();
  return { offers: parseRenderedHtml(source, url, html), mode: 'content', httpStatus: response.status };
}

async function unblockRequest(source: ShopSource, url: string): Promise<BrowserFallbackResult> {
  const cfg = browserFallbackConfig();
  if (!cfg.unblockUrl || !cfg.useUnblock) return { offers: [], mode: 'none' };

  const response = await fetch(cfg.unblockUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      url,
      content: true,
      cookies: false,
      screenshot: false,
      browserWSEndpoint: false,
      bestAttempt: true,
      waitForTimeout: 800,
      gotoOptions: { waitUntil: 'domcontentloaded', timeout: 12000 },
    }),
    signal: AbortSignal.timeout(18000),
  });
  if (!response.ok) return { offers: [], mode: 'unblock', httpStatus: response.status };
  const payload = await response.json() as { content?: string | null };
  const html = payload?.content || '';
  return { offers: html ? parseRenderedHtml(source, url, html) : [], mode: 'unblock', httpStatus: response.status };
}

export async function browserExtract(
  source: ShopSource,
  url: string,
  options: { blocked?: boolean } = {},
): Promise<BrowserFallbackResult> {
  if (!browserFallbackConfigured()) return { offers: [], mode: 'none' };

  try {
    if (options.blocked) {
      const unblock = await unblockRequest(source, url);
      if (unblock.offers.length || unblock.httpStatus === 200) return unblock;
    }
    const content = await contentRequest(source, url);
    if (content.offers.length) return content;
    if (!options.blocked) {
      const unblock = await unblockRequest(source, url);
      if (unblock.offers.length) return unblock;
    }
    return content;
  } catch {
    return { offers: [], mode: 'none' };
  }
}
