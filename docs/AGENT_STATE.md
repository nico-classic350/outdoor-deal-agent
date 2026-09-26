# Outdoor Deal Agent — durable handoff

This file is the compact source-of-truth handoff for future ChatGPT development sessions. It exists so development is not dependent on one long chat history.

## Production

- Repository: `nico-classic350/outdoor-deal-agent`
- Default branch: `main`
- Production: `https://outdoor-deal-agent.vercel.app`
- Hosting/runtime: Vercel + Node 24 + Next.js/TypeScript
- Database: Neon PostgreSQL
- CI: GitHub Actions `CI & Change Observability`
- Non-main Vercel previews are disabled; only `main` deploys automatically.

## Daily pipeline

- 91 registered shops
- batch size 6, expected batches 16
- batches persist to `agent_batch_runs`
- finalizer publishes `agent_runs` only after all batches are present
- `/api/health` is the production health and deployment-SHA source
- `/api/probe` replays current filtering/scoring against the latest complete stored batch snapshot without crawling shops

## Product selection

- men's long hiking/trekking trousers only
- hard brand whitelist is in `config/profile.ts`
- explicit incompatible evidence excludes; missing optional evidence does not
- target size W33/L32, W34/L32 acceptable; never > L32
- no rain/hardshell, winter/ski, zip-off, heavy alpine or loud designs
- deal qualification and scoring are deterministic TypeScript rules

## Acquisition order

1. official feed/API where available
2. Awin product feed when configured
3. targeted retailer parsers
4. generic feed/sitemap/direct HTTP + JSON-LD/HTML
5. Browserless `/content` for JS-rendered pages
6. Browserless `/unblock` for 403/429
7. Browserless remote Playwright (`playwright-core`, CDP) for difficult rendered/interactive pages

No local Chromium or full Playwright browser binaries are bundled.

## Browserless environment variables

Never commit values. Supported names:

- `BROWSERLESS_API_TOKEN` (preferred) or `BROWSERLESS_TOKEN`
- `BROWSERLESS_BASE_URL` (defaults to Amsterdam shared cloud)
- `BROWSERLESS_UNBLOCK=false` to disable unblock
- `BROWSERLESS_PLAYWRIGHT=false` to disable remote Playwright
- optional `BROWSERLESS_PROXY`

For a read-only five-shop Browserless smoke test, set the token in the local shell and run `pnpm smoke:browser`. The default shops are Hervis, Sport Bittl, Mammut EU, Odlo EU and Arc’teryx EU; pass shop IDs to select others. It prints coverage and offer counts and never writes to Neon. Browserless requests may consume account credits. HTTP and browser requests share the source deadline; coverage records each browser stage and its elapsed time.

Health exposes only non-secret configuration state.

## Change workflow

For code changes:

1. branch from current `main`
2. use a draft PR while work is incomplete
3. mark ready only when the change is complete
4. require full `pnpm run preflight`
5. merge only on green CI
6. production-observability verifies the exact merged SHA, `/api/health`, registry and `/api/probe`
7. inspect stored GitHub workflow artifacts/logs on any failure before changing code again

## Starting a fresh ChatGPT chat

Ask the assistant to read `docs/AGENT_STATE.md`, then check current `main`, the latest GitHub CI run, Vercel deployment and `/api/health` before making changes. This is preferred over continuing an oversized historical chat.

Update this file whenever architecture, deployment flow, core selection rules or required environment variables change. Do not put credentials, tokens or personal data here.
