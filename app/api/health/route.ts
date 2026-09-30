import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { BATCH_COUNT } from '../../../lib/batch-run';
import { SHOPS } from '../../../config/shops';
import { browserFallbackConfig } from '../../../lib/browser-config.mjs';
import { latestBrowserCheck } from '../../../lib/browser-check';
import { DEFAULT_LLM_EXTRACTION_MODEL } from '../../../lib/llm-extract';
import { screenForPublication } from '../../../lib/publication-safety.mjs';
import { PROFILE } from '../../../config/profile';
import { notificationConfig } from '../../../lib/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const databaseConfigured = Boolean(process.env.DATABASE_URL);
  const now = new Date();
  const runDate = now.toISOString().slice(0, 10);
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  // The finalizer retry runs in the 06:00 UTC hour; allow the Hobby cron window.
  const pipelineExpectedComplete = utcMinutes >= 7 * 60 + 30;
  const browser = browserFallbackConfig();
  const llmMode = process.env.LLM_EXTRACTION_MODE || 'off';
  const llmShops = (process.env.LLM_EXTRACTION_SHOPS || 'mammut-eu').split(',').map(shop => shop.trim()).filter(Boolean);
  const llmApiKeyConfigured = Boolean(process.env.OPENAI_API_KEY);
  const email = notificationConfig();

  const base = {
    deploymentSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    sourceCount: SHOPS.length,
    expectedBatches: BATCH_COUNT,
    browserFallbackConfigured: browser.configured,
    browserFallbackMode: browser.mode,
    browserFallbackRegion: browser.baseUrl ? new URL(browser.baseUrl).hostname : null,
    browserUnblockEnabled: browser.useUnblock,
    browserPlaywrightEnabled: browser.usePlaywright,
    browserTokenIssue: browser.tokenIssue ?? null,
    llmExtraction: {
      mode: llmMode,
      shops: llmShops,
      model: process.env.LLM_EXTRACTION_MODEL || DEFAULT_LLM_EXTRACTION_MODEL,
      apiKeyConfigured: llmApiKeyConfigured,
      readyForMammut: (llmMode === 'shadow' || llmMode === 'active') && llmShops.includes('mammut-eu') && llmApiKeyConfigured && browser.configured,
    },
    runDate,
    pipelineExpectedComplete,
    emailConfigured: email.configured,
    emailProvider: email.provider,
    emailMissingSettings: email.missing,
  };

  if (!databaseConfigured) {
    return NextResponse.json(
      { ok: false, databaseConfigured: false, databaseReachable: false, pipelineStatus: 'database-missing', ...base },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    await sql`SELECT 1 AS ok`;

    const tables = await sql`
      SELECT
        to_regclass('public.agent_batch_runs') AS batch_table,
        to_regclass('public.agent_runs') AS run_table,
        to_regclass('public.agent_notification_snapshots') AS notification_table
    `;

    const batchTablePresent = Boolean(tables[0]?.batch_table);
    const runTablePresent = Boolean(tables[0]?.run_table);
    let batchRowsToday = 0;
    let browserProviderAuthRejectedSources = 0;
    let browserRecoveredSources = 0;
    let actionsBrowserRecoveredSources = 0;
    let latestFinalizedAt: string | null = null;
    let latestFinalizedRunDate: string | null = null;
    let emailDeliveryStatus = 'no-report-today';
    let reportSnapshotAt: string | null = null;
    let sourceQuality: {usableSources:number;verifiedReferenceSources:number;confirmedSizeSources:number;qualifiedDeals:number}|null=null;

    if (batchTablePresent) {
      const rows = await sql`
        SELECT count(*)::int AS count
        FROM agent_batch_runs
        WHERE run_date = ${runDate}
      `;
      batchRowsToday = Number(rows[0]?.count || 0);
      const browserRows = await sql`SELECT coverage FROM agent_batch_runs WHERE run_date=${runDate}`;
      for (const batch of browserRows) {
        for (const source of Array.isArray(batch.coverage) ? batch.coverage : []) {
          if (source.technicalPath?.includes('browser-provider-auth-rejected')) browserProviderAuthRejectedSources++;
          if (source.technicalPath?.includes('browser-success')) browserRecoveredSources++;
          if (source.technicalPath?.includes('actions-browser-success')) actionsBrowserRecoveredSources++;
        }
      }
    }

    if (runTablePresent) {
      const rows = await sql`
        SELECT started_at, finished_at, report, deals, near_misses
        FROM agent_runs
        ORDER BY finished_at DESC NULLS LAST, id DESC
        LIMIT 1
      `;
      const row = rows[0];
      if (row?.finished_at) latestFinalizedAt = new Date(row.finished_at).toISOString();
      if (row?.started_at) latestFinalizedRunDate = new Date(row.started_at).toISOString().slice(0, 10);
      if (latestFinalizedRunDate === runDate) reportSnapshotAt = row?.report?.batchSnapshotAt || null;
      const sources=Array.isArray(row?.report?.coverage)?row.report.coverage:[];
      const candidates=[...(Array.isArray(row?.deals)?row.deals:[]),...(Array.isArray(row?.near_misses)?row.near_misses:[])];
      const safe=screenForPublication(candidates,PROFILE.minEffectiveDiscountPct);
      if(sources.length) sourceQuality={
        usableSources:sources.filter((s:{pricedOffers?:number})=>Number(s.pricedOffers)>0).length,
        verifiedReferenceSources:sources.filter((s:{verifiedReferenceOffers?:number})=>Number(s.verifiedReferenceOffers)>0).length,
        confirmedSizeSources:sources.filter((s:{availableSizeOffers?:number})=>Number(s.availableSizeOffers)>0).length,
        // Match /api/coverage: report counters may have been written under old gates.
        qualifiedDeals:safe.deals.length
      };
    }

    if (reportSnapshotAt) {
      emailDeliveryStatus = email.configured ? 'pending' : 'not-configured';
      if (tables[0]?.notification_table) {
        const deliveries = await sql`SELECT state FROM agent_notification_snapshots
          WHERE run_date=${runDate} AND snapshot_at=${reportSnapshotAt}::timestamptz LIMIT 1`;
        if (deliveries[0]?.state === 'sent') emailDeliveryStatus = 'sent';
        else if (deliveries[0]?.state === 'sending') emailDeliveryStatus = 'sending';
      }
    }

    const browserProviderCheck = browser.configured ? await latestBrowserCheck() : null;
    // GitHub Actions Chromium crawler: fresh snapshots and their contribution today.
    const snapshotTable = await sql`SELECT to_regclass('public.agent_browser_snapshots') AS t`;
    const actionsBrowser = { freshSnapshots: 0, snapshotsWithOffers: 0, latestCollectedAt: null as string | null,
      shopsWithAddedOffers: actionsBrowserRecoveredSources };
    if (snapshotTable[0]?.t) {
      const rows = await sql`SELECT count(*)::int AS n,
          count(*) FILTER (WHERE jsonb_array_length(offers) > 0)::int AS with_offers,
          max(collected_at) AS latest
        FROM agent_browser_snapshots WHERE collected_at >= now() - interval '30 hours'`;
      actionsBrowser.freshSnapshots = Number(rows[0]?.n || 0);
      actionsBrowser.snapshotsWithOffers = Number(rows[0]?.with_offers || 0);
      actionsBrowser.latestCollectedAt = rows[0]?.latest ? new Date(rows[0].latest).toISOString() : null;
    }
    const batchesComplete = batchRowsToday === BATCH_COUNT;
    const finalizedToday = latestFinalizedRunDate === runDate;
    const pipelineComplete = batchesComplete && finalizedToday && emailDeliveryStatus === 'sent';
    // Once a report has been written, a missing email is a failed run immediately.
    const ok = pipelineComplete || (!pipelineExpectedComplete && !finalizedToday);
    const pipelineStatus = pipelineComplete ? 'complete' : batchesComplete && finalizedToday
      ? pipelineExpectedComplete ? 'delivery-overdue' : 'delivery-pending'
      : pipelineExpectedComplete ? 'overdue' : 'warming';

    return NextResponse.json(
      {
        ok,
        databaseConfigured: true,
        databaseReachable: true,
        batchTablePresent,
        runTablePresent,
        batchRowsToday,
        // A /api/browser-check result belongs to the currently deployed token and
        // is therefore newer evidence than batch coverage from an earlier token.
        browserProviderStatus: !browser.configured ? 'disabled'
          : browserRecoveredSources ? 'recovered-products'
          : browserProviderCheck?.outcome === 'accepted' ? 'check-accepted'
          : browserProviderCheck?.outcome === 'auth-rejected' || browserProviderAuthRejectedSources ? 'auth-rejected'
          : 'configured-no-recovery',
        browserProviderCheck,
        actionsBrowser,
        browserProviderAuthRejectedSources,
        browserRecoveredSources,
        batchesComplete,
        finalizedToday,
        latestFinalizedAt,
        latestFinalizedRunDate,
        sourceQuality,
        emailDeliveryStatus,
        pipelineStatus,
        ...base,
      },
      { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    console.error('[health] database or pipeline check failed');
    return NextResponse.json(
      { ok: false, databaseConfigured: true, databaseReachable: false, pipelineStatus: 'check-failed', ...base },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
