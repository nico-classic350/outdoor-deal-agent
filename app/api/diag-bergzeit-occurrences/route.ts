import { NextResponse } from 'next/server';
export const runtime='nodejs';
export async function GET(){
  const url="https://www.bergzeit.de/herren/bekleidung/hosen/?filter.marke=Arc%27teryx";
  const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(15000)});
  const html=await r.text();
  const needle='1149785';
  const out:any[]=[];
  let pos=0;
  while((pos=html.indexOf(needle,pos))>=0 && out.length<12){
    out.push({idx:pos,snippet:html.slice(Math.max(0,pos-500),pos+1200)});
    pos+=needle.length;
  }
  return NextResponse.json({count:out.length,out});
}
