import pLimit from 'p-limit';
import { neon } from '@neondatabase/serverless';
import { SHOPS } from '../config/shops';
import { PROFILE } from '../config/profile';
import { crawlSource } from './crawl';
import { normalizeOffer } from './normalize';
import { NormalizedOffer, RunReport, SourceCoverage } from './types';
import { saveRun } from './store';

export const BATCH_SIZE = 6;
export const BATCH_COUNT = Math.ceil(SHOPS.length / BATCH_SIZE);

function utcDateKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function key(o: NormalizedOffer) {
  return `${o.brand}|${o.name}|${o.color || ''}`.toLowerCase().replace(/\s+/g, ' ');
}

async function db() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  const sql = neon(process.env.DATABASE_URL);
  await sql`
    CREATE TABLE IF NOT EXISTS agent_batch_runs(
      run_date text NOT NULL,
      batch_index integer NOT NULL,
      started_at timestamptz NOT NULL,
      finished_at timestamptz NOT NULL,
      source_count integer NOT NULL,
      coverage jsonb NOT NULL,
      offers jsonb NOT NULL,
      PRIMARY KEY(run_date, batch_index)
    )
  `;
  return sql;
}

export async function runBatch(batchIndex: number) {
  if (!Number.isInteger(batchIndex) || batchIndex < 0 || batchIndex >= BATCH_COUNT) {
    throw new Error(`invalid batch index ${batchIndex}; expected 0..${BATCH_COUNT - 1}`);
  }

  const runDate = utcDateKey();
  const startedAt = new Date().toISOString();
  const sources = SHOPS.slice(batchIndex * BATCH_SIZE, (batchIndex + 1) * BATCH_SIZE);
  const limit = pLimit(3);

  console.info(`[batch] start date=${runDate} batch=${batchIndex} sources=${sources.length}`);

  const results = await Promise.all(sources.map((source) => limit(() => crawlSource(source))));
  const raw = results.flatMap((r) => r.offers);
  const normalized = (await Promise.all(raw.map(normalizeOffer))).filter(Boolean) as NormalizedOffer[];
  const coverage = results.map((r) => r.coverage);
  const finishedAt = new Date().toISOString();

  const sql = await db();
  await sql`
    INSERT INTO agent_batch_runs(run_date,batch_index,started_at,finished_at,source_count,coverage,offers)
    VALUES (
      ${runDate},
      ${batchIndex},
      ${startedAt},
      ${finishedAt},
      ${sources.length},
      ${JSON.stringify(coverage)}::jsonb,
      ${JSON.stringify(normalized)}::jsonb
    )
    ON CONFLICT (run_date,batch_index) DO UPDATE SET
      started_at=EXCLUDED.started_at,
      finished_at=EXCLUDED.finished_at,
      source_count=EXCLUDED.source_count,
      coverage=EXCLUDED.coverage,
      offers=EXCLUDED.offers
  `;

  console.info(`[batch] success date=${runDate} batch=${batchIndex} normalized=${normalized.length}`);

  return {
    runDate,
    batchIndex,
    batchCount: BATCH_COUNT,
    sourceCount: sources.length,
    normalizedOffers: normalized.length,
    coverage,
    startedAt,
    finishedAt,
  };
}

export async function finalizeBatches(runDate = utcDateKey()) {
  const sql = await db();
  const rows = await sql`
    SELECT batch_index, started_at, finished_at, source_count, coverage, offers
    FROM agent_batch_runs
    WHERE run_date = ${runDate}
    ORDER BY batch_index ASC
  `;

  const coverage = rows.flatMap((r: any) => r.coverage as SourceCoverage[]);
  const normalized = rows.flatMap((r: any) => r.offers as NormalizedOffer[]);

  const best = new Map<string, NormalizedOffer>();
  for (const o of normalized) {
    const k = key(o);
    const prev = best.get(k);
    if (!prev || o.effectiveCostEur < prev.effectiveCostEur) best.set(k, o);
  }

  const unique = [...best.values()].sort((a, b) => b.score - a.score);
  const deals = unique
    .filter((x) => x.effectiveDiscountPct >= PROFILE.minEffectiveDiscountPct && x.class !== 'Near Miss')
    .slice(0, 5);
  const near = unique
    .filter((x) => x.effectiveDiscountPct < PROFILE.minEffectiveDiscountPct && x.effectiveDiscountPct >= 30)
    .slice(0, 3);

  const count = (status: string) => coverage.filter((x) => x.status === status).length;
  const startedAt = rows.length
    ? new Date(Math.min(...rows.map((r: any) => new Date(r.started_at).getTime()))).toISOString()
    : new Date().toISOString();
  const finishedAt = new Date().toISOString();

  const report: RunReport = {
    startedAt,
    finishedAt,
    plannedSources: SHOPS.length,
    attemptedSources: coverage.length,
    success: count('success'),
    partial: count('partial'),
    browser: count('browser'),
    blocked: count('blocked'),
    failed: count('failed'),
    rawOffers: normalized.length,
    normalizedOffers: normalized.length,
    qualifiedDeals: deals.length,
    nearMisses: near.length,
    coverage,
  };

  await saveRun(report, deals, near);

  console.info(
    `[finalize] date=${runDate} batches=${rows.length}/${BATCH_COUNT} attempted=${coverage.length}/${SHOPS.length} deals=${deals.length}`
  );

  return {
    runDate,
    complete: rows.length === BATCH_COUNT,
    completedBatches: rows.length,
    expectedBatches: BATCH_COUNT,
    deals,
    nearMisses: near,
    report,
  };
}
