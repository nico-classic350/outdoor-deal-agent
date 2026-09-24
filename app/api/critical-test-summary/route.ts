import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';

export async function GET() {
  if(!process.env.DATABASE_URL) return NextResponse.json({error:'DATABASE_URL missing'},{status:503});
  const sql=neon(process.env.DATABASE_URL);
  const rows=await sql`
    SELECT result
    FROM agent_critical_tests
    WHERE test_key='critical-retailers-v2-2026-09-24'
  `;
  const result=rows[0]?.result || [];
  const summary=(result as any[]).map((x:any)=>{
    const offers=x.offers||[];
    const uniqueProducts=new Set(offers.map((o:any)=>{
      try{const u=new URL(o.url); u.search=''; return u.toString()}catch{return o.url}
    }));
    const brands=[...new Set(offers.map((o:any)=>o.brand).filter(Boolean))].sort();
    return {
      sourceId:x.coverage?.sourceId,
      name:x.coverage?.name,
      status:x.coverage?.status,
      elapsedMs:x.coverage?.elapsedMs,
      discoveredUrls:x.coverage?.discoveredUrls,
      parsedOffers:x.coverage?.parsedOffers,
      uniqueProductUrls:uniqueProducts.size,
      brands,
      technicalPath:x.coverage?.technicalPath,
      httpStatuses:x.coverage?.httpStatuses,
      note:x.coverage?.note
    };
  });
  return NextResponse.json({summary});
}
