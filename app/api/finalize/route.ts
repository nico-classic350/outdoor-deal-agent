import { NextRequest, NextResponse } from 'next/server';
import { finalizeBatches } from '../../../lib/batch-run';
import { berlinHour, SEND_HOUR_BERLIN } from '../../../lib/send-time';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (berlinHour() < SEND_HOUR_BERLIN) {
    console.info(`[finalize] deferred until ${SEND_HOUR_BERLIN}:00 Berlin; finalize-retry sends`);
    return NextResponse.json({ deferred: true, sendHourBerlin: SEND_HOUR_BERLIN }, { headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const result = await finalizeBatches();
    return NextResponse.json(result, { status: result.complete ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    console.error('[finalize] failure');
    return NextResponse.json({ error: 'finalize_failed' }, { status: 500 });
  }
}
