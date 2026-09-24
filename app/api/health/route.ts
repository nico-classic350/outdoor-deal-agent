import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';

export async function GET() {
  const configured = Boolean(process.env.DATABASE_URL);
  if (!configured) {
    return NextResponse.json({ ok: false, databaseConfigured: false, databaseReachable: false }, { status: 503 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    await sql`SELECT 1 AS ok`;
    const runDate = new Date().toISOString().slice(0, 10);
    const table = await sql`SELECT to_regclass('public.agent_batch_runs') AS name`;
    let batchRowsToday = 0;
    if (table[0]?.name) {
      const rows = await sql`SELECT count(*)::int AS count FROM agent_batch_runs WHERE run_date = ${runDate}`;
      batchRowsToday = Number(rows[0]?.count || 0);
    }
    return NextResponse.json({
      ok: true,
      databaseConfigured: true,
      databaseReachable: true,
      runDate,
      batchTablePresent: Boolean(table[0]?.name),
      batchRowsToday,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[health] database check failed', message);
    return NextResponse.json(
      { ok: false, databaseConfigured: true, databaseReachable: false, error: 'database_unreachable' },
      { status: 503 }
    );
  }
}
