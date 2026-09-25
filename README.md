# Outdoor Deal Agent

Personal crawler and scoring service for the outdoor-deal search.

## Production pipeline

The Vercel Hobby deployment uses a batched daily crawl. Each batch persists normalized offers and source coverage in Neon. The finalizer writes a consolidated run only after all expected batches exist.

## Deal quality gates

- Only eligible men's long outdoor trousers enter the shortlist; ski, winter, rain, zip-off, shorts and tights are rejected.
- A published deal requires a confirmed W33/W34 waist with inseam at most L32. Missing or ambiguous sizes remain review candidates with an explicit reason; a large discount alone cannot promote them to a deal.
- Offers with the same merchant and product URL are collapsed even when listing-card titles differ. Tracking parameters do not create extra products.
- The coverage report separates technical source status from screened, distinct and size-confirmed offers. A successful fetch does not imply usable deals.
- Listing cards are discovery evidence; the crawler does not infer live size availability from them. Only explicit variant sizes can confirm a match.

## Build quality

- Node and pnpm versions are pinned.
- CI installs with `pnpm install --frozen-lockfile`.
- TypeScript validation is enabled; build errors are not ignored.
- `scripts/prepare-build.mjs` extracts the legacy source archive into a staging directory and copies only explicit source files. The profile and deal-quality modules are tracked directly so a build cannot restore older acceptance rules. It never overwrites package, lockfile, Vercel or TypeScript configuration.
- Build overrides are checked before Next.js starts.
- Changes are validated on a preview branch before production.

## Runtime safeguards

- Monolithic full-crawl routes are retired because they exceed the Vercel Hobby function limit.
- Each source has a wall-clock budget and generic crawling has a URL cap.
- The heavy local Chromium fallback is removed from the serverless bundle. An external `BROWSERLESS_CONTENT_URL` can optionally enable browser rendering later.
- Batch writes are idempotent per date/index.
- Finalization is idempotent per run date and refuses to publish incomplete daily runs.
- A second finalizer cron retries one hour later if the first attempt ran before every batch was present.
- Read-only status endpoints use short CDN caching where appropriate.

## Optional Awin

Awin remains optional. Until `AWIN_DATAFEED_API_KEY` is configured, mapped merchants automatically use their existing targeted/direct ingestion paths.
