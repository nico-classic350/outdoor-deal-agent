import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 503 });
  }
  const sql = neon(process.env.DATABASE_URL);
  const runDate = new Date().toISOString().slice(0,10);
  const rows = await sql`
    SELECT batch_index, started_at, finished_at, source_count, coverage,
           jsonb_array_length(offers) AS normalized_offer_count
    FROM agent_batch_runs
    WHERE run_date = ${runDate}
    ORDER BY batch_index ASC
  `;
  return NextResponse.json(
    { runDate, batches: rows },
    { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' } }
  );
}
