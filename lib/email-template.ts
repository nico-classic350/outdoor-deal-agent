import type { NormalizedOffer, RunReport, SourceCoverage } from './types';

// The daily mail must open instantly in Gmail and mail apps: Gmail clips HTML
// above ~102 KB ("Nachricht gekürzt") and every remote image is fetched before
// the layout settles. So: compact rows, small thumbnails with fixed size,
// near misses without images, and the shop coverage as grouped text instead
// of the technical table (details stay on the dashboard / /api/coverage).
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const eur = (value: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
const pct = (value: number) => `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value)} %`;
const safeUrl = (value?: string) => {
  try { const url = new URL(value || ''); return url.protocol === 'https:' ? url.href : null; }
  catch { return null; }
};
const signed = (value: number | null) => value === null ? '—' : `${value > 0 ? '+' : ''}${value}`;
const THUMB = 72;
const DASHBOARD = 'https://outdoor-deal-agent.vercel.app/';

/** Ask image CDNs that support it for a small thumbnail instead of the full product photo. */
export function thumbnailUrl(value?: string): string | null {
  const href = safeUrl(value);
  if (!href) return null;
  const url = new URL(href);
  const px = String(THUMB * 2);
  if (url.hostname === 'cdn.shopify.com' || url.pathname.includes('/cdn/shop/')) url.searchParams.set('width', px);
  else if (url.hostname.endsWith('.imgix.net')) { url.searchParams.set('w', px); url.searchParams.set('auto', 'format'); }
  return url.href;
}

function sizeText(offer: NormalizedOffer) {
  if (offer.sizeFit === 'confirmed') return offer.sizes?.join(', ') || 'passende Größe bestätigt';
  if (offer.sizeFit === 'probable') return `wahrscheinlich passend${offer.sizes?.length ? ` (${offer.sizes.slice(0, 6).join(', ')})` : ''}`;
  return 'nicht verifiziert – im Shop prüfen';
}

type HideLink = (offer: NormalizedOffer) => string | null;
const hideAnchor = (offer: NormalizedOffer, hide?: HideLink) => {
  const href = hide ? safeUrl(hide(offer) || undefined) : null;
  return href ? ` · <a href="${esc(href)}" style="color:#777;font-size:12px">Nicht relevant – ausblenden</a>` : '';
};

function dealRow(offer: NormalizedOffer, hide?: HideLink) {
  const image = thumbnailUrl(offer.imageUrl);
  const link = safeUrl(offer.url);
  const extraCostsUnknown = !offer.shippingKnown || offer.returnCostEur == null;
  const title = `${esc(offer.brand)} ${esc(offer.name)}`;
  return `<tr><td width="${THUMB + 10}" valign="top" style="padding:8px 10px 8px 0;border-bottom:1px solid #eee">${image
    ? `<img src="${esc(image)}" alt="" width="${THUMB}" height="${THUMB}" style="display:block;object-fit:contain">` : ''}</td>`
    + `<td valign="top" style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px">`
    + `${link ? `<a href="${esc(link)}" style="color:#111;text-decoration:none"><b>${title}</b></a>` : `<b>${title}</b>`}<br>`
    + `<span style="color:#555">${esc(offer.merchant)}</span>${link ? ` · <a href="${esc(link)}" style="color:#0b57d0">Zum Shop</a>` : ''} · Größe: <strong>${esc(sizeText(offer))}</strong><br>`
    + `<strong style="font-size:17px">${eur(offer.effectiveCostEur)}</strong> `
    + `${offer.rrpEur == null ? '' : `<s style="color:#777">${eur(offer.rrpEur)}</s> `}<b style="color:#b00020">−${pct(offer.effectiveDiscountPct)}</b>`
    + `${extraCostsUnknown ? '<br><small style="color:#777">zzgl. ggf. ungeklärter Versand-/Retourenkosten</small>' : ''}`
    + `${offer.reason ? `<br><small>${esc(offer.reason)}</small>` : ''}${((anchor) => anchor ? `<br>${anchor.slice(3)}` : '')(hideAnchor(offer, hide))}</td></tr>`;
}

function nearRow(offer: NormalizedOffer, hide?: HideLink) {
  const link = safeUrl(offer.url);
  const title = `${esc(offer.brand)} ${esc(offer.name)}`;
  return `<li style="margin:0 0 6px">${link ? `<a href="${esc(link)}" style="color:#111">${title}</a>` : title} · ${esc(offer.merchant)} · `
    + `${eur(offer.effectiveCostEur)} (−${pct(offer.effectiveDiscountPct)}) · Größe: ${esc(sizeText(offer))}${hideAnchor(offer, hide)}`
    + `${offer.reason ? `<br><small style="color:#777">${esc(offer.reason)}</small>` : ''}</li>`;
}

function coverageGroups(coverage: SourceCoverage[]) {
  const label = (c: SourceCoverage) => esc(c.name);
  const groups: [string, SourceCoverage[]][] = [
    ['Mit Deals', coverage.filter(c => (c.qualifiedOffers ?? 0) > 0)],
    ['Passende Hosen, aber kein Deal', coverage.filter(c => !(c.qualifiedOffers ?? 0) && (c.eligibleOffers ?? 0) > 0)],
    ['Produkte, aber keine passenden Hosen', coverage.filter(c => !(c.qualifiedOffers ?? 0) && !(c.eligibleOffers ?? 0) && c.parsedOffers > 0)],
    ['Blockiert', coverage.filter(c => !c.parsedOffers && c.status === 'blocked')],
    ['Keine Produkte gelesen', coverage.filter(c => !c.parsedOffers && c.status !== 'blocked')],
  ];
  return groups.filter(([, list]) => list.length).map(([title, list]) =>
    `<tr><td valign="top" style="padding:4px 10px 4px 0;white-space:nowrap"><b>${title}</b> (${list.length})</td><td style="padding:4px 0">${
      list.map(c => title === 'Mit Deals' ? `${label(c)} (${c.qualifiedOffers})` : title === 'Passende Hosen, aber kein Deal' ? `${label(c)} (${c.eligibleOffers})` : label(c)).join(', ')}</td></tr>`).join('');
}

export function renderRunEmail(runDate: string, deals: NormalizedOffer[], near: NormalizedOffer[], report: RunReport,
  options: { hideLink?: HideLink } = {}) {
  const comparison = report.comparison;
  const metrics = comparison?.metrics.filter(m => ['sourcesWithProducts','rawOffers','normalizedOffers','confirmedSizeOffers','qualifiedDeals','nearMisses','blocked','failed'].includes(m.metric)) || [];
  const labels: Record<string,string> = { sourcesWithProducts:'Shops mit Produkten', rawOffers:'Rohangebote', normalizedOffers:'Verwertbare Angebote', confirmedSizeOffers:'Größe bestätigt', qualifiedDeals:'Rabatt-Deals', nearMisses:'Prüfkandidaten', blocked:'Blockiert', failed:'Fehlgeschlagen' };
  const summary = `Registrierte Shops ${report.plannedSources} · versucht ${report.attemptedSources} · erfolgreich ${report.success} · teilweise ${report.partial} · Browser ${report.browser} · blockiert ${report.blocked} · fehlgeschlagen ${report.failed} · Rohangebote ${report.rawOffers} · normalisiert ${report.normalizedOffers} · Größe bestätigt ${report.confirmedSizeOffers} · Deals ${deals.length} · Prüfkandidaten ${near.length}`;
  const table = (rows: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#202124;line-height:1.4;max-width:640px;margin:auto">`
    + `<h1 style="font-size:20px;margin:0 0 4px">Outdoor Deals · ${esc(runDate)}</h1>`
    + `<p style="margin:0 0 12px;color:#555"><b>${deals.length} Deals</b> · ${near.length} Prüfkandidaten</p>`
    + `<h2 style="font-size:17px">1. Deals mit Rabattbeleg</h2>${deals.length ? table(deals.map(o => dealRow(o, options.hideLink)).join('')) : '<p><strong>Keine Angebote mit ausreichend belegtem Rabatt in diesem Lauf.</strong></p>'}`
    + `<h2 style="font-size:17px">Prüfkandidaten</h2>${near.length ? `<ul style="padding-left:18px;font-size:13px">${near.map(o => nearRow(o, options.hideLink)).join('')}</ul>` : '<p>Keine Prüfkandidaten.</p>'}`
    + (comparison ? `<h2 style="font-size:17px">Veränderung zum ${comparison.baselineKind === 'same-day-rerun' ? 'vorigen Bericht von heute' : 'Vortag'}</h2>`
      + `<table cellpadding="4" style="border-collapse:collapse;font-size:13px">${metrics.map(m => `<tr><td>${esc(labels[m.metric] || m.metric)}</td><td align="right">${m.previous ?? '—'}</td><td>→</td><td align="right"><b>${m.current}</b></td><td>(${signed(m.delta)})</td></tr>`).join('')}</table>` : '')
    + `<h2 style="font-size:17px">2. Coverage Report</h2><p style="font-size:12px;color:#555">Zusammenfassung: ${esc(summary)}. Lauf ${esc(report.startedAt)} – ${esc(report.finishedAt)}.</p>`
    + `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px">${coverageGroups(report.coverage)}</table>`
    + `<p style="font-size:12px;color:#555">Technische Details je Shop: <a href="${DASHBOARD}">Dashboard</a></p></div>`;
}

/** Plain-text alternative: mail apps show it in previews and on slow connections. */
export function renderRunText(runDate: string, deals: NormalizedOffer[], near: NormalizedOffer[], report: RunReport) {
  const line = (o: NormalizedOffer) => `- ${o.brand} ${o.name} (${o.merchant}): ${eur(o.effectiveCostEur)}${o.rrpEur == null ? '' : ` statt ${eur(o.rrpEur)}`}, −${pct(o.effectiveDiscountPct)}, Größe: ${sizeText(o)}${safeUrl(o.url) ? `\n  ${safeUrl(o.url)}` : ''}`;
  return [`Outdoor Deals ${runDate}: ${deals.length} Deals, ${near.length} Prüfkandidaten`, '',
    'DEALS', ...(deals.length ? deals.map(line) : ['Keine Angebote mit ausreichend belegtem Rabatt.']), '',
    'PRÜFKANDIDATEN', ...(near.length ? near.map(line) : ['Keine.']), '',
    `Shops: ${report.attemptedSources}/${report.plannedSources} geprüft, ${report.blocked} blockiert, ${report.failed} ohne Produkte. Details: ${DASHBOARD}`].join('\n');
}
