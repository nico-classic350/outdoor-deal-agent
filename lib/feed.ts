import { RawOffer, ShopSource } from './types';

function n(v:any){return String(v??'').trim()}
function money(v:any){
  const x=Number(n(v).replace(/\s/g,'').replace(/€/g,'').replace(/\./g,'').replace(',','.'));
  return Number.isFinite(x)&&x>0?x:undefined;
}

export async function ingestFeed(source:ShopSource):Promise<RawOffer[]>{
  if(!source.feedUrl) return [];
  const r=await fetch(source.feedUrl,{headers:{'user-agent':'OutdoorDealAgent/1.0'},signal:AbortSignal.timeout(20000)});
  if(!r.ok) return [];
  const type=r.headers.get('content-type')||'';
  const text=await r.text();
  if(/json/i.test(type)||/^\s*[\[{]/.test(text)){
    try{
      const data=JSON.parse(text); const rows=Array.isArray(data)?data:(data.products||data.items||[]);
      return rows.slice(0,500).map((row:any)=>({
        sourceId:source.id,merchant:source.name,merchantCountry:source.country,
        url:n(row.url||row.link),imageUrl:n(row.image||row.imageUrl)||undefined,
        brand:n(row.brand)||undefined,name:n(row.name||row.title)||undefined,
        color:n(row.color)||undefined,sizes:Array.isArray(row.sizes)?row.sizes.map(n):[],
        currency:n(row.currency)||'EUR',price:money(row.price),rrp:money(row.rrp||row.msrp||row.listPrice),
        shipping:money(row.shipping),availability:n(row.availability)||'unknown',description:n(row.description)
      })).filter((x:RawOffer)=>x.url&&x.name&&x.price);
    }catch{return []}
  }
  return [];
}
