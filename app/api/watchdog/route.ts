import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { BATCH_COUNT, BATCH_SIZE, finalizeBatches, retryMissingBatch } from '../../../lib/batch-run';
import { SHOPS } from '../../../config/shops';
import { retrySavedNotifications } from '../../../lib/notify';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 503 });

  const runDate = new Date().toISOString().slice(0, 10);
  const sql = neon(process.env.DATABASE_URL);
  try {
    const rows = await sql`SELECT batch_index,source_count,finished_at FROM agent_batch_runs WHERE run_date=${runDate}`;
    const completed = new Set(rows.filter(row => {
      const i = Number(row.batch_index);
      return i >= 0 && i < BATCH_COUNT && Number(row.source_count) === SHOPS.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE).length;
    }).map(row => Number(row.batch_index)));
    const missing = Array.from({ length: BATCH_COUNT }, (_, i) => i).filter(i => !completed.has(i));
    let action = 'already-complete';
    let detail: unknown = null;

    if (missing.length) {
      // One bounded batch per invocation; regular retry crons share a database lease.
      action = 'retry-batch';
      detail = await retryMissingBatch(missing[0]);
    } else {
      const finalized = await sql`SELECT report->>'batchSnapshotAt' AS snapshot_at FROM agent_runs WHERE run_key=${runDate} LIMIT 1`;
      const latestBatchAt = Math.max(...rows.map(row => new Date(row.finished_at).getTime()));
      const publishedAt = finalized.length ? new Date(String(finalized[0].snapshot_at || '')).getTime() : NaN;
      if (!finalized.length || !Number.isFinite(publishedAt) || latestBatchAt > publishedAt) {
        action = finalized.length ? 'refinalize' : 'finalize';
        const result = await finalizeBatches(runDate);
        detail = { complete: result.complete, notification: result.complete ? result.notification : null };
      }
    }
    // A run completed after the last recovery window must still be finalized.
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const previousRows = await sql`SELECT batch_index,source_count,finished_at FROM agent_batch_runs WHERE run_date=${yesterday}`;
    const previousComplete = previousRows.length === BATCH_COUNT && previousRows.every(row => {
      const i = Number(row.batch_index);
      return i >= 0 && i < BATCH_COUNT && Number(row.source_count) === SHOPS.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE).length;
    });
    if (previousComplete) {
      const prior = await sql`SELECT report->>'batchSnapshotAt' AS snapshot_at FROM agent_runs WHERE run_key=${yesterday} LIMIT 1`;
      const latest = Math.max(...previousRows.map(row => new Date(row.finished_at).getTime()));
      if (!prior.length || new Date(String(prior[0].snapshot_at || '')).getTime() < latest) {
        await finalizeBatches(yesterday);
      }
    }
    const delivery = await retrySavedNotifications([yesterday, runDate]);
    const todaySent = 'results' in delivery && delivery.results?.some(result => result.runDate === runDate && result.status === 'sent');
    const result = { runDate, completedBatches: completed.size, expectedBatches: BATCH_COUNT,
      missingBatches: missing, action, detail, delivery, complete: missing.length === 0 && Boolean(todaySent) };
    console.info(`[watchdog] ${JSON.stringify(result)}`);
    return NextResponse.json(result, { status: result.complete ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[watchdog] failure', error);
    return NextResponse.json({ error: 'watchdog_failed', runDate }, { status: 500 });
  }
}
