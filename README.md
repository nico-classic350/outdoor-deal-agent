# Outdoor Deal Agent

Personal crawler and scoring service for the outdoor-deal search.

For an operational handoff, read [`docs/HANDOVER.md`](docs/HANDOVER.md) and then `docs/AGENT_STATE.md`.

## Architecture

The production source is tracked directly in this repository. There is no generated ZIP bootstrap, no build-time source overlay and no `*.override.ts` layer. Vercel and GitHub CI compile the same files that are reviewed in Git.

The daily pipeline runs as 16 Vercel cron batches, scheduled at 00:00–03:00 UTC. Each batch crawls up to six sources with bounded concurrency and persists normalized offers plus source coverage in Neon PostgreSQL. Missing batches receive a separate recovery attempt in the 05:00 UTC hour. Finalization is scheduled in the 04:00 UTC hour and retried in the 06:00 UTC hour. On Vercel Hobby, each scheduled hour has up to 59 minutes of timing variation. The watchdog runs in the 07:00 UTC hour; additional recovery windows run at 10:00, 14:00, 20:00 and 23:00 UTC, with a next-day backfill for fully crawled runs. A report can be saved while notification is pending; a daily run is successful only when the provider accepted the email and its message ID was persisted.

Each finalized coverage report compares the current run with the immediately preceding published report. The dashboard, `/api/coverage`, and an enabled notification show changes in reached shops, shops with product data, raw products, normalized offers, confirmed sizes, deals and review candidates; per-shop rows show status and product-count changes. A same-day full rerun compares against the last published report of that day. The batch snapshot timestamp and baseline are saved inside the new report so subsequent finalizer retries cannot silently replace the baseline. `/api/probe` previews the same comparison without writing to Neon. A notification is keyed to the completed batch snapshot, so retries do not resend it but a new same-day crawl can send an updated report. A missing historical field is shown as unknown rather than zero.

Source acquisition order is: accessible official merchant feeds/APIs, targeted retailer listing parsers, generic feed, sitemap/HTTP parsing, Browserless REST rendering/unblocking and finally remote Playwright for difficult rendered or interactive pages. Awin is not available to this publisher and has been removed from the runtime. No local Chromium or browser binaries are bundled; `playwright-core` is only the remote-control client.

## Deal quality gates

- Only eligible men's long outdoor trousers enter the shortlist; ski, winter, rain, zip-off, shorts and tights are rejected.
- A Rabatt-Deal requires the allowed brand/category and at least 40% discount supported by a same-variant merchant price pair or explicit merchant discount. Missing size, shipping or return information remains visible for checking at checkout, but no longer excludes a deal. Explicit incompatible sizes and sold-out products still fail.
- Offers with the same merchant and canonical product URL are collapsed.
- Listing cards are discovery evidence; live size availability is only confirmed from explicit available variant data. A generic list of size labels is never sufficient.
- Market-price scoring is disabled until comparable product evidence is available. A neutral market score is never invented.
- Deal classification and scoring are deterministic TypeScript rules, not LLM decisions.

The home page shows confirmed deals, review candidates, source quality and a browser-local watchlist. Historic prices are shown when the same offer was saved in more than one finalized run. A consolidated email with product thumbnails, offer details, summary and full shop coverage requires `DEAL_NOTIFY_TO` and one sender: use `GMAIL_SMTP_USER` plus `GMAIL_SMTP_APP_PASSWORD` for a Gmail sender, or `RESEND_API_KEY` plus `DEAL_NOTIFY_FROM` for a verified custom domain. The Gmail credentials are a dedicated Google app password stored only in Vercel Production, never the account password. If `GMAIL_SMTP_USER` is set, Gmail is selected and an absent app password is a configuration error. Without a configured sender or SMTP/API acceptance, finalizer and watchdog return HTTP 503; health reports `delivery-pending` as soon as a report is saved without mail, then `delivery-overdue` after the daily deadline. A stable batch snapshot identifies the message, and a database lease permits retries after crashed workers. Resend provides 24-hour idempotency; SMTP cannot guarantee duplicate suppression if a worker crashes after SMTP acceptance but before persisting the receipt. Provider acceptance does not guarantee inbox delivery.

`/api/health` exposes the LLM pilot mode, shop allowlist, model and whether an API key is configured, without returning the key. `llmExtraction.readyForMammut` confirms that the Mammut shadow/active pilot is configured; a model call still requires a rendered page with no deterministic offers. Inspect the `llm-extraction-pilot` runtime log after the next eligible crawl to verify the actual request outcome.

## Build and CI

- Node 24.x and pnpm 10.15.1 are pinned.
- GitHub CI installs with `pnpm install --frozen-lockfile`.
- `pnpm run preflight` validates deployment invariants, runs TypeScript, tests and a full Next.js build.
- TypeScript errors fail the build.
- `scripts/validate-config.mjs` checks direct-source integrity, shop/batch/cron consistency, cron authorization, runtime budgets, remote-browser architecture and Vercel deployment policy.
- The validator explicitly fails if the legacy ZIP/source-preparation layer or a full local Playwright browser package is reintroduced.

## Release workflow

All non-`main` Git branches are blocked from automatic Vercel deployment by the `**: false` rule in `vercel.json`; the `main: true` rule enables production deployments. The former `*: false` rule missed branch names containing `/`, so Vercel attempted previews and the connected integration failed before the build. `validate:config` now checks this branch behavior. Work-in-progress changes should be kept in a **draft pull request**. Draft pull requests do not run the expensive `verify` CI job, so intermediate commits cannot generate misleading failure notifications. Once the branch is complete, mark the PR **Ready for review**; GitHub then runs the full frozen-lockfile/preflight/build gate. After green CI, merge the tested change to `main`; only `main` triggers Vercel production deployment.

This avoids both previous failure classes: Vercel preview integration-provisioning errors and GitHub failure emails from unfinished intermediate PR commits.

In short-lived coding workspaces, terminal `git push` may lack GitHub credentials even while the connected GitHub app can write to the repository. Use the connected GitHub app for branch, commit, pull request and merge operations; use terminal Git for local inspection and fetch. Keep authentication out of repository files. If using terminal Git on a persistent personal machine, configure its own credential helper once and verify it separately. See `docs/AGENT_STATE.md` for the handoff procedure.

## Change observability

Every non-draft PR and every push to `main` produces a persistent change-observability record in GitHub Actions.

**Before the build** the workflow records the base/head commit, changed files, diff statistics and a focused patch for deployment-, dependency-, crawler-, scoring-, configuration- and API-related files.

**During the build** the exact toolchain, frozen-lockfile install output and full `pnpm run preflight` output are captured. The workflow always publishes a GitHub job summary and uploads the complete observability directory as a 30-day workflow artifact, including failure cases.

**After a successful merge to `main`** a dedicated production-observability job waits until `/api/health` reports the exact merged Git SHA from Vercel. It then validates production HTTP health, Neon reachability, the shop registry and the read-only `/api/probe` Fast Replay. Health, registry, probe and verification summaries are stored as workflow artifacts. If Vercel does not deploy the expected SHA within the bounded wait window, or health/probe checks fail, the production-observability job fails with the last observed state preserved for diagnosis.

This creates a single trace from code diff -> CI/preflight -> Vercel deployment -> production health/probe. GitHub/Vercel logs can therefore be inspected directly without relying on screenshots or manual reconstruction.

## Runtime safeguards

- Monolithic full-crawl routes are retired.
- Each source has a wall-clock budget and generic crawling has a URL cap.
- Browser fallback is capped to a small number of candidate URLs per failed source.
- Direct 403/429 responses use Browserless `/unblock`; if rendered HTML still cannot be parsed, the unblocked browser session can be handed directly to Playwright instead of starting over.
- HTTP 200 pages with no parseable products use `/content`, then remote Playwright only when necessary.
- Browser extraction handles common consent dialogs, lazy loading, bounded “load more” controls and single-product size controls.
- Direct HTTP and Browserless calls use the same per-shop deadline; coverage records the attempted browser stages and elapsed time per stage.
- `pnpm smoke:browser` runs a read-only five-shop crawl with a locally supplied Browserless token and reports each shop's coverage without touching Neon.
- Batch writes are idempotent per date/index.
- Finalization is idempotent per run date and refuses to publish incomplete runs.
- Source coverage distinguishes discovered product cards, usable priced candidates, verified reference prices, confirmed sizes and qualifying deals.
- Each source also stores a compact diagnostic code (for example parser empty, missing reference price or unverified size) for human review and future parser assistance; no model decides whether to publish a deal.
- Sitemap links are restricted to the shop domain and HTML crawling respects robots.txt.
- Mammut men's hiking-trouser category uses a targeted HTML parser. Its server-rendered product cards are extracted without requiring Browserless; a repeated screen-reader price is read once and does not become an MSRP.
- `/api/health` verifies database reachability, daily pipeline completeness and browser-fallback configuration without exposing credentials. It also reports Browserless authentication failures observed in today's batches; a configured token alone does not prove it is accepted.
- Read-only status endpoints use short CDN caching where appropriate.

## Browserless fallback

Set `BROWSERLESS_API_TOKEN` (or `BROWSERLESS_TOKEN`) in Vercel Production. The default endpoint is the Amsterdam Browserless Cloud region (`https://production-ams.browserless.io`) and can be overridden with `BROWSERLESS_BASE_URL`.
For the existing `playwright-core` CDP connection the WebSocket URL is `wss://production-ams.browserless.io?token=…`; the `/chromium/playwright` path is for the native Playwright protocol (`connect()`), not `connectOverCDP()`. Never log either URL with its credential. `BROWSERLESS_DAILY_SESSION_LIMIT` defaults to 24 provider session admissions per UTC day across all batches; `0` disables paid escalation. The database-backed counter counts REST attempts and CDP connections, not actual billed Browserless units, so monitor usage in Browserless.

- `/content` renders JavaScript-heavy pages and returns HTML for the JSON-LD/HTML extractors.
- `/unblock` handles direct 403/429 responses.
- When `/unblock` content is not enough, Browserless can return a live `browserWSEndpoint`; `playwright-core` attaches with `connectOverCDP()` to the same already-unblocked session.
- If no reusable unblock session is available, a fresh remote Browserless Playwright session is the final bounded fallback.
- `BROWSER_FALLBACK_URL_LIMIT` defaults to 2 (max 3) to protect runtime and Browserless unit usage.
- `BROWSERLESS_PROXY` can optionally be set for especially protected shops, but is intentionally empty by default because proxy traffic consumes additional units.
- A Browserless `429` stops further Browserless calls for that shop in the current crawl. Coverage records `browser-provider-rate-limited`; remote Playwright connection failures are classified without exposing token-bearing URLs. A later scheduled run can retry after provider capacity is available.
- `BROWSERLESS_UNBLOCK=false` or `BROWSERLESS_PLAYWRIGHT=false` can disable either escalation layer independently.
- The legacy `BROWSERLESS_CONTENT_URL` remains supported only when no Cloud token is present; a configured Cloud token takes precedence so an old content-only URL cannot silently disable Playwright.

## Optional integrations

Browserless Cloud is the remote browser layer; the application bundles only `playwright-core`, never a local browser binary. Merchant feeds are used only where the shop itself provides an accessible feed. Awin access was denied and is not part of this deployment.

## LLM extraction pilot

An optional OpenAI extraction fallback inspects a bounded set of product-card text snippets after Browserless has returned page content and the deterministic parsers found no offers. A separate observation-only path examines one directly fetched, parse-empty HTTP 200 page for each of `4camping`, `rab-eu` and `peakperformance-eu`, without depending on Browserless. It cannot resolve blocked requests and does not run on feeds or successful parsers. The Browserless pilot is disabled unless `LLM_EXTRACTION_MODE` is set; the direct observation path needs `OPENAI_API_KEY` and never passes offers into normalization.

- Set `LLM_EXTRACTION_MODE=shadow` to record evidence-validated candidate offers without passing them into normalization or deal selection.
- The initial shop allowlist defaults to `mammut-eu`; change it with `LLM_EXTRACTION_SHOPS` (comma-separated shop IDs).
- Set `OPENAI_API_KEY` in the server environment. The default model is `gpt-6-luna`; override with `LLM_EXTRACTION_MODEL`.
- The request is capped at 12 product candidates, 16,000 input characters, 1,800 output tokens and 6 seconds. Browser fallback can attempt at most once per URL.
- Shadow results appear as compact `llm-extraction-pilot` runtime log entries. Raw page HTML and evidence text are not logged.
- Direct observations appear as `llm-direct-shadow` with candidate and accepted offer counts; missing API configuration or empty candidate evidence is visible in the source's technical path.
- Every accepted name, URL and current price must match supplied page evidence. A reference price is retained only when explicitly labeled in the evidence. Size and availability remain unknown; the LLM cannot confirm them.
- After reviewing shadow results, `LLM_EXTRACTION_MODE=active` may be enabled for the allowlisted shop. Even then, the existing normalizer and deterministic deal rules remain the publication gate.

Do not enable active mode until shadow results have been checked against the product pages. The pilot intentionally uses no LLM result to make a size or stock claim.

Coverage deltas also count shops for which Browserless returned product data and shops that hit the provider `429`. Older comparison baselines without technical-path details show `—` for these metrics.
