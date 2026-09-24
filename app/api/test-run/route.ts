import { NextResponse } from 'next/server';
import { runBatch } from '../../../lib/batch-run';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET() {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ error: 'preview-only' }, { status: 403 });
  }

  try {
    const result = await runBatch(0);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[preview-test] failure error=${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
