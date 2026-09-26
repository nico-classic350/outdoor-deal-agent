// Read-only shop smoke check: crawls selected sources without writing to Neon.
// Requires a Browserless token in the local environment.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  module._compile(outputText, filename);
};

if (!process.env.BROWSERLESS_API_TOKEN && !process.env.BROWSERLESS_TOKEN) {
  console.error('Set BROWSERLESS_API_TOKEN locally to run the read-only Browserless shop smoke check.');
  process.exit(2);
}

const { SHOPS } = require('../config/shops.ts');
const { crawlSource } = require('../lib/crawl.ts');
const ids = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['hervis', 'sport-bittl', 'mammut-eu', 'odlo-eu', 'arcteryx-eu'];
const sources = ids.map(id => {
  const source = SHOPS.find(shop => shop.id === id);
  if (!source) throw new Error(`Unknown source: ${id}`);
  return source;
});

for (const source of sources) {
  const { coverage } = await crawlSource(source);
  // Avoid logging URLs, headers, credentials or raw merchant payloads.
  console.log(JSON.stringify({
    shop: coverage.name,
    status: coverage.status,
    offers: coverage.parsedOffers,
    elapsedMs: coverage.elapsedMs,
    httpStatuses: coverage.httpStatuses,
    technicalPath: coverage.technicalPath,
    note: coverage.note,
  }));
}
