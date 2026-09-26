// Keep the acceptance rules independent of the crawler so the production path
// can be exercised with real examples in node:test.
const trouser = /\b(?:hosen?|pants?|trousers?|trekkinghose|wanderhose|outdoorhose|kletterhose|langlaufhose|skihose|regenhose|pantalon(?:s)?|calzoni)\b/i;
const excluded = /\b(?:damen|frauen|women|womens|woman|ladies|femme|femmes|kinder|kids|junior|mädchen|girls|shorts?|kurze hose|tights?|leggings?|jogger|sweatpants?|cross.country|snowboard|winter|insulated|thermal|gefüttert|fleece|rain pants?|waterproof pants?|hardshell|überhose|overtrousers?|zip[ -]?off|convertible|climbing pants?|bermuda|bib|salopette)\b/i;
const excludedCompounds = /(?:skitour(?:en)?(?:hose|hosen|pants?)?|langlauf(?:hose|hosen|pants?)?|winter(?:hose|hosen|pants?)?|regen(?:hose|hosen|pants?)?|kletter(?:hose|hosen|pants?)?)/i;

export function productEligible(name, description = '') {
  const text = `${name} ${description}`;
  return trouser.test(name) && !excluded.test(text) && !excludedCompounds.test(text);
}

export function sizeEvidence(sizes) {
  if (!Array.isArray(sizes) || !sizes.length) return 'unconfirmed';

  const normalized = sizes.map(item => String(item).trim().toUpperCase().replace(/\s+/g, ' ')).filter(Boolean);
  if (!normalized.length) return 'unconfirmed';

  let anyAmbiguous = false;
  let anyExplicit = false;

  for (const s of normalized) {
    const m = s.match(/^(?:W(?:AIST)?\s*)?(33|34)(?:\s*(?:\/|[- ]?L(?:ENGTH)?\s*)(\d{2}))?$/);
    if (m && (!m[2] || Number(m[2]) <= 32)) {
      if (/^W/.test(s) || m[2]) return 'confirmed';
      return 'probable';
    }
    if (/^(?:EU\s*)?(?:50|52)$/i.test(s)) return 'probable';
  }

  for (const s of normalized) {
    const waist = s.match(/^(?:W(?:AIST)?\s*)?(\d{2})(?:\s*(?:\/|[- ]?L(?:ENGTH)?\s*)(\d{2}))?$/);
    if (waist && (/^W/.test(s) || waist[2])) {
      anyExplicit = true;
      continue;
    }
    if (/^(?:XXS|XS|S)$/i.test(s)) {
      anyExplicit = true;
      continue;
    }
    anyAmbiguous = true;
  }

  // Fail closed only when every available size is explicitly incompatible.
  // Unknown/ambiguous systems remain reviewable instead of suppressing a good deal.
  if (anyExplicit && !anyAmbiguous) return 'no';
  return 'unconfirmed';
}

export function dealTier(effectiveDiscountPct, fit) {
  if (effectiveDiscountPct >= 55 && fit >= 70) return 'Top Deal';
  if (effectiveDiscountPct >= 45) return 'Strong Deal';
  if (effectiveDiscountPct >= 40 && fit >= 75) return 'Good Deal';
  return 'Near Miss';
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
  for (const raw of offers) {
    if (raw.sizeFit === 'no') continue;
    const o = { ...raw, class: dealTier(raw.effectiveDiscountPct, Number(raw.productFitScore || 0)) };
    const k = offerKey(o), old = best.get(k);
    if (!old || (o.sizeFit === 'confirmed' && old.sizeFit !== 'confirmed') ||
        (o.sizeFit === old.sizeFit && o.effectiveCostEur < old.effectiveCostEur)) best.set(k, o);
  }

  const unique = [...best.values()].sort((a, b) => b.score - a.score);
  const deals = unique
    .filter(o => o.class !== 'Near Miss' && o.effectiveDiscountPct >= minDiscount)
    .slice(0, 5);
  const dealKeys = new Set(deals.map(offerKey));

  const near = unique.filter(o => o.effectiveDiscountPct >= 30 && !dealKeys.has(offerKey(o)))
    .map(o => ({
      ...o,
      class: 'Near Miss',
      reason: o.effectiveDiscountPct < minDiscount
        ? 'Rabatt unter der Deal-Schwelle.'
        : 'Rabatt erreicht die Schwelle, aber der Produktfit ist für diese Rabattklasse nicht stark genug.'
    }))
    .slice(0, 3);
  return { deals, near };
}
