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
| Shopregister und Suchprofil | `config/shops.ts`, `config/profile.ts` | 91 EU-Quellen, Marken und Auswahlprofil |
| Erfassung | `lib/crawl.ts`, `lib/targeted.ts`, `lib/feed.ts`, `lib/globetrotter-feed.ts` | Direkte Listings, offizielle zugängliche Feeds, Sitemaps, HTML/JSON-LD |
| Browser-Fallback | `lib/browser.ts`, `lib/browser-config.mjs`, `lib/browser-budget.ts` | Browserless REST und CDP-Playwright nur bei Bedarf; Tageslimit für Sitzungsversuche |
| Normalisierung und Auswahl | `lib/normalize.ts`, `lib/product-rules.mjs`, `lib/publication-safety.mjs` | Preisbeleg, Marke/Kategorie, Größenstatus, modellübergreifende Dublettenprüfung |
| Speicherung | `lib/batch-run.ts`, `lib/store.ts` | `agent_batch_runs`, `agent_runs` in Neon |
| E-Mail | `lib/notify.ts`, `lib/gmail-smtp.mjs`, `lib/email-template.ts` | Genau ein Anbieterpfad: Gmail bei gesetztem `GMAIL_SMTP_USER`, sonst Resend; Bilder, Deals, Zusammenfassung und alle Shops |
| Web/API | `app/page.tsx`, `app/api/health`, `app/api/coverage`, `app/api/probe`, `app/api/batch-status` | Anzeige, Betriebszustand, Roh-/Nutzdaten und schreibfreie Neuberechnung |

Awin ist **kein nutzbarer Datenpfad**: Die Händler haben den Publisher nicht zugelassen. Adapter, Awin-Statusroute und Setup-Anleitung wurden entfernt. Die Vercel-Variable `AWIN_DATAFEED_API_KEY` wird vom Code nicht mehr gelesen; ein eventuell noch gespeicherter Wert kann im Vercel-Dashboard entfernt werden. Historische JSON-Coverage kann weiterhin `awin-check` enthalten.

## Zeitkette und E-Mail

Alle Cron-Zeiten in `vercel.json` sind **UTC**. In Deutschland im Sommer UTC+2, im Winter UTC+1. Auf Vercel Hobby können Jobs innerhalb ihrer geplanten Stunde verzögert starten.

| UTC-Zeit | Zweck |
| --- | --- |
| 00:00–03:00 | 16 Batch-Crons à maximal sechs Shops |
| 04:00 | Finalisierung, sobald alle 16 Batches vorhanden sind |
| 05:00–05:15 | 16 Einzel-Retries für fehlende Batches |
| 06:00 | Finalisierung erneut versuchen |
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
| `BROWSERLESS_DAILY_SESSION_LIMIT` | Standard 24 Provider-Sitzungsversuche je UTC-Tag über alle Batches; kein exakter Browserless-Unitzähler |
| `OPENAI_API_KEY`, `LLM_EXTRACTION_MODE`, `LLM_EXTRACTION_SHOPS`, `LLM_EXTRACTION_MODEL` | Optionaler LLM-Pilot, zurzeit `shadow`; dieser publiziert keine zusätzlichen Angebote |

`playwright-core` nutzt `connectOverCDP()` am WebSocket-Root `wss://production-ams.browserless.io?token=…`. Der Pfad `/chromium/playwright` gehört zur anderen Playwright-`connect()`-Methode. Das Browserless-Token niemals in Logs, PRs oder Dokumente kopieren. Ein vorhandener Cloud-Token hat Vorrang vor der veralteten `BROWSERLESS_CONTENT_URL`.

## Tagesstatus vom 30. September 2026

- Letzter zum Zeitpunkt der Übergabe geprüfter Produktions-Commit: `37fa1ebdc83d80309280feda24494dde47fd4fa1` (vor dieser Bereinigung).
- 16/16 Batches; letzter finalisierter Bericht um 04:52 UTC; App-Status `pipelineStatus=complete`, `emailDeliveryStatus=sent`.
- 1.671 Rohangebote, 138 normalisierte Angebote, fünf veröffentlichte Deals aus 91 Shops.
- Browserless: 73 Shops versuchten den Fallback, **0** wurden darüber wiedergewonnen, 72 meldeten `browser-provider-auth-rejected`. Reale `/content`- und `/unblock`-Anfragen erhielten HTTP 401. `browserFallbackConfigured=true` hieß bislang lediglich, dass ein Tokenwert vorhanden war. Der neue Health-Status macht die Auth-Ablehnung sichtbar.
- Vercel Runtime Logs konnten wegen `ExceedsBillingLimitError` nur eingeschränkt eingesehen werden; die obigen Browserless-Zahlen stammen aus den gespeicherten Batch-Coverage-Daten von `/api/batch-status`.

**Offener Betriebsfehler:** In Browserless einen gültigen API-Token und den Accountstatus prüfen, `BROWSERLESS_API_TOKEN` in Vercel Production kontrollieren, neue Production-Deployment-Version auslösen. Dann einen kleinen schreibfreien `pnpm smoke:browser`-Test mit lokal bereitgestelltem Token oder den nächsten begrenzten Produktionsbatch auswerten. Erfolg ist an tatsächlichem HTTP 200/Browser-Extraktion erkennbar, nicht am Konfigurationsflag. Bis dahin erzeugt der direkte Crawl weiterhin den täglichen Bericht und die E-Mail.

## Übernahme und Prüfung

1. Repository klonen, `corepack enable`, `corepack pnpm install --frozen-lockfile`, `corepack pnpm run preflight` ausführen. Keine Secrets ins Repository schreiben.
2. `.env.example` mit den **Schlüsselnamen** und die Produktionsvariablen im Vercel-Dashboard abgleichen. `AWIN_DATAFEED_API_KEY` ist obsolet.
3. [Health](https://outdoor-deal-agent.vercel.app/api/health) prüfen: `deploymentSha`, 16 Batches, `emailDeliveryStatus=sent`, `pipelineStatus=complete`, `browserProviderStatus`. [Coverage](https://outdoor-deal-agent.vercel.app/api/coverage) zeigt Shop-Pfade/Filter; [Probe](https://outdoor-deal-agent.vercel.app/api/probe) rechnet ohne Shopzugriffe oder Mail neu.
4. Nach einem regulären Lauf im Gmail-Posteingang **eine** App-Mail mit Bildern und Coverage verifizieren. Wenn zwei Mails erscheinen, Betreff und Message-ID vergleichen und prüfen, ob eine externe Automation wieder aktiviert wurde oder eine zweite Batch-Snapshot-ID vorliegt.
5. Änderungen als Branch/Draft-PR beginnen, Preflight abschließen, PR für CI freigeben, bei grüner CI mergen. Nur `main` deployt. Danach exakten Merge-SHA im Health-Endpunkt prüfen. `AGENTS.md` beschreibt die Schreib- und Geheimnisregeln.

Weitere Detailquellen: `README.md` (Funktionsumfang), `docs/AGENT_STATE.md` (knapper Folgechat-Kontext), `docs/DISCOVERY_ARCHITECTURE.md` (Erfassungsdesign und historische Piloten), `vercel.json` (echte Zeitpläne), `.github/workflows/ci.yml` (Release-Nachweise), `scripts/validate-config.mjs` (Invarianten). Die Live-Datenbank und Anbieter-Dashboards sind maßgeblich für den jeweils aktuellen Betrieb.
