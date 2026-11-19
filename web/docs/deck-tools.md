# Deck tools: read-only audit CLI and Hermes plugin candidate

Reusable, read-only audit of the running Pixel Deck. Counts, status, source and time only. Nothing here changes the deck, the config, a service or a cron job.

## Files

| Path | Role |
|---|---|
| `scripts/deck_audit.py` | Engine and CLI. Fixed GET allowlist, loopback `127.0.0.1:8796`. |
| `integrations/hermes-plugin/` | Native Hermes directory plugin source (`plugin.yaml`, `__init__.py`). Installed and enabled in Tanner default on 2026-09-30; tool availability is deferred to new sessions. |
| `tests/test_deck_audit.py` | Safety, sanitizing, failure modes, audit (including v6 feeds), mock and real-SDK plugin registration. |
| `scripts/deck-launch` | Launch action runner, installed as `~/ops/bin/deck-launch` (see "Launch action" below). |
| `tests/test_deck_launch.py` | deck-launch validation, prompts, secret handling, and the read-only `status` view against a fake loopback gateway. |
| skill `omarchy-deck-ops` | Default Hermes profile skill: how to use these tools and the boundaries. |

## CLI

```bash
python3 scripts/deck_audit.py today     # gateway, mail unread counts, cron counts, markets headline counts, WHOOP presence
python3 scripts/deck_audit.py traffic   # per-site status, organic search clicks, window, timestamp
python3 scripts/deck_audit.py cams      # ready and reader counts per camera
python3 scripts/deck_audit.py sites     # site uptime counts
python3 scripts/deck_audit.py audit     # liveness, auth enforced, read routes, freshness, served-vs-disk assets
# options: --timeout SECONDS (clamped 0.5-10), --pretty
```

Output is one JSON object: `tool`, `status`, `source` (the exact GET), `t`/`at` (probe time), `http`, `latency_ms`, `data` or `reason`.
Exit: 0 `ok`, 2 `partial`, 1 anything else.

### Status words

| status | Meaning | Never means |
|---|---|---|
| `ok` | 200 and every part healthy | |
| `partial` | 200 but some sections/rows/cameras missing, stale or not ready | |
| `auth_failed` | 401/403, or the local cookie file is unreadable or malformed | zero data |
| `unavailable` | no answer, timeout, 5xx, or the deck reported the source as unavailable | zero data |
| `route_missing` | 404/405: the running binary lacks the route (embedded code is older than the source) | zero data |
| `bad_reply` | 200 with an unexpected shape or non-JSON | zero data |

A null value stays null. A measured `0` stays `0`. A failed row never becomes `0`.

## Safety model

- GET only. The code contains no POST. There is no `--url`, `--host` or `--port`; unknown options exit 2.
- Host `127.0.0.1` and port `8796` are constants. `LoopbackTransport` refuses paths outside `ALLOWED_GET` (public assets, Today and v6 reads, Crons and Fleet board, plus the exact probes below). The only permitted query is fixed `?name=bogus` on `/api/unit`; no user input enters it. `?t=` bootstrap, `/api/cam` (snapshot image), `/api/camkey`, `/api/keys`, `/api/launch-item` and `/cam/` streams are unreachable.
- Credential: the deck cookie value is read from `~/.config/pixel-deck/token` (same service, same file the deck reads) at request time. It goes only into the `Cookie` request header to loopback. It is not printed, logged, put in a URL, written to disk or accepted as an argument. The token must match `[A-Za-z0-9_-]{8,256}`, which also blocks header injection. `render()` replaces any output that contains the token, `pdeck=` or an `@` with a withheld notice.
- Sanitizing: every response is rebuilt from a field allowlist. Dropped on purpose: mail addresses, subjects, bodies, headline titles, cron job names, WHOOP values (only which metrics are present), camera keys and URLs, row error text.
- `audit` sends `/healthz`, `/api/today` and static assets without a cookie where the deck serves them publicly, and `/api/today` without a cookie once to prove 401 is enforced.
- Plugin handlers take no useful arguments: `args` and all dispatcher kwargs are ignored, so no caller input reaches a request.

## What `audit` checks

1. `liveness`: `/healthz` answers `ok`.
2. `auth_enforced_without_cookie`: `/api/today` answers 401 with no cookie.
3. `read_today|cams|traffic|sites`: each route returns usable data (else the exact status word).
4. `today_<section>_fresh`: section timestamp within 1800 s.
5. `feed_<name>`: each v6 feed route answers 200, the file exists (else the error word and the path), and it is fresh within 2x the collector's own `refresh`. Failed parts are counted in the detail. A missing or stale feed fails with its reason, so the audit reports `partial`, never zero data.
6. `embedded_<file>`: SHA-256 (first 12 hex) of the served `/`, `/app.js`, `/deck.js`, `/pad.js`, `/sw.js` versus `static/` on disk. The Rust binary embeds these with `include_bytes!` at compile time, so a mismatch means the disk edit is not live.
7. New action routes: a GET to each POST route must answer 405. `/api/unit?name=bogus` must answer 400 or 404. The audit never sends a POST.

A `route_missing` or `embedded_*` failure is fixed only by `cargo build --release` in `rust/`, installing the binary, and an approved restart of the deck service. The audit never does that.

## Hermes plugin candidate

`integrations/hermes-plugin/` is a native directory plugin (SDK: `hermes_cli/plugins.py`, `PluginContext.register_tool(name, toolset, schema, handler, ...)`). Handlers are `handler(args, **kwargs) -> str` returning JSON, per the plugin developer guide.

| Tool | Engine call |
|---|---|
| `deck_today` | `today` |
| `deck_traffic` | `traffic` |
| `deck_cameras` | `cams` |
| `deck_sites` | `sites` |
| `deck_endpoint_audit` | `audit` |

Toolset `pixel_deck`. Empty parameter schema with `additionalProperties: false`. No hooks, commands, env requirements or overrides.

The engine is loaded from `<plugin>/../../scripts/deck_audit.py`, else `~/projects/meshvault/pixel-deck/scripts/deck_audit.py`. If the plugin is copied elsewhere, keep one of those paths valid or the tools return `unavailable` (`plugin error: FileNotFoundError`).

### Install and activation

Owner approved with `go` on 2026-09-30. Copied to `~/.hermes/plugins/pixel-deck-readonly`, enabled with no tool override. CLI reported tools deferred to the next session, without a gateway restart. Installed-tree native SDK dispatch verified all five readers against the live Deck at 09:35:57Z. Live endpoint audit: 15 pass, 0 fail. The steps below describe future reinstalls, which require fresh approval.

1. Run the plugin scanner/approval the fleet requires for a new plugin.
2. Symlink or copy `integrations/hermes-plugin` to `~/.hermes/plugins/pixel-deck-readonly`.
3. Enable it in the default profile only, then start a new session (tool lists are read at session start).

Rollback: disable the plugin entry and remove the directory or symlink.

## Launch action

The Launch page sends `POST /api/launch-item?id=<kind>:<slug>&target=hermes` (v8: the OMP target is retired) after a second tap.

Server (`rust/src/launch.rs`):

1. Same cookie and CSRF guard as every other POST.
2. `id` must match `^(skill|mcp|tool|plugin|automation|command):[a-z0-9._-]{1,96}$`, `target` must be `hermes` (`omp` answers `bad target`), the item must exist in `~/.meshvault/status/deck/launch.json` with that kind, and `target` must be in its `targets`. Any failure answers 400 with a short word (`bad id`, `bad target`, `unknown id`, `kind mismatch`, `target not allowed`); a missing list answers 503.
3. One launch at a time, at least 4 s apart, at most 8 per minute (429 with `retry_s`).
4. Runs `~/ops/bin/deck-launch <target> <id>` with argv only, 40 s timeout, and returns its JSON line.

`deck-launch` repeats the checks, also requires the item's `arg` to match `[A-Za-z0-9._:@+-]{1,128}`, then:

| kind | Hermes input |
|---|---|
| skill | `/<skill>` (gateway expands the slash command) |
| command | the `hermes` text in `~/.config/pixel-deck/quick-commands.json` |
| mcp, tool, plugin | a short read-only status instruction |
| automation | queue the Hermes cron job on the next tick (cronjob tool); never edit or remove |

Catalog items that only had the OMP target stay listed with no run button ("view only").

- hermes: `POST http://127.0.0.1:8642/v1/runs` with the bearer key read from `~/.hermes/.env` at call time. Output: `run_id` and status. The key never reaches stdout, stderr or the log.
- Every call appends one JSON line to `~/.local/state/pixel-deck/launch.jsonl` (mode 600): time, target, id, ok, run or pane id, error word.
- Exit 0 ok, 1 failed after validation (gateway), 2 rejected.

Reinstall after editing: `install -m 700 scripts/deck-launch ~/ops/bin/deck-launch`.

## v8 read routes (all GET, cookie-only, no controls)

| Route | Source | Returns |
|---|---|---|
| `/api/crons` | `~/.hermes/cron/jobs.json`, read at request time (5 s cache) | `active`, `paused`, `counts`, `src`, `t`, `file_t`. Per job ONLY: name, id (first 8 chars), schedule_display, state, enabled, provider, model, last_run_at, last_status, next_run_at, plus `lane` (CLAUDE, CODEX, NO MODEL, OTHER) derived from that job's own provider and model. Never prompts, scripts, skills, paths, delivery targets or error text. |
| `/api/fleet-board` | `fleet-disks.json`, live vLLM `:8080`, newest `cluster-bench-*.json`, `~/.meshvault/status/deck/device-models.json`, `~/.meshvault/status/deck/gitsync.json`, `~/.meshvault/status/deck/fleet.json` | `machines`, `cluster` (model, running, waiting, `kv_cache_pct`, `bench`), `models`, `backup` (bounded local tracking-ref scan summary and per-repo local-ahead estimates; no fetch or GitHub verification), `units`. Missing, malformed, oversized, stale, or partial feeds remain unknown or carry an error; no remote-backup claim is made. |
| `/api/run?id=<run_id>` | `~/ops/bin/deck-launch status <run_id>` (read-only GETs on the gateway `/v1/runs/<id>` and `/events`) | `state` queued, running, done, failed; `elapsed_s`; up to 60 sanitized output lines. Only run ids found in the deck's own `launch.jsonl` are served (else 404); a malformed id is 400. |
| `/api/run-last` | `launch.jsonl` | The last run id the deck launched, for the Last run button (404 if none). |

Machine disk reachability is tri-state: `true` is Up with disks; `false` is an answered unreachable check and reads Down;
`null` is Not checked, with the probe's reason. `scripts/fleet-disks.py` keeps `ok` for existing consumers and writes the
same `reachable` value. Its `df`/SSH exceptions write both as null, retain the last disks and check time, and record the
exception type. This collector has no separate negative reachability check, so it never manufactures false from an
exception. The board carries errors as credential-scrubbed, plain-text notes capped at 120 characters. A machine absent
from the snapshot keeps its separate reason. A current node answer can resolve only a not-checked disk state; a stale
or failed node answer cannot. Installing the producer is separate from deploying the reader; back up the live script
and snapshot before installation, then let the collector refresh them.

The gateway key stays inside `deck-launch`; the deck exposes only the bounded actions below.

## Feedback routes

All routes require the deck cookie. POSTs require same-origin CSRF checks and return no-store JSON.

| Route | Behavior |
|---|---|
| `POST /api/cron-act?id=<8 hex>&act=run|pause|resume` | Resolves one full Hermes cron id from `jobs.json`, rejects state conflicts, calls `deck-launch cron`, audits each attempt to mode-600 `actions.jsonl`, and clears the crons cache on success. One at a time, 2 s gap, 20/min. |
| `POST /api/run-send` | JSON `{"text":"...","run_id":"optional"}`. Sends text via stdin only to `deck-launch send`; starts a new run, replies in the same session when terminal, or steers a running run. Only deck-launched run ids are accepted. One at a time, 1.5 s gap, 20/min. New and reply runs carry the model route (`~/.config/pixel-deck/run-route.json`, default `openai-codex` `gpt-6-luna` at `medium`) and every mode is checked by Jev (Clef when Jev is down) first. Refusals: 422 `gate blocked`, `gate unsure`, `route invalid`; 502 `gate unavailable`. Nothing is sent in any of them. |
| `GET /api/run?id=<run>` | Existing run status, now includes `session_id` from the gateway status. |
| `GET /api/unit?name=<unit>` | Read-only systemctl properties and 25 scrubbed journal lines for a unit listed in `fleet.json` `failed_units`. |
| `POST /api/cam-diag` | Bounded camera client diagnostics. No cookies, links or query strings in records; mode-600 `cam-diag.jsonl` capped at 256 KB, 60/min. |
| `POST /api/client-error` | The deck's own page errors. JSON only, 2,048-byte body (413 above), owner only (guest and desk viewer get 403). Fields: `e` one of `error`, `rejection`, `render`, `csp`; `route` a page route (`shop/market`); `src` a script basename (`deck.js`); `line`, `col` whole numbers; `msg` scrubbed and cut to 120 characters; `build` 16 hex. Any other value is 400; other fields are dropped. 60/min; mode-600 `client-error.jsonl` capped at 256 KB beside `cam-diag.jsonl`. |
| `GET /api/client-error` | `{"ok":true,"n_24h":N,"partial":false,"last":[{t,e,route,src,line,col,msg,build}, ... at most 5, newest first],"t":now}`, read from the newest 64 KB of the log. `partial` true: older rows were not read and the oldest one read is still inside the 24 hours, so `n_24h` is a floor. No file yet is `n_24h` 0. |
| `GET /api/today` | Market items include HTTP(S) `articles.canonical_url` when available. Also carries the Today glance's three cuts (round "Better" item 7, `rust/src/todayslices.rs`): `surf_best` (the Surf overview's own state keys, `spots` cut to the pinned home spots with `id, name, region, pinned, now`), `shop_moves` (the Shop market feed's state keys, `watches.items` with `slug, label, category, median, change_7d, change_30d, confidence, best, best_used, best_reason`) and `home_area` (`{zip, name}` of the Real estate home market, or `{zip: null, reason}`). A feed that is not reporting stays so in its cut, with its reason. |
| `GET /api/housing/national?part=metros|states` | Also takes `state=CA` (a metro whose name ends in a state list such as `NY-NJ-PA` is in each) and `fields=a,b` (each row keeps only those keys, e.g. `fields=cbsa,name` for a picker). Either one on another part, a bad state or a bad field name is 400. |

Every answer carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` and `X-Frame-Options: DENY` (`rust/src/headers.rs`, one outer layer). `/` and `/cre` also carry a `Content-Security-Policy-Report-Only` policy: nothing is blocked; the pages report what it would refuse to `POST /api/client-error` as `e:"csp"`. Its `frame-src` names the surf cams' `https://www.youtube-nocookie.com` and the published tailnet route of every app in `rust/src/apps.rs`, so opening an app inside the deck is never reported; an app that forbids framing opens in a new tab. A page that tries to frame the deck is never reported either: `DENY` stops the framed document before any of its code runs, so `frame-ancestors 'none'` in the report-only policy produces no report to wait for. Camera answers (`/api/cam`, `/cam/`) pass only `image/*` (never SVG), `video/*`, `audio/*` and the HLS playlist types; anything else becomes `application/octet-stream`.

Every `GET /api/...` JSON 200 carries a weak `ETag` of its bytes (`rust/src/compress.rs` `revalidate_layer`), and the same request with that tag in `If-None-Match` is a 304 with no body. An answer that carries amounts never carries one: every route behind `amount_gate` (Money, Invest values, Commerce) and the household profile answer through `amount_json`, whose private marker the layer honours and strips (a test fails when a gated route forgets it). A feed answer includes its `age`, so it repeats byte for byte only while the server's own cache for that feed holds it. `/api/amazon` keeps its last good answer (at most 1 MB) in `~/.local/state/pixel-deck/amazon-last.json` (mode 600); the first read after a start answers with it at once, marked `stale: true` with `kept_at`, while the database read runs in the background.

`deck-launch` accepts `cron <run|pause|resume> <full id>` and `send <run_id|->` (UTF-8 stdin). `DECK_HERMES_BASE` selects a test-only `http://127.0.0.1:<port>` gateway. `DECK_JEV_BASE` and `DECK_CLEF_BASE` select test-only gate endpoints in the same format. A malformed override fails closed instead of falling back to production.

### Fleet snapshot writer

`scripts/deck-fleet-snapshot` (install: `install -m 700 scripts/deck-fleet-snapshot ~/ops/bin/deck-fleet-snapshot`) runs `systemctl --user --failed` (list only) and writes `~/.meshvault/status/deck/fleet.json` atomically, mode 600. No timer is installed by v8. Suggested units, to add only with owner approval:

```ini
# ~/.config/systemd/user/deck-fleet-snapshot.service
[Unit]
Description=Pixel Deck fleet snapshot (failed user units)
[Service]
Type=oneshot
ExecStart=%h/ops/bin/deck-fleet-snapshot
# exit 1 means systemctl failed; the file then says ok=false, which the deck shows as unavailable
SuccessExitStatus=0 1

# ~/.config/systemd/user/deck-fleet-snapshot.timer
[Unit]
Description=Refresh the Pixel Deck fleet snapshot every 5 minutes
[Timer]
OnBootSec=60
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
```

Until the timer exists, the Failing units card reads "Unavailable" once the file is older than twice its 300 s refresh (10 min), and the file can be refreshed by running the script by hand.

## v9 Shop feed (read route, no controls)

| Route | Source | Returns |
|---|---|---|
| `/api/ecom` | `~/.meshvault/status/house-feeds/ecom.json`, written hourly by the shopping toolkit (`python -m shoptrends feed`, schema in the shopping MCP's `docs/FEEDS.md`), 60 s cache. Before 2026-10-29 the route read `deck/ecom.json`, an orphan nothing wrote. | `coverage`, `watch`, `movers`, `deals`, `macro`, plus `sources`, `errors`, `t`, `age`, `refresh`, `stale`. Same collector contract as the v6 feeds: stale after 2x `refresh`, a missing file is `{"error":"file missing","stale":true}` (HTTP 200), a bad file is `bad json`. |
| `/api/listings` | `~/.meshvault/status/deck/listings.json`, written hourly by `~/ops/bin/deck-feed-listings` through read-only Hermes marketplace and shopping MCP searches | `query`, `counts` (rows kept in the 24 h window, earlier watch queries included), `counts_this_run` (rows the latest search returned), `status` (`ok`, `partial`, `failed`), `source_status` per site (`status` ok/error/unavailable, `checked_at`, `last_ok_at`, `rows`, `raw`, `reason`), `generated_at`, and up to 120 public `listings` (`title`, `price`, `currency`, `source`, `url`, `posted_at`, `first_seen`, `last_seen`, `seen_this_run`, `query`). `t` is the newest successful source check (0 when none ever worked), not the file write time, so a run where every source fails goes Out of date instead of looking fresh. Search rotates through active shoptrends watches each hour. Failed sources keep last-good listings for at most 24 hours with their `last_seen` unchanged; eBay requires the existing owner keyset and is honestly reported unavailable without it. |
| `/api/onthisday` | `~/.meshvault/status/deck/onthisday.json`, written daily at 05:00 PT by `~/ops/bin/deck-feed-onthisday` from the read-only photo catalog | `month_day`, `total` (photos and videos taken on today's month and day in earlier years, Pacific time), `years` (per-year counts, newest first), plus `t`, `age`, `refresh`, `stale`, `errors`. No item ids, filenames or thumbnails. A `null` total means the catalog could not be read; it is never zero. |
| `/api/photoyears` | `~/.meshvault/status/deck/photoyears.json`, written daily by `~/ops/bin/deck-feed-photoyears` from the read-only Takeout photo catalog | `years` (per calendar year `image` and `video` counts, Pacific time), `dated_total`, `undated`, `other_media`, plus `t`, `age`, `refresh`, `stale`, `errors`. The Life tab "Years in photos" card lists years that have items. No item ids, filenames or thumbnails. A `null` `dated_total` means the catalog could not be read; it is never zero. |
| `/api/replyblock` | `~/.meshvault/status/deck/replyblock.json`, written once a day (06:40 timer, ready for the 09:00 send block) by `reply-block` (`~/projects/apps/reply-block`) | `date`, `card_for`, `mode` (`run` or `dry-run`), `model` (`used`, `id`, `note`), `counts` (`waiting`, `drafted`, `over_cap`, `cap`, `gmail_drafts_before`, `gmail_drafts_after`, skipped kinds), `drafts_url`, and up to 200 `items` (`rank`, `name`, `subject`, `age_h`, `score`, `drafted`, `draft_mode`, `thread_url`, `draft_url`), plus `t`, `age`, `refresh`, `stale`, `errors`. The Life tab "Reply block" card shows the draft count, what waits, the cap and one row per thread linking into Gmail (only `mail.google.com` links are rendered). Drafts only: nothing is ever sent. No message bodies. |
| `/api/rankwatch` | `~/.meshvault/status/deck/rankwatch.json`, written daily by `rankwatch` (`~/projects/apps/rankwatch`) | `day`, `run` (`ok_charts`, `failed_charts`, `requests`), `counts` (`apps`, `live`, `unreleased`, `alerts_today`, `alerts_7d`) and `alerts` (`day`, `kind`, `severity`, `category`, `chart`, `name`, `text`), plus `t`, `age`, `refresh`, `stale`, `errors`. The collector's own `stale` flag is dropped: staleness comes from the file age. The per-app and per-category tables are not served. The Life tab "Rank watch" card shows charts read, alert counts and the top three alerts, warnings first. |
| `/api/travel-deals` | `~/.meshvault/status/travel-deals.json`, every 6 h (shared feed contract, 2026-10-30) | `generated_at`, up to 200 ranked `items` (`id`, `rank`, `kind` flight/hotel/sale, `category`, `title`, `subtitle`, `price`, `currency`, `baseline_price`, `savings`, `savings_pct`, `location`, `route`, `cabin`, `protected`, `risk`, `legs`, `source_url`, `as_of`) and the per-route `summary`, plus `t`, `age`, `refresh`, `stale`, `sources`, `errors`. Read by the Omarchy Deck iOS Travel section. |
| `/api/outdoors` | `~/.meshvault/status/outdoors.json`, every 2 h | `generated_at` and flat `items` (`kind` surf/cam/fishing/snow/ikon/wsl, `title`, `summary`, `location`, `price`, `currency`, `source_url`, `as_of`). The rich `sections` block stays in the file. iOS Outdoors section. |
| `/api/life` | `~/.meshvault/status/life.json`, daily | `generated_at` and flat `items` (`kind` gas/job/home/pooled/trend, `title`, `subtitle`, `detail`, `price`, `currency`, `place`, job `org`/`pay_min`/`pay_max`, trend `value`/`delta_7d_pct`/`delta_1y_pct`, `source_url`, `as_of`). iOS Life section. |
| `/api/history-goodnews` | `~/.meshvault/status/history-goodnews.json`, daily | `generated_at` and flat `items` (`section` trend/on_this_day/good_news/world_event, `title`, `summary`, `kind`, `source`, `year`, `published`, `source_url`, `as_of`). iOS Life section, below the life items. |

- The four shared-contract feeds (`travel-deals`, `outdoors`, `life`, `history-goodnews`) carry ISO `generated_at`, `sources` as objects and `errors` as `{source, error}`. `prepare_contract` turns them into `t`, `sources` (names) and `{source, reason}` before the generic filter, so a blocked source is an error row, never zero items. Refresh falls back to the collector timer; Out of date after 2x. A missing file answers `{"error":"file missing"}` (200), which the iOS app shows as "Not collected yet".
- Cookie only, GET only (POST is 403 cross-origin and 400 same-origin, like every v6 feed). It reads one file; there is no search, no outbound fetch and no write.
- The shared feed filter bounds strings (400 chars), lists (200 items) and depth, and drops any key named `key`, `token`, or containing `password`, `secret`, `apikey`, `cookie`. Side effect: `macro[].key` is dropped. The Shop tab does not read it.
- The Shop tab (after Markets, before Life) renders it with plain DOM and inline SVG: coverage (14 site chips, four counters, days of history), movers, deals, watch cards (median, 7d and 30d change, 30-day sparkline, range, per-site bars, supply, shipping, condition, best deal, season chart) and macro cards. Every figure shows its source and age. Unknown is an em dash with the reason beside it, never 0. A feed older than 2x `refresh` shows `Out of date · Updated ...` on every heading and Out of date on every card; no feed shows the one empty state ("Shop trends are not reporting" with a plain reason and Try again; the file name stays in the hidden details). Deal and best links open in a new tab (`rel="noopener noreferrer"`, http and https only).
- Listings is a separate Shop group. The price is a dollar amount only when the MCP reports USD; a missing currency shows an unknown price. Two different times are shown and never merged: `Posted` is the seller's own post time (it can be weeks old), `seen` is the last search that returned the link. Seen is search presence, not proof the item is still for sale; rows the latest search did not return say `last seen`. The count line says `Latest search:` and a second line gives the 24 h kept totals. A failed source shows no count and `Last worked ...` from its own `last_ok_at`, or `Never worked` (eBay without keys). Feeds without `source_status` fall back to the old `Checked` wording. No seller actions are exposed. Money reports that no finance feed is set up when its file is missing; no finance collector is installed by this change.
- The Facebook Marketplace search needs the owner's area. `deck-feed-listings` reads it from `~/.config/pixel-deck/listings-location.json` (`{"latitude":..,"longitude":..,"location_id":".."}`, mode 0600, never committed). Without the file Facebook reports `location not configured` and the other sources still run.
- `deck_audit.py` is unchanged and does not request `/api/ecom` (its GET allowlist is fixed). Probe it by hand with the one-liner in `docs/release-v9.md`.

## v9 Money feed (two read routes, amounts gated)

| Route | Source | Returns |
|---|---|---|
| `/api/finance` | `~/.meshvault/status/deck/finance.json`, written by `finance-master feed` (schema: shopping MCP `docs/FEEDS.md`, section finance.json) | Statuses only: per app `id`, `name`, `kind`, `route`, `status`, `last_ok`, `age`, `has_values`; `inventory` (`installed`, `finance_related`, `covered`, `src`, `t`); `sample`, `has_totals`, `sources`, `errors`, `t`, `age`, `refresh`, `stale`. Never a `values` object, never `totals`. |
| `/api/finance-values` | the same file | `apps` (id to its `values`, only apps that have values) and `totals`, plus `t`, `age`, `refresh`, `stale`. Requested only when the owner taps Reveal. |

- Both routes: GET only (other methods 405, cross-origin POST 403), cookie only (`?t=` is refused with 401, so a token never sits in a URL), `Sec-Fetch-Site` must be absent, `same-origin` or `none` (403 otherwise), `Cache-Control: no-store`. A missing or bad file is the same `{"error":...,"stale":true}` object on both and carries no data.
- `rust/src/finance.rs` rebuilds every app from an allow-list (a stray `balance_usd` beside `values` never leaves), maps `kind`, `route` and `status` onto the contract enums (anything else becomes `other`, `none`, `never`), and cleans ids to `[A-Za-z0-9._-]`. `finance` is deliberately not in `FEEDS`, so the generic `/api/<name>` route can never serve the file; a unit test pins that. The file is read on every request and nothing is cached in server memory.
- Nothing in the finance code logs. `rust/tests/finance_log.rs` runs the real binary, drives both routes (served, refused, wrong method, bad cookie, `?t=`, cross-site), and asserts the whole stderr holds none of the sample amounts and no token.
- The values route returns every captured value in one body (about 1 KB for 16 apps); the browser keeps only what was tapped (one app, or all with Reveal all) and drops it on expiry.
- The Money tab (after Home, before Markets) shows: a "Sample data" banner when `sample` is true, the total (masked), inventory (installed, finance-related, covered, source and age), a status tally, per-app cards grouped by kind (bank, brokerage, crypto, payments, wallet, net worth, tax, shopping, receipts, other) with kind chip, route chip (iPhone screen, API, no route), status word with a mark (Never, OK, Out of date, Needs you, Needs unlock, Blocked) and age or reason. An app with values shows a fixed-width masked bar and a 44px Reveal button. The empty state (every app `never`, no totals) says `No capture yet` and `ask Hermes: finance-master status`.
- Reveal rules, all in `DeckUI.finCtl` (`static/deck.js`): nothing is requested until a tap; each reveal expires 30 s after it lands; amounts are removed from JS state and from the DOM on expiry, Hide, `visibilitychange` to hidden, `pagehide`, another tab coming on screen, and ambient mode; a reveal still in flight when the page is hidden is discarded unread. Amounts are never put in a URL, storage, a log line or an attribute. The service worker does not answer or cache either route.
- `deck_audit.py` is unchanged and does not request these routes. Probe them by hand with the one-liner in `docs/release-v9.md` (prints counts and booleans, never amounts).

## Tests

```bash
cd ~/projects/meshvault/pixel-deck
~/.hermes/hermes-agent/venv/bin/python -m unittest tests/test_deck_audit.py -v   # includes real-SDK tests
python3 -m unittest tests/test_deck_audit.py -v                                  # includes real-SDK tests when its imports resolve
python3 -m unittest tests/test_deck_launch.py tests/test_deck_fleet_snapshot.py -v  # launch validation, status view, snapshot writer
node --test tests/*.test.js                                                      # front-end renderers (Today, cameras, pad, v6 pages, v9 Shop and Money; fixtures tests/fixtures/ecom.sample.json and finance.sample.json)
(cd rust && cargo test)                                                          # server: feeds, launch checks, limiter, routes, finance split, finance log test
```

No test contacts the live deck. Real-SDK tests use a private `PluginManager` scope in a temp dir, register the five tools, dispatch through `tools.registry`, then deregister. Nothing is activated.
