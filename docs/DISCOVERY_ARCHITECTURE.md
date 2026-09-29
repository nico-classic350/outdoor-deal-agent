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

## Clean-slate design

The crawler would be a separate, durable discovery pipeline. A small registry
defines merchant ownership, permission/robots policy, category/feed entry
points, parser version, currency and a daily request/unit allowance. Discovery
jobs emit URL candidates to a per-host queue with a canonical product identity
and an expiry. A scheduler orders these by measured marginal yield (new,
relevant products with evidence per request), not by raw HTML card count.

Feed and sitemap adapters run cheaply. Listing adapters discover explicit
pagination and product links, inspect structured state and retain provenance of
each price/discount. Product-detail workers verify only the promising
observations. A browser worker handles JavaScript-rendered, permitted pages
with a single bounded session per host; it can reuse a session for scrolling or
pagination, but stops on authentication, provider limits and poor yield. A
per-provider circuit breaker and daily unit ledger prevent a broken token from
being retried across all 91 shops. Browserless Playwright is one rendering
route, not a separate free allowance or an access-rights bypass.

All observations carry `shop, canonical URL, model, variant, observed at,
parser version, source URL, price, price evidence, stock/size evidence`. Raw
observations are immutable and deduplicated by canonical URL and variant;
normalization records every rejection reason. This preserves the distinction
between a high-volume, low-quality category and genuinely usable deals.

Workers checkpoint progress by shop/page and retry with idempotency keys.
They finish independently of the daily publication clock. Publication takes
the latest complete-enough snapshot, records missing/late shops explicitly,
then must send and confirm the email; a delayed crawler cannot silently mark a
production run successful without delivery. The current implementation is a
smaller per-shop Vercel Function pipeline, so this architecture is a migration
target, not a claim that durable queues or browser sessions already exist.

## Budget and measurement

- Prioritize requests by expected unique relevant products per second/unit.
- Compare baseline and candidate on the same fixed sources, environment and
  time window. Log requests, parsed raw observations, unique product URLs,
  relevant products, price evidence, normalized offers and error reasons.
- Browserless sessions are a scarce escalation path: REST, CDP and Playwright
  all consume the same account units; no blanket `/crawl` over 91 shops.
- Merchant requests use per-host concurrency, timeouts and robots checks.
  Respect access restrictions; no CAPTCHA solving, private-account scraping,
  rotating identities or proxy evasion as a volume strategy.
- An isolated test batch must never write `agent_batch_runs`, finalize a report
  or send mail. Only promote a candidate after direct tests and a live cohort
  show a useful gain without quality regression or provider overuse.

## Stages

1. Record a direct-only live baseline on a small fixed cohort in CI.
2. Test bounded category pagination and price evidence behind explicit flags,
   comparing both strategies in the same CI environment.
3. Promote only improvements, run the full preflight and production deployment
   checks; keep browser-intensive work gated on a working Browserless token.

## Test batch, 29 September 2026

The four-shop direct-only comparison (no Browserless, OpenAI, database writes or
email) used the same cohort and normalization code in consecutive CI steps.
It is a controlled short-run comparison, not a statistical forecast for 91
shops. A previous query-only pagination attempt yielded no change; public
Bergfreunde listing links use `/2/`, which the second attempt recognized.

| Metric, four shops | Baseline | Same-category pagination | Delta |
| --- | ---: | ---: | ---: |
| Raw observations | 486 | 489 | +3 |
| Unique product URLs | 449 | 452 | +3 |
| Relevant observations | 273 | 276 | +3 |
| Discount/reference evidence | 120 | 123 | +3 |
| Normalized observations | 103 | 106 | +3 |
| Direct network requests | 131 | 136 | +5 |

All three new observations were Bergfreunde products; the other three shops
were unchanged. The bounded pagination is enabled for Bergfreunde by default.
It is not a significant fleet-wide improvement and must not be described as
such. The daily production snapshot before this change was 1,619 raw offers,
88 normalized offers and two published deals across 91 shops; it is not
directly comparable to the isolated test because timing, shipping verification
and publication selection differ.

A separate Bergzeit evidence pilot found 29 raw offers with an old price in
merchant listing state. Explicit provenance converted 26 into normalized
offers, six above 40%, but zero had confirmed purchasable size and zero were
fully qualified. Six bounded detail-page requests did not resolve size
evidence. Therefore the old-price promotion was **not** enabled in production:
it would add uncertain near misses without improving the email's confirmed
deals. For 4camping, 174 raw observations had zero verified price evidence;
127 failed allowed-brand identification and 47 the discount-evidence check.

Next high-leverage work is merchant/affiliate feed onboarding, variant-aware
detail adapters with real availability, and a token-validated Browserless
pilot on a few otherwise empty shops. Each needs a separate bounded A/B test.
An invalid Browserless credential now opens a function-scoped circuit after
one provider 401, preventing the same bad token from being retried across
shops in that invocation; this does not substitute for correcting the token
or for a durable cross-invocation unit ledger.
