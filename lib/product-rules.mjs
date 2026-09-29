// Keep the acceptance rules independent of the crawler so the production path
// can be exercised with real examples in node:test.
const trouser = /\b(?:hosen?|pants?|trousers?|(?:trekking|wander|outdoor|softshell|stretch|funktions|freizeit|reise|travel|walking|hiking|kletter|langlauf|ski|regen)hosen?|pantalon(?:s)?|calzoni)\b/i;
const excluded = /\b(?:damen|frauen|women|womens|woman|ladies|femme|femmes|kinder|kids|junior|mädchen|girls|shorts?|kurze hose|tights?|leggings?|jogger|sweatpants?|cross.country|snowboard|winter|insulated|thermal|gefüttert|fleece|rain pants?|waterproof pants?|hardshell|überhose|overtrousers?|zip[ -]?off|convertible|bermuda|bib|salopette)\b/i;
const excludedCompounds = /(?:skitour(?:en)?(?:hose|hosen|pants?)?|langlauf(?:hose|hosen|pants?)?|winter(?:hose|hosen|pants?)?|regen(?:hose|hosen|pants?)?|kletter(?:hose|hosen|pants?)?)/i;
const incompatibleDescription = /\b(?:damen|frauen|women'?s?|ladies|femmes?|kinder|kids|junior|mädchen|girls)\b|(?:skitour(?:en)?(?:hose|hosen|pants?)?|langlauf(?:hose|hosen|pants?)?|winter(?:hose|hosen|pants?)?|regen(?:hose|hosen|pants?)?)/i;

export function productEligible(name, description = '') {
  // Product titles identify the item. Descriptions can mention other products,
  // shorts, or waterproof pockets without describing the trousers themselves.
  return trouser.test(name) && !excluded.test(name) && !excludedCompounds.test(name)
    && !incompatibleDescription.test(description);
}

export function sizeEvidence(sizes) {
  if (!Array.isArray(sizes) || !sizes.length) return 'unconfirmed';

  const normalized = sizes.map(item => String(item).trim().toUpperCase().replace(/\s+/g, ' ')).filter(Boolean);
  if (!normalized.length) return 'unconfirmed';

  let anyAmbiguous = false;
  let anyExplicit = false;

  for (const s of normalized) {
    // Letter sizing is common for outdoor trousers and L is the user's target.
    if (/^L(?:\s+(?:REG(?:ULAR)?|R))?$/.test(s)) return 'confirmed';
    const m = s.match(/^(?:W(?:AIST)?\s*)?(33|34)(?:\s*(?:\/|[- ]?L(?:ENGTH)?\s*)(\d{2}))?$/);
    if (m && (!m[2] || Number(m[2]) <= 32)) {
      // Waist-only labels do not prove the inseam is at most L32.
      if (m[2]) return 'confirmed';
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
  if (effectiveDiscountPct >= 40) return 'Good Deal';
  return 'Near Miss';
}

export function offerKey(o) {
  try {
    const u = new URL(String(o.url).replace(/&amp;/gi, '&'));
    u.hash = '';
    for (const param of [...u.searchParams.keys()]) {
      if (/^(?:utm_.*|gclid|fbclid|ref|source|campaign|aid|affiliate(?:_?id)?|affid|clickid)$/i.test(param)) u.searchParams.delete(param);
    }
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return `${o.sourceId}|${u.hostname.toLowerCase()}${u.pathname}${u.search}`;
  } catch {
    return `${o.sourceId}|${o.brand}|${o.name}|${o.color || ''}`.toLowerCase();
  }
}

// Model identity is deliberately separate from offer identity: an alternative
// colour, size, merchant or tracking link should not occupy another mail slot.
export function modelKey(o) {
  const brand = String(o.brand || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  let title = String(o.name || '').split('|')[0].trim();
  if (o.color) {
    const colour = String(o.color).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    title = title.replace(new RegExp(`\\s*[-–,]\\s*${colour}\\s*$`, 'i'), '');
  }
  title = title.replace(/^\s*(?:herren|men'?s?)\s+/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').toLowerCase().trim();
  if (brand && title.startsWith(`${brand} `)) title = title.slice(brand.length + 1);
  // Generic catalogue labels do not identify a model; only its canonical URL does.
  const generic = /^(?:herren |men s? )?(?:wanderhose|trekkinghose|outdoorhose|softshellhose|pants?|trousers?|hose)$/i;
  return title.split(' ').length >= 2 && !generic.test(title)
    ? `model|${brand}|${title}` : `url|${offerKey(o)}`;
}

export function selectOffers(offers, minDiscount = 40) {
  const best = new Map();
  for (const raw of offers) {
    if (raw.sizeFit === 'no') continue;
    const classified = dealTier(raw.effectiveDiscountPct, Number(raw.productFitScore || 0));
    const priceEvidenceComplete = raw.rrpVerified === true || raw.discountVerified === true;
    // Unknown size, shipping or returns require a visible shop check, not a
    // rejection. The merchant-linked discount remains mandatory.
    const o = { ...raw, class: priceEvidenceComplete ? classified : 'Near Miss' };
    const k = offerKey(o), old = best.get(k);
    const evidenceRank = x => Number(x.rrpVerified === true || x.discountVerified === true) + Number(x.shippingKnown === true) + Number(x.sizeFit === 'confirmed');
    if (!old || evidenceRank(o) > evidenceRank(old) ||
        (evidenceRank(o) === evidenceRank(old) && (o.score > old.score ||
          (o.score === old.score && o.effectiveCostEur < old.effectiveCostEur)))) best.set(k, o);
  }

  const models = new Map();
  const qualifies = x => (x.rrpVerified === true || x.discountVerified === true) &&
    x.class !== 'Near Miss' && x.effectiveDiscountPct >= minDiscount;
  for (const offer of best.values()) {
    const key = modelKey(offer), old = models.get(key);
    if (!old || Number(qualifies(offer)) > Number(qualifies(old)) ||
      (qualifies(offer) === qualifies(old) && (offer.score > old.score ||
        (offer.score === old.score && offer.effectiveCostEur < old.effectiveCostEur)))) models.set(key, offer);
  }
  const unique = [...models.values()].sort((a, b) => b.score - a.score);
  const qualified = unique
    .filter(qualifies)
  const deals = qualified.slice(0, 5);
  const qualifiedKeys = new Set(qualified.map(offerKey));

  const near = unique.filter(o => o.effectiveDiscountPct >= 30 && !qualifiedKeys.has(offerKey(o)))
    .map(o => ({
      ...o,
      class: 'Near Miss',
      reason: o.rrpVerified !== true && o.discountVerified !== true ? 'Referenzpreis oder Händler-Rabattangabe nicht hinreichend belegt.'
        : o.effectiveDiscountPct < minDiscount
        ? 'Rabatt unter der Deal-Schwelle.'
        : 'Rabattbeleg oder Produktdaten im Shop prüfen.'
    }))
    .slice(0, 12);
  return { deals, near, qualifiedCount: qualified.length };
}
