import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';

export async function GET() {
  if(!process.env.DATABASE_URL) return NextResponse.json({error:'DATABASE_URL missing'},{status:503});
  const sql=neon(process.env.DATABASE_URL);
  const rows=await sql`
    SELECT test_key, created_at, result
    FROM agent_critical_tests
    WHERE test_key='critical-retailers-v2-2026-09-24'
  `;
  return NextResponse.json({rows});
}
