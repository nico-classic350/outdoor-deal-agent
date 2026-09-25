// Keep the acceptance rules independent of the crawler so the production path
// can be exercised with real examples in node:test.
const trouser = /\b(?:hosen?|pants?|trousers?|trekkinghose|wanderhose|outdoorhose|kletterhose|langlaufhose|skihose|regenhose|pantalon(?:s)?|calzoni)\b/i;
const excluded = /\b(?:damen|frauen|women|womens|woman|ladies|femme|femmes|kinder|kids|junior|mädchen|girls|shorts?|kurze hose|tights?|leggings?|jogger|sweatpants?|langlauf|cross.country|ski(?:touren?|hose|pants|ing)?|snowboard|winter|insulated|thermal|gefüttert|fleece|regenhose|rain pants?|waterproof pants?|hardshell|überhose|overtrousers?|zip[ -]?off|convertible|kletterhose|climbing pants?|bermuda|bib|salopette)\b/i;

export function productEligible(name, description = '') {
  // A long page description can contain other products; require the product
  // title itself to establish the category.
  return trouser.test(name) && !excluded.test(`${name} ${description}`);
}

export function sizeEvidence(sizes) {
  if (!Array.isArray(sizes) || !sizes.length) return 'unconfirmed';
  for (const item of sizes) {
    const s = String(item).trim().toUpperCase().replace(/\s+/g, ' ');
    const m = s.match(/^(?:W(?:AIST)?\s*)?(33|34)(?:\s*(?:\/|[- ]?L(?:ENGTH)?\s*)(\d{2}))?$/);
    if (m && (!m[2] || Number(m[2]) <= 32)) {
      // Bare numbers may be EU sizing or waist sizing; only W and waist/inseam
      // labels are definite trouser waist measurements.
      if (/^W/.test(s) || m[2]) return 'confirmed';
      return 'probable';
    }
  }
  if (sizes.some(x => /^(?:EU\s*)?(?:50|52)$/i.test(String(x).trim()))) return 'probable';
  return 'unconfirmed';
}

export function offerKey(o) {
  try {
    const u = new URL(o.url);
    u.hash = '';
    for (const param of [...u.searchParams.keys()]) {
      if (/^(?:utm_.*|gclid|fbclid|ref|source|campaign)$/i.test(param)) u.searchParams.delete(param);
    }
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return `${o.sourceId}|${u.hostname.toLowerCase()}${u.pathname}${u.search}`;
  } catch {
    return `${o.sourceId}|${o.brand}|${o.name}|${o.color || ''}`.toLowerCase();
  }
}

export function selectOffers(offers, minDiscount = 40) {
  const best = new Map();
  for (const o of offers) {
    const k = offerKey(o), old = best.get(k);
    // Prefer an offer with a verified size before choosing the lower price.
    if (!old || (o.sizeFit === 'confirmed' && old.sizeFit !== 'confirmed') ||
        (o.sizeFit === old.sizeFit && o.effectiveCostEur < old.effectiveCostEur)) best.set(k, o);
  }
  const unique = [...best.values()].sort((a, b) => b.score - a.score);
  const deals = unique.filter(o => o.sizeFit === 'confirmed' && o.class !== 'Near Miss' && o.effectiveDiscountPct >= minDiscount).slice(0, 5);
  const near = unique.filter(o => o.effectiveDiscountPct >= 30 && !deals.includes(o))
    .map(o => ({ ...o, class: 'Near Miss', reason: o.sizeFit !== 'confirmed'
      ? 'Passende Bundweite und Verfügbarkeit nicht bestätigt; Preis kann für eine andere Größe gelten.'
      : 'Rabatt unter der Deal-Schwelle.' }))
    .slice(0, 3);
  return { deals, near };
}
