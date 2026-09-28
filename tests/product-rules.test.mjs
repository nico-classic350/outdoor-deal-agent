import test from 'node:test';
import assert from 'node:assert/strict';
import { productEligible, sizeEvidence, selectOffers, dealTier } from '../lib/product-rules.mjs';

test('rejects explicit product mismatches while allowing eligible outdoor trousers', () => {
  assert.equal(productEligible('Odlo Zeroweight Pro Windproof Warm Tights Langlaufhose'), false);
  assert.equal(productEligible('Herren Mercury DST Hose', 'Softshellhose für lange, klassische Skitouren'), false);
  assert.equal(productEligible('adidas Terrex Xperior Fast Pants Skitourenhose'), false);
  assert.equal(productEligible('Herren Langlaufhose'), false);
  assert.equal(productEligible('Herren Winterhose'), false);
  assert.equal(productEligible('Herren Korp Lite Hose', 'Leicht elastische Hose für Trekkingtouren'), true);
  assert.equal(productEligible('Herren Outdoorhose', 'Leichte Wanderhose für Reisen'), true);
  assert.equal(productEligible('Damen Wanderhose'), false);
  assert.equal(productEligible('Herren Trekkinghose Zip-off'), false);
  assert.equal(productEligible('Herren Softshell Pants Light', 'Leichtes Stretchmaterial, wasserdichte Tasche; passende Shorts separat erhältlich'), true);
  assert.equal(productEligible('Herren Softshellhose Light'), true);
  assert.equal(productEligible('Herren Stretchhose für Wandern'), true);
  assert.equal(productEligible('Herren Funktionshose'), true);
  assert.equal(productEligible('Herren Softshell Winterhose'), false);
  assert.equal(productEligible('Herren Climbing Pants', 'Leichte Kletterhose für Reisen und Wandern'), true);
  assert.equal(productEligible('Herren Outdoorhose', 'Damen Wanderhose'), false);
});

test('unknown size stays reviewable while explicit incompatible size is rejected', () => {
  assert.equal(sizeEvidence(['W33 L32']), 'confirmed');
  assert.equal(sizeEvidence(['34/30']), 'confirmed');
  assert.equal(sizeEvidence(['33']), 'probable');
  assert.equal(sizeEvidence(['W33']), 'probable');
  assert.equal(sizeEvidence(['EU 50']), 'probable');
  assert.equal(sizeEvidence(['L']), 'confirmed');
  assert.equal(sizeEvidence(['L Regular']), 'confirmed');
  assert.equal(sizeEvidence([]), 'unconfirmed');

  assert.equal(sizeEvidence(['S']), 'no');
  assert.equal(sizeEvidence(['XS','S']), 'no');
  assert.equal(sizeEvidence(['W32 L32']), 'no');
  assert.equal(sizeEvidence(['W33 L34']), 'no');
  assert.equal(sizeEvidence(['33/34']), 'no');

  assert.equal(sizeEvidence(['S','L']), 'confirmed');
  assert.equal(sizeEvidence(['W32 L32','L']), 'confirmed');
});

test('deal tier depends on discount and product fit, not whether size data is readable', () => {
  assert.equal(dealTier(58, 80), 'Top Deal');
  assert.equal(dealTier(58, 60), 'Strong Deal');
  assert.equal(dealTier(47, 55), 'Strong Deal');
  assert.equal(dealTier(42, 80), 'Good Deal');
  assert.equal(dealTier(42, 60), 'Near Miss');
});

test('same product URL is one candidate despite card titles and tracking parameters', () => {
  const url = 'https://www.bergfreunde.de/hagloefs-korp-lite-hose/';
  const base = { sourceId: 'bergfreunde', brand: 'Haglöfs', name: 'Herren Korp Lite Hose', url,
    sizeFit: 'confirmed', shippingKnown: true, rrpVerified: true, class: 'Top Deal', effectiveDiscountPct: 55, effectiveCostEur: 59.98,
    productFitScore: 80, score: 57 };
  const { deals, near } = selectOffers([base, { ...base, name: 'Herren Korp Lite Hose Sale', url: url + '?utm_source=test' }]);
  assert.equal(deals.length, 1);
  assert.equal(near.length, 0);
});

test('an unknown size remains a review candidate, explicit incompatible sizes are excluded', () => {
  const base = { sourceId: 'bergzeit', brand: 'Haglöfs', name: 'Herren Korp Lite Hose',
    url: 'https://www.bergzeit.de/p/korp/1/', sizeFit: 'unconfirmed', class: 'Near Miss',
    effectiveDiscountPct: 54, effectiveCostEur: 54, productFitScore: 65, score: 58 };
  assert.equal(selectOffers([{...base,shippingKnown:true,rrpVerified:true}]).deals.length, 0);
  assert.match(selectOffers([{...base,shippingKnown:true,rrpVerified:true}]).near[0].reason,/Größe/);

  const explicitNo = { ...base, sizeFit: 'no', score: 30 };
  assert.equal(selectOffers([explicitNo]).deals.length, 0);
});

test('sixth qualifying deal is not relabeled as a near miss', () => {
  const offers=Array.from({length:6},(_,i)=>({sourceId:'x',brand:'Mammut',name:'Herren Wanderhose',
    url:`https://example.org/p/${i}`,sizeFit:'confirmed',shippingKnown:true,rrpVerified:true,
    effectiveDiscountPct:60,effectiveCostEur:50,productFitScore:85,score:100-i}));
  const result=selectOffers(offers);
  assert.equal(result.qualifiedCount,6);
  assert.equal(result.deals.length,5);
  assert.equal(result.near.length,0);
});

test('uncertain sizes remain visible beyond the old three-candidate ceiling', () => {
  const offers=Array.from({length:8},(_,i)=>({sourceId:'x',brand:'Stoic',name:'Herren Wanderhose',
    url:`https://example.org/p/${i}`,sizeFit:'unconfirmed',shippingKnown:false,discountVerified:true,
    effectiveDiscountPct:58,effectiveCostEur:65,productFitScore:80,score:80-i}));
  const result=selectOffers(offers);
  assert.equal(result.deals.length,0);
  assert.equal(result.near.length,8);
});

test('a cheaper unverified variant does not hide a verified variant at the same URL', () => {
  const base={sourceId:'x',brand:'Mammut',name:'Herren Wanderhose',url:'https://example.org/p/1',
    sizeFit:'confirmed',effectiveDiscountPct:60,productFitScore:85,score:80};
  const {deals}=selectOffers([
    {...base,rrpVerified:false,shippingKnown:false,effectiveCostEur:40},
    {...base,rrpVerified:true,shippingKnown:true,effectiveCostEur:60}
  ]);
  assert.equal(deals.length,1);
  assert.equal(deals[0].effectiveCostEur,60);
});

test('merchant-displayed discount can qualify without inventing an RRP', () => {
  const base={sourceId:'bergfreunde',brand:'Stoic',name:'Hoforsst Softshell Pants Light',url:'https://example.org/stoic-hose',
    sizeFit:'confirmed',shippingKnown:true,rrpVerified:false,discountVerified:true,observedDiscountPct:60,
    effectiveDiscountPct:60,effectiveCostEur:67.98,productFitScore:80,score:80};
  const result=selectOffers([base]);
  assert.equal(result.deals.length,1);
  assert.equal(result.deals[0].class,'Top Deal');
});

test('health and coverage use the same publication re-screening', async () => {
  const {screenForPublication}=await import('../lib/publication-safety.mjs');
  const candidates=[{sourceId:'x',brand:'Mammut',name:'Herren Wanderhose',url:'https://example.org/p',
    sizeFit:'confirmed',shippingKnown:true,rrpVerified:true,effectiveDiscountPct:60,effectiveCostEur:50,
    productFitScore:85,score:80}];
  const safe=screenForPublication(candidates,40);
  assert.equal(safe.deals.length,1);
  assert.equal(safe.qualifiedCount,safe.deals.length);
});
