# Outdoor Deal Agent — durable handoff

This file is the compact source-of-truth handoff for future ChatGPT development sessions. It exists so development is not dependent on one long chat history.

## Production

- Repository: `nico-classic350/outdoor-deal-agent`
- Default branch: `main`
- Production: `https://outdoor-deal-agent.vercel.app`
- Hosting/runtime: Vercel + Node 24 + Next.js/TypeScript
- Database: Neon PostgreSQL
- CI: GitHub Actions `CI & Change Observability`
- `git.deploymentEnabled` uses `**: false` for non-main branches (including branches with `/`) and `main: true` for production. The old `*: false` rule did not cover slashed branches. Vercel may retain historical failed-preview records; future feature pushes should create no preview deployment.
- The connected GitHub app is the write path in short-lived Codex workspaces. Shell Git fetch works without credentials, but shell Git push may fail; do not try to persist a personal access token in the project or workspace. Create/update branches and PRs through the GitHub app, then fetch the remote branch locally. A personal terminal may use its own credential helper.

## Daily pipeline

- 91 registered shops
- batch size 6, expected batches 16
- batches persist to `agent_batch_runs`
- 16 recovery crons at 05:00 UTC rerun missing batches; retry finalizer at 07:00 UTC publishes `agent_runs` only after all batches are present
- `/api/health` is the production health and deployment-SHA source
- `/api/probe` replays current filtering/scoring against the latest complete stored batch snapshot without crawling shops

## Product selection

- men's long hiking/trekking trousers only
- hard brand whitelist is in `config/profile.ts`
- explicit incompatible evidence excludes; missing optional evidence does not
- target size W33/L32, W34/L32 acceptable; never > L32
- no rain/hardshell, winter/ski, zip-off, heavy alpine or loud designs
- confirmed deals require verified same-variant reference price, known shipping and purchasable W33/W34 with L32 maximum; otherwise review candidate
- deal qualification and scoring are deterministic TypeScript rules
- Mammut men's category is targeted; product cards are discovery data and carry no invented UVP

## Acquisition order

1. official feed/API where available
2. Awin product feed when configured
3. targeted retailer parsers
4. generic feed/sitemap/direct HTTP + JSON-LD/HTML
5. Browserless `/content` for JS-rendered pages
6. Browserless `/unblock` for 403/429
7. Browserless remote Playwright (`playwright-core`, CDP) for difficult rendered/interactive pages

No local Chromium or full Playwright browser binaries are bundled.

## Results and notification

- `/` displays confirmed deals, review candidates, source evidence and browser-local saved items.
- An optional consolidated email is sent once per complete run when `RESEND_API_KEY`, `DEAL_NOTIFY_FROM`, `DEAL_NOTIFY_TO` are set. No recipient address is hardcoded.
- Price history on the page uses finalized offer snapshots from up to 30 recent runs.

## Browserless environment variables

Never commit values. Supported names:

- `BROWSERLESS_API_TOKEN` (preferred) or `BROWSERLESS_TOKEN`
- `BROWSERLESS_BASE_URL` (defaults to Amsterdam shared cloud)
- `BROWSERLESS_UNBLOCK=false` to disable unblock
- `BROWSERLESS_PLAYWRIGHT=false` to disable remote Playwright
- optional `BROWSERLESS_PROXY`

Optional bounded LLM extraction pilot (off unless enabled):

- `OPENAI_API_KEY` (server-side only)
- `LLM_EXTRACTION_MODE=shadow` to observe results without publishing them; `active` is opt-in after review
- `LLM_EXTRACTION_SHOPS` (comma-separated; defaults to `mammut-eu`)
- `LLM_EXTRACTION_MODEL` (defaults to `gpt-6-luna`)

The pilot only runs after a rendered page was received and deterministic extraction returned no offers. It caps the request at 12 product candidates, 16,000 input characters, 1,800 output tokens and 6 seconds. It requires page evidence for extracted names and prices; listing pages never confirm size or availability. See the README's “LLM extraction pilot” section for its shadow-review and activation procedure.

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
