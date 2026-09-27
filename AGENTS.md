# Repository agent workflow

- Check current `main`, open PRs and ongoing project work before editing shared files. Protect production changes and add follow-up edits to the relevant open PR instead of opening a conflicting PR.
- In temporary agent workspaces, treat the connected GitHub app as the authenticated write transport. Local `git fetch`, diff and tests can run without write credentials; do not attempt `git push` as the default write path or ask for a personal access token. Use the app's branch/blob/tree/commit/ref/PR operations, then fetch the remote branch to align local Git.
- Keep unfinished work in a draft PR. After full `pnpm run preflight` and review of deployment configuration, mark it ready for CI. Merge only after required checks pass; only `main` should deploy to production.
- Never put GitHub, Vercel, database or OpenAI credentials in the repository, shell output, PR body or workflow logs.
