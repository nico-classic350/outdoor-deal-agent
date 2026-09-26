import { NextRequest, NextResponse } from 'next/server';
import pLimit from 'p-limit';
import { SHOPS } from '../../../config/shops';
import { crawlSource } from '../../../lib/crawl';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const IDS = ['hervis', 'sport-bittl', 'mammut-eu', 'odlo-eu', 'arcteryx-eu'];

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sources = IDS.map(id => SHOPS.find(source => source.id === id));
  if (sources.some(source => !source)) {
    return NextResponse.json({ error: 'smoke source missing' }, { status: 500 });
  }

  const limit = pLimit(2);
  const startedAt = new Date().toISOString();
  console.info(`[browser-smoke] start ${startedAt}`);
  const results = await Promise.all(sources.map(source => limit(async () => {
    const { coverage } = await crawlSource(source!);
    const result = {
      sourceId: coverage.sourceId,
      status: coverage.status,
      parsedOffers: coverage.parsedOffers,
      elapsedMs: coverage.elapsedMs,
      httpStatuses: coverage.httpStatuses,
      technicalPath: coverage.technicalPath,
      note: coverage.note,
    };
    console.info(`[browser-smoke] shop ${JSON.stringify(result)}`);
    return result;
  })));
  console.info(`[browser-smoke] complete ${JSON.stringify({ startedAt, results })}`);
  return NextResponse.json({ startedAt, finishedAt: new Date().toISOString(), results }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
