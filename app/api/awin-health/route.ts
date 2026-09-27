import { NextResponse } from 'next/server';
import { AWIN_ADVERTISERS, awinFeedSummary } from '../../../lib/awin-feed';
export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(){
  if(!process.env.AWIN_DATAFEED_API_KEY) return NextResponse.json({
    ok:true,awinConfigured:false,targetCount:Object.keys(AWIN_ADVERTISERS).length,
    accessibleTargetCount:0,targets:Object.entries(AWIN_ADVERTISERS).map(([sourceId,advertiserId])=>({sourceId,advertiserId,accessible:false}))
  });
  try{
    const targets=await awinFeedSummary();
    return NextResponse.json({ok:true,awinConfigured:true,feedListReachable:true,
      targetCount:targets.length,accessibleTargetCount:targets.filter(t=>t.accessible).length,targets},
      {headers:{'Cache-Control':'no-store'}});
  }catch{
    return NextResponse.json({ok:false,awinConfigured:true,feedListReachable:false,error:'awin_feed_list_unreachable'},
      {status:502,headers:{'Cache-Control':'no-store'}});
  }
}
