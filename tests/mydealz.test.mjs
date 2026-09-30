import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url), ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { parseMydealzFeed, mydealzItemToOffer, mydealzSizes, mydealzReferencePrice, mydealzFeedUrls, ingestMydealz } = require('../lib/mydealz.ts');
const { normalizeOffer } = require('../lib/normalize.ts');

const source = { id: 'mydealz', name: 'mydealz Community-Deals', country: 'DE', baseUrl: 'https://www.mydealz.de', priority: 1 };
const now = new Date('2026-09-30T20:00:00+02:00');
const item = (title, merchant, description, date = 'Wed, 30 Sep 2026 20:11:31 +0200') => `<item><category><![CDATA[Sport & Outdoor]]></category>${merchant}
<media:content medium="image" url="https://static.mydealz.de/threads/raw/x/1.jpg" width="100" height="100"/>
<title><![CDATA[${title}]]></title><description><![CDATA[${description}]]></description>
<link>https://www.mydealz.de/deals/hose-123</link><pubDate>${date}</pubDate></item>`;
const feed = `<?xml version="1.0"?><rss><channel>
${item('87° - Norrøna Falketind Flex1 Pants Herren | Gr. S - XL', '<pepper:merchant name="Globetrotter" price="89,95€"/>',
  '<strong>89,95€ - Globetrotter</strong><br /><p>Top Hose.</p><ul><li><p><a href="https://www.idealo.de/x">PVG: 179,90 €</a></p></li></ul>')}
</channel></rss>`;

test('parses mydealz RSS items with merchant, price and temperature-free title', () => {
  const [parsed] = parseMydealzFeed(feed);
  assert.equal(parsed.title, 'Norrøna Falketind Flex1 Pants Herren | Gr. S - XL');
  assert.equal(parsed.merchant, 'Globetrotter');
  assert.equal(parsed.price, 89.95);
  assert.equal(parsed.link, 'https://www.mydealz.de/deals/hose-123');
  assert.match(parsed.description, /PVG: 179,90 €/);
});

test('uses a labelled comparison price as evidence and reads size ranges', async () => {
  const offer = mydealzItemToOffer(parseMydealzFeed(feed)[0], source, now.getTime());
  assert.equal(offer.rrp, 179.9);
  assert.equal(offer.rrpSource, 'mydealz:price-comparison');
  assert.equal(offer.merchant, 'Globetrotter (via mydealz)');
  assert.deepEqual(offer.sizes, ['S', 'M', 'L', 'XL']);
  const normalized = await normalizeOffer(offer);
  assert.equal(normalized?.brand, 'Norrøna');
  assert.equal(normalized?.sizeFit, 'confirmed');
});

test('an unlabelled higher price is no evidence; old and expired posts are skipped', () => {
  const plain = parseMydealzFeed(feed.replace('PVG: 179,90 €', 'früher mal 179,90 €'))[0];
  assert.equal(mydealzItemToOffer(plain, source, now.getTime()).rrp, undefined);
  const old = parseMydealzFeed(feed.replace('Wed, 30 Sep 2026', 'Mon, 07 Sep 2026'))[0];
  assert.equal(mydealzItemToOffer(old, source, now.getTime()), null);
  const expired = parseMydealzFeed(feed.replace('87° - Norrøna', '[abgelaufen] Norrøna'))[0];
  assert.equal(mydealzItemToOffer(expired, source, now.getTime()), null);
});

test('size and reference helpers', () => {
  assert.deepEqual(mydealzSizes('Größen 48 - 54'), ['48', '50', '52', '54']);
  assert.deepEqual(mydealzSizes('XS bis L'), ['XS', 'S', 'M', 'L']);
  assert.deepEqual(mydealzReferencePrice('UVP 249,95 €'), { value: 249.95, source: 'mydealz:labelled-reference-price' });
});

test('personal alert feed is used only when it points at mydealz', () => {
  assert.equal(mydealzFeedUrls({ MYDEALZ_ALERT_FEED_URL: 'https://www.mydealz.de/rssx/keyword-alarm/abc' })[0], 'https://www.mydealz.de/rssx/keyword-alarm/abc');
  assert.equal(mydealzFeedUrls({ MYDEALZ_ALERT_FEED_URL: 'https://evil.example/feed' }).some(u => u.includes('evil')), false);
});

test('ingest reads every feed and deduplicates posts', async () => {
  const fetcher = async () => new Response(feed, { status: 200, headers: { 'content-type': 'text/xml; charset=utf-8' } });
  const result = await ingestMydealz(source, Date.now() + 20000, fetcher, ['https://www.mydealz.de/a', 'https://www.mydealz.de/b']);
  assert.equal(result.feeds, 2);
  assert.equal(result.offers.length <= 1, true);
});
