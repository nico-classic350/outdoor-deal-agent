export const PROFILE = {
  brands: ["Arc'teryx","Odlo","Dynafit","Ortovox","La Sportiva","Mammut","Norrøna","Rab","Patagonia","Haglöfs","Black Diamond","Peak Performance","Houdini","Adidas Terrex","66°North","Goldwin","Tilak"],
  excludedBrands: ['The North Face'],
  waist: [33,34],
  inseamMax: 32,
  upperSize: 'L',
  colorsPreferred: ['navy','dark blue','blue','light blue','black','grey','gray'],
  colorsExcluded: ['white'],
  minEffectiveDiscountPct: 40,
  localRadiusKm: 10,
  fit: 'regular-relaxed',
  allowedProductTerms: ['trekking pant','hiking pant','outdoor pant','travel pant','walking trouser','trekkinghose','wanderhose','outdoorhose'],
  excludedProductTerms: ['rain pant','waterproof pant','hardshell pant','winter pant','ski pant','zip-off','convertible pant','bib','insulated pant'],
} as const;
