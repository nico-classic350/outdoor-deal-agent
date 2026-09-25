import { NextRequest, NextResponse } from 'next/server';
import { finalizeBatches } from '../../../lib/batch-run';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const result = await finalizeBatches();
    console.info(`[finalize-retry] complete=${result.complete}`);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    console.error('[finalize-retry] failure');
    return NextResponse.json({ error: 'finalize_retry_failed' }, { status: 500 });
  }
}
