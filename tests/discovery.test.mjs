import test from 'node:test';
import assert from 'node:assert/strict';
import { rankDiscoveryUrls } from '../lib/discovery.mjs';

test('a relevant product from a deep sitemap is inspected before broad and excluded pages',()=>{
  const urls=['https://example.de/damen/softshellhose-winter/',
    'https://example.de/herren/hosen/',
    'https://example.de/outlet/',
    'https://example.de/stoic-softshellhose-light/',
    'https://example.de/stoic-softshellhose-light/'];
  const sorted=rankDiscoveryUrls(urls,['Stoic']);
  assert.equal(sorted[0],urls[3]);
  assert.equal(sorted.at(-1),urls[0]);
  assert.equal(sorted.length,4);
});
