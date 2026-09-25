import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { latestRun } from '../../../lib/store';
import { BATCH_COUNT } from '../../../lib/batch-run';
import { PROFILE } from '../../../config/profile';
import { productEligible, selectOffers } from '../../../lib/product-rules.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const stored = await latestRun();
  // Older finalized runs can predate the current quality gates. Apply the same
  // publication rules to the read path so a stale report cannot serve false deals.
  const candidates = stored ? [...(Array.isArray(stored.deals) ? stored.deals : []),
    ...(Array.isArray(stored.near_misses) ? stored.near_misses : [])]
    .filter((o: any) => o && typeof o.name === 'string' && productEligible(o.name, o.description)) : [];
  const safe = selectOffers(candidates, PROFILE.minEffectiveDiscountPct);
  const latest = stored ? {
    ...stored,
    deals: safe.deals,
    near_misses: safe.near,
    report: { ...stored.report, qualifiedDeals: safe.deals.length, nearMisses: safe.near.length },
    publicationSafetyApplied: true,
  } : null;
  let pipeline: unknown = null;

  if (process.env.DATABASE_URL) {
    try {
      const sql = neon(process.env.DATABASE_URL);
      const runDate = new Date().toISOString().slice(0, 10);
      const rows = await sql`
        SELECT batch_index
        FROM agent_batch_runs
        WHERE run_date=${runDate}
        ORDER BY batch_index
      `;
      const done = new Set(rows.map((r: any) => Number(r.batch_index)));
      pipeline = {
        runDate,
        completedBatches: done.size,
        expectedBatches: BATCH_COUNT,
        missingBatches: Array.from({ length: BATCH_COUNT }, (_, i) => i).filter(i => !done.has(i)),
        complete: done.size === BATCH_COUNT,
      };
    } catch {
      pipeline = { error: 'pipeline_status_unavailable' };
    }
  }

  return NextResponse.json(
    { latest, pipeline },
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } }
  );
}
