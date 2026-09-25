# Outdoor Deal Agent

Personal crawler and scoring service for the outdoor-deal search.

## Production pipeline

The Vercel Hobby deployment uses a batched daily crawl. Each batch persists normalized offers and source coverage in Neon. The finalizer writes a consolidated run only after all expected batches exist. The existing deal and scoring logic is unchanged.

## Build quality

- Node and pnpm versions are pinned.
- CI installs with `pnpm install --frozen-lockfile`.
- `pnpm run preflight` prepares the archived source, validates deployment invariants, runs TypeScript, tests and a full Next.js build.
- TypeScript validation is enabled; build errors are not ignored.
- `scripts/prepare-build.mjs` extracts the legacy source archive into a staging directory and copies only explicit source files. It never overwrites package, lockfile, Vercel or TypeScript configuration.
- `scripts/validate-config.mjs` prevents source-count / cron-count drift, accidental monolithic cron activation, missing cron authorization, browser-runtime regressions and Node/pnpm version drift.

## Release workflow

Unfinished work must use an `internal-*` or `scratch-*` branch. Those branches, plus the old `stabilize-agent` and `agent-test-run` branches, are blocked from Vercel deployment and do not trigger push CI.

Before any release branch is pushed, run:

```bash
pnpm install --frozen-lockfile
pnpm run preflight
```

Only a locally green `release-*` commit should be pushed. Open a pull request to `main`, require the PR CI and Vercel Preview to be green, then merge the exact tested commit. Production is deployed from `main`.

## Runtime safeguards

- Monolithic full-crawl routes are retired because they exceed the Vercel Hobby function limit.
- Each source has a wall-clock budget and generic crawling has a URL cap.
- The heavy local Chromium fallback is removed from the serverless bundle. An external `BROWSERLESS_CONTENT_URL` can optionally enable browser rendering later.
- Batch writes are idempotent per date/index.
- Finalization is idempotent per run date and refuses to publish incomplete daily runs.
- A second finalizer cron retries one hour later if the first attempt ran before every batch was present.
- `/api/health` checks database reachability and, after the daily grace window, treats missing batches or a missing finalized run as unhealthy.
- Read-only status endpoints use short CDN caching where appropriate.

## Optional Awin

Awin remains optional. Until `AWIN_DATAFEED_API_KEY` is configured, mapped merchants automatically use their existing targeted/direct ingestion paths.
