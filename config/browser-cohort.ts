// Shops crawled nightly by the GitHub Actions Chromium job. Selected from the
// 30 September 2026 production coverage: direct HTTP returned pages but no
// parseable products ("render"), or the shop answered 403/no response
// ("blocked"). Blocked shops are tried with a plain browser only; there is no
// proxy, CAPTCHA or fingerprint evasion, so many of them will stay blocked.
export const BROWSER_COHORT = {
  render: [
    'sportfits', 'outdoor-renner', 'camp4', 'trekking-koenig', 'sport65', 'breuninger', 'sportspar',
    'blue-tomato', 'hardloop', 'alpinstore', 'trekkinn', 'snowinn', 'barrabes', 'varuste', 'hanibal',
    'rockpoint', 'privatesportshop', 'snowcountry', 'asadventure', 'vrijbuiter', 'zalando-de',
    'aboutyou-de', 'bestsecret', 'odlo-eu', 'patagonia-eu', 'rab-eu', 'norrona-eu', 'haglofs-eu',
    'peakperformance-eu', 'goldwin-eu', 'tilak-eu', 'biwak', 'feinbier', 'biwakschachtel', 'carl-denig',
    'glisshop', 'outnorth',
  ],
  blocked: [
    'sport-bittl', 'unterwegs', 'doorout', 'decathlon-de', 'sportdeal24', 'hervis', 'snowleader',
    'ekosport', 'vieux-campeur', '8a', 'e-horyzont', 'sportler', 'oliunid', 'nencini', 'galeria',
    'ortovox-eu', 'lasportiva-eu', 'adidas-terrex-de',
  ],
  // Small fixed cohort for A/B measurements (direct-only vs. direct + Chromium).
  pilot: ['patagonia-eu', 'rab-eu', 'norrona-eu', 'haglofs-eu', 'odlo-eu', 'peakperformance-eu', 'trekkinn', 'outdoor-renner'],
} as const;

export function browserCohort(selection = 'all'): string[] {
  if (selection === 'pilot') return [...BROWSER_COHORT.pilot];
  if (selection === 'render') return [...BROWSER_COHORT.render];
  if (selection === 'blocked') return [...BROWSER_COHORT.blocked];
  if (selection === 'all' || !selection) return [...BROWSER_COHORT.render, ...BROWSER_COHORT.blocked];
  return selection.split(',').map(id => id.trim()).filter(Boolean);
}

// Listing pages Chromium opens first. Many brand shops expose no usable
// sitemap, so without these the crawler rendered only the start page (no
// product list). EU/German locales are spelled out because the GitHub runner
// sits in the US and bare domains geo-redirect to US/UK stores. Verified with
// the diagnose mode of browser-crawl.yml on 30 September 2026.
export const BROWSER_START_URLS: Record<string, string[]> = {
  // Outlet first: struck-through prices there are the reference-price evidence.
  'odlo-eu': ['https://www.odlo.com/de-de/c/outlet/herren/hosen-tights', 'https://www.odlo.com/de-de/c/herren/kleidung/hosen-tights'],
  'rab-eu': ['https://rab.equipment/eu/mens/pants'],
  'norrona-eu': ['https://www.norrona.com/de-DE/o/herren/hosen/', 'https://www.norrona.com/de-DE/produkte/herren/hosen/'],
  // /de is the euro store; /en serves GBP to the US runner.
  'haglofs-eu': ['https://www.haglofs.com/de/herren/hosen-herren/hosen-lange-hosen-herren'],
  // Sale first, then Kurzgrößen (inseam fits the profile better than Übergrößen).
  'outdoor-renner': ['https://www.outdoor-renner.de/sale/', 'https://www.outdoor-renner.de/outdoorhosen-herren-kurzgroessen', 'https://www.outdoor-renner.de/wanderhosen-herren-uebergroesse/'],
};

export function browserStartUrls(shopId: string): string[] {
  return BROWSER_START_URLS[shopId] ? [...BROWSER_START_URLS[shopId]] : [];
}
