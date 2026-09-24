import { NextRequest, NextResponse } from 'next/server';
import { runAgent } from '../../../../lib/run';

export const runtime = 'nodejs';
export const maxDuration = 300;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

export async function POST(req: NextRequest) {
  const configuredSecret = process.env.AGENT_RUN_SECRET;

  if (!configuredSecret) {
    console.error('[admin-run] AGENT_RUN_SECRET is not configured');
    return json({ ok: false, error: 'AGENT_RUN_SECRET is not configured' }, 503);
  }

  const authorization = req.headers.get('authorization');
  if (authorization !== `Bearer ${configuredSecret}`) {
    console.warn('[admin-run] unauthorized request rejected');
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  console.info(`[admin-run] start runId=${runId} startedAt=${startedAt}`);

  try {
    const result = await runAgent();
    const completedAt = new Date().toISOString();

    console.info(
      `[admin-run] success runId=${runId} completedAt=${completedAt}`
    );

    return json({
      ok: true,
      runId,
      startedAt,
      completedAt,
      result,
    });
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);

    console.error(
      `[admin-run] failure runId=${runId} completedAt=${completedAt} error=${message}`
    );

    return json(
      {
        ok: false,
        runId,
        startedAt,
        completedAt,
        error: message,
      },
      500
    );
  }
}

export async function GET() {
  return json(
    {
      ok: false,
      error: 'method_not_allowed',
      hint: 'Use POST with Authorization: Bearer <AGENT_RUN_SECRET>',
    },
    405
  );
}
