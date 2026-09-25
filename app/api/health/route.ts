import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { BATCH_COUNT } from '../../../lib/batch-run';
import { SHOPS } from '../../../config/shops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const databaseConfigured = Boolean(process.env.DATABASE_URL);
  const base = {
    deploymentSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    sourceCount: SHOPS.length,
    expectedBatches: BATCH_COUNT,
    awinConfigured: Boolean(process.env.AWIN_DATAFEED_API_KEY),
    browserFallbackConfigured: Boolean(process.env.BROWSERLESS_CONTENT_URL),
  };
  if (!databaseConfigured) {
    return NextResponse.json(
      { ok:false, databaseConfigured:false, databaseReachable:false, ...base },
      { status:503, headers:{'Cache-Control':'no-store'} }
    );
  }
  try {
    const sql = neon(process.env.DATABASE_URL!);
    await sql`SELECT 1 AS ok`;
    const runDate = new Date().toISOString().slice(0,10);
    const table = await sql`SELECT to_regclass('public.agent_batch_runs') AS name`;
    let batchRowsToday=0;
    if(table[0]?.name){
      const rows=await sql`SELECT count(*)::int AS count FROM agent_batch_runs WHERE run_date=${runDate}`;
      batchRowsToday=Number(rows[0]?.count||0);
    }
    return NextResponse.json(
      { ok:true,databaseConfigured:true,databaseReachable:true,runDate,
        batchTablePresent:Boolean(table[0]?.name),batchRowsToday,...base },
      { headers:{'Cache-Control':'no-store'} }
    );
  } catch {
    console.error('[health] database check failed');
    return NextResponse.json(
      { ok:false,databaseConfigured:true,databaseReachable:false,...base },
      { status:503, headers:{'Cache-Control':'no-store'} }
    );
  }
}
