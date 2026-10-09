import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRunEmail, renderRunText, thumbnailUrl } from '../lib/email-template.ts';

test('daily mail includes product thumbnail, deal details and full coverage even when there are deals', () => {
  const offer = { brand: 'Lundhags', name: 'Softshellhose L', merchant: 'Bergfreunde',
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
  assert.match(html, /Blockiert<\/b> \(1\)<\/td><td[^>]*>Bergzeit/);
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

test('all qualified deals are listed and the deal section stays compact', () => {
  const deals = Array.from({ length: 70 }, (_, i) => ({ brand: 'Lundhags', name: `Makke Pant M ${i}`, merchant: 'Lundhags EU',
    imageUrl: `https://img.example/${i}.jpg`, url: `https://shop.example/p/${i}`, description: 'x'.repeat(800),
    effectiveCostEur: 99, priceEur: 99, rrpEur: 199, effectiveDiscountPct: 50, sizeFit: 'unconfirmed',
    shippingKnown: false, shippingEur: 0, returnCostEur: null, class: 'Strong Deal', score: 70 - i }));
  const report = { startedAt: '2026-10-01T00:00:00Z', finishedAt: '2026-10-01T04:00:00Z',
    plannedSources: 0, attemptedSources: 0, success: 0, partial: 0, browser: 0, blocked: 0,
    failed: 0, rawOffers: 0, normalizedOffers: 0, confirmedSizeOffers: 0, coverage: [] };
  const html = renderRunEmail('2026-10-01', deals, [], report);
  assert.equal((html.match(/Zum Shop/g) || []).length, 70);
  assert.ok(!html.includes('x'.repeat(100)), 'listing descriptions are not repeated in the mail');
  // Gmail clips messages above ~102 KB; 70 deals must stay well below that.
  assert.ok(Buffer.byteLength(html) < 80_000, `deal section is ${Buffer.byteLength(html)} bytes`);
});

test('daily mail stays far below Gmail clipping with a full registry and many offers', () => {
  const offer = i => ({ brand: 'Bergans', name: `Rabot Softshell Pants ${i}`, merchant: 'Bergfreunde', imageUrl: `https://cdn.shopify.com/s/files/p${i}.jpg?v=1`,
    url: `https://www.bergfreunde.de/bergans-rabot-softshell-pants-softshellhose-${i}/?aid=5ce60f1183500f6a3d82424a613fb9b0`, effectiveCostEur: 85.48,
    priceEur: 85.48, rrpEur: 170.95, effectiveDiscountPct: 50, sizeFit: 'probable', sizes: ['EU 50', 'EU 52'], shippingKnown: true, shippingEur: 4.95,
    returnCostEur: null, class: 'Strong Deal', score: 70, reason: 'Rabatt unter der Deal-Schwelle.' });
  const coverage = Array.from({ length: 93 }, (_, i) => ({ name: `Shop ${i}`, status: i % 5 ? 'partial' : 'blocked', parsedOffers: i % 5 ? 120 : 0,
    eligibleOffers: i % 3 ? 10 : 0, qualifiedOffers: i % 7 ? 0 : 2, technicalPath: Array(40).fill('browser-playwright-extracted'), note: 'x'.repeat(120) }));
  const report = { startedAt: '2026-10-08T00:10:00Z', finishedAt: '2026-10-08T05:17:00Z', plannedSources: 93, attemptedSources: 93, success: 8, partial: 43,
    browser: 6, blocked: 19, failed: 17, rawOffers: 6968, normalizedOffers: 170, confirmedSizeOffers: 25, coverage };
  const deals = Array.from({ length: 50 }, (_, i) => offer(i)), near = Array.from({ length: 12 }, (_, i) => offer(100 + i));
  const html = renderRunEmail('2026-10-08', deals, near, report);
  // Gmail clips above ~102 KB; 50 deals, 12 near misses and 93 shops stay far below.
  assert.ok(Buffer.byteLength(html) < 65_000, `mail is ${Buffer.byteLength(html)} bytes`);
  assert.equal((html.match(/<img /g) || []).length, 50, 'near misses carry no images');
  assert.ok(!html.includes('browser-playwright-extracted'), 'technical paths stay on the dashboard');
  assert.match(html, /width=144/);
  const text = renderRunText('2026-10-08', deals, near, report);
  assert.match(text, /^Outdoor Deals 2026-10-08: 50 Deals, 12 Prüfkandidaten/);
  assert.match(text, /Bergans Rabot Softshell Pants 0 \(Bergfreunde\): 85,48\s€ statt 170,95\s€/);
});

test('thumbnails are requested small from CDNs that support it', () => {
  assert.equal(thumbnailUrl('https://cdn.shopify.com/s/files/a.jpg?v=2'), 'https://cdn.shopify.com/s/files/a.jpg?v=2&width=144');
  assert.equal(thumbnailUrl('https://scandinavianoutdoor.imgix.net/p/a.jpeg'), 'https://scandinavianoutdoor.imgix.net/p/a.jpeg?w=144&auto=format');
  assert.equal(thumbnailUrl('https://img.example/a.jpg'), 'https://img.example/a.jpg');
  assert.equal(thumbnailUrl('http://img.example/a.jpg'), null);
});
