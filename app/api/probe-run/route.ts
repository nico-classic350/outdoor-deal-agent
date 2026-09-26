import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { BATCH_COUNT, finalizeBatches, runBatch } from '../../../lib/batch-run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const TOKEN_HASH = '8417b2009c2eac4c688259cf27d1ffedb8b17a832022eee619178e2deb9f5b95';

function authorized(token: string | null) {
  if (!token) return false;
  const actual = createHash('sha256').update(token).digest();
  const expected = Buffer.from(TOKEN_HASH, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  if (!authorized(url.searchParams.get('token'))) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const action = url.searchParams.get('action') || 'group';
  if (action === 'finalize') {
    const result = await finalizeBatches();
    return NextResponse.json({ ok: true, action, result });
  }

  const group = Number(url.searchParams.get('group'));
  if (!Number.isInteger(group) || group < 0 || group > 3) {
    return NextResponse.json({ ok: false, error: 'group must be 0..3' }, { status: 400 });
  }

  const indexes = Array.from({ length: BATCH_COUNT }, (_, i) => i).filter(i => Math.floor(i / 4) === group);
  const settled = await Promise.allSettled(indexes.map(i => runBatch(i)));
  const results = settled.map((x, idx) => x.status === 'fulfilled'
    ? { batchIndex: indexes[idx], ok: true, result: x.value }
    : { batchIndex: indexes[idx], ok: false, error: String(x.reason?.message || x.reason) });

  return NextResponse.json({
    ok: results.every(x => x.ok),
    action: 'group',
    group,
    batchCount: BATCH_COUNT,
    results,
  });
}
