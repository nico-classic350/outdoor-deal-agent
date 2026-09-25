import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const errors = [];
const ok = [];

function read(path) {
  const full = join(root, path);
  if (!existsSync(full)) {
    errors.push(`Missing required file: ${path}`);
    return '';
  }
  return readFileSync(full, 'utf8');
}

function assert(condition, message) {
  if (condition) ok.push(message);
  else errors.push(message);
}

const packageJson = JSON.parse(read('package.json'));
const vercel = JSON.parse(read('vercel.json'));
const nodeVersion = read('.node-version').trim();
const nextConfig = read('next.config.ts');
const ciWorkflow = read('.github/workflows/ci.yml');
const shopsSource = read('config/shops.ts');
const batchRun = read('lib/batch-run.ts');
const crawl = read('lib/crawl.ts');

const packageManager = String(packageJson.packageManager || '');
const pmMatch = packageManager.match(/^pnpm@(\d+\.\d+\.\d+)$/);
assert(Boolean(pmMatch), 'packageManager pins an exact pnpm version');
if (pmMatch) assert(packageJson.engines?.pnpm === pmMatch[1], 'pnpm engine matches packageManager');
assert(packageJson.engines?.node === `${nodeVersion}.x`, 'Node engine matches .node-version');

const allDeps = {
  ...(packageJson.dependencies || {}),
  ...(packageJson.devDependencies || {}),
  ...(packageJson.optionalDependencies || {}),
};
for (const name of ['@sparticuz/chromium', 'playwright', 'playwright-core', 'puppeteer', 'puppeteer-core']) {
  assert(!(name in allDeps), `heavy browser dependency absent: ${name}`);
}
assert(!/ignoreBuildErrors\s*:\s*true/.test(nextConfig), 'TypeScript build errors are not ignored');
assert(packageJson.scripts?.ci?.includes('preflight'), 'CI delegates to the full preflight');
assert(packageJson.scripts?.build?.includes('validate:config'), 'Vercel build validates deployment configuration');

assert(!/branches:\s*\[[^\]]*stabilize-agent/.test(ciWorkflow), 'GitHub CI does not push-trigger on stabilize-agent');
assert(/pull_request:/.test(ciWorkflow) && /branches:\s*\[main\]/.test(ciWorkflow), 'GitHub CI validates pull requests to main');
assert(/push:[\s\S]*branches:\s*\[main\]/.test(ciWorkflow), 'GitHub CI validates main');

const deploymentEnabled = vercel.git?.deploymentEnabled || {};
assert(deploymentEnabled['stabilize-agent'] === false, 'Vercel disables stabilize-agent deployments');
assert(deploymentEnabled['agent-test-run'] === false, 'Vercel disables obsolete agent-test-run deployments');
assert(deploymentEnabled['internal-*'] === false, 'Vercel disables internal-* deployments');
assert(deploymentEnabled['scratch-*'] === false, 'Vercel disables scratch-* deployments');

const shopRows = [...shopsSource.matchAll(/^\s*\[\s*['"][^'"]+['"]\s*,/gm)];
assert(shopRows.length > 0, 'shop registry contains sources');

const batchSizeMatch = batchRun.match(/BATCH_SIZE\s*=\s*(\d+)/);
assert(Boolean(batchSizeMatch), 'batch size is statically discoverable');
const batchSize = batchSizeMatch ? Number(batchSizeMatch[1]) : 0;
const expectedBatches = batchSize ? Math.ceil(shopRows.length / batchSize) : 0;

const crons = Array.isArray(vercel.crons) ? vercel.crons : [];
const batchCronIndexes = crons
  .map((cron) => String(cron.path || '').match(/^\/api\/batch\/(\d+)$/))
  .filter(Boolean)
  .map((match) => Number(match[1]))
  .sort((a, b) => a - b);
const expectedIndexes = Array.from({ length: expectedBatches }, (_, i) => i);

assert(
  JSON.stringify(batchCronIndexes) === JSON.stringify(expectedIndexes),
  `Vercel schedules exactly ${expectedBatches} batch crons`
);
assert(crons.filter((c) => c.path === '/api/finalize').length === 1, 'exactly one finalizer cron exists');
assert(crons.filter((c) => c.path === '/api/finalize-retry').length === 1, 'exactly one finalizer retry cron exists');
assert(!crons.some((c) => c.path === '/api/run' || c.path === '/api/admin/run'), 'monolithic run routes are not scheduled');

const scheduleCounts = new Map();
for (const cron of crons.filter((c) => /^\/api\/batch\//.test(String(c.path || '')))) {
  const schedule = String(cron.schedule || '');
  scheduleCounts.set(schedule, (scheduleCounts.get(schedule) || 0) + 1);
}
assert([...scheduleCounts.values()].every((count) => count <= 4), 'no batch time slot schedules more than four functions');

for (const route of [
  'app/api/batch/[batch]/route.ts',
  'app/api/finalize/route.ts',
  'app/api/finalize-retry/route.ts',
]) {
  const source = read(route);
  assert(source.includes('CRON_SECRET') && source.includes('authorization'), `${route} requires cron authorization`);
}

for (const route of ['app/api/run/route.ts', 'app/api/admin/run/route.ts']) {
  const source = read(route);
  assert(!source.includes('runAgent'), `${route} cannot invoke the monolithic crawler`);
  assert(source.includes('410') || source.includes('monolithic_run_retired'), `${route} is explicitly retired`);
}

const sourceBudget = crawl.match(/SOURCE_BUDGET_MS[\s\S]{0,180}?\|\|\s*(\d+)/)?.[1];
assert(Boolean(sourceBudget), 'source runtime budget is configured');
if (sourceBudget) assert(Number(sourceBudget) <= 60000, 'default source runtime budget is at most 60 seconds');

if (errors.length) {
  console.error('[validate-config] FAILED');
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log(`[validate-config] OK: ${ok.length} checks; shops=${shopRows.length}; batches=${expectedBatches}`);
