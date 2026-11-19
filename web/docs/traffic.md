# Website traffic connector

Read-only. `GET /api/traffic` serves a normalized cache file. The server never calls Google.

## Data path

```
Search Console  ->  google-apis MCP (stdio, read tools only)  ->  scripts/deck_traffic.py
   ->  ~/.meshvault/status/traffic/traffic.json (0600)  ->  rust/src/traffic.rs  ->  GET /api/traffic
```

- Source: the already-authorized `google-apis` MCP server (`~/projects/google-apis-mcp`, enabled in the default Hermes profile, OAuth done by the owner on 2026-09-22). The producer spawns it over stdio with a minimal environment (PATH, HOME, XDG_CONFIG_HOME, LANG, LC_ALL only). It never opens the token or client file and creates no grant.
- Tools called: `list_search_console_sites`, `query_search_analytics` (totals, `row_limit=1`, `type=web`). Never `add_search_console_site` or `delete_search_console_site`.
- Composio `google_analytics` shows ACTIVE but Tanner's Composio policy (`composio-tanner-accounts.json`) has no verified account for it, so it is not used. Until an account is verified there is no `visits` source.
- Website inventory: the Search Console property list is the inventory of authorized domains. Verified 2026-09-30: 9 properties (6 owner, 3 unverified-user).

## Metrics are not interchangeable

- `organic_search_clicks` (provider `google_search_console`): Google Search clicks to the site over the window. Not total visits. Direct, referral, social and paid traffic are absent.
- `visits` is reserved for a provider that counts visits (for example GA4). No such provider is wired.
- The server refuses a mismatched provider/metric pair: value becomes `null`, status `unavailable`, error `provider and metric do not match`. The frontend should label a row by `metric`, never show the word "visits" for `organic_search_clicks`.

## Response

```json
{
  "status": "ok | partial | unavailable",
  "sites": [{
    "domain": "meshvault.ai",
    "provider": "google_search_console",
    "metric": "organic_search_clicks",
    "value": 4,
    "impressions": 161,
    "start_date": "2026-09-01",
    "end_date": "2026-09-28",
    "t": 1790756138,
    "status": "ok | no_data | unavailable",
    "error": "Search Console HTTP 403",
    "reason": "no_access | failed"
  }],
  "src": "~/.meshvault/status/traffic/traffic.json",
  "origin": "google-apis MCP > Search Console (read-only)",
  "t": 1790756139,
  "age": 106,
  "refresh": 86400,
  "stale": false,
  "window": {"start_date": "2026-09-01", "end_date": "2026-09-28"},
  "note": "organic_search_clicks are Google Search clicks, not total visits"
}
```

- `status`: `ok` every row ok; `partial` some rows ok; `unavailable` no row has data, or the cache is missing, oversize, unreadable, non-UTF-8, bad JSON or unknown schema (then `error` names why and `sites` is `[]`).
- Row `status`: `ok` has a number; `no_data` Search Console returned no rows; `unavailable` the query failed (`error` says why, briefly). `error` appears only when the row is not ok.
- Row `reason` (deck 2026-10-29) appears only on `unavailable` rows, in the 28-day `sites` and in `daily.sites`. `no_access`: Search Console answered 403 or `siteUnverifiedUser`, or the property is not listed (the owner adds or verifies it). `failed`: any other error (timeout, 5xx, malformed answer, run budget), which the next run retries. A producer file without `reason`, or with any other value, reads `failed`. `ok` and `no_data` rows never carry it.
- `value` and `impressions` are `null` when unknown. `0` means Search Console measured zero. Never render `null` as 0.
- `t` (top level) is the cache `generated_at`, falling back to file mtime; a time more than 10 min in the future is dropped (null, and `stale: true`). Row `t` is when that row was fetched.
- `stale`: age over 36 h, or no usable clock. Rows are still returned when stale; show the age.
- Search Console data lags about 2 days, so the default window ends 2 days before the run.
- Bounds: file read capped at 256 KiB and 2 s; at most 32 rows; strings stripped of control characters and clipped; in-memory cache 30 s. Route is cookie-authed like every other `/api/` route; POST is refused by the existing CSRF guard.

## Producer (hourly timer)

```bash
python3 scripts/deck_traffic.py --dry-run        # print, write nothing
python3 scripts/deck_traffic.py                  # write the cache
python3 scripts/deck_traffic.py --days 7 --lag 3
```

- Since 2026-10-10 it runs by itself: `scripts/install-traffic-feed` installs the script to `~/ops/bin/deck_traffic.py` and enables `deck-feed-traffic.timer` (hourly, `SuccessExitStatus=2` so an unverified property is a reading, not a failed unit). Before that it was manual and the deck showed readings 10 days old (owner feedback 2026-10-10, build 15: "Google search console needs to be live with all domains"). If the file is older than 36 h the deck still shows the truthful stale state.
- Daily goal rows (owner monitoring scope, 2026-10-29): `meshvault.ai`, `protocol-guide.com`, `pepgo.org`. `judgefinder.io` is no longer a daily row; it stays in the 28-day `sites` rows while Search Console lists it. `judgefinder.io` returns "property not verified" (verify ownership in Search Console) and `pepgo.org` has no Search Console property (add and verify one). Nothing in this code can or should work around that.
- Exit 0 all sites ok; 2 cache written but some sites unavailable (for example a 403 on an unverified property); 1 hard failure (MCP missing, list call failed, bad args), cache untouched.
- Each MCP call has a 25 s limit and the run a 120 s budget. A failed row is `null`, never 0.
- The write is atomic (temp file then rename), mode 0600, directory 0700.

## Known state on 2026-09-30

Live run, window 2026-09-01..2026-09-28: 6 of 9 properties returned numbers. `judgefinder.io`, `sandboxmentoloop.online` and `thefiredev.com` returned HTTP 403 because the account is only an unverified user there. Verify ownership in Search Console to fill them; nothing in this code can or should work around that.

## Tests

```bash
python3 -m unittest tests/test_deck_traffic.py -v     # producer, fake MCP server, no network
cd rust && cargo test --offline traffic                # normalizer, cache, /api/traffic route
```

## Extending

Add a provider by writing rows with its own `provider` and `metric` into the same schema-1 file (for example `ga4` + `visits`). Allowed pairs live in `metric_matches` in `rust/src/traffic.rs`. A domain can then have one row per provider; rows are de-duplicated on (domain, provider, metric).
