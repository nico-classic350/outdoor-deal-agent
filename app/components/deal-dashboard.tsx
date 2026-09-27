'use client';

import { useEffect, useState } from 'react';
import type { NormalizedOffer, RunReport } from '../../lib/types';

type History=Record<string,{date:string,price:number}[]>;
type Props={deals:NormalizedOffer[];near:NormalizedOffer[];report:RunReport|null;history:History};
const diagnosis:Record<string,string>={blocked:'Zugriff blockiert', 'parser-empty':'Keine Produkte extrahiert',
  'no-relevant-products':'Keine passenden langen Hosen', 'no-reference-price':'Referenzpreis fehlt',
  'size-unverified':'Größe nicht kaufbar bestätigt', 'no-qualified-deal':'Kein Deal über der Schwelle'};
function key(o:NormalizedOffer){
  try{const u=new URL(o.url);u.hash='';for(const p of [...u.searchParams.keys()])
    if(/^(?:utm_.*|gclid|fbclid|ref|source|campaign)$/i.test(p))u.searchParams.delete(p);
    return `${o.sourceId}|${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/,'')||'/'}${u.search}`}
  catch{return `${o.sourceId}|${o.brand}|${o.name}|${o.color||''}`.toLowerCase()}
}
function euro(v:number){return new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(v)}
function date(v:string){return new Intl.DateTimeFormat('de-DE',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Berlin'}).format(new Date(v))}

function DealCard({offer,history,saved,toggle}:{offer:NormalizedOffer;history:History;saved:boolean;toggle:()=>void}){
  const points=history[key(offer)]||[];
  const earlier=points.length>1?points[0].price:null;
  const secure=(offer.rrpVerified||offer.discountVerified)&&offer.shippingKnown&&offer.sizeFit==='confirmed';
  return <article className="deal-card">
    <div className="card-header"><div className="eyebrow">{offer.brand} · {offer.merchant}</div>
      <button className="save" type="button" onClick={toggle} aria-label={saved?'Aus Merkliste entfernen':'Auf Merkliste setzen'} aria-pressed={saved}>{saved?'★':'☆'}</button></div>
    <h3>{offer.name}</h3><p className="subline">{offer.color||'Farbe nicht angegeben'} · {offer.merchantCountry}</p>
    <div className="price-row"><strong>{euro(offer.effectiveCostEur)}</strong><span className="discount">−{Math.round(offer.effectiveDiscountPct)} %</span></div>
    <p className="subline">{offer.shippingKnown?'Gesamtpreis inklusive bekannter Versandkosten':'Versandkosten noch ungeklärt'} · Referenzpreis {offer.rrpEur==null?'nicht angegeben':euro(offer.rrpEur)}</p>
    <div className="badges"><span className={secure?'badge good':'badge warn'}>{offer.sizeFit==='confirmed'?'Größe kaufbar bestätigt':'Größe prüfen'}</span>
      <span className={offer.rrpVerified||offer.discountVerified?'badge good':'badge warn'}>{offer.rrpVerified?'Referenzpreis belegt':offer.discountVerified?'Händler-Rabattangabe belegt':'UVP prüfen'}</span></div>
    {offer.reason?<p className="reason">{offer.reason}</p>:null}
    {earlier!==null?<p className="history">Preisverlauf: {euro(earlier)} → {euro(points[points.length-1].price)} in {points.length} Beobachtungen</p>:null}
    <details className="evidence"><summary>Wie wurde das Angebot geprüft?</summary><dl>
      <dt>Referenzpreis</dt><dd>{offer.rrpVerified&&offer.rrpEur!=null?`${euro(offer.rrpEur)} · ${offer.rrpSource||'Händlerangabe'}`:offer.discountVerified?`${Math.round(offer.observedDiscountPct||0)} % Händler-Rabatt · ${offer.discountSource}`:'Nicht belegt'}</dd>
      <dt>Versand</dt><dd>{offer.shippingKnown?euro(offer.shippingEur):'Nicht geklärt'}</dd>
      <dt>Größe</dt><dd>{offer.sizeFit==='confirmed'?`Kaufbar: ${(offer.sizes||[]).join(', ')||'Passende Variante'}`:'Nicht bestätigt'}</dd>
      <dt>Quelle</dt><dd>{offer.merchant}</dd>
    </dl></details>
    <div className="card-footer"><span>{offer.class}</span><a href={offer.url} target="_blank" rel="noopener noreferrer">Zum Shop ↗</a></div>
  </article>;
}

export function DealDashboard({deals,near,report,history}:Props){
  const [tab,setTab]=useState<'deals'|'near'|'saved'>('deals');
  const [saved,setSaved]=useState<string[]>([]);
  useEffect(()=>{try{const stored=JSON.parse(localStorage.getItem('outdoor-deal-watch-saved')||'[]');if(Array.isArray(stored))setSaved(stored.filter(x=>typeof x==='string'))}catch{}},[]);
  function toggle(o:NormalizedOffer){setSaved(current=>{const id=key(o);const next=current.includes(id)?current.filter(x=>x!==id):[...current,id];
    localStorage.setItem('outdoor-deal-watch-saved',JSON.stringify(next));return next})}
  const list=tab==='deals'?deals:tab==='near'?near:[...deals,...near].filter(o=>saved.includes(key(o)));
  const coverage=report?.coverage||[];
  return <main className="shell">
    <header className="hero"><div className="hero-top"><span className="brand-mark">OD<span>·</span>W</span><span className="hero-label">PERSÖNLICHE ANGEBOTSSUCHE</span></div>
      <div className="hero-grid"><div><p className="overline">LEICHTE TREKKINGHOSEN · W33–34 / MAX. L32</p>
        <h1>Weniger Treffer.<br/><em>Mehr Gewissheit.</em></h1>
        <p className="lead">Angebote mit nachvollziehbarem Preis, passender Größe und sichtbarer Quellenlage.</p></div>
        <div className="hero-stat"><strong>{deals.length.toString().padStart(2,'0')}</strong><span>bestätigte Deals</span><small>{report?`Letzter Lauf ${date(report.finishedAt)}`:'Noch kein abgeschlossener Suchlauf'}</small></div></div>
    </header>
    <section className="summary" aria-label="Suchstatus"><div><span>QUELLEN</span><strong>{report?`${report.attemptedSources} / ${report.plannedSources}`:'—'}</strong></div>
      <div><span>PRODUKTE</span><strong>{report?.normalizedOffers??'—'}</strong></div>
      <div><span>PRÜFKANDIDATEN</span><strong>{near.length}</strong></div>
      <div><span>STATUS</span><strong>{report?.attemptedSources===report?.plannedSources?'Vollständig':'Ausstehend'}</strong></div></section>
    <section className="results"><div className="section-heading"><div><p className="overline dark">DEINE AUSWAHL</p><h2>Fundstücke</h2></div>
      <p>Nur Neuware und passende lange Hosen. Einige unklare Preis- oder Größenangaben bleiben als Prüfkandidaten sichtbar.</p></div>
      <nav className="tabs" aria-label="Ergebnisse"><button aria-current={tab==='deals'?'page':undefined} onClick={()=>setTab('deals')}>Bestätigte Deals <span>{deals.length}</span></button>
        <button aria-current={tab==='near'?'page':undefined} onClick={()=>setTab('near')}>Prüfkandidaten <span>{near.length}</span></button>
        <button aria-current={tab==='saved'?'page':undefined} onClick={()=>setTab('saved')}>Merkliste <span>{saved.length}</span></button></nav>
      {list.length?<div className="card-grid">{list.map(o=><DealCard key={key(o)} offer={o} history={history} saved={saved.includes(key(o))} toggle={()=>toggle(o)}/>)}</div>
        :<div className="empty"><strong>{tab==='deals'?'Heute kein bestätigter Deal.':tab==='near'?'Keine Prüfkandidaten.':'Noch nichts gemerkt.'}</strong>
          <p>{tab==='deals'?'Die Prüfung verlangt eine kaufbare Größe, belegten Referenzpreis und geklärte Versandkosten.':'Neue Ergebnisse erscheinen nach dem nächsten vollständigen Suchlauf.'}</p></div>}
    </section>
    <section className="sources"><div className="section-heading"><div><p className="overline dark">TRANSPARENZ</p><h2>Quellenstatus</h2></div>
      <p>Produktkarten allein gelten nicht als bestätigte Deals.</p></div>
      {coverage.length?<div className="source-list">{coverage.map(c=><div className="source-row" key={c.sourceId}><strong>{c.name}</strong>
        <span className={`status ${c.status}`}>{c.status}</span><span>{c.parsedOffers} entdeckt</span>
        <span title={c.diagnosticCode?diagnosis[c.diagnosticCode]:undefined}>{c.diagnosticCode?diagnosis[c.diagnosticCode]:`${c.qualifiedOffers??0} Deals`}</span>
        <span>{c.qualifiedOffers??0} Deals</span></div>)}</div>
        :<div className="empty">Noch kein vollständiger Lauf vorhanden.</div>}
    </section><footer>Outdoor Deal Watch · Belege vor Rabatten · Angebote im Shop erneut prüfen</footer>
  </main>;
}
