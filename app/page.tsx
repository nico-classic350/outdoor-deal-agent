import { latestRun, recentPriceHistory } from '../lib/store';
import { selectOffers, productEligible } from '../lib/product-rules.mjs';
import { PROFILE } from '../config/profile';
import { DealDashboard } from './components/deal-dashboard';
import type { NormalizedOffer, RunReport } from '../lib/types';
import { notificationState } from '../lib/notify';
import { neon } from '@neondatabase/serverless';
import { listHidden, signHideKey, withoutHidden } from '../lib/hidden-offers';

export const dynamic='force-dynamic';

export default async function Home(){
  const [stored,history]=await Promise.all([latestRun(),recentPriceHistory()]);
  const candidates=stored?[...(Array.isArray(stored.deals)?stored.deals:[]),
    ...(Array.isArray(stored.near_misses)?stored.near_misses:[])]
    .filter((o:NormalizedOffer)=>o&&typeof o.name==='string'&&productEligible(o.name,o.description)):[];
  const hiddenList=process.env.DATABASE_URL?await listHidden(neon(process.env.DATABASE_URL)).catch(()=>[]):[];
  const selected=selectOffers(withoutHidden(candidates,new Set(hiddenList.map(h=>h.key))),PROFILE.minEffectiveDiscountPct);
  const snapshot=stored?.report?.batchSnapshotAt;
  const emailStatus=snapshot ? await notificationState(String(stored.run_key),snapshot).catch(()=>'pending' as const) : 'pending';
  const b64=(v:string)=>Buffer.from(v,'utf8').toString('base64url');
  return <>
    <DealDashboard deals={selected.deals as NormalizedOffer[]}
      near={selected.near as NormalizedOffer[]}
      report={(stored?.report??null) as RunReport|null} history={history} emailStatus={emailStatus}/>
    {hiddenList.length?<section className="sources" aria-label="Ausgeblendete Hosen"><div className="section-heading"><div>
      <p className="overline dark">AUSGEBLENDET</p><h2>Als nicht relevant markiert ({hiddenList.length})</h2></div></div>
      <ul>{hiddenList.map(h=><li key={h.key}><form method="post" action="/api/hide" style={{display:'inline'}}>
        <input type="hidden" name="k" value={b64(h.key)}/><input type="hidden" name="l" value={b64(h.label)}/>
        <input type="hidden" name="s" value={signHideKey(h.key)||''}/><input type="hidden" name="action" value="unhide"/>
        {h.label} · <button type="submit">wieder anzeigen</button></form></li>)}</ul></section>:null}
  </>;
}
