import { NextRequest, NextResponse } from 'next/server';
import pLimit from 'p-limit';
import { SHOPS } from '../../../config/shops';
import { crawlSource } from '../../../lib/crawl';
import { llmExtractFromHtml } from '../../../lib/llm-extract';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const SMOKE_DATE = '2026-09-27';
const IDS = ['mammut-eu', 'bergfreunde', 'bergzeit', 'odlo-eu'];
const fixtureUrl = 'https://www.mammut.com/de/de/products/smoke-fixture-pants';
const fixtureHtml = '<main><article><a href="/de/de/products/smoke-fixture-pants">Mammut Smoke Fixture Pants Men</a><p>Sale price € 54,70 · UVP € 119,95</p></article></main>';

// One-day production-only diagnostic. It does not persist offers or send mail.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (new Date().toISOString().slice(0, 10) !== SMOKE_DATE) {
    return NextResponse.json({ error: 'smoke window closed' }, { status: 410 });
  }

  const sources = IDS.map(id => SHOPS.find(source => source.id === id));
  if (sources.some(source => !source)) return NextResponse.json({ error: 'smoke source missing' }, { status: 500 });

  const startedAt = new Date().toISOString();
  console.info(`[pilot-smoke] start ${startedAt}`);
  const limit = pLimit(2);
  const shopRuns = sources.map(source => limit(async () => {
    try {
      const { coverage } = await crawlSource(source!);
      const result = {
        sourceId: coverage.sourceId, status: coverage.status,
        parsedOffers: coverage.parsedOffers, elapsedMs: coverage.elapsedMs,
        httpStatuses: coverage.httpStatuses, technicalPath: coverage.technicalPath,
        note: coverage.note,
      };
      console.info(`[pilot-smoke] shop ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      const result = { sourceId: source!.id, status: 'error', note: String(error) };
      console.error(`[pilot-smoke] shop ${JSON.stringify(result)}`);
      return result;
    }
  }));

  // A synthetic card exercises the real model/API path, even when live shop
  // pages are blocked. Shadow results are observed only; never published.
  const fixtureRun = llmExtractFromHtml(sources[0]!, fixtureUrl, fixtureHtml, {
    mode: 'shadow', shops: ['mammut-eu'], timeoutMs: 10000,
  }).then(result => ({
    outcome: result.outcome, attempted: result.attempted,
    candidates: result.candidateCount, observedOffers: result.observedOffers.length,
    publishedOffers: result.offers.length, elapsedMs: result.elapsedMs,
  })).catch(error => ({ outcome: 'error', note: String(error) }));

  const [results, fixture] = await Promise.all([Promise.all(shopRuns), fixtureRun]);
  console.info(`[pilot-smoke] complete ${JSON.stringify({ startedAt, results, fixture })}`);
  return NextResponse.json({ startedAt, finishedAt: new Date().toISOString(), results, fixture }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
