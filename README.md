# Outdoor Deal Agent

Personal crawler and scoring service for the outdoor-deal search.

For a compact cross-chat project handoff, read `docs/AGENT_STATE.md` first.

## Architecture

The production source is tracked directly in this repository. There is no generated ZIP bootstrap, no build-time source overlay and no `*.override.ts` layer. Vercel and GitHub CI compile the same files that are reviewed in Git.

The daily pipeline runs as 16 Vercel cron batches. Each batch crawls up to six sources with bounded concurrency and persists normalized offers plus source coverage in Neon PostgreSQL. Missing batches receive a separate recovery attempt at 05:00 UTC; the finalizer retries at 07:00 UTC and only publishes a consolidated run when every expected batch exists.

Each finalized coverage report compares the current run with the previous finalized report. The dashboard, `/api/coverage`, and an enabled notification show changes in reached shops, shops with product data, raw products, normalized offers, confirmed sizes, deals and review candidates; per-shop rows show status and product-count changes. A same-day full rerun compares against the earlier published report of that day. The baseline is saved inside the new report so subsequent finalizer retries cannot silently replace it. `/api/probe` previews the same comparison without writing to Neon. A notification is keyed to the completed batch snapshot, so retries do not resend it but a new same-day crawl can send an updated report. A missing historical field is shown as unknown rather than zero.

Source acquisition order is: official product feed/API where available, Awin product feed when configured and accessible, targeted retailer listing parsers, generic feed, sitemap/HTTP parsing, Browserless REST rendering/unblocking and finally remote Playwright for difficult rendered or interactive pages. No local Chromium or browser binaries are bundled; `playwright-core` is only the remote-control client.

## Deal quality gates

- Only eligible men's long outdoor trousers enter the shortlist; ski, winter, rain, zip-off, shorts and tights are rejected.
- A confirmed deal requires a reference price tied to the same variant, known shipping to Germany and a confirmed purchasable target size. Uncertain products remain review candidates.
- Offers with the same merchant and canonical product URL are collapsed.
- Listing cards are discovery evidence; live size availability is only confirmed from explicit available variant data. A generic list of size labels is never sufficient.
- Market-price scoring is disabled until comparable product evidence is available. A neutral market score is never invented.
- Deal classification and scoring are deterministic TypeScript rules, not LLM decisions.

The home page shows confirmed deals, review candidates, source quality and a browser-local watchlist. Historic prices are shown when the same offer was saved in more than one finalized run. A single consolidated email after a complete run can be enabled with `RESEND_API_KEY`, `DEAL_NOTIFY_FROM` and `DEAL_NOTIFY_TO`; without these settings, no email is sent. The provider request and database state are keyed by run date to avoid duplicate notifications.

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
- `/api/health` verifies database reachability, daily pipeline completeness and browser-fallback configuration without exposing credentials.
- Read-only status endpoints use short CDN caching where appropriate.

## Browserless fallback

Set `BROWSERLESS_API_TOKEN` (or `BROWSERLESS_TOKEN`) in Vercel Production. The default endpoint is the Amsterdam Browserless Cloud region (`https://production-ams.browserless.io`) and can be overridden with `BROWSERLESS_BASE_URL`.

- `/content` renders JavaScript-heavy pages and returns HTML for the JSON-LD/HTML extractors.
- `/unblock` handles direct 403/429 responses.
- When `/unblock` content is not enough, Browserless can return a live `browserWSEndpoint`; `playwright-core` attaches with `connectOverCDP()` to the same already-unblocked session.
- If no reusable unblock session is available, a fresh remote Browserless Playwright session is the final bounded fallback.
- `BROWSER_FALLBACK_URL_LIMIT` defaults to 2 (max 3) to protect runtime and Browserless unit usage.
- `BROWSERLESS_PROXY` can optionally be set for especially protected shops, but is intentionally empty by default because proxy traffic consumes additional units.
- `BROWSERLESS_UNBLOCK=false` or `BROWSERLESS_PLAYWRIGHT=false` can disable either escalation layer independently.
- The legacy `BROWSERLESS_CONTENT_URL` remains supported and takes precedence if present.

## Optional integrations

Awin remains optional. Until `AWIN_DATAFEED_API_KEY` is configured, mapped merchants automatically use their existing targeted/direct ingestion paths. Browserless Cloud is the remote browser layer; the application bundles only `playwright-core`, never a local browser binary.

## LLM extraction pilot

An optional OpenAI extraction fallback can inspect a bounded set of product-card text snippets only after Browserless has returned page content and the deterministic parsers found no offers. It cannot resolve blocked requests and does not run on feeds or successful parsers. The pilot is disabled unless `LLM_EXTRACTION_MODE` is set.

- Set `LLM_EXTRACTION_MODE=shadow` to record evidence-validated candidate offers without passing them into normalization or deal selection.
- The initial shop allowlist defaults to `mammut-eu`; change it with `LLM_EXTRACTION_SHOPS` (comma-separated shop IDs).
- Set `OPENAI_API_KEY` in the server environment. The default model is `gpt-6-luna`; override with `LLM_EXTRACTION_MODEL`.
- The request is capped at 12 product candidates, 16,000 input characters, 1,800 output tokens and 6 seconds. Browser fallback can attempt at most once per URL.
- Shadow results appear as compact `llm-extraction-pilot` runtime log entries. Raw page HTML and evidence text are not logged.
- Every accepted name, URL and current price must match supplied page evidence. A reference price is retained only when explicitly labeled in the evidence. Size and availability remain unknown; the LLM cannot confirm them.
- After reviewing shadow results, `LLM_EXTRACTION_MODE=active` may be enabled for the allowlisted shop. Even then, the existing normalizer and deterministic deal rules remain the publication gate.

Do not enable active mode until shadow results have been checked against the product pages. The pilot intentionally uses no LLM result to make a size or stock claim.
