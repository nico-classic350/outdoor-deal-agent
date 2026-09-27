import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareCoverage, comparisonBaseline } from '../lib/coverage-delta.ts';

test('same-day recrawl compares access, raw products and useful offers without inventing old fields', () => {
  const previous={startedAt:'2026-09-27T00:00:00Z',finishedAt:'2026-09-27T07:00:00Z',
    attemptedSources:2,success:1,partial:0,browser:0,blocked:1,failed:0,rawOffers:10,
    normalizedOffers:4,confirmedSizeOffers:0,qualifiedDeals:0,nearMisses:1,
    coverage:[{sourceId:'a',name:'A',status:'success',parsedOffers:10},
      {sourceId:'b',name:'B',status:'blocked',parsedOffers:0}]};
  const current={...previous,finishedAt:'2026-09-27T12:00:00Z',success:0,partial:2,blocked:0,
    rawOffers:15,normalizedOffers:3,confirmedSizeOffers:1,nearMisses:2,
    coverage:[{sourceId:'a',name:'A',status:'partial',parsedOffers:8,pricedOffers:3,qualifiedOffers:0},
      {sourceId:'b',name:'B',status:'partial',parsedOffers:7,pricedOffers:0,qualifiedOffers:0}]};
  const result=compareCoverage(current,previous);
  assert.equal(result.baselineKind,'same-day-rerun');
  assert.deepEqual(result.metrics.find(m=>m.metric==='rawOffers'),{metric:'rawOffers',current:15,previous:10,delta:5});
  assert.equal(result.metrics.find(m=>m.metric==='reachedSources').delta,1);
  assert.equal(result.metrics.find(m=>m.metric==='sourcesWithProducts').delta,1);
  assert.equal(result.metrics.find(m=>m.metric==='normalizedOffers').delta,-1);
  assert.equal(result.sources[0].pricedDelta,null);
  assert.equal(result.sources[1].parsedDelta,7);
  assert.equal(result.metrics.find(m=>m.metric==='browserRecoveredSources').previous,null);
});

test('browser contribution and provider throttling have distinct deltas when both runs recorded paths', () => {
  const base={startedAt:'2026-09-27',finishedAt:'2026-09-27',attemptedSources:2,success:0,
    partial:1,browser:0,blocked:1,failed:0,rawOffers:1,normalizedOffers:0,qualifiedDeals:0,nearMisses:0,
    coverage:[{sourceId:'a',name:'A',status:'partial',parsedOffers:1,technicalPath:['browser-success']},
      {sourceId:'b',name:'B',status:'blocked',parsedOffers:0,technicalPath:['browser-provider-rate-limited']}]};
  const current={...base,coverage:base.coverage.map(c=>({...c,technicalPath:['browser-success']}))};
  const metrics=compareCoverage(current,base).metrics;
  assert.equal(metrics.find(m=>m.metric==='browserRecoveredSources').delta,1);
  assert.equal(metrics.find(m=>m.metric==='browserProviderLimitedSources').delta,-1);
});

test('a new same-day batch snapshot compares with the latest report; retries keep that baseline', () => {
  const original={startedAt:'2026-09-26',finishedAt:'2026-09-26',coverage:[]};
  const today={startedAt:'2026-09-27',finishedAt:'2026-09-27',batchSnapshotAt:'2026-09-27T12:00:00Z',coverage:[],comparison:{baseline:original}};
  const previous={run_key:'2026-09-27',report:today};
  assert.equal(comparisonBaseline(previous,'2026-09-27','2026-09-27T12:00:00Z'),original);
  assert.equal(comparisonBaseline(previous,'2026-09-27','2026-09-27T14:20:00Z'),today);
  assert.equal(comparisonBaseline(previous,'2026-09-28','2026-09-28T12:00:00Z'),today);
});
