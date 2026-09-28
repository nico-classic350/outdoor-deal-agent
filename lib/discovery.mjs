// Rank sitemap product URLs before spending the limited direct-request budget.
// Keep unknown URLs as fallback: shops use many different URL conventions.
export function rankDiscoveryUrls(urls, brands, limit = 120) {
  const terms=brands.map(b=>b.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,''));
  const scored=[...new Set(urls)].map((url,index)=>{
    let path;
    try { path=decodeURIComponent(new URL(url).pathname).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,''); }
    catch { path=url.toLowerCase(); }
    const compact=path.replace(/[^a-z0-9]/g,'');
    const brand=terms.some(term=>term && compact.includes(term));
    const trousers=/(?:hosen?|pants?|trousers?|softshell|trekking|wander|stretch|pantalon|calzoni|spodnie|kalhoty)/.test(path);
    const unwanted=/(?:damen|women|womens|kinder|kids|shorts?|zip.off|winter|ski|regen|rain|waterproof|hardshell)/.test(path);
    const category=/(?:\/category\/|\/kategorie\/|\/outlet\/?$|\/sale\/?$|\/hosen\/?$)/.test(path);
    return {url,index,score:(brand?8:0)+(trousers?5:0)-(unwanted?16:0)-(category?3:0)};
  });
  return scored.sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,limit).map(x=>x.url);
}
