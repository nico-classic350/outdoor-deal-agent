import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root=process.cwd(); const errors=[]; const ok=[];
const full=(p)=>join(root,p);
function read(p){ if(!existsSync(full(p))){errors.push(`Missing required file: ${p}`);return '';} return readFileSync(full(p),'utf8'); }
function assert(condition,message){ if(condition) ok.push(message); else errors.push(message); }

const packageJson=JSON.parse(read('package.json'));
const vercel=JSON.parse(read('vercel.json'));
const nodeVersion=read('.node-version').trim();
const nextConfig=read('next.config.ts');
const ciWorkflow=read('.github/workflows/ci.yml');
const shopsSource=read('config/shops.ts');
const batchRun=read('lib/batch-run.ts');
const crawl=read('lib/crawl.ts');

const requiredDirect=[
  'config/profile.ts','config/shops.ts','lib/types.ts','lib/crawl.ts','lib/extract.ts','lib/feed.ts','lib/fx.ts',
  'lib/targeted.ts','lib/globetrotter-feed.ts','lib/awin-feed.ts','lib/browser.ts','lib/store.ts',
  'lib/normalize.ts','lib/size.ts','lib/fit.ts','lib/score.ts','lib/batch-run.ts'
];
for(const p of requiredDirect) assert(existsSync(full(p)),`direct source exists: ${p}`);

const forbiddenLegacy=[
  'outdoor-deal-agent.zip','scripts/prepare-build.mjs','crawl.override.ts','types.override.ts','targeted.override.ts',
  'globetrotter-feed.override.ts','awin-feed.override.ts','browser.override.ts','store.override.ts'
];
for(const p of forbiddenLegacy) assert(!existsSync(full(p)),`legacy build layer absent: ${p}`);
assert(!String(packageJson.scripts?.build||'').includes('prepare:source'),'build does not mutate source tree');
assert(!String(packageJson.scripts?.preflight||'').includes('prepare:source'),'preflight does not mutate source tree');

const packageManager=String(packageJson.packageManager||'');
const pmMatch=packageManager.match(/^pnpm@(\d+\.\d+\.\d+)$/);
assert(Boolean(pmMatch),'packageManager pins an exact pnpm version');
if(pmMatch) assert(packageJson.engines?.pnpm===pmMatch[1],'pnpm engine matches packageManager');
assert(packageJson.engines?.node===`${nodeVersion}.x`,'Node engine matches .node-version');
assert(!/ignoreBuildErrors\s*:\s*true/.test(nextConfig),'TypeScript build errors are not ignored');
assert(packageJson.scripts?.ci?.includes('preflight'),'CI delegates to the full preflight');
assert(packageJson.scripts?.build?.includes('validate:config'),'Vercel build validates deployment configuration');

assert(/pull_request:/.test(ciWorkflow)&&/branches:\s*\[main\]/.test(ciWorkflow),'GitHub CI validates pull requests to main');
assert(/push:[\s\S]*branches:\s*\[main\]/.test(ciWorkflow),'GitHub CI validates main');
const deploymentEnabled=vercel.git?.deploymentEnabled||{};
assert(deploymentEnabled['*']===false,'Vercel disables all non-main Git deployments by default');
assert(deploymentEnabled.main===true,'Vercel allows automatic production deployment from main');

const dataMatch=shopsSource.match(/const DATA\s*=\s*`([\s\S]*?)`;/);
const shopLines=dataMatch?dataMatch[1].trim().split('\n').filter(Boolean):[];
const malformedShopLines=shopLines.filter(line=>{
  const parts=line.split('|');
  return parts.length!==5 || !/^[A-Z]{2}$/.test(parts[2]) || !/^https?:\/\//.test(parts[3]) || !/^[123]$/.test(parts[4]);
});
assert(shopLines.length===91,`shop registry contains expected 91 sources (found ${shopLines.length})`);
assert(malformedShopLines.length===0,`shop registry rows are structurally valid (invalid ${malformedShopLines.length})`);
const duplicateIds=shopLines.map(line=>line.split('|')[0]).filter((id,index,all)=>all.indexOf(id)!==index);
assert(duplicateIds.length===0,'shop registry IDs are unique');

const batchSizeMatch=batchRun.match(/BATCH_SIZE\s*=\s*(\d+)/);
assert(Boolean(batchSizeMatch),'batch size is statically discoverable');
const batchSize=batchSizeMatch?Number(batchSizeMatch[1]):0;
const expectedBatches=batchSize?Math.ceil(shopLines.length/batchSize):0;
const crons=Array.isArray(vercel.crons)?vercel.crons:[];
const batchCronIndexes=crons.map(c=>String(c.path||'').match(/^\/api\/batch\/(\d+)$/)).filter(Boolean).map(m=>Number(m[1])).sort((a,b)=>a-b);
const expectedIndexes=Array.from({length:expectedBatches},(_,i)=>i);
assert(JSON.stringify(batchCronIndexes)===JSON.stringify(expectedIndexes),`Vercel schedules exactly ${expectedBatches} batch crons`);
assert(crons.filter(c=>c.path==='/api/finalize').length===1,'exactly one finalizer cron exists');
assert(crons.filter(c=>c.path==='/api/finalize-retry').length===1,'exactly one finalizer retry cron exists');
assert(!crons.some(c=>c.path==='/api/run'||c.path==='/api/admin/run'),'monolithic run routes are not scheduled');

const scheduleCounts=new Map();
for(const cron of crons.filter(c=>/^\/api\/batch\//.test(String(c.path||'')))){
  const schedule=String(cron.schedule||''); scheduleCounts.set(schedule,(scheduleCounts.get(schedule)||0)+1);
}
assert([...scheduleCounts.values()].every(count=>count<=4),'no batch time slot schedules more than four functions');
for(const route of ['app/api/batch/[batch]/route.ts','app/api/finalize/route.ts','app/api/finalize-retry/route.ts']){
  const source=read(route); assert(source.includes('CRON_SECRET')&&source.includes('authorization'),`${route} requires cron authorization`);
}
for(const route of ['app/api/run/route.ts','app/api/admin/run/route.ts']){
  const source=read(route); assert(!source.includes('runAgent'),`${route} cannot invoke the monolithic crawler`); assert(source.includes('410')||source.includes('monolithic_run_retired'),`${route} is explicitly retired`);
}
const sourceBudget=crawl.match(/SOURCE_BUDGET_MS[\s\S]{0,180}?\|\|\s*(\d+)/)?.[1];
assert(Boolean(sourceBudget),'source runtime budget is configured');
if(sourceBudget) assert(Number(sourceBudget)<=60000,'default source runtime budget is at most 60 seconds');

if(errors.length){ console.error('[validate-config] FAILED'); for(const e of errors) console.error(` - ${e}`); process.exit(1); }
console.log(`[validate-config] OK: ${ok.length} checks; shops=${shopLines.length}; batches=${expectedBatches}; source=direct`);
