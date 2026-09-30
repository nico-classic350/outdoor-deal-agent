# Repository agent workflow

- Check current `main`, open PRs and ongoing project work before editing shared files. Protect production changes and add follow-up edits to the relevant open PR instead of opening a conflicting PR.
- In temporary agent workspaces, never ask for or store a personal access token. In Claude Code cloud sessions, `git push` to the session's designated branch goes through the session's git proxy. Where shell push is unavailable, use the connected GitHub app's branch/commit/PR operations, then fetch the remote branch to align local Git.
- Shops cannot always be reached from agent workspaces. Inspect the browser path with *Actions → Chromium browser crawl* (`diagnose=true`, read-only) instead of guessing shop markup.
- Keep unfinished work in a draft PR. After full `pnpm run preflight` and review of deployment configuration, mark it ready for CI. Merge only after required checks pass; only `main` should deploy to production.
- Never put GitHub, Vercel, database, OpenAI or Anthropic credentials in the repository, shell output, PR body or workflow logs.
