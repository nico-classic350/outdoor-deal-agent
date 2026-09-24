import { NextRequest, NextResponse } from 'next/server';
import { runBatch } from '../../../../lib/batch-run';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: NextRequest, ctx: { params: Promise<{ batch: string }> }) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { batch } = await ctx.params;
  const index = Number(batch);

  try {
    return NextResponse.json(await runBatch(index));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[batch] failure batch=${batch} error=${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
