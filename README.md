# Outdoor Deal Agent

Personal crawler and scoring service for the outdoor-deal search.

## Architecture

The production source is tracked directly in this repository. There is no generated ZIP bootstrap, no build-time source overlay and no `*.override.ts` layer. Vercel and GitHub CI compile the same files that are reviewed in Git.

The daily pipeline runs as 16 Vercel cron batches. Each batch crawls up to six sources with bounded concurrency and persists normalized offers plus source coverage in Neon PostgreSQL. The finalizer publishes a consolidated run only when all expected batches exist; a retry finalizer provides a second completion attempt.

Source acquisition order is: official product feed/API where available, Awin product feed when configured and accessible, targeted retailer listing parsers, generic feed, sitemap/HTTP parsing, and optional external Browserless fallback. Heavy local Chromium/Playwright dependencies are intentionally excluded.

## Deal quality gates

- Only eligible men's long outdoor trousers enter the shortlist; ski, winter, rain, zip-off, shorts and tights are rejected.
- Missing optional data does not suppress an otherwise strong deal. Explicit incompatible evidence remains a hard exclusion.
- Offers with the same merchant and canonical product URL are collapsed.
- Listing cards are discovery evidence; live size availability is only confirmed from explicit variant data.
- Deal classification and scoring are deterministic TypeScript rules, not LLM decisions.

## Build and CI

- Node 24.x and pnpm 10.15.1 are pinned.
- GitHub CI installs with `pnpm install --frozen-lockfile`.
- `pnpm run preflight` validates deployment invariants, runs TypeScript, tests and a full Next.js build.
- TypeScript errors fail the build.
- `scripts/validate-config.mjs` checks direct-source integrity, shop/batch/cron consistency, cron authorization, runtime budgets and Vercel deployment policy.
- The validator explicitly fails if the legacy ZIP, source-preparation script or root override files are reintroduced.

## Release workflow

All non-`main` Git branches are blocked from automatic Vercel deployment. Work-in-progress changes should be kept in a **draft pull request**. Draft pull requests do not run the expensive `verify` CI job, so intermediate commits cannot generate misleading failure notifications. Once the branch is complete, mark the PR **Ready for review**; GitHub then runs the full frozen-lockfile/preflight/build gate. After green CI, merge the tested change to `main`; only `main` triggers Vercel production deployment.

This avoids both previous failure classes: Vercel preview integration-provisioning errors and GitHub failure emails from unfinished intermediate PR commits.

## Change observability

Every non-draft PR and every push to `main` produces a persistent change-observability record in GitHub Actions.

**Before the build** the workflow records the base/head commit, changed files, diff statistics and a focused patch for deployment-, dependency-, crawler-, scoring-, configuration- and API-related files.

**During the build** the exact toolchain, frozen-lockfile install output and full `pnpm run preflight` output are captured. The workflow always publishes a GitHub job summary and uploads the complete observability directory as a 30-day workflow artifact, including failure cases.

**After a successful merge to `main`** a dedicated production-observability job waits until `/api/health` reports the exact merged Git SHA from Vercel. It then validates production HTTP health, Neon reachability, the shop registry and the read-only `/api/probe` Fast Replay. Health, registry, probe and verification summaries are stored as workflow artifacts. If Vercel does not deploy the expected SHA within the bounded wait window, or health/probe checks fail, the production-observability job fails with the last observed state preserved for diagnosis.

This creates a single trace from code diff -> CI/preflight -> Vercel deployment -> production health/probe. GitHub/Vercel logs can therefore be inspected directly without relying on screenshots or manual reconstruction.

## Runtime safeguards

- Monolithic full-crawl routes are retired.
- Each source has a wall-clock budget and generic crawling has a URL cap.
- Batch writes are idempotent per date/index.
- Finalization is idempotent per run date and refuses to publish incomplete runs.
- `/api/health` verifies database reachability and daily pipeline completeness.
- Read-only status endpoints use short CDN caching where appropriate.

## Optional integrations

Awin remains optional. Until `AWIN_DATAFEED_API_KEY` is configured, mapped merchants automatically use their existing targeted/direct ingestion paths. Browser rendering is optional through `BROWSERLESS_CONTENT_URL` and is not bundled into the serverless application.
