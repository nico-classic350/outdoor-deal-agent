import { neon } from '@neondatabase/serverless';
import { NormalizedOffer, RunReport } from './types';

function esc(value:unknown){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));}
function line(o:NormalizedOffer){
  const link=/^https:\/\//.test(o.url)?`<a href="${esc(o.url)}">Zum Shop</a>`:'';
  return `<li><strong>${esc(o.brand)} ${esc(o.name)}</strong> — ${o.effectiveCostEur.toFixed(2)} €,
    ${Math.round(o.effectiveDiscountPct)} % · Größe: ${esc(o.sizeFit)} · ${link}
    ${o.reason?`<br>${esc(o.reason)}`:''}</li>`;
}

export async function sendRunNotification(runDate:string,deals:NormalizedOffer[],near:NormalizedOffer[],report:RunReport){
  const key=process.env.RESEND_API_KEY, recipient=process.env.DEAL_NOTIFY_TO,
    sender=process.env.DEAL_NOTIFY_FROM, database=process.env.DATABASE_URL;
  if(!key||!recipient||!sender||!database) return 'not-configured';
  const sql=neon(database);
  await sql`CREATE TABLE IF NOT EXISTS agent_notifications(run_date text PRIMARY KEY, sent_at timestamptz, state text NOT NULL)`;
  const claimed=await sql`INSERT INTO agent_notifications(run_date,state) VALUES (${runDate},'sending')
    ON CONFLICT (run_date) DO NOTHING RETURNING run_date`;
  if(!claimed.length) return 'already-claimed';
  const html=`<h1>Outdoor Deal Watch · ${esc(runDate)}</h1>
    <h2>${deals.length} bestätigte Deals</h2><ol>${deals.map(line).join('')}</ol>
    ${deals.length?'':`<h2>Prüfkandidaten</h2><ol>${near.map(line).join('')}</ol>`}
    <h2>Quellen</h2><p>${report.attemptedSources}/${report.plannedSources} geprüft ·
    ${report.success} erfolgreich · ${report.partial} eingeschränkt · ${report.failed} fehlgeschlagen ·
    ${report.blocked} blockiert.</p>
    <ul>${report.coverage.map(c=>`<li>${esc(c.name)}: ${esc(c.status)} · ${c.parsedOffers} Rohangebote ·
      ${c.pricedOffers??0} verwertbar · ${c.qualifiedOffers??0} bestätigte Deals</li>`).join('')}</ul>`;
  try{
    const response=await fetch('https://api.resend.com/emails',{
      method:'POST',signal:AbortSignal.timeout(12000),
      headers:{authorization:`Bearer ${key}`,'content-type':'application/json','Idempotency-Key':`outdoor-deals/${runDate}`},
      body:JSON.stringify({from:sender,to:[recipient],subject:`Outdoor Deal Watch ${runDate}: ${deals.length} bestätigte Deals`,html})
    });
    if(!response.ok) throw new Error(`notification HTTP ${response.status}`);
    await sql`UPDATE agent_notifications SET state='sent', sent_at=now() WHERE run_date=${runDate}`;
    return 'sent';
  }catch(error){
    await sql`DELETE FROM agent_notifications WHERE run_date=${runDate} AND state='sending'`;
    throw error;
  }
}
