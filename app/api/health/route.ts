import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { BATCH_COUNT } from '../../../lib/batch-run';
import { SHOPS } from '../../../config/shops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const databaseConfigured = Boolean(process.env.DATABASE_URL);
  const now = new Date();
  const runDate = now.toISOString().slice(0, 10);
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const pipelineExpectedComplete = utcMinutes >= 7 * 60 + 30;

  const base = {
    deploymentSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    sourceCount: SHOPS.length,
    expectedBatches: BATCH_COUNT,
    awinConfigured: Boolean(process.env.AWIN_DATAFEED_API_KEY),
    browserFallbackConfigured: Boolean(process.env.BROWSERLESS_CONTENT_URL),
    runDate,
    pipelineExpectedComplete,
  };

  if (!databaseConfigured) {
    return NextResponse.json(
      { ok: false, databaseConfigured: false, databaseReachable: false, pipelineStatus: 'database-missing', ...base },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    await sql`SELECT 1 AS ok`;

    const tables = await sql`
      SELECT
        to_regclass('public.agent_batch_runs') AS batch_table,
        to_regclass('public.agent_runs') AS run_table
    `;

    const batchTablePresent = Boolean(tables[0]?.batch_table);
    const runTablePresent = Boolean(tables[0]?.run_table);
    let batchRowsToday = 0;
    let latestFinalizedAt: string | null = null;
    let latestFinalizedRunDate: string | null = null;

    if (batchTablePresent) {
      const rows = await sql`
        SELECT count(*)::int AS count
        FROM agent_batch_runs
        WHERE run_date = ${runDate}
      `;
      batchRowsToday = Number(rows[0]?.count || 0);
    }

    if (runTablePresent) {
      const rows = await sql`
        SELECT started_at, finished_at
        FROM agent_runs
        ORDER BY finished_at DESC NULLS LAST, id DESC
        LIMIT 1
      `;
      const row = rows[0];
      if (row?.finished_at) latestFinalizedAt = new Date(row.finished_at).toISOString();
      if (row?.started_at) latestFinalizedRunDate = new Date(row.started_at).toISOString().slice(0, 10);
    }

    const batchesComplete = batchRowsToday === BATCH_COUNT;
    const finalizedToday = latestFinalizedRunDate === runDate;
    const pipelineComplete = batchesComplete && finalizedToday;
    const ok = !pipelineExpectedComplete || pipelineComplete;
    const pipelineStatus = pipelineComplete ? 'complete' : pipelineExpectedComplete ? 'overdue' : 'warming';

    return NextResponse.json(
      {
        ok,
        databaseConfigured: true,
        databaseReachable: true,
        batchTablePresent,
        runTablePresent,
        batchRowsToday,
        batchesComplete,
        finalizedToday,
        latestFinalizedAt,
        latestFinalizedRunDate,
        pipelineStatus,
        ...base,
      },
      { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    console.error('[health] database or pipeline check failed');
    return NextResponse.json(
      { ok: false, databaseConfigured: true, databaseReachable: false, pipelineStatus: 'check-failed', ...base },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
