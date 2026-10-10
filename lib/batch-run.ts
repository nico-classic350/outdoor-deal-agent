import pLimit from 'p-limit';
import { neon } from '@neondatabase/serverless';
import { SHOPS } from '../config/shops';
import { PROFILE } from '../config/profile';
import { crawlSource } from './crawl';
import { normalizeOfferChecked } from './normalize';
import { NormalizedOffer, RunReport, SourceCoverage } from './types';
import { runByDate, latestRunBefore, saveRun } from './store';
import { compareCoverage, comparisonBaseline } from './coverage-delta';
import { sendRunNotification } from './notify';
import { loadHiddenKeys, withoutHidden } from './hidden-offers';
import { diagnoseCoverage } from './diagnose';
import { selectOffers, productEligible, offerKey } from './product-rules.mjs';
import { fillVerifiedShipping } from './shipping';
import { loadFreshSnapshots, mergeSnapshot, BrowserSnapshot } from './browser-snapshots';

export const BATCH_SIZE = 6;
export const BATCH_COUNT = Math.ceil(SHOPS.length / BATCH_SIZE);
const BATCH_CONCURRENCY = 3;

let schemaPromise: Promise<void> | null = null;

function utcDateKey(d = new Date()) { return d.toISOString().slice(0, 10); }
function sqlClient() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(process.env.DATABASE_URL);
}
async function db() {
  const sql = sqlClient();
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS agent_batch_runs(
          run_date text NOT NULL,
          batch_index integer NOT NULL,
          started_at timestamptz NOT NULL,
          finished_at timestamptz NOT NULL,
          source_count integer NOT NULL,
          coverage jsonb NOT NULL,
          offers jsonb NOT NULL,
          PRIMARY KEY(run_date, batch_index)
        )
      `;
    })().catch((error) => { schemaPromise = null; throw error; });
  }
  await schemaPromise;
  return sql;
}

export async function runBatch(batchIndex: number) {
  if (!Number.isInteger(batchIndex) || batchIndex < 0 || batchIndex >= BATCH_COUNT) {
    throw new Error(`invalid batch index ${batchIndex}; expected 0..${BATCH_COUNT - 1}`);
  }
  const runDate = utcDateKey();
  const startedAt = new Date().toISOString();
  const sources = SHOPS.slice(batchIndex * BATCH_SIZE, (batchIndex + 1) * BATCH_SIZE);
  const limit = pLimit(BATCH_CONCURRENCY);
  console.info(`[batch] start date=${runDate} batch=${batchIndex} sources=${sources.length}`);

  // Chromium snapshots from the GitHub Actions crawler are optional input.
  let snapshots = new Map<string, BrowserSnapshot>();
  try { snapshots = await loadFreshSnapshots(sqlClient(), sources.map(source => source.id)); }
  catch { console.warn(`[batch] browser-snapshots-unavailable date=${runDate} batch=${batchIndex}`); }
  const results = await Promise.all(sources.map((source) => limit(async () =>
    mergeSnapshot(await crawlSource(source), snapshots.get(source.id)))));
  const snapshotOffers = results.reduce((sum, r) => sum + r.added, 0);
  if (snapshots.size) console.info(`[batch] browser-snapshots date=${runDate} batch=${batchIndex} shops=${snapshots.size} addedOffers=${snapshotOffers}`);
  const raw = results.flatMap((r) => r.offers);
  const shippingVerified = await fillVerifiedShipping(raw);
  if (shippingVerified) results.find(r => r.coverage.sourceId === 'bergfreunde')?.coverage.technicalPath?.push('merchant-shipping-policy-verified');
  const attempted = await Promise.allSettled(raw.map(normalizeOfferChecked));
  const normalized = attempted.filter((r):r is PromiseFulfilledResult<Awaited<ReturnType<typeof normalizeOfferChecked>>>=>r.status==='fulfilled')
    .map(r=>r.value.offer).filter(Boolean) as NormalizedOffer[];
  const rejected = attempted.filter(r=>r.status==='rejected').length;
  if(rejected) console.warn(`[batch] rejected-offers date=${runDate} batch=${batchIndex} count=${rejected}`);
  const coverage = results.map((r) => r.coverage);
  for(const c of coverage){
    const items=normalized.filter(o=>o.sourceId===c.sourceId);
    const sourceRaw=raw.filter(o=>o.sourceId===c.sourceId);
    c.eligibleOffers=sourceRaw.filter(o=>Boolean(o.name&&productEligible(o.name,o.description))).length;
    c.priceEvidenceOffers=sourceRaw.filter(o=>o.name && productEligible(o.name,o.description) &&
      (Boolean(o.rrp && o.rrp>Number(o.price) && o.rrpSource)
        || Boolean(o.discountSource && Number.isFinite(o.observedDiscountPct) && Number(o.observedDiscountPct)>=40))).length;
    c.rejectionReasons={};
    raw.forEach((o,index)=>{
      if(o.sourceId!==c.sourceId)return;
      const result=attempted[index];
      const reason=result.status==='rejected'?'conversion-error':result.value.reason;
      if(reason)c.rejectionReasons![reason]=(c.rejectionReasons![reason]||0)+1;
    });
    c.pricedOffers=items.length;
    c.verifiedReferenceOffers=items.filter(o=>o.rrpVerified).length;
    c.availableSizeOffers=items.filter(o=>o.sizeFit==='confirmed').length;
    c.qualifiedOffers=selectOffers(items,PROFILE.minEffectiveDiscountPct).qualifiedCount;
    if((c.status==='success'||c.status==='browser') && !items.length) c.status='partial';
    c.diagnosticCode=diagnoseCoverage(c);
  }
  const finishedAt = new Date().toISOString();

  const sql = await db();
  await sql`
    INSERT INTO agent_batch_runs(run_date,batch_index,started_at,finished_at,source_count,coverage,offers)
    VALUES (
      ${runDate}, ${batchIndex}, ${startedAt}, ${finishedAt}, ${sources.length},
      ${JSON.stringify(coverage)}::jsonb, ${JSON.stringify(normalized)}::jsonb
    )
    ON CONFLICT (run_date,batch_index) DO UPDATE SET
      started_at=EXCLUDED.started_at, finished_at=EXCLUDED.finished_at,
      source_count=EXCLUDED.source_count, coverage=EXCLUDED.coverage, offers=EXCLUDED.offers
  `;

  console.info(`[batch] success date=${runDate} batch=${batchIndex} raw=${raw.length} normalized=${normalized.length}`);
  return { runDate, batchIndex, batchCount:BATCH_COUNT, sourceCount:sources.length,
    rawOffers:raw.length, normalizedOffers:normalized.length, coverage, startedAt, finishedAt };
}

export async function retryMissingBatch(batchIndex:number){
  if (!Number.isInteger(batchIndex) || batchIndex<0 || batchIndex>=BATCH_COUNT) throw new Error('invalid batch index');
  const sql=await db(), runDate=utcDateKey();
  await sql`CREATE TABLE IF NOT EXISTS agent_batch_retry_leases(
    run_date text NOT NULL, batch_index integer NOT NULL,
    token text NOT NULL, lease_until timestamptz NOT NULL,
    PRIMARY KEY(run_date,batch_index)
  )`;
  const token=crypto.randomUUID();
  const claimed=await sql`INSERT INTO agent_batch_retry_leases(run_date,batch_index,token,lease_until)
    VALUES (${runDate},${batchIndex},${token},now()+interval '6 minutes')
    ON CONFLICT (run_date,batch_index) DO UPDATE SET
      token=EXCLUDED.token, lease_until=EXCLUDED.lease_until
    WHERE agent_batch_retry_leases.lease_until < now()
    RETURNING token`;
  if(!claimed.length) return {runDate,batchIndex,skipped:true,reason:'retry-already-running'};
  try {
    const rows=await sql`SELECT source_count FROM agent_batch_runs WHERE run_date=${runDate} AND batch_index=${batchIndex}`;
    const expected=SHOPS.slice(batchIndex*BATCH_SIZE,(batchIndex+1)*BATCH_SIZE).length;
    if(Number(rows[0]?.source_count)===expected) return {runDate,batchIndex,skipped:true,reason:'batch-complete'};
    return await runBatch(batchIndex);
  } finally {
    await sql`DELETE FROM agent_batch_retry_leases WHERE run_date=${runDate} AND batch_index=${batchIndex} AND token=${token}`;
  }
}

export async function finalizeBatches(runDate = utcDateKey()) {
  const sql = await db();
  const rows = await sql`
    SELECT batch_index, started_at, finished_at, source_count, coverage, offers
    FROM agent_batch_runs WHERE run_date = ${runDate} ORDER BY batch_index ASC
  `;
  const completed = new Set(rows.filter((r:any)=>Number(r.source_count)===SHOPS.slice(Number(r.batch_index)*BATCH_SIZE,(Number(r.batch_index)+1)*BATCH_SIZE).length)
    .map((r:any)=>Number(r.batch_index)));
  const missingBatches = Array.from({length:BATCH_COUNT},(_,i)=>i).filter(i=>!completed.has(i));

  if(missingBatches.length){
    console.warn(`[finalize] incomplete date=${runDate} completed=${rows.length}/${BATCH_COUNT} missing=${missingBatches.join(',')}`);
    return { runDate, complete:false, completedBatches:rows.length, expectedBatches:BATCH_COUNT, missingBatches };
  }

  const coverage = rows.flatMap((r:any)=>r.coverage as SourceCoverage[]);
  const normalized = rows.flatMap((r:any)=>r.offers as NormalizedOffer[]);
  // Reassess persisted candidates at publish time, including batches created
  // before a change to the acceptance rules.
  // Models the recipient marked "nicht relevant" in an earlier mail stay out.
  const hidden=await loadHiddenKeys(sql);
  const screened=withoutHidden(normalized.filter(x=>productEligible(x.name,x.description)),hidden);
  const {deals,near}=selectOffers(screened,PROFILE.minEffectiveDiscountPct);
  const distinct = new Set(screened.map(offerKey));
  const count=(status:string)=>coverage.filter(x=>x.status===status).length;
  const startedAt=new Date(Math.min(...rows.map((r:any)=>new Date(r.started_at).getTime()))).toISOString();
  const finishedAt=new Date().toISOString();
  const snapshotAt=new Date(Math.max(...rows.map((r:any)=>new Date(r.finished_at).getTime()))).toISOString();

  const report:RunReport={
    startedAt,finishedAt,batchSnapshotAt:snapshotAt,plannedSources:SHOPS.length,attemptedSources:coverage.length,
    success:count('success'),partial:count('partial'),browser:count('browser'),
    blocked:count('blocked'),failed:count('failed'),
    rawOffers:coverage.reduce((sum,x)=>sum+Number(x.parsedOffers||0),0),
    normalizedOffers:normalized.length,screenedOffers:screened.length,
    distinctOffers:distinct.size,confirmedSizeOffers:screened.filter(x=>x.sizeFit==='confirmed').length,
    qualifiedDeals:deals.length,nearMisses:near.length,coverage
  };
  const saved=await runByDate(runDate);
  const previous=saved || await latestRunBefore(runDate);
  if (saved?.report?.batchSnapshotAt === snapshotAt) {
    let notification = 'pending';
    try { notification = await sendRunNotification(runDate, saved.deals, saved.near_misses, saved.report, snapshotAt); }
    catch (error) { console.error('[finalize] notification failed', error); notification = 'failed'; }
    console.info(`[finalize] existing snapshot date=${runDate} notification=${notification}`);
    return { runDate, complete: notification === 'sent', dataComplete: true,
      completedBatches: rows.length, expectedBatches: BATCH_COUNT, missingBatches: [],
      deals: saved.deals, nearMisses: saved.near_misses, report: saved.report, notification };
  }
  if(previous?.report?.coverage?.length){
    const baseline=comparisonBaseline(previous,runDate,snapshotAt);
    report.comparison=compareCoverage(report,baseline);
  }
  await saveRun(report,deals,near);
  let notification='not-configured';
  try{notification=await sendRunNotification(runDate,deals,near,report,snapshotAt)}
  catch(error){console.error('[finalize] notification failed',error);notification='failed'}
  console.info(`[finalize] data-saved date=${runDate} attempted=${coverage.length}/${SHOPS.length} deals=${deals.length} notification=${notification}`);
  if(notification==='not-configured') console.warn('[finalize] email skipped: mail settings missing');
  return { runDate, complete:notification==='sent', dataComplete:true, completedBatches:rows.length, expectedBatches:BATCH_COUNT,
    missingBatches:[], deals, nearMisses:near, report, notification };
}
