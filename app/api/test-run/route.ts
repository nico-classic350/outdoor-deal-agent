import { NextResponse } from 'next/server';
import { runAgent } from '../../../lib/run';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET() {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ error: 'preview-only' }, { status: 403 });
  }
  try {
    return NextResponse.json(await runAgent());
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
