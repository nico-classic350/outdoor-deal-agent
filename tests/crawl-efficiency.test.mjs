import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require=createRequire(import.meta.url), ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(readFileSync(filename,'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const {crawlSource}=require('../lib/crawl.ts');

test('a direct product without reference price does not spend a browser session',async()=>{
  const oldFetch=globalThis.fetch, oldToken=process.env.BROWSERLESS_API_TOKEN;
  process.env.BROWSERLESS_API_TOKEN='test-token';
  const product='https://shop.example/lundhags-softshellhose-light/';
  const requests=[];
  globalThis.fetch=async url=>{
    const u=String(url);requests.push(u);
    if(u.endsWith('/robots.txt')) return {ok:false,status:404};
    if(u.endsWith('/sitemap.xml')) return {ok:true,status:200,text:async()=>`<loc>${product}</loc>`};
    if(u.endsWith('/sitemap_index.xml')) return {ok:false,status:404};
    if(u===product) return {ok:true,status:200,text:async()=>`<script type="application/ld+json">{"@type":"Product","name":"Lundhags Softshellhose Light","brand":{"name":"Lundhags"},"offers":{"price":"79.95","priceCurrency":"EUR"}}</script>`};
    throw new Error(`unexpected request ${u}`);
  };
  try{
    const result=await crawlSource({id:'sample',name:'Sample',country:'DE',baseUrl:'https://shop.example'});
    assert.equal(result.offers.length,1);
    assert.ok(result.coverage.technicalPath.includes('browser-skipped-existing-products'));
    assert.ok(!requests.some(u=>u.includes('browserless.io')));
  }finally{
    globalThis.fetch=oldFetch;
    if(oldToken===undefined) delete process.env.BROWSERLESS_API_TOKEN;
    else process.env.BROWSERLESS_API_TOKEN=oldToken;
  }
});
