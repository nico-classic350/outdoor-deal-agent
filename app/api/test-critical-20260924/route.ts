import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { SHOPS } from '../../../config/shops';
import { crawlSource } from '../../../lib/crawl';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET() {
  const today=new Date().toISOString().slice(0,10);
  if(today!=='2026-09-24') return NextResponse.json({error:'expired'},{status:410});
  if(!process.env.DATABASE_URL) return NextResponse.json({error:'DATABASE_URL missing'},{status:503});

  const sql=neon(process.env.DATABASE_URL);
  await sql`CREATE TABLE IF NOT EXISTS agent_critical_tests(
    test_key text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    result jsonb
  )`;
  const lock=await sql`
    INSERT INTO agent_critical_tests(test_key,result)
    VALUES ('critical-retailers-v2-2026-09-24', null)
    ON CONFLICT (test_key) DO NOTHING
    RETURNING test_key
  `;
  if(!lock.length) return NextResponse.json({error:'already_run'},{status:409});

  const wanted=new Set(['bergfreunde','bergzeit','globetrotter','sport-schuster']);
  const sources=SHOPS.filter(s=>wanted.has(s.id));
  const results=await Promise.all(sources.map(s=>crawlSource(s)));
  const payload=results.map(r=>({coverage:r.coverage,offers:r.offers.slice(0,100)}));

  await sql`
    UPDATE agent_critical_tests
    SET result=${JSON.stringify(payload)}::jsonb
    WHERE test_key='critical-retailers-v2-2026-09-24'
  `;
  return NextResponse.json({ok:true,results:payload});
}
