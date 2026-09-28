import { neon } from '@neondatabase/serverless';
import { NormalizedOffer, RunReport } from './types';

function esc(value:unknown){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));}
function line(o:NormalizedOffer){
  const link=/^https:\/\//.test(o.url)?`<a href="${esc(o.url)}">Zum Shop</a>`:'';
  return `<li><strong>${esc(o.brand)} ${esc(o.name)}</strong> — ${o.effectiveCostEur.toFixed(2)} €,
    ${Math.round(o.effectiveDiscountPct)} % · Größe: ${esc(o.sizeFit)} · ${link}
    ${o.reason?`<br>${esc(o.reason)}`:''}</li>`;
}
function signed(value:number|null){return value===null?'—':`${value>0?'+':''}${value}`}

export function notificationConfig() {
  const missing = (['RESEND_API_KEY', 'DEAL_NOTIFY_TO', 'DEAL_NOTIFY_FROM', 'DATABASE_URL'] as const)
    .filter(name => !process.env[name]);
  return { configured: missing.length === 0, missing };
}

export async function sendRunNotification(runDate:string,deals:NormalizedOffer[],near:NormalizedOffer[],report:RunReport,snapshotAt:string){
  const key=process.env.RESEND_API_KEY, recipient=process.env.DEAL_NOTIFY_TO,
    sender=process.env.DEAL_NOTIFY_FROM, database=process.env.DATABASE_URL;
  if(!notificationConfig().configured) return 'not-configured';
  const sql=neon(database);
  // A batch snapshot has a stable identity even when finalization is retried.
  // A same-day full recrawl receives its own corrected report exactly once.
  await sql`CREATE TABLE IF NOT EXISTS agent_notification_snapshots(
    run_date text NOT NULL,snapshot_at timestamptz NOT NULL,sent_at timestamptz,
    state text NOT NULL,PRIMARY KEY(run_date,snapshot_at))`;
  const claimed=await sql`INSERT INTO agent_notification_snapshots(run_date,snapshot_at,state)
    VALUES (${runDate},${snapshotAt},'sending') ON CONFLICT (run_date,snapshot_at) DO NOTHING RETURNING run_date`;
  if(!claimed.length) return 'already-claimed';
  const comparison=report.comparison;
  const metrics=comparison?.metrics.filter(m=>['reachedSources','sourcesWithProducts','browserRecoveredSources','browserProviderLimitedSources','rawOffers','normalizedOffers','confirmedSizeOffers','qualifiedDeals','nearMisses','blocked','failed'].includes(m.metric))||[];
  const labels:Record<string,string>={reachedSources:'Shops erreicht',sourcesWithProducts:'Shops mit Produkten',browserRecoveredSources:'Browser brachte Produkte',browserProviderLimitedSources:'Browserdienst limitiert',rawOffers:'Rohangebote',normalizedOffers:'Verwertbare Angebote',confirmedSizeOffers:'Größe bestätigt',qualifiedDeals:'Bestätigte Deals',nearMisses:'Prüfkandidaten',blocked:'Blockiert',failed:'Fehlgeschlagen'};
  const changes=comparison?.sources.filter(s=>s.parsedDelta!==0||s.status!==s.previousStatus)||[];
  const html=`<h1>Outdoor Deal Watch · ${esc(runDate)}</h1>
    ${comparison?`<h2>Veränderung zum ${comparison.baselineKind==='same-day-rerun'?'vorigen Bericht von heute':'vorigen Tagesbericht'}</h2>
    <p>Vergleichsbasis: ${esc(comparison.baseline.finishedAt)}. Shopdaten können sich zwischen Läufen ändern.</p>
    <table border="1" cellpadding="6"><thead><tr><th>Stufe</th><th>Vorher</th><th>Jetzt</th><th>Delta</th></tr></thead><tbody>
    ${metrics.map(m=>`<tr><td>${esc(labels[m.metric]||m.metric)}</td><td>${m.previous??'—'}</td><td>${m.current}</td><td>${signed(m.delta)}</td></tr>`).join('')}</tbody></table>
    <h3>Geänderte Shops</h3><ul>${changes.map(s=>`<li>${esc(s.name)}: ${esc(s.previousStatus??'—')} → ${esc(s.status)} · Rohangebote ${s.previousParsedOffers??'—'} → ${s.parsedOffers} (${signed(s.parsedDelta)}) · verwertbar ${s.previousPricedOffers??'—'} → ${s.pricedOffers??'—'} (${signed(s.pricedDelta)})</li>`).join('')}</ul>`:''}
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
      headers:{authorization:`Bearer ${key}`,'content-type':'application/json','Idempotency-Key':`outdoor-deals/${runDate}/${snapshotAt}`},
      body:JSON.stringify({from:sender,to:[recipient],subject:`Outdoor Deal Watch ${runDate}${comparison?.baselineKind==='same-day-rerun'?' (aktualisiert)':''}: ${deals.length} bestätigte Deals`,html})
    });
    if(!response.ok) throw new Error(`notification HTTP ${response.status}`);
    await sql`UPDATE agent_notification_snapshots SET state='sent', sent_at=now()
      WHERE run_date=${runDate} AND snapshot_at=${snapshotAt}`;
    return 'sent';
  }catch(error){
    await sql`DELETE FROM agent_notification_snapshots
      WHERE run_date=${runDate} AND snapshot_at=${snapshotAt} AND state='sending'`;
    throw error;
  }
}
