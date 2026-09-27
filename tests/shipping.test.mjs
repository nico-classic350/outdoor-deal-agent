import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require=createRequire(import.meta.url), ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(readFileSync(filename,'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const {bergfreundeGermanShipping,fillVerifiedShipping}=require('../lib/shipping.ts');

const page='<p>In Deutschland kostenfrei zurücksenden</p><table><tr><td>Deutschland, Frankreich</td><td>3,95 €</td><td>Versandkostenfrei ab 99 € Bestellwert</td></tr></table>';
test('shipping is attached only from the German row of a fetched official policy',async()=>{
  assert.deepEqual(bergfreundeGermanShipping(page),{fee:3.95,freeFrom:99,freeReturns:true});
  const offers=[{sourceId:'bergfreunde',currency:'EUR',price:67.98},{sourceId:'bergfreunde',currency:'EUR',price:100},
    {sourceId:'other',currency:'EUR',price:50}];
  const fetcher=async url=>({ok:true,url,text:async()=>page});
  assert.equal(await fillVerifiedShipping(offers,fetcher),true);
  assert.deepEqual(offers.map(x=>x.shipping),[3.95,0,undefined]);
  assert.deepEqual(offers.map(x=>x.returnCost),[0,0,undefined]);
});
test('ambiguous shipping pages never turn unknown delivery into zero',async()=>{
  const offers=[{sourceId:'bergfreunde',currency:'EUR',price:67.98}];
  const fetcher=async url=>({ok:true,url,text:async()=>'<p>Versandkostenfrei ab 99 €</p>'});
  assert.equal(await fillVerifiedShipping(offers,fetcher),false);
  assert.equal(offers[0].shipping,undefined);
});
