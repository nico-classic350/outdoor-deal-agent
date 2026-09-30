// Diagnostic run for the GitHub Actions Chromium crawler (read-only).
//
// For each selected shop it records which URL the crawl hands to Chromium,
// what the rendered page looks like (title, consent banner, JSON-LD types,
// product/price markers) and which category links on the shop's own start
// page look like men's trousers listings. It never stores anything, never
// writes batches or reports and never sends mail. Shop URLs are public; no
// secrets are read or printed.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename }).outputText, filename);

for (const key of ['BROWSERLESS_API_TOKEN', 'BROWSERLESS_TOKEN', 'BROWSERLESS_CONTENT_URL', 'OPENAI_API_KEY', 'DATABASE_URL', 'BROWSER_SNAPSHOT_DATABASE_URL']) delete process.env[key];
process.env.LLM_EXTRACTION_MODE = 'off';
process.env.SOURCE_BUDGET_MS ||= '90000';
process.env.BROWSER_FALLBACK_URL_LIMIT ||= '3';
process.env.BROWSER_RUNTIME = 'local';

const selection = process.env.ACTIONS_BROWSER_SHOPS || 'pilot';
const { SHOPS } = require('../config/shops.ts');
const { browserCohort } = require('../config/browser-cohort.ts');
const browserModule = require('../lib/browser.ts');
const { newLocalContext, closeLocalBrowser } = require('../lib/local-browser.ts');

// Record every URL the crawl escalates to Chromium (crawl.ts reads the export at call time).
const handed = [];
const originalExtract = browserModule.browserExtract;
browserModule.browserExtract = async (source, url, options) => {
  const result = await originalExtract(source, url, options);
  handed.push({ shop: source.id, url, offers: result.offers.length, httpStatus: result.httpStatus ?? null, steps: result.steps || [] });
  return result;
};
const { crawlSource } = require('../lib/crawl.ts');

const TROUSERS = /(hose|hosen|pants|trousers|bukser|byxor|housut|pantalon|pantaloni)/i;
const MEN = /(herren|\bmen\b|mens|men-|\/men|\/m\/|homme|hombre|uomo|herr|miehet|heren)/i;
const WOMEN = /(damen|women|dame|femme|mujer|donna|dam\b|naiset|kinder|kids|junior)/i;

async function inspect(url) {
  const context = await newLocalContext();
  const page = await context.newPage();
  const info = { requested: url };
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    info.httpStatus = response?.status() ?? null;
    await page.waitForTimeout(2000);
    // Same consent handling as the crawler.
    try {
      const button = page.getByRole('button', { name: /^(alle akzeptieren|akzeptieren|zustimmen|accept all|accept|agree|allow all|alle zulassen|allow all cookies)$/i }).first();
      if (await button.count() && await button.isVisible()) { await button.click({ timeout: 1500 }); info.consentClicked = true; }
    } catch {}
    await page.waitForTimeout(3000);
    for (const fraction of [0.5, 1]) {
      await page.evaluate(f => window.scrollTo(0, document.body.scrollHeight * f), fraction).catch(() => {});
      await page.waitForTimeout(800);
    }
    Object.assign(info, await page.evaluate(({ trousers, men, women }) => {
      const T = new RegExp(trousers, 'i'), M = new RegExp(men, 'i'), W = new RegExp(women, 'i');
      const text = document.body?.innerText || '';
      const jsonLdTypes = [];
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { if (v['@type']) jsonLdTypes.push(String(v['@type'])); if (v['@graph']) walk(v['@graph']); if (v.itemListElement) walk(v.itemListElement); } };
          walk(JSON.parse(s.textContent || 'null'));
        } catch { jsonLdTypes.push('invalid'); }
      }
      const consentSelectors = ['#onetrust-banner-sdk', '#usercentrics-root', '#CybotCookiebotDialog', '#didomi-host', '[id*="cookie" i][class*="banner" i]', '[class*="consent" i]', '#cmpbox', '#sp_message_container'];
      const consent = consentSelectors.filter(sel => { const el = document.querySelector(sel); return el && (el.getBoundingClientRect().height > 0 || el.shadowRoot); });
      const links = [...document.querySelectorAll('a[href]')].map(a => ({ href: a.href, text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) }))
        .filter(l => l.href.startsWith(location.origin));
      const categoryLinks = [...new Map(links.filter(l => T.test(l.href + ' ' + l.text) && !W.test(l.href + ' ' + l.text))
        .sort((a, b) => Number(M.test(b.href + b.text)) - Number(M.test(a.href + a.text))).map(l => [l.href, l])).values()].slice(0, 20);
      return {
        finalUrl: location.href,
        title: document.title.slice(0, 100),
        htmlBytes: document.documentElement.outerHTML.length,
        textBytes: text.length,
        euroPrices: (text.match(/\d{1,4}(?:[.,]\d{2})?\s?(?:€|EUR|SEK|kr)/g) || []).length,
        productLikeElements: document.querySelectorAll('[class*="product" i], [data-product-id], [data-testid*="product" i], article').length,
        jsonLdTypes: [...new Set(jsonLdTypes)].slice(0, 12),
        consentVisible: consent,
        blockedHint: /access denied|captcha|are you a robot|verify you are human|cloudflare|forbidden/i.test(text.slice(0, 3000)),
        categoryLinks,
        saleLinks: [...new Map(links.filter(l => /sale|outlet|reduziert|angebot|deals|special|clearance/i.test(l.href + ' ' + l.text) && !W.test(l.href + ' ' + l.text)).map(l => [l.href, l])).values()].slice(0, 12),
        localeLinks: [...new Map([...document.querySelectorAll('a[href]')].map(a => ({ href: a.href, text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) }))
          .filter(l => /country|region|locale|market|currency|moneda|\/de-de|\/de_de|\/eu\b|\/en-eu|deutschland|germany|euro/i.test(l.href + ' ' + l.text)).map(l => [l.href, l])).values()].slice(0, 12),
        euroSnippets: (text.match(/.{0,40}(?:€|EUR).{0,20}/g) || []).slice(0, 5),
        currencies: [...new Set((text.match(/€|EUR|USD|\$|£|GBP|SEK|NOK|DKK|CHF/g) || []))],
        cardSamples: (() => {
          // Smallest elements carrying a price, climbed up to a card with a link and an image.
          const priced = [...document.querySelectorAll('body *')].filter(el => el.children.length <= 2 &&
            /\d[\d.,]*\s?(€|EUR|\$|£|kr)|(€|\$|£)\s?\d/.test(el.textContent || '') && (el.textContent || '').length < 40).slice(0, 60);
          const cards = [];
          for (const el of priced) {
            let card = el;
            for (let i = 0; i < 8 && card.parentElement; i++) {
              if (card.querySelector('a[href]') && card.querySelector('img')) break;
              card = card.parentElement;
            }
            if (cards.includes(card) || !card.querySelector('a[href]')) continue;
            cards.push(card);
            if (cards.length >= 2) break;
          }
          return cards.map(card => {
            const clone = card.cloneNode(true);
            clone.querySelectorAll('svg,script,style,noscript,source').forEach(n => n.remove());
            clone.querySelectorAll('*').forEach(n => { for (const a of [...n.attributes]) if (!/^(class|href|itemprop|itemtype|data-testid|data-price|content|aria-label)$/.test(a.name)) n.removeAttribute(a.name); });
            const priceNodes = [...card.querySelectorAll('*')].filter(n => n.children.length <= 1 && /\d/.test(n.textContent || '') && (n.textContent || '').trim().length < 40 &&
              /€|EUR|%|UVP|statt|RRP|was|price|preis/i.test((n.textContent || '') + ' ' + (n.getAttribute('class') || '') + ' ' + n.tagName))
              .slice(0, 10).map(n => ({ tag: n.tagName.toLowerCase(), cls: String(n.getAttribute('class') || '').slice(0, 80), text: (n.textContent || '').replace(/\s+/g, ' ').trim() }));
            return { tag: card.tagName.toLowerCase(), cls: String(card.getAttribute('class') || '').slice(0, 80), priceNodes, html: clone.outerHTML.replace(/\s+/g, ' ').slice(0, 600) };
          });
        })(),
      };
    }, { trousers: TROUSERS.source, men: MEN.source, women: WOMEN.source }));
  } catch (error) {
    info.error = String(error?.message || error).split('\n')[0].slice(0, 160);
  } finally {
    await context.close().catch(() => {});
  }
  return info;
}

// Candidate listing pages (EU locale spelled out: the runner is in the US and
// shops geo-redirect bare domains). Found in the first diagnosis run or guessed
// from the shops' URL schemes; this run verifies them.
const CANDIDATES = {
  'patagonia-eu': ['https://eu.patagonia.com/de/de/'],
  'rab-eu': ['https://rab.equipment/eu/', 'https://rab.equipment/eu/mens/pants'],
  'norrona-eu': ['https://www.norrona.com/de-DE/o/herren/hosen/'],
  'haglofs-eu': ['https://www.haglofs.com/de-de', 'https://www.haglofs.com/de', 'https://www.haglofs.com/en-eu', 'https://www.haglofs.com/eu'],
  'odlo-eu': ['https://www.odlo.com/de-de/c/outlet/herren/hosen-tights', 'https://www.odlo.com/de-de/c/outlet'],
  'outdoor-renner': ['https://www.outdoor-renner.de/', 'https://www.outdoor-renner.de/wanderhosen-herren-uebergroesse/'],
  'trekkinn': ['https://www.tradeinn.com/trekkinn/de', 'https://www.tradeinn.com/trekkinn/de/herren-hosen/10573/s'],
  'peakperformance-eu': [],
};

const report = [];
for (const id of browserCohort(selection)) {
  const source = SHOPS.find(shop => shop.id === id);
  if (!source) { console.log(`[diagnose] unknown shop ${id}`); continue; }
  const before = handed.length;
  const { offers, coverage } = process.env.DIAGNOSE_SKIP_CRAWL ? { offers: [], coverage: { status: 'skipped', technicalPath: [], httpStatuses: [] } } : await crawlSource(source);
  const escalations = handed.slice(before).map(h => ({ ...h, steps: h.steps.slice(0, 10) }));
  const start = process.env.DIAGNOSE_SKIP_CRAWL ? { categoryLinks: [] } : await inspect(source.baseUrl);
  const rendered = [];
  for (const h of escalations.slice(0, 2)) if (h.url !== source.baseUrl) rendered.push(await inspect(h.url));
  // Try the best-looking men's trousers link from the start page through the real extractor.
  const candidate = start.categoryLinks?.[0]?.href;
  let candidateResult = null;
  if (candidate) {
    const r = await originalExtract(source, candidate, { deadline: Date.now() + 45000 });
    candidateResult = { url: candidate, offers: r.offers.length, httpStatus: r.httpStatus ?? null, steps: (r.steps || []).slice(0, 10),
      sample: r.offers.slice(0, 3).map(o => ({ name: o.name, price: o.price, rrp: o.rrp ?? null })) };
  }
  const candidatePages = [];
  for (const url of CANDIDATES[id] || []) {
    const page = await inspect(url);
    const r = await originalExtract(source, url, { deadline: Date.now() + 45000 });
    candidatePages.push({ ...page, extractor: { offers: r.offers.length, httpStatus: r.httpStatus ?? null, steps: (r.steps || []).slice(0, 8),
      sample: r.offers.slice(0, 3).map(o => ({ name: o.name, price: o.price, rrp: o.rrp ?? null, currency: o.currency })) } });
  }
  const entry = {
    shop: id, baseUrl: source.baseUrl,
    crawl: { status: coverage.status, rawOffers: offers.length, discoveredUrls: coverage.discoveredUrls, httpStatuses: coverage.httpStatuses,
      path: (coverage.technicalPath || []).filter(s => !s.startsWith('browser-elapsed')).slice(0, 25) },
    escalations, start, rendered, candidateResult, candidatePages,
  };
  report.push(entry);
  console.log(`[diagnose] ${JSON.stringify(entry)}`);
}
await closeLocalBrowser();

mkdirSync('observability', { recursive: true });
writeFileSync('observability/actions-browser-diagnose.json', JSON.stringify(report, null, 2) + '\n');
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = ['## Chromium browser diagnosis', '', '| Shop | Crawl path | URL given to Chromium | Offers there | Start page title | Consent | Best trousers link | Offers there |', '| --- | --- | --- | ---: | --- | --- | --- | ---: |'];
  for (const r of report) {
    const esc = r.escalations[0];
    const path = r.crawl.path.find(s => /base-url-fallback|sitemap-urls|targeted/.test(s)) || '';
    lines.push(`| ${r.shop} | ${path} | ${esc ? new URL(esc.url).pathname : '—'} | ${esc?.offers ?? '—'} | ${(r.start.title || r.start.error || '').replace(/\|/g, '/')} | ${(r.start.consentVisible || []).join(' ') || '—'} | ${r.candidateResult ? new URL(r.candidateResult.url).pathname : '—'} | ${r.candidateResult?.offers ?? '—'} |`);
  }
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}
