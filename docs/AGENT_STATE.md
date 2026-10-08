# Outdoor Deal Agent — durable handoff

This file is the compact source-of-truth handoff for AI development sessions (Claude Code since 30 September 2026; previously ChatGPT/Codex). It exists so development is not dependent on one long chat history. `CLAUDE.md` loads `AGENTS.md` and points here.

## Production

- Repository: `nico-classic350/outdoor-deal-agent`
- Default branch: `main`
- Production: `https://outdoor-deal-agent.vercel.app`
- Hosting/runtime: Vercel + Node 24 + Next.js/TypeScript
- Database: Neon PostgreSQL
- CI: GitHub Actions `CI & Change Observability`
- `git.deploymentEnabled` uses `**: false` for non-main branches (including branches with `/`) and `main: true` for production. The old `*: false` rule did not cover slashed branches. Vercel may retain historical failed-preview records; future feature pushes should create no preview deployment.
- Write path: in Claude Code cloud sessions, `git push` to the session's designated branch works through the session's git proxy; the connected GitHub app (MCP) is the alternative for branches, PRs, workflow dispatch and logs. Never persist a personal access token in the project or workspace.

## Daily pipeline

- 92 registered shops (brand review 30 September 2026: Black Diamond and Adidas Terrex stores replaced by Fjällräven and Lundhags; Bergans and Klättermusen added; Trekkinn (USD for the US runner) and the closed Montura store removed)
- batch size 6, expected batches 16
- batches persist to `agent_batch_runs`
- 16 recovery crons in the 04:00 UTC hour rerun missing batches; the finalizer runs in the 05:00 UTC hour but defers until 07:00 Europe/Berlin (`lib/send-time.ts`), so in winter the retry finalizer in the 06:00 UTC hour sends the mail; watchdog in the 07:00 UTC hour; `agent_runs` is published only after all batches are present
- `/api/health` is the production health and deployment-SHA source
- `/api/probe` replays current filtering/scoring against the latest complete stored batch snapshot without crawling shops
- Finalized reports include a delta against the previous finalized report, including per-shop status, raw extraction and useful-offer counts. Same-day reruns preserve the earlier report as their baseline. `/api/probe` previews this comparison read-only; snapshot-keyed notifications can send a corrected same-day report without duplicate messages on finalizer retries.

## Product selection

- men's long hiking/trekking trousers only
- hard brand whitelist is in `config/profile.ts`
- explicit incompatible evidence excludes; missing optional evidence does not
- target size W33/L32, W34/L32 acceptable; never > L32
- no rain/hardshell, winter/ski, zip-off, heavy alpine or loud designs
- Rabatt-Deals require verified same-variant prior/reference price or explicit merchant discount, allowed brand/category and at least 40% discount. Missing size, shipping and returns are disclosed but do not exclude. Explicitly incompatible available sizes, sold-out items and excluded categories still do.
- size labels from all systems are normalised onto L / W33–34 ≤ L32 (`normalizeSizeLabel`); the Actions job verifies selectable sizes on the product page of each potential deal (max 6 per shop)
- price evidence: JSON-LD/feed reference prices, Shopify `compare_at_price`, WooCommerce/Magento `regular_price`, visually struck-through prices, explicitly labelled reference prices (UVP/statt/Listino/RRP …) and ≥ 40 % merchant badges; an unlabelled higher price is never evidence
- every qualified deal is listed in the report and mail (ranked by score); no top-N cut-off
- deal qualification and scoring are deterministic TypeScript rules
- Mammut men's category is targeted; product cards are discovery data and carry no invented UVP

## Acquisition order

1. official feed/API where available, including Shopify collection JSON (`config/shopify-sources.ts`, verified euro stores) and WooCommerce Store API / Magento GraphQL (`config/commerce-sources.ts`); mydealz RSS (`lib/mydealz.ts`: public group feed plus optional `MYDEALZ_ALERT_FEED_URL`, set in Vercel and as GitHub secret; labelled PVG/UVP/statt only); the nightly Actions run covers all registered shops (`shops=registry`: Chromium phase for the browser cohort, then a direct phase; snapshots for non-browser shops hold only premium trousers, and `mergeSnapshot` carries their product-page sizes/reference/stock to the same Vercel offer at the same price); shops whose relevant products lack price evidence also render their configured sale/outlet start pages; after every shop crawl, every premium trouser is checked (time-bounded: `DETAIL_BUDGET_MS` 60 s on Vercel, 300 s in the nightly Actions run; `DETAIL_ENRICH_LIMIT` optional cap) on their product page (`lib/detail-enrich.ts`: JSON-LD variants at the listing price give in-stock sizes and reference prices incl. StrikethroughPrice; all-out-of-stock pages mark the offer sold out); size labels are read with shop context (`sizeEvidence(sizes, 'fr'|'de')`: bare 42–64 = German sizing, bare 24–40 = inch waist/Kurzgröße, FR shops use FR numbers); up-to badges (`merchant:displayed-discount-upto`) qualify only with a confirmed/probable size or a reference price
2. targeted retailer parsers
3. generic feed/sitemap/direct HTTP + JSON-LD/HTML
4. GitHub Actions Chromium snapshot (nightly `browser-crawl.yml`, `agent_browser_snapshots`, merged by the batches when younger than 30 h)
5. Browserless `/content` for JS-rendered pages (opt-in; `BROWSERLESS_DAILY_SESSION_LIMIT` defaults to 0)
6. Browserless `/unblock` for 403/429
7. Browserless remote Playwright (`playwright-core`, CDP) for difficult rendered/interactive pages

Awin advertiser access was declined. Its runtime adapter, health route, key and setup guide were removed. Historical coverage may still contain `awin-check`; these entries are immutable evidence of old runs.

No local Chromium or full Playwright browser binaries are bundled into Vercel. Only the GitHub Actions job launches Chromium (`BROWSER_RUNTIME=local`, never active when `VERCEL` is set).

## Results and notification

- `/` displays evidenced-discount deals, review candidates, source evidence and browser-local saved items.
- A complete daily run requires a provider-accepted consolidated email with images and full coverage. Production needs `DEAL_NOTIFY_TO` and either `GMAIL_SMTP_USER` plus `GMAIL_SMTP_APP_PASSWORD` for Gmail, or `RESEND_API_KEY` plus `DEAL_NOTIFY_FROM` for a verified sending domain. Missing settings make health and finalizer unhealthy, and the recovery cron retries failed sends from the saved report. No recipient address is hardcoded.
- Price history on the page uses finalized offer snapshots from up to 30 recent runs.

## Browserless environment variables

Never commit values. Supported names:

- `BROWSERLESS_API_TOKEN` (preferred) or `BROWSERLESS_TOKEN` — optional; removed from Vercel Production on 30 September 2026, rendering runs in GitHub Actions
- `BROWSERLESS_BASE_URL` (defaults to Amsterdam shared cloud)
- `BROWSERLESS_UNBLOCK=false` to disable unblock
- `BROWSERLESS_PLAYWRIGHT=false` to disable remote Playwright
- optional `BROWSERLESS_PROXY`
- `BROWSERLESS_DAILY_SESSION_LIMIT` (default 0 = no paid escalation; a positive value admits that many sessions per UTC day across all batches). A database-backed atomic counter gates REST attempts and CDP connections, including retries. This is not a precise Browserless billed-unit meter; inspect the account's actual unit usage.

Optional bounded LLM extraction pilot (off unless enabled):

- `OPENAI_API_KEY` (server-side only)
- `LLM_EXTRACTION_MODE=shadow` to observe results without publishing them; `active` is opt-in after review
- `LLM_EXTRACTION_SHOPS` (comma-separated; defaults to `mammut-eu`)
- `LLM_EXTRACTION_MODEL` (defaults to `gpt-6-luna`)
- Direct HTTP 200 LLM observation is shadow-only for 4camping, Rab and Peak Performance (one parse-empty page per shop; requires `OPENAI_API_KEY`); Browserless 429 stops further provider calls for that shop. Daily coverage compares browser recoveries and provider limits when both snapshots recorded technical paths.

The pilot only runs after a rendered page was received and deterministic extraction returned no offers. It caps the request at 12 product candidates, 16,000 input characters, 1,800 output tokens and 6 seconds. It requires page evidence for extracted names and prices; listing pages never confirm size or availability. See the README's “LLM extraction pilot” section for its shadow-review and activation procedure.

For a read-only five-shop Browserless smoke test, set the token in the local shell and run `pnpm smoke:browser`. The default shops are Hervis, Sport Bittl, Mammut EU, Odlo EU and Arc’teryx EU; pass shop IDs to select others. It prints coverage and offer counts and never writes to Neon. Browserless requests may consume account credits. HTTP and browser requests share the source deadline; coverage records each browser stage and its elapsed time.

Health exposes only non-secret configuration state.

As of 30 September 2026, the production batches recorded Browserless HTTP 401 and zero recovered products despite the token being configured. `/api/health` now exposes `browserProviderStatus` and counts of auth-rejected sources. The token must be corrected in Vercel Production and a new deployment created before a subsequent batch can establish recovery. Tokens are now trimmed of whitespace/wrapping quotes (`browserTokenIssue` in health names the kind of issue, never the value). `GET /api/browser-check` performs one bounded `/content` render of example.com per deployed token and UTC day (max three per day, counted in the shared session budget) and stores the outcome in `agent_browser_provider_checks`; `browserProviderStatus=check-accepted` means the provider accepted the current token, `recovered-products` means a batch actually gained products.

Two legacy ChatGPT automations that independently sent the same daily report were paused on 30 September 2026. The app's Gmail SMTP notification and Vercel watchdog remain the sole active report pipeline. See `docs/HANDOVER.md` for status, operations, and the current open issue.

## Change workflow

For code changes:

1. branch from current `main`
2. use a draft PR while work is incomplete
3. mark ready only when the change is complete
4. require full `pnpm run preflight`
5. merge only on green CI
6. production-observability verifies the exact merged SHA, `/api/health`, registry and `/api/probe`
7. inspect stored GitHub workflow artifacts/logs on any failure before changing code again

## Starting a fresh Claude Code session

Claude Code reads `CLAUDE.md` (which includes `AGENTS.md`) automatically. Ask it to read `docs/AGENT_STATE.md`, then check current `main`, open PRs, the latest GitHub CI run, the Vercel deployment and `/api/health` before making changes. A fresh session is preferred over continuing an oversized historical one. The browser path can be inspected without local shop access via *Actions → Chromium browser crawl* with `diagnose=true` (read-only).

Update this file whenever architecture, deployment flow, core selection rules or required environment variables change. Do not put credentials, tokens or personal data here.
