import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { runBatch } from '../../../lib/batch-run';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== '2026-09-24') {
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 503 });
  }

  const sql = neon(process.env.DATABASE_URL);
  await sql`
    CREATE TABLE IF NOT EXISTS agent_test_once(
      test_key text PRIMARY KEY,
      started_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const rows = await sql`
    INSERT INTO agent_test_once(test_key)
    VALUES ('batch0-2026-09-24')
    ON CONFLICT (test_key) DO NOTHING
    RETURNING test_key
  `;

  if (!rows.length) {
    return NextResponse.json({ error: 'already_run' }, { status: 409 });
  }

  try {
    const result = await runBatch(0);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[test-once] failure error=${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
