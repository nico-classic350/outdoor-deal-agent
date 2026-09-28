import { neon } from '@neondatabase/serverless';
import { NormalizedOffer, RunReport } from './types';
import { offerKey } from './product-rules.mjs';

let initPromise: Promise<void> | null = null;

function client() {
  return process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;
}

async function ensureSchema() {
  const sql = client();
  if (!sql) return;
  if (!initPromise) {
    initPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS agent_runs(
          id bigserial primary key,
          started_at timestamptz,
          finished_at timestamptz,
          report jsonb,
          deals jsonb,
          near_misses jsonb
        )
      `;
      await sql`ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS run_key text`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_run_key_uq ON agent_runs(run_key)`;
    })().catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  await initPromise;
}

export async function saveRun(report: RunReport, deals: NormalizedOffer[], near: NormalizedOffer[]) {
  const sql = client();
  if (!sql) return;
  await ensureSchema();
  const runKey = report.startedAt.slice(0, 10);
  await sql`
    INSERT INTO agent_runs(run_key,started_at,finished_at,report,deals,near_misses)
    VALUES (
      ${runKey},
      ${report.startedAt},
      ${report.finishedAt},
      ${JSON.stringify(report)}::jsonb,
      ${JSON.stringify(deals)}::jsonb,
      ${JSON.stringify(near)}::jsonb
    )
    ON CONFLICT (run_key) DO UPDATE SET
      started_at=EXCLUDED.started_at,
      finished_at=EXCLUDED.finished_at,
      report=EXCLUDED.report,
      deals=EXCLUDED.deals,
      near_misses=EXCLUDED.near_misses
  `;
}

export async function latestRun() {
  const sql = client();
  if (!sql) return null;
  try {
    await ensureSchema();
    const rows = await sql`SELECT * FROM agent_runs ORDER BY finished_at DESC LIMIT 1`;
    return rows[0] || null;
  } catch {
    return null;
  }
}

export async function runByDate(runDate: string) {
  const sql = client();
  if (!sql) return null;
  await ensureSchema();
  const rows = await sql`SELECT * FROM agent_runs WHERE run_key=${runDate} LIMIT 1`;
  return rows[0] || null;
}

export async function latestRunBefore(runDate: string) {
  const sql = client();
  if (!sql) return null;
  await ensureSchema();
  const rows = await sql`SELECT * FROM agent_runs WHERE run_key < ${runDate} ORDER BY run_key DESC LIMIT 1`;
  return rows[0] || null;
}

export async function recentPriceHistory():Promise<Record<string,{date:string,price:number}[]>>{
  const sql=client(); if(!sql) return {};
  try{
    await ensureSchema();
    const rows=await sql`SELECT run_key,deals,near_misses FROM agent_runs ORDER BY finished_at DESC LIMIT 30`;
    const history:Record<string,{date:string,price:number}[]>={};
    for(const row of [...rows].reverse()){
      for(const offer of [...(Array.isArray(row.deals)?row.deals:[]),...(Array.isArray(row.near_misses)?row.near_misses:[])]){
        if(!offer?.url||!Number.isFinite(Number(offer.effectiveCostEur))) continue;
        const key=offerKey(offer);
        (history[key]??=[]).push({date:String(row.run_key),price:Number(offer.effectiveCostEur)});
      }
    }
    return history;
  }catch{return {}}
}
