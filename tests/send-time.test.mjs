import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url), ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { berlinHour, SEND_HOUR_BERLIN } = require('../lib/send-time.ts');

test('05:xx UTC is 07:00 in Berlin summer and 06:00 in winter', () => {
  assert.equal(berlinHour(new Date('2026-07-01T05:20:00Z')), 7);
  assert.equal(berlinHour(new Date('2026-12-01T05:20:00Z')), 6);
  assert.equal(berlinHour(new Date('2026-12-01T06:20:00Z')), 7);
  assert.equal(SEND_HOUR_BERLIN, 7);
});
