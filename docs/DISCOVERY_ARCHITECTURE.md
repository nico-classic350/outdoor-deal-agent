# High-yield product discovery

## Goal and guardrails

Maximize unique, relevant product observations per shop, not duplicate cards or
unrelated homepage products. Preserve the 40% discount threshold,
variant-level price evidence, source-domain and robots checks, and the
mandatory daily email. Missing size, shipping or return information is a
visible uncertainty, not a reason to exclude a deal.

## Data flow

1. **Source registry**: per-shop country, host, discovery adapter, tested sale/
   men's-trouser category URLs, feed availability and a request budget.
2. **Cheap discovery**: accessible merchant feeds first; then targeted
   sale/category listings and sitemaps. Score discovered URLs for relevance and
   deduplicate before fetching. Persist per-path attempt and product counts.
3. **Direct extraction**: parse listing cards, JSON-LD and embedded product
   state. Follow a bounded number of same-category pagination links. Collect
   product URLs, current prices and explicit discount evidence separately.
4. **Selective verification**: fetch high-discount product details, keep each
   price and reference tied to its exact variant; stock, size and delivery are
   enriched where possible without treating absent metadata as a veto.
5. **Browser escalation**: only when a relevant high-yield page needs rendering
   or a direct request is blocked. Reuse one session for bounded scrolling and
   pagination where the provider permits it. Stop on provider 401/429, enforce
   a per-day provider-session admission cap, and retain robots/domain restrictions. No CAPTCHA or
   authenticated-account bypass.
6. **Normalization and publication**: store rejection reasons, canonicalize
   product models and retain only evidenced discounts; email delivery stays mandatory.

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
fully qualified under the then-current rule. Six bounded detail-page requests
did not resolve size evidence. The user's revised rule allows those six
discounted candidates to qualify while displaying the missing size and costs.
The old/current price promotion is now enabled only when the same merchant
listing record pairs both fields. This historical pilot is not a new live
measurement. For 4camping, 174 raw observations had zero verified price evidence;
127 failed allowed-brand identification and 47 the discount-evidence check.

Next high-leverage work is accessible merchant feed onboarding, variant-aware
detail adapters with real availability, and a token-validated Browserless
pilot on a few otherwise empty shops. Each needs a separate bounded A/B test.
An invalid Browserless credential now opens a function-scoped circuit after
one provider 401, preventing the same bad token from being retried across
shops in that invocation. A database-backed UTC-day session-admission counter
now limits provider calls across independent invocations (default 0 since the Actions Chromium crawl). It
counts REST attempts and CDP connections conservatively, not the exact billed
Browserless units. A live token-validating pilot remains to be run after the
Production environment is confirmed deployed; no token value is logged.

## Relaxed-rule pilot, 29 September 2026

A read-only direct HTTP test batch of Bergzeit ran with Browserless and LLM
credentials deliberately unset, no Neon writes and no mail. It produced 27
raw observations (27 distinct URLs), 24 relevant and normalized trousers, and
six candidates above 40% with paired merchant old/current price evidence.
None of the 24 normalized offers had confirmed size. The prior size-required
rule would therefore publish zero of the six; the revised rule qualifies six
before the five-slot daily presentation cap. This compares the rule on one
current dataset, not two independent live crawls. The observed crawl had 19
direct requests, four request errors and HTTP 200/502, so the previous
29-offer pilot is not an exact same-time A/B baseline. Browserless did not
run, and the refreshed production credential's validity is not inferred from
this result.

## Operational update, 30 September 2026

Awin advertiser admission was declined; its feed path has been removed.
Today's 91-shop production batch produced 1,671 raw and 138 normalized offers
via direct/merchant paths. Browserless was configured but recovered zero shops:
72 of 73 shops that attempted a browser fallback recorded provider-auth
rejection, including HTTP 401 from `/unblock` and `/content`. The revised
health response exposes this distinction. Restoring the credential and
re-running a bounded pilot remains an open operation, not a completed test.
All recorded provider failures were HTTP 401 on the first real REST call of
each invocation (`/content` and `/unblock` alike); the circuit prevented
further calls. A bounded `/api/browser-check` now provides a one-request
credential verification before the next batch window.

## Open-source browser path, 30 September 2026

The Browserless free plan (1,000 units/month) was exhausted and is not
sustainable for ~55 browser-dependent shops. Rendering moved to a nightly
GitHub Actions job: `playwright-core` + Chromium on a free runner, running the
unchanged crawl pipeline for `config/browser-cohort.ts` with local-browser
escalation (shared browser, isolated context per page, images/fonts blocked,
3 concurrent shops, 90 s per shop). Results are stored as snapshots and merged
into the Vercel batches. The job has a built-in A/B mode (direct-only versus
direct + Chromium, same runner and time window). No measurement exists yet;
the first manual pilot run must establish whether it adds relevant products,
price evidence and deals, not merely raw cards. Blocked (403) shops are tried
with a plain browser only and are expected to remain largely blocked.
