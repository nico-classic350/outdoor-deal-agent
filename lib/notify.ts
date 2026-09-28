import { neon } from '@neondatabase/serverless';
import type { NormalizedOffer, RunReport } from './types';
import { renderRunEmail } from './email-template';
import { notificationConfig } from './mail-config.mjs';
import { sendGmailEmail } from './gmail-smtp.mjs';

export { notificationConfig } from './mail-config.mjs';

export type NotificationResult = 'sent' | 'pending' | 'not-configured';

async function submitEmail(runDate: string, snapshotAt: string, deals: NormalizedOffer[], near: NormalizedOffer[], report: RunReport) {
  const subject = `Outdoor Deal Alert ${runDate}${report.comparison?.baselineKind === 'same-day-rerun' ? ' (aktualisiert)' : ''}: ${deals.length} Deals`;
  const html = renderRunEmail(runDate, deals, near, report);
  if (notificationConfig().provider === 'gmail') {
    return sendGmailEmail({ user: process.env.GMAIL_SMTP_USER!, password: process.env.GMAIL_SMTP_APP_PASSWORD!,
      to: process.env.DEAL_NOTIFY_TO!, subject, html, runDate, snapshotAt });
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json',
      'Idempotency-Key': `outdoor-deals/${runDate}/${snapshotAt}` },
    body: JSON.stringify({ from: process.env.DEAL_NOTIFY_FROM, to: [process.env.DEAL_NOTIFY_TO], subject, html }),
  });
  if (!response.ok) throw new Error(`notification HTTP ${response.status}`);
  const result: unknown = await response.json();
  const id = typeof result === 'object' && result !== null && 'id' in result ? result.id : undefined;
  if (typeof id !== 'string' || !id) throw new Error('notification provider returned no message id');
  return id;
}

export async function notificationState(runDate: string, snapshotAt: string): Promise<'sent' | 'pending' | 'not-configured'> {
  if (!process.env.DATABASE_URL) return 'not-configured';
  const sql = neon(process.env.DATABASE_URL!);
  const table = await sql`SELECT to_regclass('public.agent_notification_snapshots') AS name`;
  if (!table[0]?.name) return notificationConfig().configured ? 'pending' : 'not-configured';
  const rows = await sql`SELECT state FROM agent_notification_snapshots
    WHERE run_date=${runDate} AND snapshot_at=${snapshotAt}::timestamptz LIMIT 1`;
  return rows[0]?.state === 'sent' ? 'sent' : notificationConfig().configured ? 'pending' : 'not-configured';
}

export async function sendRunNotification(runDate: string, deals: NormalizedOffer[], near: NormalizedOffer[], report: RunReport, snapshotAt: string): Promise<NotificationResult> {
  if (!notificationConfig().configured) return 'not-configured';
  const sql = neon(process.env.DATABASE_URL!);
  await sql`CREATE TABLE IF NOT EXISTS agent_notification_snapshots(
    run_date text NOT NULL, snapshot_at timestamptz NOT NULL, sent_at timestamptz,
    state text NOT NULL, attempted_at timestamptz NOT NULL DEFAULT now(), provider_id text,
    PRIMARY KEY(run_date,snapshot_at))`;
  await sql`ALTER TABLE agent_notification_snapshots ADD COLUMN IF NOT EXISTS attempted_at timestamptz NOT NULL DEFAULT now()`;
  await sql`ALTER TABLE agent_notification_snapshots ADD COLUMN IF NOT EXISTS provider_id text`;
  // A crashed worker can be reclaimed. The DB protects confirmed sends; Resend
  // additionally deduplicates retries for 24 hours. SMTP can very rarely duplicate
  // a message if the process dies after acceptance but before the DB commit.
  const claimed = await sql`INSERT INTO agent_notification_snapshots(run_date,snapshot_at,state,attempted_at)
    VALUES (${runDate},${snapshotAt},'sending',now())
    ON CONFLICT (run_date,snapshot_at) DO UPDATE SET attempted_at=now(),state='sending'
    WHERE agent_notification_snapshots.state='sending'
      AND agent_notification_snapshots.attempted_at < now()-interval '15 minutes'
    RETURNING run_date`;
  if (!claimed.length) {
    const current = await sql`SELECT state FROM agent_notification_snapshots
      WHERE run_date=${runDate} AND snapshot_at=${snapshotAt}::timestamptz`;
    return current[0]?.state === 'sent' ? 'sent' : 'pending';
  }
  try {
    const id = await submitEmail(runDate, snapshotAt, deals, near, report);
    await sql`UPDATE agent_notification_snapshots SET state='sent',sent_at=now(),provider_id=${id}
      WHERE run_date=${runDate} AND snapshot_at=${snapshotAt}::timestamptz`;
    return 'sent';
  } catch (error) {
    await sql`DELETE FROM agent_notification_snapshots
      WHERE run_date=${runDate} AND snapshot_at=${snapshotAt}::timestamptz AND state='sending'`;
    throw error;
  }
}

export async function retrySavedNotifications(runDates: string[]) {
  if (!notificationConfig().configured) return { status: 'not-configured' as const, attempted: 0 };
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`SELECT run_key,report,deals,near_misses FROM agent_runs
    WHERE run_key=${runDates[0]} OR run_key=${runDates[1]} ORDER BY run_key ASC`;
  const results = [];
  for (const row of rows) {
    const report = row.report as RunReport;
    if (!report?.batchSnapshotAt) continue;
    try {
      const status = await sendRunNotification(String(row.run_key), row.deals as NormalizedOffer[], row.near_misses as NormalizedOffer[], report, report.batchSnapshotAt);
      results.push({ runDate: row.run_key, status });
    } catch (error) {
      console.error(`[notification] retry failed date=${row.run_key}`, error);
      results.push({ runDate: row.run_key, status: 'failed' });
    }
  }
  return { status: results.length && results.every(x => x.status === 'sent') ? 'sent' as const : 'pending' as const, attempted: results.length, results };
}
