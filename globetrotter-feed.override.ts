import { PROFILE } from '../config/profile';
import { RawOffer, ShopSource } from './types';

const FEED_URL='https://get.cpexp.de/D7n7FR7bDAcf_tiWENNQcskfREnnMWRWi59CNt567U94ENrXUlLPw1ntZaYC6gl7/globetrotter_affiliatede.csv';

function norm(s:string){return s.trim().replace(/^"|"$/g,'')}
function euro(s:string){
  const n=Number(norm(s).replace(/\./g,'').replace(',','.'));
  return Number.isFinite(n)?n:undefined;
}
function brandAllowed(s:string){
  const x=norm(s).toLowerCase().replace(/[’']/g,"'");
  return PROFILE.brands.find(b=>b.toLowerCase().replace(/[’']/g,"'")===x);
}
function relevant(name:string,desc:string,cat:string,gender:string){
  const text=(name+' '+desc+' '+cat).toLowerCase();
  if(!/(hose|hosen|pant|pants|trouser)/i.test(text)) return false;
  if(/(shorts?\b|regenhose|hardshell|skihose|ski hose|bib\b|zip[- ]?off|convertible)/i.test(text)) return false;
  const g=gender.toLowerCase();
  const c=cat.toLowerCase();
  return g.includes('herren') || g.includes('unisex') || c.startsWith('herren >');
}
function canonical(raw:string){
  try{const u=new URL(norm(raw));u.hash='';return u.toString()}catch{return norm(raw)}
}

export async function ingestGlobetrotterOfficialFeed(source:ShopSource):Promise<RawOffer[]>{
  const r=await fetch(FEED_URL,{
    headers:{'user-agent':'OutdoorDealAgent/1.0'},
    signal:AbortSignal.timeout(120000)
  });
  if(!r.ok||!r.body) throw new Error(`Globetrotter feed HTTP ${r.status}`);

  const reader=r.body.getReader();
  const decoder=new TextDecoder();
  let buffer='', header:string[]|null=null;
  const map=new Map<string,RawOffer>();

  const processLine=(line:string)=>{
    if(!line.trim()) return;
    const cols=line.split('\t');
    if(!header){header=cols.map(norm);return}
    const row:Record<string,string>={};
    header.forEach((h,i)=>row[h]=cols[i]??'');

    const brand=brandAllowed(row['Hersteller']||'');
    if(!brand) return;
    const name=norm(row['Bezeichnung']||'');
    const desc=norm(row['Beschreibung']||'');
    const cat=norm(row['Kategorie']||'');
    const gender=norm(row['Geschlecht']||'');
    if(!relevant(name,desc,cat,gender)) return;

    const price=euro(row['VK']||'');
    if(!price) return;
    const url=canonical(row['Partnerlink']||'');
    if(!url) return;
    const size=norm(row['Groesse']||'');
    const shipping=euro(row['Versandkosten']||'');
    const availability=norm(row['Lieferstatus']||'');
    const model=norm(row['Modellnr']||'') || url;
    const key=(model+'|'+brand+'|'+name).toLowerCase();
    const prev=map.get(key);
    if(prev){
      if(size && !prev.sizes?.includes(size)) prev.sizes=[...(prev.sizes||[]),size];
      if(/sofort lieferbar/i.test(availability)) prev.availability='in_stock';
      return;
    }

    map.set(key,{
      sourceId:source.id,
      merchant:source.name,
      merchantCountry:source.country,
      url,
      imageUrl:norm(row['Bild-url']||'')||undefined,
      brand,
      name,
      sizes:size?[size]:[],
      currency:norm(row['Währung']||'EUR')||'EUR',
      price,
      // The official feed has no MSRP/UVP field. Never invent one.
      shipping,
      availability:/sofort lieferbar/i.test(availability)?'in_stock':availability,
      description:desc
    });
  };

  while(true){
    const {done,value}=await reader.read();
    if(done) break;
    buffer+=decoder.decode(value,{stream:true});
    let idx;
    while((idx=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,idx).replace(/\r$/,'');
      buffer=buffer.slice(idx+1);
      processLine(line);
    }
  }
  buffer+=decoder.decode();
  if(buffer) processLine(buffer);
  return [...map.values()];
}
