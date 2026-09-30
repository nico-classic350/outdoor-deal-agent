// The report mail should arrive around 07:00 German time. Vercel crons run in
// UTC, so the finalizer is scheduled for the 05:00 UTC hour (07:00 in summer)
// and waits in winter, when that hour is 06:00 in Berlin; the finalizer retry
// in the 06:00 UTC hour then sends at 07:00.
export const SEND_HOUR_BERLIN = 7;
export function berlinHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' }).format(now));
}
