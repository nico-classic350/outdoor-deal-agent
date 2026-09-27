import { NextRequest, NextResponse } from 'next/server';
import { retryMissingBatch } from '../../../../lib/batch-run';

export const runtime='nodejs';
export const maxDuration=300;

export async function GET(req:NextRequest,ctx:{params:Promise<{batch:string}>}){
  const secret=process.env.CRON_SECRET;
  if(!secret) return NextResponse.json({error:'CRON_SECRET is not configured'},{status:503});
  if(req.headers.get('authorization')!==`Bearer ${secret}`)
    return NextResponse.json({error:'unauthorized'},{status:401});
  const {batch}=await ctx.params;
  try{return NextResponse.json(await retryMissingBatch(Number(batch)),{headers:{'Cache-Control':'no-store'}})}
  catch(error){
    console.error('[retry-batch] failed',batch,error);
    return NextResponse.json({error:'retry_batch_failed'},{status:500});
  }
}
