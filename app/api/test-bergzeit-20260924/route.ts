import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { SHOPS } from '../../../config/shops';
import { crawlSource } from '../../../lib/crawl';

export const runtime='nodejs';
export const maxDuration=300;

export async function GET(){
  const today=new Date().toISOString().slice(0,10);
  if(today!=='2026-09-24') return NextResponse.json({error:'expired'},{status:410});
  if(!process.env.DATABASE_URL) return NextResponse.json({error:'DATABASE_URL missing'},{status:503});
  const sql=neon(process.env.DATABASE_URL);
  await sql`CREATE TABLE IF NOT EXISTS agent_single_tests(
    test_key text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    result jsonb
  )`;
  const key='bergzeit-state-v1-2026-09-24';
  const lock=await sql`INSERT INTO agent_single_tests(test_key,result) VALUES(${key},null)
    ON CONFLICT(test_key) DO NOTHING RETURNING test_key`;
  if(!lock.length) return NextResponse.json({error:'already_run'},{status:409});
  const source=SHOPS.find(s=>s.id==='bergzeit');
  if(!source) return NextResponse.json({error:'source_missing'},{status:500});
  const r=await crawlSource(source);
  const unique=[...new Map(r.offers.map(o=>[(o.url+'|'+o.name).toLowerCase(),o])).values()];
  const payload={coverage:r.coverage,offerCount:r.offers.length,uniqueCount:unique.length,
    brands:[...new Set(unique.map(o=>o.brand).filter(Boolean))].sort(),
    sample:unique.slice(0,20)};
  await sql`UPDATE agent_single_tests SET result=${JSON.stringify(payload)}::jsonb WHERE test_key=${key}`;
  return NextResponse.json({ok:true,...payload});
}
