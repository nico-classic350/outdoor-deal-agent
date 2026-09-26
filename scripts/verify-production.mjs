import { mkdirSync, writeFileSync } from 'node:fs';

const baseUrl = process.env.PRODUCTION_BASE_URL || 'https://outdoor-deal-agent.vercel.app';
const expectedSha = process.env.GITHUB_SHA;
const timeoutMs = Number(process.env.PRODUCTION_VERIFY_TIMEOUT_MS || 8 * 60 * 1000);
const intervalMs = Number(process.env.PRODUCTION_VERIFY_INTERVAL_MS || 10_000);
const outDir = 'observability';

mkdirSync(outDir, { recursive: true });

function save(name, value) {
  writeFileSync(`${outDir}/${name}`, JSON.stringify(value, null, 2) + '\n');
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'cache-control': 'no-cache', 'user-agent': 'outdoor-deal-agent-observability/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: response.status, body };
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

if (!expectedSha) {
  throw new Error('GITHUB_SHA is missing; cannot correlate production deployment.');
}

const started = Date.now();
let lastHealth = null;
let attempts = 0;
let matched = false;

console.log(`[production-observability] waiting for deployment sha=${expectedSha}`);

while (Date.now() - started < timeoutMs) {
  attempts += 1;
  try {
    const health = await getJson('/api/health');
    lastHealth = health;
    save('production-health-latest.json', health);
    const liveSha = health?.body?.deploymentSha;
    console.log(`[production-observability] attempt=${attempts} http=${health.status} liveSha=${liveSha || 'unknown'} pipeline=${health?.body?.pipelineStatus || 'unknown'}`);
    if (liveSha === expectedSha) {
      matched = true;
      break;
    }
  } catch (error) {
    console.log(`[production-observability] attempt=${attempts} transient_error=${error instanceof Error ? error.message : String(error)}`);
  }
  await sleep(intervalMs);
}

if (!matched) {
  save('production-verify-failure.json', {
    reason: 'deployment_sha_not_observed',
    expectedSha,
    attempts,
    elapsedMs: Date.now() - started,
    lastHealth,
  });
  throw new Error(`Production did not expose expected deployment SHA ${expectedSha} within ${timeoutMs}ms.`);
}

const health = await getJson('/api/health');
const registry = await getJson('/api/registry');
const probe = await getJson('/api/probe');

save('production-health.json', health);
save('production-registry.json', registry);
save('production-probe.json', probe);

const checks = {
  deploymentShaMatches: health?.body?.deploymentSha === expectedSha,
  healthHttpOk: health.status >= 200 && health.status < 300,
  databaseReachable: health?.body?.databaseReachable === true,
  registryHttpOk: registry.status >= 200 && registry.status < 300,
  registryHasSources: Number(registry?.body?.count || 0) > 0,
  probeHttpOk: probe.status >= 200 && probe.status < 300,
  probeOk: probe?.body?.ok === true,
};

const result = {
  expectedSha,
  baseUrl,
  attempts,
  elapsedMs: Date.now() - started,
  checks,
  health: {
    pipelineStatus: health?.body?.pipelineStatus,
    sourceCount: health?.body?.sourceCount,
    expectedBatches: health?.body?.expectedBatches,
    batchRowsToday: health?.body?.batchRowsToday,
    finalizedToday: health?.body?.finalizedToday,
  },
  probe: {
    snapshotDate: probe?.body?.snapshotDate,
    elapsedMs: probe?.body?.probe?.elapsedMs,
    deals: Array.isArray(probe?.body?.deals) ? probe.body.deals.length : null,
    nearMisses: Array.isArray(probe?.body?.nearMisses) ? probe.body.nearMisses.length : null,
  },
};

save('production-verify-summary.json', result);
console.log('[production-observability] summary');
console.log(JSON.stringify(result, null, 2));

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  throw new Error(`Production verification failed checks: ${failed.join(', ')}`);
}

console.log('[production-observability] PASS');
