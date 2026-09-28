import test from 'node:test';
import assert from 'node:assert/strict';
import { sendGmailEmail } from '../lib/gmail-smtp.mjs';

const message = { user:'nicohertwig0@gmail.com', password:'test-only', to:'nicohertwig0@gmail.com',
  subject:'Outdoor Deal Alert', html:'<h1>Bericht</h1>', runDate:'2026-09-28', snapshotAt:'2026-09-28T04:52:00Z' };

test('Gmail SMTP uses the selected account as sender and requires recipient acceptance', async () => {
  let sent;
  const smtp = { sendMail: async value => { sent = value; return { accepted:[message.to], rejected:[], messageId:value.messageId }; } };
  const id = await sendGmailEmail(message, smtp);
  assert.equal(sent.from, message.user);
  assert.equal(sent.to, message.to);
  assert.equal(sent.html, message.html);
  assert.match(id, /^<outdoor-deals-[a-f0-9]{32}@gmail\.com>$/);
  assert.equal(await sendGmailEmail(message, smtp), id);
});

test('a rejected recipient cannot mark a daily email as sent', async () => {
  const smtp = { sendMail: async () => ({ accepted:[], rejected:[message.to], messageId:'<id@gmail.com>' }) };
  await assert.rejects(sendGmailEmail(message, smtp), /did not accept/);
});
