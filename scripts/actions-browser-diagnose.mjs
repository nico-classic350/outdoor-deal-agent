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
        platform: (window.Shopify || document.querySelector('meta[name="shopify-checkout-api-token"], link[href*="cdn.shopify.com"]')) ? 'shopify'
          : (document.querySelector('[class*="cms-element"], [data-cms-element-id], script[src*="/bundles/storefront/"]') ? 'shopware6'
          : (document.querySelector('.product--box, [class*="product--info"]') ? 'shopware5'
          : (window.require && document.querySelector('script[type="text/x-magento-init"]') ? 'magento'
          : (document.querySelector('meta[name="generator"][content*="WooCommerce"], body.woocommerce') ? 'woocommerce' : null)))),
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
  'peakperformance-eu': [],
};

const report = [];
const extractAt = async (source, url) => {
  const r = await originalExtract(source, url, { deadline: Date.now() + 45000 });
  return { url, offers: r.offers.length, withReference: r.offers.filter(o => o.rrpSource || o.discountSource).length,
    httpStatus: r.httpStatus ?? null, steps: (r.steps || []).slice(0, 6),
    sample: r.offers.slice(0, 3).map(o => ({ name: o.name, brand: o.brand ?? null, price: o.price, rrp: o.rrp ?? null })) };
};
const compactPage = p => ({ requested: p.requested, finalUrl: p.finalUrl, httpStatus: p.httpStatus, title: p.title, error: p.error,
  currencies: p.currencies, consentVisible: p.consentVisible, blockedHint: p.blockedHint, euroSnippets: (p.euroSnippets || []).slice(0, 3),
  categoryLinks: (p.categoryLinks || []).slice(0, 8).map(l => l.href), saleLinks: (p.saleLinks || []).slice(0, 8).map(l => l.href),
  localeLinks: (p.localeLinks || []).slice(0, 6).map(l => l.href), firstCardPrices: p.cardSamples?.[0]?.priceNodes?.slice(0, 5) ?? [],
  platform: p.platform ?? null, firstCard: p.cardSamples?.[0] ? { tag: p.cardSamples[0].tag, cls: p.cardSamples[0].cls, html: p.cardSamples[0].html } : null });
const menTrousers = href => TROUSERS.test(href) && MEN.test(href) && !WOMEN.test(href);
const diagnoseIds = selection === 'registry' ? SHOPS.map(shop => shop.id) : browserCohort(selection);
for (const id of diagnoseIds) {
  const source = SHOPS.find(shop => shop.id === id);
  if (!source) { console.log(`[diagnose] unknown shop ${id}`); continue; }
  const pages = [];
  for (const url of [source.baseUrl, ...(CANDIDATES[id] || [])]) pages.push(await inspect(url));
  const links = pages.flatMap(p => p.categoryLinks || []).map(l => l.href);
  const sales = pages.flatMap(p => p.saleLinks || []).map(l => l.href);
  const tried = new Set();
  const targets = [
    ...(CANDIDATES[id] || []),
    links.find(menTrousers) || links[0],
    sales.find(menTrousers) || sales.find(h => MEN.test(h) && !WOMEN.test(h)) || sales[0],
  ].filter(u => u && !u.includes('#') && !tried.has(u) && tried.add(u)).slice(0, 4);
  const extracted = [];
  for (const url of targets) extracted.push(await extractAt(source, url));
  // Shopify stores expose collection JSON with compare_at_price and variant availability.
  let shopifyProbe = null;
  if (pages.some(p => p.platform === 'shopify')) {
    const origin = new URL(pages[0].finalUrl || source.baseUrl).origin;
    try {
      const r = await fetch(`${origin}/products.json?limit=5`, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; OutdoorDealAgent/1.0)' }, signal: AbortSignal.timeout(10000) });
      const j = r.ok ? await r.json() : null;
      shopifyProbe = { status: r.status, products: j?.products?.length ?? 0,
        sample: j?.products?.[0] ? { title: j.products[0].title, variants: j.products[0].variants?.slice(0, 3).map(v => ({ title: v.title, price: v.price, compare_at_price: v.compare_at_price, available: v.available })) } : null };
    } catch (e) { shopifyProbe = { error: String(e?.message || e).slice(0, 80) }; }
  }
  // Public commerce APIs that serve structured prices without a browser.
  const origin = new URL(pages[0].finalUrl || source.baseUrl).origin;
  const ua = { 'user-agent': 'Mozilla/5.0 (compatible; OutdoorDealAgent/1.0)', accept: 'application/json' };
  const probe = async (label, url, init = {}) => {
    try {
      const r = await fetch(url, { ...init, headers: { ...ua, ...(init.headers || {}) }, signal: AbortSignal.timeout(10000) });
      const body = (await r.text()).slice(0, 400);
      return { label, status: r.status, json: /^\s*[\[{]/.test(body), sample: body.slice(0, 200) };
    } catch (e) { return { label, error: String(e?.message || e).slice(0, 80) }; }
  };
  const apiProbes = [
    await probe('woocommerce', `${origin}/wp-json/wc/store/v1/products?per_page=1&on_sale=true`),
    await probe('magento-graphql', `${origin}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ products(search: "hose", pageSize: 1) { total_count items { name price_range { minimum_price { regular_price { value currency } final_price { value currency } } } } } }' }) }),
    await probe('shopify', `${origin}/products.json?limit=1`),
  ].filter(p => p.status === 200 && p.json);
  // Files a shop publishes for search engines and feed consumers. Bot protection
  // often exempts them; they show whether product data is reachable openly.
  const publicFiles = [];
  const readText = async url => {
    try {
      const r = await fetch(url, { headers: { 'user-agent': ua['user-agent'] }, signal: AbortSignal.timeout(10000) });
      return { status: r.status, type: r.headers.get('content-type') || '', text: r.ok ? (await r.text()).slice(0, 400000) : '' };
    } catch (e) { return { status: null, error: String(e?.message || e).slice(0, 80), text: '' }; }
  };
  const robots = await readText(`${origin}/robots.txt`);
  const sitemaps = [...robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map(m => m[1]).slice(0, 6);
  publicFiles.push({ label: 'robots', status: robots.status, sitemaps, feedHints: [...robots.text.matchAll(/(\S*(?:feed|export|google|merchant|idealo)\S*\.(?:xml|csv|txt))/gi)].map(m => m[1]).slice(0, 5) });
  for (const url of (sitemaps.length ? sitemaps : [`${origin}/sitemap.xml`]).slice(0, 2)) {
    const s = await readText(url);
    const locs = [...s.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1]);
    publicFiles.push({ label: 'sitemap', url, status: s.status, type: (s.type || '').slice(0, 40), error: s.error, locs: locs.length,
      sample: locs.filter(l => TROUSERS.test(l)).slice(0, 3).concat(locs.slice(0, 2)).slice(0, 4),
      priceTags: /<(?:g:price|price|sale_price)>/i.test(s.text) });
  }
  const entry = { shop: id, baseUrl: source.baseUrl, pages: pages.map(compactPage), extracted, shopifyProbe, apiProbes, publicFiles };
  report.push(entry);
  console.log(`[diagnose] ${JSON.stringify(entry)}`);
}
await closeLocalBrowser();

// Product-page survey (read-only): for two premium trousers per diagnosed shop,
// what the static HTML carries (JSON-LD, reference-price words) and which
// size controls the rendered page shows, with their disabled markers.
if (process.env.ACTIONS_DIAGNOSE_PRODUCTS === 'true') {
  const { PROFILE } = require('../config/profile.ts');
  const { productEligible } = require('../lib/product-rules.mjs');
  const fold = v => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ø/g, 'o');
  for (const id of diagnoseIds) {
    const source = SHOPS.find(shop => shop.id === id);
    if (!source) continue;
    let offers = [];
    try { offers = (await crawlSource(source)).offers; } catch {}
    const picks = offers.filter(o => o.name && productEligible(o.name, o.description)
      && PROFILE.brands.some(b => fold(`${o.brand} ${o.name}`).includes(fold(b)))).slice(0, 2);
    console.log(`[product-survey] ${JSON.stringify({ shop: id, offers: offers.length, picks: picks.map(o => ({ url: o.url, name: o.name, price: o.price, rrp: o.rrp ?? null, sizes: o.sizes })) })}`);
    for (const pick of picks) {
      let staticInfo = {};
      try {
        const r = await fetch(pick.url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; OutdoorDealAgent/1.0)' }, signal: AbortSignal.timeout(15000) });
        const html = await r.text();
        const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
        staticInfo = { status: r.status, finalUrl: r.url, bytes: html.length, jsonLdBlocks: ld.length,
          jsonLdProduct: ld.some(x => /"Product"/.test(x)), jsonLdOffers: (ld.join(' ').match(/"Offer"/g) || []).length,
          jsonLdSample: ld.find(x => /"Product"/.test(x))?.slice(0, 700) ?? null,
          referenceWords: [...new Set((html.match(/(?:UVP|statt|Normalpreis|ord\.?\s*pris|Ovh\.?|Alkuper[äa]inen|tidigare pris|før|was|compare.at|old-price|price--old|line-through|strike)/gi) || []).map(w => w.toLowerCase()))].slice(0, 12),
          stateScripts: [...new Set((html.match(/__NEXT_DATA__|__NUXT__|window\.__INITIAL_STATE__|application\/json|data-product-json|variants/g) || []))] };
      } catch (e) { staticInfo = { error: String(e?.message || e).slice(0, 80) }; }
      let rendered = {};
      let context = null;
      try {
        context = await newLocalContext();
        const page = await context.newPage();
        const resp = await page.goto(pick.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3500);
        rendered = { status: resp?.status() ?? null, controls: await page.evaluate(() => {
          const sizeLike = /^(?:XXS|XS|S|M|L|XL|XXL|[2-5]XL|W?\d{2,3}(?:\s*[\/x]\s*L?\d{2})?|(?:EU|DE)\s*\d{2}|\d{2}\s*(?:\(EU\)|R|S|L|K))$/i;
          const out = [];
          for (const el of document.querySelectorAll('button, label, li, option, a, span, div[role="radio"], [role="option"]')) {
            const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
            if (!sizeLike.test(text) || el.children.length > 2) continue;
            const attrs = {};
            for (const a of el.attributes) if (/^(class|disabled|aria-|data-|name|for|value|title)/.test(a.name)) attrs[a.name] = a.value.slice(0, 60);
            out.push({ tag: el.tagName.toLowerCase(), text, attrs, parent: `${el.parentElement?.tagName.toLowerCase()}.${String(el.parentElement?.className || '').slice(0, 60)}` });
            if (out.length >= 14) break;
          }
          return out;
        }) };
      } catch (e) { rendered = { error: String(e?.message || e).slice(0, 80) }; }
      finally { try { await context?.close(); } catch {} }
      console.log(`[product-page] ${JSON.stringify({ shop: id, url: pick.url, static: staticInfo, rendered })}`);
    }
  }
  await closeLocalBrowser();
}

// Brand fields of structured shop APIs (read-only): which field names the
// manufacturer, so offers whose titles omit the brand can still be matched.
if (process.env.ACTIONS_DIAGNOSE_BRAND_FIELDS === 'true') {
  const post = async (origin, query) => {
    try {
      const r = await fetch(`${origin}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json',
        'user-agent': 'Mozilla/5.0 (compatible; OutdoorDealAgent/1.0)' }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(15000) });
      return { status: r.status, body: (await r.text()).slice(0, 900) };
    } catch (e) { return { error: String(e?.message || e).slice(0, 80) }; }
  };
  for (const origin of ['https://www.maxisport.com', 'https://www.snowcountry.eu']) {
    for (const [label, query] of [
      ['manufacturer', '{ products(search: "patagonia", pageSize: 2) { items { name manufacturer } } }'],
      ['brand', '{ products(search: "patagonia", pageSize: 2) { items { name brand } } }'],
      ['attributesV2', '{ products(search: "patagonia", pageSize: 2) { items { name custom_attributesV2 { items { code ... on AttributeValue { value } ... on AttributeSelectedOptions { selected_options { label } } } } } } }'],
      ['aggregations', '{ products(search: "pantaloni", pageSize: 1) { aggregations { attribute_code label options { label count } } } }'],
    ]) console.log(`[brand-field] ${JSON.stringify({ origin, label, ...(await post(origin, query)) })}`);
  }
  for (const [origin, handle] of [['https://www.sportit.com', 'pantaloni-abbigliamento'], ['https://df-sportspecialist.it', 'montagna']]) {
    try {
      const r = await fetch(`${origin}/collections/${handle}/products.json?limit=8`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      console.log(`[brand-field] ${JSON.stringify({ origin, status: r.status, products: (j.products || []).map(p => ({ title: p.title, vendor: p.vendor,
        type: p.product_type, tags: (p.tags || []).slice?.(0, 8), options: (p.options || []).map(o => o.name) })) })}`);
    } catch (e) { console.log(`[brand-field] ${JSON.stringify({ origin, error: String(e?.message || e).slice(0, 80) })}`); }
  }
}

// Production snapshot (read-only public endpoints): latest finalized report,
// today's batches and health, saved as an artifact for run reviews.
if (process.env.ACTIONS_DIAGNOSE_PRODUCTION === 'true') {
  const base = 'https://outdoor-deal-agent.vercel.app';
  const production = {};
  for (const path of ['/api/health', '/api/coverage', '/api/batch-status', '/api/probe']) {
    try {
      const r = await fetch(`${base}${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
      production[path] = { status: r.status, body: await r.json().catch(() => null) };
    } catch (e) { production[path] = { error: String(e?.message || e).slice(0, 120) }; }
    console.log(`[production] ${path} ${production[path].status ?? production[path].error}`);
  }
  // Compact log lines (artifacts cannot always be downloaded by reviewers).
  const latest = production['/api/coverage']?.body?.latest;
  const report = latest?.report || {};
  const offerLine = d => ({ shop: d.sourceId, brand: d.brand, name: String(d.name || '').slice(0, 70), price: d.priceEur, rrp: d.rrpEur,
    pct: d.effectiveDiscountPct, fit: d.sizeFit, sizes: (d.sizes || []).slice(0, 8), src: d.rrpSource || d.discountSource, cls: d.class });
  const h = production['/api/health']?.body || {};
  console.log(`[prod-health] ${JSON.stringify(Object.fromEntries(Object.entries(h).filter(([, v]) => typeof v !== 'object' || v === null)))}`);
  console.log(`[prod-run] ${JSON.stringify({ runDate: latest?.run_date ?? latest?.runDate, startedAt: report.startedAt, finishedAt: report.finishedAt,
    planned: report.plannedSources, attempted: report.attemptedSources, success: report.success, partial: report.partial, browser: report.browser,
    blocked: report.blocked, failed: report.failed, raw: report.rawOffers, normalized: report.normalizedOffers, screened: report.screenedOffers,
    confirmedSize: report.confirmedSizeOffers, deals: report.qualifiedDeals, near: report.nearMisses, comparison: report.comparison?.summary ?? null })}`);
  for (const d of latest?.deals || []) console.log(`[prod-deal] ${JSON.stringify(offerLine(d))}`);
  for (const d of latest?.near_misses || []) console.log(`[prod-near] ${JSON.stringify(offerLine(d))}`);
  for (const c of report.coverage || []) console.log(`[prod-shop] ${JSON.stringify({ id: c.sourceId, st: c.status, code: c.diagnosticCode, raw: c.parsedOffers,
    elig: c.eligibleOffers, ev: c.priceEvidenceOffers, sz: c.availableSizeOffers, q: c.qualifiedOffers, rej: c.rejectionReasons, ms: c.elapsedMs,
    http: c.httpStatuses, path: (c.technicalPath || []).slice(-6) })}`);
  for (const b of production['/api/batch-status']?.body?.batches || []) console.log(`[prod-batch] ${JSON.stringify({ i: b.batch_index,
    start: b.started_at, end: b.finished_at, sources: b.source_count, offers: b.normalized_offer_count })}`);
  mkdirSync('observability', { recursive: true });
  writeFileSync('observability/actions-browser-production.json', JSON.stringify(production) + '\n');
}

// Deal-community feeds (read-only): shows whether the runner may read them and
// how their items look. Public feeds only; a personal alert feed is read from
// the environment when set and its URL is never printed.
if (process.env.ACTIONS_DIAGNOSE_FEEDS === 'true') {
  const feeds = [['mydealz-hot', 'https://www.mydealz.de/rss/hot'], ['mydealz-fashion', 'https://www.mydealz.de/rss/gruppe/fashion-accessories'],
    ['mydealz-outdoor', 'https://www.mydealz.de/rss/gruppe/outdoor']];
  if (process.env.MYDEALZ_ALERT_FEED_URL) feeds.push(['mydealz-alerts', process.env.MYDEALZ_ALERT_FEED_URL]);
  for (const [label, url] of feeds) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; OutdoorDealAgent/1.0)', accept: 'application/rss+xml, application/xml' }, signal: AbortSignal.timeout(15000) });
      const text = await r.text();
      const items = text.match(/<item[\s>][\s\S]*?<\/item>/g) || [];
      console.log(`[feed] ${JSON.stringify({ label, status: r.status, type: r.headers.get('content-type'), items: items.length,
        head: items.length ? undefined : text.slice(0, 300), first: label === 'mydealz-alerts' ? undefined : items.slice(0, 2).map(i => i.slice(0, 2500)),
        titles: items.slice(0, 8).map(i => (i.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.slice(0, 120)) })}`);
    } catch (e) { console.log(`[feed] ${JSON.stringify({ label, error: String(e?.message || e).slice(0, 80) })}`); }
  }
}

mkdirSync('observability', { recursive: true });
writeFileSync('observability/actions-browser-diagnose.json', JSON.stringify(report, null, 2) + '\n');
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = ['## Chromium browser diagnosis', '', '| Shop | Start page | Currency | Best page | Offers | With reference |', '| --- | --- | --- | --- | ---: | ---: |'];
  for (const r of report) {
    const best = [...r.extracted].sort((a, b) => b.withReference - a.withReference || b.offers - a.offers)[0];
    lines.push(`| ${r.shop} | ${(r.pages[0].title || r.pages[0].error || '').replace(/\|/g, '/').slice(0, 50)} | ${(r.pages[0].currencies || []).join(' ')} | ${best ? new URL(best.url).pathname : '—'} | ${best?.offers ?? '—'} | ${best?.withReference ?? '—'} |`);
  }
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}
