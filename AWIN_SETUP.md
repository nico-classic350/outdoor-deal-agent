# Awin Product Feed Integration

## Principle

Awin is a structured ingestion source only. It does not change deal qualification or scoring.

Existing deal logic remains authoritative:
- effective purchase basis = offer + mandatory shipping to Germany + known return cost + mandatory payment/FX fees
- effective discount uses verified MSRP/RRP
- qualified deal >= 40%
- Top >= 55%, Strong 45-54%, Good 40-44% only with high product fit
- score weights remain size 30 / product fit 25 / market advantage 20 / discount 15 / merchant 10

## Source priority

1. Retailer-owned official feed where available (currently Globetrotter)
2. Awin product data feed for mapped advertisers
3. Targeted retailer brand/category listings
4. Generic feed/sitemap/HTML/browser fallback

Mapped Awin advertisers:
- Bergfreunde DE: 14102
- Bergzeit DE/AT: 12557
- SportScheck DE: 14607

Awin URLs are used as data inputs. The agent emits the direct merchant product URL (merchant_deep_link), not the Awin tracking URL.

## Required environment variable

AWIN_DATAFEED_API_KEY

This is the Product Feed / Create-a-Feed datafeed key, not the Partner API OAuth token.

The key can be obtained in Awin from Toolbox -> Create-a-Feed by generating a standard product feed URL. Do not commit it to Git.

Set it in Vercel for Production (and Preview if testing). A redeploy is required after adding/changing it.

## Runtime behavior

The agent downloads the Awin Product Feed List and selects the mapped advertiser feed, preferring joined/approved and German feeds.

Awin fields used where available:
- merchant_deep_link
- product_name
- brand_name
- merchant/category fields
- search_price
- rrp_price
- delivery_cost
- currency
- colour
- size
- size_stock_status
- size_stock_amount
- in_stock / stock_status / stock_quantity
- product description/specifications
- product IDs / parent product IDs
- merchant image URL

Only in-stock, new, whitelist-brand long men's/unisex trousers enter the existing normalization pipeline.

For Awin, rrp_price is required before an offer can be used as a qualified deal. product_price_old is deliberately not promoted to MSRP/RRP.

## Email behavior

One complete search run -> exactly one consolidated email.
No per-shop email.
Email order:
1. up to 5 qualified deals under the existing score
2. if no deals, up to 3 near misses
3. detailed coverage/technical report for all attempted sources

Debug/test emails only when explicitly requested.
