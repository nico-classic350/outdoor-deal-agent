import { NextRequest, NextResponse } from 'next/server';
import { runAgent } from '../../../lib/run';

export const runtime = 'nodejs';
export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

function misconfigured(name: string) {
  return NextResponse.json({ error: `${name} is not configured` }, { status: 503 });
}

// Manual/external trigger (e.g. ChatGPT automation).
export async function POST(req: NextRequest) {
  const secret = process.env.AGENT_RUN_SECRET;
  if (!secret) return misconfigured('AGENT_RUN_SECRET');

  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) return unauthorized();

  try {
    return NextResponse.json(await runAgent());
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

// Vercel Cron trigger. Vercel sends Authorization: Bearer <CRON_SECRET>.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return misconfigured('CRON_SECRET');

  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) return unauthorized();

  try {
    return NextResponse.json(await runAgent());
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
