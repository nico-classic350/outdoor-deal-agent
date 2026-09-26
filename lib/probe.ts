import { neon } from '@neondatabase/serverless';
import { SHOPS } from '../config/shops';
import { PROFILE } from '../config/profile';
import { BATCH_COUNT } from './batch-run';
import { NormalizedOffer, RunReport, SourceCoverage } from './types';
import { selectOffers, productEligible, offerKey } from './product-rules.mjs';

function sqlClient() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(process.env.DATABASE_URL);
}

export async function replayLatestCompleteSnapshot() {
  const started = Date.now();
  const sql = sqlClient();

  const dates = await sql`
    SELECT run_date, count(DISTINCT batch_index)::int AS batch_count
    FROM agent_batch_runs
    GROUP BY run_date
    HAVING count(DISTINCT batch_index) = ${BATCH_COUNT}
    ORDER BY run_date DESC
    LIMIT 1
  `;

  if (!dates.length) {
    return {
      ok: false as const,
      mode: 'replay' as const,
      error: 'no_complete_snapshot',
      elapsedMs: Date.now() - started,
    };
  }

  const runDate = String(dates[0].run_date);
  const rows = await sql`
    SELECT batch_index, started_at, finished_at, source_count, coverage, offers
    FROM agent_batch_runs
    WHERE run_date = ${runDate}
    ORDER BY batch_index ASC
  `;

  const coverage = rows.flatMap((row: any) => row.coverage as SourceCoverage[]);
  const normalized = rows.flatMap((row: any) => row.offers as NormalizedOffer[]);
  const screened = normalized.filter((offer) => productEligible(offer.name, offer.description));
  const { deals, near } = selectOffers(screened, PROFILE.minEffectiveDiscountPct);
  const distinct = new Set(screened.map(offerKey));
  const count = (status: string) => coverage.filter((item) => item.status === status).length;
  const snapshotStartedAt = new Date(Math.min(...rows.map((row: any) => new Date(row.started_at).getTime()))).toISOString();
  const snapshotFinishedAt = new Date(Math.max(...rows.map((row: any) => new Date(row.finished_at).getTime()))).toISOString();

  const report: RunReport = {
    startedAt: snapshotStartedAt,
    finishedAt: snapshotFinishedAt,
    plannedSources: SHOPS.length,
    attemptedSources: coverage.length,
    success: count('success'),
    partial: count('partial'),
    browser: count('browser'),
    blocked: count('blocked'),
    failed: count('failed'),
    rawOffers: coverage.reduce((sum, item) => sum + Number(item.parsedOffers || 0), 0),
    normalizedOffers: normalized.length,
    screenedOffers: screened.length,
    distinctOffers: distinct.size,
    confirmedSizeOffers: screened.filter((offer) => offer.sizeFit === 'confirmed').length,
    qualifiedDeals: deals.length,
    nearMisses: near.length,
    coverage,
  };

  return {
    ok: true as const,
    mode: 'replay' as const,
    runDate,
    snapshot: {
      completedBatches: rows.length,
      expectedBatches: BATCH_COUNT,
      startedAt: snapshotStartedAt,
      finishedAt: snapshotFinishedAt,
    },
    deals,
    nearMisses: near,
    report,
    elapsedMs: Date.now() - started,
    writesPerformed: false,
    externalMerchantRequests: 0,
  };
}
