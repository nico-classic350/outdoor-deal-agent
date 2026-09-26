# Outdoor Deal Agent

Personal crawler and scoring service for the outdoor-deal search.

## Production pipeline

The Vercel Hobby deployment uses a batched daily crawl. Each batch persists normalized offers and source coverage in Neon. The finalizer writes a consolidated run only after all expected batches exist.

## Deal quality gates

- Only eligible men's long outdoor trousers enter the shortlist; ski, winter, rain, zip-off, shorts and tights are rejected.
- Missing size data does not suppress an otherwise strong deal. Unknown sizes remain visible as unverified; only explicit incompatible size evidence is a hard exclusion. Confirmed W33/W34 with inseam at most L32 still receives the highest size score.
- Offers with the same merchant and product URL are collapsed even when listing-card titles differ. Tracking parameters do not create extra products.
- The coverage report separates technical source status from screened, distinct and size-confirmed offers. A successful fetch does not imply usable deals.
- Listing cards are discovery evidence; the crawler does not infer live size availability from them. Only explicit variant sizes can confirm a match.

## Build quality

- Node and pnpm versions are pinned.
- CI installs with `pnpm install --frozen-lockfile`.
- `pnpm run preflight` prepares the archived source, validates deployment invariants, runs TypeScript, tests and a full Next.js build.
- TypeScript validation is enabled; build errors are not ignored.
- `scripts/prepare-build.mjs` extracts the legacy source archive into a staging directory and copies only explicit source files. The profile and deal-quality modules are tracked directly so a build cannot restore older acceptance rules. It never overwrites package, lockfile, Vercel or TypeScript configuration.
- `scripts/validate-config.mjs` prevents source-count / cron-count drift, accidental monolithic cron activation, missing cron authorization, browser-runtime regressions, Node/pnpm version drift, and accidental re-enabling of Vercel preview deployments.

## Release workflow

All non-`main` Git branches are blocked from automatic Vercel deployment. This is intentional: Vercel preview deployments previously failed before build start while provisioning integration resources, even though the exact same code passed GitHub CI and deployed successfully to production.

For every change:

```bash
pnpm install --frozen-lockfile
pnpm run preflight
```

Use an `internal-*`, `scratch-*` or `release-*` branch and open a pull request to `main`. GitHub CI is the pre-production gate and runs the same dependency install, configuration validation, TypeScript checks, tests and full Next.js build. Do not rely on Vercel Preview as a release gate for this project.

Only after the pull-request CI is green should the change be merged. Vercel automatically deploys only `main`, so Marketplace/database integration provisioning happens only for the production deployment instead of once per temporary branch.

The config guard requires `git.deploymentEnabled` to have `"*": false` and `"main": true`; CI fails if a future change weakens that rule.

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

Awin remains optional. Until `AWIN_DATAFEED_API_KEY` is configured, mapped merchants automatically use their existing targeted/direct ingestion paths. Prepared mappings currently include Bergfreunde, Bergzeit, SportScheck, Sport Bittl, engelhorn, INTERSPORT DE, DECATHLON DE, GALERIA, Hardloop, Breuninger, Blue Tomato and sportdeal24.
