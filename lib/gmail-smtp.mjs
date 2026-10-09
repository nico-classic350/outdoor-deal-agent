import nodemailer from 'nodemailer';
import { createHash } from 'node:crypto';

export async function sendGmailEmail({ user, password, to, subject, html, text, runDate, snapshotAt }, transporter) {
  const smtp = transporter ?? nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user, pass: password }, connectionTimeout: 10000,
    greetingTimeout: 10000, socketTimeout: 15000 });
  // Stable Message-ID helps mailbox clients identify a retry of this snapshot.
  // SMTP itself does not guarantee idempotency after a worker crashes.
  const digest = createHash('sha256').update(`${runDate}/${snapshotAt}`).digest('hex').slice(0, 32);
  const response = await smtp.sendMail({ from: user, to, subject, html, ...(text ? { text } : {}),
    messageId: `<outdoor-deals-${digest}@gmail.com>` });
  const accepted = response.accepted.some(address =>
    (typeof address === 'string' ? address : address.address).toLowerCase() === to.toLowerCase());
  if (!accepted || response.rejected.length) throw new Error('Gmail SMTP did not accept the intended recipient');
  if (!response.messageId) throw new Error('Gmail SMTP returned no message ID');
  return response.messageId;
}
