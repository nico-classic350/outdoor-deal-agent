// Shops crawled nightly by the GitHub Actions Chromium job. Selected from the
// 30 September 2026 production coverage: direct HTTP returned pages but no
// parseable products ("render"), or the shop answered 403/no response
// ("blocked"). Blocked shops are tried with a plain browser only; there is no
// proxy, CAPTCHA or fingerprint evasion, so many of them will stay blocked.
export const BROWSER_COHORT = {
  render: [
    'sportfits', 'outdoor-renner', 'camp4', 'trekking-koenig', 'breuninger', 'sportspar',
    'blue-tomato', 'hardloop', 'alpinstore', 'barrabes', 'varuste', 'hanibal',
    'rockpoint', 'snowcountry', 'asadventure', 'aboutyou-de', 'odlo-eu', 'rab-eu', 'norrona-eu', 'haglofs-eu',
    'tilak-eu', 'biwak', 'feinbier', 'biwakschachtel', 'carl-denig',
    'glisshop', 'outnorth',
    // Premium brand stores added with the September 2026 brand review.
    // (fjallraven-eu is Cloudflare-protected; surveyed on 30 September 2026.)
    'lundhags-eu', 'bergans-eu', 'klattermusen-eu',
    // Shops whose direct crawl found no relevant products (whole-pipeline run,
    // 30 September 2026) but whose listings render with euro prices.
    'tapir', 'sportano', 'bottero', 'bever', 'verticalextreme',
    // Direct pages list products without reference prices; their sale/outlet
    // pages show struck-through prices (registry diagnosis, 30 September 2026).
    'engelhorn', 'sportokay', 'sport-conrad', 'gigasport',
    // RSS feeds, no browser: the nightly run stores a snapshot in case Vercel's
    // address is refused by mydealz.
    'mydealz',
  ],
  blocked: [
    'sport-bittl', 'unterwegs', 'doorout', 'decathlon-de', 'sportdeal24', 'hervis', 'snowleader',
    'ekosport', 'vieux-campeur', '8a', 'e-horyzont', 'sportler', 'oliunid', 'nencini', 'galeria',
    'ortovox-eu', 'lasportiva-eu', 'fjallraven-eu',
    // SportScheck rendered 60+ products but no men's premium trousers on any
    // night from 3 to 7 October 2026 while using the full 180 s budget; it stays
    // in the direct crawl.
    // Removed from the nightly render cohort after the 3 October 2026 diagnosis:
    // 403/CloudFront (privatesportshop, peakperformance-eu), HTTP/2 error
    // (vrijbuiter), navigation timeout (zalando-de), checkout queue page
    // (patagonia-eu), members-only (bestsecret), US-dollar prices (snowinn).
    'privatesportshop', 'peakperformance-eu', 'vrijbuiter', 'zalando-de', 'patagonia-eu', 'bestsecret', 'snowinn',
  ],
  // Small fixed cohort for A/B measurements (direct-only vs. direct + Chromium).
  pilot: ['patagonia-eu', 'rab-eu', 'norrona-eu', 'haglofs-eu', 'odlo-eu', 'lundhags-eu', 'klattermusen-eu', 'outdoor-renner'],
} as const;

export function browserCohort(selection = 'all'): string[] {
  if (selection === 'pilot') return [...BROWSER_COHORT.pilot];
  if (selection === 'render') return [...BROWSER_COHORT.render];
  if (selection === 'blocked') return [...BROWSER_COHORT.blocked];
  // The nightly run skips the blocked group: the 30 September 2026 survey showed
  // every one of them behind Cloudflare/Akamai bot protection for a datacenter
  // browser (403 "Nur einen Moment…"), and the crawler does not evade that.
  if (selection === 'all' || !selection) return [...BROWSER_COHORT.render];
  if (selection === 'everything') return [...BROWSER_COHORT.render, ...BROWSER_COHORT.blocked];
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
  // From the all-shop survey (diagnose run, 30 September 2026): outlet/sale
  // pages with struck-through prices first, then men's trousers listings.
  'sportfits': ['https://sportfits.de/sale?p=1&minDiscount=50&o=15', 'https://sportfits.de/urban-fashion-herren-hosen'],
  'camp4': ['https://www.camp4.de/outlet/', 'https://www.camp4.de/outdoor-hosen/?p=1&o=1&n=48&f=2'],
  'snowcountry': ['https://www.snowcountry.eu/outlet/outlet-heren.html'],
  'feinbier': ['https://www.feinbier-unterwegs.de/outlet/', 'https://www.feinbier-unterwegs.de/herren/bekleidung/hosen/'],
  'asadventure': ['https://www.asadventure.com/nl/c/outlet/heren.html'],
  'lundhags-eu': ['https://lundhags.com/eu/category/outlet', 'https://lundhags.com/eu/category/clothing/men/pants'],
  'klattermusen-eu': ['https://www.klattermusen.com/de-de/men/pants/'],
  'engelhorn': ['https://www.engelhorn.de/de-de/herren/sale/'],
  'sportokay': ['https://www.sportokay.com/de_de/alle/deals.html'],
  'sport-conrad': ['https://www.sport-conrad.com/outlet/', 'https://www.sport-conrad.com/outdoorbekleidung/outdoor-hosen/herren/'],
  'gigasport': ['https://www.gigasport.at/shop-sale/sale-1/'],
  'barrabes': ['https://www.barrabes.com/outlet', 'https://www.barrabes.com/pantalones-trekking-hombre/c-18'],
  'biwak': ['https://www.biwak.com/Sale/', 'https://www.biwak.com/Herren/Bekleidung/Hosen/Lange-Hosen/'],
  'varuste': ['https://varuste.net/c3455/outlet-tuotteet'],
  'trekking-koenig': ['https://www.trekking-koenig.de/bekleidung/hosen/'],
  'carl-denig': ['https://www.carldenig.nl/507-casual-pants'],
  'tapir': ['https://www.tapir-store.de/sale/maenner/', 'https://www.tapir-store.de/wanderhosen-trekkinghosen/maenner/'],
  'sportscheck': ['https://www.sportscheck.com/wandern/sale/', 'https://www.sportscheck.com/hosen/herren/'],
  'sportano': ['https://sportano.com/sale-zone', 'https://sportano.com/hiking-and-trekking-clothing/hiking-trousers'],
  'bottero': ['https://www.botteroski.com/it/651-offerte-outlet', 'https://www.botteroski.com/it/522-montagna/32-abbigliamento-montagna/35-Pantaloni-outdoor-uomo'],
  'bever': ['https://www.bever.nl/c/sale/sale-heren.html', 'https://www.bever.nl/c/sale/sale-wandelen.html'],
  'verticalextreme': ['https://www.verticalextreme.de/outlet-klettern-outdoor/kletterhosen-kletterbekleidung', 'https://www.verticalextreme.de/kletterbekleidung/funktionshosen-trekking-wandern-bergsteigen'],
  // Outlet hiking clothing first (struck-through prices), then men's trousers.
  'hardloop': ['https://www.hardloop.de/outlet/7896-ausrustung-wanderkleidung-guenstig-sale', 'https://www.hardloop.de/shop/472-outdoor-hosen-herren'],
  // Session-free URLs: links carrying force_sid answer 403.
  'biwakschachtel': ['https://www.biwakschachtel-tuebingen.de/bekleidung/maenner/hosen/', 'https://www.biwakschachtel-tuebingen.de/sale/'],
  'bergans-eu': ['https://www.bergans.com/en/outlet/men', 'https://www.bergans.com/en/men/pants'],
  'outnorth': ['https://www.outnorth.com/de/outlet', 'https://www.outnorth.com/de/herren/bekleidung/hosen'],
  'outdoor-renner': ['https://www.outdoor-renner.de/sale/', 'https://www.outdoor-renner.de/outdoorhosen-herren-kurzgroessen', 'https://www.outdoor-renner.de/wanderhosen-herren-uebergroesse/'],
};

// Card rules for shops whose product cards the generic selectors miss
// ("Variante A": written once from the diagnose run's card markup, then applied
// without any runtime model or tokens). `reference` names the element that
// holds the crossed-out original price.
export type BrowserCardRule = { card: string; name?: string; brand?: string; price?: string; reference?: string };
export const BROWSER_CARD_RULES: Record<string, BrowserCardRule> = {
  'barrabes': { card: '.card--product', name: '.card-product-name', price: '.price.is__discount, .card-product-price .price', reference: '.price.is__old' },
  'biwak': { card: 'li.productData', name: '.productsTitle', brand: '.manufacturer', reference: '.old' },
  'varuste': { card: '.grid a.item', name: '.item_name', brand: '.product_listing_brand_name' },
  'trekking-koenig': { card: '.product-box', name: '.product-name', price: '.product-price' },
};

export function browserStartUrls(shopId: string): string[] {
  return BROWSER_START_URLS[shopId] ? [...BROWSER_START_URLS[shopId]] : [];
}
