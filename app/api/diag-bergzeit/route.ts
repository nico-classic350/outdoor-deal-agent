import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export const runtime='nodejs';

export async function GET(){
  const url="https://www.bergzeit.de/herren/bekleidung/hosen/?filter.marke=Arc%27teryx";
  const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept-language':'de-DE,de;q=0.9'},redirect:'follow',signal:AbortSignal.timeout(15000)});
  const html=await r.text();
  const $=cheerio.load(html);
  const links=$('a[href]').map((_,el)=>({
    href:$(el).attr('href'),
    text:$(el).text().replace(/\s+/g,' ').trim().slice(0,160),
    cls:$(el).attr('class')||'',
    parent:$(el).parent().text().replace(/\s+/g,' ').trim().slice(0,300)
  })).get().filter((x:any)=>/\/p\//.test(x.href||'') || /gamma|arcteryx/i.test((x.text||'')+' '+(x.parent||''))).slice(0,30);
  const scripts=$('script').map((_,el)=>({
    id:$(el).attr('id')||'',
    type:$(el).attr('type')||'',
    len:($(el).html()||'').length,
    hasProduct:/Gamma|Arc.?teryx|product/i.test($(el).html()||'')
  })).get().filter((x:any)=>x.hasProduct||x.id||/json/i.test(x.type)).slice(0,30);
  return NextResponse.json({status:r.status,length:html.length,title:$('title').text(),linkCount:$('a[href]').length,productLikeLinks:links,scripts});
}
