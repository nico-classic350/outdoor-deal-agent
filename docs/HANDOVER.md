# Outdoor Deal Agent — Übergabe (30. September 2026)

## Was produktiv ist

- Code: [GitHub `nico-classic350/outdoor-deal-agent`](https://github.com/nico-classic350/outdoor-deal-agent), Branch `main`.
- App: [outdoor-deal-agent.vercel.app](https://outdoor-deal-agent.vercel.app), Vercel-Projekt `outdoor-deal-agent`.
- Daten: Neon PostgreSQL; Zugang ausschließlich als `DATABASE_URL` in Vercel Production. Kein Datenbankdump und keine Zugangsdaten im Repository.
- Laufzeit: Node 24, Next.js 16, pnpm 10.15.1. GitHub Actions `CI & Change Observability` prüft PRs; nur `main` deployt automatisch auf Vercel.
- Persönliche Auswahl: lange Herren-Trekking-/Outdoor-/Softshellhosen erlaubter Marken, Rabatt mindestens 40 % mit nachprüfbarer Händler-Preisbasis. Fehlende Größe, Versand- und Retourenangaben erscheinen als Prüfhinweise. Explizit falsche Größe, ausverkaufte Artikel und ausgeschlossene Kategorien werden verworfen. Ein Produktmodell belegt nur einen Deal-Platz.

## Datenfluss und Verantwortlichkeiten

| Schritt | Code/Ort | Ergebnis |
| --- | --- | --- |
| Shopregister und Suchprofil | `config/shops.ts`, `config/profile.ts` | 93 Quellen (92 EU-Shops + mydealz), Premium-Markenliste und Auswahlprofil |
| Erfassung | `lib/crawl.ts`, `lib/targeted.ts`, `lib/feed.ts`, `lib/globetrotter-feed.ts` | Direkte Listings, offizielle zugängliche Feeds, Sitemaps, HTML/JSON-LD |
| Browser-Erfassung | `.github/workflows/browser-crawl.yml`, `scripts/actions-browser-crawl.mjs`, `lib/local-browser.ts`, `lib/browser-snapshots.ts`, `config/browser-cohort.ts` | Täglich 16:20 und 19:20 UTC (GitHub startet bis ~5 h verspätet; der spätere Lauf überschreibt die Snapshots desselben Tages) Playwright + Chromium auf GitHub-Runner (Open Source, kostenlos für öffentliche Repos); Snapshots in `agent_browser_snapshots`, von den Batches gemergt |
| Browser-Fallback (optional) | `lib/browser.ts`, `lib/browser-config.mjs`, `lib/browser-budget.ts` | Browserless nur noch opt-in (`BROWSERLESS_DAILY_SESSION_LIMIT` Standard 0) |
| Normalisierung und Auswahl | `lib/normalize.ts`, `lib/product-rules.mjs`, `lib/publication-safety.mjs` | Preisbeleg, Marke/Kategorie, Größenstatus, modellübergreifende Dublettenprüfung |
| Speicherung | `lib/batch-run.ts`, `lib/store.ts` | `agent_batch_runs`, `agent_runs` in Neon |
| E-Mail | `lib/notify.ts`, `lib/gmail-smtp.mjs`, `lib/email-template.ts` | Genau ein Anbieterpfad: Gmail bei gesetztem `GMAIL_SMTP_USER`, sonst Resend; Bilder, Deals, Zusammenfassung und alle Shops |
| Web/API | `app/page.tsx`, `app/api/health`, `app/api/coverage`, `app/api/probe`, `app/api/batch-status` | Anzeige, Betriebszustand, Roh-/Nutzdaten und schreibfreie Neuberechnung |

Awin ist **kein nutzbarer Datenpfad**: Die Händler haben den Publisher nicht zugelassen. Adapter, Awin-Statusroute und Setup-Anleitung wurden entfernt. Die Vercel-Variable `AWIN_DATAFEED_API_KEY` wird vom Code nicht mehr gelesen; ein eventuell noch gespeicherter Wert kann im Vercel-Dashboard entfernt werden. Historische JSON-Coverage kann weiterhin `awin-check` enthalten.

## Zeitkette und E-Mail

Alle Cron-Zeiten in `vercel.json` sind **UTC**. In Deutschland im Sommer UTC+2, im Winter UTC+1. Auf Vercel Hobby können Jobs innerhalb ihrer geplanten Stunde verzögert starten.

| UTC-Zeit | Zweck |
| --- | --- |
| 16:20 und 19:20 (Vortag, GitHub startet oft bis ~5 h später) | GitHub Actions: alle 93 Quellen – Browser-Kohorte mit Chromium, übrige Shops direkt mit Prüfung aller Premium-Hosen-Produktseiten; speichert Snapshots (bei Nicht-Browser-Shops nur Premium-Hosen) |
| 00:00–03:00 | 16 Batch-Crons à maximal sechs Shops |
| 04:00–04:15 | 16 Einzel-Retries für fehlende Batches |
| 05:00 | Finalisierung und E-Mail – nur ab 07:00 deutscher Zeit (Sommerzeit); im Winter wartet sie |
| 06:00 | Finalisierung erneut versuchen; im Winter kommt die E-Mail hier (07:00 deutscher Zeit) |
| 07:15; 10:00, 14:00, 20:00, 23:00 | Watchdog bzw. Recovery, auch für verspätete Läufe und E-Mail-Retries |

Ein Lauf ist erst erfolgreich, wenn der vollständige Bericht gespeichert **und** die E-Mail vom Provider angenommen und ihre Message-ID in `agent_notification_snapshots` gespeichert wurde. Finalizer-Retries derselben Batch-Snapshot-ID senden keine zweite Nachricht. Ein erneuter Batch mit neuer Snapshot-ID kann eine ausdrücklich als „aktualisiert“ bezeichnete zweite Tagesmail auslösen; das ist eine getrennte korrigierte Ausgabe. Gmail SMTP kann nach einem Absturz unmittelbar nach Annahme, aber vor DB-Bestätigung in seltenen Fällen doppelt senden; Resend besitzt zusätzlich ein 24-Stunden-Idempotency-Fenster. Provider-Annahme garantiert noch keine Posteingangszustellung.

**Altlast bereinigt:** Zwei aktive ChatGPT-Automationen („Outdoor Deal Alert 08:55“ und „Outdoor Deal Alert Watchdog“ um 08:59 Europe/Berlin) hatten denselben Bericht unabhängig über Gmail versandt. Beide wurden am 30. September pausiert. Die Vercel-App ist nun der einzige aktive E-Mail-Absender für diesen Bericht; die Vercel-Recovery-Crons bleiben zur Ausfallsicherung aktiv. Alte, bereits deaktivierte Probe- und Check-Automationen müssen nicht gestartet werden.

## Konfiguration ohne Geheimwerte

Die Schlüsselnamen stehen in `.env.example`. Produktionswerte liegen ausschließlich in **Vercel → Project → Settings → Environment Variables → Production**. Änderungen an Production-Variablen erfordern ein neues Deployment, bevor Funktionen die neuen Werte verwenden.

| Variablen | Zweck |
| --- | --- |
| `DATABASE_URL`, `CRON_SECRET` | Persistenz und Authentifizierung sämtlicher Cron-Routen |
| `DEAL_NOTIFY_TO`, `GMAIL_SMTP_USER`, `GMAIL_SMTP_APP_PASSWORD` | Aktiver Gmail-Versand an die bestätigte Zieladresse (identisch mit Absender) |
| `RESEND_API_KEY`, `DEAL_NOTIFY_FROM` | Alternative nur ohne `GMAIL_SMTP_USER`, mit verifizierter Domain |
| `BROWSERLESS_API_TOKEN` oder `BROWSERLESS_TOKEN`, `BROWSERLESS_BASE_URL` | Browserless Cloud; Amsterdam-Default `https://production-ams.browserless.io` |
| `BROWSERLESS_DAILY_SESSION_LIMIT` | Standard 0 (kein Browserless); ein positiver Wert erlaubt so viele Provider-Sitzungsversuche je UTC-Tag über alle Batches; kein exakter Browserless-Unitzähler |
| `OPENAI_API_KEY`, `LLM_EXTRACTION_MODE`, `LLM_EXTRACTION_SHOPS`, `LLM_EXTRACTION_MODEL` | Optionaler LLM-Pilot, zurzeit `shadow`; dieser publiziert keine zusätzlichen Angebote |

`playwright-core` nutzt `connectOverCDP()` am WebSocket-Root `wss://production-ams.browserless.io?token=…`. Der Pfad `/chromium/playwright` gehört zur anderen Playwright-`connect()`-Methode. Das Browserless-Token niemals in Logs, PRs oder Dokumente kopieren. Ein vorhandener Cloud-Token hat Vorrang vor der veralteten `BROWSERLESS_CONTENT_URL`.

## Tagesstatus vom 30. September 2026

- Geprüfter Produktions-Commit nach der Bereinigung: `5497c0874f0840770a9871d4a8e2b8cd6cff02f2` (PR #47). `/api/health` antwortete HTTP 200 mit genau diesem SHA; die entfernte `/api/awin-health`-Route antwortete 404 und `/api/probe` funktionierte.
- 16/16 Batches; letzter finalisierter Bericht um 04:52 UTC; App-Status `pipelineStatus=complete`, `emailDeliveryStatus=sent`.
- 1.671 Rohangebote, 138 normalisierte Angebote, fünf veröffentlichte Deals aus 91 Shops.
- Browserless: 73 Shops versuchten den Fallback, **0** wurden darüber wiedergewonnen, 72 meldeten `browser-provider-auth-rejected`. Reale `/content`- und `/unblock`-Anfragen erhielten HTTP 401. `browserFallbackConfigured=true` hieß bislang lediglich, dass ein Tokenwert vorhanden war. Der neue Health-Status macht die Auth-Ablehnung sichtbar.
- Vercel Runtime Logs konnten wegen `ExceedsBillingLimitError` nur eingeschränkt eingesehen werden; die obigen Browserless-Zahlen stammen aus den gespeicherten Batch-Coverage-Daten von `/api/batch-status`. Nach dem Deployment meldete `/api/health` ausdrücklich `browserProviderStatus=auth-rejected`, 72 betroffene Shops und null wiedergewonnene Shops.

**Befund Claude-Übernahme (30. September, Nachmittag):** Die gespeicherte Coverage zeigt ausschließlich HTTP 401 – sowohl `/content` als auch `/unblock`, in jeder Batch-Invocation beim ersten echten Aufruf; alle übrigen Shops wurden korrekt über den Auth-Circuit übersprungen (kein Budget-, 429- oder Playwright-Fehler). Beide REST-Endpunkte übergeben den Token wie von Browserless dokumentiert als `?token=`. Das spricht für eine Ablehnung auf Kontoebene, nicht für einen Endpunkt- oder Regionsfehler. Laut Nutzer ist das Browserless-Freikontingent (1.000 Units/Monat, 1 Unit ≤ 30 s Browserzeit) erschöpft; Free-Pläne weisen danach alle Anfragen ab. Das erklärt die 401 auch bei gültigem Token. Weitere mögliche Ursachen: gewechselter/widerrufener Key oder mitkopierte Leer-/Anführungszeichen. Bis zu einer Entscheidung über den Browser-Pfad `BROWSERLESS_DAILY_SESSION_LIMIT=0` in Vercel Production setzen. Seit PR „Browserless credential check“ wird der Token vor Verwendung von Leerraum und umschließenden Anführungszeichen bereinigt; `/api/health` zeigt `browserTokenIssue` (nur die Art des Problems, nie den Wert). `/api/browser-check` rendert einmalig `example.com` über `/content` – höchstens ein Provider-Aufruf je Token und UTC-Tag, maximal drei pro Tag, zusätzlich aus dem gemeinsamen Session-Budget; weitere Aufrufe liefern das gespeicherte Ergebnis. Erfolg ist ausschließlich `outcome=accepted` mit HTTP 200 und gerendertem Dokument; danach meldet Health `browserProviderStatus=check-accepted`, bis ein Batch tatsächlich Produkte über Browserless gewinnt (`recovered-products`).

**Umstellung ohne Browserless (PR „Chromium browser crawl“):** Rendering läuft nun in GitHub Actions mit `playwright-core` und lokal installiertem Chromium. Einmalig erforderlich: (1) GitHub → Settings → Secrets and variables → Actions → Secret `BROWSER_SNAPSHOT_DATABASE_URL` anlegen (Neon-Verbindung, idealerweise eigene Rolle nur für `agent_browser_snapshots`). (2) In Vercel Production `BROWSERLESS_DAILY_SESSION_LIMIT` entfernen oder auf `0` setzen; `BROWSERLESS_API_TOKEN` kann gelöscht werden. (3) Den Workflow manuell mit `shops=pilot`, `compare=true` starten und das A/B-Ergebnis prüfen, bevor man sich auf den nächtlichen Lauf verlässt. Geplante GitHub-Workflows können sich verspäten und werden nach 60 Tagen ohne Repository-Aktivität deaktiviert; die Batches laufen dann ohne Browserdaten weiter.

**Erledigt (30. September):** Browserless ist abgeschaltet; `BROWSERLESS_API_TOKEN` wurde in Vercel Production gelöscht und neu deployt. Das Rendering läuft nächtlich in GitHub Actions (Chromium). Der Browserless-Code bleibt als optionaler Pfad bestehen (`BROWSERLESS_DAILY_SESSION_LIMIT` Standard 0); `/api/browser-check` meldet ohne Token nur „nicht konfiguriert“.

**Markenliste (30. September):** Nur Premium-Marken mit nachweislich hochwertigen Materialien. Entfernt: Stoic (Bergfreunde-Eigenmarke, gemischte Bewertungen zur Materialhaltbarkeit), Adidas Terrex (Massenmarkt), Black Diamond (Schwerpunkt Hartware). Neu: Fjällräven, Klättermusen, Bergans, Lundhags, Mountain Equipment, Montura. Der Black-Diamond- und der Adidas-Terrex-Shop wurden im Register durch Fjällräven und Lundhags ersetzt; Bergans und Klättermusen kamen hinzu. Trekkinn (Dollarpreise für den US-Runner) und der geschlossene Montura-Shop wurden entfernt; die Marke Montura bleibt für Händlerangebote (92 Shops, weiterhin 16 Batches).

**Deal-Ausbeute (30. September, abends):** Bericht und E-Mail listen jetzt **alle** qualifizierten Deals (nach Score sortiert, kompakte Zeilen gegen Gmail-Kürzung), nicht mehr nur die Top 5. Neue Belegquellen: Shopify-`compare_at_price` (DF Sport, SportIT direkt auf Vercel, ohne Browser), ausdrücklich beschriftete Referenzpreise (UVP, statt, Listino, RRP) und optisch durchgestrichene Preise; ein unbeschrifteter höherer Preis zählt nie. Für mögliche Deals öffnet der Actions-Lauf die Produktseite und liest nur wählbare Größen (max. 6 je Shop). Neu im Chromium-Lauf: Tapir, SportScheck, Sportano, Bottero, Bever, VerticalExtreme. Publisher-/Affiliate-Anmeldungen werden vorerst nicht verfolgt.

**Weitere Shop-Schnittstellen (30. September, spät):** Sport Förg läuft über Shopify-JSON (118 relevante Hosen, 59 mit Referenzpreis), Snowcountry und Maxisport über die öffentliche Magento-Schnittstelle (`config/commerce-sources.ts`; Maxisport antwortet dem US-Runner mit 503). Findet ein Shop relevante Produkte ohne Streichpreis, öffnet der nächtliche Actions-Lauf zusätzlich dessen Sale-/Outlet-Seiten (Engelhorn, Sportokay, Sport Conrad, Gigasport u. a.). Die Diagnose (`diagnose=true`, `shops=registry`) prüft jetzt auch Shopify-, WooCommerce- und Magento-Schnittstellen aller Shops.

**mydealz (30. September, abends):** Neue Quelle `mydealz` liest die RSS-Feeds der Community (öffentliche Gruppe *Outdoor* und – falls gesetzt – den persönlichen Schlagwort-Alarm-Feed aus `MYDEALZ_ALERT_FEED_URL`). So kommen auch Deals aus Shops an, deren Seiten automatische Besuche sperren (Globetrotter, Decathlon, Sport Bittl …). Referenzpreis zählt nur, wenn der Beitrag ihn beschriftet (PVG/VGP = nächstbester Preis, UVP, statt); Größen aus Angaben wie „Gr. S – XL“. Beiträge älter als 10 Tage oder „abgelaufen“ werden ignoriert. Der Link zeigt auf den mydealz-Beitrag. `MYDEALZ_ALERT_FEED_URL` ist wie ein Passwort zu behandeln: in Vercel (Production) und als GitHub-Secret gleichen Namens eintragen, nie ins Repository. Die Quelle läuft auch im nächtlichen Actions-Lauf (Snapshot), falls Vercel von mydealz abgewiesen wird. idealo/Check24 haben keine öffentliche Schnittstelle und verbieten automatisches Abrufen – nicht angebunden.

**Laufanalyse 3. Oktober und Optimierungen:** Größen aus JSON-LD-`SizeSpecification` (vorher „[object Object]“), Magento-Marken über die Hersteller-ID (Maxisport/Snowcountry), Shopify-Größenoptionen „Taglia“ u. a., Goldwin-Größen 1–5 → S–XXL (Größe 3 = 82 cm Bund ≈ L). Neu: Produktseiten-Abgleich (`lib/detail-enrich.ts`) – alle Premium-Hosen je Shop (Reihenfolge: Deals ohne Größe, Hosen ohne Referenzpreis, Rest; auf Vercel durch 60 s je Shop begrenzt, im nächtlichen Actions-Lauf bis 300 s); nur Varianten zum Listenpreis zählen, ausverkaufte Seiten werden aussortiert (`DETAIL_ENRICH_LIMIT`, `DETAIL_BUDGET_MS` optional). „bis X %“-Rabatte zählen nur mit bestätigter/wahrscheinlicher Größe oder Referenzpreis, sonst Beinahe-Deal mit Hinweis. Der Browser folgt bei leeren Übersichtsseiten allen Hosen-Produktlinks (zeitbegrenzt); Kacheln je Seite bis 400, bis zu 8× „Mehr laden“, Listen-Folgeseiten bis 20 (Actions 30). Angezeigte Rabatte über 80 % werden ignoriert, Deals über 85 % gelten als unplausibel (Beinahe-Deal mit Hinweis). Größenangaben werden mit Shop-Kontext gelesen: nackte Zahlen 42–64 als deutsche Konfektion (50/52 ≈ passend, sonst nicht), 24–40 als Zoll-Bundweite bzw. Kurzgröße (33/34 passend), Bergfreunde-Formate wie „52 - Regular (EU)“, Langgrößen „D108“; französische Shops nach FR-Größen (44/46 ≈ passend). E-Mail (9. Oktober): schlank für Gmail/Mail-Apps – vorher ~110 KB (Gmail kürzt ab ~102 KB „Nachricht gekürzt“) und 47 Bilder in Shop-Originalgröße; jetzt ~40 KB, 72-px-Vorschaubilder (Shopify/imgix klein angefordert), Prüfkandidaten ohne Bild, Shop-Abdeckung gruppiert statt technischer Tabelle (Details im Dashboard), zusätzlich Textversion. „Nicht relevant – ausblenden“ (10. Oktober): Jeder Deal und Prüfkandidat in der Mail hat einen signierten Link (HMAC, aus `CRON_SECRET` abgeleitet) auf `/api/hide`; GET zeigt nur eine Bestätigungsseite (Mail-Scanner öffnen Links vorab), erst der Knopf (POST) speichert in `agent_hidden_offers`. Ausgeblendet wird das Hosenmodell (Marke + Modellname ohne Größe/Farbe/„Pants/Hose/Herren“) in allen Shops; Finalizer und Dashboard filtern es, das Dashboard listet ausgeblendete Modelle mit „wieder anzeigen“. Sieben dauerhaft nicht rendernde Shops (403, Warteschlange, Mitgliederbereich, Dollarpreise) wurden in die Gruppe `blocked` verschoben.

## Übernahme und Prüfung

1. Repository klonen, `corepack enable`, `corepack pnpm install --frozen-lockfile`, `corepack pnpm run preflight` ausführen. Keine Secrets ins Repository schreiben.
2. `.env.example` mit den **Schlüsselnamen** und die Produktionsvariablen im Vercel-Dashboard abgleichen. `AWIN_DATAFEED_API_KEY` ist obsolet.
3. [Health](https://outdoor-deal-agent.vercel.app/api/health) prüfen: `deploymentSha`, 16 Batches, `emailDeliveryStatus=sent`, `pipelineStatus=complete`, `browserProviderStatus`. [Coverage](https://outdoor-deal-agent.vercel.app/api/coverage) zeigt Shop-Pfade/Filter; [Probe](https://outdoor-deal-agent.vercel.app/api/probe) rechnet ohne Shopzugriffe oder Mail neu.
4. Nach einem regulären Lauf im Gmail-Posteingang **eine** App-Mail mit Bildern und Coverage verifizieren. Wenn zwei Mails erscheinen, Betreff und Message-ID vergleichen und prüfen, ob eine externe Automation wieder aktiviert wurde oder eine zweite Batch-Snapshot-ID vorliegt.
5. Änderungen als Branch/Draft-PR beginnen, Preflight abschließen, PR für CI freigeben, bei grüner CI mergen. Nur `main` deployt. Danach exakten Merge-SHA im Health-Endpunkt prüfen. `AGENTS.md` beschreibt die Schreib- und Geheimnisregeln.

Weitere Detailquellen: `README.md` (Funktionsumfang), `docs/AGENT_STATE.md` (knapper Folgechat-Kontext), `docs/DISCOVERY_ARCHITECTURE.md` (Erfassungsdesign und historische Piloten), `vercel.json` (echte Zeitpläne), `.github/workflows/ci.yml` (Release-Nachweise), `scripts/validate-config.mjs` (Invarianten). Die Live-Datenbank und Anbieter-Dashboards sind maßgeblich für den jeweils aktuellen Betrieb.
