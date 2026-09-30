# Claude Code instructions

@AGENTS.md

Project state, deployment flow and selection rules: `docs/AGENT_STATE.md` (English, compact) and `docs/HANDOVER.md` (German, operations). Update them when architecture, deployment, selection rules or required environment variables change.

- Full check before a PR is marked ready: `pnpm run preflight`.
- Only `main` deploys to Vercel Production; CI job `production-observability` verifies the merged SHA reached production.
- Brand whitelist and size target live in `config/profile.ts`; size labels are normalised in `lib/product-rules.mjs`.
