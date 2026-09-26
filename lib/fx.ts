type RateEntry={rate:number;expires:number};
const cache=new Map<string,RateEntry>();
const FALLBACK:Record<string,number>={EUR:1,CHF:1.06,GBP:1.17,SEK:0.091,NOK:0.087,DKK:0.134,CZK:0.040,PLN:0.234,HUF:0.00255,USD:0.86};

async function rateToEur(currency:string):Promise<number>{
  const c=currency.toUpperCase(); if(c==='EUR') return 1;
  const hit=cache.get(c); if(hit&&hit.expires>Date.now()) return hit.rate;
  try{
    const r=await fetch(`https://api.frankfurter.app/latest?from=${encodeURIComponent(c)}&to=EUR`,{signal:AbortSignal.timeout(5000)});
    if(r.ok){
      const j=await r.json() as any; const rate=Number(j?.rates?.EUR);
      if(Number.isFinite(rate)&&rate>0){cache.set(c,{rate,expires:Date.now()+6*60*60*1000});return rate;}
    }
  }catch{}
  return FALLBACK[c]||1;
}

export async function eurValue(amount:number,currency:string):Promise<number>{
  return amount*await rateToEur(currency||'EUR');
}
