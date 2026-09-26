import { NextResponse } from 'next/server';
import { replayLatestCompleteSnapshot } from '../../../lib/probe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await replayLatestCompleteSnapshot();
    return NextResponse.json(result, {
      status: result.ok ? 200 : 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[probe] replay failed', error);
    return NextResponse.json(
      { ok: false, mode: 'replay', error: 'probe_failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
