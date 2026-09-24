import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export const runtime='nodejs';

function summarize(x:any):any{
  if(Array.isArray(x)) return x.slice(0,5).map(summarize);
  if(!x||typeof x!=='object') return x;
  const out:any={};
  for(const k of Object.keys(x).slice(0,30)){
    const v=x[k];
    if(['@type','name','url','offers','itemListElement','price','priceCurrency','lowPrice','highPrice','availability','image'].includes(k)){
      out[k]=summarize(v);
    }
  }
  return out;
}
export async function GET(){
  const url="https://www.bergzeit.de/herren/bekleidung/hosen/?filter.marke=Arc%27teryx";
  const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept-language':'de-DE,de;q=0.9'},signal:AbortSignal.timeout(15000)});
  const html=await r.text(); const $=cheerio.load(html);
  const data:any[]=[];
  $('script[type="application/ld+json"]').each((_,el)=>{
    try{data.push(summarize(JSON.parse($(el).html()||'null')))}catch{}
  });
  return NextResponse.json({data});
}
