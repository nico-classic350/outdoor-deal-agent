import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { fromB64, setHidden, verifyHideKey } from '../../../lib/hidden-offers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(title: string, body: string, status = 200) {
  return new Response(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>
body{font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:40px auto;padding:0 16px;color:#202124;line-height:1.45}
button{font-size:16px;padding:10px 16px;border:0;background:#111;color:#fff;cursor:pointer}button.secondary{background:#e8e8e8;color:#111}
a{color:#0b57d0}</style></head><body>${body}<p><a href="/">Zum Dashboard</a></p></body></html>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}

function form(k: string, l: string, s: string, action: 'hide' | 'unhide', label: string, secondary = false) {
  return `<form method="post" action="/api/hide"><input type="hidden" name="k" value="${esc(k)}"><input type="hidden" name="l" value="${esc(l)}">
<input type="hidden" name="s" value="${esc(s)}"><input type="hidden" name="action" value="${action}">
<button${secondary ? ' class="secondary"' : ''}>${esc(label)}</button></form>`;
}

function readParams(get: (name: string) => string | null) {
  const k = get('k') || '', l = get('l') || '', s = get('s') || '';
  const key = fromB64(k), label = fromB64(l) || key;
  return { k, l, s, key, label, valid: Boolean(key) && verifyHideKey(key, s) };
}

// GET only confirms: mail scanners open links in advance, so nothing changes here.
export async function GET(req: NextRequest) {
  const p = readParams(name => req.nextUrl.searchParams.get(name));
  if (!p.valid) return page('Link ungültig', '<h1>Link ungültig</h1><p>Dieser Ausblenden-Link ist unvollständig oder abgelaufen.</p>', 400);
  return page('Hose ausblenden', `<h1>Nicht relevant?</h1><p><strong>${esc(p.label)}</strong></p>
<p>Diese Hose taucht danach in keiner Deal-Mail und nicht mehr im Dashboard auf – auch nicht bei anderen Shops. Rückgängig machen geht jederzeit.</p>
${form(p.k, p.l, p.s, 'hide', 'Ausblenden')}`);
}

export async function POST(req: NextRequest) {
  const data = await req.formData();
  const p = readParams(name => { const v = data.get(name); return typeof v === 'string' ? v : null; });
  const action = data.get('action') === 'unhide' ? 'unhide' : 'hide';
  if (!p.valid) return page('Link ungültig', '<h1>Link ungültig</h1>', 400);
  if (!process.env.DATABASE_URL) return page('Nicht möglich', '<h1>Datenbank nicht konfiguriert</h1>', 503);
  await setHidden(neon(process.env.DATABASE_URL), p.key, p.label, action === 'hide');
  return action === 'hide'
    ? page('Ausgeblendet', `<h1>Ausgeblendet ✓</h1><p><strong>${esc(p.label)}</strong> erscheint nicht mehr in deinen Deal-Mails.</p>
${form(p.k, p.l, p.s, 'unhide', 'Rückgängig – wieder anzeigen', true)}`)
    : page('Wieder sichtbar', `<h1>Wieder sichtbar ✓</h1><p><strong>${esc(p.label)}</strong> erscheint wieder in den Deal-Mails, sobald sie als Deal gefunden wird.</p>
${form(p.k, p.l, p.s, 'hide', 'Doch ausblenden')}`);
}
