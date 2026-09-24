import { NextResponse } from 'next/server';
export const runtime='nodejs';
export async function GET(){
  const url="https://www.bergzeit.de/herren/bekleidung/hosen/?filter.marke=Arc%27teryx";
  const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(15000)});
  const html=await r.text();
  const needle='1149785-006';
  const idx=html.indexOf(needle);
  const snippet=idx>=0?html.slice(Math.max(0,idx-2500),idx+5000):'';
  return NextResponse.json({idx,snippet});
}
