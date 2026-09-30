import { NextResponse } from 'next/server';
import { runBrowserCheck, MAX_CHECKS_PER_DAY } from '../../../lib/browser-check';
import { browserFallbackConfig } from '../../../lib/browser-config.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Read-only Browserless credential check: renders example.com once through
// /content. No shop crawl, no batch/report write, no mail. At most one provider
// request per deployed token and UTC day (max MAX_CHECKS_PER_DAY per day);
// repeated calls return the stored result.
export async function GET() {
  const cfg = browserFallbackConfig();
  try {
    const result = await runBrowserCheck();
    const base = {
      region: cfg.baseUrl ? new URL(cfg.baseUrl).hostname : null,
      tokenIssue: cfg.tokenIssue ?? null,
      maxChecksPerDay: MAX_CHECKS_PER_DAY,
    };
    if ('error' in result) {
      return NextResponse.json({ ok: false, ...base, error: result.error },
        { status: result.error === 'daily-check-limit-reached' ? 429 : 503, headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ ok: result.outcome === 'accepted', ...base, ...result },
      { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    console.error('[browser-check] failed');
    return NextResponse.json({ ok: false, error: 'browser_check_failed' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
