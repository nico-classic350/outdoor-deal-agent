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
    return NextResponse.json(await finalizeBatches());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[finalize] failure error=${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
