# E-commerce market feed (`house-feeds/ecom-market.json`, schema v1)

Changes (additive, still v1):
- 2026-11-15 (2): a move the evidence cannot carry is null with a reason, never printed and never capped.
  `watches.items[].change_7d` and `change_30d` are null, with new `change_7d_reason` and `change_30d_reason`, when the
  watch has under 10 listings now or in the window's first day (once stored), when the sample's typical pack count,
  volume or weight moved more than 25 % (once stored), or when the median moved more than 50 %. Movers leave out a
  stored-price move whose product changed its platform count between the two days, any stored-price or listing move
  beyond 80 %, and the shop collector's trend row of a watch whose change is held; each run logs the counts by reason
  (`ecom-market: moves not printed: ...`). A category that rests on the CPI month alone has `confidence` `{score: null,
  label: "official"}`; with no value, `{score: null, label: null}`. The history file gains `prices[].n` (platforms a
  day) and the series `watch_n` and `watch_sample`.
- 2026-11-15: category values are matched-panel changes and never blends. `platform_index` is no longer chained:
  each day is matched against the base day, and `change_7d`, `change_30d` count only products priced at both ends of
  the window (null under 10). New in `platform_index`: `panel_7d`, `panel_30d` (`{from, to, n}` or null) and
  `min_panel` (10). A category `value` covers one period: the store change when its panel holds (`basis`
  `platforms`, `measure` `change_30d` or the new `change_7d`), else the CPI month (`official_mom`); `blend` and
  `change_since_base` are no longer written, and `parts[]` holds only the part that carries the value (`weight` 1.0).
  Confidence compares store and official on one pace (a monthly rate) and by size. New `categories[].method` (the rule
  in one paragraph, for the Data sheet).
- 2026-11-15: `watches.items[].best` is a new-condition listing only and gains `condition`, `title`, `url`; new
  `best_used` (same fields, a used, refurbished, open-box or unknown-condition listing, or null) and `best_reason` (why
  `best` is null, or null); `detail.by_platform[].low` (that site's lowest listing).
- 2026-11-15: `bestsellers[].variants_n`: colourways of one product take one row (the best ranked) when brand and title
  match and their URLs share a handle stem of two or more tokens on one host (`mens-basic-tshirt-white`,
  `mens-basic-tshirt-meteorite-black`); a men's and a women's item of one name, or a row without a URL, stay apart.
  The count is the rows it stands for (1 for most). Every watch listing kept out of `best` is logged to stderr with its
  title (`ecom-market: watch <slug>: ...`).
- 2026-11-14 (2): `categories[].basis` (`platforms`, `official_mom`, `blend` or null) and `categories[].parts[].measure`
  (`change_30d`, `change_since_base`, `mom`). `categories[].period` now belongs to whatever carries the value: the CPI
  month (`2026-10`) when only the official part exists, `30 days to <day>` only when the platform index has a 30-day
  change, `<base> to <day>` before that, and `<platform period>; official <month>` for a blend.
- 2026-11-14 (2): `trending[].shopping` (bool) and `trending[].shopping_match` (the matched term or null); the page
  shows only `shopping: true` rows. `coverage.trending` and `coverage.trending_shopping`.
- 2026-11-14 (2): the collector prints `ecom-market: output dir <dir>; state <file>` as its first line; `--out` is an
  alias of `--out-dir`.

Writer: `scripts/deck-feed-ecom-market` with the stdlib package `scripts/ecom_market/`, hourly.
File: `~/.meshvault/status/house-feeds/ecom-market.json` (mode 600, written atomically), or `$DECK_FEED_DIR/ecom-market.json`
when that is set (staging). The shop collector's `ecom.json` beside it is unchanged, and `/api/ecom` still serves it.
Route: `GET /api/ecom-market`, owner only (the guest and desk viewers get 403). `rust/src/ecom_market.rs` passes the
contract keys through with its own bounds (depth 8, lists 1000, text 400 characters, credential-shaped keys dropped),
so the generic 200-row feed cap never trims it, and adds `src`, `t`, `age`, `stale` (age over 2x `refresh`) and
`error` when the file is missing or broken.

## Rules every section follows
- Every number has its period beside it (`period`, `as_of`, or the periods inside `hist`). Missing is `null`, never 0.
- Pages print no source names. A row names its source only by `source` id (macro, categories) or inside `detail`
  (products, watches). The Data sheet reads `sources[]`.
- Money is US dollars as a number. Percent values run 0 to 100. `change_pct` is a percent change.
- Ranks: 1 is best. `rank_change` and the `*_change_*` rank fields are positive when the item climbed.
- Watch and listing prices are asking prices, not sold prices.

## Example (real run 2026-11-14, trimmed; the computers row and the watch from the staged run of 2026-11-15)

```json
{"v": 1, "t": 1794706219, "generated_at": "2026-11-14T17:30:19-08:00", "refresh": 3600,
 "macro": [
  {"key": "ecom_share", "label": "Online share of retail", "group": "demand", "unit": "pct", "value": 17.1,
   "period": "2026-Q2", "prior": {"value": 17.0, "period": "2026-Q1"}, "change": 0.1, "change_unit": "pct_pts",
   "yoy": 0.8, "yoy_unit": "pct_pts", "cadence": "quarterly", "hist": [["2017-Q3", 8.9], ["2026-Q2", 17.1]],
   "source": "census_ecom", "note": null},
  {"key": "fedex_ground_fuel", "label": "FedEx Ground fuel surcharge", "group": "parcel", "unit": "pct", "value": 30.0,
   "period": "2026-11-16", "prior": {"value": 30.5, "period": "2026-11-09"}, "change": -0.5, "change_unit": "pct_pts",
   "yoy": null, "yoy_unit": null, "cadence": "weekly", "hist": [["2026-11-09", 30.5], ["2026-11-16", 30.0]],
   "source": "fedex_fuel", "note": null}],
 "platforms": [
  {"rank": 3, "name": "Amazon", "domain": "amazon.com", "kind": "marketplace", "score": 0.667,
   "signals": {"tranco_rank": 29, "tranco_period": "2026-11-14", "tranco_change_30d": null, "app_rank": 7,
               "app_period": "2026-11-14", "app_change_7d": null, "radar_rank": null},
   "price_coverage": "blocked", "price_detail": {"n_24h": 1608, "last_ok": 1794637427, "sources": ["shop_amazon"]},
   "note": null}],
 "bestsellers": [
  {"gid": "steam:2406770", "id_basis": "steam", "title": "Bodycam", "brand": null, "category": "games", "kind": "bestseller",
   "rank": 1, "rank_change": null, "price": {"median": 26.65, "low": 26.65, "high": 26.65}, "platforms_n": 1,
   "change_pct": null, "as_of": "2026-11-14",
   "detail": {"offers": [{"platform": "Steam", "price": 26.65, "regular": 33.32, "discount_pct": 20.0, "rank": 1,
              "url": "https://store.steampowered.com/app/2406770", "as_of": "2026-11-14", "source": "steam_store"}]}}],
 "movers": [
  {"gid": "shoplisting:1ec07768c922", "id_basis": "catalog_id", "title": "ASUS PRIME RTX 5080 16GB OC Edition",
   "category": "computers", "kind": "under_median", "rank": null, "rank_change": null,
   "price": {"median": 1900.0, "low": 1900.0, "high": 1900.0}, "platforms_n": 1, "change_pct": -26.6,
   "period": "7 days to 2026-11-14", "as_of": "2026-11-14",
   "detail": {"offers": [{"platform": "Facebook Marketplace", "price": 1900.0, "reference": 2588.0,
              "source": "shop_facebook-marketplace"}]}}],
 "categories": [
  {"key": "computers", "label": "Computers and parts", "value": 0.55, "unit": "pct", "basis": "official_mom", "period": "2026-10",
   "parts": [{"kind": "official", "source": "bls_cpi", "series": "CUSR0000SEEE01", "value": 0.55, "period": "2026-10",
              "measure": "mom", "weight": 1.0}],
   "confidence": {"score": null, "label": "official", "reasons": ["official monthly figure; store prices too few to cross-check it",
                                                                  "5 products, 5 priced at both ends of 7 days; a change needs 10"]},
   "method": "Store prices: geometric mean of price ratios of products priced at both ends of the window ...",
   "platform_index": null,
   "official": {"source": "bls_cpi", "series": "CUSR0000SEEE01", "label": "Consumer prices, computers", "value": 38.761,
                "period": "2026-10", "mom": 0.55, "yoy": null, "hist": [["2026-10", 38.761]]},
   "sales": {"source": "census_retail", "series": "RSEAS", "label": "Electronics store sales", "value": 7853.0,
             "unit": "usd_m", "period": "2026-09", "mom": 0.6, "yoy": 9.39}}],
 "watches": {"as_of": "2026-11-14", "window_days": 7, "items": [
  {"slug": "rtx-4080", "label": "rtx 4080", "category": "computers", "median": 1200.0, "ci": {"lo": 1049.99, "hi": 1300.0},
   "n": 26, "sites_ok": 3, "sites_expected": 6, "change_7d": -14.29, "change_30d": null,
   "best": null, "best_reason": "no new listing passed the price checks; the lowest is refurbished",
   "best_used": {"price": 879.99, "platform": "Newegg", "condition": "refurbished",
                 "title": "GIGABYTE AORUS GeForce RTX 4080 16GB GDDR6X PCI Express 4.0 ATX Graphics Card GV-N4080AORUSX W-16GD",
                 "url": "https://www.newegg.com/gigabyte-gv-n4080aorusx-w-16gd-geforce-rtx-4080-16gb-graphics-card-liquid-cooler/p/N82E16814932558T"},
   "period": "2026-11-08 to 2026-11-14",
   "confidence": {"score": 0.68, "label": "medium", "reasons": ["3 of 6 sites", "26 listings", "sites agree within 21%"]},
   "interest": {"views": 2136, "period": "2026-10", "change_pct": -20.36},
   "hist": [["2026-11-03", 905.8], ["2026-11-14", 900.0]],
   "detail": {"by_platform": [{"platform": "Newegg", "median": 899.99, "low": 879.99, "n": 16, "source": "shop_newegg"}]}}]},
 "trending": [{"rank": 1, "title": "north texas vs utsa", "traffic": "1000+", "as_of": "2026-11-14T17:10:00-08:00",
               "shopping": false, "shopping_match": null}],
 "sources": [
  {"id": "census_ecom", "name": "Quarterly e-commerce retail sales", "publisher": "US Census Bureau (via FRED)",
   "kind": "official", "group": "macro", "status": "ok", "reason": null, "key_env": null, "as_of": "2026-Q2",
   "count": 214, "checked_at": 1794706212, "homepage": "https://www.census.gov/retail/ecommerce.html"},
  {"id": "ebay_browse", "name": "eBay Browse API", "publisher": "eBay", "kind": "api", "group": "prices",
   "status": "needs_key", "reason": "needs EBAY_CLIENT_ID and EBAY_CLIENT_SECRET",
   "key_env": ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"], "as_of": null, "count": 0, "checked_at": 1794706212,
   "homepage": "https://developer.ebay.com/api-docs/buy/browse/overview.html"},
  {"id": "keepa", "name": "Keepa API (Amazon price and rank history)", "publisher": "Keepa", "kind": "paid",
   "group": "prices", "status": "refused", "reason": "Paid service, not bought (EUR 49 a month)", "key_env": null,
   "as_of": null, "count": 0, "checked_at": null, "homepage": "https://keepa.com/#!api", "price": "EUR 49 a month"}],
 "coverage": {"ok": 30, "stale": 1, "needs_key": 6, "refused": 29, "error": 0, "sources_total": 66, "ok_keyless": 30,
              "paid": 4, "macro_series": 28, "platforms": 42, "platforms_priced": 11, "bestsellers": 172, "movers": 112,
              "products_tracked": 1557, "merged_products": 0, "categories": 8, "watches": 13, "trending": 10,
              "trending_shopping": 0},
 "errors": [{"source": "shop_gamestop", "reason": "no listings read in 24 h"}]}
```

## Fields

### Top level
`v` (1), `t` (epoch seconds the run finished), `generated_at` (same, ISO 8601 with offset), `refresh` (3600),
`macro[]`, `platforms[]`, `bestsellers[]` (up to 400), `movers[]` (up to 100 per kind), `categories[]`, `watches{}`,
`trending[]` (up to 20: `rank`, `title`, `traffic`, `as_of`, `shopping`, `shopping_match`), `sources[]`, `coverage{}`,
`errors[]` (`{source, reason}` for every `error` or `stale` source).

`trending[].shopping` is true only when the title contains, as whole words and case-insensitive, a shopping event or
deal word (`black friday`, `cyber monday`, `prime day`, `deals`, `sale`, `coupon`, `discount`, `clearance`, `restock`,
`preorder`, `price drop`, `gift guide`, `doorbuster` and a few more) or a store name that is not also an everyday word
(Amazon, Walmart, Costco, Best Buy, eBay, Etsy, Temu, SHEIN, Home Depot, Lowe's and others; Target, Shop and Steam are
left out). `deal` alone (trade deal) and `sales` (home sales) do not count. The full list is `SHOPPING_TERMS` in
`scripts/ecom_market/sources_market.py`. Anything else is false.

### `macro[]`
| Field | Meaning |
|---|---|
| `key` | `ecom_share`, `ecom_sales`, `retail_sales`, `nonstore_sales`, `eshop_sales`, `pce_goods`, `sentiment`, `cpi_core_goods`, `cpi_durables`, `import_prices`, `ppi_truckload`, `cass_shipments`, `cass_spend`, `diesel`, `freight_tsi`, `container_wci`, `container_sha_la`, `container_sha_ny`, `ppi_parcel`, `fedex_ground_fuel`, `fedex_express_fuel`, `usps_priority_env`, `usps_small_box`, `usps_medium_box`, `usps_large_box`, `port_la_teu`, `port_la_imports`, `trade_notices`; with a BLS key also `avg_eggs`, `avg_bread`, `avg_milk`, `avg_coffee`, `avg_bananas`. |
| `label` | Plain words, sentence case. |
| `group` | `demand`, `prices`, `freight`, `parcel`, `ports`, `policy` (rows come in that order). |
| `unit` | `pct`, `usd`, `usd_m` (millions), `usd_b` (billions, annual rate), `index`, `usd_gal`, `usd_feu` (per 40 ft box), `teu`, `count`. |
| `value`, `period` | Latest value and the publisher's period: `2026-10`, `2026-Q2`, or a day for weekly and page values. |
| `prior` | `{value, period}` of the observation before, or null. |
| `change`, `change_unit` | Change against `prior`: `pct_pts` for percent series, else `pct` (percent change). Drewry carries its own published weekly change. |
| `yoy`, `yoy_unit` | Against the same period a year earlier. Null when that period was never published (October 2025 CPI) or the page gives none. |
| `cadence` | `weekly`, `monthly`, `quarterly`, `daily`, `on change`. |
| `hist` | `[[period, value]]`, oldest first, up to 36. Page values (container rates, USPS, port, fuel) build their history run by run. |
| `source` | Row id in `sources[]`. |
| `note` | One plain sentence or null (not seasonally adjusted, the latest notice title). |

### `platforms[]`
`rank`, `name`, `domain`, `kind` (`marketplace`, `retailer`, `resale`, `brand`, `grocery`), `score` (0 to 1: the mean of
the signals the platform has, each `1 - log10(rank) / log10(N)` with N = 1,000,000 for Tranco and Radar and 101 for the
App Store top 100; a platform with an App Store id that is not in the top 100 scores 0 on that signal; null when it has
no signal, listed last), `signals` (`tranco_rank`, `tranco_period`, `tranco_change_30d`, `app_rank`, `app_period`,
`app_change_7d`, `radar_rank`; changes are null until the writer has the earlier day stored), `price_coverage`
(`ok` the Deck reads prices there now, `blocked` the site walls reads, `needs_key` a free key would open it, `none`),
`price_detail` (`n_24h`, `last_ok`, `sources`), `note` (Facebook Marketplace has no rank signal of its own).
Tranco ranks are global domains and the chart is the US App Store: a board order, not market share.

### Products: `bestsellers[]` and `movers[]`
| Field | Meaning |
|---|---|
| `gid`, `id_basis` | Merged identity. Strongest first: `gtin:<14 digits>` (`gtin`, check digit verified), `steam:<appid>` (`steam`), `bm:<brand>:<model>` (`brand_model`), the platform's catalog id such as `shopify:<host>:<id>`, `scryfall:<oracle id>`, `shoplisting:<hash>`, `watch:<slug>` (`catalog_id`), `title:<words>` (`title`). A brand plus model offer joins the GTIN product that states the same brand and model. |
| `title`, `brand`, `category` | `category` is a `categories[].key` or null. |
| `kind` | `bestseller`; movers: `price_drop`, `price_rise` (5 % to 80 % against our stored price 1 to 8 days back, and only when the product had the same number of platforms on both days), `on_sale` (10 % or more under the platform's own regular price), `rank_gain` (5 places or more), `under_median` (a listing under the cross-site median, from the shop collector). A listing drop from the shop collector beyond 80 % and the trend row of a watch whose 7-day change is held are left out. |
| `rank`, `rank_change` | Best rank across platforms and the change since the last stored day. |
| `price` | `{median, low, high}` across platforms (one price per platform, its lowest). |
| `platforms_n` | Platforms carrying it after the merge. |
| `variants_n` | Best sellers only: rows of the same brand and title whose URLs share a handle stem on one host (colourways) that this row stands for; 1 when alone. |
| `change_pct`, `period`, `as_of` | The move, its window, the day of the prices. |
| `detail.offers[]` | `platform`, `price`, `regular`, `discount_pct`, `rank`, `url`, `as_of`, `source`, and `n` (listings behind a median) or `reference` (the median a listing is compared with). The only place a price names where it came from. |

### `categories[]`
`key`, `label` (`computers`, `electronics`, `home`, `apparel`, `beauty`, `games`, `music`, `collectibles`, `outdoors`,
`grocery`), `value` (price change in percent over one period, or null; never a blend of two periods), `basis`
(`platforms`: the store matched-panel change; `official_mom`: the CPI one-month change, used only when the store panel
does not hold; null with neither), `period` (of the value: `30 days to <day>` or `<from> to <day>` for the store change,
the CPI month for `official_mom`), `parts[]` (the one part that carries the value: `platforms` with `value`, `period`,
`measure` (`change_30d` or `change_7d`), `n_products` and `n_platforms` of the matched panel, `weight` 1.0; or
`official` with `source`, `series`, `value`, `period`, `measure` `mom`, `weight` 1.0), `confidence` (`{score, label,
reasons}`; 0.4 matched products (full at 30) + 0.3 sites in the panel (full at 4) + 0.3 agreement; agreement puts the
store change on a monthly pace, `(1 + c)^(30.44 / days) - 1`, and compares it with the CPI month: within 1 point 1.0,
the same direction and under 3 times apart (a move under 0.25 points counts as 0.25) 0.6 with the score capped at 0.74,
else 0 with the score capped at 0.49; no official series 0.5; high 0.75+, medium 0.5+. A value that rests on the CPI
month alone has `score` null and `label` `official` (plain words for a page: "Official monthly figure"); no value has
both null), `method` (that rule in words, at most 400 characters),
`platform_index` (store index, never chained: `value` against 100 at `base_period` (the first day with 10 products
priced), each day the geometric mean of the price ratios of the products priced on both the base and that day, ratios
outside 0.5 to 2 skipped as broken prices, a day with under 10 such products has no point; `last_period`, `change_7d`,
`change_30d` (matched panels: products priced at both ends of the window, null under 10), `panel_7d`, `panel_30d`
(`{from, to, n}` or null), `min_panel` (10), `span_days`, `n_products`, `n_platforms`, `hist`; null until 10 products
have two stored days), `official` (CPI series: `source`, `series`, `label`, `value`, `period`, `mom`, `yoy`, `hist`),
`sales` (Census retail sales for the matching store type, `usd_m`, `period`, `mom`, `yoy`, or null).

### `watches`
`as_of`, `window_days` (7), `items[]` from the shop collector feed: `slug`, `label`, `category`, `median` (median of the
per-site medians), `ci {lo, hi}` (25th and 75th percentile of the per-site medians, null with one site), `n`,
`sites_ok`, `sites_expected`, `change_7d`, `change_30d` (percent, from the collector's daily medians; null when the
evidence cannot carry it: under 10 listings now or on the window's first day, the sample's typical pack count, volume
or weight moved more than 25 %, or a move beyond 50 %), `change_7d_reason`, `change_30d_reason` (why, else null), `best {price,
platform, condition, title, url}` (the shop collector's lowest believable listing, new condition only), `best_used`
(same fields: when no new listing qualifies, the lowest used, refurbished, open-box or unknown-condition one, else
null), `best_reason` (why `best` is null, else null). When the watch query names a size or pack (`1 l`, `12 oz`,
`12 pack`) and the listing states another in the same measure (5 % tolerance), it is a different item and fills
neither; a listing that states no size is kept. `period`, `confidence {score, label, reasons}` (0.35 site coverage +
0.25 sample size + 0.20 agreement + 0.10 freshness + 0.10 history days), `interest {views, period, change_pct}`
(Wikipedia, last full month), `hist` (daily median, up to 45 days), `detail.by_platform[]` (`platform`, `median`,
`low`, `n`, `source`). With eBay keys the eBay median joins `by_platform`.

### `sources[]`
`id`, `name`, `publisher`, `kind` (`official`, `api`, `rank`, `page`, `catalog`, `collector`, `site`, `paid`), `group`,
`status`, `reason`, `key_env` (env names or null), `as_of`, `count` (rows read this run), `checked_at`, `homepage`,
`price` (paid rows only). `status`: `ok`; `stale` (served from cache after a failed refresh, or a collector lane with no
listings in 24 h); `needs_key` (reason names the env vars); `refused` (terms, robots or a bot wall bar automated reads,
or a paid service; the reason says which; never called); `error` (failed with no usable copy).

### `coverage`
`sources_total`, `ok`, `ok_keyless`, `stale`, `needs_key`, `refused`, `error`, `paid` (part of `refused`),
`macro_series`, `platforms`, `platforms_priced`, `bestsellers`, `movers`, `products_tracked`, `merged_products`
(products on 2+ platforms), `categories` (with a value or an index), `watches`, `trending`, `trending_shopping`.

## Sources (2026-11-14)
- Keyless, live: FRED-hosted official series grouped by publisher (Census quarterly e-commerce, Census advance retail,
  BLS CPI, BLS import prices, BLS PPI freight and parcel, BEA PCE goods, EIA diesel, Cass Freight Index, University of
  Michigan sentiment, BTS freight index), App Store top free shopping chart, Tranco list, Google Trends RSS, Wikipedia
  page views, six Shopify store catalogs and their best-seller collections, Steam top sellers and specials, Reverb
  listings, Scryfall card prices, Drewry World Container Index, FedEx fuel surcharges, USPS Notice 123, Port of Los
  Angeles, Federal Register trade notices, and the shop collector's per-site lanes (Walmart, Best Buy, Newegg, Craigslist,
  Poshmark, OfferUp, Facebook Marketplace, plus walled and quiet lanes reported as such).
- Free keys (`needs_key` until set): `EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET`, `BESTBUY_API_KEY`, `ETSY_API_KEY`
  (`keystring:shared_secret`), `CENSUS_API_KEY`, `BLS_API_KEY`, `CLOUDFLARE_API_TOKEN`. Read from the environment, then
  `~/.hermes/.env`. Values are never logged. OAuth tokens and Best Buy rows are not cached on disk.
- Refused (listed, never called): Amazon, Walmart best sellers, eBay and Etsy site pages, Target, Home Depot, Lowe's,
  Wayfair, Chewy, Mercari, Temu, SHEIN, TikTok Shop, Google Shopping, Google Play charts, UPS fuel page, Port of Long
  Beach, CamelCamelCamel, CheapShark (robots.txt disallows its API path), Amazon search suggestions.
- Paid (price only): Keepa EUR 49 a month, Rainforest $23 to $83 a month, DataForSEO $50 minimum top-up, Similarweb
  about $15,000 a year.

## Run, cache and install
- One run reads every source in a thread pool of 6, at most 2 requests a second to one host, inside a 270 s budget
  (`--budget`). A warm run takes seconds; the first cold run about 20 s. Downloads cache under
  `~/.cache/deck-data/ecom_<source id>/` with conditional requests and per-source ages (50 minutes for charts, 6 to 20
  hours for statistics and catalogs). Its own memory (daily product prices and ranks, daily Tranco and chart ranks, page
  values) is `~/.local/state/deck-ecom-market/history.json` (`--state`, `$DECK_ECOM_STATE`), pruned to 45 days.
- Staging: `python3 scripts/deck-feed-ecom-market --out /tmp/x --state /tmp/x/h.json` (flags first; `$DECK_FEED_DIR`
  and `$DECK_ECOM_STATE` are the fallback). The first output line names the resolved output dir and state file: check
  it before trusting a staged run.
- Install: copy `scripts/deck-feed-ecom-market` to `~/ops/bin/` (mode 755) and `scripts/ecom_market/` to
  `~/ops/lib/ecom_market/`; copy `scripts/systemd/deck-feed-ecom-market.service` and `.timer` to
  `~/.config/systemd/user/`; `systemctl --user daemon-reload && systemctl --user enable --now deck-feed-ecom-market.timer`
  (hourly, first run 6 minutes after boot). Roll back: disable the timer, remove the two units, the script and the package.
- Tests: `python3 -m unittest tests.test_ecom_market_parsers tests.test_ecom_market_merge tests.test_ecom_market_states`
  (fixtures in `tests/fixtures/ecom_market/`, real excerpts saved 2026-11-14; the key-gated parsers use the APIs'
  documented shapes) and `cargo test --locked ecom_market` in `rust/`.
