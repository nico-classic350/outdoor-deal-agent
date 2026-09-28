import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationConfig } from '../lib/mail-config.mjs';

test('a Gmail sender needs its own app password, even if Resend variables are present', () => {
  const configured = notificationConfig({ DATABASE_URL:'db', GMAIL_SMTP_USER:'nicohertwig0@gmail.com',
    DEAL_NOTIFY_TO:'nicohertwig0@gmail.com', RESEND_API_KEY:'resend', DEAL_NOTIFY_FROM:'sender@example.com' });
  assert.equal(configured.provider, 'gmail');
  assert.equal(configured.configured, false);
  assert.deepEqual(configured.missing, ['GMAIL_SMTP_APP_PASSWORD']);
  assert.equal(notificationConfig({ DATABASE_URL:'db', GMAIL_SMTP_USER:'nicohertwig0@gmail.com',
    GMAIL_SMTP_APP_PASSWORD:'app-only', DEAL_NOTIFY_TO:'nicohertwig0@gmail.com' }).configured, true);
});

test('Resend remains available for verified custom domains', () => {
  assert.deepEqual(notificationConfig({ DATABASE_URL:'db', RESEND_API_KEY:'key', DEAL_NOTIFY_FROM:'notify@example.com',
    DEAL_NOTIFY_TO:'user@example.com' }), { provider:'resend', configured:true, missing:[] });
});
