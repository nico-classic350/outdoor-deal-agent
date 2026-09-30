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
