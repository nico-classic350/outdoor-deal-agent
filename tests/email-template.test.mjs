import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRunEmail } from '../lib/email-template.ts';

test('daily mail includes product thumbnail, deal details and full coverage even when there are deals', () => {
  const offer = { brand: 'Stoic', name: 'Softshellhose L', merchant: 'Bergfreunde',
    imageUrl: 'https://img.example/hose.jpg', url: 'https://shop.example/hose',
    effectiveCostEur: 71.93, priceEur: 69.95, rrpEur: 169.95, effectiveDiscountPct: 57.6,
    sizeFit: 'confirmed', sizes: ['L'], shippingKnown: true, shippingEur: 1.98,
    returnCostEur: null, class: 'Strong Deal', score: 62 };
  const report = { startedAt: '2026-09-28T00:10:00Z', finishedAt: '2026-09-28T04:50:00Z',
    plannedSources: 2, attemptedSources: 2, success: 1, partial: 0, browser: 0, blocked: 1,
    failed: 0, rawOffers: 178, normalizedOffers: 83, confirmedSizeOffers: 1,
    coverage: [{ name: 'Bergfreunde', status: 'success', parsedOffers: 178, pricedOffers: 83, qualifiedOffers: 1 },
      { name: 'Bergzeit', status: 'blocked', parsedOffers: 0, pricedOffers: 0, qualifiedOffers: 0 }] };
  const html = renderRunEmail('2026-09-28', [offer], [], report);
  assert.match(html, /<img src="https:\/\/img\.example\/hose\.jpg"/);
  assert.match(html, /Zusammenfassung:.*Rohangebote 178.*Deals 1/);
  assert.match(html, /Größe: <strong>L<\/strong>/);
  assert.match(html, /71,93\s*€/);
  assert.match(html, /2\. Coverage Report/);
  assert.match(html, /Bergzeit<\/td><td>blocked/);
});

test('mail content escapes shop data and rejects unsafe image links', () => {
  const offer = { brand: '<script>', name: 'Hose', merchant: 'Shop', imageUrl: 'javascript:alert(1)',
    url: 'https://shop.example/hose', effectiveCostEur: 50, priceEur: 50, rrpEur: 100,
    effectiveDiscountPct: 50, sizeFit: 'unconfirmed', shippingKnown: true,
    shippingEur: 0, returnCostEur: null, class: 'Near Miss', score: 50 };
  const report = { startedAt: '2026-09-28T00:00:00Z', finishedAt: '2026-09-28T04:00:00Z',
    plannedSources: 0, attemptedSources: 0, success: 0, partial: 0, browser: 0, blocked: 0,
    failed: 0, rawOffers: 0, normalizedOffers: 0, confirmedSizeOffers: 0, coverage: [] };
  const html = renderRunEmail('2026-09-28', [], [offer], report);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('javascript:'));
  assert.match(html, /nicht verifiziert – im Shop prüfen/);
});

test('mail keeps thumbnails and summary for deals with unknown size and extra costs',()=>{
  const offer={brand:'Mammut',name:'Herren Wanderhose',merchant:'Bergzeit',imageUrl:'https://img.example/pants.jpg',
    url:'https://shop.example/pants',effectiveCostEur:60,priceEur:60,rrpEur:120,effectiveDiscountPct:50,
    sizeFit:'unconfirmed',sizes:[],shippingKnown:false,shippingEur:0,returnCostEur:null,class:'Strong Deal',score:70};
  const report={startedAt:'2026-09-29T00:00:00Z',finishedAt:'2026-09-29T04:00:00Z',plannedSources:1,
    attemptedSources:1,success:1,partial:0,browser:0,blocked:0,failed:0,rawOffers:29,normalizedOffers:26,
    confirmedSizeOffers:0,coverage:[]};
  const html=renderRunEmail('2026-09-29',[offer],[],report);
  assert.match(html,/Zusammenfassung:.*Rohangebote 29.*Deals 1/);
  assert.match(html,/img\.example\/pants\.jpg/);
  assert.match(html,/nicht verifiziert – im Shop prüfen/);
  assert.match(html,/zzgl\. ggf\. ungeklärter Versand-\/Retourenkosten/);
});
