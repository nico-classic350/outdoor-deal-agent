import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const archive = join(root, 'outdoor-deal-agent.zip');
const staging = join(root, '.build-source');
const extracted = join(staging, 'outdoor-deal-agent');

if (!existsSync(archive)) throw new Error('Missing outdoor-deal-agent.zip');

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
execFileSync('unzip', ['-q', '-o', archive, '-d', staging], { stdio: 'inherit' });

const baseline = [
  'app/layout.tsx',
  'app/page.tsx',
  'config/shops.ts',
  'lib/fx.ts',
  'lib/run.ts',
  'lib/feed.ts',
  'lib/extract.ts',
  'tests/scoring.test.mjs',
  'next-env.d.ts',
];

for (const relative of baseline) {
  const from = join(extracted, relative);
  const to = join(root, relative);
  if (!existsSync(from)) throw new Error(`Archive missing required source: ${relative}`);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

const overrides = [
  ['crawl.override.ts', 'lib/crawl.ts'],
  ['types.override.ts', 'lib/types.ts'],
  ['targeted.override.ts', 'lib/targeted.ts'],
  ['globetrotter-feed.override.ts', 'lib/globetrotter-feed.ts'],
  ['awin-feed.override.ts', 'lib/awin-feed.ts'],
  ['browser.override.ts', 'lib/browser.ts'],
  ['store.override.ts', 'lib/store.ts'],
];

for (const [source, target] of overrides) {
  const from = join(root, source);
  const to = join(root, target);
  if (!existsSync(from)) throw new Error(`Missing build override: ${source}`);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

const required = [
  'config/shops.ts',
  'config/profile.ts',
  'lib/normalize.ts',
  'lib/size.ts',
  'lib/fit.ts',
  'lib/score.ts',
  'lib/crawl.ts',
  'lib/types.ts',
  'lib/targeted.ts',
  'lib/globetrotter-feed.ts',
  'lib/awin-feed.ts',
  'lib/browser.ts',
  'lib/store.ts',
  'lib/batch-run.ts',
];

for (const relative of required) {
  if (!existsSync(join(root, relative))) throw new Error(`Prepared source incomplete: ${relative}`);
}

rmSync(staging, { recursive: true, force: true });
console.log('[prepare-build] source prepared successfully');
