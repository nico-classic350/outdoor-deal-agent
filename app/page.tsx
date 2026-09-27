import { latestRun, recentPriceHistory } from '../lib/store';
import { selectOffers, productEligible } from '../lib/product-rules.mjs';
import { PROFILE } from '../config/profile';
import { DealDashboard } from './components/deal-dashboard';
import type { NormalizedOffer, RunReport } from '../lib/types';

export const dynamic='force-dynamic';

export default async function Home(){
  const [stored,history]=await Promise.all([latestRun(),recentPriceHistory()]);
  const candidates=stored?[...(Array.isArray(stored.deals)?stored.deals:[]),
    ...(Array.isArray(stored.near_misses)?stored.near_misses:[])]
    .filter((o:NormalizedOffer)=>o&&typeof o.name==='string'&&productEligible(o.name,o.description)):[];
  const selected=selectOffers(candidates,PROFILE.minEffectiveDiscountPct);
  return <DealDashboard deals={selected.deals as NormalizedOffer[]}
    near={selected.near as NormalizedOffer[]}
    report={(stored?.report??null) as RunReport|null} history={history}/>;
}
