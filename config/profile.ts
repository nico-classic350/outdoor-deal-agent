export const PROFILE = {
  // Premium only: brands with a proven record for technical fabrics and build
  // quality in trekking/hiking trousers. Reviewed 30 September 2026; house and
  // mass-market labels (Stoic, Adidas Terrex) and hardware-first brands
  // (Black Diamond) were removed.
  brands: ["Arc'teryx","Norrøna","Haglöfs","Fjällräven","Klättermusen","Bergans","Lundhags","Mammut","Ortovox","Dynafit","La Sportiva","Patagonia","Rab","Mountain Equipment","Montura","Houdini","Peak Performance","66°North","Goldwin","Tilak","Odlo"],
  excludedBrands: ['The North Face','Stoic','Adidas Terrex'],
  waist: [33,34],
  inseamMax: 32,
  upperSize: 'L',
  colorsPreferred: ['navy','dark blue','blue','light blue','black','grey','gray'],
  colorsExcluded: ['white'],
  minEffectiveDiscountPct: 40,
  localRadiusKm: 10,
  fit: 'regular-relaxed',
  allowedProductTerms: ['trekking pant','hiking pant','outdoor pant','travel pant','walking trouser','trekkinghose','wanderhose','outdoorhose','softshellhose','stretchhose','funktionshose','reisehose'],
  excludedProductTerms: ['rain pant','waterproof pant','hardshell pant','winter pant','ski pant','zip-off','convertible pant','bib','insulated pant'],
} as const;
