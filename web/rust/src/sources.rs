//! Read-only status-file connectors. Each source reads one small JSON file with a 2 s timeout,
//! keeps only the keys the deck renders, is cached in memory, and reports `src`, `t` (epoch of the
//! data), `age` and `stale` (age > 2x its refresh interval). A missing file is an error object, never a 5xx.
//! Privacy: mail is a count only, the car never reads location, the finance file is read only by finance.rs (never cached here).
use crate::util::{iso_to_epoch, now_epoch};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::Path;
use std::time::{Duration, Instant, UNIX_EPOCH};
use tokio::sync::Mutex;

pub struct Def {
    pub name: &'static str,
    pub rel: &'static str,
    /// Documented refresh interval of the writer, in seconds.
    pub refresh: u64,
    /// In-memory cache lifetime, in seconds.
    pub ttl: u64,
}

pub const LOCAL_AI: Def = Def {
    name: "nodes",
    rel: ".meshvault/status/home-ai/local-ai.json",
    refresh: 60,
    ttl: 15,
};
pub const HEALTH: Def = Def {
    name: "health",
    rel: ".meshvault/status/fleet-health-last.json",
    refresh: 120,
    ttl: 20,
};
pub const CAR: Def = Def {
    name: "car",
    rel: ".meshvault/status/tesla/car.json",
    refresh: 300,
    ttl: 20,
};
pub const DISKS: Def = Def {
    name: "disks",
    rel: ".local/state/fleet-disks.json",
    refresh: 300,
    ttl: 60,
};
pub const SITES: Def = Def {
    name: "sites",
    rel: ".local/state/product-monitor/last.json",
    refresh: 300,
    ttl: 60,
};
pub const MCP: Def = Def {
    name: "mcp",
    rel: ".local/state/ops/mcp-liveness-history.json",
    refresh: 86400,
    ttl: 300,
};

// Deck v6 feeds. Collectors write `~/.meshvault/status/deck/<name>.json` (contract 2026-10-01): every
// file carries `t`, `refresh`, `src` and `errors`. `deck_feed_from` keeps the contract keys only.
// The three public house feeds (surf, hockey, realestate) live in `house-feeds/`, the canonical
// directory the house briefing reads too, so neither reader depends on the other's storage.
const fn feed(name: &'static str, rel: &'static str, refresh: u64, ttl: u64) -> Def {
    Def {
        name,
        rel,
        refresh,
        ttl,
    }
}
pub const CLUSTER: Def = feed("cluster", ".meshvault/status/deck/cluster.json", 60, 10);
pub const LAUNCH: Def = feed("launch", ".meshvault/status/deck/launch.json", 900, 60);
pub const DEV: Def = feed("dev", ".meshvault/status/deck/dev.json", 300, 30);
pub const ACCOUNTS: Def = feed("accounts", ".meshvault/status/deck/accounts.json", 600, 60);
pub const JOBS: Def = feed("jobs", ".meshvault/status/deck/jobs.json", 3600, 60);
/// Casey's sales jobs (2026-11-01). Same collector and schema as `jobs` (`deck-feed-jobs --person casey`), plus
/// top-level `person`; the Jobs page shows it under the Casey chip.
pub const JOBS_CASEY: Def = feed("jobs-casey", ".meshvault/status/deck/jobs-casey.json", 3600, 60);
/// Riley's and Morgan's searches (2026-11-02). Same collector and schema (`deck-feed-jobs --person riley|morgan`), each with
/// its own taxonomy in the file. Morgan's lane reads public listings only; the deck is owner-only, so her list never
/// reaches a guest or her own logins.
pub const JOBS_RILEY: Def = feed("jobs-riley", ".meshvault/status/deck/jobs-riley.json", 3600, 60);
pub const JOBS_MORGAN: Def = feed("jobs-morgan", ".meshvault/status/deck/jobs-morgan.json", 3600, 60);
/// Tanner's freelance gigs (Life > Gigs, 2026-11-02). Written by the gig finder: `sites_checked`, `sites_registry`,
/// `by_site` and `gigs[]` (title, site, url, pay, pay_min, pay_max, pay_unit, fit, posted_at, summary, why, pitch, t,
/// kind, category, est_hourly, floor_ok), best fit first. `pitch` is a draft; nothing on the deck sends it.
pub const GIGS: Def = feed("gigs", ".meshvault/status/deck/gigs.json", 3600, 60);
pub const SURF: Def = feed("surf", ".meshvault/status/house-feeds/surf.json", 1800, 120);
pub const HOCKEY: Def = feed("hockey", ".meshvault/status/house-feeds/hockey.json", 900, 60);
pub const REALESTATE: Def = feed(
    "realestate",
    ".meshvault/status/house-feeds/realestate.json",
    3600,
    60,
);
pub const PRODUCTS: Def = feed("products", ".meshvault/status/deck/products.json", 300, 30);
/// Hourly status only. The STOP file stays. The loop is not retired.
pub const PERFLOOP: Def = feed("perfloop", ".meshvault/status/deck/perfloop.json", 3600, 60);
/// v9 Shop tab. Written by `python -m shoptrends feed` (schema: shopping MCP `docs/FEEDS.md`) into the house feeds
/// directory, hourly; STALE after 2x. (`deck/ecom.json` is an orphan nothing writes any more.)
pub const ECOM: Def = feed("ecom", ".meshvault/status/house-feeds/ecom.json", 3600, 60);
/// Read-only public marketplace searches, written hourly by deck-feed-listings.
pub const LISTINGS: Def = feed("listings", ".meshvault/status/deck/listings.json", 3600, 60);
/// v9 Money tab. Written by `finance-master feed` (schema: shopping MCP `docs/FEEDS.md`), hourly; STALE after 2x.
/// Deliberately NOT in `FEEDS`: the generic `GET /api/<name>` route would serve every amount in the file.
/// `finance.rs` reads it, splits it into a sanitised view and a values view, and owns both routes.
pub const FINANCE: Def = feed("finance", ".meshvault/status/deck/finance.json", 3600, 60);
/// Apple Watch. Hourly writer (AppleWatch2) stores `~/.meshvault/status/deck/watch.json`.
/// Contract keys: connected (bool), hr (bpm), hrv (ms), sleep_h (hours), battery (percent),
/// move_kcal, exercise_min, stand_h, resting_hr, reason (one short sentence when a value is missing).
/// Top-level t, refresh, src, errors follow the other deck feeds. STALE after 2x refresh.
pub const WATCH: Def = feed("watch", ".meshvault/status/deck/watch.json", 3600, 60);
/// Markets and Invest tabs. `markets` is public market data (quotes, movers, catalysts). `portfolio` is the same
/// holdings as symbols, prices and day percent only. The amounts live in `portfolio-values`, which is deliberately NOT
/// in `FEEDS` (the generic `GET /api/<name>` route would serve them) and is served by `portfolio_values_route`
/// in main.rs after a Reveal tap. All three are written every 5 minutes; STALE after 2x.
pub const MARKETS: Def = feed("markets", ".meshvault/status/house-feeds/markets.json", 300, 30);
pub const PORTFOLIO: Def = feed("portfolio", ".meshvault/status/deck/portfolio.json", 300, 30);
pub const PORTFOLIO_VALUES: Def = feed(
    "portfolio-values",
    ".meshvault/status/deck/portfolio-values.json",
    300,
    30,
);
/// Every scheduled job Tanner owns, one list (Hermes, host systemd, launchd, GitHub Actions).
/// Landing page for the Crons tab: attention first, healthy collapsed, next 24 h schedule.
/// Written by `deck-feed-crons` every 5 min. Not `crons`: `GET /api/crons` is the Hermes lane view in crons.rs. STALE after 2x.
pub const SCHEDULES: Def = feed("schedules", ".meshvault/status/deck/schedules.json", 300, 30);
/// Optional cluster second opinion on the jobs market (Jobs lane writes it; missing is not an error).
pub const JOBS_INSIGHT: Def = feed(
    "jobs-insight",
    ".meshvault/status/deck/jobs-insight.json",
    21600,
    300,
);
/// Optional aggregated interest tags from the owner's own sources (Profile lane writes it).
pub const INTEREST_PROFILE: Def = feed(
    "interest-profile",
    ".meshvault/status/deck/interest-profile.json",
    86400,
    300,
);
/// Fleet tab stall watch. Written by `deck-feed-stalls` every 2 min: OMP sessions, swarm lanes, Hermes cron and systemd
/// user units with no progress, rate-limit loops or repeated errors. Labels, times and one-line reasons only. STALE after 2x.
pub const STALLS: Def = feed("stalls", ".meshvault/status/deck/stalls.json", 120, 15);
/// On this day (Life tab). Written daily by `deck-feed-onthisday` from the read-only photo catalog. The card shows per-year
/// counts and the total only: no item ids, filenames or thumbnails. STALE after 2x.
pub const ONTHISDAY: Def = feed("onthisday", ".meshvault/status/deck/onthisday.json", 86400, 60);
/// Years in photos (Life tab). Written daily by `deck-feed-photoyears` from the read-only Takeout photo catalog. The card
/// shows per-year image and video counts and the totals only: no item ids, filenames or thumbnails. STALE after 2x.
pub const PHOTOYEARS: Def = feed("photoyears", ".meshvault/status/deck/photoyears.json", 86400, 60);
/// Reply block (Life tab). Written by `reply-block` (~/projects/apps/reply-block) once a day before 09:00. The card shows
/// counts and the ranked threads it drafted replies for, with links into Gmail; it never carries message bodies. STALE after 2x.
pub const REPLYBLOCK: Def = feed("replyblock", ".meshvault/status/deck/replyblock.json", 86400, 60);
/// Server page: gateway health and local schedule metadata only. No scheduled-mail mailbox read.
pub const SERVERPAGE: Def = feed("serverpage", ".meshvault/status/deck/serverpage.json", 120, 30);
/// App Store rank watch (Life tab). Written daily by `rankwatch`: chart fetch health, alert counts and the newest alerts.
/// The per-app and per-category tables stay in the file. STALE after 2x.
pub const RANKWATCH: Def = feed("rankwatch", ".meshvault/status/deck/rankwatch.json", 86400, 60);
/// TestFlight and App Store state per app (deck 2026-10-29, C1). Written every 5 min by `asc-live-status` (batch collector
/// outside this repo). The route keeps one row per app: build, feedback counts and App Store version state. Bundle ids,
/// build ids and submission ids stay in the file. Owner only: every FEEDS route is refused for a guest.
pub const TESTFLIGHT: Def = feed("testflight", ".meshvault/status/deck/testflight.json", 300, 30);
/// Tailnet snapshot (C1). Written every 5 min by `ts-watch`: device online counts, alerts and Funnel/Serve exposures.
/// The route drops IPs, rx/tx and key ages, and omits Morgan's devices and alerts (a separate tenant).
pub const TAILSCALE: Def = feed("tailscale", ".meshvault/status/deck/tailscale.json", 300, 30);
/// Renewals and paperwork due dates (C1). Written hourly by `deck-feed-deadlines` from the subsradar card and
/// `paperwork due`. Dates and day counts only: no dollar amounts, evidence or mail text.
pub const DEADLINES: Def = feed("deadlines", ".meshvault/status/deck/deadlines.json", 3600, 60);
/// The owner's agenda, written every ~10 min by `calendar-feed` (`~/.meshvault/status/calendar/agenda.json`, 14 days of
/// events, bills due and per-source health). This is the deck's own path to the calendar; until it existed, today's events
/// only arrived through `/api/accounts` from the Mac mini. Only Tanner's calendars: `prepare_calendar` drops any event or
/// source that names another tenant (LOTO, Morgan, Quill) and every event `location`.
pub const CALENDAR: Def = feed("calendar", ".meshvault/status/calendar/agenda.json", 600, 60);
/// Native Deck sections (2026-10-30). Four collectors write the shared feed contract straight under `~/.meshvault/status/`:
/// `feed`, ISO `generated_at`, `sources` as `{name, url, fetched_at}`, flat `items` (each with its own `source_url` and
/// `as_of`) and `errors` as `{source, error}`. `prepare_contract` maps that shape onto the deck v6 one before the key filter.
/// Refresh is each collector's timer: travel every 6 h, outdoors every 2 h, life and history daily. STALE after 2x.
pub const TRAVEL_DEALS: Def = feed("travel-deals", ".meshvault/status/travel-deals.json", 21600, 120);
pub const OUTDOORS: Def = feed("outdoors", ".meshvault/status/outdoors.json", 7200, 120);
pub const LIFE: Def = feed("life", ".meshvault/status/life.json", 86400, 300);
pub const HISTORY_GOODNEWS: Def = feed("history-goodnews", ".meshvault/status/history-goodnews.json", 86400, 300);
/// World view (2026-11-17). `trends` is what is trending in public sources (best-seller ranks, ticker volume, search growth);
/// `gaps` is the scored market gaps built on it, each with its evidence. Written by the deck-feed-trends lane under the shared
/// contract: ISO `generated_at`, `sources[]` as `{id, ok, age_s, error}`. Public data only: `prepare_trends` and `prepare_gaps`
/// rebuild every row from an allow-list, so a stray holding, balance or address field never leaves. STALE after 2x.
pub const TRENDS: Def = feed("trends", ".meshvault/status/deck/trends.json", 1800, 60);
pub const GAPS: Def = feed("gaps", ".meshvault/status/deck/gaps.json", 3600, 120);
/// Every deck feed, in route order. GET `/api/<name>` serves each one.
pub const FEEDS: [&Def; 38] = [
    &CLUSTER,
    &LAUNCH,
    &DEV,
    &ACCOUNTS,
    &JOBS,
    &JOBS_CASEY,
    &JOBS_RILEY,
    &JOBS_MORGAN,
    &GIGS,
    &SURF,
    &HOCKEY,
    &REALESTATE,
    &PRODUCTS,
    &PERFLOOP,
    &ECOM,
    &LISTINGS,
    &SCHEDULES,
    &JOBS_INSIGHT,
    &INTEREST_PROFILE,
    &MARKETS,
    &PORTFOLIO,
    &WATCH,
    &STALLS,
    &ONTHISDAY,
    &PHOTOYEARS,
    &REPLYBLOCK,
    &SERVERPAGE,
    &RANKWATCH,
    &TESTFLIGHT,
    &TAILSCALE,
    &DEADLINES,
    &CALENDAR,
    &TRAVEL_DEALS,
    &OUTDOORS,
    &LIFE,
    &HISTORY_GOODNEWS,
    &TRENDS,
    &GAPS,
];

pub fn feed_def(name: &str) -> Option<&'static Def> {
    FEEDS.iter().copied().find(|d| d.name == name)
}

/// Contract keys per feed. Anything else in the file is dropped.
fn feed_keys(name: &str) -> &'static [&'static str] {
    match name {
        "cluster" => &["engine", "nodes", "bench", "ratchet", "candidates", "proxy"],
        "launch" => &["items", "counts", "favorites"],
        "dev" => &["github", "vercel", "supabase", "herdr", "chromium", "grok"],
        "accounts" => &[
            "onepassword",
            "drives",
            "apple",
            "composio",
            "mcp",
            "dev_auth",
        ],
        "jobs" | "jobs-casey" | "jobs-riley" | "jobs-morgan" => &[
            "person",
            "queries",
            "by_site",
            "listings",
            "taxonomy",
            "rules",
            "market",
            "profile",
            "disabled",
        ],
        "jobs-insight" => &["model", "categories", "takes"],
        "gigs" => &["sites_checked", "sites_registry", "by_site", "gigs"],
        "interest-profile" => &["sources", "interests", "job_targets", "pending"],
        "surf" => &["spots", "tide"],
        "schedules" => &["counts", "groups"],
        "hockey" => &["teams", "live"],
        "realestate" => &["homes", "commercial", "market"],
        "products" => &["products", "app_store", "app_stores", "needs"],
        // `macro[].key` is dropped by `secret_key` (any key named "key"); the Shop tab does not read it.
        // 2026-10-21 status fields (FEEDS.md): one `generated_at` per feed, `as_of` per block, `setup` lines for a source only the
        // owner can enable, `groups` for near-duplicate listings. Old files without them still render.
        "ecom" => &["generated_at", "as_of", "setup", "coverage", "watch", "movers", "movers_info", "resale", "deals", "macro"],
        "listings" => &[
            "counts",
            "counts_this_run",
            "listings",
            "groups",
            "groups_total",
            "setup",
            "query",
            "source_status",
            "status",
            "generated_at",
            "as_of",
        ],
        // read by finance.rs only (never via the generic feed route): the allow-lists there decide what leaves
        "finance" => &["generated_at", "as_of", "status_counts", "explain", "sample", "inventory", "apps", "totals", "money"],
        "markets" => &["generated_at", "as_of", "as_of_note", "session", "headline", "board", "watchlist", "movers", "catalysts"],
        "watch" => &[
            "connected",
            // proximity and the newest health reading time: the House page says when the watch was last seen and when a reading last arrived
            "near",
            "rssi",
            "metrics_t",
            "hr",
            "hrv",
            "sleep_h",
            "battery",
            "move_kcal",
            "exercise_min",
            "stand_h",
            "resting_hr",
            "reason",
        ],
        "portfolio" => &["generated_at", "as_of", "as_of_note", "basis", "totals", "positions"],
        "portfolio-values" => &["generated_at", "as_of", "as_of_note", "basis", "totals", "positions"],
        "perfloop" => &[
            "enabled",
            "stop",
            "last_tick",
            "runs_today",
            "agents",
            "active_experiment",
            "last_result",
            "queue",
            "experiments_today",
            "engine",
            "exec_blocked_by",
        ],
        "onthisday" => &["month_day", "total", "years"],
        "photoyears" => &["dated_total", "undated", "other_media", "years"],
        "replyblock" => &["date", "card_for", "mode", "model", "counts", "drafts_url", "items"],
        "serverpage" => &["gateway", "mail"],
        "rankwatch" => &["day", "run", "counts", "alerts"],
        "stalls" => &["thresholds", "counts", "items", "alerts"],
        "testflight" => &["apps"],
        "tailscale" => &["counts", "alerts", "exposures", "nodes"],
        "deadlines" => &["renewals", "paperwork"],
        // `conflicts`, `doubles` and every event `location` are dropped: they describe overlaps and places the deck
        // does not print, and the consumer only needs today's events.
        "calendar" => &["generated_at", "tz", "window_days", "calendars", "days", "bills_due"],
        // shared feed contract (2026-10-30): the flat item list is the card list; per-section detail stays in the file
        "travel-deals" => &["generated_at", "items", "summary"],
        // `break_cams` (2026-11-04): each Surf break with its nearest operator cam or a Surfline link, read by the Surf cards
        "outdoors" => &["generated_at", "items", "break_cams"],
        "life" | "history-goodnews" => &["generated_at", "items"],
        // World view: the contract's `sources[]` is served as `feeds` (the envelope owns `sources`); rows rebuilt in prepare_trends/gaps
        "trends" => &["generated_at", "feeds", "products", "tickers", "searches"],
        "gaps" => &["generated_at", "method", "items"],
        _ => &[],
    }
}

#[derive(Default)]
pub struct Cache(Mutex<HashMap<&'static str, (Instant, Value)>>);

impl Cache {
    pub async fn get(&self, home: &Path, d: &Def) -> Value {
        if let Some((t, v)) = self.0.lock().await.get(d.name) {
            if t.elapsed().as_secs() < d.ttl {
                return v.clone();
            }
        }
        let v = if d.name == "products" {
            let config = tokio::fs::read_to_string(home.join(".config/pixel-deck/presentation.json")).await;
            match config {
                Ok(text) => filter_products_with_config(load(home, d).await, Some(&text)),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => filter_products_with_config(load(home, d).await, None),
                Err(_) => fail(d, "presentation config unreadable"),
            }
        } else {
            load(home, d).await
        };
        self.0
            .lock()
            .await
            .insert(d.name, (Instant::now(), v.clone()));
        v
    }
}

pub(crate) async fn read(path: &Path) -> Result<(String, Option<u64>), &'static str> {
    let f = async {
        let text = tokio::fs::read_to_string(path).await?;
        let mtime = tokio::fs::metadata(path)
            .await
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs());
        Ok::<_, std::io::Error>((text, mtime))
    };
    match tokio::time::timeout(Duration::from_secs(2), f).await {
        Ok(Ok(x)) => Ok(x),
        Ok(Err(e)) if e.kind() == std::io::ErrorKind::NotFound => Err("file missing"),
        Ok(Err(_)) => Err("file unreadable"),
        Err(_) => Err("read timed out"),
    }
}

async fn load(home: &Path, d: &Def) -> Value {
    let now = now_epoch();
    match read(&home.join(d.rel)).await {
        Ok((text, mtime)) => parse(d, &text, mtime, now),
        Err(e) => fail(d, e),
    }
}

fn parse(d: &Def, text: &str, mtime: Option<u64>, now: u64) -> Value {
    match d.name {
        "nodes" => nodes_from(text, now),
        "health" => health_from(text, mtime, now),
        "car" => car_from(text, now),
        "disks" => disks_from(text, now),
        "sites" => sites_from(text, now),
        "mcp" => mcp_from(text, now),
        _ if feed_def(d.name).is_some() => deck_feed_from(d, text, mtime, now),
        _ => fail(d, "unknown source"),
    }
}

pub(crate) fn fail(d: &Def, why: &str) -> Value {
    json!({"error": why, "src": format!("~/{}", d.rel), "refresh": d.refresh, "stale": true})
}

/// Attach source, timestamp, age and staleness to the rendered keys.
fn wrap(d: &Def, t: Option<u64>, now: u64, data: Value) -> Value {
    let mut o = match data {
        Value::Object(m) => m,
        _ => Map::new(),
    };
    let age = t.map(|t| now.saturating_sub(t));
    o.insert("src".into(), format!("~/{}", d.rel).into());
    o.insert("refresh".into(), d.refresh.into());
    o.insert("t".into(), json!(t));
    o.insert("age".into(), json!(age));
    o.insert(
        "stale".into(),
        (age.map(|a| a > 2 * d.refresh).unwrap_or(true)).into(),
    );
    Value::Object(o)
}

fn short(v: Option<&Value>, n: usize) -> String {
    v.and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .filter(|c| !c.is_control())
        .take(n)
        .collect()
}

/// A failing source's retry facts (FEEDS.md, 2026-10-21): last success, the next collector pass, whether a manual
/// retry is allowed and the exact command. Copied only when the file carries them, so an older file's errors keep
/// their two fields. `retry_cmd` is a short argv of plain strings or null; the deck shows it and never runs it.
fn retry_facts(from: &Value, to: &mut Value) {
    for k in ["last_ok", "next_retry"] {
        if let Some(v) = from.get(k) {
            // producers write epochs as integers or floats (1790600000.0); both read as whole seconds
            // epoch seconds only: a millisecond epoch (> 4e9) or anything before 2017 reads null
            to[k] = json!(v.as_f64().filter(|t| *t > 1_500_000_000.0 && *t < 4_000_000_000.0).map(|t| t as u64));
        }
    }
    if let Some(b) = from.get("can_retry").and_then(Value::as_bool) {
        to["can_retry"] = json!(b);
    }
    if let Some(v) = from.get("retry_cmd") {
        // an argument that is not plain text or is over 80 characters drops the whole command: a cut command is a different command
        let argv = v.as_array().filter(|a| !a.is_empty() && a.len() <= 8).and_then(|a| {
            a.iter()
                .map(|x| x.as_str().filter(|s| s.chars().count() <= 80 && !s.chars().any(char::is_control)).map(str::to_string))
                .collect::<Option<Vec<_>>>()
        });
        to["retry_cmd"] = json!(argv);
    }
}

fn gb(b: Option<u64>) -> Value {
    json!(b.map(|b| (b as f64 / 1_073_741_824.0 * 10.0).round() / 10.0))
}

/// GB10 node memory and temperature.
pub fn nodes_from(text: &str, now: u64) -> Value {
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return fail(&LOCAL_AI, "bad json");
    };
    let nodes: Vec<Value> = v
        .get("nodes")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .take(6)
                .map(|n| {
                    let m = n.get("memory");
                    json!({
                        "label": short(n.get("label"), 16),
                        "reachable": n.get("reachable").and_then(Value::as_bool).unwrap_or(false),
                        "mem_pct": n.get("memory_used_percent").and_then(Value::as_f64),
                        "mem_used_gb": gb(m.and_then(|m| m.get("used_bytes")).and_then(Value::as_u64)),
                        "mem_total_gb": gb(m.and_then(|m| m.get("total_bytes")).and_then(Value::as_u64)),
                        "temp_c": n.get("temperature_c").and_then(Value::as_f64),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let t = v
        .get("generated_at")
        .and_then(Value::as_str)
        .and_then(iso_to_epoch);
    wrap(
        &LOCAL_AI,
        t,
        now,
        json!({
            "nodes": nodes,
            "model": short(v.get("active_model"), 40),
            "api_ready": v.get("api_ready").and_then(Value::as_bool),
        }),
    )
}

/// Problems badge. The writer stamps a naive local time, so the file mtime is the age clock.
pub fn health_from(text: &str, mtime: Option<u64>, now: u64) -> Value {
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return fail(&HEALTH, "bad json");
    };
    let Some(list) = v.get("problems").and_then(Value::as_array) else {
        return fail(&HEALTH, "no problems list");
    };
    // `critical` and `degraded` are the writer's own split (fleet-health-check.py): a degraded problem such as a camera that needs power
    // at the camera is not an outage. Absent lists stay absent, so an older writer reads as before (all problems count as critical).
    let n_of = |k: &str| v.get(k).and_then(Value::as_array).map(|a| a.len());
    let names: Vec<String> = list
        .iter()
        .take(3)
        .map(|p| match p {
            Value::String(s) => s.chars().take(80).collect(),
            o => ["name", "check", "id"]
                .iter()
                .find_map(|k| o.get(*k).and_then(Value::as_str))
                .unwrap_or("problem")
                .chars()
                .take(80)
                .collect(),
        })
        .collect();
    let mut body = json!({"count": list.len(), "names": names});
    if let (Some(c), Some(d)) = (n_of("critical"), n_of("degraded")) {
        body["critical"] = json!(c);
        body["degraded"] = json!(d);
    }
    wrap(&HEALTH, mtime, now, body)
}

/// Car tile. Reads only battery, charging, locked, range, chargeLimit, generatedAt, ageSeconds, fresh and awake. Never location.
/// `generatedAt` is when the poller wrote the file; `ageSeconds` is how old the car's own reading was at that moment, so the car was
/// last seen at `generatedAt - ageSeconds` (`seen`). The deck says "Last seen" from `seen` and labels values as cached when
/// `fresh` is false, never "Updated N min ago" from the file time.
pub fn car_from(text: &str, now: u64) -> Value {
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return fail(&CAR, "bad json");
    };
    let t = v
        .get("generatedAt")
        .and_then(Value::as_str)
        .and_then(iso_to_epoch);
    let age_s = v
        .get("ageSeconds")
        .and_then(Value::as_f64)
        .filter(|a| a.is_finite() && (0.0..=31_536_000.0).contains(a))
        .map(|a| a.round() as u64);
    // the poller now writes `readingAt` (the car's own reading time) and leaves ageSeconds null for a live owner_api read;
    // an ageSeconds, when present, still wins because it is the older contract and says how stale a cached value was
    let reading = v.get("readingAt").and_then(Value::as_str).and_then(iso_to_epoch);
    let seen = t.zip(age_s).map(|(t, a)| t.saturating_sub(a)).or(reading);
    wrap(
        &CAR,
        t,
        now,
        json!({
            "battery": v.get("battery").and_then(Value::as_f64),
            "charging": short(v.get("charging"), 24),
            "locked": v.get("locked").and_then(Value::as_bool),
            "range": v.get("range").and_then(Value::as_f64),
            "charge_limit": v.get("chargeLimit").and_then(Value::as_f64),
            "age_s": age_s,
            "seen": seen,
            "fresh": v.get("fresh").and_then(Value::as_bool),
            "awake": short(v.get("awake"), 16),
        }),
    )
}

/// Disk bars per host. Mount paths are not passed on, only labels.
pub fn disks_from(text: &str, now: u64) -> Value {
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return fail(&DISKS, "bad json");
    };
    let mut drives = vec![];
    for h in v
        .get("hosts")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        if h.get("ok").and_then(Value::as_bool) != Some(true) {
            drives.push(json!({"host": short(h.get("host"), 14), "label": "unreachable", "pct": Value::Null}));
            continue;
        }
        for d in h
            .get("drives")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[])
        {
            drives.push(json!({
                "host": short(h.get("host"), 14),
                "label": short(d.get("label"), 16),
                "pct": d.get("pct").and_then(Value::as_u64),
            }));
        }
    }
    wrap(
        &DISKS,
        v.get("generated_at").and_then(Value::as_u64),
        now,
        json!({"drives": drives.into_iter().take(12).collect::<Vec<_>>()}),
    )
}

/// One status dot per monitored product endpoint.
pub fn sites_from(text: &str, now: u64) -> Value {
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return fail(&SITES, "bad json");
    };
    let items: Vec<Value> = v
        .get("results")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .take(16)
                .map(|r| {
                    json!({
                        "name": short(r.get("name"), 28),
                        "ok": r.get("ok").and_then(Value::as_bool).unwrap_or(false),
                        "ms": r.get("ms").and_then(Value::as_u64),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    wrap(
        &SITES,
        v.get("at").and_then(Value::as_u64),
        now,
        json!({"items": items}),
    )
}

/// Newest sweep of the MCP liveness history. Only Tanner's own surfaces (hermes-default, omp) are
/// counted; other tenants are ignored.
pub fn mcp_from(text: &str, now: u64) -> Value {
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return fail(&MCP, "bad json");
    };
    let last = match &v {
        Value::Array(a) => a.last(),
        o => Some(o),
    };
    let Some(sc) = last
        .and_then(|l| l.get("surface_counts"))
        .and_then(Value::as_object)
    else {
        return fail(&MCP, "no sweep");
    };
    let (mut up, mut down) = (0u64, 0u64);
    for s in ["hermes-default", "omp"] {
        up += sc
            .get(s)
            .and_then(|c| c.get("ok"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        down += sc
            .get(s)
            .and_then(|c| c.get("fail"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
    }
    let t = last
        .and_then(|l| l.get("timestamp"))
        .and_then(Value::as_str)
        .and_then(iso_to_epoch);
    wrap(&MCP, t, now, json!({"up": up, "down": down}))
}

/// Keys that may hold credentials. They are dropped wherever they appear in a feed.
pub(crate) fn secret_key(k: &str) -> bool {
    let k = k.to_ascii_lowercase();
    k == "token"
        || k == "key"
        || k.contains("password")
        || k.contains("secret")
        || k.contains("api_key")
        || k.contains("apikey")
        || k.contains("authorization")
        || k.contains("cookie")
        || k.ends_with("_token")
}

/// Bounded copy of a collector value: control characters stripped, strings and lists capped,
/// depth limited, credential-shaped keys dropped. Numbers, booleans and null pass unchanged,
/// so a measured 0 stays 0 and an unknown stays null.
pub(crate) fn clean(v: &Value, depth: u8, max_items: usize) -> Value {
    match v {
        Value::String(s) => Value::String(
            s.chars()
                .filter(|c| !c.is_control())
                .take(400)
                .collect::<String>(),
        ),
        Value::Array(a) if depth < 6 => Value::Array(
            a.iter()
                .take(max_items)
                .map(|x| clean(x, depth + 1, 200))
                .collect(),
        ),
        Value::Object(m) if depth < 6 => Value::Object(
            m.iter()
                .filter(|(k, _)| !secret_key(k))
                .take(64)
                .map(|(k, x)| {
                    let k: String = k.chars().filter(|c| !c.is_control()).take(48).collect();
                    (k, clean(x, depth + 1, 200))
                })
                .collect(),
        ),
        Value::Array(_) | Value::Object(_) => Value::Null,
        x => x.clone(),
    }
}

/// `clean` caps text at 400 characters. A draft pitch is longer than that, so each gig keeps its own `pitch` up to
/// 2000 characters (no control characters except line breaks). Rows match by position: `clean` keeps the order.
fn keep_pitches(src: &Map<String, Value>, out: &mut Map<String, Value>) {
    let (Some(Value::Array(raw)), Some(Value::Array(rows))) = (src.get("gigs"), out.get_mut("gigs")) else {
        return;
    };
    for (r, row) in raw.iter().zip(rows.iter_mut()) {
        if let (Some(p), Value::Object(o)) = (r.get("pitch").and_then(Value::as_str), row) {
            o.insert("pitch".into(), Value::String(p.chars().filter(|c| !c.is_control() || *c == '\n').take(2000).collect()));
        }
    }
}

/// One deck v6 feed. `t` comes from the file (else its mtime), staleness uses the collector's own
/// `refresh`, `src` from the file is passed on as `sources` (our `src` is the file path), and
/// `errors` are kept as `{source, reason}` text so a failed part is never shown as zero.
pub fn deck_feed_from(d: &Def, text: &str, mtime: Option<u64>, now: u64) -> Value {
    let Ok(Value::Object(mut m)) = serde_json::from_str::<Value>(text) else {
        return fail(d, "bad json");
    };
    let extra = prepare(d.name, &mut m);
    let t = m
        .get("t")
        .and_then(Value::as_u64)
        .filter(|t| *t > 1_500_000_000 && *t <= now + 300)
        .or(mtime);
    let refresh = m
        .get("refresh")
        .and_then(Value::as_u64)
        .filter(|r| (10..=604_800).contains(r))
        .unwrap_or(d.refresh);
    let mut o = Map::new();
    for k in feed_keys(d.name) {
        if let Some(v) = m.get(*k) {
            let max = match (d.name, *k) {
                ("launch", "items") => 4000,
                // the collector selects MAX_LISTINGS (1200 since 2026-11-01) across all categories; a 200 cap
                // silently dropped categories and made chip counts disagree with the market block
                ("jobs" | "jobs-casey" | "jobs-riley" | "jobs-morgan", "listings") => 1200,
                ("gigs", "gigs") => 500,
                // the collector keeps up to HOME_MAX 6000 homes and COMMERCIAL_MAX 4000 commercial rows (ops/bin/deck-feed-realestate); the live feed carried
                // 1572 homes and 1871 commercial rows on 2026-11-14, so a 1200 cap made "Showing N of M" read M = 1200 and hid the rest.
                // 2026-11-17: 6000 since the five-county multifamily searches add about 4,000 duplex to apartment-building listings
                ("realestate", "homes") => crate::listings::HOMES_MAX,
                ("realestate", "commercial") => crate::listings::COMMERCIAL_MAX,
                _ => 200,
            };
            o.insert((*k).to_string(), clean(v, 0, max));
        }
    }
    if d.name == "gigs" {
        keep_pitches(&m, &mut o);
    }
    let sources: Vec<Value> = m
        .get("src")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .take(24)
                .map(|s| json!(short(Some(s), 60)))
                .collect()
        })
        .unwrap_or_default();
    let mut errors: Vec<Value> = m
        .get("errors")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .take(24)
                .map(|e| {
                    let mut error = json!({"source": short(e.get("source"), 60), "reason": short(e.get("reason"), 160)});
                    if d.name == "products" {
                        for field in ["tenant", "scope"] {
                            if let Some(scope) = e.get(field) { error[field] = scope.clone(); }
                        }
                    }
                    retry_facts(e, &mut error);
                    error
                })
                .collect()
        })
        .unwrap_or_default();
    errors.extend(extra.into_iter().take(24usize.saturating_sub(errors.len())));
    o.insert("sources".into(), Value::Array(sources));
    o.insert("errors".into(), Value::Array(errors));
    let mut v = wrap(d, t, now, Value::Object(o));
    let age = t.map(|t| now.saturating_sub(t));
    v["refresh"] = refresh.into();
    v["stale"] = age.map(|a| a > 2 * refresh).unwrap_or(true).into();
    if d.name == "portfolio" {
        date_portfolio_basis(&mut v, now);
    }
    v
}

/// `basis.equity_qty_age_days` and `basis.crypto_live` are counted by the collector when it writes the file. Served a day or a
/// week later they would still read "1 day old" and "live", so both are rebuilt here from the feed's own stamps and the clock,
/// as the page does: the equity age comes from `as_of.positions` (else `basis.equity_qty_as_of`), a stamp past the clock, a stamp
/// of zero or below, or no stamp is unknown (null, never 0 days and never 20,000), and crypto is live only while the feed is not
/// stale and its balance is under a day old.
fn date_portfolio_basis(v: &mut Value, now: u64) {
    let stale = v.get("stale").and_then(Value::as_bool).unwrap_or(true);
    let positive = |n: &&Value| n.is_number() && n.as_f64().is_some_and(|f| f > 0.0);
    let as_of_positions = v.get("as_of").and_then(|a| a.get("positions")).filter(positive).cloned();
    let Some(Value::Object(b)) = v.get_mut("basis") else { return };
    let stamp = |n: Option<&Value>| n.and_then(Value::as_u64).filter(|t| *t > 0 && *t <= now + 300);
    if b.contains_key("equity_qty_age_days") {
        let at = as_of_positions.or_else(|| b.get("equity_qty_as_of").filter(positive).cloned());
        b.insert("equity_qty_age_days".into(), json!(stamp(at.as_ref()).map(|t| now.saturating_sub(t) / 86_400)));
    }
    if b.get("crypto_live") == Some(&Value::Bool(true)) {
        let fresh = stamp(b.get("crypto_qty_as_of")).is_some_and(|t| now.saturating_sub(t) < 86_400);
        b.insert("crypto_live".into(), Value::Bool(!stale && fresh));
    }
}

/// Printable text of at most `n` characters, or null when absent, not text or blank.
fn opt_text(v: Option<&Value>, n: usize) -> Value {
    match v.and_then(Value::as_str) {
        Some(s) if !s.trim().is_empty() => Value::String(s.chars().filter(|c| !c.is_control()).take(n).collect()),
        _ => Value::Null,
    }
}

/// Whole number (negative allowed), else null. A float with a fraction is not a count.
fn opt_int(v: Option<&Value>) -> Value {
    match v {
        Some(Value::Number(n)) => n
            .as_i64()
            .or_else(|| n.as_f64().filter(|f| f.fract() == 0.0 && f.abs() < 9.0e15).map(|f| f as i64))
            .map(Value::from)
            .unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

fn opt_bool(v: Option<&Value>) -> Value {
    v.and_then(Value::as_bool).map(Value::from).unwrap_or(Value::Null)
}

/// Every dotted-quad IPv4 address becomes `localhost` (127.0.0.1) or `<ip>`, so no address leaves in free text.
fn scrub_ips(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < b.len() {
        if b[i].is_ascii_digit() {
            let mut j = i;
            while j < b.len() && (b[j].is_ascii_digit() || b[j] == b'.') {
                j += 1;
            }
            let run = s[i..j].trim_end_matches('.');
            let parts: Vec<&str> = run.split('.').collect();
            let quad = parts.len() == 4 && parts.iter().all(|p| (1..=3).contains(&p.len()) && p.bytes().all(|c| c.is_ascii_digit()));
            if quad {
                out.push_str(if run == "127.0.0.1" { "localhost" } else { "<ip>" });
                out.push_str(&s[i + run.len()..j]);
            } else {
                out.push_str(&s[i..j]);
            }
            i = j;
        } else {
            match s[i..].chars().next() {
                Some(ch) => {
                    out.push(ch);
                    i += ch.len_utf8();
                }
                None => break,
            }
        }
    }
    out
}

/// A device, host or alert that belongs to Morgan's tenant (names such as `lo-phone`, `los-macbook-air`, `Lo's phone`,
/// `grok-bot-box-lo`). The owner's Deck never lists them.
fn other_tenant(s: &str) -> bool {
    let s = s.trim().to_lowercase();
    s == "lo"
        || s.contains("morgan")
        || s.contains("quill")
        || ["lo-", "los-", "lo's", "lo\u{2019}s"].iter().any(|p| s.starts_with(p))
        || s.ends_with("-lo")
}

/// Reshape the three owner feeds to their contract (C1) before the generic key filter runs. Returns extra `errors`
/// rows for parts that failed, so a missing list or a per-app error is never shown as zero.
fn prepare(name: &str, m: &mut Map<String, Value>) -> Vec<Value> {
    match name {
        "testflight" => prepare_testflight(m),
        "tailscale" => prepare_tailscale(m),
        "deadlines" => prepare_deadlines(m),
        "calendar" => prepare_calendar(m),
        "travel-deals" | "outdoors" | "life" | "history-goodnews" => prepare_contract(m),
        "trends" => prepare_trends(m),
        "gaps" => prepare_gaps(m),
        "portfolio" => prepare_portfolio(m),
        "serverpage" => prepare_serverpage(m),
        _ => Vec::new(),
    }
}

/// An older branch's file may hold a Gmail count: only health and local schedule metadata leave this route.
fn prepare_serverpage(m: &mut Map<String, Value>) -> Vec<Value> {
    for (block, keys) in [
        ("gateway", &["ok", "state", "reason", "platforms_up", "platforms_on", "reply_ms", "restarts",
            "restarts_reason", "since", "up", "off", "down", "checks_failed", "read_at", "stale"][..]),
        ("mail", &["next", "items", "paused_mail_crons", "reason", "read_at", "stale"][..]),
    ] {
        if let Some(Value::Object(part)) = m.get_mut(block) {
            part.retain(|key, _| keys.contains(&key.as_str()));
            if block == "mail" {
                if let Some(Value::Object(next)) = part.get_mut("next") {
                    next.retain(|key, _| ["name", "at", "kind"].contains(&key.as_str()));
                }
                if let Some(Value::Array(items)) = part.get_mut("items") {
                    for row in items {
                        if let Value::Object(row) = row {
                            row.retain(|key, _| ["name", "at", "kind"].contains(&key.as_str()));
                        }
                    }
                }
            }
        }
    }
    Vec::new()
}

/// `/api/portfolio` is the public view of the holdings: symbol, price and day percent only. The top-level key filter
/// does not look inside `basis`, `totals` or `positions`, so a collector (or a stray field) that put a quantity, a
/// value, a dollar change or cash there would leave the machine before any Reveal tap. Each nested object is rebuilt
/// from an allow-list here, and each allowed key keeps only its contract type: a number, a flag, a ticker, an enum or
/// short prose with no amount in it. A wrong type reads as unknown (null), never as a value; amounts exist only in
/// `portfolio-values`, behind the Reveal gate.
fn prepare_portfolio(m: &mut Map<String, Value>) -> Vec<Value> {
    fn number(v: Option<&Value>) -> Value {
        match v {
            Some(n @ Value::Number(_)) => n.clone(),
            _ => Value::Null,
        }
    }
    fn count(v: Option<&Value>) -> Value {
        json!(v.and_then(Value::as_u64).filter(|n| *n <= 10_000_000))
    }
    fn flag(v: Option<&Value>) -> Value {
        v.and_then(Value::as_bool).map_or(Value::Null, Value::Bool)
    }
    fn prose(v: Option<&Value>) -> Value {
        crate::finance::note(v, 200).map_or(Value::Null, Value::String)
    }
    fn ticker(v: Option<&Value>) -> Option<String> {
        v.and_then(Value::as_str)
            .filter(|s| (1..=16).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '^' | '=')))
            .map(str::to_string)
    }
    // a company name carries digits only as part of a word ("3M", "20+ Year", "S&P 500"). A bare number with a group separator or
    // more than three digits, a run of four or more digits, a `12k` style suffix or a money word would be a quantity or a value, so the
    // name reads unknown instead.
    fn label(v: Option<&Value>) -> Value {
        let s: String = v.and_then(Value::as_str).unwrap_or("").trim().chars().take(60).collect();
        let money_word = |w: &str| ["usd", "dollar", "dollars", "eur", "euro", "euros", "gbp", "bucks"].contains(&w.to_lowercase().as_str());
        let amountish = |t: &str| {
            let t = t.trim_matches(|c: char| !c.is_alphanumeric());
            if !t.chars().any(char::is_numeric) {
                return false;
            }
            if t.chars().all(|c| c.is_numeric() || matches!(c, '.' | ',' | '\'' | '_')) {
                return !(t.len() <= 3 && t.chars().all(|c| c.is_ascii_digit()));
            }
            let (mut run, mut longest) = (0usize, 0usize);
            for c in t.chars() {
                run = if c.is_numeric() { run + 1 } else { 0 };
                longest = longest.max(run);
            }
            let scaled = t.strip_suffix(['k', 'K', 'm', 'M', 'b', 'B']).is_some_and(|d| d.len() >= 2 && d.chars().all(|c| c.is_ascii_digit() || c == '.'));
            longest >= 4 || scaled
        };
        if s.is_empty() || s.contains(['$', '€', '£', '¥', '₹']) || s.split(|c: char| !c.is_alphanumeric()).any(money_word) || s.split_whitespace().any(amountish) {
            Value::Null
        } else {
            Value::String(s)
        }
    }
    type ValueField = (&'static str, fn(Option<&Value>) -> Value);
    fn rebuild(v: Option<&Value>, keys: &[ValueField]) -> Value {
        let Some(Value::Object(o)) = v else { return Value::Null };
        Value::Object(keys.iter().filter(|(k, _)| o.contains_key(*k)).map(|(k, f)| ((*k).to_string(), f(o.get(*k)))).collect())
    }
    for key in ["basis", "totals"] {
        if let Some(v) = m.get(key).cloned() {
            let keys: &[ValueField] = if key == "basis" {
                &[
                    ("equity_qty_as_of", number),
                    ("equity_qty_age_days", number),
                    ("equity_qty_source", prose),
                    ("crypto_qty_as_of", number),
                    ("crypto_live", flag),
                    ("crypto_qty_source", prose),
                    ("price_note", prose),
                ]
            } else {
                &[
                    ("day_pct", number),
                    ("equity_day_pct", number),
                    ("crypto_day_pct", number),
                    ("positions", count),
                    ("priced", count),
                    ("margin_in_use", flag),
                ]
            };
            m.insert(key.into(), rebuild(Some(&v), keys));
        }
    }
    if let Some(v) = m.get("as_of").cloned() {
        m.insert("as_of".into(), match v {
            Value::Number(_) => v,
            Value::Object(o) => Value::Object(o.into_iter().filter(|(k, n)| matches!(k.as_str(), "positions" | "crypto" | "prices") && n.is_number()).collect()),
            _ => Value::Null,
        });
    }
    if let Some(v) = m.get("as_of_note").cloned() {
        m.insert("as_of_note".into(), prose(Some(&v)));
    }
    if let Some(v) = m.get("positions").cloned() {
        let rows = match v {
            Value::Array(rows) => Value::Array(
                rows.iter()
                    .filter_map(|r| {
                        let symbol = ticker(r.get("symbol"))?;
                        let mut o = Map::new();
                        o.insert("symbol".into(), Value::String(symbol));
                        for (k, f) in [("kind", kind as fn(Option<&Value>) -> Value), ("name", label), ("price", number), ("chg", number), ("pct", number), ("t", number)] {
                            if r.get(k).is_some() {
                                o.insert(k.into(), f(r.get(k)));
                            }
                        }
                        Some(Value::Object(o))
                    })
                    .collect(),
            ),
            _ => Value::Null,
        };
        m.insert("positions".into(), rows);
    }
    // collector diagnostics ride on this public route too: a line that could carry an amount is replaced, never passed on
    let screen = |v: &Value, n: usize| crate::finance::diag(Some(v), n).map_or_else(|| Value::String("detail withheld".into()), Value::String);
    if let Some(Value::Array(rows)) = m.get_mut("errors") {
        for row in rows.iter_mut().filter_map(Value::as_object_mut) {
            for (k, n) in [("source", 60), ("reason", 160)] {
                if let Some(v) = row.get(k).cloned() {
                    row.insert(k.into(), screen(&v, n));
                }
            }
        }
    }
    if let Some(Value::Array(src)) = m.get_mut("src") {
        for s in src.iter_mut() {
            *s = screen(s, 60);
        }
    }
    fn kind(v: Option<&Value>) -> Value {
        match v.and_then(Value::as_str) {
            Some(k @ ("equity" | "crypto")) => json!(k),
            _ => Value::Null,
        }
    }
    Vec::new()
}

/// Shared feed contract (2026-10-30) to the deck v6 shape: ISO `generated_at` becomes `t` when the file has none,
/// `sources[].name` becomes `src`, and each `errors[].error` becomes `reason`, so the generic reader keeps the source
/// names and a failed source is never shown as zero items.
fn prepare_contract(m: &mut Map<String, Value>) -> Vec<Value> {
    if m.get("t").is_none() {
        if let Some(t) = m.get("generated_at").and_then(Value::as_str).and_then(iso_to_epoch) {
            m.insert("t".into(), json!(t));
        }
    }
    if m.get("src").is_none() {
        if let Some(names) = m.get("sources").and_then(Value::as_array).map(|a| {
            a.iter()
                .filter_map(|s| s.get("name").and_then(Value::as_str).or_else(|| s.as_str()))
                .map(|s| json!(s))
                .collect::<Vec<_>>()
        }) {
            m.insert("src".into(), Value::Array(names));
        }
    }
    if let Some(Value::Array(errors)) = m.get_mut("errors") {
        for e in errors.iter_mut() {
            if let Value::Object(o) = e {
                if o.get("reason").is_none() {
                    if let Some(why) = o.get("error").cloned() {
                        o.insert("reason".into(), why);
                    }
                }
            }
        }
    }
    Vec::new()
}

/// A JSON number as given, else null (the text "12" is not a number).
fn opt_num(v: Option<&Value>) -> Value {
    match v {
        Some(n @ Value::Number(_)) => n.clone(),
        _ => Value::Null,
    }
}

/// A number that is zero or more (a price, a ratio), else null.
fn opt_nonneg(v: Option<&Value>) -> Value {
    match v.and_then(Value::as_f64) {
        Some(f) if f >= 0.0 => opt_num(v),
        _ => Value::Null,
    }
}

/// An http(s) link of at most 600 characters with no space, quote, angle bracket, backslash or `@` (the page's own
/// `safeUrl` rule), else null.
fn opt_url(v: Option<&Value>) -> Value {
    let Some(s) = v.and_then(Value::as_str) else { return Value::Null };
    let lower = s.get(..8).unwrap_or(s).to_ascii_lowercase();
    let rest = if lower.starts_with("https://") { &s[8..] } else if lower.starts_with("http://") { &s[7..] } else { "" };
    let ok = !rest.is_empty()
        && s.chars().count() <= 600
        && !s.chars().any(|c| c.is_whitespace() || c.is_control() || matches!(c, '"' | '\'' | '<' | '>' | '\\' | '@'));
    if ok { Value::String(s.to_string()) } else { Value::Null }
}

/// An ISO time or a plain `YYYY-MM-DD` date, kept as written; anything else is null (an as-of that does not parse is not one).
fn opt_iso(v: Option<&Value>) -> Value {
    match v.and_then(Value::as_str).map(str::trim) {
        Some(s) if s.len() <= 40 && (iso_to_epoch(s).is_some() || (s.len() == 10 && iso_to_epoch(&format!("{s}T00:00:00Z")).is_some())) => {
            Value::String(s.to_string())
        }
        _ => Value::Null,
    }
}

/// Rebuild one contract list row by row (`row` returns None for a row missing a required field). A list that is absent or
/// not a list is removed and named in an error row, and dropped rows are counted in one, so a broken part reads as not
/// reporting, never as an empty list.
fn rebuild_rows(m: &mut Map<String, Value>, key: &str, errors: &mut Vec<Value>, row: fn(&Map<String, Value>) -> Option<Value>) {
    match m.remove(key) {
        Some(Value::Array(a)) => {
            let rows: Vec<Value> = a.iter().filter_map(|x| x.as_object().and_then(row)).collect();
            let dropped = a.len() - rows.len();
            if dropped > 0 {
                errors.push(error_row(key, &format!("{dropped} of {} rows dropped: a required field was missing or malformed", a.len())));
            }
            m.insert(key.into(), Value::Array(rows));
        }
        Some(_) => errors.push(error_row(key, "not a list")),
        None => errors.push(error_row(key, "missing from the file")),
    }
}

fn trend_product(o: &Map<String, Value>) -> Option<Value> {
    let title = opt_text(o.get("title"), 200);
    if title.is_null() {
        return None;
    }
    let rank = opt_int(o.get("rank"));
    Some(json!({
        "title": title,
        "category": opt_text(o.get("category"), 40),
        "source": opt_text(o.get("source"), 80),
        "source_id": opt_text(o.get("source_id"), 60),
        "rank": if rank.as_i64().is_some_and(|r| r >= 1) { rank } else { Value::Null },
        "rank_change": opt_int(o.get("rank_change")),
        "signal": opt_text(o.get("signal"), 160),
        "price_median": opt_nonneg(o.get("price_median")),
        "url": opt_url(o.get("url")),
    }))
}

fn trend_ticker(o: &Map<String, Value>) -> Option<Value> {
    let symbol = o
        .get("symbol")
        .and_then(Value::as_str)
        .filter(|s| (1..=16).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '^' | '=')))?;
    Some(json!({
        "symbol": symbol,
        "name": opt_text(o.get("name"), 80),
        "price": opt_nonneg(o.get("price")),
        "pct": opt_num(o.get("pct")),
        "volume_ratio": opt_nonneg(o.get("volume_ratio")),
        "reason": opt_text(o.get("reason"), 160),
        "source": opt_text(o.get("source"), 80),
        "source_id": opt_text(o.get("source_id"), 60),
    }))
}

fn trend_search(o: &Map<String, Value>) -> Option<Value> {
    let term = opt_text(o.get("term"), 120);
    if term.is_null() {
        return None;
    }
    Some(json!({
        "term": term,
        "region": opt_text(o.get("region"), 40),
        "growth_pct": opt_num(o.get("growth_pct")),
        "source": opt_text(o.get("source"), 80),
        "source_id": opt_text(o.get("source_id"), 60),
    }))
}

fn source_health(o: &Map<String, Value>) -> Option<Value> {
    let id = opt_text(o.get("id"), 60);
    if id.is_null() {
        return None;
    }
    Some(json!({
        "id": id,
        "ok": opt_bool(o.get("ok")),
        "age_s": json!(o.get("age_s").and_then(Value::as_u64)),
        "error": opt_text(o.get("error"), 160),
    }))
}

/// `trends.json` (World view contract, 2026-11-17). ISO `generated_at` becomes `t` when the file has none; the contract's
/// `sources[]` is served as `feeds` (its ids become `src` when the file has none), and a source with `ok:false` becomes an
/// error row unless the file already names it in `errors`. Products, tickers and searches are rebuilt field by field from the
/// contract, so nothing outside it (a quantity, a balance, an address) leaves the machine.
fn prepare_trends(m: &mut Map<String, Value>) -> Vec<Value> {
    let mut errors = Vec::new();
    stamp_generated(m);
    let named: Vec<String> = m.get("errors").and_then(Value::as_array).map(|a| a.iter().map(|e| short(e.get("source"), 60)).collect()).unwrap_or_default();
    match m.remove("sources") {
        Some(Value::Array(a)) => {
            let feeds: Vec<Value> = a.iter().filter_map(|x| x.as_object().and_then(source_health)).take(24).collect();
            for f in &feeds {
                let id = short(f.get("id"), 60);
                if f["ok"] == Value::Bool(false) && !named.contains(&id) {
                    errors.push(error_row(&id, f["error"].as_str().unwrap_or("did not report")));
                }
            }
            if !m.contains_key("src") {
                m.insert("src".into(), Value::Array(feeds.iter().map(|f| f["id"].clone()).collect()));
            }
            m.insert("feeds".into(), Value::Array(feeds));
        }
        _ => errors.push(error_row("sources", "no source list")),
    }
    rebuild_rows(m, "products", &mut errors, trend_product);
    rebuild_rows(m, "tickers", &mut errors, trend_ticker);
    rebuild_rows(m, "searches", &mut errors, trend_search);
    errors
}

/// ISO `generated_at` stands in for `t` when the file has none.
fn stamp_generated(m: &mut Map<String, Value>) {
    if m.get("t").and_then(Value::as_u64).is_none() {
        if let Some(t) = m.get("generated_at").and_then(Value::as_str).and_then(iso_to_epoch) {
            m.insert("t".into(), json!(t));
        }
    }
}

const GAP_DOMAINS: [&str; 8] = ["ecom", "residential", "commercial", "jobs", "gigs", "surf", "local", "ai"];

/// "public job boards (ashby, dice, ... ziprecruiter)": a parenthesised member list of more than three names becomes a count, so the
/// 80 character cap on an evidence source never cuts a list off mid-name ("(ashby, dice, governmentjobs, greenhouse, himalayas, hn_hiring").
fn compact_members(s: &str) -> String {
    if let (Some(open), Some(close)) = (s.find('('), s.rfind(')')) {
        let inner = s.get(open + 1..close).unwrap_or("");
        if open < close && !inner.contains('(') && inner.split(',').count() > 3 {
            return format!("{} ({} sources){}", s[..open].trim_end(), inner.split(',').count(), &s[close + 1..]);
        }
    }
    s.to_string()
}

fn gap_evidence(o: &Map<String, Value>) -> Option<Value> {
    // every number traces to a named source: a row without one is not evidence
    let compact = o.get("source").and_then(Value::as_str).map(|s| Value::String(compact_members(s)));
    let source = opt_text(compact.as_ref(), 80);
    if source.is_null() {
        return None;
    }
    let value = match o.get("value") {
        Some(Value::Number(n)) => Value::String(n.to_string()),
        v => opt_text(v, 80),
    };
    Some(json!({"source": source, "metric": opt_text(o.get("metric"), 80), "value": value, "as_of": opt_iso(o.get("as_of"))}))
}

fn gap_item(o: &Map<String, Value>) -> Option<Value> {
    let title = opt_text(o.get("title"), 160);
    let domain = o.get("domain").and_then(Value::as_str).filter(|d| GAP_DOMAINS.contains(d))?;
    if title.is_null() {
        return None;
    }
    let score = opt_int(o.get("gap_score")).as_i64().filter(|s| (0..=100).contains(s));
    let evidence: Vec<Value> = o
        .get("evidence")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|x| x.as_object().and_then(gap_evidence)).take(12).collect())
        .unwrap_or_default();
    Some(json!({
        "id": opt_text(o.get("id"), 60),
        "title": title,
        "domain": domain,
        "demand_signal": opt_text(o.get("demand_signal"), 200),
        "supply_signal": opt_text(o.get("supply_signal"), 200),
        "gap_score": score,
        "evidence": evidence,
        "next_step": opt_text(o.get("next_step"), 240),
    }))
}

/// `gaps.json` (World view contract): ISO `generated_at` becomes `t` when the file has none; each item keeps the contract
/// fields, a known `domain` and a whole `gap_score` from 0 to 100 (else null), and its evidence rows that name a source.
fn prepare_gaps(m: &mut Map<String, Value>) -> Vec<Value> {
    let mut errors = Vec::new();
    stamp_generated(m);
    let method = opt_text(m.get("method"), 300);
    m.insert("method".into(), method);
    rebuild_rows(m, "items", &mut errors, gap_item);
    errors
}

/// Calendar: Tanner's own calendars only. An event or source row that names another tenant (`other_tenant`: LOTO,
/// Morgan, Quill) is dropped here, so it never reaches a browser. Every event keeps `id, title, all_day, start, end, kind,
/// source`; `location`, `sources` and `conflicts` are dropped because the deck prints the time and the title only. A source
/// the producer could not read becomes one error row.
fn calendar_tenant(s: &str) -> bool {
    let lower = s.to_lowercase();
    other_tenant(s) || lower.contains("loto")
}

fn prepare_calendar(m: &mut Map<String, Value>) -> Vec<Value> {
    let mut errors = Vec::new();
    // The envelope already owns `sources` (the list of files a feed was built from), so the calendar's own source rows
    // are served as `calendars`; otherwise the envelope would overwrite them with an empty list.
    if let Some(srcs) = m.remove("sources") {
        m.insert("calendars".into(), srcs);
    }
    if let Some(Value::Array(srcs)) = m.get_mut("calendars") {
        srcs.retain(|s| !calendar_tenant(&short(s.get("name"), 60)));
        let mut bad: Vec<String> = Vec::new();
        for s in srcs.iter_mut() {
            if s.get("ok").and_then(Value::as_bool) == Some(false) {
                bad.push(short(s.get("name"), 60));
            }
            if let Some(o) = s.as_object_mut() {
                o.retain(|k, _| matches!(k.as_str(), "name" | "kind" | "ok"));
            }
        }
        for name in bad {
            errors.push(error_row(&name, "this calendar did not report"));
        }
    }
    if let Some(Value::Array(days)) = m.get_mut("days") {
        for d in days.iter_mut() {
            let Some(o) = d.as_object_mut() else { continue };
            let Some(Value::Array(evs)) = o.get_mut("events") else { continue };
            evs.retain(|e| {
                let source = short(e.get("source"), 60);
                let listed = e
                    .get("sources")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().any(|s| calendar_tenant(&short(Some(s), 60))))
                    .unwrap_or(false);
                !calendar_tenant(&source) && !listed
            });
            for e in evs.iter_mut() {
                if let Some(o) = e.as_object_mut() {
                    o.retain(|k, _| {
                        matches!(k.as_str(), "id" | "title" | "all_day" | "start" | "end" | "kind" | "source")
                    });
                }
            }
        }
    }
    errors
}

fn error_row(source: &str, reason: &str) -> Value {
    json!({"source": source, "reason": reason})
}

/// `testflight.json` has no top-level `t` or `refresh` until the collector adds them (schema v1 carries `checked_at` and
/// `refresh_s`), so those two stand in and the page shows STALE from the check time. Bundle ids, build ids and submission
/// ids are dropped.
fn prepare_testflight(m: &mut Map<String, Value>) -> Vec<Value> {
    let mut errors = Vec::new();
    if !m.contains_key("t") {
        let at = m.get("checked_at").and_then(Value::as_str).and_then(iso_to_epoch);
        if let Some(t) = at {
            m.insert("t".into(), t.into());
        }
    }
    if !m.contains_key("refresh") {
        if let Some(r) = m.get("refresh_s").cloned() {
            m.insert("refresh".into(), r);
        }
    }
    let Some(list) = m.get("apps").and_then(Value::as_array) else {
        m.remove("apps");
        errors.push(error_row("testflight", "no apps list"));
        return errors;
    };
    let mut apps = Vec::new();
    for a in list.iter().filter(|a| a.is_object()).take(24) {
        let name = short(a.get("name"), 60);
        let error = opt_text(a.get("error"), 160);
        if let Some(reason) = error.as_str() {
            errors.push(error_row(&name, reason));
        }
        let lb = a.get("latest_build").filter(|b| b.is_object()).map(|b| {
            json!({
                "number": opt_text(b.get("number"), 16),
                "version": opt_text(b.get("version"), 16),
                "uploaded_at": opt_text(b.get("uploaded_at"), 40),
                "processing_state": opt_text(b.get("processing_state"), 32),
                "expired": opt_bool(b.get("expired")),
                "internal_state": opt_text(b.get("internal_state"), 32),
                "external_state": opt_text(b.get("external_state"), 48),
            })
        });
        let fb = a.get("feedback").filter(|f| f.is_object()).map(|f| {
            json!({
                "screenshots_count": opt_int(f.get("screenshots_count")),
                "crashes_count": opt_int(f.get("crashes_count")),
                "last_received_at": opt_text(f.get("last_received_at"), 40),
            })
        });
        let versions: Vec<Value> = a
            .get("versions")
            .and_then(Value::as_array)
            .map(|vs| {
                vs.iter()
                    .filter(|v| v.is_object())
                    .take(8)
                    .map(|v| {
                        json!({
                            "version": opt_text(v.get("version"), 16),
                            "state": opt_text(v.get("state"), 40),
                            "build": opt_text(v.get("submitted_build").and_then(|b| b.get("number")), 16),
                            "submission_state": opt_text(v.get("submission").and_then(|s| s.get("state")), 40),
                            "submitted_at": opt_text(v.get("submission").and_then(|s| s.get("submitted_at")), 40),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        apps.push(json!({
            "id": opt_text(a.get("id"), 24),
            "name": name,
            "checked_at": opt_text(a.get("checked_at"), 40),
            "error": error,
            "latest_build": lb,
            "feedback": fb,
            "versions": versions,
        }));
    }
    m.insert("apps".into(), Value::Array(apps));
    errors
}

/// `tailscale.json`: no IPs, rx/tx, key ages or relay, only the rows the Network card reads. Morgan's devices and their
/// alerts are removed first and every count is recomputed from what is left, so the totals match the rows.
fn prepare_tailscale(m: &mut Map<String, Value>) -> Vec<Value> {
    let mut errors = Vec::new();
    if m.get("ok").and_then(Value::as_bool) == Some(false) {
        errors.push(error_row("tailscale", "collector reported a failed run"));
    }
    let file_counts = m.get("counts").cloned().unwrap_or(Value::Null);
    let mut counts = Map::new();
    let mut alert_rows: Vec<Value> = Vec::new();
    match m.get("alerts").and_then(Value::as_array) {
        Some(list) => {
            for a in list.iter().filter(|a| a.is_object() && !other_tenant(&short(a.get("host"), 60))) {
                alert_rows.push(json!({
                    "host": opt_text(a.get("host"), 40),
                    "kind": opt_text(a.get("kind"), 32),
                    "msg": opt_text(Some(&json!(scrub_ips(&short(a.get("msg"), 200)))), 160),
                    "severity": opt_text(a.get("severity"), 12),
                }));
                if alert_rows.len() == 40 {
                    break;
                }
            }
            let sev = |s: &str| alert_rows.iter().filter(|a| a["severity"] == s).count();
            counts.insert("warn".into(), sev("warn").into());
            counts.insert("crit".into(), sev("crit").into());
        }
        None => {
            errors.push(error_row("tailscale", "no alerts list"));
            for k in ["warn", "crit"] {
                counts.insert(k.into(), file_counts.get(k).cloned().unwrap_or(Value::Null));
            }
        }
    }
    let nodes: Option<Vec<Value>> = m.get("nodes").and_then(Value::as_array).map(|list| {
        list.iter()
            .filter(|n| n.is_object())
            .filter(|n| !other_tenant(&short(n.get("name"), 60)) && !other_tenant(&short(n.get("host"), 60)))
            .take(40)
            .map(|n| {
                json!({
                    "name": opt_text(n.get("name"), 40),
                    "host": opt_text(n.get("host"), 40),
                    "online": n.get("online").and_then(Value::as_bool).unwrap_or(false),
                    "last_seen_h": n.get("last_seen_h").and_then(Value::as_f64).map(|h| (h * 10.0).round() / 10.0),
                    "os": opt_text(n.get("os"), 16),
                    "kind": opt_text(n.get("kind"), 8),
                })
            })
            .collect()
    });
    match &nodes {
        Some(rows) => {
            let own = |r: &&Value| matches!(r["kind"].as_str(), Some("own" | "self"));
            counts.insert("own_devices".into(), rows.iter().filter(own).count().into());
            counts.insert("own_online".into(), rows.iter().filter(own).filter(|r| r["online"] == true).count().into());
        }
        None => {
            errors.push(error_row("tailscale", "no nodes list"));
            for k in ["own_devices", "own_online"] {
                counts.insert(k.into(), file_counts.get(k).cloned().unwrap_or(Value::Null));
            }
        }
    }
    let exposures: Option<Vec<Value>> = m.get("exposures").and_then(Value::as_array).map(|list| {
        list.iter()
            .filter(|e| e.is_object() && !other_tenant(&short(e.get("host"), 60)))
            .take(64)
            .map(|e| {
                let port = match e.get("port") {
                    Some(Value::String(s)) => s.parse::<u64>().map(Value::from).unwrap_or_else(|_| opt_text(Some(&json!(s)), 8)),
                    other => opt_int(other),
                };
                let funnel = match e.get("funnel") {
                    Some(Value::Bool(b)) => *b,
                    Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0),
                    _ => false,
                };
                json!({"host": opt_text(e.get("host"), 40), "port": port, "path": opt_text(e.get("path"), 80),
                       "proto": opt_text(e.get("proto"), 8), "funnel": funnel})
            })
            .collect()
    });
    // Funnel exposure is public-internet reach. Count it from the rows the card lists; fall back to the file's own count.
    let funnel_public = match &exposures {
        Some(rows) => Value::from(rows.iter().filter(|r| r["funnel"] == true).count()),
        None => file_counts.get("funnel_public").cloned().unwrap_or(Value::Null),
    };
    counts.insert("funnel_public".into(), funnel_public);
    if exposures.is_none() {
        errors.push(error_row("tailscale", "no exposures list"));
    }
    m.insert("counts".into(), Value::Object(counts));
    m.insert("alerts".into(), Value::Array(alert_rows));
    match nodes {
        Some(rows) => m.insert("nodes".into(), Value::Array(rows)),
        None => m.remove("nodes"),
    };
    match exposures {
        Some(rows) => m.insert("exposures".into(), Value::Array(rows)),
        None => m.remove("exposures"),
    };
    errors
}

/// `deadlines.json`: renewals as vendor, date, days; paperwork as id, kind, thing, date, days left, status. Nothing else,
/// so a dollar amount, mail evidence or an extractor name in the file can never leave.
fn prepare_deadlines(m: &mut Map<String, Value>) -> Vec<Value> {
    let mut errors = Vec::new();
    match m.get("renewals").and_then(Value::as_array) {
        Some(list) => {
            let rows: Vec<Value> = list
                .iter()
                .filter(|r| r.is_object())
                .take(60)
                .map(|r| json!({"vendor": opt_text(r.get("vendor"), 60), "date": opt_text(r.get("date"), 10), "days": opt_int(r.get("days"))}))
                .collect();
            m.insert("renewals".into(), Value::Array(rows));
        }
        None => {
            m.remove("renewals");
            errors.push(error_row("deadlines", "no renewals list"));
        }
    }
    match m.get("paperwork").and_then(Value::as_array) {
        Some(list) => {
            let rows: Vec<Value> = list
                .iter()
                .filter(|r| r.is_object())
                .take(40)
                .map(|r| {
                    json!({"id": opt_text(r.get("id"), 24), "kind": opt_text(r.get("kind"), 24), "thing": opt_text(r.get("thing"), 60),
                           "date": opt_text(r.get("date"), 10), "days_left": opt_int(r.get("days_left")), "status": opt_text(r.get("status"), 16)})
                })
                .collect();
            m.insert("paperwork".into(), Value::Array(rows));
        }
        None => {
            m.remove("paperwork");
            errors.push(error_row("deadlines", "no paperwork list"));
        }
    }
    errors
}

/// Product preferences live in the installation's private HOME, never in shipped assets.
/// Unscoped rows are generic; scoped rows require an explicit allowed scope.
fn has_term(value: &Value, term: &str) -> bool {
    match value {
        Value::String(s) if s.is_ascii() && term.is_ascii() =>
            s.as_bytes().windows(term.len()).any(|w| w.eq_ignore_ascii_case(term.as_bytes())),
        Value::String(s) => s.to_lowercase().contains(term),
        Value::Array(rows) => rows.iter().any(|row| has_term(row, term)),
        Value::Object(fields) => fields.values().any(|field| has_term(field, term)),
        _ => false,
    }
}

fn filter_products_with_config(mut feed: Value, config: Option<&str>) -> Value {
    if feed.get("error").is_some() { return feed; }
    let prefs = match config {
        Some(text) => match serde_json::from_str::<Value>(text) {
            Ok(Value::Object(p)) => p,
            _ => return fail(&PRODUCTS, "presentation config unreadable"),
        },
        None => Map::new(),
    };
    let list = |key: &str| -> Option<Vec<String>> {
        let Some(value) = prefs.get(key) else { return Some(Vec::new()); };
        let rows = value.as_array()?;
        if rows.len() > 64 { return None; }
        rows.iter().map(|v| {
            let s = v.as_str()?.trim();
            if s.is_empty() || s.len() > 120 { None } else { Some(s.to_lowercase()) }
        }).collect()
    };
    let (Some(scopes), Some(ids), Some(terms)) =
        (list("allowed_scopes"), list("hidden_product_ids"), list("hidden_terms")) else {
        return fail(&PRODUCTS, "presentation config unreadable");
    };
    let keep = |row: &Value, id_fields: &[&str]| {
        let allowed = ["tenant", "scope"].iter().all(|field| {
            row.get(*field).filter(|v| !v.is_null()).is_none_or(|v| {
                v.as_str().is_some_and(|s| scopes.iter().any(|scope| s.eq_ignore_ascii_case(scope)))
            })
        });
        let hidden_id = id_fields.iter().any(|field| row.get(*field).and_then(Value::as_str)
            .is_some_and(|id| ids.iter().any(|hidden| id.eq_ignore_ascii_case(hidden))));
        allowed && !hidden_id && !terms.iter().any(|term| has_term(row, term))
    };
    let mut partial = false;
    for key in ["products", "needs", "errors"] {
        if let Some(rows) = feed.get_mut(key).and_then(Value::as_array_mut) {
            let before = rows.len();
            rows.retain(|row| keep(row, if key == "products" { &["id"] } else { &[] }));
            if key != "products" && before != rows.len() { partial = true; }
        }
    }
    if let Some(app) = feed.get("app_store") {
        if !app.is_null() && (!app.is_object() || !keep(app, &["id", "app_id", "bundle_id"])) {
            feed["app_store"] = json!({"withheld":true});
            partial = true;
        }
    }
    if let Some(apps) = feed.get_mut("app_stores").and_then(Value::as_array_mut) {
        for app in apps.iter_mut() {
            if !app.is_null() && (!app.is_object() || !keep(app, &["id", "app_id", "bundle_id"])) {
                *app = json!({"withheld":true});
                partial = true;
            }
        }
    }
    if partial {
        if let Some(errors) = feed.get_mut("errors").and_then(Value::as_array_mut) {
            errors.push(json!({"source":"scope filter", "reason":"Mixed-scope status withheld; owner decision coverage is incomplete"}));
        }
    }
    feed
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_790_712_300;

    #[test]
    fn nodes_keep_rendered_keys_only() {
        let t = r#"{"active_model":"glm","api_ready":true,"generated_at":"2026-09-29T20:05:26.135208+00:00","recipes":[{"id":"x"}],
            "nodes":[{"label":"Spark","reachable":true,"memory_used_percent":98,"temperature_c":66,"host":"spark",
            "memory":{"used_bytes":128274399232,"total_bytes":130663170048}}]}"#;
        let v = nodes_from(t, NOW);
        assert_eq!(v["nodes"][0]["label"], "Spark");
        assert_eq!(v["nodes"][0]["mem_pct"], 98.0);
        assert_eq!(v["nodes"][0]["mem_used_gb"], 119.5);
        assert_eq!(v["stale"], false);
        assert!(v.get("recipes").is_none() && !v.to_string().contains("\"host\""));
        assert_eq!(nodes_from("x", NOW)["error"], "bad json");
    }

    #[test]
    fn nodes_go_stale_after_two_intervals() {
        let t = r#"{"generated_at":"2026-09-29T19:00:00Z","nodes":[]}"#;
        let v = nodes_from(t, NOW);
        assert_eq!(v["stale"], true);
        assert!(v["age"].as_u64().unwrap_or(0) > 120);
    }

    #[test]
    fn health_counts_problems_and_uses_mtime() {
        let empty = r#"{"checked_at":"2026-09-29T12:32:35","problems":[],"detail":{}}"#;
        let v = health_from(empty, Some(NOW - 60), NOW);
        assert_eq!(
            (v["count"].as_u64(), v["stale"].as_bool()),
            (Some(0), Some(false))
        );
        let some = r#"{"problems":["disk-m2 92%",{"name":"mcp quill"},{"other":1},"d"]}"#;
        let v = health_from(some, Some(NOW - 1000), NOW);
        assert_eq!(v["count"], 4);
        assert_eq!(v["names"][1], "mcp quill");
        assert_eq!(v["names"][2], "problem");
        assert_eq!(v["stale"], true);
        assert_eq!(health_from("{}", None, NOW)["error"], "no problems list");
    }

    #[test]
    fn health_reports_the_critical_and_degraded_split_only_when_the_writer_gives_both() {
        let t = r#"{"problems":["eufy_cam2 offline: needs power at the camera"],"critical":[],"degraded":["eufy_cam2 offline: needs power at the camera"]}"#;
        let v = health_from(t, Some(NOW - 60), NOW);
        assert_eq!((v["critical"].as_u64(), v["degraded"].as_u64()), (Some(0), Some(1)));
        assert_eq!(v["names"][0], "eufy_cam2 offline: needs power at the camera");
        let old = health_from(r#"{"problems":["x"]}"#, Some(NOW - 60), NOW);
        assert!(old.get("critical").is_none() && old.get("degraded").is_none());
    }

    #[test]
    fn car_never_reads_location_or_extra_keys() {
        let t = r#"{"battery":59.0,"charging":"Disconnected","locked":false,"range":164.2,"chargeLimit":50.0,
            "generatedAt":"2026-09-29T20:04:32Z","location":{"lat":1.5,"lon":2.5},"latitude":9.9,"name":"Novelie","ageSeconds":5}"#;
        let v = car_from(t, NOW);
        assert_eq!(v["battery"], 59.0);
        assert_eq!(v["charge_limit"], 50.0);
        assert_eq!(v["locked"], false);
        assert_eq!(v["charging"], "Disconnected");
        let s = v.to_string();
        assert!(
            !s.contains("1.5")
                && !s.contains("9.9")
                && !s.contains("Novelie")
                && !s.contains("ageSeconds")
        );
    }

    #[test]
    fn car_last_seen_falls_back_to_reading_at_when_age_seconds_is_null() {
        let t = r#"{"battery":46.0,"charging":"Charging","locked":true,"range":128.5,"fresh":true,"ageSeconds":null,
            "generatedAt":"2026-11-04T21:26:11Z","readingAt":"2026-11-04T21:26:00Z"}"#;
        let v = car_from(t, NOW);
        assert_eq!(v["age_s"], Value::Null);
        assert_eq!(v["seen"], iso_to_epoch("2026-11-04T21:26:00Z").unwrap_or(0));
        let none = car_from(r#"{"battery":1.0,"generatedAt":"2026-11-04T21:26:11Z"}"#, NOW);
        assert_eq!(none["seen"], Value::Null);
    }

    /// A27: the car was last seen at generatedAt - ageSeconds; the file time is only when it was written.
    #[test]
    fn car_last_seen_comes_from_age_seconds_and_cached_from_fresh() {
        let t = r#"{"battery":35.0,"charging":"Disconnected","locked":true,"range":97.5,"chargeLimit":80.0,"awake":"offline","fresh":false,
            "generatedAt":"2026-09-29T20:04:32Z","ageSeconds":36882.4,"name":"Novelie"}"#;
        let v = car_from(t, NOW);
        let written = iso_to_epoch("2026-09-29T20:04:32Z").unwrap_or(0);
        assert_eq!(v["age_s"], 36_882u64);
        assert_eq!(v["seen"], written - 36_882);
        assert_eq!(v["fresh"], false);
        assert_eq!(v["awake"], "offline");
        assert_eq!(v["t"], written);
        // an older file has none of it: unknown, never zero
        let old = car_from(r#"{"battery":59.0,"generatedAt":"2026-09-29T20:04:32Z"}"#, NOW);
        assert_eq!((old["age_s"].clone(), old["seen"].clone(), old["fresh"].clone()), (Value::Null, Value::Null, Value::Null));
        // an absurd or negative age is dropped, not trusted
        for bad in ["-5", "1e12", "\"x\""] {
            let v = car_from(&format!(r#"{{"generatedAt":"2026-09-29T20:04:32Z","ageSeconds":{bad}}}"#), NOW);
            assert_eq!((v["age_s"].clone(), v["seen"].clone()), (Value::Null, Value::Null), "{bad}");
        }
    }

    #[test]
    fn watch_feed_keeps_proximity_and_reading_time() {
        let v = deck_feed_from(&WATCH, r#"{"t":1790712000,"connected":false,"near":true,"rssi":-70,"metrics_t":null,"hr":null,"device_secret":"x","token":"y"}"#, None, NOW);
        assert_eq!((v["near"].clone(), v["rssi"].clone(), v["metrics_t"].clone()), (json!(true), json!(-70), Value::Null));
        assert!(v.get("device_secret").is_none() && v.get("token").is_none());
    }
    #[test]
    fn disks_flag_unreachable_and_hide_mounts() {
        let t = r#"{"generated_at":1790712105,"hosts":[
            {"host":"pc-desktop","ok":true,"drives":[{"mount":"/home/x/secret","label":"disk-m2","pct":92}]},
            {"host":"Dell","ok":false,"drives":[]}]}"#;
        let v = disks_from(t, NOW);
        assert_eq!(v["drives"][0]["pct"], 92);
        assert_eq!(v["drives"][1]["label"], "unreachable");
        assert!(!v.to_string().contains("secret"));
        assert_eq!(v["stale"], false);
    }

    #[test]
    fn sites_one_item_per_result() {
        let t = r#"{"at":1790712302,"results":[{"name":"pg-web","ok":true,"ms":103,"detail":"HTTP 200"},{"name":"mv-web","ok":false,"ms":null}]}"#;
        let v = sites_from(t, NOW);
        assert_eq!(v["items"].as_array().map(Vec::len), Some(2));
        assert_eq!(v["items"][1]["ok"], false);
        assert!(!v.to_string().contains("HTTP 200"));
    }

    #[test]
    fn mcp_counts_only_own_surfaces_from_last_sweep() {
        let t = r#"[{"timestamp":"2026-09-29T01:00:00Z","surface_counts":{"omp":{"ok":1,"fail":9}}},
            {"timestamp":"2026-09-29T09:20:10Z","surface_counts":{"hermes-default":{"ok":39,"fail":0},
            "hermes-quill":{"ok":15,"fail":3},"omp":{"ok":42,"fail":1}}}]"#;
        let v = mcp_from(t, NOW);
        assert_eq!((v["up"].as_u64(), v["down"].as_u64()), (Some(81), Some(1)));
        // Sweep runs daily (mcp-liveness-sweep.timer 02:20), so a same-day sweep is fresh.
        assert_eq!(v["stale"], false);
        let old =
            r#"[{"timestamp":"2026-09-20T09:20:10Z","surface_counts":{"omp":{"ok":1,"fail":0}}}]"#;
        assert_eq!(mcp_from(old, NOW)["stale"], true);
        assert_eq!(mcp_from("[]", NOW)["error"], "no sweep");
    }

    #[tokio::test]
    async fn missing_file_is_an_error_object_and_cached() {
        let home = Path::new("/nonexistent-pixel-deck-test");
        let c = Cache::default();
        let v = c.get(home, &CAR).await;
        assert_eq!(v["error"], "file missing");
        assert_eq!(v["stale"], true);
        assert_eq!(c.get(home, &CAR).await, v);
    }

    #[test]
    fn deck_feed_keeps_contract_keys_and_drops_credentials() {
        let t = r#"{"t":1790712240,"refresh":60,"src":["docker ps","nvidia-smi"],
            "errors":[{"source":"ascent","reason":"ssh timeout","extra":"x"}],
            "engine":{"served_name":"glm","status":"up","api_key":"sk-SECRET","port":8080,"up_since":null},
            "nodes":[{"name":"spark","gpu_util_pct":0,"token":"TOK","containers":["vllm_glm53"]}],
            "junk":{"a":1}}"#;
        let v = deck_feed_from(&CLUSTER, t, None, NOW);
        assert_eq!(v["engine"]["status"], "up");
        assert_eq!(v["engine"]["up_since"], Value::Null);
        assert_eq!(v["nodes"][0]["gpu_util_pct"], 0);
        assert_eq!(v["sources"][1], "nvidia-smi");
        assert_eq!(v["errors"][0]["reason"], "ssh timeout");
        assert_eq!(v["age"], 60);
        assert_eq!(v["stale"], false);
        let s = v.to_string();
        assert!(
            !s.contains("SECRET")
                && !s.contains("TOK")
                && !s.contains("junk")
                && !s.contains("extra")
        );
    }

    #[test]
    fn products_default_keeps_generic_rows_but_not_other_tenants() {
        let t = r#"{"t":1790712240,"products":[{"id":"internal","name":"Internal dashboard"},{"id":"foreign","tenant":"someone-else"}],"needs":[{"text":"Fix CI","source":"dev.json"},{"scope":"someone-else","text":"Private decision"}],"errors":[]}"#;
        let v = filter_products_with_config(deck_feed_from(&PRODUCTS, t, None, NOW), None);
        assert_eq!(v["products"].as_array().map(Vec::len), Some(1));
        assert_eq!(v["products"][0]["id"], "internal");
        assert_eq!(v["needs"].as_array().map(Vec::len), Some(1));
        assert!(!v.to_string().contains("someone-else"));
        assert!(v["errors"].as_array().is_some_and(|a| a.iter().any(|e| e["source"] == "scope filter")));
    }

    #[test]
    fn products_private_presentation_hides_ids_and_terms_without_adding_owner_defaults() {
        let t = r#"{"t":1790712240,"products":[{"id":"public","name":"Public site"},{"id":"internal","name":"Private dashboard"}],"needs":[{"text":"Fix CI","source":"dev.json"},{"text":"Private dashboard needs attention","source":"sites"}],"errors":[{"source":"Private dashboard","reason":"unavailable"}]}"#;
        let feed = deck_feed_from(&PRODUCTS, t, None, NOW);
        let filtered = filter_products_with_config(feed.clone(), Some(r#"{"hidden_product_ids":["internal"],"hidden_terms":["Private dashboard"],"allowed_scopes":[]}"#));
        assert_eq!(feed["products"].as_array().map(Vec::len), Some(2));
        assert_eq!(filtered["products"].as_array().map(Vec::len), Some(1));
        assert!(!filtered.to_string().contains("Private dashboard"));
        assert!(filtered["errors"].as_array().is_some_and(|a| a.iter().any(|e| e["source"] == "scope filter")));
        assert_eq!(filter_products_with_config(feed, Some("{bad"))["error"], "presentation config unreadable");
    }
    #[test]
    fn private_presentation_withholds_top_level_app_store_metadata() {
        let app = json!({"name":"Hidden app","app_id":"private-app-id","bundle_id":"private.bundle",
            "url":"https://example.org/private-app"});
        for config in [
            r#"{"hidden_terms":["hidden app"]}"#,
            r#"{"hidden_product_ids":["private-app-id"]}"#,
            r#"{"hidden_product_ids":["private.bundle"]}"#,
        ] {
            let text = json!({"t":NOW,"products":[],"needs":[],"errors":[],"app_store":app}).to_string();
            let filtered = filter_products_with_config(deck_feed_from(&PRODUCTS,&text,None,NOW),Some(config));
            assert_eq!(filtered["app_store"],json!({"withheld":true}));
            let serialized = filtered.to_string();
            for private in ["Hidden app","private-app-id","private.bundle","private-app"] {
                assert!(!serialized.contains(private));
            }
            assert!(filtered["errors"].as_array().is_some_and(|a| a.iter().any(|e|e["source"]=="scope filter")));
        }
        let text = json!({"t":NOW,"products":[],"needs":[],"errors":[],
            "app_store":{"scope":"foreign-owner","name":"Hidden app"}}).to_string();
        let filtered = filter_products_with_config(deck_feed_from(&PRODUCTS,&text,None,NOW),None);
        assert_eq!(filtered["app_store"],json!({"withheld":true}));
        assert!(!filtered.to_string().contains("foreign-owner"));
    }

    #[test]
    fn every_listed_app_store_app_reaches_the_browser_and_private_ones_are_withheld() {
        let apps = json!([{"name":"Public app","app_id":"1111111111"},{"name":"Hidden app","app_id":"private-app-id"}]);
        let text = json!({"t":NOW,"products":[],"needs":[],"errors":[],"app_stores":apps}).to_string();
        let feed = deck_feed_from(&PRODUCTS,&text,None,NOW);
        assert_eq!(feed["app_stores"].as_array().map(Vec::len),Some(2));
        let filtered = filter_products_with_config(feed,Some(r#"{"hidden_product_ids":["private-app-id"]}"#));
        assert_eq!(filtered["app_stores"][0]["name"],"Public app");
        assert_eq!(filtered["app_stores"][1],json!({"withheld":true}));
        assert!(!filtered.to_string().contains("Hidden app"));
        assert!(filtered["errors"].as_array().is_some_and(|a| a.iter().any(|e|e["source"]=="scope filter")));
    }

    #[test]
    fn product_error_scope_survives_sanitization_until_private_filtering() {
        let text = r#"{"t":1790712240,"products":[],"needs":[],"errors":[{"scope":"foreign-owner","source":"external","reason":"private diagnostic"}]}"#;
        let filtered = filter_products_with_config(deck_feed_from(&PRODUCTS,text,None,NOW),None);
        assert!(!filtered.to_string().contains("private diagnostic"));
        assert!(filtered["errors"].as_array().is_some_and(|a| a.iter().any(|e|e["source"]=="scope filter")));
    }

    #[test]
    fn schedules_feed_keeps_groups_and_counts_and_keeps_a_down_source_visible() {
        let t = r#"{"t":1790712240,"refresh":300,"src":["gh api"],"errors":[{"source":"dell-systemd","reason":"ssh timeout"}],
            "counts":{"total":2,"failing":1,"next_run":1790712600},
            "groups":[{"id":"hermes","label":"Hermes crons","ok":true,"error":null,"n":2,"jobs":[
              {"id":"hermes:a","name":"A","host":"pc-desktop","schedule":"0 7 * * *","enabled":true,"last":1790712000,"next":1790712600,"result":"failed","detail":"error, 3 in a row","api_key":"sk-SECRET"},
              {"id":"hermes:b","name":"B","host":"pc-desktop","schedule":"every 1m","enabled":false,"last":null,"next":null,"result":"paused"}]},
              {"id":"dell-systemd","label":"dell timers","ok":false,"error":"ssh timeout","n":0,"jobs":[]}],
            "junk":{"a":1}}"#;
        let Some(d) = feed_def("schedules") else { panic!("schedules feed not registered") };
        assert_eq!(d.rel, ".meshvault/status/deck/schedules.json");
        let v = deck_feed_from(d, t, None, NOW);
        assert_eq!(v["counts"]["failing"], 1);
        assert_eq!(v["groups"][0]["jobs"][0]["result"], "failed");
        assert_eq!(v["groups"][0]["jobs"][1]["last"], Value::Null);
        assert_eq!(v["groups"][1]["ok"], false);
        assert_eq!(v["groups"][1]["error"], "ssh timeout");
        assert_eq!(v["errors"][0]["source"], "dell-systemd");
        assert_eq!(v["stale"], false);
        let s = v.to_string();
        assert!(!s.contains("SECRET") && !s.contains("junk"));
    }

    #[test]
    fn schedules_feed_keeps_running_start_batch_members_retired_last_known_and_unknown_hosts() {
        let t = r#"{"t":1790712240,"refresh":300,"src":["systemctl"],"errors":[],
            "counts":{"scope":"observed","total":1,"active":1,"history":0,"running":1,"running_age_unknown":0,"member_failures":1,"retired":1,
              "unknown_hosts":["dell"],"unknown_sources":["dell-systemd"],"complete":false,
              "by_group":{"pc-desktop-systemd":{"n":1,"active":1,"running":1,"ok":true}}},
            "groups":[{"id":"pc-desktop-systemd","label":"pc-desktop timers","ok":true,"error":null,"n":1,
              "retired":[{"name":"old-timer","merged_into":"batch-a","at":1790712000,"host":"pc-desktop"}],
              "notes":["running state unknown: executions.db missing"],
              "jobs":[{"id":"x:batch-a","name":"batch-a","host":"pc-desktop","kind":"systemd","schedule":"hourly","enabled":true,"lifecycle":"active",
                "last":1790710000,"started":1790712100,"next":null,"result":"running","detail":"1 of 2 members failed: m2",
                "members":[{"name":"m1","status":"ok","started":1,"finished":2,"exit":0},{"name":"m2","status":"failed","started":3,"finished":4,"exit":2}]}]},
              {"id":"dell-systemd","label":"dell timers","ok":false,"error":"ssh timeout","n":0,"jobs":[],"last_known":{"n":12,"active":9,"t":1790700000}}]}"#;
        let Some(d) = feed_def("schedules") else { panic!("schedules feed not registered") };
        let v = deck_feed_from(d, t, None, NOW);
        let job = &v["groups"][0]["jobs"][0];
        assert_eq!((job["started"].as_u64(), job["lifecycle"].as_str()), (Some(1790712100), Some("active")));
        assert_eq!(job["members"][1]["status"], "failed");
        assert_eq!(job["members"][1]["exit"], 2);
        assert_eq!(v["groups"][0]["retired"][0]["merged_into"], "batch-a");
        assert_eq!(v["groups"][0]["notes"][0], "running state unknown: executions.db missing");
        assert_eq!(v["groups"][1]["last_known"]["n"], 12);
        assert_eq!(v["counts"]["unknown_hosts"][0], "dell");
        assert_eq!(v["counts"]["complete"], false);
        assert_eq!(v["counts"]["by_group"]["pc-desktop-systemd"]["running"], 1);
    }

    #[test]
    fn jobs_feed_keeps_up_to_1200_listings_and_24_sources_while_other_lists_stay_at_200() {
        let rows = |n: usize| (0..n).map(|i| format!(r#"{{"title":"J{i}","site":"ashby"}}"#)).collect::<Vec<_>>().join(",");
        let src = (0..30).map(|i| format!(r#""s{i}""#)).collect::<Vec<_>>().join(",");
        let jobs = format!(r#"{{"t":1790712240,"src":[{src}],"listings":[{}]}}"#, rows(1300));
        let v = deck_feed_from(&JOBS, &jobs, None, NOW);
        assert_eq!(v["listings"].as_array().map(Vec::len), Some(1200));
        assert_eq!(v["sources"].as_array().map(Vec::len), Some(24));
        let surf = format!(r#"{{"t":1790712240,"spots":[{}]}}"#, rows(300));
        let v = deck_feed_from(&SURF, &surf, None, NOW);
        assert_eq!(v["spots"].as_array().map(Vec::len), Some(200));
    }

    #[test]
    fn jobs_casey_is_registered_like_jobs_and_keeps_person_and_up_to_1200_listings() {
        let Some(d) = feed_def("jobs-casey") else { panic!("jobs-casey feed not registered") };
        assert_eq!(d.rel, ".meshvault/status/deck/jobs-casey.json");
        assert_eq!((d.refresh, JOBS.refresh), (3600, 3600));
        assert_eq!(feed_keys("jobs-casey"), feed_keys("jobs"));
        let rows = (0..1300)
            .map(|i| format!(r#"{{"title":"SDR {i}","site":"linkedin","metro":"oc","t":1790712000}}"#))
            .collect::<Vec<_>>()
            .join(",");
        let text = format!(
            r#"{{"t":1790712240,"refresh":3600,"person":"casey","rules":{{"remote_min_pay":60000}},"listings":[{rows}],"junk":1}}"#
        );
        let v = deck_feed_from(d, &text, None, NOW);
        assert_eq!(v["person"], "casey");
        assert_eq!(v["rules"]["remote_min_pay"], 60000);
        assert_eq!(v["listings"].as_array().map(Vec::len), Some(1200));
        assert_eq!(v["listings"][0]["metro"], "oc");
        assert!(v.get("junk").is_none());
    }

    #[test]
    fn jobs_riley_and_morgan_are_registered_like_jobs_and_keep_their_person() {
        for (name, rel, person) in [
            ("jobs-riley", ".meshvault/status/deck/jobs-riley.json", "riley"),
            ("jobs-morgan", ".meshvault/status/deck/jobs-morgan.json", "morgan"),
        ] {
            let Some(d) = feed_def(name) else { panic!("{name} feed not registered") };
            assert_eq!((d.rel, d.refresh), (rel, 3600));
            assert_eq!(feed_keys(name), feed_keys("jobs"));
            let rows = (0..1250).map(|i| format!(r#"{{"title":"Role {i}","t":1790712000}}"#)).collect::<Vec<_>>().join(",");
            let text = format!(r#"{{"t":1790712240,"person":"{person}","profile":{{"provisional":true}},"listings":[{rows}]}}"#);
            let v = deck_feed_from(d, &text, None, NOW);
            assert_eq!(v["person"], person);
            assert_eq!(v["profile"]["provisional"], true);
            assert_eq!(v["listings"].as_array().map(Vec::len), Some(1200));
        }
    }

    #[test]
    fn gigs_feed_keeps_contract_keys_500_rows_and_whole_draft_pitches() {
        let Some(d) = feed_def("gigs") else { panic!("gigs feed not registered") };
        assert_eq!(d.rel, ".meshvault/status/deck/gigs.json");
        let pitch = "Hi, I build local AI agents.\n".repeat(40);
        let mut rows = vec![serde_json::json!({"title":"Agent build","site":"upwork","url":"https://example.com/g","pay":"$90/hr",
            "pay_min":80,"pay_max":100,"pay_unit":"hour","fit":91,"posted_at":1790712000,"why":["Agents"],"pitch":pitch,"kind":"gig","api_key":"x"})];
        rows.extend((0..600).map(|i| serde_json::json!({"title": format!("Gig {i}"), "fit": 10})));
        let text = serde_json::json!({"t":1790712240,"refresh":3600,"src":["upwork"],"errors":[{"source":"fiverr","reason":"blocked"}],
            "sites_checked":212,"sites_registry":240,"by_site":{"upwork":1},"gigs":rows,"junk":1}).to_string();
        let v = deck_feed_from(d, &text, None, NOW);
        assert_eq!((v["sites_checked"].as_u64(), v["sites_registry"].as_u64()), (Some(212), Some(240)));
        assert_eq!(v["gigs"].as_array().map(Vec::len), Some(500));
        let g = &v["gigs"][0];
        assert_eq!((g["fit"].as_u64(), g["pay_unit"].as_str()), (Some(91), Some("hour")));
        assert_eq!(g["pitch"].as_str().map(|p| p.chars().count()), Some(pitch.chars().count().min(2000)));
        assert!(g["pitch"].as_str().is_some_and(|p| p.contains('\n')));
        assert!(g.get("api_key").is_none());
        assert_eq!(v["errors"][0]["source"], "fiverr");
        assert!(v.get("junk").is_none());
    }

    /// World view (2026-11-17): both feeds are registered, keep the contract keys, rebuild every row from the allow-list and
    /// name what they dropped. The fixtures are the ones the page tests use.
    #[test]
    fn trends_feed_keeps_the_contract_drops_personal_fields_and_names_failed_sources() {
        let Some(d) = feed_def("trends") else { panic!("trends feed not registered") };
        assert_eq!((d.rel, d.refresh), (".meshvault/status/deck/trends.json", 1800));
        let now = 1_794_927_600 + 600;
        let v = deck_feed_from(d, include_str!("../../tests/fixtures/trends.sample.json"), None, now);
        assert_eq!((v["t"].as_u64(), v["age"].as_u64(), v["stale"].as_bool()), (Some(1_794_927_600), Some(600), Some(false)));
        assert_eq!(v["feeds"].as_array().map(Vec::len), Some(5));
        assert_eq!(v["feeds"][1], json!({"id":"ebay-trending","ok":false,"age_s":7300,"error":"HTTP 429"}));
        assert_eq!(v["sources"][0], "amazon-bestsellers", "the file's own src list stays the envelope's source names");
        let errs: Vec<String> = v["errors"].as_array().into_iter().flatten().map(|e| format!("{}: {}", short(e.get("source"), 60), short(e.get("reason"), 160))).collect();
        assert_eq!(errs.iter().filter(|e| e.starts_with("ebay-trending")).count(), 1, "a failed source the file already named is not doubled: {errs:?}");
        assert!(errs.contains(&"reddit-buyitforlife: timeout".to_string()), "{errs:?}");
        assert!(errs.iter().any(|e| e.starts_with("products: 1 of 5 rows dropped")), "{errs:?}");
        assert!(errs.iter().any(|e| e.starts_with("tickers: 1 of 4 rows dropped")), "{errs:?}");
        let p = &v["products"];
        assert_eq!(p.as_array().map(Vec::len), Some(4));
        assert_eq!((p[0]["rank"].as_i64(), p[0]["rank_change"].as_i64(), p[0]["price_median"].as_f64()), (Some(3), Some(41), Some(449.0)));
        assert_eq!(p[3]["url"], Value::Null, "an unsafe link is dropped, the row stays");
        assert!(!v.to_string().contains("\"qty\"") && !v.to_string().contains("\"balance\""), "nothing outside the contract leaves");
        assert_eq!(v["tickers"][0]["symbol"], "SMCI");
        assert_eq!(v["tickers"][2]["pct"], Value::Null, "unknown stays null, never 0");
        assert_eq!(v["searches"].as_array().map(Vec::len), Some(4));
        assert_eq!(v["searches"][3]["growth_pct"], Value::Null);
    }

    #[test]
    fn trends_feed_malformed_and_missing_lists_are_errors_not_empty_lists() {
        let Some(d) = feed_def("trends") else { panic!("trends feed not registered") };
        let v = deck_feed_from(d, r#"{"generated_at":"2026-11-17T15:00:00Z","products":{"a":1},"tickers":[],"sources":"x"}"#, None, 1_794_928_000);
        assert_eq!(v["t"].as_u64(), Some(1_794_927_600), "generated_at stands in for a missing t");
        assert!(v.get("products").is_none(), "a list that is not a list is not served as empty");
        assert_eq!(v["tickers"], json!([]));
        let reasons: Vec<String> = v["errors"].as_array().into_iter().flatten().map(|e| format!("{}: {}", short(e.get("source"), 60), short(e.get("reason"), 160))).collect();
        for want in ["products: not a list", "searches: missing from the file", "sources: no source list"] {
            assert!(reasons.contains(&want.to_string()), "{want} in {reasons:?}");
        }
        assert_eq!(deck_feed_from(d, "not json", None, 1_794_928_000)["error"], "bad json");
    }

    #[test]
    fn gaps_feed_keeps_scored_items_with_named_evidence_only() {
        let Some(d) = feed_def("gaps") else { panic!("gaps feed not registered") };
        assert_eq!((d.rel, d.refresh), (".meshvault/status/deck/gaps.json", 3600));
        let v = deck_feed_from(d, include_str!("../../tests/fixtures/gaps.sample.json"), None, 1_794_927_600);
        assert_eq!(v["refresh"].as_u64(), Some(3600));
        assert!(v["method"].as_str().is_some_and(|m| m.starts_with("gap_score")));
        let items = v["items"].as_array().cloned().unwrap_or_default();
        assert_eq!(items.len(), 5, "the unknown domain is dropped");
        assert!(items.iter().all(|i| GAP_DOMAINS.contains(&i["domain"].as_str().unwrap_or(""))));
        assert_eq!(items[0]["evidence"].as_array().map(Vec::len), Some(2), "evidence without a source is not evidence");
        assert_eq!(items[0]["evidence"][1]["value"], "3", "a numeric value is served as text");
        assert_eq!(items[0]["evidence"][1]["as_of"], "2026-11-17", "a plain date is a valid as-of");
        assert_eq!(items[2]["evidence"][0]["as_of"], Value::Null, "an as-of that does not parse is null");
        assert_eq!(items[3]["gap_score"], Value::Null, "a score past 100 is not a score");
        assert_eq!(items[4]["gap_score"], Value::Null);
        assert!(v["errors"].as_array().is_some_and(|e| e.iter().any(|x| x["source"] == "items")));
        let bad = deck_feed_from(d, r#"{"generated_at":"2026-11-17T14:30:00Z","items":5}"#, None, 1_794_927_600);
        assert!(bad.get("items").is_none() && bad["errors"][0]["reason"] == "not a list");
    }

    #[test]
    fn gap_evidence_source_member_lists_become_a_count_before_the_cap_can_cut_them() {
        let long = "public job boards (ashby, dice, governmentjobs, greenhouse, himalayas, hn_hiring, lever, linkedin, remoteok, workday, ziprecruiter)";
        assert_eq!(compact_members(long), "public job boards (11 sources)");
        // three members or fewer, a name with no list, a nested group and a stray bracket are left as written
        assert_eq!(compact_members("BLS (JOLTS, 2026)"), "BLS (JOLTS, 2026)");
        assert_eq!(compact_members("loopnet-public"), "loopnet-public");
        assert_eq!(compact_members("a (b, c, d, (e), f)"), "a (b, c, d, (e), f)");
        assert_eq!(compact_members(") a, b, c, d ("), ") a, b, c, d (");
        let o: Map<String, Value> = serde_json::from_value(json!({"source": long, "metric": "Open postings", "value": 1736}))
            .unwrap_or_else(|error| panic!("valid evidence fixture: {error}"));
        let e = gap_evidence(&o).unwrap_or_else(|| panic!("fixture must contain evidence"));
        assert_eq!(e["source"], "public job boards (11 sources)");
    }

    #[test]
    fn realestate_feed_keeps_every_home_and_commercial_row_up_to_the_collector_caps() {
        // a 200 cap, then a 1200 cap, dropped rows the collector kept: "Showing N of M" read M = the cap for a 1572-home feed
        let homes: Vec<Value> = (0..6100)
            .map(|i| json!({"addr": format!("{i} Test St"), "city": "Dana Point", "price": 500_000 + i}))
            .collect();
        let com: Vec<Value> = (0..1900)
            .map(|i| json!({"addr": format!("{i} Office Row"), "city": "Irvine", "price": 2_000_000 + i}))
            .collect();
        let text = json!({"t": NOW, "refresh": 3600, "homes": homes, "commercial": com, "market": {}}).to_string();
        let v = deck_feed_from(&REALESTATE, &text, None, NOW);
        assert_eq!(v["homes"].as_array().map(Vec::len), Some(6000));
        assert_eq!(v["commercial"].as_array().map(Vec::len), Some(1900));
        assert_eq!(v["homes"][5999]["price"], 500_000 + 5999);
        assert_eq!(v["commercial"][1899]["price"], 2_000_000 + 1899);
    }

    #[test]
    fn deck_feed_staleness_uses_collector_refresh_and_mtime_fallback() {
        // jobs refresh 21600: 13 h old is stale, 1 h old is not
        let v = deck_feed_from(
            &JOBS,
            r#"{"refresh":21600,"listings":[]}"#,
            Some(NOW - 46_800),
            NOW,
        );
        assert_eq!(v["stale"], true);
        let v = deck_feed_from(
            &JOBS,
            r#"{"refresh":21600,"listings":[]}"#,
            Some(NOW - 3600),
            NOW,
        );
        assert_eq!(v["stale"], false);
        // a future or absurd t falls back to mtime; no time at all is stale
        let v = deck_feed_from(
            &SURF,
            &format!(r#"{{"t":{}}}"#, NOW + 9999),
            Some(NOW - 10),
            NOW,
        );
        assert_eq!(v["t"], NOW - 10);
        assert_eq!(deck_feed_from(&SURF, "{}", None, NOW)["stale"], true);
        assert_eq!(deck_feed_from(&SURF, "[1]", None, NOW)["error"], "bad json");
        assert_eq!(
            feed_def("launch").map(|d| d.rel),
            Some(".meshvault/status/deck/launch.json")
        );
        // Public house feeds share the briefing's canonical directory, not Deck storage.
        for name in ["surf", "hockey", "realestate"] {
            assert_eq!(
                feed_def(name).map(|d| d.rel),
                Some(match name {
                    "surf" => ".meshvault/status/house-feeds/surf.json",
                    "hockey" => ".meshvault/status/house-feeds/hockey.json",
                    _ => ".meshvault/status/house-feeds/realestate.json",
                })
            );
        }
        assert!(feed_def("nodes").is_none());
    }

    #[test]
    fn launch_feed_carries_plain_names_areas_and_the_earns_flag() {
        let t = r#"{"t":1790712240,"refresh":900,"counts":{"skill":2},"names":{"areas":{"Sales":1}},
            "items":[{"id":"skill:a","kind":"skill","name":"cold-email","label":"Cold email outreach","does":"Drafts cold emails for you to approve.","area":"Sales","ao":0,"earns":true,"tier":"core"},
                     {"id":"skill:b","kind":"skill","name":"x","label":"Plain","does":"Does one plain thing.","area":"Home lab","ao":5,"earns":false,"api_key":"sk-LEAK"}]}"#;
        let v = deck_feed_from(&LAUNCH, t, None, NOW);
        assert_eq!(v["items"][0]["label"], "Cold email outreach");
        assert_eq!(v["items"][0]["does"], "Drafts cold emails for you to approve.");
        assert_eq!(v["items"][0]["area"], "Sales");
        assert_eq!(v["items"][0]["ao"], 0);
        assert_eq!(v["items"][0]["earns"], true);
        assert_eq!(v["items"][1]["earns"], false);
        assert_eq!(v["items"][1]["ao"], 5);
        assert!(v["items"][1].get("api_key").is_none(), "credential-shaped keys are still dropped");
        assert!(v.get("names").is_none(), "only the contract keys leave the server");
    }

    #[tokio::test]
    async fn missing_deck_feed_is_unavailable_not_zero() {
        let v = Cache::default()
            .get(Path::new("/nonexistent-pixel-deck-test"), &HOCKEY)
            .await;
        assert_eq!(v["error"], "file missing");
        assert!(v.get("teams").is_none());
    }

    const ECOM_FILE: &str = r#"{"v":1,"t":1790712000,"refresh":3600,"src":["shoptrends sqlite (~/.local/share/hermes-shop/trends.db)","fred"],
        "errors":[{"source":"ebay","reason":"blocked (HTTP 403)"}],
        "coverage":{"since":1790700000,"days":3,"observations":1234,"listings":900,"shops":null,
          "sites":[{"site":"ebay","label":"eBay","kind":"marketplace","status":"blocked","last_ok":null,"n_24h":0,"reason":"blocked (HTTP 403)","t":1790712000}]},
        "watch":[{"slug":"sony-wh-1000xm5","query":"sony wh-1000xm5","median":289.0,"chg7":-0.021,"chg30":null,"spark":[null,291.0,289.0],
          "by_site":[{"site":"newegg","median":179.0,"n":11}],"season":null,"best":{"site":"newegg","price":159.99,"url":"https://example.test/x"}}],
        "movers":[{"slug":"a","query":"a","chg7":-0.1,"dir":"down"}],"deals":[],
        "macro":[{"key":"nonstore_retail","label":"Online retail","src":"fred:X","by_month":[1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0],"api_key":"sk-LEAK"}],
        "junk":{"a":1}}"#;

    #[test]
    fn ecom_feed_fresh_keeps_nulls_and_drops_credentials_and_unknown_keys() {
        let d = feed_def("ecom").map(|d| d.rel);
        assert_eq!(d, Some(".meshvault/status/house-feeds/ecom.json"));
        let v = deck_feed_from(&ECOM, ECOM_FILE, None, NOW);
        assert_eq!(v["stale"], false);
        assert_eq!(v["refresh"], 3600);
        assert_eq!(v["age"], 300);
        // unknown stays null, a measured 0 stays 0
        assert_eq!(v["coverage"]["shops"], Value::Null);
        assert_eq!(v["coverage"]["sites"][0]["n_24h"], 0);
        assert_eq!(v["watch"][0]["chg30"], Value::Null);
        assert_eq!(v["watch"][0]["spark"][0], Value::Null);
        assert_eq!(v["watch"][0]["season"], Value::Null);
        assert_eq!(v["watch"][0]["best"]["url"], "https://example.test/x");
        assert_eq!(v["errors"][0]["source"], "ebay");
        assert_eq!(
            v["sources"][0],
            "shoptrends sqlite (~/.local/share/hermes-shop/trends.db)"
        );
        let s = v.to_string();
        assert!(!s.contains("LEAK") && !s.contains("junk"));
        // `key` is dropped by the shared credential filter; the Shop tab does not need it
        assert!(v["macro"][0].get("key").is_none());
        assert_eq!(v["macro"][0]["label"], "Online retail");
    }

    /// 2026-11-04: listing-level movers, the time they were computed, and the local resale block pass through the Shop route.
    #[test]
    fn ecom_feed_passes_listing_movers_computed_at_and_resale() {
        let text = r#"{"v":1,"t":1790712000,"refresh":3600,"watch":[],"deals":[],"macro":[],
            "movers":[{"slug":"a","query":"a","chg7":-0.2,"dir":"down","kind":"drop","site":"offerup","title":"T","price":80.0,"ref":100.0,
              "url":"https://offerup.com/item/detail/1","condition":"used","t":1790711000}],
            "movers_info":{"computed_at":1790712000,"data_through":1790711000,"stale":false,"window_days":7,"watches":11,"listings_checked":218,
              "candidates":6,"kinds":{"drop":6}},
            "resale":[{"slug":"a","query":"a","role":"own","area":"Dana Point, CA","n":3,"median":600.0,"sites":[],"vs_retail":null,"paused":[]}],
            "private":"DO_NOT_SERVE"}"#;
        let v = deck_feed_from(&ECOM, text, None, NOW);
        assert_eq!(v["movers"][0]["kind"], "drop");
        assert_eq!(v["movers"][0]["price"], 80.0);
        assert_eq!(v["movers_info"]["data_through"], 1_790_711_000u64);
        assert_eq!(v["movers_info"]["stale"], false);
        assert_eq!(v["resale"][0]["role"], "own");
        assert_eq!(v["resale"][0]["vs_retail"], Value::Null);
        assert!(!v.to_string().contains("DO_NOT_SERVE"));
    }

    #[test]
    fn listings_route_keeps_public_fields_and_filters_unknown_keys() {
        assert_eq!(feed_def("listings").map(|d| d.rel),
                   Some(".meshvault/status/deck/listings.json"));
        let text = r#"{"t":1790712000,"refresh":3600,"src":["public shopping MCP search"],
            "counts":{"facebook-marketplace":1,"ebay":0},"counts_this_run":{"facebook-marketplace":1,"ebay":0},"query":"bike",
            "status":"partial","generated_at":1790712000,
            "source_status":{"ebay":{"status":"unavailable","checked_at":1790712000,"last_ok_at":null,"rows":0,"raw":0,"reason":"needs eBay API keys (credentials missing)"}},
            "listings":[{"title":"Used bike","price":200,"currency":null,"source":"facebook-marketplace",
                         "url":"https://www.facebook.com/marketplace/item/123/",
                         "first_seen":1790710000,"last_seen":1790712000,"seen_this_run":false,"token":"DO_NOT_SERVE"}],
            "private_data":"DO_NOT_SERVE"}"#;
        let result = deck_feed_from(&LISTINGS, text, None, NOW);
        assert_eq!(result["stale"], false);
        assert_eq!(result["counts"]["ebay"], 0);
        assert_eq!(result["counts_this_run"]["facebook-marketplace"], 1);
        assert_eq!(result["source_status"]["ebay"]["status"], "unavailable");
        assert_eq!(result["source_status"]["ebay"]["last_ok_at"], Value::Null);
        assert_eq!(result["status"], "partial");
        assert_eq!(result["listings"][0]["seen_this_run"], false);
        assert_eq!(result["listings"][0]["currency"], Value::Null);
        assert_eq!(result["listings"][0]["url"], "https://www.facebook.com/marketplace/item/123/");
        assert!(!result.to_string().contains("DO_NOT_SERVE"));
    }

    #[test]
    fn ecom_feed_goes_stale_after_two_refreshes() {
        // refresh 3600: 1 h 59 m old is fresh, 2 h 1 m old is stale
        let at = |age: u64| format!(r#"{{"t":{},"refresh":3600,"watch":[]}}"#, NOW - age);
        assert_eq!(deck_feed_from(&ECOM, &at(7140), None, NOW)["stale"], false);
        assert_eq!(deck_feed_from(&ECOM, &at(7260), None, NOW)["stale"], true);
        // the rows survive when stale, so the deck can show them under a STALE mark
        let v = deck_feed_from(&ECOM, &at(7260), None, NOW);
        assert!(v["watch"].is_array());
        assert_eq!(deck_feed_from(&ECOM, "[1]", None, NOW)["error"], "bad json");
    }

    /// 2026-10-21 status fields (FEEDS.md): the whitelist lets the new keys through and nothing else.
    #[test]
    fn ecom_status_fields_pass_and_errors_carry_retry_facts() {
        let text = r#"{"v":1,"t":1790712000,"generated_at":1790712000,"as_of":1790711000,"refresh":3600,
          "errors":[
            {"source":"bestbuy","reason":"layout changed","last_ok":1790600000,"next_retry":1790720000,"can_retry":true,
             "retry_cmd":["python","-m","shoptrends","collect","--sites","bestbuy"],"token":"DO_NOT_SERVE"},
            {"source":"amazon","reason":"bot wall","last_ok":null,"next_retry":1790800000,"can_retry":false,"retry_cmd":null},
            {"source":"bad","reason":"x","last_ok":5,"can_retry":"yes","retry_cmd":["ok",3]}],
          "setup":[{"source":"ebay","line":"eBay is not set up"}],
          "coverage":{"summary":{"total":14,"ok":7,"failing":5,"waiting":1,"setup":1},
            "sites":[{"site":"amazon","status":"blocked","next_retry":1790800000,"can_retry":false,"retry_cmd":null,"setup":null}]},
          "watch":[{"slug":"a","groups":[{"title":"T","count":3,"best_price":1.0,"max_price":2.0,"sites":["x"],
            "items":[{"title":"T","price":1.0,"url":"https://x.test/1","site":"x"}],"items_omitted":2}],"groups_total":9}],
          "private":"DO_NOT_SERVE"}"#;
        let v = deck_feed_from(&ECOM, text, None, NOW);
        assert_eq!(v["generated_at"], 1_790_712_000u64);
        assert_eq!(v["as_of"], 1_790_711_000u64);
        assert_eq!(v["setup"][0]["line"], "eBay is not set up");
        assert_eq!(v["coverage"]["summary"]["total"], 14);
        assert_eq!(v["coverage"]["sites"][0]["next_retry"], 1_790_800_000u64);
        assert_eq!(v["watch"][0]["groups"][0]["count"], 3);
        assert_eq!(v["watch"][0]["groups"][0]["items"][0]["url"], "https://x.test/1");
        assert_eq!(v["watch"][0]["groups_total"], 9);
        let e = &v["errors"];
        assert_eq!(e[0]["last_ok"], 1_790_600_000u64);
        assert_eq!(e[0]["next_retry"], 1_790_720_000u64);
        assert_eq!(e[0]["can_retry"], true);
        assert_eq!(e[0]["retry_cmd"], json!(["python", "-m", "shoptrends", "collect", "--sites", "bestbuy"]));
        assert_eq!((e[1]["last_ok"].clone(), e[1]["can_retry"].clone(), e[1]["retry_cmd"].clone()), (Value::Null, json!(false), Value::Null));
        // a wrong type never becomes a fact: an implausible epoch is null, a non-bool is dropped, a mixed argv is null
        assert_eq!(e[2]["last_ok"], Value::Null);
        assert!(e[2].get("can_retry").is_none());
        assert_eq!(e[2]["retry_cmd"], Value::Null);
        let s = v.to_string();
        assert!(!s.contains("DO_NOT_SERVE"), "{s}");
    }

    #[test]
    fn an_older_ecom_file_keeps_two_field_errors() {
        let v = deck_feed_from(&ECOM, r#"{"t":1790712000,"errors":[{"source":"ebay","reason":"blocked (HTTP 403)"}],"watch":[]}"#, None, NOW);
        assert_eq!(v["errors"][0], json!({"source": "ebay", "reason": "blocked (HTTP 403)"}));
        assert!(v.get("generated_at").is_none() && v.get("setup").is_none());
    }

    #[test]
    fn listings_groups_setup_and_as_of_pass() {
        let text = r#"{"t":1790700000,"generated_at":1790712000,"as_of":1790700000,"refresh":3600,"status":"partial",
          "errors":[{"source":"amazon","reason":"connector error"}],
          "setup":[{"source":"ebay","line":"eBay is not set up"}],
          "source_status":{"amazon":{"status":"error","last_ok_at":1790690000,"next_retry":1790715000,"can_retry":true,"retry_cmd":["deck-feed-listings"],"setup":null}},
          "groups":[{"title":"RTX","price":480,"url":"https://x.test/2","source":"offerup","count":4,"best_price":480,"max_price":620,
            "sites":["offerup"],"items":[{"title":"RTX","price":480,"url":"https://x.test/2","source":"offerup"}],"items_omitted":3}],
          "groups_total":12,"listings":[],"counts":{}}"#;
        let v = deck_feed_from(&LISTINGS, text, None, NOW);
        assert_eq!(v["groups"][0]["count"], 4);
        assert_eq!(v["groups"][0]["items"][0]["url"], "https://x.test/2");
        assert_eq!(v["groups_total"], 12);
        assert_eq!(v["setup"][0]["source"], "ebay");
        assert_eq!(v["as_of"], 1_790_700_000u64);
        assert_eq!(v["generated_at"], 1_790_712_000u64);
        assert_eq!(v["source_status"]["amazon"]["next_retry"], 1_790_715_000u64);
        assert_eq!(v["source_status"]["amazon"]["retry_cmd"], json!(["deck-feed-listings"]));
        // `t` stays the newest successful check: the panel computes staleness from it, the freshness line from generated_at
        assert_eq!(v["t"], 1_790_700_000u64);
    }

    #[test]
    fn markets_and_portfolio_carry_generated_at_and_as_of() {
        let m = deck_feed_from(&MARKETS, r#"{"t":1790712000,"generated_at":1790711990,"as_of":{"quotes":1790711900},"as_of_note":null,"board":[]}"#, None, NOW);
        assert_eq!(m["generated_at"], 1_790_711_990u64);
        assert_eq!(m["as_of"]["quotes"], 1_790_711_900u64);
        let p = deck_feed_from(&PORTFOLIO, r#"{"t":1790712000,"generated_at":1790711990,"as_of":{"positions":1788000000,"crypto":1790711000,"prices":1790711990},"as_of_note":"Positions as of 2026-09-28 (owner snapshot).","positions":[]}"#, None, NOW);
        assert_eq!(p["as_of"]["positions"], 1_788_000_000u64);
        assert_eq!(p["as_of_note"], "Positions as of 2026-09-28 (owner snapshot).");
    }

    /// The collector's `as_of_note` names the oldest price beside the newest, so a stale quote is never read as current. Dates and
    /// clock times pass the amount screen on the public route; a quantity smuggled into the same sentence drops the whole note.
    #[test]
    fn public_portfolio_note_keeps_the_oldest_price_time_and_drops_a_smuggled_amount() {
        let note = |text: &str| {
            let file = format!(r#"{{"t":1790712000,"refresh":300,"src":["x"],"errors":[],"as_of_note":"{text}","positions":[]}}"#);
            deck_feed_from(&PORTFOLIO, &file, None, NOW)["as_of_note"].clone()
        };
        let ok = "Positions as of 2026-09-28 (owner screenshot snapshot); prices as of 2026-09-29 19:59 UTC. Oldest price: 2026-08-30 19:59 UTC.";
        assert_eq!(note(ok), ok);
        let gap = "Positions as of 2026-09-28 (owner screenshot snapshot); prices as of 2026-09-29 19:59 UTC. Some prices have no usable time.";
        assert_eq!(note(gap), gap);
        assert!(note("Oldest price: 2026-08-30 19:59 UTC. 424242 shares of AAA.").is_null(), "an amount drops the note whole");
    }

    /// The public portfolio feed keeps symbol, price and percent only. Quantities, values, dollar changes and cash are
    /// dropped even when a collector nests them inside `basis`, `totals` or a position row.
    #[test]
    fn public_portfolio_drops_nested_amounts() {
        let file = r#"{"t":1790712000,"refresh":300,"src":["x"],"errors":[],
          "basis":{"equity_qty_as_of":1788000000,"equity_qty_age_days":7,"crypto_live":true,"cash_usd":424242,"net_est_usd":313131},
          "totals":{"day_pct":-1.5,"positions":2,"priced":2,"margin_in_use":false,"positions_usd":919191,"day_chg_usd":565656,"margin_cash_usd":-777777},
          "positions":[{"symbol":"AAA","kind":"equity","name":"Alpha","price":100.0,"chg":-1.0,"pct":-0.99,"t":1790711900,
                        "qty":424242,"value":313131,"day_chg":565656,"weight_pct":12.5,"cost_basis":919191},
                       "919191",
                       {"symbol":"XRP","kind":"crypto","price":null,"pct":null,"t":null,"qty":777777}]}"#;
        let v = deck_feed_from(&PORTFOLIO, file, None, NOW);
        let body = v.to_string();
        for probe in ["424242", "313131", "919191", "565656", "777777", "\"qty\"", "\"value\"", "cost_basis", "weight_pct", "_usd", "cash"] {
            assert!(!body.contains(probe), "{probe} in public portfolio: {body}");
        }
        assert_eq!(v["positions"].as_array().map(Vec::len), Some(2), "non-object rows are dropped");
        assert_eq!(v["positions"][0]["symbol"], "AAA");
        assert_eq!(v["positions"][0]["price"], 100.0);
        assert!(v["positions"][1]["price"].is_null(), "an unpriced position stays unknown, not zero");
        assert_eq!(v["totals"]["day_pct"], -1.5);
        assert_eq!(v["basis"]["equity_qty_age_days"], 31, "the stored 7 is replaced by the age from the stamp and the clock");
    }

    /// The collector's day count and live flag were true when it wrote the file. The served feed rebuilds both from the stamps
    /// and the clock: an old snapshot never reads as a day or two old, a stamp past the clock or no stamp is unknown (never 0),
    /// and crypto is live only while the feed is fresh and its balance is under a day old.
    #[test]
    fn public_portfolio_basis_age_and_live_follow_the_clock_not_the_stored_values() {
        let day = 86_400u64;
        let file = |stored: u64, as_of: &str, eq: &str, cr: &str, t: u64| {
            format!(
                r#"{{"t":{t},"refresh":300,"src":["x"],"errors":[],{as_of}
                "basis":{{"equity_qty_as_of":{eq},"equity_qty_age_days":{stored},"crypto_qty_as_of":{cr},"crypto_live":true}},"positions":[]}}"#
            )
        };
        let basis = |text: String| deck_feed_from(&PORTFOLIO, &text, None, NOW)["basis"].clone();
        // written with a one-day-old snapshot, served 40 days later from the same file: still 40 days, not "1"
        let b = basis(file(1, "", &(NOW - 40 * day).to_string(), &(NOW - 40 * day).to_string(), NOW - 40 * day));
        assert_eq!(b["equity_qty_age_days"], 40);
        assert_eq!(b["crypto_live"], false, "a feed 40 days old is not live");
        // the as_of.positions stamp wins over the basis stamp, as on the page
        let b = basis(file(9, &format!(r#""as_of":{{"positions":{}}},"#, NOW - 2 * day - 60), &(NOW - 9 * day).to_string(), &NOW.to_string(), NOW - 30));
        assert_eq!(b["equity_qty_age_days"], 2);
        assert_eq!(b["crypto_live"], true, "a fresh feed with a fresh balance stays live");
        // a balance over a day old is not live even in a fresh feed
        assert_eq!(basis(file(0, "", &NOW.to_string(), &(NOW - day - 1).to_string(), NOW - 30))["crypto_live"], false);
        // a stamp past the clock, and a missing stamp, read unknown
        let b = basis(file(0, "", &(NOW + 3600).to_string(), &(NOW + 3600).to_string(), NOW - 30));
        assert!(b["equity_qty_age_days"].is_null(), "future stamp: {b}");
        assert_eq!(b["crypto_live"], false);
        let b = basis(file(5, "", "null", "null", NOW - 30));
        assert!(b["equity_qty_age_days"].is_null() && b["crypto_live"] == false, "no stamp: {b}");
    }

    /// A stamp of zero (a collector hiccup) or below is no time. It reads unknown (null), not "20,000 days old", and the basis stamp
    /// stands in when `as_of.positions` is zero, exactly as when it is missing.
    #[test]
    fn public_portfolio_zero_stamp_is_unknown_not_decades_old() {
        let day = 86_400u64;
        let age = |as_of: &str, eq: &str| {
            let file = format!(
                r#"{{"t":{t},"refresh":300,"src":["x"],"errors":[],{as_of}"basis":{{"equity_qty_as_of":{eq},"equity_qty_age_days":1,"crypto_qty_as_of":0,"crypto_live":true}},"positions":[]}}"#,
                t = NOW - 30
            );
            deck_feed_from(&PORTFOLIO, &file, None, NOW)["basis"].clone()
        };
        let b = age(r#""as_of":{"positions":0},"#, "0");
        assert!(b["equity_qty_age_days"].is_null(), "zero stamps: {b}");
        assert_eq!(b["crypto_live"], false, "a zero balance stamp is never live");
        let b = age(r#""as_of":{"positions":-5},"#, "0");
        assert!(b["equity_qty_age_days"].is_null(), "negative stamp: {b}");
        let b = age(r#""as_of":{"positions":0},"#, &(NOW - 3 * day).to_string());
        assert_eq!(b["equity_qty_age_days"], 3, "a zero as_of falls back to the basis stamp: {b}");
    }

    /// An allow-listed key is not enough: the value must also have the contract's type. A collector that put an object,
    /// a string of digits or prose with an amount under `price`, `name` or a note would otherwise carry it out.
    #[test]
    fn public_portfolio_keeps_only_contract_types_under_allowed_keys() {
        let file = r#"{"t":1790712000,"refresh":300,"src":["x"],"errors":[],
          "as_of":{"positions":1788000000,"crypto":1790711000,"cash":424242},
          "as_of_note":"Cash is $424242 in the snapshot.",
          "basis":{"equity_qty_as_of":{"v":313131},"equity_qty_age_days":"919191","crypto_live":"565656",
                   "equity_qty_source":"owner snapshot, 777777 shares of AAA","crypto_qty_source":"Kraken balance via mesh-brokers-snapshot, read-only",
                   "price_note":"Equity prices are delayed public quotes; day change is the last regular session. Crypto day change is over 24 hours."},
          "totals":{"day_pct":"424242","equity_day_pct":[313131],"crypto_day_pct":-2.0,"positions":{"n":919191},"priced":2,"margin_in_use":"yes"},
          "positions":[{"symbol":"AAA","kind":"equity","name":"Alpha","price":{"usd":424242},"chg":"313131","pct":[919191],"t":"565656"},
                       {"symbol":"AAA 777777 shares","kind":"equity","name":"Alpha","price":1.0,"pct":0.1,"t":1790711900},
                       {"symbol":"BBB","kind":"cash 424242","name":{"qty":313131},"price":50.5,"chg":0.5,"pct":1.0,"t":1790711900}]}"#;
        let v = deck_feed_from(&PORTFOLIO, file, None, NOW);
        let body = v.to_string();
        for probe in ["424242", "313131", "919191", "565656", "777777", "\"v\"", "\"usd\"", "\"qty\"", "\"n\""] {
            assert!(!body.contains(probe), "{probe} in public portfolio: {body}");
        }
        assert_eq!(v["as_of"]["positions"], 1_788_000_000u64);
        assert!(v["as_of"].get("cash").is_none());
        assert!(v.get("as_of_note").is_none_or(Value::is_null), "prose with an amount is dropped whole");
        assert!(v["basis"]["equity_qty_source"].is_null(), "prose with a quantity is dropped whole");
        // the collector's own wording (scripts/deck-feed-portfolio) must survive the check
        assert_eq!(v["basis"]["crypto_qty_source"], "Kraken balance via mesh-brokers-snapshot, read-only");
        assert_eq!(
            v["basis"]["price_note"],
            "Equity prices are delayed public quotes; day change is the last regular session. Crypto day change is over 24 hours."
        );
        assert_eq!(v["totals"]["crypto_day_pct"], -2.0);
        assert_eq!(v["totals"]["priced"], 2);
        assert!(v["totals"]["day_pct"].is_null() && v["totals"]["positions"].is_null(), "a wrong type reads unknown, never zero");
        let rows = v["positions"].as_array().cloned().unwrap_or_default();
        assert_eq!(rows.len(), 2, "a row whose symbol is not a ticker is dropped: {body}");
        assert!(rows[0]["price"].is_null() && rows[0]["chg"].is_null() && rows[0]["pct"].is_null() && rows[0]["t"].is_null());
        assert_eq!(rows[1]["symbol"], "BBB");
        assert!(rows[1]["kind"].is_null(), "a kind outside equity or crypto reads unknown");
        assert!(rows[1]["name"].is_null());
        assert_eq!(rows[1]["price"], 50.5);
    }

    /// A position name is the one free-text field on a row. Real instrument names keep their digits ("3M", "S&P 500", "20+ Year");
    /// a name that carries a quantity, a value or a money word reads unknown, so the row still shows its symbol and price.
    #[test]
    fn public_portfolio_names_keep_real_digits_and_drop_amount_shaped_text() {
        let name = |n: &str| {
            let file = format!(r#"{{"t":1790712000,"refresh":300,"src":["x"],"errors":[],"positions":[{{"symbol":"AAA","kind":"equity","name":"{n}","price":1.0,"pct":0.1,"t":1790711900}}]}}"#);
            deck_feed_from(&PORTFOLIO, &file, None, NOW)["positions"][0]["name"].clone()
        };
        for ok in ["3M Company", "SPDR S&P 500 ETF Trust", "iShares 20+ Year Treasury Bond ETF", "Vanguard Total Stock Market ETF Shares", "Roundhill 2x Leveraged"] {
            assert_eq!(name(ok), ok, "{ok} is an ordinary name");
        }
        for bad in ["Alpha 777777 shares", "Alpha 4,242 shares", "Alpha 12.5 held", "Alpha 12k", "Alpha 424242USD", "Alpha 313 USD", "Alpha worth 5 dollars", "Alpha (qty4242)"] {
            assert!(name(bad).is_null(), "{bad} must read unknown");
        }
    }

    /// A feed stamp past the clock is not trusted: the file's mtime dates it, and with no mtime it reads stale, never fresh.
    #[test]
    fn public_portfolio_with_a_future_stamp_is_not_read_as_fresh() {
        let file = format!(r#"{{"t":{},"refresh":300,"src":["x"],"errors":[],"positions":[]}}"#, NOW + 86_400);
        let none = deck_feed_from(&PORTFOLIO, &file, None, NOW);
        assert_eq!(none["stale"], true, "future stamp, no mtime: {none}");
        assert!(none["t"].is_null());
        let old = deck_feed_from(&PORTFOLIO, &file, Some(NOW - 3_600), NOW);
        assert_eq!(old["stale"], true, "future stamp, old mtime: {old}");
        assert_eq!(old["t"], NOW - 3_600);
        assert_eq!(deck_feed_from(&PORTFOLIO_VALUES, &file, None, NOW)["stale"], true);
    }

    /// The collector's `errors` and `src` lines are free text. On the public route a line that could carry an amount is
    /// replaced whole, while ordinary failure wording (a status code, a host name, a ticker, a date) stays readable.
    #[test]
    fn public_portfolio_diagnostics_withhold_amount_shaped_text_and_keep_ordinary_wording() {
        let file = r#"{"t":1790712000,"refresh":300,
          "src":["IBKR Flex end-of-day report (read-only cache)","finance.yahoo.com chart","cash 424242 held","api.kraken.com public"],
          "errors":[{"source":"quote AAA","reason":"HTTP 503 from query1.finance.yahoo.com","last_ok":1790711000,"retry_cmd":["deck-feed-portfolio"]},
                    {"source":"kraken XRP","reason":"kraken: balance $313,131 short"},
                    {"source":"quote 919191","reason":"holding 565656.5 shares"},
                    {"source":"kraken balance","reason":"live balance snapshot missing or older than 6h; screenshot units used"},
                    {"source":"quote BBB","reason":"yahoo: no quote time for BBB since 2026-11-10 at 6:40"},
                    {"source":"cash","reason":"12k of cash, 777777 USD"},
                    {"source":"units","reason":"4.2m in positions"}],
          "positions":[]}"#;
        let v = deck_feed_from(&PORTFOLIO, file, None, NOW);
        let body = v.to_string();
        for probe in ["424242", "313,131", "313131", "919191", "565656", "777777", "12k", "4.2m"] {
            assert!(!body.contains(probe), "{probe} in public portfolio diagnostics: {body}");
        }
        let src: Vec<&str> = v["sources"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
        assert_eq!(src, ["IBKR Flex end-of-day report (read-only cache)", "finance.yahoo.com chart", "detail withheld", "api.kraken.com public"]);
        let errs = v["errors"].as_array().cloned().unwrap_or_default();
        assert_eq!(errs.len(), 7, "a withheld line still reports that a source failed: {body}");
        assert_eq!(errs[0]["reason"], "HTTP 503 from query1.finance.yahoo.com");
        assert_eq!(errs[0]["last_ok"], 1_790_711_000u64, "retry facts survive the screen");
        assert_eq!(errs[0]["retry_cmd"], json!(["deck-feed-portfolio"]));
        assert_eq!(errs[1]["source"], "kraken XRP");
        assert_eq!(errs[1]["reason"], "detail withheld");
        assert_eq!(errs[2]["source"], "detail withheld");
        assert_eq!(errs[3]["reason"], "live balance snapshot missing or older than 6h; screenshot units used");
        assert_eq!(errs[4]["reason"], "yahoo: no quote time for BBB since 2026-11-10 at 6:40");
        assert_eq!(errs[5]["reason"], "detail withheld");
        assert_eq!(errs[6]["reason"], "detail withheld");
    }

    #[test]
    fn portfolio_values_is_not_in_the_generic_feed_route() {
        assert!(feed_def("portfolio-values").is_none(), "PORTFOLIO_VALUES must never be in FEEDS");
        assert!(feed_def("portfolio").is_some());
    }

    #[test]
    fn serverpage_route_keeps_health_and_local_schedule_but_never_mailbox_data() {
        let Some(d) = feed_def("serverpage") else {
            panic!("serverpage route must exist");
        };
        let text = r#"{"t":1790712200,"refresh":120,"gateway":{"ok":true,"state":"running","platforms_up":3,"restarts":null},"mail":{"next":{"name":"Reply block","at":1790730000,"kind":"send"},"items":[],"paused_mail_crons":null,"gmail":{"count":99},"subject":"private"},"token":"private"}"#;
        let v = deck_feed_from(d, text, None, NOW);
        assert_eq!(v["gateway"]["platforms_up"], 3);
        assert!(v["gateway"]["restarts"].is_null());
        assert_eq!(v["mail"]["next"]["name"], "Reply block");
        assert!(v["mail"].get("gmail").is_none());
        assert!(v["mail"].get("subject").is_none());
        assert!(v.get("token").is_none());
        assert_eq!(v["refresh"], 120);
        assert_eq!(v["stale"], false);
    }

    /// A portfolio file older than twice its refresh reads stale, so the deck never shows old quantities as current.
    #[test]
    fn portfolio_older_than_twice_its_refresh_is_stale() {
        let file = r#"{"t":1790712000,"refresh":300,"src":["x"],"errors":[],"positions":[]}"#;
        assert_eq!(deck_feed_from(&PORTFOLIO, file, None, 1_790_712_000 + 600)["stale"], false);
        assert_eq!(deck_feed_from(&PORTFOLIO, file, None, 1_790_712_000 + 601)["stale"], true);
        assert_eq!(deck_feed_from(&PORTFOLIO_VALUES, file, None, 1_790_712_000 + 601)["stale"], true);
    }

    #[tokio::test]
    async fn missing_ecom_feed_is_unavailable_not_zero() {
        let v = Cache::default()
            .get(Path::new("/nonexistent-pixel-deck-test"), &ECOM)
            .await;
        assert_eq!(v["error"], "file missing");
        assert_eq!(v["stale"], true);
        assert!(v.get("watch").is_none() && v.get("coverage").is_none());
    }

    #[test]
    fn onthisday_keeps_counts_and_years_and_never_item_ids() {
        let text = r#"{"t":1790712000,"refresh":86400,"src":["photo catalog (read-only)"],"errors":[],"month_day":"10-29","today":"2026-10-29","catalog_rows":29290,"total":64,"years":[{"year":2025,"count":11},{"year":2011,"count":2}],"items":[{"id":21464,"year":2025,"media":"image","name":"IMG_0001.HEIC"}]}"#;
        let v = deck_feed_from(&ONTHISDAY, text, None, NOW);
        assert_eq!(v["total"], 64);
        assert_eq!(v["month_day"], "10-29");
        assert_eq!(v["years"][0]["count"], 11);
        assert_eq!(v["stale"], false);
        assert!(v.get("items").is_none() && v.get("catalog_rows").is_none());
        assert!(!v.to_string().contains("IMG_0001"));
    }

    #[test]
    fn photoyears_keeps_year_counts_and_never_item_ids() {
        let text = r#"{"t":1790712000,"refresh":86400,"src":["photo catalog (read-only)"],"errors":[],"generated_at":"2026-10-29T06:35:30-07:00","source":"Photo catalog","dated_total":29357,"undated":27,"other_media":0,"years":[{"year":2025,"image":11,"video":2},{"year":2011,"image":2,"video":0}],"items":[{"id":21464,"year":2025,"media":"image","name":"IMG_0001.HEIC"}]}"#;
        let v = deck_feed_from(&PHOTOYEARS, text, None, NOW);
        assert_eq!(v["dated_total"], 29357);
        assert_eq!(v["undated"], 27);
        assert_eq!(v["years"][0]["image"], 11);
        assert_eq!(v["years"][0]["video"], 2);
        assert_eq!(v["stale"], false);
        assert_eq!(v["refresh"], 86400);
        assert!(v.get("items").is_none() && v.get("generated_at").is_none());
        assert!(!v.to_string().contains("IMG_0001"));
    }

    #[test]
    fn replyblock_keeps_counts_and_draft_links_and_drops_unknown_keys() {
        let text = r#"{"t":1790712000,"refresh":86400,"src":["gmail via composio"],"errors":[],"date":"2026-10-29","card_for":"09:00","mode":"run","generated_at":"2026-10-29T06:40:00-07:00","model":{"used":false,"id":null,"note":"cluster unreachable"},"counts":{"waiting":2,"drafted":2,"cap":15,"gmail_drafts_before":208,"gmail_drafts_after":210},"drafts_url":"https://mail.google.com/mail/u/0/#drafts","items":[{"rank":1,"name":"Casey Harbor","subject":"Quote","drafted":true,"draft_mode":"template","draft_url":"https://mail.google.com/mail/u/0/#drafts/r1"}],"token":"x","state_dump":{"a":1}}"#;
        let v = deck_feed_from(&REPLYBLOCK, text, None, NOW);
        assert_eq!(v["counts"]["drafted"], 2);
        assert_eq!(v["counts"]["cap"], 15);
        assert_eq!(v["card_for"], "09:00");
        assert_eq!(v["items"][0]["draft_url"], "https://mail.google.com/mail/u/0/#drafts/r1");
        assert_eq!(v["stale"], false);
        assert_eq!(v["refresh"], 86400);
        assert!(v.get("generated_at").is_none() && v.get("state_dump").is_none() && v.get("token").is_none());
    }

    #[test]
    fn rankwatch_keeps_run_counts_and_alerts_but_not_apps_or_the_feeds_own_stale() {
        let text = r#"{"t":1790712000,"refresh":86400,"src":["itunes.apple.com/lookup"],"errors":[],"day":"2026-10-29","stale":true,"run":{"at":"2026-10-29T19:23:03+00:00","ok_charts":14,"failed_charts":1},"counts":{"apps":9,"live":0,"alerts_today":1,"alerts_7d":3},"apps":[{"key":"mesh","name":"Mesh"}],"categories":[{"label":"Productivity"}],"alerts":[{"day":"2026-10-29","kind":"jump","severity":"warn","category":"PRODUCTIVITY","chart":"top-free","name":"Rival","text":"Rival moved 25 places."}]}"#;
        let v = deck_feed_from(&RANKWATCH, text, None, NOW);
        assert_eq!(v["run"]["ok_charts"], 14);
        assert_eq!(v["counts"]["alerts_7d"], 3);
        assert_eq!(v["alerts"][0]["kind"], "jump");
        assert_eq!(v["stale"], false, "stale comes from the file age, not the collector's own flag");
        assert!(v.get("apps").is_none() && v.get("categories").is_none());
    }

    const TESTFLIGHT_FILE: &str = r#"{"schema_version":1,"checked_at":"2026-09-29T20:00:00.000Z","refresh_s":300,"apps":[
        {"id":"6786588606","name":"Mesh for Small Business","bundle_id":"net.meshvault.SECRETBUNDLE","checked_at":"2026-09-29T20:00:03.000Z","error":null,
         "versions":[{"id":"ver-uuid","version":"1.3.1","state":"PREPARE_FOR_SUBMISSION","submitted_build":{"id":"b-uuid","number":"70","processing_state":"VALID"},
                      "submission":{"state":"UNRESOLVED_ISSUES","submitted_at":"2026-09-20T01:00:00Z"}}],
         "latest_build":{"id":"build-uuid","number":"72","version":"1.3.1","uploaded_at":"2026-09-29T08:00:00-07:00","processing_state":"VALID","expired":false,
                         "internal_state":"IN_BETA_TESTING","external_state":"READY_FOR_BETA_SUBMISSION"},
         "feedback":{"screenshots_count":114,"crashes_count":7,"last_received_at":"2026-09-28T03:22:32.685Z"}},
        {"id":"6753701850","name":"JudgeFinder.io","bundle_id":"io.judgefinder","checked_at":"2026-09-29T20:00:05.000Z","error":"ASC 429 rate limited",
         "versions":[],"latest_build":null,"feedback":null},
        "junk"]}"#;

    #[test]
    fn testflight_has_one_row_per_app_in_contract_shape_and_drops_ids() {
        let v = deck_feed_from(&TESTFLIGHT, TESTFLIGHT_FILE, None, NOW);
        assert_eq!(feed_def("testflight").map(|d| d.rel), Some(".meshvault/status/deck/testflight.json"));
        let apps = v["apps"].as_array().cloned().unwrap_or_default();
        assert_eq!(apps.len(), 2, "the junk row is not an app");
        assert_eq!(apps[0]["name"], "Mesh for Small Business");
        assert_eq!(apps[0]["latest_build"]["number"], "72");
        assert_eq!(apps[0]["latest_build"]["expired"], false);
        assert_eq!(apps[0]["latest_build"]["internal_state"], "IN_BETA_TESTING");
        assert_eq!(apps[0]["feedback"]["crashes_count"], 7);
        assert_eq!(apps[0]["feedback"]["screenshots_count"], 114);
        assert_eq!(apps[0]["versions"][0]["version"], "1.3.1");
        assert_eq!(apps[0]["versions"][0]["build"], "70");
        // the live file keeps the review verdict on the submission, not on the version
        assert_eq!(apps[0]["versions"][0]["state"], "PREPARE_FOR_SUBMISSION");
        assert_eq!(apps[0]["versions"][0]["submission_state"], "UNRESOLVED_ISSUES");
        assert_eq!(apps[0]["error"], Value::Null);
        assert_eq!(apps[1]["latest_build"], Value::Null);
        assert_eq!(apps[1]["feedback"], Value::Null);
        let s = v.to_string();
        for leak in ["bundle_id", "SECRETBUNDLE", "ver-uuid", "build-uuid", "b-uuid", "schema_version"] {
            assert!(!s.contains(leak), "{leak} leaked: {s}");
        }
        // a per-app failure is an errors row, never a quiet zero
        assert_eq!(v["errors"][0]["source"], "JudgeFinder.io");
        assert_eq!(v["errors"][0]["reason"], "ASC 429 rate limited");
    }

    #[test]
    fn testflight_freshness_comes_from_checked_at_until_the_collector_writes_t() {
        let v = deck_feed_from(&TESTFLIGHT, TESTFLIGHT_FILE, Some(NOW), NOW);
        assert_eq!(v["t"], 1_790_712_000u64, "checked_at wins over the file mtime");
        assert_eq!(v["refresh"], 300);
        assert_eq!(v["stale"], false);
        assert_eq!(deck_feed_from(&TESTFLIGHT, TESTFLIGHT_FILE, Some(NOW), NOW + 700)["stale"], true);
        // once L5's top-level t lands it is used as is
        let with_t = TESTFLIGHT_FILE.replacen("{\"schema_version\":1,", "{\"schema_version\":1,\"t\":1790712200,\"refresh\":300,", 1);
        assert_eq!(deck_feed_from(&TESTFLIGHT, &with_t, None, NOW)["t"], 1_790_712_200u64);
        let bad = deck_feed_from(&TESTFLIGHT, r#"{"checked_at":"2026-09-29T20:00:00Z"}"#, None, NOW);
        assert_eq!(bad["errors"][0]["reason"], "no apps list");
        assert!(bad.get("apps").is_none());
    }

    const TAILSCALE_FILE: &str = r#"{"t":1790712000,"refresh":300,"src":["tailscale status --json"],"errors":[],"ok":true,"writer":"ts-watch.timer",
        "counts":{"own_devices":5,"own_online":3,"funnel_public":1,"warn":1,"crit":0,"info":2,"exposures":3,"mullvad_exit_nodes":532},
        "alerts":[
          {"host":"pc-desktop","kind":"funnel_public","severity":"warn","msg":"PUBLIC internet via Funnel: https://pc-desktop.<tailnet>:443/ -> http://127.0.0.1:8941"},
          {"host":"grok-bot-box-lo","kind":"stale_node","severity":"info","msg":"grok-bot-box-lo offline 11d"},
          {"host":"lo-phone","kind":"key_expiry_disabled","severity":"warn","msg":"lo-phone has key expiry disabled"},
          {"host":"dell","kind":"traffic_spike","severity":"info","msg":"dell reached 198.51.100.2 and 198.51.100.9.","t":1790700000.5}],
        "exposures":[{"funnel":1,"host":"pc-desktop","path":"/","port":"443","proto":"https"},
                     {"funnel":0,"host":"mac-mini","path":"/x","port":"10443","proto":"https"}],
        "nodes":[
          {"name":"dell","host":"mesh","online":true,"last_seen_h":null,"os":"linux","kind":"own","conn":"direct-wan","relay":"lax","rx_mib":871,"tx_mib":639,"key_days":142},
          {"name":"pc-desktop","host":"pc-desktop","online":true,"last_seen_h":null,"os":"linux","kind":"self"},
          {"name":"mac-pro","host":"desktop","online":false,"last_seen_h":70.14,"os":"macOS","kind":"own"},
          {"name":"lo-phone","host":"lo's phone","online":true,"last_seen_h":null,"os":"iOS","kind":"own"},
          {"name":"los-macbook-air","host":"Lo\u2019s MacBook Air","online":false,"last_seen_h":6.8,"os":"macOS","kind":"own"}],
        "events":[{"host":"dell","kind":"traffic_spike"}],"probes":{"dell":{"ok":true}}}"#;

    #[test]
    fn tailscale_drops_other_tenant_devices_ips_and_traffic_and_recounts() {
        let v = deck_feed_from(&TAILSCALE, TAILSCALE_FILE, None, NOW);
        assert_eq!(v["counts"], json!({"own_devices": 3, "own_online": 2, "funnel_public": 1, "warn": 1, "crit": 0}));
        let names: Vec<&str> = v["nodes"].as_array().into_iter().flatten().filter_map(|n| n["name"].as_str()).collect();
        assert_eq!(names, ["dell", "pc-desktop", "mac-pro"]);
        assert_eq!(v["nodes"][2]["last_seen_h"], 70.1);
        assert!(v["nodes"][0]["last_seen_h"].is_null());
        let alerts = v["alerts"].as_array().cloned().unwrap_or_default();
        assert_eq!(alerts.len(), 2, "the lo-phone and grok-bot-box-lo alerts are not Tanner's");
        assert_eq!(alerts[0]["msg"], "PUBLIC internet via Funnel: https://pc-desktop.<tailnet>:443/ -> http://localhost:8941");
        assert_eq!(alerts[1]["msg"], "dell reached <ip> and <ip>.");
        assert_eq!(v["exposures"][0], json!({"host": "pc-desktop", "port": 443, "path": "/", "proto": "https", "funnel": true}));
        assert_eq!(v["exposures"][1]["funnel"], false);
        let s = v.to_string();
        for leak in ["rx_mib", "tx_mib", "key_days", "relay", "direct-wan", "100.64", "192.168", "127.0.0.1", "lo-phone", "Lo\u{2019}s", "mullvad", "probes", "events"] {
            assert!(!s.contains(leak), "{leak} leaked: {s}");
        }
        assert_eq!(v["stale"], false);
    }

    #[test]
    fn tailscale_missing_lists_are_errors_not_zero_counts() {
        let v = deck_feed_from(&TAILSCALE, r#"{"t":1790712000,"ok":false,"counts":{"own_devices":9,"own_online":8,"funnel_public":2,"warn":3,"crit":1}}"#, None, NOW);
        let reasons: Vec<&str> = v["errors"].as_array().into_iter().flatten().filter_map(|e| e["reason"].as_str()).collect();
        for r in ["collector reported a failed run", "no alerts list", "no nodes list", "no exposures list"] {
            assert!(reasons.contains(&r), "{r}: {reasons:?}");
        }
        // with the rows gone the file's own totals are the best truth left
        assert_eq!(v["counts"]["own_devices"], 9);
        assert_eq!(v["counts"]["funnel_public"], 2);
        assert!(v.get("nodes").is_none());
    }

    #[test]
    fn ip_scrub_and_tenant_rules() {
        assert_eq!(scrub_ips("a 203.0.113.1:80, 127.0.0.1. v1.2.3 1.2.3.4.5 done"), "a <ip>:80, localhost. v1.2.3 1.2.3.4.5 done");
        assert_eq!(scrub_ips("no digits \u{2019}s"), "no digits \u{2019}s");
        for yes in ["lo-phone", "los-macbook-air", "Lo's phone", "Lo\u{2019}s MacBook Air", "grok-bot-box-lo", "quill-laptop", "Morgan iPad"] {
            assert!(other_tenant(yes), "{yes}");
        }
        for no in ["pc-desktop", "dell", "mac-mini", "grok-bot-box", "logitech", "tanners-phone", ""] {
            assert!(!other_tenant(no), "{no}");
        }
    }

    #[test]
    fn deadlines_keep_the_contract_fields_only() {
        let text = r#"{"t":1790712000,"refresh":3600,"src":["subsradar card","paperwork due"],"errors":[{"source":"paperwork","reason":"timed out"}],
            "renewals":[{"vendor":"Figma","date":"2026-10-29","days":0,"usd":12.5,"card":"6254","basis":"mail"},"junk"],
            "paperwork":[{"id":"pw-1","kind":"domain","thing":"velliq.io","date":"2026-10-02","days_left":-27,"status":"expired",
                          "evidence":[{"quote":"SECRET QUOTE","sender":"x@y.z"}],"extractors":["llm"],"history":[]}]}"#;
        let v = deck_feed_from(&DEADLINES, text, None, NOW);
        assert_eq!(v["renewals"], json!([{"vendor": "Figma", "date": "2026-10-29", "days": 0}]));
        assert_eq!(v["paperwork"][0], json!({"id": "pw-1", "kind": "domain", "thing": "velliq.io", "date": "2026-10-02", "days_left": -27, "status": "expired"}));
        assert_eq!(v["errors"][0], json!({"source": "paperwork", "reason": "timed out"}));
        assert_eq!(v["refresh"], 3600);
        let s = v.to_string();
        for leak in ["usd", "6254", "SECRET", "x@y.z", "extractors", "evidence"] {
            assert!(!s.contains(leak), "{leak} leaked: {s}");
        }
        let none = deck_feed_from(&DEADLINES, r#"{"t":1790712000}"#, None, NOW);
        assert_eq!(none["errors"].as_array().map(Vec::len), Some(2));
        assert!(none.get("renewals").is_none() && none.get("paperwork").is_none());
    }

    /// The calendar route serves Tanner's own events only: LOTO is another tenant, `location` never ships, a failed
    /// calendar becomes one error row, and `conflicts`/`doubles` stay out of the payload.
    #[test]
    fn calendar_drops_the_other_tenant_and_places() {
        let t = r#"{"generated_at":"2026-10-29T14:53:25-07:00","tz":"America/Los_Angeles","window_days":14,
            "sources":[{"name":"iCloud","kind":"personal","ok":true,"error":null},
                       {"name":"iCloud LOTO","kind":"shifts","ok":true,"error":null},
                       {"name":"iCloud Finances","kind":"bills","ok":false,"error":"token expired"}],
            "days":[{"date":"2026-10-29","events":[
                {"id":"a","title":"AU: ATFL","all_day":false,"start":"2026-10-29T07:30:00-07:00","end":"2026-10-29T08:30:00-07:00","kind":"personal","source":"iCloud OC COAST","sources":["iCloud OC COAST"],"location":"123 Main St"},
                {"id":"b","title":"LACoFD shift (black day)","all_day":true,"start":null,"end":null,"kind":"shifts","source":"iCloud LOTO","sources":["iCloud LOTO"],"location":null}]}],
            "bills_due":[{"name":"Figma","date":"2026-10-29","days":0}],
            "conflicts":[{"date":"2026-10-29","a":"LOTO shift","b":"AU: ATFL"}],"doubles":1}"#;
        let v = parse(&CALENDAR, t, Some(NOW), NOW);
        let evs = v["days"][0]["events"].as_array().cloned().unwrap_or_default();
        assert_eq!(evs.len(), 1, "the LOTO event is another tenant: {v}");
        assert_eq!(evs[0]["title"], "AU: ATFL");
        assert!(evs[0].get("location").is_none(), "no place ever reaches the page");
        assert!(evs[0].get("sources").is_none());
        let names: Vec<String> = v["calendars"].as_array().cloned().unwrap_or_default().iter().map(|s| short(s.get("name"), 60)).collect();
        assert!(!names.iter().any(|n| n.to_lowercase().contains("loto")), "{names:?}");
        assert!(v.get("conflicts").is_none() && v.get("doubles").is_none());
        assert_eq!(v["errors"][0]["source"], "iCloud Finances");
        assert_eq!(v["bills_due"][0]["name"], "Figma");
        assert_eq!(v["src"], "~/.meshvault/status/calendar/agenda.json");
    }

    #[test]
    fn calendar_without_the_file_is_a_clear_failure() {
        let v = fail(&CALENDAR, "file missing");
        assert_eq!(v["error"], "file missing");
        assert_eq!(v["src"], "~/.meshvault/status/calendar/agenda.json");
        assert_eq!(v["refresh"], 600);
    }

    #[test]
    fn contract_feeds_map_sources_errors_and_generated_at() {
        let body = r#"{"feed":"travel-deals","generated_at":"2026-09-29T19:00:00Z",
            "sources":[{"name":"Google Flights","url":"https://www.google.com/travel/flights","fetched_at":"2026-09-30T19:00:00Z"}],
            "items":[{"id":"f-1","title":"LAX to ATH","price":627,"currency":"USD","savings_pct":null,
                      "source_url":"https://www.google.com/travel/flights","as_of":"2026-09-30T19:00:00Z","api_key":"x"}],
            "errors":[{"source":"kayak","error":"blocked by site"}],"summary":{"LAX-ATH":{"best":627}}}"#;
        let v = deck_feed_from(&TRAVEL_DEALS, body, None, NOW);
        assert_eq!(v["t"], 1_790_708_400u64);
        assert_eq!(v["stale"], false);
        assert_eq!(v["sources"][0], "Google Flights");
        assert_eq!(v["errors"][0]["reason"], "blocked by site");
        assert_eq!(v["items"][0]["price"], 627);
        assert!(v["items"][0]["savings_pct"].is_null(), "unknown stays null, never 0");
        assert!(v["items"][0].get("api_key").is_none());
        assert_eq!(v["summary"]["LAX-ATH"]["best"], 627);
        assert_eq!(v["src"], "~/.meshvault/status/travel-deals.json");
        let missing = fail(&LIFE, "file missing");
        assert_eq!(missing["error"], "file missing");
        assert_eq!(missing["src"], "~/.meshvault/status/life.json");
    }

    /// The Surf cards read `break_cams` from the outdoors feed: kept, with the cam urls intact and a break with no cam staying null.
    #[test]
    fn outdoors_feed_keeps_break_cams() {
        let body = r#"{"feed":"outdoors","generated_at":"2026-09-29T19:00:00Z","sources":[],"items":[],"errors":[],
            "sections":{"cams":{"cams":[{"id":"x"}]}},
            "break_cams":[{"spot":"San Clemente Pier","aka":"T-Street","surfline_url":"https://www.surfline.com/surf-report/t-street/5842041f4e65fad6a7708830",
              "cam":{"id":"san-clemente-beach","operator":"City of San Clemente","distance_km":0.0,
                     "view_url":"https://www.youtube.com/watch?v=2c7NV66YzKA","player_url":"https://www.youtube-nocookie.com/embed/2c7NV66YzKA?autoplay=1&mute=1&playsinline=1&rel=0"}},
             {"spot":"Trestles","aka":null,"cam":null,"surfline_url":"https://www.surfline.com/surf-report/lower-trestles/5842041f4e65fad6a770888a"}]}"#;
        let v = deck_feed_from(&OUTDOORS, body, None, NOW);
        assert_eq!(v["break_cams"][0]["cam"]["id"], "san-clemente-beach");
        assert!(v["break_cams"][0]["cam"]["player_url"].as_str().is_some_and(|u| u.starts_with("https://www.youtube-nocookie.com/embed/")));
        assert!(v["break_cams"][1]["cam"].is_null());
        assert!(v.get("sections").is_none(), "the rich sections block stays in the file");
        // life and history keep only their items
        let life = deck_feed_from(&LIFE, &body.replace("\"feed\":\"outdoors\"", "\"feed\":\"life\""), None, NOW);
        assert!(life.get("break_cams").is_none());
    }
}
