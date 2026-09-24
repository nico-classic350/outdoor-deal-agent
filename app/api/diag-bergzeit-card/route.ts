import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
export const runtime='nodejs';
export async function GET(){
  const url="https://www.bergzeit.de/herren/bekleidung/hosen/?filter.marke=Arc%27teryx";
  const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(15000)});
  const html=await r.text(); const $=cheerio.load(html);
  const a=$('a[href*="/p/arcteryx-herren-gamma-hose/"]').first();
  const levels:any[]=[]; let n=a;
  for(let i=0;i<8&&n.length;i++){
    const t=n.text().replace(/\s+/g,' ').trim();
    levels.push({level:i,tag:n[0]?.tagName,cls:n.attr('class')||'',len:t.length,text:t.slice(0,1000),hasEuro:/€/.test(t)});
    n=n.parent();
  }
  return NextResponse.json({levels});
}
