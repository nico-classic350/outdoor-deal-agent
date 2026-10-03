// Keep the acceptance rules independent of the crawler so the production path
// can be exercised with real examples in node:test.
const trouser = /\b(?:hosen?|pants?|trousers?|(?:trekking|wander|outdoor|softshell|stretch|funktions|reise|travel|walking|hiking|kletter|langlauf|ski|regen)hosen?|pantalon(?:s|e|i|es)?|calzoni|byxor|bukser|broek|housut|kalhoty|nohavice|spodnie)\b/i;
const excluded = /\b(?:damen|frauen|women|womens|woman|ladies|femme|femmes|ws|w's|wmns|donna|mujer|dames|dam|naiset|naisten|damske|damsky|damskie|dame|casual|chinos?|jeans|denim|sweat|lounge|wide|warm(?:er)?|kinder|kids|junior|mädchen|girls|shorts?|kurze hose|tights?|leggings?|joggers?|sweatpants?|cross.country|snowboard|winter|insulated|thermal|gefüttert|fleece|rain pants?|waterproof pants?|hardshell|überhose|overtrousers?|zip[ -]?off|convertible|bermuda|bib|salopette)\b/i;
const excludedCompounds = /(?:(?:freizeit|fleece|rad|bike|lauf|jogging|touren)hosen?|skitour(?:en)?(?:hose|hosen|pants?)?|langlauf(?:hose|hosen|pants?)?|winter(?:hose|hosen|pants?)?|regen(?:hose|hosen|pants?)?|kletter(?:hose|hosen|pants?)?)/i;
const incompatibleDescription = /\b(?:damen|frauen|women'?s?|ladies|femmes?|kinder|kids|junior|mädchen|girls)\b|(?:skitour(?:en)?(?:hose|hosen|pants?)?|langlauf(?:hose|hosen|pants?)?|winter(?:hose|hosen|pants?)?|regen(?:hose|hosen|pants?)?)/i;

export function productEligible(name, description = '') {
  // Product titles identify the item. Descriptions can mention other products,
  // shorts, or waterproof pockets without describing the trousers themselves.
  // Shops write the women's marker with any apostrophe ("W´s", "W’s", "W`s").
  const title = String(name ?? '').replace(/[´`’‘]/g, "'");
  // Diacritics break \b in JS regexes ("Dámské"); test a folded copy as well.
  const folded = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return trouser.test(title) && !excluded.test(title) && !excluded.test(folded) && !excludedCompounds.test(title)
    && !incompatibleDescription.test(description);
}

// Size labels come in many systems. Everything is mapped onto the profile's
// target (waist W33/W34 with inseam <= L32, or letter size L):
//   'target'       – fits (L, L Regular/Short, W34 L32, 34/30, 34R, 34S)
//   'near'         – plausibly fits, inseam or cut unknown (W34, M/L, L/XL,
//                    DE/EU 50/52, Kurzgröße 25/26, FR 44, IT 50)
//   'incompatible' – explicitly another size (S, XL, W32 L32, 34/34, 34L,
//                    L Long, Langgröße 98/102, EU 46)
//   'unknown'      – system not recognised; never used to reject an offer.
const LETTER_TARGET = /^(?:L|LARGE)(?:\s*[-/]?\s*(?:REG(?:ULAR)?|R|SHORT|S|KURZ|K|STANDARD|NORMAL))?$/;
const LETTER_LONG = /^(?:L|LARGE)\s*[-/]?\s*(?:LONG|LANG|TALL|T)$/;
const LETTER_NEAR = /^(?:M\s*\/\s*L|L\s*\/\s*XL|M-L|L-XL)$/;
const LETTER_OTHER = /^(?:XXS|XS|S|SMALL|M|MEDIUM|XL|X-LARGE|XXL|XXXL|[2-6]XL|[2-6]X)(?:\s*[-/]?\s*(?:REG(?:ULAR)?|R|SHORT|S|LONG|L|KURZ|LANG|T|TALL))?$/;

export function normalizeSizeLabel(label) {
  let s = String(label ?? '').toUpperCase().replace(/\s+/g, ' ').trim()
    .replace(/^(?:GR(?:\.|ÖSSE|OESSE)?|SIZE|TAILLE|TALLA|TAGLIA|STORLEK|KOKO)\s*:?\s*/, '')
    .replace(/\s*(?:IN(?:CH)?|")$/, '').trim();
  if (!s) return 'unknown';
  // "L (52)", "L / EU 52": the letter decides.
  const letterFirst = s.match(/^(XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL)\s*(?:\(|\/\s*(?:EU|DE)\b)/);
  if (letterFirst) s = letterFirst[1];

  if (LETTER_LONG.test(s)) return 'incompatible';
  if (LETTER_TARGET.test(s)) return 'target';
  if (LETTER_NEAR.test(s)) return 'near';
  if (LETTER_OTHER.test(s)) return 'incompatible';

  // Waist/inseam in inches: W34 L32, W34/L32, 34/32, 34X32, 34-32, W 34 L 32.
  let m = s.match(/^(?:W(?:AIST)?\s*)?(\d{2})\s*(?:\/|X|-|\s)\s*(?:L(?:ENGTH|ÄNGE)?\s*)?(\d{2})$/) ||
    s.match(/^W(?:AIST)?\s*(\d{2})\s*L(?:ENGTH)?\s*(\d{2})$/);
  if (m && Number(m[1]) >= 26 && Number(m[1]) <= 48 && Number(m[2]) >= 26 && Number(m[2]) <= 38) {
    return [33, 34].includes(Number(m[1])) && Number(m[2]) <= 32 ? 'target' : 'incompatible';
  }
  // German Kurzgrößen (halved): 25 = 50 short, 26 = 52 short. Numbers up to 31
  // with a short marker are Kurzgrößen; larger ones are inch waists.
  m = s.match(/^(?:KURZ(?:GRÖSSE|GROESSE)?|K)\s*(\d{2})$/) || s.match(/^(\d{2})\s*(?:K|KURZ|KURZGRÖSSE|KURZGROESSE|SHORT FIT|UNTERSETZT)$/);
  if (m && Number(m[1]) <= 31) return ['25', '26'].includes(m[1]) ? 'near' : 'incompatible';
  // Waist with a cut letter: 34R/34 REGULAR/34S (inseam ok), 34L/34 LONG (too long).
  m = s.match(/^(?:W(?:AIST)?\s*)?(\d{2})\s*[-/]?\s*(R|REG|REGULAR|S|SHORT|K|KURZ|L|LONG|LANG|T|TALL)$/);
  if (m && Number(m[1]) >= 26 && Number(m[1]) <= 48) {
    if (![33, 34].includes(Number(m[1]))) return 'incompatible';
    return /^(?:L|LONG|LANG|T|TALL)$/.test(m[2]) ? 'incompatible' : 'target';
  }
  // Waist only, explicitly marked (W34, UK/US 34): waist fits, inseam unknown.
  m = s.match(/^(?:W(?:AIST)?|UK|US)\s*(\d{2})$/);
  if (m) return [33, 34].includes(Number(m[1])) ? 'near' : 'incompatible';
  // German Langgrößen (doubled): 98 = 50 long, 102 = 52 long – inseam too long.
  m = s.match(/^(?:(?:LANG(?:GRÖSSE|GROESSE)?|DE|EU)\s*)?(9[0-9]|1[01][0-9])(?:\s*(?:LANG|LANGGRÖSSE|LANGGROESSE))?$/);
  if (m && Number(m[1]) % 2 === 0 && Number(m[1]) >= 90 && Number(m[1]) <= 118) return 'incompatible';
  // French / Italian trouser sizes.
  m = s.match(/^(?:FR\s*(\d{2})|(\d{2})\s*FR)$/);
  if (m) return ['44'].includes(m[1] || m[2]) ? 'near' : 'incompatible';
  m = s.match(/^(?:IT\s*(\d{2})|(\d{2})\s*IT)$/);
  if (m) return ['50', '52'].includes(m[1] || m[2]) ? 'near' : 'incompatible';
  // German/EU Konfektion: 50 ~ W34, 52 ~ W35/36 (L).
  m = s.match(/^(?:(EU|DE|D|GER)\s*)?(\d{2})$/);
  if (m) {
    if (['50', '52'].includes(m[2])) return 'near';
    // A bare 33/34 is a waist in inches.
    if (!m[1] && ['33', '34'].includes(m[2])) return 'near';
    if (m[1] && Number(m[2]) >= 42 && Number(m[2]) <= 64) return 'incompatible';
  }
  return 'unknown';
}

export function sizeEvidence(sizes) {
  if (!Array.isArray(sizes) || !sizes.length) return 'unconfirmed';
  const results = sizes.map(normalizeSizeLabel).filter((_, i) => String(sizes[i] ?? '').trim());
  if (!results.length) return 'unconfirmed';
  if (results.includes('target')) return 'confirmed';
  if (results.includes('near')) return 'probable';
  // Fail closed only when every available size is explicitly incompatible.
  // Unknown/ambiguous systems remain reviewable instead of suppressing a good deal.
  if (results.every(r => r === 'incompatible')) return 'no';
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
  // "bis 50 %" holds for some variants only: such a badge counts when the
  // product page confirmed the profile size at that price, or a reference price exists.
  const upToUnchecked = x => /-upto$/.test(String(x.discountSource || '')) && x.rrpVerified !== true &&
    !['confirmed', 'probable'].includes(x.sizeFit);
  const qualifies = x => (x.rrpVerified === true || x.discountVerified === true) &&
    x.class !== 'Near Miss' && x.effectiveDiscountPct >= minDiscount && !upToUnchecked(x);
  for (const offer of best.values()) {
    const key = modelKey(offer), old = models.get(key);
    if (!old || Number(qualifies(offer)) > Number(qualifies(old)) ||
      (qualifies(offer) === qualifies(old) && (offer.score > old.score ||
        (offer.score === old.score && offer.effectiveCostEur < old.effectiveCostEur)))) models.set(key, offer);
  }
  const unique = [...models.values()].sort((a, b) => b.score - a.score);
  // Every qualified deal is published (sorted by score); the report is the
  // complete list of relevant recommendations, not a top-N teaser.
  const qualified = unique.filter(qualifies);
  const deals = qualified;
  const qualifiedKeys = new Set(qualified.map(offerKey));

  const near = unique.filter(o => o.effectiveDiscountPct >= 30 && !qualifiedKeys.has(offerKey(o)))
    .map(o => ({
      ...o,
      class: 'Near Miss',
      reason: upToUnchecked(o) ? 'Rabatt gilt laut Shop nur „bis“ – für deine Größe im Shop prüfen.'
        : o.rrpVerified !== true && o.discountVerified !== true ? 'Referenzpreis oder Händler-Rabattangabe nicht hinreichend belegt.'
        : o.effectiveDiscountPct < minDiscount
        ? 'Rabatt unter der Deal-Schwelle.'
        : 'Rabattbeleg oder Produktdaten im Shop prüfen.'
    }))
    .slice(0, 12);
  return { deals, near, qualifiedCount: qualified.length };
}
