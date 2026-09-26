import { RawOffer, ShopSource } from './types';
import { extractHtmlFallback, extractJsonLd } from './extract';
import { browserFallbackConfig } from './browser-config.mjs';

export type BrowserFallbackResult = {
  offers: RawOffer[];
  mode: 'content' | 'unblock' | 'playwright' | 'none';
  httpStatus?: number;
  elapsedMs?: number;
};

export function browserFallbackConfigured() {
  return browserFallbackConfig().configured;
}

export function browserFallbackMode() {
  return browserFallbackConfig().mode;
}

export function browserPlaywrightConfigured() {
  const cfg = browserFallbackConfig();
  return Boolean(cfg.configured && cfg.usePlaywright && cfg.playwrightUrl);
}

function parseRenderedHtml(source: ShopSource, url: string, html: string): RawOffer[] {
  const json = extractJsonLd(html, source, url);
  return json.length ? json : extractHtmlFallback(html, source, url);
}

async function contentRequest(source: ShopSource, url: string): Promise<BrowserFallbackResult> {
  const started = Date.now();
  const cfg = browserFallbackConfig();
  if (!cfg.contentUrl) return { offers: [], mode: 'none', elapsedMs: 0 };

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
  if (!response.ok) return { offers: [], mode: 'content', httpStatus: response.status, elapsedMs: Date.now() - started };
  const html = await response.text();
  return { offers: parseRenderedHtml(source, url, html), mode: 'content', httpStatus: response.status, elapsedMs: Date.now() - started };
}

async function unblockRequest(source: ShopSource, url: string): Promise<BrowserFallbackResult> {
  const started = Date.now();
  const cfg = browserFallbackConfig();
  if (!cfg.unblockUrl || !cfg.useUnblock) return { offers: [], mode: 'none', elapsedMs: 0 };

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
  if (!response.ok) return { offers: [], mode: 'unblock', httpStatus: response.status, elapsedMs: Date.now() - started };
  const payload = await response.json() as { content?: string | null };
  const html = payload?.content || '';
  return { offers: html ? parseRenderedHtml(source, url, html) : [], mode: 'unblock', httpStatus: response.status, elapsedMs: Date.now() - started };
}

async function playwrightRequest(source: ShopSource, url: string, blocked: boolean): Promise<BrowserFallbackResult> {
  const started = Date.now();
  const cfg = browserFallbackConfig();
  const endpoint = blocked ? cfg.stealthPlaywrightUrl : cfg.playwrightUrl;
  if (!cfg.usePlaywright || !endpoint) return { offers: [], mode: 'none', elapsedMs: 0 };

  let browser: import('playwright-core').Browser | null = null;
  let page: import('playwright-core').Page | null = null;
  try {
    const { chromium } = await import('playwright-core');
    browser = await chromium.connectOverCDP(endpoint, { timeout: 10000 });
    const context = browser.contexts()[0];
    if (!context) return { offers: [], mode: 'playwright', elapsedMs: Date.now() - started };
    page = context.pages()[0] || await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
    await page.waitForTimeout(700);
    await page.evaluate(async () => {
      for (const fraction of [0.35, 0.7, 1]) {
        window.scrollTo(0, Math.max(document.body.scrollHeight * fraction, window.innerHeight));
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    });
    const html = await page.content();
    return { offers: parseRenderedHtml(source, url, html), mode: 'playwright', httpStatus: 200, elapsedMs: Date.now() - started };
  } catch {
    return { offers: [], mode: 'playwright', elapsedMs: Date.now() - started };
  } finally {
    try { if (page) await page.close(); } catch {}
    try { if (browser) await browser.close(); } catch {}
  }
}

export async function browserExtract(
  source: ShopSource,
  url: string,
  options: { blocked?: boolean } = {},
): Promise<BrowserFallbackResult> {
  if (!browserFallbackConfigured()) return { offers: [], mode: 'none' };
  const blocked = Boolean(options.blocked);

  try {
    if (blocked) {
      const unblock = await unblockRequest(source, url);
      if (unblock.offers.length) return unblock;

      const playwright = await playwrightRequest(source, url, true);
      if (playwright.offers.length) return playwright;

      const content = await contentRequest(source, url);
      if (content.offers.length) return content;
      return playwright.mode !== 'none' ? playwright : unblock;
    }

    const content = await contentRequest(source, url);
    if (content.offers.length) return content;

    const playwright = await playwrightRequest(source, url, false);
    if (playwright.offers.length) return playwright;

    const unblock = await unblockRequest(source, url);
    if (unblock.offers.length) return unblock;
    return playwright.mode !== 'none' ? playwright : content;
  } catch {
    return { offers: [], mode: 'none' };
  }
}
