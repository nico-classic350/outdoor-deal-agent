import type { NormalizedOffer, RunReport } from './types';

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const eur = (value: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
const pct = (value: number) => `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value)} %`;
const safeUrl = (value?: string) => {
  try { const url = new URL(value || ''); return url.protocol === 'https:' ? url.href : null; }
  catch { return null; }
};
const signed = (value: number | null) => value === null ? '—' : `${value > 0 ? '+' : ''}${value}`;

function offerRow(offer: NormalizedOffer) {
  const image = safeUrl(offer.imageUrl);
  const link = safeUrl(offer.url);
  const size = offer.sizeFit === 'confirmed' ? (offer.sizes?.join(', ') || 'passende Größe bestätigt') : 'nicht verifiziert – im Shop prüfen';
  const extraCostsUnknown = !offer.shippingKnown || offer.returnCostEur == null;
  return `<tr><td width="110" valign="top" style="padding:12px 12px 12px 0;border-bottom:1px solid #ddd">${image ? `<img src="${esc(image)}" alt="" width="100" style="max-width:100px;height:auto">` : ''}</td>
    <td valign="top" style="padding:12px 0;border-bottom:1px solid #ddd"><strong>${esc(offer.brand)} ${esc(offer.name)}</strong><br>${esc(offer.merchant)}
    <p>Farbe: ${esc(offer.color || 'nicht verifiziert')} · Größe: <strong>${esc(size)}</strong></p>
    <strong style="font-size:20px">${eur(offer.effectiveCostEur)}</strong>${extraCostsUnknown ? ' <small>zzgl. ggf. ungeklärter Versand-/Retourenkosten</small>' : ''}<br>
    Preis: ${eur(offer.priceEur)} · Früherer/Referenzpreis: ${offer.rrpEur == null ? 'nicht angegeben' : eur(offer.rrpEur)} · Rabatt${extraCostsUnknown ? ' vor ungeklärten Nebenkosten' : ' nach bekannten Nebenkosten'}: ${pct(offer.effectiveDiscountPct)}<br>
    ${esc(offer.class)} · Score ${offer.score}/100 · Versand: ${offer.shippingKnown ? eur(offer.shippingEur) : 'nicht verifiziert'} · Rücksendekosten: ${offer.returnCostEur == null ? 'nicht verifiziert' : eur(offer.returnCostEur)}
    ${offer.reason ? `<p>${esc(offer.reason)}</p>` : ''}${link ? `<p><a href="${esc(link)}" style="display:inline-block;background:#111;color:#fff;padding:9px 14px;text-decoration:none">Zum Shop</a></p>` : ''}</td></tr>`;
}

export function renderRunEmail(runDate: string, deals: NormalizedOffer[], near: NormalizedOffer[], report: RunReport) {
  const comparison = report.comparison;
  const metrics = comparison?.metrics.filter(m => ['reachedSources','sourcesWithProducts','browserRecoveredSources','browserProviderLimitedSources','rawOffers','normalizedOffers','confirmedSizeOffers','qualifiedDeals','nearMisses','blocked','failed'].includes(m.metric)) || [];
  const labels: Record<string,string> = { reachedSources:'Shops erreicht', sourcesWithProducts:'Shops mit Produkten', browserRecoveredSources:'Browser brachte Produkte', browserProviderLimitedSources:'Browserdienst limitiert', rawOffers:'Rohangebote', normalizedOffers:'Verwertbare Angebote', confirmedSizeOffers:'Größe bestätigt', qualifiedDeals:'Rabatt-Deals', nearMisses:'Prüfkandidaten', blocked:'Blockiert', failed:'Fehlgeschlagen' };
  const summary = `Registrierte Shops ${report.plannedSources} · versucht ${report.attemptedSources} · erfolgreich ${report.success} · teilweise ${report.partial} · Browser ${report.browser} · blockiert ${report.blocked} · fehlgeschlagen ${report.failed} · Rohangebote ${report.rawOffers} · normalisiert ${report.normalizedOffers} · Größe bestätigt ${report.confirmedSizeOffers} · Deals ${deals.length} · Prüfkandidaten ${near.length}`;
  const coverage = report.coverage.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.status)}</td><td>${esc(c.technicalPath?.join(' → ') || '')}</td><td>${esc(c.httpStatuses?.join(', ') || '')}</td><td>${c.discoveredUrls ?? '—'}</td><td>${c.parsedOffers}</td><td>${c.pricedOffers ?? 0}</td><td>${c.qualifiedOffers ?? 0}</td><td>${c.elapsedMs ?? '—'}</td><td>${esc(c.note || '')}</td></tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;color:#202124;line-height:1.45;max-width:900px;margin:auto">
    <h1>Outdoor Deal Alert · ${esc(runDate)}</h1><p><strong>Zusammenfassung:</strong> ${esc(summary)}.</p>
    <p>Lauf: ${esc(report.startedAt)} bis ${esc(report.finishedAt)} · ${report.attemptedSources}/${report.plannedSources} Quellen geprüft.</p>
    <h2>1. Deals mit Rabattbeleg</h2>${deals.length ? `<p>${deals.length} Angebote mit passender Marke/Kategorie und belegtem Rabatt. Unbekannte Größe oder Nebenkosten bitte im Shop prüfen:</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${deals.map(offerRow).join('')}</table>` : '<p><strong>Keine Angebote mit ausreichend belegtem Rabatt in diesem Lauf.</strong></p>'}
    <h2>Prüfkandidaten</h2>${near.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${near.map(offerRow).join('')}</table>` : '<p>Keine Prüfkandidaten.</p>'}
    ${comparison ? `<h2>Veränderung zum ${comparison.baselineKind === 'same-day-rerun' ? 'vorigen Bericht von heute' : 'vorigen Tagesbericht'}</h2>
      <p>Vergleichsbasis: ${esc(comparison.baseline.finishedAt)}. Shopdaten können sich zwischen Läufen ändern.</p>
      <table border="1" cellpadding="6"><thead><tr><th>Stufe</th><th>Vorher</th><th>Jetzt</th><th>Delta</th></tr></thead><tbody>${metrics.map(m => `<tr><td>${esc(labels[m.metric] || m.metric)}</td><td>${m.previous ?? '—'}</td><td>${m.current}</td><td>${signed(m.delta)}</td></tr>`).join('')}</tbody></table>` : ''}
    <h2>2. Coverage Report</h2><p>${esc(summary)}.</p>
    <table border="1" cellpadding="5" style="border-collapse:collapse;font-size:11px"><thead><tr><th>Shop</th><th>Status</th><th>Technischer Pfad</th><th>HTTP</th><th>URLs</th><th>Rohangebote</th><th>Verwertbar</th><th>Deals</th><th>ms</th><th>Hinweis</th></tr></thead><tbody>${coverage}</tbody></table></div>`;
}
