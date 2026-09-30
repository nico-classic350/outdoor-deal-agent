import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';

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
const browserSource=read('lib/browser.ts');
const browserConfig=read('lib/browser-config.mjs');
const agentState=read('docs/AGENT_STATE.md');

const requiredDirect=[
  'config/profile.ts','config/shops.ts','lib/types.ts','lib/crawl.ts','lib/extract.ts','lib/feed.ts','lib/fx.ts',
  'lib/targeted.ts','lib/globetrotter-feed.ts','lib/browser.ts','lib/browser-config.mjs','lib/store.ts',
  'lib/normalize.ts','lib/size.ts','lib/fit.ts','lib/score.ts','lib/batch-run.ts','docs/AGENT_STATE.md'
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

assert(packageJson.dependencies?.['playwright-core'],'remote browser automation uses playwright-core');
assert(!packageJson.dependencies?.playwright,'full Playwright browser package is not bundled');
assert(browserSource.includes('connectOverCDP'),'Browserless Playwright uses remote CDP');
assert(!browserSource.includes('chromium.launch('),'browser code never launches local Chromium');
const localBrowser=read('lib/local-browser.ts');
assert(localBrowser.includes('chromium.launch(')&&localBrowser.includes('localBrowserEnabled()'),'local Chromium is launched only by the gated GitHub Actions runtime');
assert(/localBrowserRuntime[\s\S]*BROWSER_RUNTIME === 'local' && !env\.VERCEL/.test(browserConfig),'local Chromium runtime can never activate on Vercel');
for(const file of readdirSync(full('app'),{recursive:true}).map(String).filter(f=>/\.tsx?$/.test(f))){
  assert(!read(join('app',file)).includes('local-browser'),`app route ${file} does not import the local Chromium runtime`);
}
const browserWorkflow=read('.github/workflows/browser-crawl.yml');
assert(/permissions:\s*\n\s*contents: read/.test(browserWorkflow),'browser crawl workflow has read-only repository permissions');
assert(!/pull_request/.test(browserWorkflow),'browser crawl workflow never runs on pull requests (secrets stay out of fork code)');
assert(browserWorkflow.includes('secrets.BROWSER_SNAPSHOT_DATABASE_URL')&&!browserWorkflow.includes('secrets.DATABASE_URL'),'browser crawl uses only the dedicated snapshot database secret');
const browserCrawl=read('scripts/actions-browser-crawl.mjs');
assert(browserCrawl.includes("'DATABASE_URL'")&&browserCrawl.includes("'BROWSERLESS_API_TOKEN'"),'browser crawl removes production database and Browserless credentials');
assert(!/agent_batch_runs|agent_runs|sendRunNotification|finalizeBatches/.test(browserCrawl+read('lib/browser-snapshots.ts')),'browser crawl never writes batches, reports or mail');
assert(read('lib/batch-run.ts').includes('mergeSnapshot'),'Vercel batches merge fresh Chromium snapshots');
{ const cohort=read('config/browser-cohort.ts'); const known=new Set([...read('config/shops.ts').matchAll(/^([a-z0-9-]+)\|/gm)].map(m=>m[1]));
  for(const id of [...cohort.matchAll(/'([a-z0-9-]+)'/g)].map(m=>m[1]).filter(x=>!['all','everything','pilot','render','blocked','local'].includes(x))) assert(known.has(id),`browser cohort shop ${id} exists in the registry`); }
assert(browserSource.includes('browserWSEndpoint'),'blocked-page flow supports Browserless session handoff');
assert(/BROWSERLESS_API_TOKEN/.test(browserConfig)&&/BROWSERLESS_TOKEN/.test(browserConfig),'Browserless token is read only from environment');
const browserCheck=read('lib/browser-check.ts');
assert(browserCheck.includes('MAX_CHECKS_PER_DAY')&&browserCheck.includes('reserveBrowserSession')&&browserCheck.includes('database-required-for-cost-cap'),'Browserless credential check is capped per day and uses the shared session budget');
assert(!/console\.(log|error)\([^)]*(contentUrl|token)/.test(browserCheck+read('app/api/browser-check/route.ts')),'Browserless credential check never logs token-bearing values');
assert(agentState.includes('Starting a fresh Claude Code session'),'durable project handoff documents fresh-session recovery');
assert(existsSync(full('CLAUDE.md'))&&read('CLAUDE.md').includes('@AGENTS.md'),'CLAUDE.md loads the repository agent workflow');

assert(/pull_request:/.test(ciWorkflow)&&/branches:\s*\[main\]/.test(ciWorkflow),'GitHub CI validates pull requests to main');
assert(/push:[\s\S]*branches:\s*\[main\]/.test(ciWorkflow),'GitHub CI validates main');
const deploymentEnabled=vercel.git?.deploymentEnabled||{};
assert(
  Object.keys(deploymentEnabled).sort().join(',')==='**,main' && deploymentEnabled['**']===false,
  'Vercel disables every non-main Git branch, including branches containing slashes',
);
assert(deploymentEnabled.main===true,'Vercel allows automatic production deployment from main');
assert(
  ['feature/llm-extraction-pilot','feature/gpt6-luna-default','feat/deal-quality-ui-mammut','stabilize-agent','nested/topic/fix'].every(branch => matchesGlob(branch, '**'))
    && !['feature/llm-extraction-pilot','nested/topic/fix'].some(branch => matchesGlob(branch, '*')),
  'deployment glob covers nested feature branches that * alone misses',
);

const dataMatch=shopsSource.match(/const DATA\s*=\s*`([\s\S]*?)`;/);
const shopLines=dataMatch?dataMatch[1].trim().split('\n').filter(Boolean):[];
const malformedShopLines=shopLines.filter(line=>{
  const parts=line.split('|');
  return parts.length!==5 || !/^[A-Z]{2}$/.test(parts[2]) || !/^https?:\/\//.test(parts[3]) || !/^[123]$/.test(parts[4]);
});
assert(shopLines.length===93,`shop registry contains expected 93 sources (found ${shopLines.length})`);
assert(malformedShopLines.length===0,`shop registry rows are structurally valid (invalid ${malformedShopLines.length})`);
const duplicateIds=shopLines.map(line=>line.split('|')[0]).filter((id,index,all)=>all.indexOf(id)!==index);
assert(duplicateIds.length===0,'shop registry IDs are unique');

const batchSizeMatch=batchRun.match(/BATCH_SIZE\s*=\s*(\d+)/);
assert(Boolean(batchSizeMatch),'batch size is statically discoverable');
const batchSize=batchSizeMatch?Number(batchSizeMatch[1]):0;
const expectedBatches=batchSize?Math.ceil(shopLines.length/batchSize):0;
const crons=Array.isArray(vercel.crons)?vercel.crons:[];
assert(crons.every(c=>/^\d{1,2} \d{1,2} \S+ \S+ \S+$/.test(String(c.schedule||''))),
  'all Vercel Hobby cron schedules run at most once per day');
const batchCronIndexes=crons.map(c=>String(c.path||'').match(/^\/api\/batch\/(\d+)$/)).filter(Boolean).map(m=>Number(m[1])).sort((a,b)=>a-b);
const expectedIndexes=Array.from({length:expectedBatches},(_,i)=>i);
assert(JSON.stringify(batchCronIndexes)===JSON.stringify(expectedIndexes),`Vercel schedules exactly ${expectedBatches} batch crons`);
const retryIndexes=crons.map(c=>String(c.path||'').match(/^\/api\/retry-batch\/(\d+)$/)).filter(Boolean).map(m=>Number(m[1])).sort((a,b)=>a-b);
assert(JSON.stringify(retryIndexes)===JSON.stringify(expectedIndexes),`Vercel schedules exactly ${expectedBatches} recovery crons`);
assert(crons.filter(c=>c.path==='/api/finalize').length===1,'exactly one finalizer cron exists');
assert(crons.filter(c=>c.path==='/api/finalize-retry').length===1,'exactly one finalizer retry cron exists');
assert(crons.find(c=>c.path==='/api/finalize-retry')?.schedule==='0 6 * * *','finalizer retry runs after batch recovery window');
assert(crons.filter(c=>c.path==='/api/watchdog').length===1,'one watchdog cron monitors delayed or missing daily work');
assert(crons.find(c=>c.path==='/api/watchdog')?.schedule==='15 7 * * *','watchdog runs once daily after recovery, compatible with Hobby cron limits');
for(const hour of [10,14,20,23]) assert(crons.find(c=>c.path===`/api/recovery/${hour}`)?.schedule===`0 ${hour} * * *`, `daily recovery window ${hour} UTC exists`);
assert(read('app/api/recovery/[slot]/route.ts').includes("../../watchdog/route"),'recovery windows use the authenticated watchdog');
assert(!crons.some(c=>c.path==='/api/run'||c.path==='/api/admin/run'),'monolithic run routes are not scheduled');

const scheduleCounts=new Map();
for(const cron of crons.filter(c=>/^\/api\/batch\//.test(String(c.path||'')))){
  const schedule=String(cron.schedule||''); scheduleCounts.set(schedule,(scheduleCounts.get(schedule)||0)+1);
}
assert([...scheduleCounts.values()].every(count=>count<=4),'no batch time slot schedules more than four functions');
for(const route of ['app/api/batch/[batch]/route.ts','app/api/retry-batch/[batch]/route.ts','app/api/finalize/route.ts','app/api/finalize-retry/route.ts','app/api/watchdog/route.ts']){
  const source=read(route); assert(source.includes('CRON_SECRET')&&source.includes('authorization'),`${route} requires cron authorization`);
}
for(const route of ['app/api/run/route.ts','app/api/admin/run/route.ts']){
  const source=read(route); assert(!source.includes('runAgent'),`${route} cannot invoke the monolithic crawler`); assert(source.includes('410')||source.includes('monolithic_run_retired'),`${route} is explicitly retired`);
}
const sourceBudget=crawl.match(/SOURCE_BUDGET_MS[\s\S]{0,180}?\|\|\s*(\d+)/)?.[1];
assert(Boolean(sourceBudget),'source runtime budget is configured');
if(sourceBudget) assert(Number(sourceBudget)<=60000,'default source runtime budget is at most 60 seconds');
assert(read('lib/crawl.ts').includes('allowedByRobots'),'crawler respects shop robots rules');
assert(!read('lib/crawl.ts').includes('awin-'),'unavailable Awin feed is absent from the runtime crawl');
assert(read('lib/product-rules.mjs').includes('qualifiedCount'),'all qualifying deals are classified before display limit');

if(errors.length){ console.error('[validate-config] FAILED'); for(const e of errors) console.error(` - ${e}`); process.exit(1); }
console.log(`[validate-config] OK: ${ok.length} checks; shops=${shopLines.length}; batches=${expectedBatches}; source=direct`);
