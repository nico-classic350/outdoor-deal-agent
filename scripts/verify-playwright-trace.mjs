import assert from 'node:assert/strict';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const tracePath = '.next/server/app/api/batch/[batch]/route.js.nft.json';
const trace = JSON.parse(readFileSync(tracePath, 'utf8'));
const packageRoot = realpathSync('node_modules/playwright-core');
const traced = new Set(trace.files.map(file => {
  try { return realpathSync(resolve(dirname(tracePath), file)); } catch { return ''; }
}));
const missing = readdirSync(packageRoot, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => join(entry.parentPath, entry.name))
  .filter(file => !traced.has(realpathSync(file)));
assert.deepEqual(missing, [], 'The batch function must trace every dynamically loaded playwright-core file');
console.info(`[verify-playwright-trace] OK: ${traced.size} traced files include playwright-core`);
