import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { PROFILE } from '../config/profile';
import { RawOffer, ShopSource } from './types';

type FeedMeta = {
  advertiserId:string;
  advertiserName:string;
  membershipStatus:string;
  feedId:string;
  feedName:string;
  language:string;
  vertical:string;
  lastImported:string;
  url:string;
};

export type AwinIngestResult = {
  configured:boolean;
  matchedFeed?:FeedMeta;
  offers:RawOffer[];
  note:string;
};

export const AWIN_ADVERTISERS: Record<string,number> = {
  bergfreunde: 14102,
  bergzeit: 12557,
  sportscheck: 14607,
  'sport-bittl': 64060,
  engelhorn: 13759,
  'intersport-de': 14050,
  'decathlon-de': 14353,
  galeria: 46809,
  hardloop: 25688,
  breuninger: 11590,
  'blue-tomato': 11873,
  sportdeal24: 15416,
};

let feedListCache: Promise<FeedMeta[]> | null = null;

function n(v:any){ return String(v ?? '').trim(); }
function money(v:any):number|undefined{
  const s=n(v).replace(/\s+/g,'').replace(/€/g,'');
  if(!s) return undefined;
  const normalized = s.includes(',') && !s.includes('.') ? s.replace(',','.') :
    s.includes(',') && s.includes('.') ? s.replace(/\./g,'').replace(',','.') : s;
  const x=Number(normalized);
  return Number.isFinite(x)&&x>=0?x:undefined;
}
function brandAllowed(raw:string){
  const x=n(raw).toLowerCase().replace(/[’']/g,"'");
  return PROFILE.brands.find(b=>b.toLowerCase().replace(/[’']/g,"'")===x);
}
function canonical(raw:string){
  try{
    const u=new URL(n(raw));
    u.hash='';
    return u.toString();
  }catch{return n(raw)}
}
function isRelevantLongMensPants(row:Record<string,string>){
  const name=n(row.product_name);
  const cat=[row.merchant_category,row.category_name,row.product_type,row.merchant_product_category_path,row.keywords].map(n).join(' ');
  const gender=n(row.suitable_for || row.gender).toLowerCase();
  const hay=(name+' '+cat).toLowerCase();

  const male = !gender || /male|men|mens|herren|unisex/.test(gender) || /herren|men/.test(cat.toLowerCase());
  if(!male) return false;
  if(!/(\bhose\b|\bhosen\b|\bpants?\b|\btrousers?\b|trekkinghose|wanderhose|outdoorhose)/i.test(hay)) return false;
  if(/shorts?\b|kurze hose|regenhose|hardshell|skihose|ski pants|skitour|langlauf|zip[- ]?off|convertible|bib\b|latzhose|kids?|kinder|junior|fahrrad|cycling|\bmtb\b/i.test(hay)) return false;
  return true;
}
function parseSizeStockStatus(v:string):string[]{
  const s=n(v); if(!s) return [];
  const out:string[]=[];
  for(const part of s.split(/[|;]/)){
    const p=part.trim(); if(!p) continue;
    const m=p.match(/^([^:]+):(.+)$/);
    if(m){
      if(/available|in.?stock|true|yes|1/i.test(m[2]) && !/unavailable|out.?of.?stock|false|no|0/i.test(m[2])) out.push(m[1].trim());
    } else out.push(p);
  }
  return out;
}
function parseSizeStockAmount(v:string):string[]{
  const s=n(v); if(!s) return [];
  const out:string[]=[];
  for(const part of s.split(/[|;]/)){
    const m=part.trim().match(/^([^:]+):(\d+(?:[.,]\d+)?)$/);
    if(m && Number(m[2].replace(',','.'))>0) out.push(m[1].trim());
  }
  return out;
}
function sizesOf(row:Record<string,string>){
  const vals=[
    n(row.size),
    ...parseSizeStockStatus(row.size_stock_status),
    ...parseSizeStockAmount(row.size_stock_amount)
  ].filter(Boolean);
  return [...new Set(vals)];
}
function inStock(row:Record<string,string>){
  const a=n(row.in_stock).toLowerCase(), s=n(row.stock_status).toLowerCase();
  if(a==='0'||/out.?of.?stock|not.?available|unavailable/.test(s)) return false;
  if(a==='1'||/in.?stock|available/.test(s)) return true;
  const q=money(row.stock_quantity);
  return q==null?true:q>0;
}


type CsvState={field:string,row:string[],inQuotes:boolean,pendingQuote:boolean};

function csvFeed(state:CsvState, chunk:string, delimiter=','){
  const rows:string[][]=[];
  let i=0;
  while(i<chunk.length){
    let ch=chunk[i];

    if(state.pendingQuote){
      state.pendingQuote=false;
      if(ch==='"'){
        state.field+='"';
        i++;
        continue;
      }
      state.inQuotes=false;
      continue; // re-process current character outside quotes
    }

    if(state.inQuotes){
      if(ch==='"'){
        if(i+1<chunk.length){
          if(chunk[i+1]==='"'){ state.field+='"'; i+=2; continue; }
          state.inQuotes=false; i++; continue;
        }
        state.pendingQuote=true; i++; continue;
      }
      state.field+=ch; i++; continue;
    }

    if(ch==='"'){ state.inQuotes=true; i++; continue; }
    if(ch===delimiter){ state.row.push(state.field); state.field=''; i++; continue; }
    if(ch==='\n'){
      state.row.push(state.field.replace(/\r$/,''));
      rows.push(state.row);
      state.row=[]; state.field='';
      i++; continue;
    }
    state.field+=ch; i++;
  }
  return rows;
}
function csvFinish(state:CsvState){
  if(state.pendingQuote){ state.pendingQuote=false; state.inQuotes=false; }
  if(state.field.length||state.row.length){
    state.row.push(state.field.replace(/\r$/,''));
    const row=state.row; state.row=[]; state.field=''; return row;
  }
  return null;
}
function rowsToObjects(rows:string[][]){
  if(!rows.length) return [] as Record<string,string>[];
  const headers=rows[0].map(x=>x.replace(/^\uFEFF/,'').trim());
  return rows.slice(1).filter(r=>r.some(Boolean)).map(r=>{
    const o:Record<string,string>={}; headers.forEach((h,i)=>o[h]=r[i]??''); return o;
  });
}
async function* csvObjects(stream:Readable){
  const decoder=new TextDecoder();
  const state:CsvState={field:'',row:[],inQuotes:false,pendingQuote:false};
  let headers:string[]|null=null;
  for await(const chunk of stream){
    const rows=csvFeed(state,decoder.decode(chunk as Uint8Array,{stream:true}));
    for(const row of rows){
      if(!headers){ headers=row.map(x=>x.replace(/^\uFEFF/,'').trim()); continue; }
      if(!row.some(Boolean)) continue;
      const o:Record<string,string>={}; headers.forEach((h,i)=>o[h]=row[i]??''); yield o;
    }
  }
  const tail=decoder.decode(); if(tail) for(const row of csvFeed(state,tail)){
    if(!headers){headers=row.map(x=>x.replace(/^\uFEFF/,'').trim());continue}
    const o:Record<string,string>={}; headers.forEach((h,i)=>o[h]=row[i]??''); yield o;
  }
  const last=csvFinish(state);
  if(last){
    if(!headers) headers=last.map(x=>x.replace(/^\uFEFF/,'').trim());
    else { const o:Record<string,string>={}; headers.forEach((h,i)=>o[h]=last[i]??''); yield o; }
  }
}

async function loadFeedList():Promise<FeedMeta[]>{
  const key=process.env.AWIN_DATAFEED_API_KEY;
  if(!key) return [];
  const r=await fetch('https://productdata.awin.com/datafeed/list/apikey/'+encodeURIComponent(key),{
    headers:{'user-agent':'OutdoorDealAgent/1.0'},
    signal:AbortSignal.timeout(20000)
  });
  if(!r.ok) throw new Error('Awin feed list HTTP '+r.status);
  const text=await r.text();
  const state:CsvState={field:'',row:[],inQuotes:false,pendingQuote:false};
  const rows=csvFeed(state,text);
  const last=csvFinish(state); if(last) rows.push(last);
  const objects=rowsToObjects(rows);
  return objects.map(row=>({
    advertiserId:n(row['Advertiser ID'] || row['Advertiser Id'] || row['advertiser_id']),
    advertiserName:n(row['Advertiser Name'] || row['advertiser_name']),
    membershipStatus:n(row['Membership Status'] || row['membership_status']),
    feedId:n(row['Feed ID'] || row['Feed Id'] || row['feed_id']),
    feedName:n(row['Feed Name'] || row['feed_name']),
    language:n(row['Language'] || row['language']),
    vertical:n(row['Vertical'] || row['vertical']),
    lastImported:n(row['Last Imported'] || row['last_imported']),
    url:n(row['URL'] || row['Url'] || row['url']),
  })).filter(x=>x.advertiserId&&x.url);
}
async function feedList(){
  if(!feedListCache) feedListCache=loadFeedList().catch(e=>{feedListCache=null;throw e});
  return feedListCache;
}
function chooseFeed(feeds:FeedMeta[], advertiserId:number){
  const matches=feeds.filter(f=>Number(f.advertiserId)===advertiserId);
  return matches.sort((a,b)=>{
    const aDe=/german|de[_-]de|deutsch/i.test(a.language)?1:0;
    const bDe=/german|de[_-]de|deutsch/i.test(b.language)?1:0;
    const aJoined=/joined|active|approved/i.test(a.membershipStatus)?1:0;
    const bJoined=/joined|active|approved/i.test(b.membershipStatus)?1:0;
    return bJoined-aJoined || bDe-aDe || String(b.lastImported).localeCompare(String(a.lastImported));
  })[0];
}
async function readableCsv(response:Response){
  if(!response.body) throw new Error('Awin feed returned no body');
  const original=Readable.fromWeb(response.body as any);
  const it=original[Symbol.asyncIterator]();
  const first=await it.next();
  if(first.done) return Readable.from([]);
  const head=Buffer.from(first.value);
  const combined=Readable.from((async function*(){
    yield head;
    for await(const chunk of { [Symbol.asyncIterator]:()=>it } as any) yield chunk;
  })());
  const gz=head.length>=2 && head[0]===0x1f && head[1]===0x8b;
  return gz ? combined.pipe(createGunzip()) : combined;
}

export async function ingestAwinProductFeed(source:ShopSource):Promise<AwinIngestResult>{
  const advertiserId=AWIN_ADVERTISERS[source.id];
  if(!advertiserId) return {configured:false,offers:[],note:'No Awin advertiser mapping'};
  if(!process.env.AWIN_DATAFEED_API_KEY) return {configured:false,offers:[],note:'AWIN_DATAFEED_API_KEY not configured'};

  const feeds=await feedList();
  const feed=chooseFeed(feeds,advertiserId);
  if(!feed) return {configured:true,offers:[],note:'No accessible Awin feed for advertiser '+advertiserId};

  const r=await fetch(feed.url,{
    headers:{'user-agent':'OutdoorDealAgent/1.0'},
    signal:AbortSignal.timeout(120000)
  });
  if(!r.ok) throw new Error('Awin product feed HTTP '+r.status);

  const stream=await readableCsv(r);
  const grouped=new Map<string,RawOffer>();
  for await(const row of csvObjects(stream)){
    const brand=brandAllowed(row.brand_name);
    if(!brand || !isRelevantLongMensPants(row) || !inStock(row)) continue;

    const price=money(row.search_price) ?? money(row.price);
    const rrp=money(row.rrp_price);
    if(!price || !rrp || rrp<=price) continue; // Preserve existing verified-RRP deal logic.

    const merchantUrl=canonical(row.merchant_deep_link || row.deep_link);
    if(!merchantUrl) continue;
    const condition=n(row.condition).toLowerCase();
    if(condition && !/new|neu/.test(condition)) continue;

    const sizes=sizesOf(row);
    const image=n(row.merchant_image_url || row.large_image || row.aw_image_url);
    const shipping=money(row.delivery_cost);
    const model=n(row.parent_product_id || row.merchant_product_id || row.model_number || row.aw_product_id) || merchantUrl;
    const name=n(row.product_name);
    const key=(model+'|'+brand+'|'+name+'|'+n(row.colour)).toLowerCase();
    const prev=grouped.get(key);
    if(prev){
      prev.sizes=[...new Set([...(prev.sizes||[]),...sizes])];
      if(price<Number(prev.price||Infinity)) prev.price=price;
      if(rrp>Number(prev.rrp||0)) prev.rrp=rrp;
      if(shipping!=null && (prev.shipping==null || shipping<prev.shipping)) prev.shipping=shipping;
      continue;
    }

    grouped.set(key,{
      sourceId:source.id,
      merchant:source.name,
      merchantCountry:source.country,
      url:merchantUrl,
      imageUrl:image||undefined,
      brand,
      name,
      color:n(row.colour)||undefined,
      sizes,
      currency:n(row.currency)||'EUR',
      price,
      rrp,
      shipping,
      availability:'in_stock',
      description:[row.product_short_description,row.description,row.specifications].map(n).filter(Boolean).join(' ').slice(0,5000)
    });
  }

  return {
    configured:true,
    matchedFeed:feed,
    offers:[...grouped.values()],
    note:`Awin advertiser ${advertiserId}, feed ${feed.feedId} ${feed.feedName}`
  };
}
