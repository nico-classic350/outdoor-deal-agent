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
    return NextResponse.json({ ok: true, databaseConfigured: true, databaseReachable: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[health] database check failed', message);
    return NextResponse.json(
      { ok: false, databaseConfigured: true, databaseReachable: false, error: 'database_unreachable' },
      { status: 503 }
    );
  }
}
