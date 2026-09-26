import { NextResponse } from 'next/server';
import { SHOPS } from '../../../config/shops';
import { crawlSource } from '../../../lib/crawl';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const IDS = ['hervis', 'sport-bittl', 'mammut-eu', 'odlo-eu', 'aboutyou-de'];

export async function GET() {
  const selected = IDS.map(id => SHOPS.find(shop => shop.id === id)).filter(Boolean);
  const results: unknown[] = [];
  const started = Date.now();

  for (let i = 0; i < selected.length; i += 2) {
    const group = selected.slice(i, i + 2);
    const groupResults = await Promise.all(group.map(async source => {
      const result = await crawlSource(source!);
      return {
        sourceId: source!.id,
        name: source!.name,
        offers: result.offers.length,
        coverage: result.coverage,
      };
    }));
    results.push(...groupResults);
  }

  return NextResponse.json({
    ok: true,
    temporary: true,
    writeFree: true,
    elapsedMs: Date.now() - started,
    tested: results.length,
    results,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
