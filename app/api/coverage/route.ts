import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { latestRun } from '../../../lib/store';
import { BATCH_COUNT } from '../../../lib/batch-run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const latest = await latestRun();
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
