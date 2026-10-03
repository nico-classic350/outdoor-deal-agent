import { RawOffer, ShopSource } from './types';
import { extractHtmlFallback, extractJsonLd, labelledReferencePrice } from './extract';
import { DEFAULT_LLM_EXTRACTION_MODEL, llmExtractFromHtml } from './llm-extract';
import { browserFallbackConfig } from './browser-config.mjs';
import { reserveBrowserSession } from './browser-budget';
import { newLocalContext } from './local-browser';
import { normalizeSizeLabel, productEligible } from './product-rules.mjs';
import { BROWSER_CARD_RULES, BrowserCardRule } from '../config/browser-cohort';
import pLimit from 'p-limit';

// A batch runs several shops concurrently. Keep its Browserless sessions serial
// so a single function invocation cannot consume several provider slots.
const browserSessionLimit = pLimit(1);
// Local Chromium on a GitHub runner has no per-session cost; bound memory use.
const localSessionLimit = pLimit(Math.max(1, Math.min(4, Number(process.env.LOCAL_BROWSER_CONCURRENCY || 3))));
// A rejected credential is shared by every shop in this function invocation.
// Do not turn one bad token into dozens of paid, doomed REST/CDP attempts.
let rejectedCredentialEndpoint: string | null = null;

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

export function authenticatedUnblockEndpoint(endpoint: string, baseUrl: string, token: string): string | null {
  try {
    const ws = new URL(endpoint);
    const expected = new URL(baseUrl);
    // Never attach a credential to a host supplied by a malformed response.
    if (ws.protocol !== 'wss:' || ws.host !== expected.host || !token) return null;
    ws.searchParams.set('token', token);
    return ws.toString();
  } catch { return null; }
}

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
  // Schema.org listing items (e.g. Rab/Hyvä) and Shopware 5 product boxes.
  '[itemtype*="ListItem"]',
  '[id^="product-card"]',
  '[class*="product--box"]',
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
  // "119,95 €" (German) or "€119.95" (English) notation. A page uses one of
  // them; mixing both patterns would pair a symbol with the wrong number.
  // Other currencies are ignored.
  const text = String(value || '');
  const after = [...text.matchAll(/(\d{1,4}(?:[.,]\d{2})?)\s*(?:€|EUR)/gi)].map(match => match[1]);
  const matches = after.length ? after : [...text.matchAll(/(?:€|EUR)\s*(\d{1,4}(?:[.,]\d{2})?)/gi)].map(match => match[1]);
  return matches
    .map(value => numberFromText(value))
    .filter((x): x is number => Boolean(x));
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
    const requestTimeout = requireTime(deadline, 18000);
    if (!await reserveBrowserSession()) throw new Error('browser-daily-limit-exhausted');
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(requestTimeout) });
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
      steps: [error instanceof Error && /^(browser-budget-exhausted|browser-daily-limit-exhausted)$/.test(error.message) ? error.message : 'content-error'] };
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
      steps: [error instanceof Error && /^(browser-budget-exhausted|browser-daily-limit-exhausted)$/.test(error.message) ? error.message : 'unblock-content-error'] };
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
      endpoint: typeof payload?.browserWSEndpoint === 'string' && cfg.baseUrl && cfg.unblockUrl
        ? authenticatedUnblockEndpoint(payload.browserWSEndpoint, cfg.baseUrl, new URL(cfg.unblockUrl).searchParams.get('token') || '') : null,
      httpStatus: response.status,
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'browser-daily-limit-exhausted') throw error;
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
    // Shop-specific card rules (config/browser-cohort.ts) win over the generic selectors.
    const rule: BrowserCardRule | null = BROWSER_CARD_RULES[source.id] || null;
    const rows = await page.locator(rule?.card || PRODUCT_SELECTOR).evaluateAll((elements, rule) => elements.slice(0, 120).map((element) => {
      const el = element as HTMLElement;
      const pick = (selector: string | undefined, fallback: string) => el.querySelector(selector || fallback) as HTMLElement | null;
      const anchor = (el.matches('a[href]') ? el : el.querySelector('a[href]')) as HTMLAnchorElement | null;
      const nameEl = pick(rule?.name, '[itemprop="name"], [data-testid*="name"], [data-testid*="title"], h2, h3, h4, [class*="title"], [class*="name"]');
      const brandEl = pick(rule?.brand, '[itemprop="brand"], [data-testid*="brand"], [class*="brand"]');
      const imageEl = el.querySelector('img') as HTMLImageElement | null;
      const priceEl = pick(rule?.price, '[itemprop="price"], [data-price], [data-testid*="price"], [class*="price"]');
      const priceAttr = priceEl?.getAttribute('content') || priceEl?.getAttribute('data-price') || '';
      const ruleReference = rule?.reference ? el.querySelector(rule.reference) as HTMLElement | null : null;
      // A reference price is only evidence when the shop visibly strikes it
      // through (computed style or <del>/<s>) or a shop rule names the element
      // that holds the crossed-out price, not merely "the higher number".
      const struck = ruleReference || Array.from(el.querySelectorAll('*')).find((node) => {
        const n = node as HTMLElement;
        const t = (n.innerText || '').trim();
        if (!t || t.length > 30 || !/\d/.test(t) || n.children.length > 2) return false;
        return n.tagName === 'DEL' || n.tagName === 'S' || getComputedStyle(n).textDecorationLine.includes('line-through');
      }) as HTMLElement | undefined;
      return {
        href: anchor?.href || '',
        name: (nameEl?.innerText || anchor?.innerText || '').trim(),
        brand: (brandEl?.innerText || '').trim(),
        image: imageEl?.currentSrc || imageEl?.src || imageEl?.getAttribute('data-src') || '',
        text: (el.innerText || '').trim(),
        priceText: `${priceAttr} ${priceEl?.innerText || ''}`.trim(),
        struckText: (struck?.innerText || '').trim(),
      };
    }), rule);

    const seen = new Set<string>();
    const out: RawOffer[] = [];
    for (const row of rows) {
      if (!row.href || !row.name || seen.has(row.href)) continue;
      const textPrices = euroPrices(`${row.priceText} ${row.text}`);
      // A bare attribute price is only trusted when the card shows no other currency
      // (geo-redirected US/UK stores render "$200" / "£90").
      const attrPrice = /\$|£|USD|GBP|SEK|NOK|DKK|CHF|PLN|CZK|zł|Kč/.test(row.text) ? undefined : numberFromText(row.priceText);
      const prices = textPrices.length ? textPrices : (attrPrice ? [attrPrice] : []);
      if (!prices.length) continue;
      const struckPrice = euroPrices(row.struckText)[0];
      const labelledPrice = struckPrice ? undefined : labelledReferencePrice(row.text);
      const referencePrice = struckPrice || labelledPrice;
      const current = prices.filter(value => value !== referencePrice);
      const price = Math.min(...(current.length ? current : prices));
      const rrp = referencePrice && referencePrice > price ? referencePrice : undefined;
      const badge = Number(row.text.match(/(?:^|\s)[-–−]\s?(\d{1,2})\s?%/)?.[1] || 0);
      const displayedDiscount = !rrp && badge >= 40 && badge <= 80 ? badge : undefined;
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
        rrp,
        rrpSource: rrp ? (struckPrice ? 'html:struck-through-price' : 'html:labelled-reference-price') : undefined,
        observedDiscountPct: displayedDiscount,
        discountSource: displayedDiscount ? 'merchant:displayed-discount' : undefined,
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

// Available (not disabled / sold-out) size labels on a product detail page.
async function readAvailableSizes(page: import('playwright-core').Page): Promise<string[]> {
  const selectors = [
    '[data-testid*="size"] button', '[data-testid*="size"] label',
    'button[name*="size"]', '[class*="size"] button', '[class*="size"] label', '[class*="size"] li',
    '[class*="groesse"] button', '[class*="Groesse"] button', '[class*="variant"] button',
    'input[name*="size"] + label', 'select[name*="size"] option', 'select[id*="size"] option',
    'select[name*="groesse"] option', '[data-option-name*="size" i] label', '[data-option-name*="größe" i] label',
    // Shopware 6 configurator, Magento swatches, Shopify variant pickers, generic radios.
    '.product-detail-configurator-option-label', '.swatch-option.text', '[data-size]',
    'fieldset[data-option*="size" i] label', 'fieldset[name*="size" i] label', 'variant-radios label', 'variant-selects option',
    'input[type="radio"][name*="size" i] + label', 'input[type="radio"][name*="größe" i] + label', '[role="radio"][aria-label]',
  ].join(',');
  const values = (await page.locator(selectors).evaluateAll(elements=>elements
    .filter(el=>!el.closest('[disabled],[aria-disabled="true"],[data-disabled="true"],[data-sold-out="true"],.disabled,.sold-out,[class*="unavailable"],[class*="soldout"],[class*="sold-out"],.is-combinable-false,[class*="not-available"]') &&
      !(el.previousElementSibling instanceof HTMLInputElement && el.previousElementSibling.disabled) &&
      !(el instanceof HTMLOptionElement && el.disabled) &&
      !(el instanceof HTMLButtonElement && el.disabled) &&
      !(el instanceof HTMLLabelElement && el.htmlFor && (document.getElementById(el.htmlFor) as HTMLInputElement|null)?.disabled))
    .map(el=>((el.getAttribute('role')==='radio' ? el.getAttribute('aria-label') : el.getAttribute('data-size')) || el.textContent || '').trim())))
    .map(v => v.replace(/\s+/g, ' ').trim())
    .filter(v => v.length <= 24 && (normalizeSizeLabel(v) !== 'unknown' ||
      /^(?:W?\d{2,3}(?:\s*[/x]\s*L?\d{2})?|(?:EU|DE)\s*\d{2}|XXS|XS|S|M|L|XL|XXL|[2-5]XL)$/i.test(v)));
  return [...new Set(values)].slice(0, 40);
}

async function enrichSingleOfferSizes(page: import('playwright-core').Page, offers: RawOffer[]) {
  if (offers.length !== 1 || !/\/products?\/|\/artikel\/|\/p\//i.test(page.url())) return offers;
  try {
    const unique = await readAvailableSizes(page);
    if (unique.length) { offers[0].sizes = unique; offers[0].sizeAvailability='available'; }
  } catch {}
  return offers;
}

/**
 * Local Chromium only (GitHub Actions): open a deal candidate's product page and
 * read which sizes are actually selectable. Returns null when the page could
 * not be read, so callers keep the offer's size status unconfirmed.
 */
export async function verifyProductSizes(url: string, deadline = Date.now() + 25000): Promise<string[] | null> {
  if (browserFallbackConfig().mode !== 'local-playwright') return null;
  return localSessionLimit(async () => {
    let context: import('playwright-core').BrowserContext | null = null;
    try {
      context = await newLocalContext();
      const page = await context.newPage();
      page.setDefaultTimeout(timeLeft(deadline, 5000));
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: requireTime(deadline, 15000) });
      if (!response || response.status() >= 400) return null;
      await dismissConsent(page);
      await page.waitForTimeout(Math.min(2500, timeLeft(deadline, 2500)));
      const sizes = await readAvailableSizes(page);
      return sizes.length ? sizes : null;
    } catch {
      return null;
    } finally {
      try { if (context) await context.close(); } catch {}
    }
  });
}

// Shared page pipeline for remote (CDP) and local Chromium sessions.
async function renderAndExtract(
  page: import('playwright-core').Page,
  source: ShopSource,
  url: string,
  navigate: boolean,
  deadline: number,
  setPhase: (phase: string) => void = () => {},
): Promise<BrowserFallbackResult> {
  page.setDefaultTimeout(timeLeft(deadline, 2500));
  let httpStatus = 200;
  if (navigate || page.url() === 'about:blank') {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: requireTime(deadline, 15000) });
    if (response) httpStatus = response.status();
  }
  if (httpStatus >= 400) {
    return { offers: [], mode: 'playwright', httpStatus, steps: [`playwright-http-${httpStatus}`] };
  }
  requireTime(deadline, 2500);
  setPhase('extraction');
  await stabilizeRenderedPage(page, deadline);
  requireTime(deadline, 2500);
  const html = await page.content();
  let offers = parseRenderedHtml(source, url, html);
  const hasEvidence = (list: RawOffer[]) => list.some(o => o.rrpSource || o.discountSource);
  if (!offers.length || offers.some(o => !o.rrpSource && !o.discountSource)) {
    // The rendered DOM sees computed styles (struck-through prices) that static
    // HTML parsing cannot; use it for evidence and for cards the parser missed.
    const dom = await extractRenderedDomOffers(page, source, url);
    if (!offers.length) offers = dom;
    else if (hasEvidence(dom)) {
      const byUrl = new Map(dom.map(o => [o.url, o]));
      offers = offers.map(o => {
        const d = byUrl.get(o.url);
        return d && !o.rrpSource && !o.discountSource && Math.abs(Number(d.price) - Number(o.price)) < 0.011 && (d.rrpSource || d.discountSource)
          ? { ...o, rrp: d.rrp, rrpSource: d.rrpSource, observedDiscountPct: d.observedDiscountPct, discountSource: d.discountSource } : o;
      });
      const known = new Set(offers.map(o => o.url));
      offers.push(...dom.filter(o => !known.has(o.url)));
    }
  }
  const steps: string[] = [];
  if (!offers.length) {
    // No product cards matched: follow a few same-shop links that name trousers
    // and read the product pages, whose JSON-LD is far more uniform than cards.
    const links = await productLinkCandidates(page, url);
    if (links.length) steps.push(`product-links-${links.length}`);
    let loaded = 0, structured = 0;
    for (const link of links.slice(0, PRODUCT_LINK_LIMIT)) {
      if (deadline - Date.now() < 8000) break;
      try {
        const response = await page.goto(link, { waitUntil: 'domcontentloaded', timeout: requireTime(deadline, 12000) });
        if (response && response.status() >= 400) continue;
        await stabilizeRenderedPage(page, deadline);
        const pageHtml = await page.content();
        loaded++;
        // JSON-LD first; rendered DOM evidence for pages without structured data.
        let found = extractJsonLd(pageHtml, source, link);
        structured += found.length;
        if (!found.length) found = (await extractRenderedDomOffers(page, source, link)).filter(o => o.url.split('?')[0] === link.split('?')[0]);
        offers.push(...found.filter(o => productEligible(o.name || '', o.description || '')));
      } catch { break; }
    }
    if (links.length) steps.push(`product-pages-${loaded}-jsonld-${structured}-offers-${offers.length}`, `product-link-sample-${new URL(links[0]).pathname.slice(0, 60)}`);
  }
  offers = await enrichSingleOfferSizes(page, offers);
  return {
    offers,
    mode: 'playwright',
    httpStatus,
    renderedHtml: html,
    steps: [offers.length ? 'playwright-extracted' : 'playwright-empty', ...steps],
  };
}

const PRODUCT_LINK_LIMIT = 5;
const PRODUCT_LINK_WORDS = /(hose|pants?|trousers?|bukser|byxor|housut|kalhoty|broek|pantalon)/i;
const PRODUCT_LINK_EXCLUDE = /(damen|women|womens|dame|naiset|damske|dámské|kids|kinder|shorts|tights|leggings)/i;

async function productLinkCandidates(page: import('playwright-core').Page, url: string): Promise<string[]> {
  const host = new URL(url).hostname;
  const links = await page.$$eval('a[href]', anchors => anchors.map(a => ({
    href: (a as HTMLAnchorElement).href, text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
  }))).catch(() => [] as { href: string; text: string }[]);
  const seen = new Set<string>();
  return links.filter(l => {
    try {
      const u = new URL(l.href);
      if (u.hostname !== host || u.href === url || seen.has(u.pathname)) return false;
      const hay = `${decodeURIComponent(u.pathname)} ${l.text}`;
      // Product pages sit deeper than category pages and name the item.
      const productLike = u.pathname.split('/').filter(Boolean).length >= 1 && /\d{3,}|\/p\/|\.html?$|_z\d+|-p\d+/i.test(u.pathname);
      if (!productLike || !PRODUCT_LINK_WORDS.test(hay) || PRODUCT_LINK_EXCLUDE.test(hay)) return false;
      seen.add(u.pathname);
      return true;
    } catch { return false; }
  }).map(l => l.href);
}

async function localPlaywrightRequest(source: ShopSource, url: string, deadline: number): Promise<BrowserFallbackResult> {
  const started = Date.now();
  let context: import('playwright-core').BrowserContext | null = null;
  let phase = 'launch';
  try {
    context = await newLocalContext();
    const page = await context.newPage();
    phase = 'navigation';
    const result = await renderAndExtract(page, source, url, true, deadline, p => { phase = p; });
    return { ...result, elapsedMs: Date.now() - started, steps: ['local-chromium', ...result.steps!] };
  } catch (error) {
    const code = error instanceof Error && error.message === 'browser-budget-exhausted' ? error.message : playwrightErrorCode(error);
    return { offers: [], mode: 'playwright', elapsedMs: Date.now() - started,
      steps: ['local-chromium', `playwright-phase-${phase}`, code] };
  } finally {
    try { if (context) await context.close(); } catch {}
  }
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
    const connectTimeout = requireTime(options.deadline, 10000);
    if (!await reserveBrowserSession()) throw new Error('browser-daily-limit-exhausted');
    browser = await chromium.connectOverCDP(endpoint, { timeout: connectTimeout });
    phase = 'context';
    const context = browser.contexts()[0];
    if (!context) return { offers: [], mode: 'playwright', elapsedMs: Date.now() - started, steps: [...options.steps, 'no-context'] };
    page = context.pages()[0] || await context.newPage();
    phase = 'navigation';
    const rendered = await renderAndExtract(page, source, url, options.navigate, options.deadline, p => { phase = p; });
    return { ...rendered, elapsedMs: Date.now() - started, steps: [...options.steps, ...rendered.steps!] };
  } catch (error) {
    const code = error instanceof Error && /^(browser-budget-exhausted|browser-daily-limit-exhausted)$/.test(error.message) ? error.message : playwrightErrorCode(error);
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
  let session: UnblockSessionResult;
  try { session = await unblockSessionRequest(url, deadline); }
  catch { return { offers: [], mode: 'playwright', elapsedMs: Date.now() - started, steps: ['browser-daily-limit-exhausted'] }; }
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
  if (browserFallbackConfig().mode === 'local-playwright') {
    const deadline = Math.min(options.deadline ?? Date.now() + 45000, Date.now() + 45000);
    const { renderedHtml: _html, ...result } = await localPlaywrightRequest(source, url, deadline);
    return result;
  }
  const credentialEndpoint=browserFallbackConfig().contentUrl;
  if(credentialEndpoint && rejectedCredentialEndpoint===credentialEndpoint)
    return { offers: [], mode: 'none', steps: ['provider-auth-circuit-open'] };
  const started = Date.now();
  const deadline = Math.min(options.deadline ?? started + 45000, started + 45000);
  const blocked = Boolean(options.blocked);
  const attempts: BrowserFallbackResult[] = [];
  let llmSteps: string[] = [];
  const canTry = () => timeLeft(deadline, 30000) >= 1000;
  const record = (result: BrowserFallbackResult) => { attempts.push(result); return result.offers.length > 0; };
  const providerLimited = (result: BrowserFallbackResult) => result.httpStatus === 429 ||
    result.steps?.includes('playwright-provider-rate-limited');
  const dailyLimited = (result: BrowserFallbackResult) => result.steps?.includes('browser-daily-limit-exhausted');
  const providerAuthRejected = (result: BrowserFallbackResult) => {
    const rejected=result.httpStatus===401 || result.steps?.includes('playwright-provider-auth-error');
    if(rejected && credentialEndpoint) rejectedCredentialEndpoint=credentialEndpoint;
    return rejected;
  };
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
    const extraction = await llmExtractFromHtml(source, url, snapshot, { timeoutMs: Math.max(1000, Math.min(9000, timeLeft(deadline, 10000))) });
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
    if (dailyLimited(unblock)) return done(unblock);
    if (providerAuthRejected(unblock)) return done({ ...unblock, steps: ['provider-auth-rejected'] });
    if (providerLimited(unblock)) return done({ ...unblock, steps: ['provider-rate-limited'] });

    if (canTry() && browserPlaywrightConfigured()) {
      const handoff = await unblockedPlaywrightRequest(source, url, deadline);
      if (record(handoff)) return done(handoff);
      if (dailyLimited(handoff)) return done(handoff);
      if (providerAuthRejected(handoff)) return done({ ...handoff, steps: ['provider-auth-rejected'] });
      if (providerLimited(handoff)) return done({ ...handoff, steps: ['provider-rate-limited'] });

      if (canTry()) {
        const stealth = await freshPlaywrightRequest(source, url, true, deadline);
        if (record(stealth)) return done(stealth);
        if (dailyLimited(stealth)) return done(stealth);
        if (providerAuthRejected(stealth)) return done({ ...stealth, steps: ['provider-auth-rejected'] });
        if (providerLimited(stealth)) return done({ ...stealth, steps: ['provider-rate-limited'] });
      }
    }

    if (canTry()) {
      const content = await contentRequest(source, url, deadline);
      if (record(content)) return done(content);
      if (dailyLimited(content)) return done(content);
      if (providerAuthRejected(content)) return done({ ...content, steps: ['provider-auth-rejected'] });
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
  if (dailyLimited(content)) return done(content);
  if (providerAuthRejected(content)) return done({ ...content, steps: ['provider-auth-rejected'] });
  if (providerLimited(content)) return done({ ...content, steps: ['provider-rate-limited'] });

  if (canTry() && browserPlaywrightConfigured()) {
    const playwright = await freshPlaywrightRequest(source, url, false, deadline);
    if (record(playwright)) return done(playwright);
    if (dailyLimited(playwright)) return done(playwright);
    if (providerAuthRejected(playwright)) return done({ ...playwright, steps: ['provider-auth-rejected'] });
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
  const limiter = browserFallbackConfig().mode === 'local-playwright' ? localSessionLimit : browserSessionLimit;
  return limiter(() => browserExtractOnce(source, url, options));
}
