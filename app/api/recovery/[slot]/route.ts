import { NextRequest } from 'next/server';
import { GET as reconcile } from '../../watchdog/route';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Separate daily cron paths provide additional recovery windows on Vercel Hobby.
// The shared watchdog verifies CRON_SECRET before accessing any pipeline data.
export async function GET(request: NextRequest) {
  return reconcile(request);
}
