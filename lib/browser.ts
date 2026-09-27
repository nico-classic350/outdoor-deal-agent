import { RawOffer, ShopSource } from './types';
import { extractHtmlFallback, extractJsonLd } from './extract';
import { DEFAULT_LLM_EXTRACTION_MODEL, llmExtractFromHtml } from './llm-extract';
import { browserFallbackConfig } from './browser-config.mjs';
import pLimit from 'p-limit';

// A batch runs several shops concurrently. Keep its Browserless sessions serial
// so a single function invocation cannot consume several provider slots.
const browserSessionLimit = pLimit(1);

export type BrowserFallbackResult = {
  offers: RawOffer[];
  mode: 'content' | 'unblock' | 'playwright' | 'none';
  httpStatus?: number;
  elapsedMs?: number;
  steps?: string[];
  /** Internal-only snapshot used for one bounded LLM extraction attempt; stripped before returning. */
  renderedHtml?: string;
};

type UnblockSessionResult = {
  endpoint: string | null;
  httpStatus?: number;
  elapsedMs: number;
};

const PRODUCT_SELECTOR = [
  'article',
  '[itemtype*="Product"]',
  '[class*="product-card"]',
  '[class*="productCard"]',
  '[class*="product-tile"]',
  '[class*="productTile"]',
  '[class*="product-item"]',
  '[class*="productItem"]',
  '[data-testid*="product"]',
  '[data-product-id]',
  '[data-product-sku]',
].join(',');

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

function numberFromText(value: string): number | undefined {
  const cleaned = String(value || '').replace(/\s/g, '').replace(/[^0-9,.-]/g, '');
  if (!cleaned) return undefined;
  const normalized = cleaned.includes(',') && cleaned.includes('.')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned.replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function euroPrices(value: string): number[] {
  const result = [...String(value || '').matchAll(/(\d{1,4}(?:[.,]\d{2})?)\s*(?:€|EUR)/gi)]
    .map(match => numberFromText(match[1]))
    .filter((x): x is number => Boolean(x));
  return result;
}

function timeLeft(deadline: number, cap: number): number {
  return Math.max(0, Math.min(cap, deadline - Date.now()));
}

function requireTime(deadline: number, cap: number): number {
  const ms = timeLeft(deadline, cap);
  if (ms < 1000) throw new Error('browser-budget-exhausted');
  return ms;
}

function playwrightErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Never expose a CDP URL: it contains the Browserless token.
  if (/cannot find module|module not found|ERR_MODULE_NOT_FOUND/i.test(message)) return 'playwright-module-missing';
  if (/429|rate.limit|too many requests/i.test(message)) return 'playwright-provider-rate-limited';
  if (/401|403|unauthori[sz]ed|forbidden/i.test(message)) return 'playwright-provider-auth-error';
  if (/timeout|timed out/i.test(message)) return 'playwright-timeout';
  if (/ECONN|ENOTFOUND|EAI_AGAIN|websocket|socket|closed/i.test(message)) return 'playwright-connection-error';
  return 'playwright-error';
}

async function browserlessRequest(url: string, init: RequestInit, deadline: number) {
  let retried = false;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(requireTime(deadline, 18000)) });
    if (response.status !== 429 || attempt || timeLeft(deadline, 5000) < 3500) return { response, retried };
    // One bounded retry for temporary provider saturation. Never retry a shop's
    // 403, and never flood Browserless with repeated 429 requests.
    const seconds = Number(response.headers.get('retry-after'));
    const backoff = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 2500) : 1200;
    await response.body?.cancel().catch(() => {});
    await new Promise(resolve => setTimeout(resolve, backoff));
    retried = true;
  }
}

async function contentRequest(source: ShopSource, url: string, deadline: number): Promise<BrowserFallbackResult> {
  const started = Date.now();
  const cfg = browserFallbackConfig();
  if (!cfg.contentUrl) return { offers: [], mode: 'none', elapsedMs: 0, steps: ['content-disabled'] };

  try {
    const { response, retried } = await browserlessRequest(cfg.contentUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/html' },
      body: JSON.stringify({
        url,
        bestAttempt: true,
        waitForTimeout: 1000,
        gotoOptions: { waitUntil: 'domcontentloaded', timeout: 12000 },
        rejectResourceTypes: ['image', 'media', 'font'],
      }),
    }, deadline);
    if (!response.ok) {
      return {
        offers: [], mode: 'content', httpStatus: response.status,
        elapsedMs: Date.now() - started, steps: [...(retried ? ['provider-retry'] : []), `content-http-${response.status}`],
      };
    }
    const html = await response.text();
    return {
      offers: parseRenderedHtml(source, url, html), mode: 'content', httpStatus: response.status, renderedHtml: html,
      elapsedMs: Date.now() - started, steps: [...(retried ? ['provider-retry'] : []), 'content-rendered'],
    };
  } catch (error) {
    return { offers: [], mode: 'content', elapsedMs: Date.now() - started,
      steps: [error instanceof Error && error.message === 'browser-budget-exhausted' ? 'browser-budget-exhausted' : 'content-error'] };
  }
}

async function unblockContentRequest(source: ShopSource, url: string, deadline: number): Promise<BrowserFallbackResult> {
  const started = Date.now();
  const cfg = browserFallbackConfig();
  if (!cfg.unblockUrl || !cfg.useUnblock) return { offers: [], mode: 'none', elapsedMs: 0, steps: ['unblock-disabled'] };

  try {
    const { response, retried } = await browserlessRequest(cfg.unblockUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        url,
        content: true,
        cookies: false,
        screenshot: false,
        browserWSEndpoint: false,
      }),
    }, deadline);
    if (!response.ok) {
      return {
        offers: [], mode: 'unblock', httpStatus: response.status,
        elapsedMs: Date.now() - started, steps: [...(retried ? ['provider-retry'] : []), `unblock-content-http-${response.status}`],
      };
    }
    const payload = await response.json() as { content?: string | null };
    const html = payload?.content || '';
    return {
      offers: html ? parseRenderedHtml(source, url, html) : [], mode: 'unblock', httpStatus: response.status, renderedHtml: html || undefined,
      elapsedMs: Date.now() - started, steps: [...(retried ? ['provider-retry'] : []), 'unblock-content'],
    };
  } catch (error) {
    return { offers: [], mode: 'unblock', elapsedMs: Date.now() - started,
      steps: [error instanceof Error && error.message === 'browser-budget-exhausted' ? 'browser-budget-exhausted' : 'unblock-content-error'] };
  }
}

async function unblockSessionRequest(url: string, deadline: number): Promise<UnblockSessionResult> {
  const started = Date.now();
  const cfg = browserFallbackConfig();
  if (!cfg.unblockUrl || !cfg.useUnblock || !cfg.usePlaywright) {
    return { endpoint: null, elapsedMs: 0 };
  }

  try {
    const { response } = await browserlessRequest(cfg.unblockUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        url,
        content: false,
        cookies: true,
        screenshot: false,
        browserWSEndpoint: true,
        ttl: Math.min(30000, timeLeft(deadline, 30000)),
      }),
    }, deadline);
    if (!response.ok) return { endpoint: null, httpStatus: response.status, elapsedMs: Date.now() - started };
    const payload = await response.json() as { browserWSEndpoint?: string | null };
    return {
      endpoint: typeof payload?.browserWSEndpoint === 'string' ? payload.browserWSEndpoint : null,
      httpStatus: response.status,
      elapsedMs: Date.now() - started,
    };
  } catch {
    return { endpoint: null, elapsedMs: Date.now() - started };
  }
}

async function dismissConsent(page: import('playwright-core').Page) {
  const names = /^(alle akzeptieren|akzeptieren|zustimmen|accept all|accept|agree|allow all|tout accepter|accepter|accetta tutto|accetta|aceptar todo|aceptar)$/i;
  try {
    const button = page.getByRole('button', { name: names }).first();
    if (await button.count() && await button.isVisible()) await button.click({ timeout: 900 });
  } catch {}
}

async function stabilizeRenderedPage(page: import('playwright-core').Page, deadline: number) {
  await dismissConsent(page);
  if (timeLeft(deadline, 2500) > 1000) {
    try {
      await page.locator(PRODUCT_SELECTOR).first().waitFor({ state: 'attached', timeout: timeLeft(deadline, 2500) });
    } catch {}
  }

  for (const fraction of [0.35, 0.7, 1]) {
    if (timeLeft(deadline, 3000) < 2000) break;
    try {
      await page.evaluate((f) => {
        window.scrollTo(0, Math.max(document.body.scrollHeight * f, window.innerHeight));
      }, fraction);
      await page.waitForTimeout(250);
    } catch {}
  }

  const morePattern = /mehr laden|mehr anzeigen|weitere anzeigen|load more|show more|voir plus|afficher plus|carica altro|mostra altro|mostrar más|ver más/i;
  for (let i = 0; i < 2; i += 1) {
    if (timeLeft(deadline, 3000) < 2000) break;
    try {
      const control = page.locator('button, a').filter({ hasText: morePattern }).first();
      if (!(await control.count()) || !(await control.isVisible())) break;
      await control.click({ timeout: 1000 });
      await page.waitForTimeout(500);
    } catch { break; }
  }
}

async function extractRenderedDomOffers(
  page: import('playwright-core').Page,
  source: ShopSource,
  pageUrl: string,
): Promise<RawOffer[]> {
  try {
    const rows = await page.locator(PRODUCT_SELECTOR).evaluateAll((elements) => elements.slice(0, 120).map((element) => {
      const el = element as HTMLElement;
      const anchor = el.querySelector('a[href]') as HTMLAnchorElement | null;
      const nameEl = el.querySelector('[itemprop="name"], [data-testid*="name"], [data-testid*="title"], h2, h3, h4, [class*="title"], [class*="name"]') as HTMLElement | null;
      const brandEl = el.querySelector('[itemprop="brand"], [data-testid*="brand"], [class*="brand"]') as HTMLElement | null;
      const imageEl = el.querySelector('img') as HTMLImageElement | null;
      const priceEl = el.querySelector('[itemprop="price"], [data-price], [data-testid*="price"], [class*="price"]') as HTMLElement | null;
      const priceAttr = priceEl?.getAttribute('content') || priceEl?.getAttribute('data-price') || '';
      return {
        href: anchor?.href || '',
        name: (nameEl?.innerText || anchor?.innerText || '').trim(),
        brand: (brandEl?.innerText || '').trim(),
        image: imageEl?.currentSrc || imageEl?.src || imageEl?.getAttribute('data-src') || '',
        text: (el.innerText || '').trim(),
        priceText: `${priceAttr} ${priceEl?.innerText || ''}`.trim(),
      };
    }));

    const seen = new Set<string>();
    const out: RawOffer[] = [];
    for (const row of rows) {
      if (!row.href || !row.name || seen.has(row.href)) continue;
      const textPrices = euroPrices(`${row.priceText} ${row.text}`);
      const attrPrice = numberFromText(row.priceText);
      const prices = textPrices.length ? textPrices : (attrPrice ? [attrPrice] : []);
      if (!prices.length) continue;
      const price = Math.min(...prices);
      const rrp = prices.length > 1 ? Math.max(...prices) : undefined;
      seen.add(row.href);
      out.push({
        sourceId: source.id,
        merchant: source.name,
        merchantCountry: source.country,
        url: row.href,
        imageUrl: row.image || undefined,
        brand: row.brand || undefined,
        name: row.name,
        currency: 'EUR',
        price,
        rrp: rrp && rrp > price ? rrp : undefined,
        availability: /ausverkauft|sold out|out of stock|nicht verfügbar|épuisé|esaurito/i.test(row.text) ? 'out_of_stock' : 'unknown',
        description: row.text.slice(0, 800),
        sizes: [],
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function enrichSingleOfferSizes(page: import('playwright-core').Page, offers: RawOffer[]) {
  if (offers.length !== 1 || !/\/products?\/|\/artikel\/|\/p\//i.test(page.url())) return offers;
  try {
    const selectors = [
      '[data-testid*="size"] button', '[data-testid*="size"] label',
      'button[name*="size"]', '[class*="size"] button', '[class*="size"] label',
      'input[name*="size"] + label', 'select[name*="size"] option',
    ].join(',');
    const values = (await page.locator(selectors).evaluateAll(elements=>elements
      .filter(el=>!el.closest('[disabled],[aria-disabled="true"],[data-disabled="true"],[data-sold-out="true"],.disabled,.sold-out') &&
        !(el instanceof HTMLOptionElement && el.disabled) &&
        !(el instanceof HTMLLabelElement && el.htmlFor && (document.getElementById(el.htmlFor) as HTMLInputElement|null)?.disabled))
      .map(el=>(el.textContent||'').trim())))
      .map(v => v.replace(/\s+/g, ' ').trim())
      .filter(v => /^(?:W?\d{2}(?:\s*\/\s*L?\d{2})?|(?:EU\s*)?\d{2}|XS|S|M|L|XL|XXL)$/i.test(v));
    const unique = [...new Set(values)].slice(0, 30);
    if (unique.length) { offers[0].sizes = unique; offers[0].sizeAvailability='available'; }
  } catch {}
  return offers;
}

async function playwrightFromEndpoint(
  source: ShopSource,
  url: string,
  endpoint: string,
  options: { navigate: boolean; steps: string[]; deadline: number },
): Promise<BrowserFallbackResult> {
  const started = Date.now();
  let browser: import('playwright-core').Browser | null = null;
  let page: import('playwright-core').Page | null = null;
  let phase = 'module-load';
  try {
    const { chromium } = await import('playwright-core');
    phase = 'cdp-connect';
    browser = await chromium.connectOverCDP(endpoint, { timeout: requireTime(options.deadline, 10000) });
    phase = 'context';
    const context = browser.contexts()[0];
    if (!context) return { offers: [], mode: 'playwright', elapsedMs: Date.now() - started, steps: [...options.steps, 'no-context'] };
    page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(timeLeft(options.deadline, 2500));
    phase = 'navigation';
    if (options.navigate || page.url() === 'about:blank') {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: requireTime(options.deadline, 12000) });
    }
    requireTime(options.deadline, 2500);
    phase = 'extraction';
    await stabilizeRenderedPage(page, options.deadline);
    requireTime(options.deadline, 2500);
    const html = await page.content();
    let offers = parseRenderedHtml(source, url, html);
    if (!offers.length) offers = await extractRenderedDomOffers(page, source, url);
    offers = await enrichSingleOfferSizes(page, offers);
    return {
      offers,
      mode: 'playwright',
      httpStatus: 200,
      renderedHtml: html,
      elapsedMs: Date.now() - started,
      steps: [...options.steps, offers.length ? 'playwright-extracted' : 'playwright-empty'],
    };
  } catch (error) {
    const code = error instanceof Error && error.message === 'browser-budget-exhausted' ? 'browser-budget-exhausted' : playwrightErrorCode(error);
    console.info(JSON.stringify({ event: 'playwright-attempt', sourceId: source.id, phase, code, elapsedMs: Date.now() - started }));
    return { offers: [], mode: 'playwright', elapsedMs: Date.now() - started,
      steps: [...options.steps, `playwright-phase-${phase}`, code] };
  } finally {
    try { if (page) await page.close(); } catch {}
    try { if (browser) await browser.close(); } catch {}
  }
}

async function freshPlaywrightRequest(source: ShopSource, url: string, stealth: boolean, deadline: number): Promise<BrowserFallbackResult> {
  const cfg = browserFallbackConfig();
  const endpoint = stealth ? cfg.stealthPlaywrightUrl : cfg.playwrightUrl;
  if (!cfg.usePlaywright || !endpoint) return { offers: [], mode: 'none', elapsedMs: 0, steps: ['playwright-disabled'] };
  return playwrightFromEndpoint(source, url, endpoint, {
    navigate: true,
    deadline,
    steps: [stealth ? 'playwright-stealth' : 'playwright-standard'],
  });
}

async function unblockedPlaywrightRequest(source: ShopSource, url: string, deadline: number): Promise<BrowserFallbackResult> {
  const started = Date.now();
  const session = await unblockSessionRequest(url, deadline);
  if (!session.endpoint) {
    return {
      offers: [], mode: 'playwright', httpStatus: session.httpStatus,
      elapsedMs: Date.now() - started, steps: ['unblock-session-unavailable'],
    };
  }
  const result = await playwrightFromEndpoint(source, url, session.endpoint, {
    navigate: false,
    deadline,
    steps: ['unblock-session', 'playwright-session-handoff'],
  });
  result.elapsedMs = Date.now() - started;
  return result;
}

async function browserExtractOnce(
  source: ShopSource,
  url: string,
  options: { blocked?: boolean; deadline?: number } = {},
): Promise<BrowserFallbackResult> {
  if (!browserFallbackConfigured()) return { offers: [], mode: 'none', steps: ['browser-disabled'] };
  const started = Date.now();
  const deadline = Math.min(options.deadline ?? started + 45000, started + 45000);
  const blocked = Boolean(options.blocked);
  const attempts: BrowserFallbackResult[] = [];
  let llmSteps: string[] = [];
  const canTry = () => timeLeft(deadline, 30000) >= 1000;
  const record = (result: BrowserFallbackResult) => { attempts.push(result); return result.offers.length > 0; };
  const providerLimited = (result: BrowserFallbackResult) => result.httpStatus === 429 ||
    result.steps?.includes('playwright-provider-rate-limited');
  const done = (result: BrowserFallbackResult): BrowserFallbackResult => {
    const { renderedHtml: _renderedHtml, ...publicResult } = result;
    return {
      ...publicResult,
      elapsedMs: Date.now() - started,
      steps: attempts.flatMap(attempt => [
        ...(attempt.steps || []),
        `${attempt.mode}-elapsed-${Math.round((attempt.elapsedMs || 0) / 1000)}s`,
      ]).concat(attempts.includes(result) ? [] : result.steps || [], llmSteps, canTry() ? [] : ['browser-budget-exhausted']),
      httpStatus: result.httpStatus ?? [...attempts].reverse().find(attempt => attempt.httpStatus)?.httpStatus,
    };
  };

  const tryLlmFallback = async (): Promise<RawOffer[]> => {
    const snapshot = [...attempts].reverse().find(attempt => attempt.renderedHtml)?.renderedHtml;
    if (!snapshot || !canTry()) return [];
    const extraction = await llmExtractFromHtml(source, url, snapshot, { timeoutMs: Math.max(1000, Math.min(6000, timeLeft(deadline, 7000))) });
    if (extraction.attempted) {
      llmSteps.push(`llm-pilot-${extraction.mode}-${extraction.outcome}-candidates-${extraction.candidateCount}-offers-${extraction.observedOffers.length}`);
      if (extraction.httpStatus) llmSteps.push(`llm-pilot-http-${extraction.httpStatus}`);
      if (extraction.apiErrorCode) llmSteps.push(`llm-pilot-error-${extraction.apiErrorCode}`);
      // Keep production logs compact and reviewable; never log raw HTML or evidence text.
      console.info(JSON.stringify({
        event: 'llm-extraction-pilot', sourceId: source.id, mode: extraction.mode,
        outcome: extraction.outcome, model: process.env.LLM_EXTRACTION_MODEL || DEFAULT_LLM_EXTRACTION_MODEL,
        candidates: extraction.candidateCount, offers: extraction.observedOffers.map(offer => ({
          name: offer.name, brand: offer.brand, price: offer.price, currency: offer.currency, url: offer.url,
        })), elapsedMs: extraction.elapsedMs, httpStatus: extraction.httpStatus, apiErrorCode: extraction.apiErrorCode,
      }));
    } else if (extraction.mode !== 'off' && extraction.outcome !== 'shop-not-allowed') {
      llmSteps.push(`llm-pilot-${extraction.outcome}-candidates-${extraction.candidateCount}`);
    }
    return extraction.offers;
  };

  if (blocked) {
    const unblock = await unblockContentRequest(source, url, deadline);
    if (record(unblock)) return done(unblock);
    if (providerLimited(unblock)) return done({ ...unblock, steps: ['provider-rate-limited'] });

    if (canTry() && browserPlaywrightConfigured()) {
      const handoff = await unblockedPlaywrightRequest(source, url, deadline);
      if (record(handoff)) return done(handoff);
      if (providerLimited(handoff)) return done({ ...handoff, steps: ['provider-rate-limited'] });

      if (canTry()) {
        const stealth = await freshPlaywrightRequest(source, url, true, deadline);
        if (record(stealth)) return done(stealth);
        if (providerLimited(stealth)) return done({ ...stealth, steps: ['provider-rate-limited'] });
      }
    }

    if (canTry()) {
      const content = await contentRequest(source, url, deadline);
      if (record(content)) return done(content);
      if (providerLimited(content)) return done({ ...content, steps: ['provider-rate-limited'] });
    }
    const llmOffers = await tryLlmFallback();
    if (llmOffers.length) return done({ offers: llmOffers, mode: 'unblock', steps: ['llm-pilot-active-offers'] });
    return done({
      offers: [], mode: 'unblock', httpStatus: unblock.httpStatus,
      steps: ['blocked-exhausted'],
    });
  }

  const content = await contentRequest(source, url, deadline);
  if (record(content)) return done(content);
  if (providerLimited(content)) return done({ ...content, steps: ['provider-rate-limited'] });

  if (canTry() && browserPlaywrightConfigured()) {
    const playwright = await freshPlaywrightRequest(source, url, false, deadline);
    if (record(playwright)) return done(playwright);
    if (providerLimited(playwright)) return done({ ...playwright, steps: ['provider-rate-limited'] });
    const llmOffers = await tryLlmFallback();
    if (llmOffers.length) return done({ offers: llmOffers, mode: 'playwright', steps: ['llm-pilot-active-offers'] });
    return done(playwright);
  }

  const llmOffers = await tryLlmFallback();
  if (llmOffers.length) return done({ offers: llmOffers, mode: content.mode, httpStatus: content.httpStatus, steps: ['llm-pilot-active-offers'] });
  return done(content);
}

export async function browserExtract(
  source: ShopSource,
  url: string,
  options: { blocked?: boolean; deadline?: number } = {},
): Promise<BrowserFallbackResult> {
  return browserSessionLimit(() => browserExtractOnce(source, url, options));
}
