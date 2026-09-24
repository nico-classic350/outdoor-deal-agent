import pLimit from 'p-limit';
import { NextResponse } from 'next/server';
import { SHOPS } from '../../../config/shops';
import { crawlSource } from '../../../lib/crawl';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET() {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ error: 'preview-only' }, { status: 403 });
  }

  const started = Date.now();
  const sources = SHOPS.slice(0, 6);
  const limit = pLimit(3);

  console.info(`[batch-test] start sources=${sources.length}`);

  const results = await Promise.all(
    sources.map((source) => limit(() => crawlSource(source)))
  );

  const summary = {
    sources: sources.length,
    elapsedMs: Date.now() - started,
    offers: results.reduce((sum, r) => sum + r.offers.length, 0),
    coverage: results.map((r) => r.coverage),
  };

  console.info(`[batch-test] success elapsedMs=${summary.elapsedMs} offers=${summary.offers}`);
  return NextResponse.json(summary);
}
