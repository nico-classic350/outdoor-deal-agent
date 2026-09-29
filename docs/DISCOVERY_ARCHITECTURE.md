# High-yield product discovery

## Goal and guardrails

Maximize unique, relevant product observations per shop, not duplicate cards or
unrelated homepage products. Preserve the 40% effective-discount threshold,
variant-level price/size evidence, source-domain and robots checks, and the
mandatory daily email. Never treat an unverified reference price as a deal.

## Data flow

1. **Source registry**: per-shop country, host, discovery adapter, tested sale/
   men's-trouser category URLs, feed availability and a request budget.
2. **Cheap discovery**: authorized merchant/affiliate feeds first; then targeted
   sale/category listings and sitemaps. Score discovered URLs for relevance and
   deduplicate before fetching. Persist per-path attempt and product counts.
3. **Direct extraction**: parse listing cards, JSON-LD and embedded product
   state. Follow a bounded number of same-category pagination links. Collect
   product URLs, current prices and explicit discount evidence separately.
4. **Selective verification**: fetch high-discount product details, keep each
   price and reference tied to its exact variant, verify stock and delivery.
5. **Browser escalation**: only when a relevant high-yield page needs rendering
   or a direct request is blocked. Reuse one session for bounded scrolling and
   pagination where the provider permits it. Stop on provider 401/429, enforce
   a per-day unit budget, and retain robots/domain restrictions. No CAPTCHA or
   authenticated-account bypass.
6. **Normalization and publication**: store rejection reasons, canonicalize
   product models and retain only validated deals; delivery stays mandatory.

## Budget and measurement

- Prioritize requests by expected unique relevant products per second/unit.
- Compare baseline and candidate on the same fixed sources, environment and
  time window. Log requests, parsed raw observations, unique product URLs,
  relevant products, price evidence, normalized offers and error reasons.
- Browserless sessions are a scarce escalation path: REST, CDP and Playwright
  all consume the same account units; no blanket `/crawl` over 91 shops.
- An isolated test batch must never write `agent_batch_runs`, finalize a report
  or send mail. Only promote a candidate after direct tests and a live cohort
  show a useful gain without quality regression or provider overuse.

## Stages

1. Record a direct-only live baseline on a small fixed cohort in CI.
2. Add bounded category pagination and better URL selection behind an explicit
   strategy flag, then rerun both strategies in the same CI environment.
3. Promote only improvements, run the full preflight and production deployment
   checks; keep browser-intensive work gated on a working Browserless token.
