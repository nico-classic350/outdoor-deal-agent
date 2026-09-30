// GitHub Actions browser crawler (open source: playwright-core + Chromium).
//
// Crawls the browser cohort with the normal crawl pipeline, but escalates to a
// locally launched Chromium instead of Browserless. Optionally runs the same
// shops direct-only first (A/B in the same environment and time window) and
// stores the Chromium result as a snapshot that the Vercel batches merge.
//
// Logs are public for this repository: print only shop IDs, counts, HTTP
// statuses and technical step codes — never URLs, page content or secrets.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename }).outputText, filename);

// No paid providers in this job, and no production batch/mail side effects.
for (const key of ['BROWSERLESS_API_TOKEN', 'BROWSERLESS_TOKEN', 'BROWSERLESS_CONTENT_URL', 'OPENAI_API_KEY', 'DATABASE_URL']) delete process.env[key];
process.env.LLM_EXTRACTION_MODE = 'off';
process.env.SOURCE_BUDGET_MS ||= '90000';
process.env.BROWSER_FALLBACK_URL_LIMIT ||= '3';

const snapshotDb = process.env.BROWSER_SNAPSHOT_DATABASE_URL || '';
const writeSnapshot = process.env.WRITE_SNAPSHOT === 'true';
const compare = process.env.AB_COMPARE === 'true';
const selection = process.env.ACTIONS_BROWSER_SHOPS || 'all';

const pLimit = (await import('p-limit')).default;
const { SHOPS } = require('../config/shops.ts');
const { browserCohort } = require('../config/browser-cohort.ts');
const { crawlSource } = require('../lib/crawl.ts');
const { normalizeOfferChecked } = require('../lib/normalize.ts');
const { productEligible, selectOffers } = require('../lib/product-rules.mjs');
const { closeLocalBrowser } = require('../lib/local-browser.ts');
const { ensureSnapshotTable, saveSnapshot } = require('../lib/browser-snapshots.ts');

// 'registry' simulates the whole daily pipeline: every registered shop, with
// Chromium only for the nightly cohort (as production merges snapshots only
// for those shops). Used for a manual before/after comparison.
const cohort = new Set(browserCohort('all'));
const ids = selection === 'registry' ? SHOPS.map(shop => shop.id) : browserCohort(selection);
const sources = ids.map(id => {
  const source = SHOPS.find(shop => shop.id === id);
  if (!source) throw new Error(`unknown shop id: ${id}`);
  return source;
});

async function measure(source, runtime) {
  if (runtime === 'local') process.env.BROWSER_RUNTIME = 'local'; else delete process.env.BROWSER_RUNTIME;
  const { offers, coverage } = await crawlSource(source);
  const checked = await Promise.allSettled(offers.map(normalizeOfferChecked));
  const normalized = checked.filter(r => r.status === 'fulfilled' && r.value.offer).map(r => r.value.offer);
  const relevant = offers.filter(o => o.name && productEligible(o.name, o.description));
  return {
    offers,
    coverage,
    normalized,
    metrics: {
      rawOffers: offers.length,
      uniqueProductUrls: new Set(offers.map(o => o.url)).size,
      relevantOffers: relevant.length,
      priceEvidenceOffers: relevant.filter(o => Boolean(o.rrp && o.rrp > Number(o.price) && o.rrpSource)
        || Boolean(o.discountSource && Number(o.observedDiscountPct) >= 40)).length,
      normalizedOffers: normalized.length,
      discount40Offers: normalized.filter(o => o.effectiveDiscountPct >= 40).length,
      qualifiedOffers: selectOffers(normalized, 40).qualifiedCount,
      status: coverage.status,
      httpStatuses: coverage.httpStatuses,
      browserSteps: (coverage.technicalPath || []).filter(step => step.startsWith('browser-')),
      elapsedMs: coverage.elapsedMs,
    },
  };
}

// Runtime is process-global (env), so the two arms run one after the other,
// each over the whole cohort with bounded shop concurrency.
async function runArm(runtime) {
  const limit = pLimit(Number(process.env.SHOP_CONCURRENCY || 3));
  return Promise.all(sources.map(source => limit(async () => {
    const result = await measure(source, runtime === 'local' && (selection !== 'registry' || cohort.has(source.id)) ? 'local' : 'direct');
    console.log(`[${runtime}] ${JSON.stringify({ shop: source.id, ...result.metrics, browserSteps: result.metrics.browserSteps.slice(0, 12) })}`);
    return { shop: source.id, ...result };
  })));
}

const direct = compare ? await runArm('direct') : null;
const collectedAt = new Date().toISOString();
const local = await runArm('local');
await closeLocalBrowser();

let sql = null;
if (writeSnapshot) {
  if (!snapshotDb) console.log('[snapshot] BROWSER_SNAPSHOT_DATABASE_URL is not set; snapshots are not stored');
  else {
    const { neon } = await import('@neondatabase/serverless');
    sql = neon(snapshotDb);
    await ensureSnapshotTable(sql);
  }
}
let stored = 0;
if (sql) {
  for (const row of local.filter(r => cohort.has(r.shop))) {
    // Store every attempt (also empty ones) so health shows the job ran.
    await saveSnapshot(sql, {
      shopId: row.shop,
      collectedAt,
      offers: row.offers,
      coverage: {
        status: row.coverage.status, parsedOffers: row.coverage.parsedOffers, httpStatuses: row.coverage.httpStatuses,
        technicalPath: row.coverage.technicalPath, elapsedMs: row.coverage.elapsedMs,
      },
    });
    stored++;
  }
}

const keys = ['rawOffers', 'uniqueProductUrls', 'relevantOffers', 'priceEvidenceOffers', 'normalizedOffers', 'discount40Offers', 'qualifiedOffers'];
const totals = arm => arm && Object.fromEntries(keys.map(k => [k, arm.reduce((n, r) => n + r.metrics[k], 0)]));
const summary = {
  collectedAt, selection, shops: ids.length, compare, snapshotsStored: stored,
  totals: { direct: totals(direct), local: totals(local) },
  shopsWithProducts: { direct: direct?.filter(r => r.metrics.rawOffers > 0).length ?? null, local: local.filter(r => r.metrics.rawOffers > 0).length },
  perShop: local.map(r => ({ shop: r.shop, local: r.metrics, direct: direct?.find(d => d.shop === r.shop)?.metrics ?? null })),
};
// Report-level selection across all shops (same rules as the daily report).
const report = arm => {
  if (!arm) return null;
  const { deals, near, qualifiedCount } = selectOffers(arm.flatMap(r => r.normalized), 40);
  return { qualifiedCount, nearMisses: near.length, deals: deals.map(o => ({ shop: o.sourceId, brand: o.brand, name: o.name,
    priceEur: Math.round(o.priceEur * 100) / 100, rrpEur: o.rrpEur ? Math.round(o.rrpEur * 100) / 100 : null,
    effectiveDiscountPct: Math.round(o.effectiveDiscountPct), evidence: o.rrpVerified ? o.rrpSource : o.discountSource, sizeFit: o.sizeFit, url: o.url })) };
};
summary.report = { direct: report(direct), local: report(local) };
console.log(`[report] ${JSON.stringify(summary.report)}`);
mkdirSync('observability', { recursive: true });
writeFileSync('observability/actions-browser-summary.json', JSON.stringify(summary, null, 2) + '\n');
console.log(`[total] ${JSON.stringify({ totals: summary.totals, shopsWithProducts: summary.shopsWithProducts, snapshotsStored: stored })}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = ['## Chromium browser crawl', '', `Shops: ${ids.length} (${selection}); snapshots stored: ${stored}`, '',
    `| Metric | ${compare ? 'Direct only | ' : ''}Direct + Chromium |`, `| --- | ${compare ? '---: | ' : ''}---: |`,
    ...keys.map(k => `| ${k} | ${compare ? `${summary.totals.direct[k]} | ` : ''}${summary.totals.local[k]} |`),
    `| shopsWithProducts | ${compare ? `${summary.shopsWithProducts.direct} | ` : ''}${summary.shopsWithProducts.local} |`, ''];
  for (const [arm, r] of Object.entries(summary.report)) if (r) {
    lines.push(`### Report selection (${arm === 'local' ? 'direct + Chromium' : 'direct only'}): ${r.qualifiedCount} qualified, ${r.nearMisses} near misses`, '',
      '| Shop | Product | Price | Reference | Effective discount | Size |', '| --- | --- | ---: | ---: | ---: | --- |',
      ...r.deals.map(d => `| ${d.shop} | ${d.brand} ${String(d.name).replace(/\|/g, '/')} | ${d.priceEur} € | ${d.rrpEur ?? d.evidence} | ${d.effectiveDiscountPct} % | ${d.sizeFit} |`), '');
  }
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}
