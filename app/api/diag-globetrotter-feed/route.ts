import { NextResponse } from 'next/server';
export const runtime='nodejs';
export async function GET(){
  const url='https://get.cpexp.de/D7n7FR7bDAcf_tiWENNQcskfREnnMWRWi59CNt567U94ENrXUlLPw1ntZaYC6gl7/globetrotter_affiliatede.csv';
  const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(20000)});
  const text=await r.text();
  const lines=text.split(/\r?\n/).slice(0,4);
  return NextResponse.json({status:r.status,length:text.length,contentType:r.headers.get('content-type'),lines});
}
