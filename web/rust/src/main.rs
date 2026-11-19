//! Pixel Deck server (Rust). Same routes, JSON shapes and auth as server.py, plus
//! /healthz, /api/today, /api/cams and an allowlisted HLS proxy at /cam/<name>/<file>.
mod apps;
mod almanac;
mod amazon;
mod commerce;
mod clienterr;
mod compress;
mod crons;
mod devstatic;
mod cre;
mod ecom_market;
mod actions;
mod finance;
mod fleet;
mod fleetboard;
mod fleetwidgets;
mod guest;
mod headers;
mod ha;
mod housing;
mod hosts;
mod keybinds;
mod launch;
mod listings;
mod listing_dedupe;
mod modeldeck;
mod pad;
mod padws;
mod runs;
mod relevance;
mod savedjobs;
mod shell;
mod sources;
mod surf;
mod today;
mod todayslices;
mod traffic;
mod table;
mod util;

use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Router;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use util::{log, parse_qs};

static INDEX: &[u8] = include_bytes!("../../static/index.html");
static UI_CORE_JS: &[u8] = include_bytes!("../../static/ui-core.js");
static GUARD_JS: &[u8] = include_bytes!("../../static/guard.js");
static APP_JS: &[u8] = include_bytes!("../../static/app.js");
static PAD_JS: &[u8] = include_bytes!("../../static/pad.js");
static SW_JS: &[u8] = include_bytes!("../../static/sw.js");
static DECK_JS: &[u8] = include_bytes!("../../static/deck.js");
static SCHEDULES_JS: &[u8] = include_bytes!("../../static/schedules.js");
static AGENTS_JS: &[u8] = include_bytes!("../../static/agents.js");
static INVEST_JS: &[u8] = include_bytes!("../../static/invest.js");
static OPS_JS: &[u8] = include_bytes!("../../static/ops.js");
static HOUSE_JS: &[u8] = include_bytes!("../../static/house.js");
static MANIFEST: &[u8] = include_bytes!("../../static/manifest.webmanifest");
static HLS_JS: &[u8] = include_bytes!("../../static/hls.min.js");
static ICON_SVG: &[u8] = include_bytes!("../../static/icon.svg");
static ICON_192: &[u8] = include_bytes!("../../static/icon-192.png");
static ICON_512: &[u8] = include_bytes!("../../static/icon-512.png");
static APPLE_ICON: &[u8] = include_bytes!("../../static/apple-touch-icon.png");
static LOGIN: &[u8] = include_bytes!("../../static/login.html");
static CRE_HTML: &[u8] = include_bytes!("../../static/cre.html");
static CRE_JS: &[u8] = include_bytes!("../../static/cre.js");
static CRE_BOOT_JS: &[u8] = include_bytes!("../../static/cre-boot.js");
static TOKENS_CSS: &[u8] = include_bytes!("../../static/tokens.css");
static UI_CSS: &[u8] = include_bytes!("../../static/ui.css");
static APP_CSS: &[u8] = include_bytes!("../../static/app.css");
static TV_CSS: &[u8] = include_bytes!("../../static/tv.css");
static TV_JS: &[u8] = include_bytes!("../../static/tv.js");
static CSS_TODAY: &[u8] = include_bytes!("../../static/css/today.css");
static CSS_HOME: &[u8] = include_bytes!("../../static/css/home.css");
static CSS_HOMEOPS: &[u8] = include_bytes!("../../static/css/homeops.css");
static CSS_REALESTATE: &[u8] = include_bytes!("../../static/css/realestate.css");
static CSS_COMMERCIAL: &[u8] = include_bytes!("../../static/css/commercial.css");
static CSS_MARKETS: &[u8] = include_bytes!("../../static/css/markets.css");
static CSS_SURF: &[u8] = include_bytes!("../../static/css/surf.css");
static CSS_SHOP: &[u8] = include_bytes!("../../static/css/shop.css");
static CSS_MONEY: &[u8] = include_bytes!("../../static/css/money.css");
static CSS_WORK: &[u8] = include_bytes!("../../static/css/work.css");
static CSS_PAD: &[u8] = include_bytes!("../../static/css/pad.css");
static CSS_WORLD: &[u8] = include_bytes!("../../static/css/world.css");
static PAGE_REALESTATE_JS: &[u8] = include_bytes!("../../static/pages/realestate.js");
static PAGE_COMMERCIAL_JS: &[u8] = include_bytes!("../../static/pages/commercial.js");
static PAGE_MARKETS_JS: &[u8] = include_bytes!("../../static/pages/markets.js");
static PAGE_SURF_JS: &[u8] = include_bytes!("../../static/pages/surf.js");
static PAGE_SHOP_JS: &[u8] = include_bytes!("../../static/pages/shop.js");
static PAGE_WORLD_JS: &[u8] = include_bytes!("../../static/pages/world.js");
static FONT_GEIST: &[u8] = include_bytes!("../../static/fonts/Geist-Variable.woff2");
static FONT_GEIST_MONO: &[u8] = include_bytes!("../../static/fonts/GeistMono-Variable.woff2");

/// A public static file (served before auth): its embedded bytes and type. One entry per line, so a lane that adds a
/// file adds one line. `/sw.js` answers the stamped worker (`SW_SERVED`), never the template with its token.
fn public_asset(path: &str) -> Option<(&'static [u8], &'static str)> {
    match path {
        "/manifest.webmanifest" => Some((MANIFEST, "application/manifest+json")),
        "/icon.svg" => Some((ICON_SVG, "image/svg+xml")),
        "/sw.js" => Some((SW_SERVED.as_slice(), "text/javascript")),
        "/ui-core.js" => Some((UI_CORE_JS, "text/javascript")),
        "/guard.js" => Some((GUARD_JS, "text/javascript")),
        "/app.js" => Some((APP_JS, "text/javascript")),
        "/deck.js" => Some((DECK_JS, "text/javascript")),
        "/cre.js" => Some((CRE_JS, "text/javascript")),
        "/cre-boot.js" => Some((CRE_BOOT_JS, "text/javascript")),
        "/schedules.js" => Some((SCHEDULES_JS, "text/javascript")),
        "/agents.js" => Some((AGENTS_JS, "text/javascript")),
        "/invest.js" => Some((INVEST_JS, "text/javascript")),
        "/ops.js" => Some((OPS_JS, "text/javascript")),
        "/house.js" => Some((HOUSE_JS, "text/javascript")),
        "/pad.js" => Some((PAD_JS, "text/javascript")),
        "/tokens.css" => Some((TOKENS_CSS, "text/css")),
        "/ui.css" => Some((UI_CSS, "text/css")),
        "/app.css" => Some((APP_CSS, "text/css")),
        "/tv.css" => Some((TV_CSS, "text/css")),
        "/tv.js" => Some((TV_JS, "text/javascript")),
        "/css/today.css" => Some((CSS_TODAY, "text/css")),
        "/css/home.css" => Some((CSS_HOME, "text/css")),
        "/css/homeops.css" => Some((CSS_HOMEOPS, "text/css")),
        "/css/realestate.css" => Some((CSS_REALESTATE, "text/css")),
        "/css/commercial.css" => Some((CSS_COMMERCIAL, "text/css")),
        "/css/markets.css" => Some((CSS_MARKETS, "text/css")),
        "/css/surf.css" => Some((CSS_SURF, "text/css")),
        "/css/shop.css" => Some((CSS_SHOP, "text/css")),
        "/css/money.css" => Some((CSS_MONEY, "text/css")),
        "/css/work.css" => Some((CSS_WORK, "text/css")),
        "/css/pad.css" => Some((CSS_PAD, "text/css")),
        "/css/world.css" => Some((CSS_WORLD, "text/css")),
        "/pages/realestate.js" => Some((PAGE_REALESTATE_JS, "text/javascript")),
        "/pages/commercial.js" => Some((PAGE_COMMERCIAL_JS, "text/javascript")),
        "/pages/markets.js" => Some((PAGE_MARKETS_JS, "text/javascript")),
        "/pages/surf.js" => Some((PAGE_SURF_JS, "text/javascript")),
        "/pages/shop.js" => Some((PAGE_SHOP_JS, "text/javascript")),
        "/pages/world.js" => Some((PAGE_WORLD_JS, "text/javascript")),
        "/fonts/Geist-Variable.woff2" => Some((FONT_GEIST, "font/woff2")),
        "/fonts/GeistMono-Variable.woff2" => Some((FONT_GEIST_MONO, "font/woff2")),
        "/hls.min.js" => Some((HLS_JS, "text/javascript")),
        "/icon-192.png" => Some((ICON_192, "image/png")),
        // browsers ask for /favicon.ico on their own; the PNG icon answers it (they read the type, not the name)
        "/favicon.ico" => Some((ICON_192, "image/png")),
        "/icon-512.png" => Some((ICON_512, "image/png")),
        "/apple-touch-icon.png" | "/apple-touch-icon-precomposed.png" => {
            Some((APPLE_ICON, "image/png"))
        }
        _ => None,
    }
}

/// The embedded bytes a `SHELL` entry of sw.js caches: `/` is what the page answer can be (index.html, or the deal desk's cre.html for a
/// desk viewer), so a change to either moves the cache name; the rest are public files. The worker is never its own entry (its bytes are
/// hashed first anyway).
fn shell_file(path: &str) -> Option<std::borrow::Cow<'static, [u8]>> {
    match path {
        "/" => Some(std::borrow::Cow::Owned([INDEX, CRE_HTML].concat())),
        "/sw.js" => None,
        p => public_asset(p).map(|(b, _)| std::borrow::Cow::Borrowed(b)),
    }
}

/// sw.js with its cache name stamped from the bytes it caches (`shell::build`), made once; a static, so its pointer
/// is stable (`compress::static_file` keys its ETag and gzip copy by it).
static SW_SERVED: std::sync::LazyLock<Vec<u8>> = std::sync::LazyLock::new(|| {
    let s = shell::build(SW_JS, &shell_file);
    for p in &s.problems {
        log("error", "shell stamp", &[("problem", p.clone())]);
    }
    s.body
});

const GATEWAY_HEALTH: &str = "http://127.0.0.1:8642/health";

struct App {
    token: String,
    /// Optional guest principal (`~/.config/pixel-deck/token-guest`); None = no guest exists.
    guest: Option<String>,
    guest_audit: guest::Audit,
    /// Optional deal desk viewers (`~/.config/pixel-deck/token-cre-<person>`): (index into `cre::VIEWERS`, token).
    viewers: Vec<(u8, String)>,
    camkey: String,
    base: PathBuf,
    home: PathBuf,
    hosts: hosts::Hosts,
    ha: ha::Ha,
    http: reqwest::Client,
    fleet: Swr,
    today: Mutex<Option<(Instant, Value)>>,
    src: sources::Cache,
    traffic: traffic::Cache,
    launcher: launch::Launcher,
    apps: apps::Apps,
    runs: runs::Runs,
    crons: Mutex<Option<(Instant, Value)>>,
    board: Swr,
    amazon: Swr,
    widgets: Mutex<Option<(Instant, Value)>>,
    actions: actions::Actions,
    binds: keybinds::Cache,
    housing: housing::Cache,
    ecom_market: ecom_market::Cache,
    listings: listings::Cache,
    client_errors: clienterr::ClientErrors,
}

struct HousingQuery<'a> {
    params: &'a std::collections::HashMap<String, String>,
    raw: Option<&'a str>,
}

type St = State<Arc<App>>;

fn resp(code: u16, body: impl Into<Body>, ctype: &str, extra: &[(&str, String)]) -> Response {
    let mut b = Response::builder()
        .status(StatusCode::from_u16(code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR))
        .header(header::CONTENT_TYPE, ctype)
        .header(header::CACHE_CONTROL, "no-store");
    for (k, v) in extra {
        b = b.header(*k, v.as_str());
    }
    b.body(body.into())
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn json_resp(code: u16, v: &Value) -> Response {
    resp(code, v.to_string(), "application/json", &[])
}

fn cookie_token(h: &HeaderMap) -> Option<String> {
    let ck = h.get(header::COOKIE)?.to_str().ok()?;
    ck.split(';').find_map(|p| {
        let v = p.trim().strip_prefix("pdeck=")?;
        (!v.is_empty()
            && v.bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-'))
        .then(|| v.to_string())
    })
}

/// The principal a presented token names: the owner, the guest or a desk viewer (when configured), or nobody.
fn principal(app: &App, given: &str) -> Option<guest::Role> {
    if hosts::token_ok(given, &app.token) {
        return Some(guest::Role::Owner);
    }
    if let Some(g) = &app.guest {
        if hosts::token_ok(given, g) {
            return Some(guest::Role::Guest);
        }
    }
    app.viewers.iter().find(|(_, t)| hosts::token_ok(given, t)).map(|(i, _)| guest::Role::Viewer(*i))
}

/// Returns (principal, via_url). Cookie first, then `?t=`.
fn authed(
    app: &App,
    h: &HeaderMap,
    qs: &std::collections::HashMap<String, String>,
) -> (Option<guest::Role>, bool) {
    if let Some(c) = cookie_token(h) {
        if let Some(r) = principal(app, &c) {
            return (Some(r), false);
        }
    }
    match qs.get("t") {
        Some(t) if !t.is_empty() => (principal(app, t), true),
        _ => (None, false),
    }
}

async fn cached<F, Fut>(slot: &Mutex<Option<(Instant, Value)>>, secs: u64, f: F) -> Value
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Value>,
{
    let mut g = slot.lock().await;
    if let Some((t, v)) = g.as_ref() {
        if t.elapsed().as_secs() < secs {
            return v.clone();
        }
    }
    let v = f().await;
    *g = Some((Instant::now(), v.clone()));
    v
}

/// A cache slot for a slow read, plus whether a background refresh is already running.
#[derive(Default)]
struct Swr {
    slot: Mutex<Option<(Instant, Value)>>,
    busy: std::sync::atomic::AtomicBool,
}

/// Stale-while-revalidate for the slow reads (fleet facts run scripts and probe hosts for several seconds): a value
/// younger than `secs` answers at once; an older one also answers at once while ONE background task refreshes it.
/// Only the first read after a start waits. The value keeps its own `t`, so the page still says how old it is.
async fn swr<F, Fut>(app: &Arc<App>, pick: fn(&App) -> &Swr, secs: u64, f: F) -> Value
where
    F: FnOnce(Arc<App>) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = Value> + Send + 'static,
{
    use std::sync::atomic::Ordering;
    /// Clears `busy` however the refresh ends, a panic included, so a failed refresh never freezes the cache.
    struct Idle(Arc<App>, fn(&App) -> &Swr);
    impl Drop for Idle {
        fn drop(&mut self) {
            (self.1)(&self.0).busy.store(false, Ordering::Release);
        }
    }
    let s = pick(app);
    let old = s.slot.lock().await.clone();
    if let Some((t, v)) = old {
        if t.elapsed().as_secs() >= secs && !s.busy.swap(true, Ordering::AcqRel) {
            let a = app.clone();
            tokio::spawn(async move {
                let _idle = Idle(a.clone(), pick);
                let v = f(a.clone()).await;
                *pick(&a).slot.lock().await = Some((stamp(&v, secs), v));
            });
        }
        return v;
    }
    let v = f(app.clone()).await;
    *s.slot.lock().await = Some((stamp(&v, secs), v.clone()));
    v
}

/// When a cached value counts from: now, or for an error answer already `secs` ago, so the next read starts a refresh
/// instead of serving the error for a whole cache period.
fn stamp(v: &Value, secs: u64) -> Instant {
    let now = Instant::now();
    if v.get("error").is_some_and(|e| !e.is_null()) {
        now.checked_sub(Duration::from_secs(secs)).unwrap_or(now)
    } else {
        now
    }
}

/// Gate shared by every route that can carry an amount (v9 Money, Invest): GET only, cookie only (never `?t=`),
/// same-origin only. Returns the refusal, or None when the request may be answered.
fn amount_gate(app: &App, method: &Method, via_url: bool, h: &HeaderMap) -> Option<Response> {
    if method != Method::GET {
        return Some(resp(405, r#"{"error":"GET only"}"#, "application/json", &[]));
    }
    let cookie_ok = !via_url
        && cookie_token(h)
            .map(|c| hosts::token_ok(&c, &app.token))
            .unwrap_or(false);
    if !cookie_ok {
        return Some(resp(401, "unauthorized", "text/plain", &[]));
    }
    let site = h.get("sec-fetch-site").and_then(|v| v.to_str().ok());
    if !matches!(site, None | Some("same-origin") | Some("none")) {
        return Some(resp(403, "forbidden", "text/plain", &[]));
    }
    None
}

/// The answer of a route that carries amounts: JSON, plus the private marker that keeps any fingerprint of it (an ETag)
/// off the wire. `compress::revalidate_layer` honours the marker and strips it, so it never leaves the server. Every
/// `amount_gate` caller answers through this (test `every_amount_route_marks_its_answer`).
fn amount_json(code: u16, v: &Value) -> Response {
    resp(code, v.to_string(), "application/json", &[(compress::AMOUNT, "1".into())])
}

/// v9 Money tab. `/api/finance` is the sanitised view (no amounts); `/api/finance-values` carries the amounts and is
/// only requested after an explicit tap. Both: GET only, cookie only (never `?t=`), same-origin only, `no-store`,
/// read from the file on every call, never logged.
async fn finance_route(app: &App, a: &str, method: &Method, via_url: bool, h: &HeaderMap) -> Response {
    if let Some(refusal) = amount_gate(app, method, via_url, h) {
        return refusal;
    }
    let (public, values) = finance::load(&app.home).await;
    amount_json(200, if a == "finance" { &public } else { &values })
}

/// Commerce tab: `/api/commerce` carries Amazon order amounts, so it sits behind the same gate as the Money routes
/// (GET only, owner cookie only, never `?t=`, same-origin only). The page masks the amounts until a Reveal tap.
async fn commerce_route(app: &App, method: &Method, via_url: bool, h: &HeaderMap) -> Response {
    if let Some(refusal) = amount_gate(app, method, via_url, h) {
        return refusal;
    }
    amount_json(200, &commerce::get(&app.home).await)
}

/// Invest tab amounts: `/api/portfolio` (generic feed) carries prices and percents only; quantities, values, dollar
/// changes and cash are in `portfolio-values.json`, served here after a Reveal tap, under the same gate as the
/// finance values. Read from the file on every call, never cached in memory, never logged.
async fn portfolio_values_route(app: &App, method: &Method, via_url: bool, h: &HeaderMap) -> Response {
    if let Some(refusal) = amount_gate(app, method, via_url, h) {
        return refusal;
    }
    let v = match sources::read(&app.home.join(sources::PORTFOLIO_VALUES.rel)).await {
        Ok((body, mtime)) => sources::deck_feed_from(&sources::PORTFOLIO_VALUES, &body, mtime, util::now_epoch()),
        Err(e) => sources::fail(&sources::PORTFOLIO_VALUES, e),
    };
    amount_json(200, &v)
}

/// Life > Jobs saved jobs: owner cookie only (never `?t=`, never a guest: the guest allowlist does not name it),
/// same-origin only. GET `?person=tanner|casey` reads that list; POST a JSON change (person, key, title, company,
/// url, state) saves, moves or removes one posting.
async fn saved_jobs_route(app: &App, method: &Method, via_url: bool, h: &HeaderMap, person: Option<&str>, body: Body) -> Response {
    let post = *method == Method::POST;
    if !post && *method != Method::GET {
        return json_resp(405, &json!({"error": "GET or POST"}));
    }
    let owner = !via_url && cookie_token(h).is_some_and(|c| hosts::token_ok(&c, &app.token));
    if !owner {
        return resp(401, "unauthorized", "text/plain", &[]);
    }
    let site = h.get("sec-fetch-site").and_then(|v| v.to_str().ok());
    if !matches!(site, None | Some("same-origin") | Some("none")) {
        return resp(403, "forbidden", "text/plain", &[]);
    }
    let bytes = if post {
        let json_ct = h.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|v| v.split(';').next() == Some("application/json"));
        if !json_ct {
            return json_resp(400, &json!({"ok": false, "error": "bad json"}));
        }
        let Ok(b) = axum::body::to_bytes(body, savedjobs::MAX_BODY).await else {
            return json_resp(413, &json!({"ok": false, "error": "too large"}));
        };
        Some(b)
    } else {
        None
    };
    let (code, v) = savedjobs::route(&app.home, post, person, bytes).await;
    json_resp(code, &v)
}

/// Markets > Commercial deal desk. The owner cookie reads any desk (`?person=`); a viewer cookie reads and edits only its
/// own. Never `?t=` for a write, same-origin only, like saved jobs and housing.
async fn cre_route(app: &App, method: &Method, via_url: bool, h: &HeaderMap, role: Option<guest::Role>, person: Option<&str>, body: Body) -> Response {
    let post = *method == Method::POST;
    if !post && *method != Method::GET {
        return json_resp(405, &json!({"error": "GET or POST"}));
    }
    let cookie_role = cookie_token(h).and_then(|c| principal(app, &c));
    let (who, viewer) = match (cookie_role, role) {
        (Some(guest::Role::Owner), _) => (person.unwrap_or("tanner"), false),
        (Some(r @ guest::Role::Viewer(_)), _) => (r.viewer_person().unwrap_or(""), true),
        // the `?t=` bootstrap may read a desk (a viewer's first open), never write one
        (None, Some(r @ guest::Role::Viewer(_))) if via_url && !post => (r.viewer_person().unwrap_or(""), true),
        _ => return resp(401, "unauthorized", "text/plain", &[]),
    };
    let site = h.get("sec-fetch-site").and_then(|v| v.to_str().ok());
    if !matches!(site, None | Some("same-origin") | Some("none")) {
        return resp(403, "forbidden", "text/plain", &[]);
    }
    let bytes = if post {
        let json_ct = h.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|v| v.split(';').next() == Some("application/json"));
        if !json_ct {
            return json_resp(400, &json!({"ok": false, "error": "bad json"}));
        }
        match axum::body::to_bytes(body, cre::MAX_BODY).await {
            Ok(b) => Some(b),
            Err(_) => return json_resp(413, &json!({"ok": false, "error": "too large"})),
        }
    } else {
        None
    };
    let (code, v) = cre::route(&app.home, post, who, viewer, bytes).await;
    json_resp(code, &v)
}

/// Markets > Housing and Commercial (owner order 2026-11-11, national v2 2026-11-14). `national`, `rank`, `fields`,
/// `zip/<zip>` and `zip/<zip>/hist` are GET-only reads of the national housing files. `profile` carries the household
/// budget and `zip/<zip>/listings` (POST) starts a rate-limited collector run, so both are gated like saved jobs: owner
/// cookie only (never `?t=`, never a guest; the guest allowlist names no housing route), same-origin only.
async fn housing_route(app: &App, rest: &str, method: &Method, via_url: bool, h: &HeaderMap, query: HousingQuery<'_>, body: Body) -> Response {
    let HousingQuery { params: qs, raw: raw_q } = query;
    let post = *method == Method::POST;
    let owner_gate = || -> Option<Response> {
        let owner = !via_url && cookie_token(h).is_some_and(|c| hosts::token_ok(&c, &app.token));
        if !owner {
            return Some(resp(401, "unauthorized", "text/plain", &[]));
        }
        let site = h.get("sec-fetch-site").and_then(|v| v.to_str().ok());
        if !matches!(site, None | Some("same-origin") | Some("none")) {
            return Some(resp(403, "forbidden", "text/plain", &[]));
        }
        None
    };
    if let Some(z) = rest.strip_prefix("zip/").and_then(|r| r.strip_suffix("/listings")) {
        if !post {
            return json_resp(405, &json!({"error": "POST only"}));
        }
        if let Some(refusal) = owner_gate() {
            return refusal;
        }
        let (code, v) = app.housing.fetch_listings(&app.home, z).await;
        return json_resp(code, &v);
    }
    if rest == "profile" {
        if !post && *method != Method::GET {
            return json_resp(405, &json!({"error": "GET or POST"}));
        }
        if let Some(refusal) = owner_gate() {
            return refusal;
        }
        if !post {
            let (code, v) = housing::profile_get(&app.housing, &app.home).await;
            return amount_json(code, &v);
        }
        let json_ct = h.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|v| v.split(';').next() == Some("application/json"));
        if !json_ct {
            return json_resp(400, &json!({"ok": false, "error": "bad json"}));
        }
        let Ok(b) = axum::body::to_bytes(body, housing::MAX_BODY).await else {
            return json_resp(413, &json!({"ok": false, "error": "too large"}));
        };
        let (code, v) = housing::profile_post(&app.housing, &app.home, &b).await;
        return amount_json(code, &v);
    }
    if *method != Method::GET {
        return json_resp(405, &json!({"error": "GET only"}));
    }
    if rest == "national" {
        let (code, v) = housing::national(&app.housing, &app.home, qs).await;
        return json_resp(code, &v);
    }
    if rest == "fields" {
        let (code, v) = housing::fields(&app.housing, &app.home).await;
        return json_resp(code, &v);
    }
    if rest == "rank" {
        let (code, v) = housing::rank(&app.housing, &app.home, qs, raw_q).await;
        return json_resp(code, &v);
    }
    if let Some(z) = rest.strip_prefix("zip/").and_then(|r| r.strip_suffix("/hist")) {
        let (code, v) = housing::zip_hist(&app.housing, &app.home, z, qs.get("fields").map(String::as_str)).await;
        return json_resp(code, &v);
    }
    if let Some(z) = rest.strip_prefix("zip/") {
        let (code, v) = housing::zip(&app.housing, &app.home, z).await;
        return json_resp(code, &v);
    }
    json_resp(404, &json!({"error": "unknown route"}))
}

/// Paged deal desk rows (`listings.rs`). Read-only; who may read which desk follows `cre_route`: the owner cookie reads
/// any desk, a viewer only its own (the `?t=` bootstrap may read it too), same-origin only.
async fn cre_deals_route(app: &App, method: &Method, via_url: bool, h: &HeaderMap, role: Option<guest::Role>, qs: &std::collections::HashMap<String, String>) -> Response {
    if *method != Method::GET {
        return json_resp(405, &json!({"error": "GET only"}));
    }
    let person = qs.get("person").map(String::as_str);
    let who = match (cookie_token(h).and_then(|c| principal(app, &c)), role) {
        (Some(guest::Role::Owner), _) => person.unwrap_or("tanner"),
        (Some(r @ guest::Role::Viewer(_)), _) => r.viewer_person().unwrap_or(""),
        (None, Some(r @ guest::Role::Viewer(_))) if via_url => r.viewer_person().unwrap_or(""),
        _ => return resp(401, "unauthorized", "text/plain", &[]),
    };
    let site = h.get("sec-fetch-site").and_then(|v| v.to_str().ok());
    if !matches!(site, None | Some("same-origin") | Some("none")) {
        return resp(403, "forbidden", "text/plain", &[]);
    }
    let (code, v) = listings::deals(&app.listings, &app.housing, &app.home, who, qs).await;
    json_resp(code, &v)
}

fn valid_hls_file(f: &str) -> bool {
    let ok_ext = [".m3u8", ".mp4", ".m4s", ".ts"]
        .iter()
        .any(|e| f.ends_with(e));
    ok_ext
        && !f.is_empty()
        && f.len() <= 120
        && !f.starts_with('.')
        && !f.contains("..")
        && f.bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b'.'))
}

/// Keep only the query params MediaMTX HLS needs, each value strictly validated.
fn hls_query(qs: &std::collections::HashMap<String, String>) -> String {
    let mut out = String::new();
    for k in ["session", "_HLS_msn", "_HLS_part", "_HLS_skip"] {
        if let Some(v) = qs.get(k) {
            if !v.is_empty()
                && v.len() <= 64
                && v.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
            {
                out.push_str(&format!("&{k}={v}"));
            }
        }
    }
    out
}

/// Append the camera key to every relative URI in an HLS playlist so segment fetches stay authorized.
fn rewrite_playlist(text: &str, key: &str) -> String {
    let add = |u: &str| -> String {
        let u = u
            .replace("cookieCheck=1&", "")
            .replace("?cookieCheck=1", "");
        format!("{u}{}k={key}", if u.contains('?') { "&" } else { "?" })
    };
    let mut out = String::with_capacity(text.len() + 256);
    for line in text.lines() {
        if line.starts_with('#') {
            if let Some(i) = line.find("URI=\"") {
                let rest = &line[i + 5..];
                if let Some(j) = rest.find('"') {
                    out.push_str(&line[..i + 5]);
                    out.push_str(&add(&rest[..j]));
                    out.push_str(&rest[j..]);
                    out.push('\n');
                    continue;
                }
            }
            out.push_str(line);
        } else if line.is_empty() {
            // keep blank lines
        } else {
            out.push_str(&add(line));
        }
        out.push('\n');
    }
    out
}

async fn cam_proxy(
    app: &App,
    path: &str,
    qs: &std::collections::HashMap<String, String>,
) -> Response {
    let mut it = path.trim_start_matches("/cam/").splitn(2, '/');
    let (name, file) = (it.next().unwrap_or(""), it.next().unwrap_or(""));
    if !ha::MTX_PATHS.contains(&name) || !valid_hls_file(file) {
        return resp(404, "nf", "text/plain", &[]);
    }
    let (code, ct, body) = app.ha.hls(name, file, &hls_query(qs)).await;
    let code = if code == 200 || code == 404 {
        code
    } else {
        502
    };
    if code == 200 && file.ends_with(".m3u8") {
        let text = String::from_utf8_lossy(&body);
        return resp(code, rewrite_playlist(&text, &app.camkey), &ct, &[]);
    }
    resp(code, body, &ct, &[])
}

async fn handle(
    State(app): St,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    ws: Result<
        axum::extract::ws::WebSocketUpgrade,
        axum::extract::ws::rejection::WebSocketUpgradeRejection,
    >,
    body: Body,
) -> Response {
    let path = uri.path();
    let qs = parse_qs(uri.query());
    let post = method == Method::POST;
    if let Some(r) = devstatic::public(path, SW_JS, &shell_file) {
        return r;
    }
    if let Some((b, ct)) = public_asset(path) {
        let extra: Vec<(&str, String)> = if path == "/sw.js" {
            vec![("Service-Worker-Allowed", "/".into())]
        } else {
            vec![]
        };
        return compress::static_file(b, ct, &extra, &headers);
    }
    if path == "/healthz" {
        return resp(200, "ok", "text/plain", &[]);
    }
    let (role, via_url) = authed(&app, &headers, &qs);
    let ok = role.is_some();
    let is_guest = role == Some(guest::Role::Guest);
    // CSRF: cookies are port-agnostic, so a page on another port of this host can send our
    // cookie. Refuse non-GET routes and the `?t=` cookie bootstrap when Origin or
    // Sec-Fetch-Site says the request is not ours. Authentication failures still answer 401.
    if ok {
        let hv = |n: &str| headers.get(n).and_then(|v| v.to_str().ok());
        let unsafe_method = !matches!(method, Method::GET | Method::HEAD);
        if !pad::csrf_ok(
            unsafe_method,
            via_url,
            hv("origin"),
            hv("host"),
            hv("sec-fetch-site"),
        ) {
            log("warn", "csrf refused", &[("path", path.to_string())]);
            return resp(403, "forbidden", "text/plain", &[]);
        }
    }
    // Native HLS players may not send the cookie on segment fetches: /cam/ also accepts the
    // process-lifetime camera key (scoped to /cam/ only, never valid for /api/).
    let cam_key_ok = path.starts_with("/cam/")
        && qs
            .get("k")
            .map(|k| hosts::token_ok(k, &app.camkey))
            .unwrap_or(false);
    if !ok && !cam_key_ok {
        // iOS home-screen apps keep their own cookie jar, so the first open of an installed
        // app has no cookie. Give "/" a token form that posts to the existing `?t=` bootstrap.
        if path == "/" && method == Method::GET {
            return resp(401, devstatic::page("login.html", LOGIN), "text/html; charset=utf-8", &[]);
        }
        return resp(401, "unauthorized", "text/plain", &[]);
    }
    // Guest principal: one allowlist (guest::allowed) decides before any route runs, for every method. A key
    // macro is judged by the keys.json action it names, read here without running it.
    if is_guest {
        let v = qs.get("v").map(String::as_str).unwrap_or("");
        let target = qs.get("target").map(String::as_str).unwrap_or("");
        let key_macro = if post && path == "/api/key" && util::ok_int(v) {
            let keys = hosts::load_keys(&app.base).await;
            v.parse::<usize>().ok().and_then(|i| keys.get(i)).map(|k| {
                let s = |f: &str| k[f].as_str().unwrap_or("").to_string();
                (s("action"), s("arg"))
            })
        } else {
            None
        };
        let km = key_macro.as_ref().map(|(a, g)| (a.as_str(), g.as_str()));
        if !guest::allowed(&method, path, v, target, km) {
            app.guest_audit.denied(&method, path);
            return json_resp(403, &json!({"error": "forbidden"}));
        }
    }
    // Deal desk viewer: one allowlist, before any route runs. The desk page stands in for "/".
    if matches!(role, Some(guest::Role::Viewer(_))) && !guest::viewer_allowed(&method, path) {
        app.guest_audit.denied(&method, path);
        return json_resp(403, &json!({"error": "forbidden"}));
    }
    // The Almanac behind the owner cookie: never the `?t=` bootstrap (a link must not open the history app), never a guest.
    if path == almanac::PREFIX || path.starts_with("/almanac/") {
        let owner_cookie = matches!(cookie_token(&headers).and_then(|c| principal(&app, &c)), Some(guest::Role::Owner));
        if via_url || !owner_cookie {
            return resp(403, "forbidden", "text/plain", &[]);
        }
        return almanac::proxy(&app.http, &almanac::DOORS, &method, path, uri.query(), &headers, body).await;
    }
    // the `?t=` bootstrap stores the token that matched, never another principal's
    let cookie: Vec<(&str, String)> = match (via_url, role) {
        (true, Some(r)) => {
            let t = match r {
                guest::Role::Owner => app.token.as_str(),
                guest::Role::Guest => app.guest.as_deref().unwrap_or(""),
                guest::Role::Viewer(i) => app.viewers.iter().find(|(j, _)| *j == i).map(|(_, t)| t.as_str()).unwrap_or(""),
            };
            vec![(
                "Set-Cookie",
                format!("pdeck={t}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax"),
            )]
        }
        _ => vec![],
    };
    if path == "/" || path == "/cre" {
        // the shell pages carry the report-only policy beside the bootstrap cookie (headers.rs)
        let mut extra = cookie;
        extra.push(headers::page_policy());
        let (name, bytes) = if path == "/" && !matches!(role, Some(guest::Role::Viewer(_))) { ("index.html", INDEX) } else { ("cre.html", CRE_HTML) };
        return resp(200, devstatic::page(name, bytes), "text/html; charset=utf-8", &extra);
    }
    if path == "/theme.css" {
        return resp(
            200,
            hosts::theme_css(&hosts::colors_path(&app.home)).await,
            "text/css",
            &[],
        );
    }
    if path.starts_with("/cam/") {
        return cam_proxy(&app, path, &qs).await;
    }
    if path == "/pad" {
        // cookie auth only (never ?t=) plus same-origin, so a foreign page cannot drive input;
        // a guest cookie drives pc-desktop and Dell only, never the Mac mini
        let target = qs.get("target").cloned().unwrap_or_default();
        let cookie_ok = match cookie_token(&headers).and_then(|c| principal(&app, &c)) {
            Some(guest::Role::Owner) => true,
            Some(guest::Role::Guest) => guest::PAD_TARGETS.contains(&target.as_str()),
            Some(guest::Role::Viewer(_)) => false,
            None => false,
        };
        let hdr = |n: header::HeaderName| headers.get(n).and_then(|v| v.to_str().ok());
        if !cookie_ok || !pad::origin_ok(hdr(header::ORIGIN), hdr(header::HOST)) {
            return resp(403, "forbidden", "text/plain", &[]);
        }
        if !pad::valid_target(&target) {
            return resp(400, "bad target", "text/plain", &[]);
        }
        let Ok(ws) = ws else {
            return resp(426, "websocket required", "text/plain", &[]);
        };
        let uid = util::uid();
        return ws
            .max_message_size(4096)
            .on_upgrade(move |s| padws::session(s, target, uid));
    }
    let Some(a) = path.strip_prefix("/api/") else {
        return resp(404, "nf", "text/plain", &[]);
    };
    // page errors (round "Better" item 1): the owner's own pages report, Home > Fleet reads the count (clienterr.rs)
    if a == "client-error" {
        return match method {
            Method::GET => {
                let (code, v) = clienterr::recent(&app.home, util::now_epoch());
                json_resp(code, &v)
            }
            Method::POST => {
                let Ok(bytes) = axum::body::to_bytes(body, clienterr::MAX_BODY).await else {
                    return json_resp(413, &json!({"ok": false, "error": "too large"}));
                };
                let json_type = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|v| v.split(';').next() == Some("application/json"));
                if !json_type {
                    return json_resp(400, &json!({"ok": false, "error": "bad report", "field": "type"}));
                }
                let ua = headers.get(header::USER_AGENT).and_then(|h| h.to_str().ok()).unwrap_or("");
                let (code, v) = app.client_errors.post(&app.home, &bytes, ua).await;
                json_resp(code, &v)
            }
            _ => json_resp(405, &json!({"ok": false, "error": "GET or POST"})),
        };
    }
    if matches!(a, "cron-act" | "run-send" | "cam-diag") {
        if !post { return json_resp(405, &json!({"ok":false,"error":"POST required"})); }
        let limit = if a == "cam-diag" { 2048 } else { 8192 };
        let Ok(bytes) = axum::body::to_bytes(body, limit).await else {
            return json_resp(413, &json!({"ok":false,"error":"too large"}));
        };
        if a == "run-send" && !headers.get(header::CONTENT_TYPE).and_then(|v|v.to_str().ok()).is_some_and(|v|v.split(';').next()==Some("application/json")) {
            return json_resp(400,&json!({"ok":false,"error":"bad text"}));
        }
        let (code,v) = match a {
            "cron-act" => app.actions.cron(&app.home, qs.get("id").map(String::as_str).unwrap_or(""), qs.get("act").map(String::as_str).unwrap_or(""), &app.crons).await,
            "run-send" => app.actions.send(&app.home, &bytes).await,
            _ => app.actions.cam_diag(&app.home, &bytes, headers.get(header::USER_AGENT).and_then(|h|h.to_str().ok()).unwrap_or("")).await,
        };
        return json_resp(code,&v);
    }
    if a == "cre/deals" {
        return cre_deals_route(&app, &method, via_url, &headers, role, &qs).await;
    }
    if a == "realestate/homes" || a == "realestate/commercial" {
        if method != Method::GET {
            return json_resp(405, &json!({"error": "GET only"}));
        }
        let kind = if a == "realestate/homes" { listings::Kind::Homes } else { listings::Kind::Commercial };
        let (code, v) = listings::listings(&app.listings, &app.housing, &app.home, kind, &qs).await;
        return json_resp(code, &v);
    }
    if a == "cre" {
        return cre_route(&app, &method, via_url, &headers, role, qs.get("person").map(String::as_str), body).await;
    }
    if a == "saved-jobs" {
        return saved_jobs_route(&app, &method, via_url, &headers, qs.get("person").map(String::as_str), body).await;
    }
    if let Some(rest) = a.strip_prefix("housing/") {
        return housing_route(&app, rest, &method, via_url, &headers, HousingQuery { params: &qs, raw: uri.query() }, body).await;
    }
    // Surf, Cabo to the Columbia River (2026-11-14): owner-only reads; the guest allowlist names neither route
    if a == "surf-coast" || a.starts_with("surf-coast/") {
        if method != Method::GET {
            return json_resp(405, &json!({"error": "GET only"}));
        }
        if a == "surf-coast" {
            return json_resp(200, &surf::overview(&app.home).await);
        }
        let Some(id) = a.strip_prefix("surf-coast/region/") else {
            return json_resp(404, &json!({"error": "unknown route"}));
        };
        let (code, v) = surf::region(&app.home, id).await;
        return json_resp(code, &v);
    }
    if a == "unit" {
        if post { return json_resp(405,&json!({"ok":false,"error":"GET only"})); }
        let (code,v)=actions::unit(&app.home,qs.get("name").map(String::as_str).unwrap_or("")).await;
        return json_resp(code,&v);
    }
    if let Some(id8) = a.strip_prefix("crons/") {
        if post { return json_resp(405, &json!({"error":"GET only"})); }
        let (code, v) = crons::detail(&app.home, id8).await;
        return json_resp(code, &v);
    }
    if a == "cam" {
        let e = qs.get("e").map(String::as_str).unwrap_or("");
        if !ha::HA_CAMS.contains(&e) {
            return resp(400, "bad", "text/plain", &[]);
        }
        // HA snapshots take seconds to produce. Tile caching avoids constant fetches,
        // while live fallback never reuses a tile image for five seconds.
        let ttl = if qs.get("live").map(String::as_str) == Some("1") {
            1
        } else {
            5
        };
        let (c, b, ct, age) = app.ha.cam(e, ttl).await;
        return resp(c, b, &ct, &[("X-Snap-Age", age.to_string())]);
    }
    let host = qs.get("host").map(String::as_str).unwrap_or("pc-desktop");
    if !hosts::valid_host(host) {
        return resp(400, r#"{"error":"bad host"}"#, "application/json", &[]);
    }
    let arg = qs.get("v").map(String::as_str).unwrap_or("");
    if a == "finance" || a == "finance-values" {
        return finance_route(&app, a, &method, via_url, &headers).await;
    }
    if a == "commerce" {
        return commerce_route(&app, &method, via_url, &headers).await;
    }
    if a == "portfolio-values" {
        return portfolio_values_route(&app, &method, via_url, &headers).await;
    }
    // Shop > market (2026-11-14): its own module, so the generic 200-row cap never trims it; owner only (guest.rs)
    if a == "ecom-market" && !post {
        return json_resp(200, &app.ecom_market.get(&app.home).await);
    }
    if let (Some(d), false) = (sources::feed_def(a), post) {
        return json_resp(200, &app.src.get(&app.home, d).await);
    }
    let r: Value = match a {
        "media" | "vol" | "ws-now" | "ws-list" | "ping" => app.hosts.call(host, &[a], 10).await,
        "stats" => app.hosts.stats(host).await,
        // wttr.in (behind the Omarchy weather script) can stop answering; the house's own forecast stands in,
        // and Open-Meteo (keyless) when Home Assistant is down too
        "weather" => {
            app.hosts
                .weather(|| async {
                    let place = hosts::weather_place(&app.home).await;
                    match app.ha.weather_line(&place.name).await {
                        Some(t) => Some(t),
                        None => hosts::open_meteo_line(&app.http, hosts::OPEN_METEO, &place).await,
                    }
                })
                .await
        }
        "amazon" if post => return resp(405, r#"{"error":"GET only"}"#, "application/json", &[]),
        "amazon" => {
            // the first read after a start answers with the kept answer (stale) while one refresh runs (SeePerf P11)
            {
                let mut slot = app.amazon.slot.lock().await;
                // stamped one cache period old, so `swr` answers with it and starts the refresh at once
                let old = Instant::now().checked_sub(Duration::from_secs(600));
                if let (true, Some(old)) = (slot.is_none(), old) {
                    if let Some(v) = amazon::last(&app.home).await {
                        *slot = Some((old, v));
                    }
                }
            }
            swr(&app, |a| &a.amazon, 600, |a| async move {
                let v = amazon::get(&a.home).await;
                amazon::remember(&a.home, &v);
                v
            })
            .await
        }
        "fleet" => {
            swr(&app, |a| &a.fleet, 15, |a| async move {
                let facts = fleet_path(&a);
                fleet::build(&facts, &a.http).await
            })
            .await
        }
        "crons" | "fleet-board" | "fleet-widgets" | "run" | "run-last" if post => {
            return resp(405, r#"{"error":"GET only"}"#, "application/json", &[])
        }
        "crons" => cached(&app.crons, 5, || crons::build(&app.home)).await,
        "fleet-board" => swr(&app, |a| &a.board, 10, |a| async move { fleetboard::build(&a.home, &a.http).await }).await,
        "fleet-widgets" => {
            cached(&app.widgets, 10, || fleetwidgets::build(&app.home)).await
        }
        "run" => {
            let (code, v) = app
                .runs
                .status(&app.home, qs.get("id").map(String::as_str).unwrap_or(""))
                .await;
            return json_resp(code, &v);
        }
        "run-last" => {
            let (code, v) = app.runs.last(&app.home).await;
            return json_resp(code, &v);
        }
        "today" => {
            // item 7: the glance's three cuts ride in the cached answer, so Today never downloads the three whole feeds
            cached(&app.today, 15, || async {
                let mut v = today::build(&app.home, &app.http, &app.ha, GATEWAY_HEALTH).await;
                let surf = surf::overview(&app.home).await;
                let shop = app.ecom_market.get(&app.home).await;
                let re = app.src.get(&app.home, &sources::REALESTATE).await;
                todayslices::attach(&mut v, &surf, &shop, &re);
                v
            })
            .await
        }
        "nodes" => app.src.get(&app.home, &sources::LOCAL_AI).await,
        // Home ops, models by machine (2026-11-15, from the owner sweep): read-only, never a swap (modeldeck.rs)
        "models" if !post => modeldeck::inventory(&app.http).await,
        "health" => app.src.get(&app.home, &sources::HEALTH).await,
        "car" => app.src.get(&app.home, &sources::CAR).await,
        "disks" => app.src.get(&app.home, &sources::DISKS).await,
        "sites" => app.src.get(&app.home, &sources::SITES).await,
        "traffic" => app.traffic.get(&app.home).await,
        "mcp" => app.src.get(&app.home, &sources::MCP).await,
        "cams" => app.ha.mtx_status().await,
        "camkey" => json!({"k": app.camkey}),
        "keys" if is_guest => {
            // only the macros a guest may fire, each with its index in the full list (`POST /api/key?v=<i>`);
            // house scripts (`ha-script`) are owner-only, so a guest never sees or fires one
            let keys = hosts::load_keys(&app.base).await;
            let mine: Vec<Value> = keys
                .into_iter()
                .enumerate()
                .filter(|(_, k)| {
                    guest::action_ok(k["action"].as_str().unwrap_or(""), k["arg"].as_str().unwrap_or(""))
                })
                .map(|(i, mut k)| {
                    k["i"] = json!(i);
                    k
                })
                .collect();
            json!({"keys": mine, "groups": hosts::load_groups(&app.base).await})
        }
        "keys" => json!({"keys": hosts::load_keys(&app.base).await, "groups": hosts::load_groups(&app.base).await}),
        "ha" if post => {
            let q = |k: &str| qs.get(k).map(String::as_str).unwrap_or("");
            let (code, v) = app.ha.house_act(&app.home, q("act"), q("e"), q("v")).await;
            return json_resp(code, &v);
        }
        "ha" if qs.get("view").map(String::as_str) == Some("house") => app.ha.house_summary().await,
        "ha" => app.ha.states().await,
        // Home > Launch, Apps (2026-11-15, from the owner sweep): the PC catalog with its probes (apps.rs)
        "apps" if !post => app.apps.get().await,
        "hosts" => json!({"hosts": hosts::HOSTS}),
        "pad-targets" if is_guest => json!({"targets": guest::PAD_TARGETS}),
        "pad-targets" => json!({"targets": pad::TARGETS}),
        "whoami" if !post => match role.and_then(guest::Role::viewer_person) {
            Some(p) => json!({"role": "viewer", "person": p}),
            None => json!({"role": role.map(guest::Role::name).unwrap_or("none")}),
        },
        "pad-binds" if post => {
            return resp(405, r#"{"error":"GET only"}"#, "application/json", &[])
        }
        "pad-binds" => {
            let target = qs.get("target").map(String::as_str).unwrap_or("");
            if !pad::valid_target(target) {
                return resp(400, r#"{"error":"bad target"}"#, "application/json", &[]);
            }
            return json_resp(200, &app.binds.get(target).await);
        }
        _ if !post => return resp(405, r#"{"error":"POST required"}"#, "application/json", &[]),
        // Wake one app that sleeps until used: owner cookie only, never `?t=` (apps.rs holds the allowlist and the rate)
        "apps/wake" if via_url => return json_resp(403, &json!({"ok": false, "error": "forbidden"})),
        "apps/wake" => {
            let (code, v) = app.apps.wake(&app.home, qs.get("id").map(String::as_str).unwrap_or("")).await;
            return json_resp(code, &v);
        }
        "launch-item" => {
            let id = qs.get("id").map(String::as_str).unwrap_or("");
            let target = qs.get("target").map(String::as_str).unwrap_or("");
            let (code, v) = app.launcher.launch(&app.home, id, target).await;
            return json_resp(code, &v);
        }
        "media-act" if hosts::media_ok(arg) => app.hosts.call(host, &[a, arg], 10).await,
        "vol-set" if hosts::vol_ok(arg) => app.hosts.call(host, &[a, arg], 10).await,
        "mute" | "screenshot" | "lock" => app.hosts.call(host, &[a], 10).await,
        "ws" | "mvws" if hosts::ws_ok(arg) => app.hosts.call(host, &[a, arg], 10).await,
        "launch" if hosts::LAUNCH.contains(&arg) => app.hosts.call(host, &[a, arg], 10).await,
        "ha-media" if arg == "play-pause" => app.ha.play_pause().await,
        "key" if util::ok_int(arg) => {
            let keys = hosts::load_keys(&app.base).await;
            match arg.parse::<usize>().ok().and_then(|i| keys.get(i)) {
                Some(k) => {
                    let act = k["action"].as_str().unwrap_or("");
                    let ka = k["arg"].as_str().unwrap_or("");
                    if act == "ha-script" {
                        // the script id comes from keys.json and is checked again against ha::HA_SCRIPTS
                        let (code, v) = app.ha.house(&app.home, ka).await;
                        return json_resp(code, &v);
                    } else if act == "ha-media" {
                        app.ha.play_pause().await
                    } else if ka.is_empty() {
                        app.hosts.call(host, &[act], 10).await
                    } else {
                        app.hosts.call(host, &[act, ka], 10).await
                    }
                }
                None => return resp(400, r#"{"error":"not allowed"}"#, "application/json", &[]),
            }
        }
        _ => return resp(400, r#"{"error":"not allowed"}"#, "application/json", &[]),
    };
    json_resp(200, &r)
}

fn fleet_path(app: &App) -> String {
    app.home
        .join("ops/bin/fleet-facts")
        .to_string_lossy()
        .into_owned()
}

fn read_token(home: &std::path::Path) -> Result<String, String> {
    let t = std::fs::read_to_string(home.join(".config/pixel-deck/token"))
        .map_err(|e| format!("token unreadable: {}", e.kind()))?;
    let t = t.trim().to_string();
    if t.is_empty() {
        return Err("token empty".into());
    }
    Ok(t)
}

/// DNS-rebinding guard. The Host header must name this deck: 127.0.0.1, localhost, ::1, a bind address, or a name in
/// PIXEL_DECK_ALLOWED_HOSTS (comma list read at startup), matched on hostname (any port), the same rule as server.py.
/// Every client today sends Host 127.0.0.1:8796: the dev-https Caddy front for :10443 (tailnet browsers, the Pixel web
/// app and the Omarchy Deck iOS app) rewrites Host and Origin, and ha-apps, Gatus, deck.desktop and the Hermes plugin
/// dial loopback. A page on a hostile name that rebinds to 127.0.0.1 (Host: evil.example) gets 403 on every route,
/// /healthz and the static files included.
#[derive(Clone)]
struct HostGuard(Arc<[String]>);

impl HostGuard {
    fn new(binds: &str, extra: &str) -> Self {
        let mut names: Vec<String> = Vec::new();
        for n in ["127.0.0.1", "localhost", "::1"].into_iter().chain(binds.split(',')).chain(extra.split(',')) {
            let n = n.trim().trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
            if !n.is_empty() && !names.contains(&n) {
                names.push(n);
            }
        }
        Self(names.into())
    }

    /// `host` is a Host header value: `name`, `name:port`, `[v6]` or `[v6]:port`. Anything else is refused.
    fn allows(&self, host: &str) -> bool {
        let port_ok = |p: &str| !p.is_empty() && p.len() <= 5 && p.bytes().all(|c| c.is_ascii_digit());
        let name = match host.strip_prefix('[') {
            Some(r) => match r.split_once(']') {
                Some((n, "")) => n,
                Some((n, p)) if p.strip_prefix(':').is_some_and(port_ok) => n,
                _ => return false,
            },
            None => match host.split_once(':') {
                None => host,
                Some((n, p)) if port_ok(p) => n,
                _ => return false,
            },
        };
        !name.is_empty() && self.0.iter().any(|a| a.eq_ignore_ascii_case(name))
    }
}

/// Outermost layer: refuses a foreign or missing (or repeated) Host, then any state-changing request whose Origin is
/// not this Host or that the browser marks `Sec-Fetch-Site: cross-site`, before auth runs. Requests without Origin
/// (curl, the Hermes plugin, native clients) pass on to the route's own auth and CSRF checks.
async fn host_guard(State(g): State<HostGuard>, req: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let refusal = {
        let h = req.headers();
        let mut all = h.get_all(header::HOST).iter();
        let host = match (all.next(), all.next()) {
            (Some(v), None) => v.to_str().ok().filter(|x| g.allows(x)),
            _ => None,
        };
        match host {
            // the Host value is attacker-chosen: never logged
            None => Some("host refused"),
            Some(host) => {
                let hv = |n: &str| h.get(n).and_then(|v| v.to_str().ok());
                let unsafe_method = !matches!(*req.method(), Method::GET | Method::HEAD);
                (!pad::csrf_ok(unsafe_method, false, hv("origin"), Some(host), hv("sec-fetch-site"))).then_some("csrf refused")
            }
        }
    };
    if let Some(msg) = refusal {
        log("warn", msg, &[("path", req.uri().path().to_string())]);
        return resp(403, "forbidden", "text/plain", &[]);
    }
    next.run(req).await
}

fn router(app: Arc<App>, guard: HostGuard) -> Router {
    Router::new()
        .fallback(handle)
        .with_state(app)
        .layer(axum::middleware::from_fn(compress::revalidate_layer))
        .layer(axum::middleware::from_fn(compress::gzip_layer))
        .layer(axum::middleware::from_fn_with_state(guard, host_guard))
        .layer(axum::middleware::from_fn(headers::layer))
}

async fn serve(addr: String, port: u16, app: Arc<App>, guard: HostGuard, retry: bool) {
    let router = router(app, guard);
    loop {
        match tokio::net::TcpListener::bind((addr.as_str(), port)).await {
            Ok(l) => {
                log("info", "listening", &[("addr", format!("{addr}:{port}"))]);
                if let Err(e) = axum::serve(l, router.clone()).await {
                    log("error", "serve ended", &[("err", e.to_string())]);
                }
            }
            Err(e) => log(
                "warn",
                "bind failed",
                &[("addr", addr.clone()), ("err", e.to_string())],
            ),
        }
        if !retry {
            return;
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

#[tokio::main]
async fn main() {
    let home = PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/home/alice".into()));
    let token = match read_token(&home) {
        Ok(t) => t,
        Err(e) => {
            log("fatal", &e, &[]);
            std::process::exit(1);
        }
    };
    // optional guest principal; absent or empty file = no guest, and the deck behaves exactly as before
    let guest = guest::read_token(&home, &token);
    if guest.is_some() {
        log("info", "guest principal enabled", &[]);
    }
    let viewers = guest::read_viewer_tokens(&home, &token, guest.as_deref());
    for (i, _) in &viewers {
        log("info", "deal desk viewer enabled", &[("person", cre::VIEWERS[*i as usize].to_string())]);
    }
    let http = match reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .pool_max_idle_per_host(4)
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log("fatal", "http client", &[("err", e.to_string())]);
            std::process::exit(1);
        }
    };
    let base = std::env::var("PIXEL_DECK_BASE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home.join("projects/meshvault/pixel-deck"));
    let camkey = match Some(()).and_then(|_| {
        use std::io::Read;
        let mut b = [0u8; 18];
        std::fs::File::open("/dev/urandom")
            .ok()?
            .read_exact(&mut b)
            .ok()?;
        Some(b.iter().map(|x| format!("{x:02x}")).collect::<String>())
    }) {
        Some(k) => k,
        None => {
            log("fatal", "no entropy for camera key", &[]);
            std::process::exit(1);
        }
    };
    let app = Arc::new(App {
        token,
        guest,
        guest_audit: guest::Audit::new(),
        viewers,
        camkey,
        base,
        hosts: hosts::Hosts::new(util::uid()),
        ha: ha::Ha::load(&home, http.clone()),
        home,
        http,
        fleet: Swr::default(),
        today: Mutex::new(None),
        src: sources::Cache::default(),
        traffic: traffic::Cache::default(),
        launcher: launch::Launcher::default(),
        apps: apps::Apps::default(),
        runs: runs::Runs::default(),
        crons: Mutex::new(None),
        board: Swr::default(),
        amazon: Swr::default(),
        widgets: Mutex::new(None),
        actions: actions::Actions::default(),
        binds: keybinds::Cache::new(),
        housing: housing::Cache::default(),
        ecom_market: ecom_market::Cache::default(),
        listings: listings::Cache::default(),
        client_errors: clienterr::ClientErrors::default(),
    });
    let port: u16 = std::env::var("PIXEL_DECK_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8796);
    let binds =
        std::env::var("PIXEL_DECK_BINDS").unwrap_or_else(|_| "127.0.0.1".into());
    let guard = HostGuard::new(&binds, &std::env::var("PIXEL_DECK_ALLOWED_HOSTS").unwrap_or_default());
    log("info", "host allowlist", &[("hosts", guard.0.join(","))]);
    if let Some(d) = devstatic::dir() {
        log("info", "dev static dir active", &[("dir", d.display().to_string())]);
    }
    let mut tasks = vec![];
    for b in binds.split(',').map(str::trim).filter(|b| !b.is_empty()) {
        // the tailnet address may not exist yet at boot: keep retrying instead of exiting
        tasks.push(tokio::spawn(serve(
            b.to_string(),
            port,
            app.clone(),
            guard.clone(),
            b != "127.0.0.1",
        )));
    }
    log(
        "info",
        "pixel-deck started",
        &[("version", env!("CARGO_PKG_VERSION").into())],
    );
    tokio::select! {
        _ = shutdown_signal() => {
            log("info", "shutdown requested", &[]);
            // let live pad sessions release held keys and reap their agents before we exit
            let clean = padws::registry().shutdown(Duration::from_secs(5)).await;
            log("info", "pad sessions closed", &[("clean", clean.to_string())]);
        }
        _ = async { for t in tasks { let _ = t.await; } } => {}
    }
}

/// Resolves on Ctrl-C or SIGTERM (what `systemctl stop` sends).
async fn shutdown_signal() {
    use tokio::signal::unix::{signal, SignalKind};
    let mut term = signal(SignalKind::terminate()).ok();
    let term_fut = async {
        match term.as_mut() {
            Some(t) => {
                t.recv().await;
            }
            None => std::future::pending::<()>().await,
        }
    };
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = term_fut => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hls_file_allowlist() {
        assert!(valid_hls_file("index.m3u8") && valid_hls_file("45e3_video1_init.mp4"));
        assert!(
            !valid_hls_file("../x.m3u8")
                && !valid_hls_file("a/b.mp4")
                && !valid_hls_file("x.sh")
                && !valid_hls_file(".m3u8")
        );
    }

    #[test]
    fn hls_query_filters() {
        let q = parse_qs(Some(
            "session=ab-12&evil=1&_HLS_msn=5&session2=x&_HLS_part=%3Bx",
        ));
        assert_eq!(hls_query(&q), "&session=ab-12&_HLS_msn=5");
    }

    #[test]
    fn playlist_rewrite_adds_key() {
        let p = "#EXTM3U\n#EXT-X-MEDIA:URI=\"audio2_stream.m3u8?session=x\",A=1\nvideo1_stream.m3u8?session=x\n#EXT-X-MAP:URI=\"i.mp4?cookieCheck=1&session=x\"\nseg.mp4\n";
        let o = rewrite_playlist(p, "KEY");
        assert!(o.contains("URI=\"audio2_stream.m3u8?session=x&k=KEY\",A=1"));
        assert!(o.contains("\nvideo1_stream.m3u8?session=x&k=KEY\n"));
        assert!(o.contains("URI=\"i.mp4?session=x&k=KEY\""));
        assert!(o.contains("\nseg.mp4?k=KEY\n"));
    }

    #[test]
    fn cookie_parse() {
        let mut h = HeaderMap::new();
        h.insert(
            header::COOKIE,
            "a=1; pdeck=abc_-9"
                .parse()
                .unwrap_or_else(|_| header::HeaderValue::from_static("")),
        );
        assert_eq!(cookie_token(&h).as_deref(), Some("abc_-9"));
        assert_eq!(cookie_token(&HeaderMap::new()), None);
    }

    // ---- HTTP-level CSRF tests against a real listener on an ephemeral port ----

    async fn spawn_app() -> Option<(String, String)> {
        let home = std::env::temp_dir().join(format!("pdeck-csrf-{}", std::process::id()));
        spawn_app_home(home).await
    }

    async fn spawn_app_home(home: PathBuf) -> Option<(String, String)> {
        spawn_app_guest(home, None).await
    }

    async fn spawn_app_guest(home: PathBuf, guest: Option<&str>) -> Option<(String, String)> {
        let _ = std::fs::create_dir_all(&home);
        let http = reqwest::Client::new();
        let app = Arc::new(App {
            token: "tok_test-1".into(),
            guest: guest.map(str::to_string),
            guest_audit: guest::Audit::new(),
            viewers: vec![(0, ["cre_", "view-3"].concat())],
            camkey: "ck".into(),
            base: home.clone(),
            hosts: hosts::Hosts::new(util::uid()),
            ha: ha::Ha::load(&home, http.clone()),
            home,
            http,
            fleet: Swr::default(),
            today: Mutex::new(None),
            src: sources::Cache::default(),
            traffic: traffic::Cache::default(),
            launcher: launch::Launcher::default(),
            apps: apps::Apps::default(),
            runs: runs::Runs::default(),
            crons: Mutex::new(None),
            board: Swr::default(),
            amazon: Swr::default(),
            widgets: Mutex::new(None),
            actions: actions::Actions::default(),
            binds: keybinds::Cache::new(),
            housing: housing::Cache::default(),
            ecom_market: ecom_market::Cache::default(),
            listings: listings::Cache::default(),
            client_errors: clienterr::ClientErrors::default(),
        });
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.ok()?;
        let addr = l.local_addr().ok()?;
        let router = router(app, HostGuard::new("127.0.0.1", ""));
        tokio::spawn(async move {
            let _ = axum::serve(l, router).await;
        });
        Some((format!("http://{addr}"), addr.to_string()))
    }

    async fn status(
        c: &reqwest::Client,
        m: reqwest::Method,
        url: &str,
        hdrs: &[(&str, &str)],
    ) -> u16 {
        let mut r = c.request(m, url).header("Cookie", "pdeck=tok_test-1");
        for (k, v) in hdrs {
            r = r.header(*k, *v);
        }
        r.send().await.map(|r| r.status().as_u16()).unwrap_or(0)
    }

    #[tokio::test]
    async fn fleet_widgets_are_authenticated_read_only_and_explicitly_unavailable() {
        let Some((base, _)) = spawn_app().await else { panic!("no listener") };
        let c = reqwest::Client::new();
        let url = format!("{base}/api/fleet-widgets");
        assert_eq!(status(&c, reqwest::Method::GET, &url, &[]).await, 200);
        assert_eq!(status(&c, reqwest::Method::POST, &url, &[]).await, 405);
        let Ok(public) = c.get(&url).send().await else { panic!("unauthenticated request failed") };
        assert_eq!(public.status().as_u16(), 401);
        let Ok(resp) = c.get(&url).header("Cookie", "pdeck=tok_test-1").send().await else { panic!("widget request failed") };
        let Ok(body) = resp.json::<Value>().await else { panic!("widget body is not JSON") };
        assert_eq!(body["thermal"]["stale"], true);
        assert!(body["outbound"]["legacy_queue"]["files"].is_null());
        assert_eq!(body["neighbors"]["discovery"], false);
    }

    #[tokio::test]
    async fn saved_jobs_is_owner_cookie_only_and_round_trips_in_its_own_home() {
        use reqwest::Method as M;
        let home = std::env::temp_dir().join(format!("pdeck-savedjobs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let guest_tok = ["gue", "st_tok-9"].concat();
        let Some((base, host)) = spawn_app_guest(home.clone(), Some(&guest_tok)).await else { panic!("no listener") };
        let c = reqwest::Client::new();
        let url = format!("{base}/api/saved-jobs");
        let own = format!("http://{host}");
        assert_eq!(status(&c, M::GET, &format!("{url}?person=casey"), &[]).await, 200);
        assert_eq!(status(&c, M::GET, &format!("{url}?person=morgan"), &[]).await, 400);
        // the ?t= bootstrap, no cookie, the guest cookie and a cross-site page are all refused
        let plain = |u: String| { let c = c.clone(); async move { c.get(u).send().await.map(|r| r.status().as_u16()).unwrap_or(0) } };
        assert_eq!(plain(format!("{url}?person=casey&t=tok_test-1")).await, 401);
        assert_eq!(plain(format!("{url}?person=casey")).await, 401);
        let gc = format!("pdeck={guest_tok}");
        let guest = c.get(format!("{url}?person=casey")).header("Cookie", gc.as_str()).send().await.map(|r| r.status().as_u16()).unwrap_or(0);
        assert_eq!(guest, 403);
        assert_eq!(status(&c, M::GET, &format!("{url}?person=casey"), &[("Sec-Fetch-Site", "cross-site")]).await, 403);
        assert_eq!(status(&c, M::POST, &url, &[("Origin", "http://evil.example")]).await, 403);
        assert_eq!(status(&c, M::PUT, &url, &[("Origin", own.as_str())]).await, 405);
        // same-origin JSON POST saves into this test's own home
        let body = r#"{"person":"casey","key":"sdr|acme|oc","title":"SDR","company":"Acme","url":"https://example.com/sdr","state":"applied"}"#;
        let post = |ct: &'static str| {
            c.post(&url).header("Cookie", "pdeck=tok_test-1").header("Origin", own.as_str()).header("Sec-Fetch-Site", "same-origin")
                .header("Content-Type", ct).body(body).send()
        };
        assert_eq!(post("text/plain").await.map(|r| r.status().as_u16()).unwrap_or(0), 400);
        let Ok(r) = post("application/json").await else { panic!("post") };
        assert_eq!(r.status().as_u16(), 200);
        let Ok(r) = c.get(format!("{url}?person=casey")).header("Cookie", "pdeck=tok_test-1").send().await else { panic!("get") };
        let Ok(v) = r.json::<Value>().await else { panic!("json") };
        assert_eq!(v["items"][0]["state"], "applied");
        assert!(home.join(savedjobs::REL).is_file());
        let _ = std::fs::remove_dir_all(&home);
    }

    // ---- Headers that cost nothing and the page-error route (round "Better", 2026-11-15) ----

    /// A stand-in Home Assistant that answers every request 200 with an HTML page that runs script.
    async fn hostile_ha() -> Option<String> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.ok()?;
        let addr = l.local_addr().ok()?;
        tokio::spawn(async move {
            while let Ok((mut c, _)) = l.accept().await {
                tokio::spawn(async move {
                    let mut buf = [0u8; 4096];
                    let _ = c.read(&mut buf).await;
                    let body = "<script>alert(1)</script>";
                    let r = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                    let _ = c.write_all(r.as_bytes()).await;
                });
            }
        });
        Some(format!("http://{addr}"))
    }

    fn header_of(r: &reqwest::Response, name: &str) -> String {
        r.headers().get(name).and_then(|v| v.to_str().ok()).unwrap_or("").to_string()
    }

    #[tokio::test]
    async fn security_headers_on_every_answer() {
        let home = std::env::temp_dir().join(format!("pdeck-headers-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let Some(ha) = hostile_ha().await else { panic!("no mock ha") };
        let _ = std::fs::create_dir_all(home.join(".hermes"));
        let _ = std::fs::write(home.join(".hermes/.env"), format!("HASS_URL={ha}\nHASS_TOKEN=test-only\n"));
        let Some((base, host)) = spawn_app_home(home.clone()).await else { panic!("no listener") };
        let c = reqwest::Client::new();
        let owner = "pdeck=tok_test-1";
        let viewer = format!("pdeck={}", ["cre_", "view-3"].concat());
        let cam = format!("/api/cam?e={}", ha::HA_CAMS[0]);
        // (what, method, path, cookie, Host, status, a shell page)
        type Case<'a> = (&'a str, reqwest::Method, &'a str, Option<&'a str>, Option<&'a str>, u16, bool);
        let cases: Vec<Case<'_>> = vec![
            ("page", reqwest::Method::GET, "/", Some(owner), None, 200, true),
            ("desk page", reqwest::Method::GET, "/cre", Some(owner), None, 200, true),
            ("viewer page", reqwest::Method::GET, "/", Some(viewer.as_str()), None, 200, true),
            ("sign-in page", reqwest::Method::GET, "/", None, None, 401, false),
            ("401", reqwest::Method::GET, "/api/today", None, None, 401, false),
            ("JSON", reqwest::Method::GET, "/api/fleet-widgets", Some(owner), None, 200, false),
            ("JSON error", reqwest::Method::POST, "/api/fleet-widgets", Some(owner), None, 405, false),
            ("static", reqwest::Method::GET, "/app.js", None, None, 200, false),
            ("healthz", reqwest::Method::GET, "/healthz", None, None, 200, false),
            ("404", reqwest::Method::GET, "/nope", Some(owner), None, 404, false),
            ("camera", reqwest::Method::GET, cam.as_str(), Some(owner), None, 200, false),
            ("guest refusal", reqwest::Method::GET, "/api/today", Some(viewer.as_str()), None, 403, false),
            ("host refusal", reqwest::Method::GET, "/healthz", None, Some("evil.example"), 403, false),
        ];
        for (what, m, path, cookie, h, want, page) in cases {
            let mut r = c.request(m, format!("{base}{path}"));
            if let Some(k) = cookie {
                r = r.header("Cookie", k);
            }
            r = r.header("Host", h.unwrap_or(host.as_str()));
            let Ok(res) = r.send().await else { panic!("{what}: no answer") };
            assert_eq!(res.status().as_u16(), want, "{what}");
            assert_eq!(header_of(&res, "x-content-type-options"), "nosniff", "{what}");
            assert_eq!(header_of(&res, "referrer-policy"), "same-origin", "{what}");
            assert_eq!(header_of(&res, "x-frame-options"), "DENY", "{what}");
            // the policy rides in report-only mode on the two shell pages only, never enforced this round
            assert_eq!(header_of(&res, "content-security-policy-report-only") == *headers::PAGE_POLICY, page, "{what}");
            assert!(res.headers().get("content-security-policy").is_none(), "{what}");
            if what == "camera" {
                // X5: Home Assistant's HTML never reaches the deck origin as HTML
                assert_eq!(header_of(&res, "content-type"), "application/octet-stream", "{what}");
            }
        }
        // a revalidated shell file (304) carries them too
        let Ok(first) = c.get(format!("{base}/deck.js")).send().await else { panic!("deck.js") };
        let etag = header_of(&first, "etag");
        let Ok(again) = c.get(format!("{base}/deck.js")).header("If-None-Match", etag).send().await else { panic!("deck.js 304") };
        assert_eq!(again.status().as_u16(), 304);
        assert_eq!(header_of(&again, "x-content-type-options"), "nosniff");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// `nosniff` blocks a script or style sheet served under the wrong type outright, so every file the shell lists,
    /// every file the three pages name and the pages themselves must carry their true type.
    #[tokio::test]
    async fn every_shell_file_and_page_carries_its_true_type() {
        let Some((base, _)) = spawn_app().await else { panic!("no listener") };
        let c = reqwest::Client::new();
        let quoted = |s: &str| -> Vec<String> { s.split('\'').skip(1).step_by(2).map(str::to_string).collect() };
        let sw = String::from_utf8_lossy(SW_JS).into_owned();
        let (Some(a), Some(b)) = (sw.find("SHELL=["), sw.find("];")) else { panic!("SHELL list moved in sw.js") };
        let mut paths = quoted(&sw[a..b]);
        assert!(paths.len() > 30, "SHELL parse found {paths:?}");
        for page in [INDEX, CRE_HTML, LOGIN] {
            let text = String::from_utf8_lossy(page);
            for attr in ["src=\"/", "href=\"/"] {
                for part in text.split(attr).skip(1) {
                    let p = format!("/{}", part.split(['"', '?', '#']).next().unwrap_or(""));
                    if !paths.contains(&p) {
                        paths.push(p);
                    }
                }
            }
        }
        for p in ["/sw.js", "/hls.min.js", "/theme.css", "/cre", "/apple-touch-icon-precomposed.png", "/favicon.ico"] {
            paths.push(p.to_string());
        }
        for p in &paths {
            let want = match p.rsplit_once('.').map(|(_, e)| e) {
                _ if p == "/" || p == "/cre" => "text/html; charset=utf-8",
                Some("ico") => "image/png",
                Some("js") => "text/javascript",
                Some("css") => "text/css",
                Some("woff2") => "font/woff2",
                Some("svg") => "image/svg+xml",
                Some("png") => "image/png",
                Some("webmanifest") => "application/manifest+json",
                other => panic!("{p}: no expected type for {other:?}"),
            };
            let Ok(r) = c.get(format!("{base}{p}")).header("Cookie", "pdeck=tok_test-1").send().await else { panic!("{p}") };
            assert_eq!((r.status().as_u16(), header_of(&r, "content-type").as_str()), (200, want), "{p}");
        }
        // the sign-in page is HTML too, behind its 401
        let Ok(r) = c.get(format!("{base}/")).send().await else { panic!("sign-in") };
        assert_eq!((r.status().as_u16(), header_of(&r, "content-type").as_str()), (401, "text/html; charset=utf-8"));
        // the browser's own favicon request carries no cookie on a first visit: it answers before sign-in, never a 404
        let Ok(r) = c.get(format!("{base}/favicon.ico")).send().await else { panic!("favicon") };
        assert_eq!((r.status().as_u16(), header_of(&r, "content-type").as_str()), (200, "image/png"));
    }

    #[tokio::test]
    async fn json_answers_name_json() {
        let home = std::env::temp_dir().join(format!("pdeck-jsontype-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let Some((base, _)) = spawn_app_home(home.clone()).await else { panic!("no listener") };
        let c = reqwest::Client::new();
        let mut paths: Vec<String> = [
            "whoami", "fleet-widgets", "crons", "amazon", "client-error", "housing/national", "housing/rank", "housing/zip/92629",
            "surf-coast", "ecom-market", "realestate/homes", "realestate/commercial", "saved-jobs?person=casey", "crons/abcdef01",
            "unit?name=x", "nope",
        ]
        .iter()
        .map(|p| format!("/api/{p}"))
        .collect();
        paths.extend(sources::FEEDS.iter().map(|d| format!("/api/{}", d.name)));
        for p in &paths {
            let Ok(r) = c.get(format!("{base}{p}")).header("Cookie", "pdeck=tok_test-1").send().await else { panic!("{p}") };
            let ct = header_of(&r, "content-type");
            assert_eq!(ct.split(';').next(), Some("application/json"), "{p} ({})", r.status());
        }
        let _ = std::fs::remove_dir_all(&home);
    }

    /// Every function that gates on `amount_gate` (and the household profile, gated by its own owner check) answers
    /// through `amount_json`, so a new amount route cannot ship an ETag by forgetting a list.
    #[test]
    fn every_amount_route_marks_its_answer() {
        let src = include_str!("main.rs");
        let mut gated = 0;
        for f in src.split("\nasync fn ").skip(1) {
            let body = f.split("\n}\n").next().unwrap_or("");
            if body.contains("amount_gate(app") {
                gated += 1;
                let name = body.split('(').next().unwrap_or("?");
                assert!(body.contains("amount_json("), "{name} passes amount_gate but answers without amount_json");
                assert!(!body.contains("json_resp(200"), "{name} answers a 200 without the amount marker");
            }
        }
        assert_eq!(gated, 3, "finance, commerce and portfolio values");
        let Some(profile) = src.split("if rest == \"profile\" {").nth(1).and_then(|r| r.split("\n    }\n").next()) else { panic!("profile branch moved") };
        assert_eq!(profile.matches("amount_json(").count(), 2, "profile GET and POST carry the marker");
    }

    #[tokio::test]
    async fn amount_answers_carry_no_tag_and_no_marker() {
        let home = std::env::temp_dir().join(format!("pdeck-amount-tag-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let Some((base, _)) = spawn_app_home(home.clone()).await else { panic!("no listener") };
        let c = reqwest::Client::new();
        for p in ["/api/commerce", "/api/housing/profile", "/api/finance", "/api/finance-values", "/api/portfolio-values"] {
            let Ok(r) = c.get(format!("{base}{p}")).header("Cookie", "pdeck=tok_test-1").header("If-None-Match", "*").send().await else { panic!("{p}") };
            assert_eq!(r.status().as_u16(), 200, "{p}");
            assert!(r.headers().get("etag").is_none(), "{p} carries a fingerprint");
            assert!(r.headers().get(compress::AMOUNT).is_none(), "{p}: the private marker left the server");
        }
        // a plain feed next to them is tagged, so the check above is not vacuous
        let Ok(r) = c.get(format!("{base}/api/fleet-widgets")).header("Cookie", "pdeck=tok_test-1").send().await else { panic!("widgets") };
        assert!(r.headers().get("etag").is_some());
        let _ = std::fs::remove_dir_all(&home);
    }

    /// P11: the first Amazon read after a start is the kept answer, at once and marked stale, while the refresh runs; item 8:
    /// a JSON read carries a tag and the same tag asked again is a bodyless 304.
    #[tokio::test]
    async fn amazon_starts_from_its_kept_answer_and_reads_revalidate() {
        let home = std::env::temp_dir().join(format!("pdeck-amazon-route-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        amazon::remember(&home, &json!({"src": amazon::SRC, "stale": false, "watch": [{"slug": "kept"}], "deals": []}));
        let Some((base, _)) = spawn_app_home(home.clone()).await else { panic!("no listener") };
        let c = reqwest::Client::new();
        let get = |p: &str, inm: Option<&str>| {
            let mut r = c.get(format!("{base}{p}")).header("Cookie", "pdeck=tok_test-1");
            if let Some(t) = inm {
                r = r.header("If-None-Match", t);
            }
            r.send()
        };
        let started = Instant::now();
        let Ok(r) = get("/api/amazon", None).await else { panic!("amazon") };
        let Ok(v) = r.json::<Value>().await else { panic!("json") };
        assert_eq!((v["watch"][0]["slug"].as_str(), v["stale"].as_bool()), (Some("kept"), Some(true)), "{v}");
        assert!(v["kept_at"].is_u64(), "{v}");
        // The outcome is the guard: the first answer is the kept one, marked stale, and the refresh's error turns up on a later read
        // (below). This generous bound (5 times the old 2 s) only catches a route that wedges. No fake clock fits an HTTP round trip.
        assert!(started.elapsed() < Duration::from_secs(10), "the first read waited: {:?}", started.elapsed());
        // the refresh ran in the background: this home has no shop database, so the next read says so
        let mut now = Value::Null;
        for _ in 0..50 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            now = match get("/api/amazon", None).await { Ok(r) => r.json::<Value>().await.unwrap_or(Value::Null), Err(_) => Value::Null };
            if now.get("error").is_some() {
                break;
            }
        }
        assert_eq!(now["error"], "shop database missing", "{now}");
        // revalidation on a feed read
        let Ok(r) = get("/api/fleet-widgets", None).await else { panic!("widgets") };
        let tag = header_of(&r, "etag");
        assert!(tag.starts_with("W/\""), "{tag}");
        let Ok(again) = get("/api/fleet-widgets", Some(&tag)).await else { panic!("again") };
        assert_eq!(again.status().as_u16(), 304);
        assert_eq!(header_of(&again, "x-content-type-options"), "nosniff", "the outer headers ride on a 304 too");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn client_error_route_keeps_its_fences() {
        use reqwest::Method as M;
        let home = std::env::temp_dir().join(format!("pdeck-clienterr-route-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let guest_tok = ["gue", "st_tok-7"].concat();
        let Some((base, host)) = spawn_app_guest(home.clone(), Some(&guest_tok)).await else { panic!("no listener") };
        let c = reqwest::Client::new();
        let url = format!("{base}/api/client-error");
        let own = format!("http://{host}");
        let post = |cookie: String, ct: &'static str, body: String| {
            c.post(&url).header("Cookie", cookie).header("Origin", own.as_str()).header("Sec-Fetch-Site", "same-origin")
                .header("Content-Type", ct).body(body).send()
        };
        let code = |r: Result<reqwest::Response, reqwest::Error>| r.map(|r| r.status().as_u16()).unwrap_or(0);
        let owner = || "pdeck=tok_test-1".to_string();
        let good = r#"{"e":"render","route":"shop/market","src":"shop.js","line":4,"col":2,"msg":"boom"}"#.to_string();
        assert_eq!(code(post(owner(), "application/json", good.clone()).await), 200);
        // over the 2,048-byte cap
        let big = format!(r#"{{"e":"error","msg":"{}"}}"#, "x".repeat(clienterr::MAX_BODY));
        assert_eq!(code(post(owner(), "application/json", big).await), 413);
        // an unknown kind, and a body that is not JSON
        assert_eq!(code(post(owner(), "application/json", r#"{"e":"panic"}"#.into()).await), 400);
        assert_eq!(code(post(owner(), "text/plain", good.clone()).await), 400);
        // the household guest and a desk viewer are refused both ways
        assert_eq!(code(post(format!("pdeck={guest_tok}"), "application/json", good.clone()).await), 403);
        assert_eq!(code(c.get(&url).header("Cookie", format!("pdeck={guest_tok}")).send().await), 403);
        let viewer = format!("pdeck={}", ["cre_", "view-3"].concat());
        assert_eq!(code(post(viewer.clone(), "application/json", good.clone()).await), 403);
        assert_eq!(code(c.get(&url).header("Cookie", viewer).send().await), 403);
        // CSRF as every POST: another origin, and no cookie at all
        let cross = c.post(&url).header("Cookie", "pdeck=tok_test-1").header("Origin", "http://evil.example")
            .header("Content-Type", "application/json").body(good.clone()).send().await;
        assert_eq!(code(cross), 403);
        assert_eq!(code(c.post(&url).header("Content-Type", "application/json").body(good.clone()).send().await), 401);
        assert_eq!(status(&c, M::PUT, &url, &[("Origin", own.as_str())]).await, 405);
        // the Fleet line's read: one report counted, newest first
        let Ok(r) = c.get(&url).header("Cookie", "pdeck=tok_test-1").send().await else { panic!("get") };
        let Ok(v) = r.json::<Value>().await else { panic!("json") };
        assert_eq!((v["ok"].as_bool(), v["n_24h"].as_u64()), (Some(true), Some(1)), "{v}");
        assert_eq!((v["last"][0]["route"].as_str(), v["last"][0]["msg"].as_str()), (Some("shop/market"), Some("boom")));
        let _ = std::fs::remove_dir_all(&home);
    }

    mod housing_http {
    use super::*;
    // ---- Markets > Housing and Commercial (2026-11-11): synthetic fixture under tests/fixtures/housing-national ----
    fn housing_fixture(home: &std::path::Path) {
        let d = home.join(housing::DIR);
        for (rel, body) in [
            ("manifest.json", include_str!("../../tests/fixtures/housing-national/manifest.json")),
            ("zips.json", include_str!("../../tests/fixtures/housing-national/zips.json")),
            ("zip/926.json", include_str!("../../tests/fixtures/housing-national/zip/926.json")),
            ("zip/100.json", include_str!("../../tests/fixtures/housing-national/zip/100.json")),
            ("listings/92629.json", include_str!("../../tests/fixtures/housing-national/listings/92629.json")),
        ] {
            let p = d.join(rel);
            if let Some(parent) = p.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(&p, body);
        }
    }

    async fn get_json(c: &reqwest::Client, url: &str, cookie: Option<&str>, hdrs: &[(&str, &str)]) -> (u16, Value) {
        let mut r = c.get(url);
        if let Some(k) = cookie {
            r = r.header("Cookie", format!("pdeck={k}"));
        }
        for (k, v) in hdrs {
            r = r.header(*k, *v);
        }
        match r.send().await {
            Ok(resp) => {
                let code = resp.status().as_u16();
                (code, resp.json::<Value>().await.unwrap_or(Value::Null))
            }
            Err(_) => (0, Value::Null),
        }
    }

    #[tokio::test]
    async fn housing_routes_rank_zip_and_say_not_reporting_without_data() {
        let home = std::env::temp_dir().join(format!("pdeck-housing-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let Some((base, _)) = spawn_app_home(home.clone()).await else { panic!("no listener") };
        let c = reqwest::Client::new();
        let u = |p: &str| format!("{base}/api/housing/{p}");
        let own = Some("tok_test-1");
        // no data directory: a clear not-reporting state on every read, never a 5xx
        for p in ["national", "rank?kind=housing&limit=5", "zip/92629"] {
            let (code, v) = get_json(&c, &u(p), own, &[]).await;
            assert_eq!((code, v["status"].as_str()), (200, Some("not_reporting")), "{p} {v}");
        }
        housing_fixture(&home);
        let (code, m) = get_json(&c, &u("national"), own, &[]).await;
        assert_eq!((code, m["coverage"]["zips_total"].as_u64()), (200, Some(8)));
        let (code, r) = get_json(&c, &u("rank?kind=housing&limit=5"), own, &[]).await;
        assert_eq!(code, 200);
        assert_eq!((r["total"].as_u64(), r["rows"].as_array().map(Vec::len)), (Some(8), Some(5)));
        assert_eq!(r["rows"][0]["zip"], "77494");
        let (_, r) = get_json(&c, &u("rank?kind=commercial&state=CA&limit=5"), own, &[]).await;
        assert_eq!(r["rows"][0]["zip"], "92101");
        assert_eq!(r["filters"]["state"], "CA");
        let (code, r) = get_json(&c, &u("rank?kind=housing&max_price=700000&sort=price"), own, &[]).await;
        assert_eq!((code, r["total"].as_u64()), (200, Some(4)));
        assert_eq!(get_json(&c, &u("rank?kind=land"), own, &[]).await.0, 400);
        // one ZIP: the shard record plus its listings file
        let (code, z) = get_json(&c, &u("zip/92629"), own, &[]).await;
        assert_eq!((code, z["city"].as_str()), (200, Some("Dana Point")));
        assert_eq!(z["fmr"]["br2"], 2600);
        assert_eq!(z["listings"]["listings"][0]["price"], 1650000);
        assert_eq!(z["hist"]["zhvi"].as_array().map(Vec::len), Some(60));
        for p in ["zip/00000", "zip/92699"] {
            let (code, v) = get_json(&c, &u(p), own, &[]).await;
            assert_eq!((code, v), (404, json!({"error": "unknown zip"})), "{p}");
        }
        assert_eq!(get_json(&c, &u("zip/9262"), own, &[]).await.0, 400);
        assert_eq!(get_json(&c, &u("nope"), own, &[]).await.0, 404);
        assert_eq!(status(&c, reqwest::Method::POST, &u("rank"), &[("Origin", base.as_str())]).await, 405);
        assert_eq!(get_json(&c, &u("national"), None, &[]).await.0, 401);
        // zips.json is parsed once and read again when it changes on disk
        let one = r#"{"schema":1,"generated_at":1,"cols":["zip","state","h_score"],"rows":[["12345","VT",50]]}"#;
        let _ = std::fs::write(home.join(housing::DIR).join("zips.json"), one);
        let (_, r) = get_json(&c, &u("rank"), own, &[]).await;
        assert_eq!((r["total"].as_u64(), r["rows"][0]["zip"].as_str()), (Some(1), Some("12345")));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn housing_profile_is_owner_cookie_only_validates_and_saves_0600() {
        use std::os::unix::fs::PermissionsExt;
        let home = std::env::temp_dir().join(format!("pdeck-housing-prof-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        housing_fixture(&home);
        let fin = home.join(sources::FINANCE.rel);
        if let Some(p) = fin.parent() {
            let _ = std::fs::create_dir_all(p);
        }
        let _ = std::fs::write(&fin, r#"{"t":1794000000,"sample":false,"as_of":{"balances":1794000000},"money":{"groups":[{"id":"cash","usd":30000},{"id":"brokerage","usd":20000},{"id":"crypto","usd":99999}]}}"#);
        let guest_tok = ["gue", "st_tok-7"].concat();
        let Some((base, host)) = spawn_app_guest(home.clone(), Some(&guest_tok)).await else { panic!("no listener") };
        let c = reqwest::Client::new();
        let url = format!("{base}/api/housing/profile");
        let own = format!("http://{host}");
        let (code, v) = get_json(&c, &url, Some("tok_test-1"), &[]).await;
        assert_eq!(code, 200);
        assert_eq!(v["stored"], false);
        assert_eq!(v["budget"]["cash"]["value"], 50000, "cash plus brokerage, never crypto");
        assert_eq!(v["budget"]["rate"]["rate_30y"], 6.5);
        assert_eq!(v["budget"]["basis"], "cash only", "income is not set yet");
        // guests, the ?t= bootstrap and other sites never see the profile or the budget
        assert_eq!(get_json(&c, &url, Some(&guest_tok), &[]).await.0, 403);
        assert_eq!(get_json(&c, &format!("{base}/api/housing/national"), Some(&guest_tok), &[]).await.0, 403);
        assert_eq!(get_json(&c, &format!("{url}?t=tok_test-1"), None, &[]).await.0, 401);
        assert_eq!(get_json(&c, &url, Some("tok_test-1"), &[("Sec-Fetch-Site", "cross-site")]).await.0, 403);
        let post = |ct: &'static str, body: &'static str| {
            c.post(&url).header("Cookie", "pdeck=tok_test-1").header("Origin", own.as_str()).header("Sec-Fetch-Site", "same-origin")
                .header("Content-Type", ct).body(body).send()
        };
        let code = |r: Result<reqwest::Response, reqwest::Error>| r.map(|r| r.status().as_u16()).unwrap_or(0);
        assert_eq!(code(post("application/json", r#"{"down_pct":2}"#).await), 400);
        assert_eq!(code(post("application/json", r#"{"note":"x"}"#).await), 400);
        assert_eq!(code(post("text/plain", r#"{"down_pct":0.2}"#).await), 400);
        let Ok(r) = post("application/json", r#"{"income_annual":120000,"income_src":"Synthetic","income_asof":"2026-11-01","down_pct":0.2,"closing_pct":0.05,"dti_max":0.4,"tax_ins_rate":0.012,"monthly_debt":500}"#).await else { panic!("post") };
        assert_eq!(r.status().as_u16(), 200);
        let Ok(v) = r.json::<Value>().await else { panic!("json") };
        assert_eq!((v["ok"].as_bool(), v["stored"].as_bool()), (Some(true), Some(true)));
        assert_eq!(v["budget"]["max_price_cash"], 200000);
        assert_eq!(v["budget"]["budget"], 200000);
        let mode = std::fs::metadata(housing::profile_path(&home)).map(|m| m.permissions().mode() & 0o777).unwrap_or(0);
        assert_eq!(mode, 0o600);
        let (_, v) = get_json(&c, &url, Some("tok_test-1"), &[]).await;
        assert_eq!(v["profile"]["income_annual"], 120000);
        assert_eq!(v["profile"]["cash_mode"], "auto", "defaults kept for fields the post did not name");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn housing_listings_post_runs_the_collector_once_and_is_rate_limited() {
        let home = std::env::temp_dir().join(format!("pdeck-housing-lst-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        housing_fixture(&home);
        let Some((base, host)) = spawn_app_home(home.clone()).await else { panic!("no listener") };
        let c = reqwest::Client::new();
        let own = format!("http://{host}");
        let url = format!("{base}/api/housing/zip/92624/listings");
        let post = |u: String, site: &'static str| {
            c.post(u).header("Cookie", "pdeck=tok_test-1").header("Origin", own.as_str()).header("Sec-Fetch-Site", site).send()
        };
        let code = |r: Result<reqwest::Response, reqwest::Error>| r.map(|r| r.status().as_u16()).unwrap_or(0);
        assert_eq!(get_json(&c, &url, Some("tok_test-1"), &[]).await.0, 405, "GET never runs it");
        assert_eq!(code(post(url.clone(), "cross-site").await), 403);
        // no collector with the flag: refused, nothing runs
        assert_eq!(code(post(url.clone(), "same-origin").await), 501);
        // a stand-in collector that writes the listings file the way the real one does
        let script = home.join(housing::COLLECTOR);
        if let Some(p) = script.parent() {
            let _ = std::fs::create_dir_all(p);
        }
        let py = "import sys, json, os\n# accepts --zip <zip> --on-demand\nz = sys.argv[sys.argv.index('--zip') + 1]\n\
            d = os.path.join(os.path.dirname(__file__), '..', '..', '.meshvault/status/house-feeds/national/listings')\n\
            os.makedirs(d, exist_ok=True)\njson.dump({'t': 1, 'zip': z, 'homes': [{'price': 1}], 'commercial': []}, open(os.path.join(d, z + '.json'), 'w'))\n";
        let _ = std::fs::write(&script, py);
        let Ok(r) = post(url.clone(), "same-origin").await else { panic!("post") };
        assert_eq!(r.status().as_u16(), 200);
        let Ok(v) = r.json::<Value>().await else { panic!("json") };
        assert_eq!(v["listings"]["zip"], "92624");
        // the ZIP record now carries the listings file
        let (_, z) = get_json(&c, &format!("{base}/api/housing/zip/92624"), Some("tok_test-1"), &[]).await;
        assert_eq!(z["listings"]["homes"][0]["price"], 1);
        // a second read right away waits its turn
        assert_eq!(code(post(url.clone(), "same-origin").await), 429);
        assert_eq!(code(post(format!("{base}/api/housing/zip/9262x/listings"), "same-origin").await), 400);
        let _ = std::fs::remove_dir_all(&home);
    }

    /// iOS build 31 reads `/api/realestate` and `/api/cre?person=tanner` as they were on 2026-11-14. The inputs are the
    /// omarchy-deck-ios fixtures (`scripts/fixtures/feeds/`, main 4f05a47); the expected bodies were written by the server
    /// before the national v2 and listings routes existed (program branch 445bef9). Only the clock fields are masked.
    #[tokio::test]
    async fn realestate_and_cre_bodies_match_the_ios_build_31_goldens() {
        let home = std::env::temp_dir().join(format!("pdeck-ioscompat-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let fx = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/listings-compat");
        for (from, to) in [("realestate.json", sources::REALESTATE.rel), ("cre-deals.json", cre::DEALS_REL)] {
            let p = home.join(to);
            if let Some(parent) = p.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::copy(fx.join(from), &p);
        }
        let Some((base, _)) = spawn_app_home(home.clone()).await else { panic!("no listener") };
        let c = reqwest::Client::new();
        for (route, golden, clock) in [
            ("/api/realestate", "realestate.api.json", &["age", "stale"][..]),
            ("/api/cre?person=tanner", "cre-tanner.api.json", &["t"][..]),
        ] {
            let (code, mut v) = get_json(&c, &format!("{base}{route}"), Some("tok_test-1"), &[]).await;
            assert_eq!(code, 200, "{route}");
            for k in clock {
                v[*k] = json!("<clock>");
            }
            let got = serde_json::to_string_pretty(&v).unwrap_or_default();
            if std::env::var("PIXEL_DECK_BLESS").is_ok() {
                let _ = std::fs::write(fx.join(golden), &got);
            }
            let want = std::fs::read_to_string(fx.join(golden)).unwrap_or_default();
            assert!(!want.is_empty(), "golden {golden} missing");
            assert!(got == want, "{route} body changed against {golden}");
        }
        let _ = std::fs::remove_dir_all(&home);
    }

    // ---- national dataset v2 (2026-11-14): synthetic fixture under tests/fixtures/housing-national-v2 ----
    fn housing_v2_fixture(home: &std::path::Path) {
        let d = home.join(housing::DIR_V2);
        for (rel, body) in [
            ("manifest.json", include_str!("../../tests/fixtures/housing-national-v2/manifest.json")),
            ("zips.json", include_str!("../../tests/fixtures/housing-national-v2/zips.json")),
            ("zip/926.json", include_str!("../../tests/fixtures/housing-national-v2/zip/926.json")),
            ("zip/100.json", include_str!("../../tests/fixtures/housing-national-v2/zip/100.json")),
            ("hist/926.json", include_str!("../../tests/fixtures/housing-national-v2/hist/926.json")),
        ] {
            let p = d.join(rel);
            if let Some(parent) = p.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(&p, body);
        }
    }

    #[tokio::test]
    async fn national_v2_is_preferred_by_its_manifest_and_v1_answers_otherwise() {
        let home = std::env::temp_dir().join(format!("pdeck-housing-v2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        housing_fixture(&home);
        let Some((base, _)) = spawn_app_home(home.clone()).await else { panic!("no listener") };
        let c = reqwest::Client::new();
        let u = |p: &str| format!("{base}/api/housing/{p}");
        let own = Some("tok_test-1");
        // v1 only: today's bodies, the new routes say which dataset answered
        let (_, f) = get_json(&c, &u("fields"), own, &[]).await;
        assert_eq!((f["dataset"].as_str(), f["count"].as_u64()), (Some("v1"), Some(0)));
        assert_eq!(f["sort_aliases"]["housing"]["score"], "h_score");
        let (_, r) = get_json(&c, &u("rank?limit=2"), own, &[]).await;
        assert!(r.get("dataset").is_none() && r["total"] == 8);
        assert_eq!(get_json(&c, &u("rank?area=rural"), own, &[]).await, (400, json!({"error": "area needs national v2"})));
        let (_, h) = get_json(&c, &u("zip/92629/hist?fields=zhvi"), own, &[]).await;
        assert_eq!((h["dataset"].as_str(), h["hist"]["zhvi"].as_array().map(Vec::len)), (Some("v1"), Some(60)));
        housing_v2_fixture(&home);
        // rank: aliases, catalog sorts, repeated f, cols
        let (code, r) = get_json(&c, &u("rank?limit=3"), own, &[]).await;
        assert_eq!((code, r["dataset"].as_str(), r["total"].as_u64(), r["rows"][0]["zip"].as_str()), (200, Some("v2"), Some(12), Some("77494")));
        let (_, r) = get_json(&c, &u("rank?sort=gross_yield&f=gross_yield:ge:5&f=days_on_market%3Ale%3A40"), own, &[]).await;
        assert_eq!(r["total"], 4, "{r}");
        assert_eq!(r["rows"][0]["zip"], "44507");
        let (_, r) = get_json(&c, &u("rank?kind=commercial&type=industrial&min_conf=0.5&cols=zip,city&limit=1"), own, &[]).await;
        assert_eq!((r["rows"][0]["zip"].as_str(), r["cols"].clone()), (Some("92101"), json!(["zip", "city", "industrial_score", "industrial_conf"])));
        assert_eq!(get_json(&c, &u("rank?sort=nope"), own, &[]).await, (400, json!({"error": "bad sort"})));
        // national: no part is the compat manifest (schema 1, the old body), every part reads the v2 manifest
        let (_, m) = get_json(&c, &u("national"), own, &[]).await;
        let v1: Value = serde_json::from_str(include_str!("../../tests/fixtures/housing-national/manifest.json")).unwrap_or(Value::Null);
        assert_eq!(m, v1, "no part serves national/manifest.json as it is");
        assert_eq!((m["schema"].as_u64(), m["sources"].as_array().map(Vec::len)), (Some(1), Some(6)));
        assert!(m.get("fields").is_none() && m.get("age").is_none(), "no v2 keys on the compat body");
        for k in v1.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()).unwrap_or_default() {
            assert!(m.get(&k).is_some(), "{k}");
        }
        let (_, s) = get_json(&c, &u("national?part=summary"), own, &[]).await;
        assert_eq!((s["dataset"].as_str(), s["part"].as_str()), (Some("v2"), Some("summary")));
        assert_eq!(s["schema"].as_u64(), Some(2));
        assert!(s["age"].is_u64() && s["refresh"].as_u64() == Some(604_800) && s["stale"].is_boolean(), "{s}");
        assert!(s["coverage"].is_object() && s["mortgage"].is_object());
        for k in ["sources", "fields", "metrics", "states", "metros"] {
            assert!(s.get(k).is_none(), "summary carries {k}");
        }

        let (_, s) = get_json(&c, &u("national?part=sources"), own, &[]).await;
        assert!(s["sources"].as_array().is_some_and(|a| a.len() > 20) && s.get("states").is_none());
        let (_, s) = get_json(&c, &u("national?part=metrics"), own, &[]).await;
        assert!(s["metrics"]["home_value"].is_object() && s["scores"]["h_score"].is_object());
        assert_eq!(get_json(&c, &u("national?part=all"), own, &[]).await, (400, json!({"error": "bad part"})));
        // item 6: the heavy lists cut to a state and to the keys a picker shows
        let (code, s) = get_json(&c, &u("national?part=metros&state=CA&fields=cbsa,name"), own, &[]).await;
        assert_eq!(code, 200, "{s}");
        let ms = s["metros"].as_array().cloned().unwrap_or_default();
        assert!(!ms.is_empty() && ms.iter().all(|m| m.as_object().is_some_and(|o| o.len() == 2) && m["name"].as_str().is_some_and(|n| n.ends_with(", CA"))), "{s}");
        let (_, all) = get_json(&c, &u("national?part=metros"), own, &[]).await;
        assert!(all["metros"][0]["zips"].is_number() && all["metros"].as_array().map(Vec::len) >= Some(ms.len()), "no filter keeps every row and key");
        let (_, st) = get_json(&c, &u("national?part=states&state=ca"), own, &[]).await;
        assert_eq!((st["states"].as_array().map(Vec::len), st["states"][0]["state"].as_str()), (Some(1), Some("CA")));
        for bad in ["national?part=summary&state=CA", "national?part=metros&fields=Name", "national?part=metros&state=California", "national?fields=name"] {
            assert_eq!(get_json(&c, &u(bad), own, &[]).await.0, 400, "{bad}");
        }
        // fields catalog joined with source rows
        let (_, f) = get_json(&c, &u("fields"), own, &[]).await;
        assert_eq!(f["dataset"], "v2");
        let gy = f["fields"].as_array().and_then(|a| a.iter().find(|e| e["name"] == "gross_yield").cloned()).unwrap_or(Value::Null);
        assert_eq!((gy["rankable"].as_bool(), gy["better"].as_str(), gy["label"].is_string()), (Some(true), Some("higher"), true));
        let zh = f["fields"].as_array().and_then(|a| a.iter().find(|e| e["name"] == "zhvi").cloned()).unwrap_or(Value::Null);
        assert_eq!((zh["sources"][0]["id"].as_str(), zh["sources"][0]["as_of"].as_str()), (Some("zillow_zhvi"), Some("2026-09")));
        // one ZIP: v1 keys, v2 keys, hist merged, field_sources rebuilt, the on-demand listings file from national/
        let (code, z) = get_json(&c, &u("zip/92629"), own, &[]).await;
        assert_eq!((code, z["dataset"].as_str(), z["city"].as_str()), (200, Some("v2"), Some("Dana Point")));
        assert_eq!(z["fmr"]["br2"], 2600);
        assert_eq!(z["hist"]["zhvi"].as_array().map(Vec::len), Some(60));
        assert_eq!(z["hist"]["home_value"].as_array().map(Vec::len), Some(9));
        // county series join by the ZIP's county_fips; the ZIP's own series wins over a county one of the same name
        assert_eq!(z["hist"]["laus_unemployment"].as_array().map(Vec::len), Some(9));
        assert_eq!(z["field_sources"]["zhvi"]["source"], "zillow_zhvi");
        assert!(z["m"]["home_value"]["p"].is_array() && z["gross_yield"].is_number() && z["fhfa_hpi_5y"].is_number());
        // a metric the validity table nulled keeps its reason: null with a reason, never a clamp (PLAN decision 9)
        assert_eq!(z["m"]["typical_rent"], json!({"v": null, "reason": "seasonal rentals", "from": "rent"}));
        assert!(z["typical_rent"].is_null() && z["rent"] == 4200);
        // the Rent sort ranks on the blended rent, so a row with only a raw rent never leads it
        let (_, r) = get_json(&c, &u("rank?sort=rent&limit=1"), own, &[]).await;
        assert_eq!((r["sort_col"].as_str(), r["rows"][0]["typical_rent"].as_u64()), (Some("typical_rent"), Some(1439)), "{r}");
        assert_eq!(z["listings"]["listings"][0]["price"], 1650000);
        for p in ["zip/92699", "zip/55555"] {
            assert_eq!(get_json(&c, &u(p), own, &[]).await, (404, json!({"error": "unknown zip"})), "{p}");
        }
        // hist route: declared series only
        let (_, h) = get_json(&c, &u("zip/92629/hist?fields=zhvi,home_value"), own, &[]).await;
        assert_eq!(h["hist"].as_object().map(|o| o.len()), Some(2));
        assert_eq!(h["fields"].as_array().map(Vec::len), Some(6));
        let (_, h) = get_json(&c, &u("zip/92629/hist?fields=laus_unemployment"), own, &[]).await;
        assert_eq!(h["hist"]["laus_unemployment"][0], json!(["2026-01", 3.1]));
        assert_eq!(get_json(&c, &u("zip/92629/hist?fields=nope"), own, &[]).await.0, 400);
        let (code, h) = get_json(&c, &u("zip/10001/hist"), own, &[]).await;
        assert_eq!((code, h["hist"].clone()), (200, json!({})), "no history shard: an empty set, not an error");
        assert_eq!(get_json(&c, &u("zip/10009/hist"), own, &[]).await.0, 404);
        // the shard LRU parses a shard again when it changes on disk
        let shard = home.join(housing::DIR_V2).join("zip/926.json");
        let text = std::fs::read_to_string(&shard).unwrap_or_default().replace("\"Dana Point\"", "\"Dana Point Harbor\"");
        let _ = std::fs::write(&shard, text);
        let (_, z) = get_json(&c, &u("zip/92629"), own, &[]).await;
        assert_eq!(z["city"], "Dana Point Harbor");
        // a v2 manifest that is not schema 2 sends every reader back to v1
        let _ = std::fs::write(home.join(housing::DIR_V2).join("manifest.json"), r#"{"schema":1}"#);
        let (_, r) = get_json(&c, &u("rank?limit=2"), own, &[]).await;
        assert!(r.get("dataset").is_none() && r["total"] == 8, "{r}");
        let (_, z) = get_json(&c, &u("zip/92629"), own, &[]).await;
        assert!(z.get("dataset").is_none() && z["city"] == "Dana Point");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// The freshness mark (2026-11-14, iOS Real estate screen): `part=summary` and `fields` carry `age`, `refresh` and
    /// `stale` so no client guesses the weekly cadence; the full manifest stays verbatim.
    #[tokio::test]
    async fn summary_and_fields_say_how_fresh_the_national_data_is() {
        let home = std::env::temp_dir().join(format!("pdeck-housing-fresh-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let Some((base, _)) = spawn_app_home(home.clone()).await else { panic!("no listener") };
        let c = reqwest::Client::new();
        let u = |p: &str| format!("{base}/api/housing/{p}");
        let own = Some("tok_test-1");
        // no manifest: not reporting, and no freshness keys to misread
        for p in ["national?part=summary", "fields"] {
            let (code, v) = get_json(&c, &u(p), own, &[]).await;
            assert_eq!((code, v["status"].as_str()), (200, Some("not_reporting")), "{p} {v}");
            assert!(v.get("stale").is_none() && v.get("age").is_none(), "{p} {v}");
        }
        housing_v2_fixture(&home);
        let man = home.join(housing::DIR_V2).join("manifest.json");
        let mut m: Value = serde_json::from_str(include_str!("../../tests/fixtures/housing-national-v2/manifest.json")).unwrap_or(Value::Null);
        let now = util::now_epoch();
        for (days, stale) in [(3u64, false), (15, true)] {
            m["generated_at"] = json!(now - days * 86_400);
            let _ = std::fs::write(&man, m.to_string());
            for p in ["national?part=summary", "fields"] {
                let (code, v) = get_json(&c, &u(p), own, &[]).await;
                assert_eq!((code, v["dataset"].as_str(), v["refresh"].as_u64(), v["stale"].as_bool()), (200, Some("v2"), Some(604_800), Some(stale)), "{p} at {days} days");
                let age = v["age"].as_u64().unwrap_or(0);
                assert!(age >= days * 86_400 && age < days * 86_400 + 60, "{p} age {age}");
            }
        }
        let (_, full) = get_json(&c, &u("national"), own, &[]).await;
        assert!(full.get("age").is_none() && full.get("stale").is_none() && full.get("refresh").is_none(), "the full manifest stays verbatim");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn listings_pages_filter_and_keep_the_guest_and_viewer_fences() {
        use reqwest::Method as M;
        let home = std::env::temp_dir().join(format!("pdeck-listings-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let fx = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/listings-compat");
        for (from, to) in [("realestate.json", sources::REALESTATE.rel), ("cre-deals.json", cre::DEALS_REL)] {
            let p = home.join(to);
            if let Some(parent) = p.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::copy(fx.join(from), &p);
        }
        let Some((base, host)) = spawn_app_guest(home.clone(), Some(GTOK)).await else { panic!("no listener") };
        let c = reqwest::Client::new();
        let u = |p: &str| format!("{base}{p}");
        let own = Some("tok_test-1");
        let golden: Value = serde_json::from_str(&std::fs::read_to_string(fx.join("realestate.api.json")).unwrap_or_default()).unwrap_or(Value::Null);
        let (code, h) = get_json(&c, &u("/api/realestate/homes?limit=5"), own, &[]).await;
        // the fixture repeats "100 Fixture Way" (lines 11 and 401): one listing, so 31 raw rows read as 30
        assert_eq!((code, h["total"].as_u64(), h["rows"].as_array().map(Vec::len), h["sort"].as_str()), (200, Some(30), Some(5), Some("feed")));
        assert_eq!(h["rows"][0], golden["homes"][0], "a row is the object /api/realestate serves");
        assert_eq!(h["rows"][4], golden["homes"][4]);
        let (_, p2) = get_json(&c, &u("/api/realestate/homes?limit=5&offset=25"), own, &[]).await;
        assert_eq!((p2["total"].as_u64(), p2["rows"].as_array().map(Vec::len)), (Some(30), Some(5)));
        for bad in ["/api/realestate/homes?limit=101", "/api/realestate/homes?min_cap=5", "/api/realestate/commercial?sort=nope"] {
            assert_eq!(get_json(&c, &u(bad), own, &[]).await.0, 400, "{bad}");
        }
        let (_, cm) = get_json(&c, &u("/api/realestate/commercial?sort=price"), own, &[]).await;
        assert_eq!((cm["total"].as_u64(), cm["source"].as_str()), (Some(6), Some("realestate")));
        let prices: Vec<f64> = cm["rows"].as_array().map(|a| a.iter().filter_map(|r| r["price"].as_f64()).collect()).unwrap_or_default();
        assert!(prices.len() == 6 && prices.windows(2).all(|w| w[0] <= w[1]), "{prices:?}");
        assert_eq!(get_json(&c, &u("/api/realestate/commercial?min_cap=5"), own, &[]).await.1["total"], 0, "no cap rate reported");
        // deals: owner, buy box, viewer pinned to the own desk
        let (code, d) = get_json(&c, &u("/api/cre/deals?limit=100"), own, &[]).await;
        assert_eq!((code, d["total"].as_u64(), d["dataset"].as_str(), d["person"].as_str()), (200, Some(48), Some("ca"), Some("tanner")));
        // Tanner's default boxes (2026-11-17): the fixture's ZIPs are synthetic, so the box with deals here is "Small multifamily to
        // buy (2-4 units)": Multifamily in its counties with 2 to 4 units. The count is worked out from the box's own filters
        let f = cre::defaults("tanner")["boxes"][1]["f"].clone();
        let counties: Vec<&str> = f["counties"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
        let (lo, hi) = (f["units_min"].as_f64().unwrap_or(0.0), f["units_max"].as_f64().unwrap_or(f64::MAX));
        let small = d["rows"].as_array().map(|a| a.iter().filter(|x| x["type"] == "Multifamily" && x["county"].as_str().is_some_and(|c| counties.contains(&c))
            && x["units"].as_f64().is_some_and(|u| u >= lo && u <= hi)).count()).unwrap_or(0);
        assert!(small > 0, "the fixture has small multifamily deals in Tanner's counties");
        let (_, b) = get_json(&c, &u("/api/cre/deals?box=small-mf&limit=100"), own, &[]).await;
        assert_eq!((b["total"].as_u64(), b["box"].as_str()), (Some(small as u64), Some("small-mf")));
        assert_eq!(get_json(&c, &u("/api/cre/deals?box=nope"), own, &[]).await.0, 404);
        assert_eq!(get_json(&c, &u("/api/cre/deals?person=morgan"), own, &[]).await.0, 400);
        let vt = ["cre_", "view-3"].concat();
        let (code, v) = get_json(&c, &u("/api/cre/deals?person=riley&box=mf-core"), Some(&vt), &[]).await;
        assert_eq!((code, v["person"].as_str(), v["box"].as_str()), (200, Some("jordan"), Some("mf-core")), "a viewer reads only the own desk");
        let (code, _, _) = call(&c, M::GET, &u(&format!("/api/cre/deals?t={vt}")), None).await;
        assert_eq!(code, 200, "the viewer's ?t= bootstrap may read the desk");
        for p in ["/api/realestate/homes", "/api/realestate/commercial", "/api/housing/fields", "/api/housing/zip/92629/hist"] {
            assert_eq!(call(&c, M::GET, &u(p), Some(&vt)).await.0, 403, "viewer {p}");
        }
        for p in ["/api/realestate/homes", "/api/realestate/commercial", "/api/cre/deals", "/api/housing/fields", "/api/housing/national?part=summary", "/api/housing/zip/92629/hist"] {
            assert_eq!(call(&c, M::GET, &u(p), Some(GTOK)).await.0, 403, "guest {p}");
            assert_eq!(call(&c, M::GET, &u(p), None).await.0, 401, "nobody {p}");
        }
        let origin = format!("http://{host}");
        assert_eq!(status(&c, M::POST, &u("/api/cre/deals"), &[("Origin", origin.as_str())]).await, 405);
        assert_eq!(status(&c, M::POST, &u("/api/realestate/homes"), &[("Origin", origin.as_str())]).await, 405);
        // the national files win when they exist
        let nat = r#"{"generated_at":1794800000,"scope":"US","deals":[{"id":"aaaaaaaaaaaa","type":"Retail","state":"TX","price":2000000,"score":70}]}"#;
        let _ = std::fs::write(home.join(listings::DEALS_NATIONAL), nat);
        let (_, d) = get_json(&c, &u("/api/cre/deals"), own, &[]).await;
        assert_eq!((d["dataset"].as_str(), d["total"].as_u64(), d["rows"][0]["state"].as_str()), (Some("national"), Some(1), Some("TX")));
        let com = r#"{"schema":1,"generated_at":1794800000,"cols":["id","addr","state","zip","type","price","cap_rate","sale_or_lease","county"],
            "rows":[["a1","1 Main St","TX","75201","Office",3000000,7.1,"sale","Dallas County"],["a2","2 Elm St","TX","75202","Office",null,null,"lease","Dallas County"]]}"#;
        let p = home.join(listings::COMMERCIAL_V2);
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&p, com);
        let (_, cm) = get_json(&c, &u("/api/realestate/commercial?county=dallas"), own, &[]).await;
        assert_eq!((cm["source"].as_str(), cm["total"].as_u64()), (Some("listings-v2"), Some(2)));
        let (_, ls) = get_json(&c, &u("/api/realestate/commercial?sale=lease"), own, &[]).await;
        assert_eq!((ls["total"].as_u64(), ls["rows"][0]["id"].as_str()), (Some(1), Some("a2")));
        // and the frozen routes still answer from their own files
        let (_, re) = get_json(&c, &u("/api/realestate"), own, &[]).await;
        assert_eq!(re["commercial"].as_array().map(Vec::len), Some(6));
        let _ = std::fs::remove_dir_all(&home);
    }
    }

    #[tokio::test]
    async fn surf_coast_routes_are_owner_only_validate_the_region_and_keep_every_spot() {
        use reqwest::Method as M;
        let home = std::env::temp_dir().join(format!("pdeck-surfcoast-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let guest_tok = ["gue", "st_tok-7"].concat();
        let Some((base, _)) = spawn_app_guest(home.clone(), Some(&guest_tok)).await else { panic!("no listener") };
        let c = reqwest::Client::new();
        let body = |u: String, ck: String| {
            let c = c.clone();
            async move {
                let Ok(r) = c.get(u).header("Cookie", format!("pdeck={ck}")).send().await else { return (0, Value::Null) };
                (r.status().as_u16(), r.json::<Value>().await.unwrap_or(Value::Null))
            }
        };
        let own = "tok_test-1".to_string();
        // nothing written yet: a clear not-reporting state, never a 5xx
        let (code, v) = body(format!("{base}/api/surf-coast"), own.clone()).await;
        assert_eq!((code, v["status"].as_str()), (200, Some("not_reporting")));
        // 246 spots survive (the generic feed cleaner would cut them at 200), with age and stale added
        let spots: Vec<Value> = (0..246).map(|i| json!({"id": format!("spot-{i}")})).collect();
        let t = util::now_epoch();
        let _ = std::fs::create_dir_all(home.join(surf::REGION_DIR));
        let _ = std::fs::write(home.join(surf::OVERVIEW), json!({"v": 1, "t": t, "refresh": 1800, "spots": spots}).to_string());
        let _ = std::fs::write(home.join(surf::REGION_DIR).join("orange-county.json"),
                               json!({"v": 1, "t": t, "region": {"id": "orange-county"}}).to_string());
        let (code, v) = body(format!("{base}/api/surf-coast"), own.clone()).await;
        assert_eq!((code, v["spots"].as_array().map(Vec::len), v["stale"].as_bool()), (200, Some(246), Some(false)));
        assert!(v["age"].as_u64().is_some_and(|a| a < 60));
        let (code, v) = body(format!("{base}/api/surf-coast/region/orange-county"), own.clone()).await;
        assert_eq!((code, v["region"]["id"].as_str()), (200, Some("orange-county")));
        assert_eq!(body(format!("{base}/api/surf-coast/region/atlantis"), own.clone()).await.0, 404);
        assert_eq!(body(format!("{base}/api/surf-coast/region/..%2Fsurf-coast"), own.clone()).await.0, 404);
        assert_eq!(body(format!("{base}/api/surf-coast/nope"), own.clone()).await.0, 404);
        assert!(matches!(status(&c, M::POST, &format!("{base}/api/surf-coast"), &[]).await, 403 | 405), "a write is never served");
        // the household guest is refused on both routes; no cookie is unauthorised
        assert_eq!(body(format!("{base}/api/surf-coast"), guest_tok.clone()).await.0, 403);
        assert_eq!(body(format!("{base}/api/surf-coast/region/orange-county"), guest_tok.clone()).await.0, 403);
        let anon = c.get(format!("{base}/api/surf-coast")).send().await.map(|r| r.status().as_u16()).unwrap_or(0);
        assert_eq!(anon, 401);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn csrf_blocks_cross_origin_state_changes_and_bootstrap() {
        use reqwest::Method as M;
        let Some((base, host)) = spawn_app().await else {
            panic!("no listener")
        };
        let c = reqwest::Client::new();
        let own = format!("http://{host}");
        // POST with a foreign Origin, even with a valid cookie: 403, action never runs
        // host=nohost: were the guard missing, the request dies as "bad host" (400) and no
        // helper ever runs, so this test cannot touch the real desktop
        for u in [
            "/api/lock?host=nohost",
            "/api/screenshot?host=nohost",
            "/api/vol-set?host=nohost&v=5",
            "/api/launch?host=nohost&v=terminal",
        ] {
            let url = format!("{base}{u}");
            assert_eq!(
                status(&c, M::POST, &url, &[("Origin", "http://evil.example")]).await,
                403,
                "{u}"
            );
            assert_eq!(
                status(&c, M::POST, &url, &[("Origin", "http://127.0.0.1:8123")]).await,
                403,
                "{u} same-site"
            );
            assert_eq!(
                status(&c, M::POST, &url, &[("Sec-Fetch-Site", "cross-site")]).await,
                403,
                "{u} sfs"
            );
            assert_eq!(
                status(
                    &c,
                    M::POST,
                    &url,
                    &[("Origin", own.as_str()), ("Sec-Fetch-Site", "cross-site")]
                )
                .await,
                403,
                "{u} sfs beats origin"
            );
        }
        // an unmodelled POST route with same origin passes the guard and hits the route table (400)
        let ok = status(
            &c,
            M::POST,
            &format!("{base}/api/lock?host=nohost"),
            &[("Origin", own.as_str()), ("Sec-Fetch-Site", "same-origin")],
        )
        .await;
        assert_eq!(ok, 400);
        // no Origin (curl, native client) is still allowed
        assert_eq!(
            status(&c, M::POST, &format!("{base}/api/lock?host=nohost"), &[]).await,
            400
        );
        // ?t= bootstrap with a foreign Origin is refused and sets no cookie
        let r = c
            .get(format!("{base}/?t=tok_test-1"))
            .header("Origin", "http://evil.example")
            .send()
            .await;
        let r = r.ok();
        assert_eq!(r.as_ref().map(|r| r.status().as_u16()), Some(403));
        assert!(r
            .map(|r| r.headers().get("set-cookie").is_none())
            .unwrap_or(false));
        // bootstrap from a cross-site link without Origin still works and sets the cookie
        let r = c
            .get(format!("{base}/?t=tok_test-1"))
            .header("Sec-Fetch-Site", "cross-site")
            .send()
            .await
            .ok();
        assert_eq!(r.as_ref().map(|r| r.status().as_u16()), Some(200));
        assert!(r
            .map(|r| r.headers().get("set-cookie").is_some())
            .unwrap_or(false));
        // plain cookie GETs are unaffected
        assert_eq!(
            status(
                &c,
                M::GET,
                &format!("{base}/api/hosts"),
                &[("Origin", "http://127.0.0.1:8123")]
            )
            .await,
            200
        );
        // a foreign Origin on a state-changing request is refused by the host guard before auth runs
        let r = c
            .post(format!("{base}/api/lock?host=nohost"))
            .header("Origin", "http://evil.example")
            .send()
            .await;
        assert_eq!(r.map(|r| r.status().as_u16()).unwrap_or(0), 403);
        // unauthenticated without a foreign Origin still answers 401
        let r = c.post(format!("{base}/api/lock?host=nohost")).send().await;
        assert_eq!(r.map(|r| r.status().as_u16()).unwrap_or(0), 401);
    }

    #[test]
    fn host_guard_allowlist() {
        let g = HostGuard::new("127.0.0.1", "");
        for h in ["127.0.0.1:8796", "localhost:8796", "LOCALHOST:8796", "[::1]:8796", "127.0.0.1", "localhost", "[::1]"] {
            assert!(g.allows(h), "{h}");
        }
        for h in [
            "evil.example",
            "evil.example:8796",
            "127.0.0.1.evil.example:8796",
            "localhost.evil.example:8796",
            "evil.example:8796@127.0.0.1",
            "",
            ":8796",
            "[::1",
            "[::1]x",
            "[]:8796",
            "127.0.0.1:",
            "127.0.0.1:80:80",
            "127.0.0.1:x",
            "127.0.0.1:123456",
            "192.0.2.2:8796",
            "pc-desktop.example.ts.net:10443",
        ] {
            assert!(!g.allows(h), "{h}");
        }
        // bind addresses and PIXEL_DECK_ALLOWED_HOSTS extend it (trimmed, case-insensitive, brackets optional)
        let g = HostGuard::new("192.0.2.2,127.0.0.1", " pc-desktop.example.ts.net , [fd7a:115c:a1e0::1] ,");
        for h in [
            "192.0.2.2:8796",
            "pc-desktop.example.ts.net:10443",
            "PC-Desktop.example.ts.net",
            "[fd7a:115c:a1e0::1]:8796",
            "localhost:8796",
        ] {
            assert!(g.allows(h), "{h}");
        }
        assert!(!g.allows("evil.example:8796"));
    }

    #[tokio::test]
    async fn host_guard_refuses_foreign_host_and_cross_site_writes() {
        use reqwest::Method as M;
        let Some((base, host)) = spawn_app().await else {
            panic!("no listener")
        };
        let port = host.rsplit(':').next().unwrap_or("").to_string();
        let c = reqwest::Client::new();
        let plain = |path: &str, h: &str| c.get(format!("{base}{path}")).header("Host", h.to_string()).send();
        let code = |r: Result<reqwest::Response, reqwest::Error>| r.map(|r| r.status().as_u16()).unwrap_or(0);
        // allowed hosts: health, static files, auth and token routes answer exactly as before
        for h in [format!("127.0.0.1:{port}"), format!("localhost:{port}"), format!("[::1]:{port}")] {
            assert_eq!(code(plain("/healthz", &h).await), 200, "{h}");
            assert_eq!(code(plain("/manifest.webmanifest", &h).await), 200, "{h}");
            assert_eq!(code(plain("/api/hosts", &h).await), 401, "{h}");
            assert_eq!(status(&c, M::GET, &format!("{base}/api/hosts"), &[("Host", h.as_str())]).await, 200, "{h}");
            let r = plain("/?t=tok_test-1", &h).await.ok();
            assert_eq!(r.as_ref().map(|r| r.status().as_u16()), Some(200), "{h}");
            assert!(r.map(|r| r.headers().get("set-cookie").is_some()).unwrap_or(false), "{h}");
        }
        // a DNS-rebinding page: every route is 403 and the token bootstrap sets no cookie
        for h in ["evil.example".to_string(), format!("evil.example:{port}"), format!("127.0.0.1.evil.example:{port}")] {
            for path in ["/healthz", "/", "/manifest.webmanifest", "/api/hosts", "/api/finance", "/cam/x/index.m3u8"] {
                assert_eq!(code(plain(path, &h).await), 403, "{h} {path}");
                assert_eq!(status(&c, M::GET, &format!("{base}{path}"), &[("Host", h.as_str())]).await, 403, "{h} {path} cookie");
            }
            let r = plain("/?t=tok_test-1", &h).await.ok();
            assert_eq!(r.as_ref().map(|r| r.status().as_u16()), Some(403), "{h}");
            assert!(r.map(|r| r.headers().get("set-cookie").is_none()).unwrap_or(false), "{h}");
            let own = format!("http://{h}");
            assert_eq!(status(&c, M::POST, &format!("{base}/api/lock?host=nohost"), &[("Host", h.as_str()), ("Origin", own.as_str())]).await, 403, "{h} post");
        }
        // a foreign Origin on a state-changing request: 403 with or without the cookie, before any route runs
        let lock = format!("{base}/api/lock?host=nohost");
        let foreign_localhost = format!("http://localhost:{port}");
        for o in ["http://evil.example", "null", "http://127.0.0.1:8123", foreign_localhost.as_str()] {
            assert_eq!(status(&c, M::POST, &lock, &[("Origin", o)]).await, 403, "{o}");
            assert_eq!(code(c.post(&lock).header("Origin", o).send().await), 403, "{o} no cookie");
        }
        // same-origin POST still reaches the route (unknown host: 400), including the Caddy front's exact headers
        let own = format!("http://{host}");
        assert_eq!(status(&c, M::POST, &lock, &[("Origin", own.as_str()), ("Sec-Fetch-Site", "same-origin")]).await, 400);
        assert_eq!(
            status(&c, M::POST, &lock, &[("Origin", own.as_str()), ("X-Forwarded-Proto", "https"), ("X-Forwarded-Host", "pc-desktop.example.ts.net:10443")]).await,
            400
        );
        let lh = format!("localhost:{port}");
        assert_eq!(status(&c, M::POST, &lock, &[("Host", lh.as_str()), ("Origin", foreign_localhost.as_str())]).await, 400);
        // native clients without Origin are judged by auth as before
        assert_eq!(status(&c, M::POST, &lock, &[]).await, 400);
        assert_eq!(code(c.post(&lock).send().await), 401);
    }

    #[tokio::test]
    async fn host_guard_refuses_missing_or_repeated_host() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let Some((_, host)) = spawn_app().await else {
            panic!("no listener")
        };
        let raw = |req: String| {
            let host = host.clone();
            async move {
                let Ok(mut s) = tokio::net::TcpStream::connect(host.as_str()).await else { return String::new() };
                let _ = s.write_all(req.as_bytes()).await;
                let mut out = Vec::new();
                let _ = tokio::time::timeout(Duration::from_secs(5), s.read_to_end(&mut out)).await;
                String::from_utf8_lossy(&out).into_owned()
            }
        };
        let ok = raw(format!("GET /healthz HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n")).await;
        assert!(ok.starts_with("HTTP/1.1 200"), "{ok}");
        let none = raw("GET /healthz HTTP/1.0\r\n\r\n".into()).await;
        assert!(none.starts_with("HTTP/1.0 403") || none.starts_with("HTTP/1.1 403"), "{none}");
        let twice = raw(format!("GET /healthz HTTP/1.1\r\nHost: {host}\r\nHost: evil.example\r\nConnection: close\r\n\r\n")).await;
        assert!(twice.starts_with("HTTP/1.1 403") || twice.starts_with("HTTP/1.1 400"), "{twice}");
    }

    #[tokio::test]
    async fn traffic_route_is_authed_get_only_and_truthful_when_empty() {
        use reqwest::Method as M;
        let Some((base, _)) = spawn_app().await else {
            panic!("no listener")
        };
        let c = reqwest::Client::new();
        let url = format!("{base}/api/traffic");
        // no cookie: 401 before anything is read
        let r = c.get(&url).send().await.ok();
        assert_eq!(r.map(|r| r.status().as_u16()), Some(401));
        // cookie GET: 200 JSON, unavailable (temp home has no cache), never a fabricated count
        let r = c
            .get(&url)
            .header("Cookie", "pdeck=tok_test-1")
            .send()
            .await
            .ok();
        assert_eq!(r.as_ref().map(|r| r.status().as_u16()), Some(200));
        let v: Value = match r {
            Some(r) => r.json().await.unwrap_or(Value::Null),
            None => Value::Null,
        };
        assert_eq!(v["status"], "unavailable");
        assert_eq!(v["stale"], true);
        assert_eq!(v["sites"].as_array().map(Vec::len), Some(0));
        // cross-origin state-change guard still applies to the whole /api/ surface
        assert_eq!(
            status(&c, M::POST, &url, &[("Origin", "http://evil.example")]).await,
            403
        );
    }

    #[tokio::test]
    async fn deck_feeds_launch_item_and_login_page() {
        use reqwest::Method as M;
        let Some((base, _)) = spawn_app().await else {
            panic!("no listener")
        };
        let home = std::env::temp_dir().join(format!("pdeck-csrf-{}", std::process::id()));
        let c = reqwest::Client::new();
        // every feed route: authed GET answers 200 JSON; a missing file is an error object
        for d in sources::FEEDS {
            let r = c
                .get(format!("{base}/api/{}", d.name))
                .header("Cookie", "pdeck=tok_test-1")
                .send()
                .await
                .ok();
            assert_eq!(
                r.as_ref().map(|r| r.status().as_u16()),
                Some(200),
                "{}",
                d.name
            );
            let v: Value = match r {
                Some(r) => r.json().await.unwrap_or(Value::Null),
                None => Value::Null,
            };
            assert_eq!(v["error"], "file missing", "{}", d.name);
        }
        // launch-item is POST only and validated against launch.json
        let li = |q: &str| format!("{base}/api/launch-item?{q}");
        assert_eq!(
            status(&c, M::GET, &li("id=skill:x&target=omp"), &[]).await,
            405
        );
        assert_eq!(
            status(&c, M::POST, &li("id=skill:x&target=omp"), &[]).await,
            503
        );
        let _ = std::fs::create_dir_all(home.join(".meshvault/status/deck"));
        let _ = std::fs::write(
            home.join(".meshvault/status/deck/launch.json"),
            r#"{"items":[{"id":"skill:fleet-audit","kind":"skill","targets":["hermes"],"arg":"fleet-audit"}]}"#,
        );
        for q in [
            "id=skill:nope&target=hermes",
            "id=skill:fleet-audit&target=omp",
            "id=skill:fleet-audit;id&target=hermes",
            "id=skill:fleet-audit&target=sh",
        ] {
            assert_eq!(status(&c, M::POST, &li(q), &[]).await, 400, "{q}");
        }
        // a valid item reaches the launcher; the temp home has none, so it fails without running
        let r = c
            .post(li("id=skill:fleet-audit&target=hermes"))
            .header("Cookie", "pdeck=tok_test-1")
            .send()
            .await
            .ok();
        let v: Value = match r {
            Some(r) => r.json().await.unwrap_or(Value::Null),
            None => Value::Null,
        };
        assert_eq!(v["ok"], false);
        // a second launch inside the gap is refused
        assert_eq!(
            status(&c, M::POST, &li("id=skill:fleet-audit&target=hermes"), &[]).await,
            429
        );
        // cross-origin launch is refused before validation
        assert_eq!(
            status(
                &c,
                M::POST,
                &li("id=skill:fleet-audit&target=hermes"),
                &[("Origin", "http://evil.example")]
            )
            .await,
            403
        );
        // no cookie: "/" answers 401 with the token form, the API stays plain 401
        let r = c.get(format!("{base}/")).send().await.ok();
        assert_eq!(r.as_ref().map(|r| r.status().as_u16()), Some(401));
        let body = match r {
            Some(r) => r.text().await.unwrap_or_default(),
            None => String::new(),
        };
        assert!(body.contains("name=\"t\"") && !body.contains("tok_test-1"));
        let r = c
            .get(format!("{base}/apple-touch-icon.png"))
            .send()
            .await
            .ok();
        assert_eq!(r.map(|r| r.status().as_u16()), Some(200));
    }

    async fn get_json(c: &reqwest::Client, url: &str, cookie: bool) -> (u16, Value) {
        let mut r = c.get(url);
        if cookie {
            r = r.header("Cookie", "pdeck=tok_test-1");
        }
        match r.send().await {
            Ok(r) => {
                let code = r.status().as_u16();
                (code, r.json().await.unwrap_or(Value::Null))
            }
            Err(_) => (0, Value::Null),
        }
    }

    #[tokio::test]
    async fn feedback_routes_enforce_csrf_validation_size_and_allowlists() {
        let home=std::env::temp_dir().join(format!("pdeck-feedback-{}",std::process::id()));
        let Some((base, _)) = spawn_app_home(home.clone()).await else { panic!("no listener") };
        let c = reqwest::Client::new();
        for route in ["/api/cron-act?id=deadbeef&act=run", "/api/run-send", "/api/cam-diag"] {
            let Ok(r) = c.post(format!("{base}{route}")).header("Cookie","pdeck=tok_test-1")
                .header("Origin","http://evil.example").send().await else { panic!("feedback POST failed") };
            assert_eq!(r.status().as_u16(),403,"{route}");
            assert_eq!(get_json(&c,&format!("{base}{route}"),true).await.0,405);
        }
        let Ok(()) = std::fs::create_dir_all(home.join(".hermes/cron")) else { panic!("create cron dir") };
        let Ok(()) = std::fs::write(home.join(".hermes/cron/jobs.json"),r#"{"jobs":[{"id":"abcdef0123456789","name":"A","enabled":false,"state":"paused"},{"id":"123456789999","enabled":true}]}"#) else { panic!("write cron fixture") };
        let p=|route:&str| c.post(format!("{base}{route}")).header("Cookie","pdeck=tok_test-1");
        for (route,want) in [
            ("/api/cron-act?id=ABCDEF01&act=run",400),
            ("/api/cron-act?id=abcdef01&act=wrong",400),
            ("/api/cron-act?id=deadbeef&act=run",404),
            ("/api/cron-act?id=abcdef01&act=pause",409),
            ("/api/cron-act?id=12345678&act=resume",409),
        ] {
            let Ok(resp) = p(route).send().await else { panic!("cron-act send failed") };
            assert_eq!(resp.status().as_u16(),want,"{route}");
        }
        for (body,want) in [
            (json!({"text":"  "}),400),
            (json!({"text":"a\u{0001}"}),400),
            (json!({"text":"hello","run_id":"a/b"}),400),
            (json!({"text":"hello","run_id":"run_unknown"}),404),
        ] {
            let Ok(resp) = p("/api/run-send").json(&body).send().await else { panic!("run-send send failed") };
            assert_eq!(resp.status().as_u16(),want);
        }
        let Ok(resp) = p("/api/run-send").body("a".repeat(8193)).send().await else { panic!("oversize run-send failed") };
        assert_eq!(resp.status().as_u16(),413);
        let Ok(resp) = p("/api/cam-diag").body("a".repeat(2049)).send().await else { panic!("oversize cam-diag failed") };
        assert_eq!(resp.status().as_u16(),413);
        let Ok(resp) = p("/api/cam-diag").json(&json!({"e":"BAD","cam":0,"mode":"boot","d":{}})).send().await else { panic!("bad cam-diag failed") };
        assert_eq!(resp.status().as_u16(),400);
        assert_eq!(get_json(&c,&format!("{base}/api/unit?name=bogus"),true).await.0,400);
        assert_eq!(get_json(&c,&format!("{base}/api/unit?name=missing.service"),true).await.0,404);
    }

    #[tokio::test]
    async fn v8_routes_crons_fleet_board_and_run_panel() {
        use reqwest::Method as M;
        use std::os::unix::fs::PermissionsExt;
        // its own home: this test writes launch.json, and deck_feeds_launch_item_and_login_page needs that file missing
        let home = std::env::temp_dir().join(format!("pdeck-v8-{}", std::process::id()));
        let Some((base, _)) = spawn_app_home(home.clone()).await else {
            panic!("no listener")
        };
        let c = reqwest::Client::new();
        // all four are cookie-only: 401 without it, POST refused (cross-origin 403, same-origin 405)
        for r in ["crons", "fleet-board", "run?id=run_1", "run-last"] {
            let url = format!("{base}/api/{r}");
            assert_eq!(get_json(&c, &url, false).await.0, 401, "{r}");
            assert_eq!(
                status(&c, M::POST, &url, &[("Origin", "http://evil.example")]).await,
                403,
                "{r} csrf"
            );
            assert_eq!(status(&c, M::POST, &url, &[]).await, 405, "{r} post");
        }
        // crons: only the allowed fields leave (the missing-file error object is covered in crons.rs)
        let _ = std::fs::create_dir_all(home.join(".hermes/cron"));
        let _ = std::fs::write(
            home.join(".hermes/cron/jobs.json"),
            r#"{"jobs":[{"id":"abcdef0123456789","name":"J","prompt":"TOPSECRET","script":"s.py","provider":"anthropic","model":"claude-x","schedule_display":"every 1h","enabled":true,"state":"scheduled","last_status":"ok","next_run_at":"2026-10-01T20:00:00-07:00"}]}"#,
        );
        let (code, v) = get_json(&c, &format!("{base}/api/crons"), true).await;
        assert_eq!(code, 200);
        assert_eq!(v["counts"]["active"], 1);
        assert_eq!(v["active"][0]["id"], "abcdef01");
        assert_eq!(v["active"][0]["lane"], "CLAUDE");
        assert!(!v.to_string().contains("TOPSECRET") && !v.to_string().contains("s.py"));
        // fleet board: every source reports itself, none invents a number
        let (code, v) = get_json(&c, &format!("{base}/api/fleet-board"), true).await;
        assert_eq!(code, 200);
        for k in ["machines", "cluster", "models", "backup", "units"] {
            assert!(v.get(k).is_some(), "{k}");
        }
        assert_eq!(v["models"]["error"], "file missing");
        assert_eq!(v["units"]["error"], "file missing");
        // run panel: no launch log -> nothing is served and nothing is run
        let (code, _) = get_json(&c, &format!("{base}/api/run-last"), true).await;
        assert_eq!(code, 404);
        let (code, v) = get_json(&c, &format!("{base}/api/run?id=run_1"), true).await;
        assert_eq!((code, v["error"].as_str()), (404, Some("unknown run")));
        for bad in ["", "a;id", "../x", "a%20b"] {
            let (code, _) = get_json(&c, &format!("{base}/api/run?id={bad}"), true).await;
            assert_eq!(code, 400, "{bad:?}");
        }
        // launched run + a fake deck-launch that prints a status line
        let _ = std::fs::create_dir_all(home.join(".local/state/pixel-deck"));
        let _ = std::fs::create_dir_all(home.join("ops/bin"));
        let _ = std::fs::write(
            home.join(".local/state/pixel-deck/launch.jsonl"),
            "{\"id\":\"skill:x\",\"ok\":true,\"run_id\":\"run_1\",\"t\":1790895000,\"target\":\"hermes\"}\n",
        );
        let script = home.join("ops/bin/deck-launch");
        let _ = std::fs::write(
            &script,
            "#!/bin/sh\n[ \"$1\" = status ] && [ \"$2\" = run_1 ] || exit 2\necho '{\"ok\":true,\"run_id\":\"run_1\",\"state\":\"running\",\"elapsed_s\":3.5,\"lines\":[\"tool a: b\"]}'\n",
        );
        let _ = std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700));
        let (code, v) = get_json(&c, &format!("{base}/api/run-last"), true).await;
        assert_eq!((code, v["run_id"].as_str()), (200, Some("run_1")));
        let (code, v) = get_json(&c, &format!("{base}/api/run?id=run_1"), true).await;
        assert_eq!(code, 200);
        assert_eq!(
            (v["state"].as_str(), v["item"].as_str()),
            (Some("running"), Some("skill:x"))
        );
        assert_eq!(v["lines"][0], "tool a: b");
        // an id the deck never launched is refused even though the script would answer
        let (code, _) = get_json(&c, &format!("{base}/api/run?id=run_2"), true).await;
        assert_eq!(code, 404);
        // OMP is retired at the HTTP edge too
        let Ok(()) = std::fs::create_dir_all(home.join(".meshvault/status/deck")) else { panic!("create deck status dir") };
        let Ok(()) = std::fs::write(home.join(".meshvault/status/deck/launch.json"),
            r#"{"items":[{"id":"skill:fleet-audit","kind":"skill","targets":["hermes"],"arg":"fleet-audit"}]}"#) else { panic!("write launch fixture") };
        let li = format!("{base}/api/launch-item?id=skill:fleet-audit&target=omp");
        assert_eq!(status(&c, M::POST, &li, &[]).await, 400);
    }

    #[tokio::test]
    async fn v9_ecom_route_missing_fresh_and_stale() {
        use reqwest::Method as M;
        let root = std::env::temp_dir().join(format!("pdeck-ecom-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let now = util::now_epoch();
        let body = |age: u64| {
            format!(
                r#"{{"v":1,"t":{},"refresh":3600,"src":["shoptrends sqlite"],"errors":[],"coverage":{{"days":3,"shops":null,"sites":[]}},"watch":[{{"slug":"w","query":"w","median":10.5,"chg30":null}}],"movers":[],"deals":[],"macro":[]}}"#,
                now - age
            )
        };
        // three separate temp homes so the 60 s feed cache cannot hide a state change
        let mut seen = vec![];
        for (name, file) in [("missing", None), ("fresh", Some(60)), ("stale", Some(7300))] {
            let home = root.join(name);
            if let Some(age) = file {
                let _ = std::fs::create_dir_all(home.join(".meshvault/status/house-feeds"));
                let _ = std::fs::write(home.join(".meshvault/status/house-feeds/ecom.json"), body(age));
            }
            let Some((base, _)) = spawn_app_home(home).await else {
                panic!("no listener")
            };
            let c = reqwest::Client::new();
            let url = format!("{base}/api/ecom");
            // cookie only, GET only
            assert_eq!(get_json(&c, &url, false).await.0, 401, "{name} no cookie");
            assert_eq!(
                status(&c, M::POST, &url, &[("Origin", "http://evil.example")]).await,
                403,
                "{name} csrf"
            );
            // same-origin POST is not a route (400, like every other feed); it never serves the file
            assert_eq!(status(&c, M::POST, &url, &[]).await, 400, "{name} post");
            let (code, v) = get_json(&c, &url, true).await;
            assert_eq!(code, 200, "{name}");
            seen.push(v);
        }
        assert_eq!(seen[0]["error"], "file missing");
        assert_eq!(seen[0]["stale"], true);
        assert!(seen[0].get("watch").is_none());
        assert!(seen[1].get("error").is_none());
        assert_eq!(seen[1]["stale"], false);
        assert_eq!(seen[1]["watch"][0]["median"], 10.5);
        assert_eq!(seen[1]["watch"][0]["chg30"], Value::Null);
        assert_eq!(seen[1]["coverage"]["shops"], Value::Null);
        assert_eq!(seen[2]["stale"], true);
        assert_eq!(seen[2]["watch"][0]["median"], 10.5, "stale rows still served");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn ecom_market_route_is_owner_only_and_keeps_every_row() {
        use reqwest::Method as M;
        let root = std::env::temp_dir().join(format!("pdeck-ecom-market-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        // no file: a clear not-reporting state, never a 5xx
        let Some((base, _)) = spawn_app_guest(root.join("missing"), Some(GTOK)).await else { panic!("no listener") };
        let c = reqwest::Client::new();
        let (code, body, _) = call(&c, M::GET, &format!("{base}/api/ecom-market"), Some("tok_test-1")).await;
        let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
        assert_eq!((code, v["error"].as_str(), v["stale"].as_bool()), (200, Some("file missing"), Some(true)));
        // a real-shaped file with more rows than the generic feed cap
        let home = root.join("fresh");
        let _ = std::fs::create_dir_all(home.join(".meshvault/status/house-feeds"));
        let rows: Vec<Value> = (0..320).map(|i| json!({"gid": format!("steam:{i}"), "kind": "on_sale", "change_pct": -20.0})).collect();
        let file = json!({"v": 1, "t": util::now_epoch() - 60, "refresh": 3600, "movers": rows, "coverage": {"ok": 30, "needs_key": 6},
                          "sources": [{"id": "ebay_browse", "status": "needs_key"}], "secret_dump": "DO_NOT_SERVE"});
        let _ = std::fs::write(home.join(ecom_market::REL), file.to_string());
        let Some((base, _)) = spawn_app_guest(home, Some(GTOK)).await else { panic!("no listener") };
        let u = format!("{base}/api/ecom-market");
        let (code, body, _) = call(&c, M::GET, &u, Some("tok_test-1")).await;
        let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
        assert_eq!(code, 200);
        assert_eq!(v["movers"].as_array().map(Vec::len), Some(320));
        assert_eq!((v["stale"].as_bool(), v["coverage"]["needs_key"].as_u64()), (Some(false), Some(6)));
        assert!(!body.contains("DO_NOT_SERVE"));
        // the household guest, a desk viewer and no cookie are refused; POST is not a route
        assert_eq!(call(&c, M::GET, &u, Some(GTOK)).await.0, 403);
        assert_eq!(call(&c, M::GET, &u, Some(&["cre_", "view-3"].concat())).await.0, 403);
        assert_eq!(call(&c, M::GET, &u, None).await.0, 401);
        assert_eq!(status(&c, M::POST, &u, &[]).await, 400);
        let _ = std::fs::remove_dir_all(&root);
    }

    // obviously fake round numbers; none of the probes may appear in /api/finance
    const FIN_PROBES: [&str; 5] = ["424242", "313131", "919191", "565656", "777777"];
    fn fin_file(age: u64) -> String {
        format!(
            r#"{{"v":1,"t":{},"refresh":3600,"src":["finance-master ledger (sample)"],"errors":[],"sample":true,
            "inventory":{{"installed":190,"finance_related":14,"covered":2,"src":"iphone_apps cache","t":1790700000}},
            "apps":[{{"id":"coinbase","name":"Coinbase","kind":"crypto","route":"iphone_screen","status":"ok","last_ok":{},"balance_usd":777777.77,
              "values":{{"balance_usd":424242.42,"as_of":{},"items":[{{"label":"BTC","usd":313131.31}}]}}}},
             {{"id":"fidelity","name":"Fidelity","kind":"brokerage","route":"iphone_screen","status":"never","last_ok":null,"values":null}}],
            "totals":{{"net_usd":565656.56,"by_kind":{{"crypto":919191.91}},"apps_ok":1,"apps":2}}}}"#,
            util::now_epoch() - age,
            util::now_epoch() - age,
            util::now_epoch() - age
        )
    }

    async fn fin_get(
        c: &reqwest::Client,
        url: &str,
        hdrs: &[(&str, &str)],
    ) -> (u16, Option<String>, String) {
        let mut r = c.get(url);
        for (k, v) in hdrs {
            r = r.header(*k, *v);
        }
        match r.send().await {
            Ok(r) => {
                let code = r.status().as_u16();
                let cc = r
                    .headers()
                    .get("cache-control")
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_string);
                (code, cc, r.text().await.unwrap_or_default())
            }
            Err(_) => (0, None, String::new()),
        }
    }

    #[tokio::test]
    async fn v9_finance_routes_strip_values_and_gate_the_amounts() {
        use reqwest::Method as M;
        let root = std::env::temp_dir().join(format!("pdeck-fin-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let cookie = [("Cookie", "pdeck=tok_test-1")];
        let mut seen = vec![];
        for (name, file) in [("missing", None), ("fresh", Some(60)), ("stale", Some(7300))] {
            let home = root.join(name);
            if let Some(age) = file {
                let _ = std::fs::create_dir_all(home.join(".meshvault/status/deck"));
                let _ = std::fs::write(home.join(".meshvault/status/deck/finance.json"), fin_file(age));
            }
            let Some((base, host)) = spawn_app_home(home).await else {
                panic!("no listener")
            };
            let c = reqwest::Client::new();
            let (pu, va) = (format!("{base}/api/finance"), format!("{base}/api/finance-values"));
            for url in [&pu, &va] {
                // cookie only: nothing without it, and never via the ?t= token
                assert_eq!(fin_get(&c, url, &[]).await.0, 401, "{name} {url} no cookie");
                let q = format!("{url}?t=tok_test-1");
                assert_eq!(fin_get(&c, &q, &[]).await.0, 401, "{name} {url} ?t=");
                assert_eq!(fin_get(&c, url, &[("Cookie", "pdeck=wrong")]).await.0, 401);
                // GET only: cross-origin POST is 403 (csrf gate), same-origin POST/PUT/DELETE are 405
                assert_eq!(
                    status(&c, M::POST, url, &[("Origin", "http://evil.example")]).await,
                    403
                );
                for m in [M::POST, M::PUT, M::DELETE] {
                    assert_eq!(status(&c, m, url, &[("Origin", &format!("http://{host}"))]).await, 405, "{name} {url}");
                }
                // a page on another origin or site cannot use the cookie against it
                for site in ["cross-site", "same-site"] {
                    let h = [cookie[0], ("Sec-Fetch-Site", site)];
                    assert_eq!(fin_get(&c, url, &h).await.0, 403, "{site}");
                }
                let h = [cookie[0], ("Sec-Fetch-Site", "same-origin")];
                assert_eq!(fin_get(&c, url, &h).await.0, 200);
            }
            let (c1, cc1, public) = fin_get(&c, &pu, &cookie).await;
            let (c2, cc2, values) = fin_get(&c, &va, &cookie).await;
            assert_eq!((c1, c2), (200, 200), "{name}");
            assert_eq!(cc1.as_deref(), Some("no-store"), "{name} /api/finance");
            assert_eq!(cc2.as_deref(), Some("no-store"), "{name} /api/finance-values");
            seen.push((
                serde_json::from_str::<Value>(&public).unwrap_or(Value::Null),
                serde_json::from_str::<Value>(&values).unwrap_or(Value::Null),
                public,
            ));
        }
        // missing file: one error object each, no data
        assert_eq!(seen[0].0["error"], "file missing");
        assert_eq!(seen[0].1["error"], "file missing");
        assert_eq!(seen[0].0["stale"], true);
        // fresh: statuses only on /api/finance, the amounts only on /api/finance-values
        let (p, v, raw) = (&seen[1].0, &seen[1].1, &seen[1].2);
        for probe in FIN_PROBES {
            assert!(!raw.contains(probe), "{probe} leaked into /api/finance");
        }
        for key in ["values", "totals", "balance_usd", "net_usd", "by_kind"] {
            assert!(!raw.contains(&format!("\"{key}\"")), "{key}");
        }
        assert_eq!((p["stale"].clone(), p["sample"].clone()), (json!(false), json!(true)));
        assert_eq!(p["inventory"]["installed"], 190);
        assert_eq!(p["apps"][0]["status"], "ok");
        assert_eq!(p["apps"][0]["has_values"], true);
        assert_eq!(p["apps"][1]["status"], "never");
        assert_eq!(p["has_totals"], true);
        assert_eq!(v["apps"]["coinbase"]["balance_usd"], 424242.42);
        assert_eq!(v["totals"]["net_usd"], 565656.56);
        // stale file: still served, flagged
        assert_eq!(seen[2].0["stale"], true);
        assert_eq!(seen[2].0["apps"][0]["id"], "coinbase");
        // the generic feed route does not know finance: it is not a v6 feed
        let home = root.join("fresh");
        let Some((base, _)) = spawn_app_home(home).await else {
            panic!("no listener")
        };
        let (code, _, body) = fin_get(&reqwest::Client::new(), &format!("{base}/api/finance/"), &cookie).await;
        assert_eq!(code, 405); // unknown GET routes fall through to "POST required"
        assert!(!body.contains("424242"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn commerce_route_has_the_money_gate() {
        use reqwest::Method as M;
        let home = std::env::temp_dir().join(format!("pdeck-commerce-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::create_dir_all(home.join(".hermes/watcher-state"));
        let _ = std::fs::write(
            home.join(".hermes/watcher-state/purchases-ledger.json"),
            r#"{"purchases":[{"id":"g1","thread_id":"T2","account":"tanner","vendor":"Amazon","amount":19.99,"currency":"USD",
            "subject":"Shipped: \"USB-C cable\"","received_at":"2026-10-02T10:00:00Z"}],"last_run_at":"2026-10-21T12:42:27Z"}"#,
        );
        let Some((base, host)) = spawn_app_home(home.clone()).await else {
            panic!("no listener")
        };
        let c = reqwest::Client::new();
        let url = format!("{base}/api/commerce");
        let cookie = ("Cookie", "pdeck=tok_test-1");
        // owner cookie only: nothing without it, a wrong one, or the ?t= token (with or without a cross-site header)
        assert_eq!(fin_get(&c, &url, &[]).await.0, 401, "no cookie");
        assert_eq!(fin_get(&c, &url, &[("Cookie", "pdeck=wrong")]).await.0, 401, "wrong cookie");
        let q = format!("{url}?t=tok_test-1");
        assert_eq!(fin_get(&c, &q, &[]).await.0, 401, "?t=");
        assert_eq!(fin_get(&c, &q, &[("Sec-Fetch-Site", "same-origin")]).await.0, 401, "?t= same-origin");
        let (code, _, body) = fin_get(&c, &q, &[("Sec-Fetch-Site", "cross-site")]).await;
        assert!(code == 401 || code == 403, "?t= cross-site answered {code}");
        assert!(!body.contains("19.99"), "?t= leaked an amount");
        // a page on another origin or site cannot use the cookie against it
        for site in ["cross-site", "same-site"] {
            let (code, _, body) = fin_get(&c, &url, &[cookie, ("Sec-Fetch-Site", site)]).await;
            assert_eq!(code, 403, "{site}");
            assert!(!body.contains("19.99"), "{site} leaked an amount");
        }
        // GET only: cross-origin POST is 403 (csrf gate), same-origin POST/PUT/DELETE are 405
        assert_eq!(status(&c, M::POST, &url, &[("Origin", "http://evil.example")]).await, 403);
        for m in [M::POST, M::PUT, M::DELETE] {
            assert_eq!(status(&c, m, &url, &[("Origin", &format!("http://{host}"))]).await, 405);
        }
        // same-origin (and a header-less same-origin fetch) with the owner cookie is served, no-store
        for h in [vec![cookie, ("Sec-Fetch-Site", "same-origin")], vec![cookie]] {
            let (code, cc, body) = fin_get(&c, &url, &h).await;
            assert_eq!(code, 200, "{h:?}");
            assert_eq!(cc.as_deref(), Some("no-store"));
            let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
            assert_eq!(v["orders"][0]["amount"], 19.99, "{body}");
            assert!(!body.contains("T2"), "thread id leaked");
        }
        let _ = std::fs::remove_dir_all(&home);
    }

    /// v10 Invest tab: `/api/portfolio` and `/api/markets` are generic feeds, so they must never carry an amount; the
    /// amounts are only on `/api/portfolio-values`, behind the same cookie-only, same-origin, GET-only gate as the finance values.
    #[tokio::test]
    async fn v10_invest_routes_split_prices_from_amounts() {
        use reqwest::Method as M;
        let root = std::env::temp_dir().join(format!("pdeck-inv-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let cookie = [("Cookie", "pdeck=tok_test-1")];
        let now = util::now_epoch();
        let public = format!(
            r#"{{"t":{now},"refresh":300,"src":["sample"],"errors":[],"basis":{{"equity_qty_age_days":7,"crypto_live":true}},
            "totals":{{"day_pct":-1.5,"positions":1,"priced":1,"margin_in_use":true}},
            "positions":[{{"symbol":"AAA","kind":"equity","name":"Alpha","price":100.0,"chg":-1.0,"pct":-0.99,"t":{now}}}],
            "qty":424242,"positions_usd":313131,"api_key":"sk-leak"}}"#
        );
        let values = format!(
            r#"{{"t":{now},"refresh":300,"src":["sample"],"errors":[],"basis":{{"equity_qty_as_of":1}},
            "totals":{{"positions_usd":919191.0,"net_est_usd":777777.0}},
            "positions":[{{"symbol":"AAA","qty":565656.0,"value":424242.0,"day_chg":-1000.0}}],"token":"leak"}}"#
        );
        let markets = format!(
            r#"{{"t":{now},"refresh":300,"src":["sample"],"errors":[],"session":{{"state":"closed"}},"headline":"Closed.",
            "board":[{{"id":"spy","price":774.83,"pct":0.67}}],"watchlist":[],"movers":{{"gainers":[],"losers":[]}},"catalysts":[],"secret":"x"}}"#
        );
        let home = root.join("home");
        let dir = home.join(".meshvault/status/deck");
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(dir.join("portfolio.json"), public);
        let _ = std::fs::write(dir.join("portfolio-values.json"), values);
        // markets moved to house-feeds (deck-feed-markets writes there every five minutes)
        let house = home.join(".meshvault/status/house-feeds");
        let _ = std::fs::create_dir_all(&house);
        let _ = std::fs::write(house.join("markets.json"), markets);
        let Some((base, host)) = spawn_app_home(home).await else {
            panic!("no listener")
        };
        let c = reqwest::Client::new();
        let (pu, va, mk) = (
            format!("{base}/api/portfolio"),
            format!("{base}/api/portfolio-values"),
            format!("{base}/api/markets"),
        );
        // the public feed: cookie needed, no amount, no unlisted key, no credential-shaped key
        assert_eq!(fin_get(&c, &pu, &[]).await.0, 401);
        let (code, cc, body) = fin_get(&c, &pu, &cookie).await;
        assert_eq!(code, 200);
        assert_eq!(cc.as_deref(), Some("no-store"));
        for probe in ["424242", "313131", "919191", "777777", "565656", "sk-leak", "\"qty\"", "positions_usd"] {
            assert!(!body.contains(probe), "{probe} in /api/portfolio");
        }
        let Ok(v) = serde_json::from_str::<Value>(&body) else { panic!("portfolio body is not JSON") };
        assert_eq!(v["totals"]["day_pct"], -1.5);
        assert_eq!(v["positions"][0]["symbol"], "AAA");
        assert_eq!(v["stale"], false);
        // markets: contract keys only
        let (code, _, body) = fin_get(&c, &mk, &cookie).await;
        assert_eq!(code, 200);
        let Ok(v) = serde_json::from_str::<Value>(&body) else { panic!("markets body is not JSON") };
        assert_eq!(v["headline"], "Closed.");
        assert_eq!(v["board"][0]["price"], 774.83);
        assert!(v.get("secret").is_none());
        // the values route: same gate as /api/finance-values
        assert_eq!(fin_get(&c, &va, &[]).await.0, 401, "no cookie");
        assert_eq!(fin_get(&c, &format!("{va}?t=tok_test-1"), &[]).await.0, 401, "?t=");
        assert_eq!(fin_get(&c, &va, &[("Cookie", "pdeck=wrong")]).await.0, 401);
        assert_eq!(status(&c, M::POST, &va, &[("Origin", "http://evil.example")]).await, 403);
        for m in [M::POST, M::PUT, M::DELETE] {
            assert_eq!(status(&c, m, &va, &[("Origin", &format!("http://{host}"))]).await, 405);
        }
        for site in ["cross-site", "same-site"] {
            assert_eq!(fin_get(&c, &va, &[cookie[0], ("Sec-Fetch-Site", site)]).await.0, 403, "{site}");
        }
        let (code, cc, body) = fin_get(&c, &va, &[cookie[0], ("Sec-Fetch-Site", "same-origin")]).await;
        assert_eq!((code, cc.as_deref()), (200, Some("no-store")));
        let Ok(v) = serde_json::from_str::<Value>(&body) else { panic!("values body is not JSON") };
        assert_eq!(v["totals"]["positions_usd"], 919191.0);
        assert_eq!(v["positions"][0]["value"], 424242.0);
        assert!(v.get("token").is_none());
        // no file: an error object on the values route, never a 5xx and never data
        let _ = std::fs::remove_file(root.join("home/.meshvault/status/deck/portfolio-values.json"));
        let (code, _, body) = fin_get(&c, &va, &cookie).await;
        assert_eq!(code, 200);
        let Ok(v) = serde_json::from_str::<Value>(&body) else { panic!("error body is not JSON") };
        assert_eq!(v["error"], "file missing");
        assert!(!body.contains("919191"));
        let _ = std::fs::remove_dir_all(&root);
    }

    // ---- guest principal (owner 2026-10-13) ----
    const GTOK: &str = "gst_test-2";

    /// (status, body, set-cookie) for one request; `cookie` is the pdeck value to send, if any.
    async fn call(
        c: &reqwest::Client,
        m: reqwest::Method,
        url: &str,
        cookie: Option<&str>,
    ) -> (u16, String, Option<String>) {
        let mut r = c.request(m, url);
        if let Some(k) = cookie {
            r = r.header("Cookie", format!("pdeck={k}"));
        }
        match r.send().await {
            Ok(r) => {
                let code = r.status().as_u16();
                let sc = r
                    .headers()
                    .get("set-cookie")
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_string);
                (code, r.text().await.unwrap_or_default(), sc)
            }
            Err(_) => (0, String::new(), None),
        }
    }

    #[tokio::test]
    async fn desk_viewer_sees_only_its_own_desk() {
        use reqwest::Method as M;
        let home = std::env::temp_dir().join(format!("pdeck-crev-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::create_dir_all(home.join(".meshvault/status/deck"));
        let _ = std::fs::write(home.join(cre::DEALS_REL), r#"{"generated_at":1794000000,"deals":[{"id":"0123456789ab","type":"Industrial","price":1}]}"#);
        let Some((base, host)) = spawn_app_guest(home.clone(), Some(GTOK)).await else { panic!("no listener") };
        let c = reqwest::Client::new();
        let u = |p: &str| format!("{base}{p}");
        let vt = ["cre_", "view-3"].concat();
        let (code, body, _) = call(&c, M::GET, &u("/api/whoami"), Some(&vt)).await;
        assert_eq!((code, body.as_str()), (200, r#"{"person":"jordan","role":"viewer"}"#));
        // "/" and "/cre" are the desk page for a viewer; the deck page is the owner's
        let (code, body, _) = call(&c, M::GET, &u("/"), Some(&vt)).await;
        assert!(code == 200 && body.contains("cre.js") && body.contains("<script src=\"/cre-boot.js\">") && !body.contains("<script>"), "{code}");
        // the desk's start-up script is a served file, so the page needs no inline script (X1)
        let (code, body, _) = call(&c, M::GET, &u("/cre-boot.js"), Some(&vt)).await;
        assert!(code == 200 && body.contains("creMount("), "{code}");
        let (_, body, _) = call(&c, M::GET, &u("/"), Some("tok_test-1")).await;
        assert!(!body.contains("id=\"cre-root\""));
        // the desk is Jordan's whatever the query says, without the list of other desks
        let (code, body, _) = call(&c, M::GET, &u("/api/cre?person=riley"), Some(&vt)).await;
        let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
        assert_eq!((code, v["person"].as_str(), v["viewer"].as_bool()), (200, Some("jordan"), Some(true)));
        assert!(v.get("people").is_none() && v.get("boxes_of").is_none() && v["deals"][0]["id"] == "0123456789ab");
        // every other route is refused, the guest's included
        for p in ["/api/realestate", "/api/today", "/api/keys", "/api/housing/profile", "/api/saved-jobs?person=tanner", "/pad?target=Dell"] {
            assert_eq!(call(&c, M::GET, &u(p), Some(&vt)).await.0, 403, "{p}");
        }
        // writes: own desk only, same-origin JSON, never via ?t=
        let own = format!("http://{host}");
        let post = |b: &'static str, ck: String| {
            c.post(u("/api/cre")).header("Cookie", format!("pdeck={ck}")).header("Origin", own.as_str()).header("Content-Type", "application/json").body(b).send()
        };
        let r = post(r#"{"person":"riley","op":"delete","id":"ind-ie"}"#, vt.clone()).await.map(|r| r.status().as_u16()).unwrap_or(0);
        assert_eq!(r, 403, "a viewer never edits another desk");
        let r = post(r#"{"person":"jordan","op":"box","box":{"id":"mf-10","name":"10+ units","f":{"types":["Multifamily"],"units_min":10}}}"#, vt.clone()).await;
        let v: Value = match r { Ok(r) => r.json().await.unwrap_or(Value::Null), Err(_) => Value::Null };
        assert_eq!(v["ok"], true, "{v}");
        assert!(home.join(cre::REL).is_file());
        assert_eq!(c.post(u(&format!("/api/cre?t={vt}"))).header("Origin", own.as_str()).header("Content-Type", "application/json")
            .body(r#"{"person":"jordan","op":"delete","id":"mf-10"}"#).send().await.map(|r| r.status().as_u16()).unwrap_or(0), 401);
        // the owner reads any desk and gets the list of desks; the household guest gets none
        let (code, body, _) = call(&c, M::GET, &u("/api/cre?person=riley"), Some("tok_test-1")).await;
        let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
        assert_eq!((code, v["person"].as_str(), v["people"].as_array().map(Vec::len)), (200, Some("riley"), Some(3)));
        assert_eq!(v["boxes_of"]["jordan"][0]["id"], "mf-core", "the owner's co-invest view reads the other desks' buy boxes");
        assert!(v["boxes_of"]["riley"].is_array() && v["boxes_of"]["jordan"].get("seen").is_none());
        assert_eq!(call(&c, M::GET, &u("/api/cre"), Some(GTOK)).await.0, 403);
        assert_eq!(call(&c, M::GET, &u("/cre"), Some(GTOK)).await.0, 403);
        let _ = std::fs::remove_dir_all(&home);
    }

    /// Apps and models by machine (owner sweep, restored 2026-11-15): guest and desk viewer are refused on every method, and every
    /// owner refusal here answers before a probe, a gateway door or a ModelDeck read, so this test touches nothing on the computer.
    #[tokio::test]
    async fn apps_and_models_are_the_owners_and_the_swap_is_not_a_route() {
        use reqwest::Method as M;
        let home = std::env::temp_dir().join(format!("pdeck-appsmodels-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let Some((base, _)) = spawn_app_guest(home.clone(), Some(GTOK)).await else { panic!("no listener") };
        let c = reqwest::Client::new();
        let u = |p: &str| format!("{base}{p}");
        let vt = ["cre_", "view-3"].concat();
        for (m, p) in [(M::GET, "/api/apps"), (M::POST, "/api/apps/wake?id=almanac"), (M::GET, "/api/models"), (M::POST, "/api/models")] {
            assert_eq!(call(&c, m.clone(), &u(p), Some(GTOK)).await.0, 403, "guest {m} {p}");
            assert_eq!(call(&c, m.clone(), &u(p), Some(&vt)).await.0, 403, "viewer {m} {p}");
            assert_eq!(call(&c, m.clone(), &u(p), None).await.0, 401, "nobody {m} {p}");
        }
        assert_eq!(call(&c, M::GET, &u(&format!("/api/apps?t={GTOK}")), None).await.0, 403, "guest ?t=");
        assert_eq!(call(&c, M::GET, &u(&format!("/api/models?t={vt}")), None).await.0, 403, "viewer ?t=");
        // Wake: the owner cookie only, POST only, an app in the catalog, and only one that sleeps until used
        let own = Some("tok_test-1");
        assert_eq!(call(&c, M::POST, &u("/api/apps/wake?id=almanac&t=tok_test-1"), None).await.0, 403, "owner ?t=");
        assert_eq!(call(&c, M::GET, &u("/api/apps/wake?id=almanac"), own).await.0, 405);
        for (id, want) in [("", 400), ("..%2Fx", 400), ("nope", 404), ("modeldeck", 404), ("deals", 409)] {
            assert_eq!(call(&c, M::POST, &u(&format!("/api/apps/wake?id={id}")), own).await.0, want, "wake {id}");
        }
        let log = std::fs::read_to_string(home.join(".local/state/pixel-deck/actions.jsonl")).unwrap_or_default();
        assert_eq!(log.lines().filter(|l| l.contains(r#""act":"wake""#) && l.contains(r#""ok":false"#)).count(), 5, "{log}");
        // the model swap is not ported: no route answers it, and neither list takes a POST
        for p in ["/api/models/swap-review", "/api/models/swap-commit", "/api/models/swap", "/api/models", "/api/apps"] {
            assert_eq!(call(&c, M::POST, &u(p), own).await.0, 400, "{p}");
        }
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn guest_cookie_gets_the_allowlist_and_nothing_else() {
        use reqwest::Method as M;
        let home = std::env::temp_dir().join(format!("pdeck-guest-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::create_dir_all(&home);
        // base = home: the repo's keys.json, so key indexes match the real deck
        let Ok(()) = std::fs::write(home.join("keys.json"), include_str!("../../keys.json")) else {
            panic!("write keys.json")
        };
        let Some((base, _)) = spawn_app_guest(home.clone(), Some(GTOK)).await else {
            panic!("no listener")
        };
        let c = reqwest::Client::new();
        let u = |p: &str| format!("{base}{p}");
        let keys = hosts::load_keys(&home).await;
        let idx = |a: &str, g: &str| {
            keys.iter()
                .position(|k| k["action"] == a && k["arg"] == g)
                .unwrap_or(usize::MAX)
        };
        let (mute, lock, hermes, term) = (idx("mute", ""), idx("lock", ""), idx("launch", "hermes"), idx("launch", "terminal"));
        assert!(mute < 99 && lock < 99 && hermes < 99 && term < 99, "keys.json fixture changed");
        let (water, tvpow, status) =
            (idx("ha-script", "stop_all_watering"), idx("ha-script", "living_tv_power"), idx("ha-script", "house_status_to_phone"));
        assert!(water < 99 && tvpow < 99 && status < 99, "house keys missing from keys.json");

        // whoami names the principal
        let (code, body, _) = call(&c, M::GET, &u("/api/whoami"), Some(GTOK)).await;
        assert_eq!((code, body.as_str()), (200, r#"{"role":"guest"}"#));
        let (code, body, _) = call(&c, M::GET, &u("/api/whoami"), Some("tok_test-1")).await;
        assert_eq!((code, body.as_str()), (200, r#"{"role":"owner"}"#));

        // allowed reads that run no helper: 200
        for p in ["/", "/theme.css", "/api/hosts", "/api/camkey", "/api/pad-targets", "/api/keys"] {
            assert_eq!(call(&c, M::GET, &u(p), Some(GTOK)).await.0, 200, "{p}");
        }
        let (_, body, _) = call(&c, M::GET, &u("/api/pad-targets"), Some(GTOK)).await;
        assert_eq!(body, r#"{"targets":["pc-desktop","Dell"]}"#);
        let (_, body, _) = call(&c, M::GET, &u("/api/keys"), Some(GTOK)).await;
        let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
        let ks = v["keys"].as_array().cloned().unwrap_or_default();
        assert!(!ks.is_empty() && ks.iter().all(|k| k["i"].is_u64()));
        for k in &ks {
            assert!(guest::action_ok(k["action"].as_str().unwrap_or(""), k["arg"].as_str().unwrap_or("")), "{k}");
            let i = k["i"].as_u64().unwrap_or(999) as usize;
            assert_eq!(keys.get(i).map(|o| &o["label"]), Some(&k["label"]), "index points at the same macro");
        }
        assert!(!body.contains("\"lock\"") && !body.contains("\"screenshot\"") && !body.contains("hermes"));
        // house scripts are owner-only: a guest never sees one
        assert!(!body.contains("ha-script") && !body.contains("watering"), "{body}");

        // allowed routes pass the gate and stop in the handler: host=nohost is "bad host" (400), so nothing runs
        for (m, p) in [
            (M::GET, "/api/media?host=nohost".to_string()),
            (M::GET, "/api/vol?host=nohost".into()),
            (M::GET, "/api/ws-now?host=nohost".into()),
            (M::GET, "/api/ws-list?host=nohost".into()),
            (M::GET, "/api/ping?host=nohost".into()),
            (M::GET, "/api/stats?host=nohost".into()),
            (M::GET, "/api/cam?e=bogus".into()),
            (M::POST, "/api/media-act?v=next&host=nohost".into()),
            (M::POST, "/api/vol-set?v=30&host=nohost".into()),
            (M::POST, "/api/mute?host=nohost".into()),
            (M::POST, "/api/ws?v=2&host=nohost".into()),
            (M::POST, "/api/mvws?v=3&host=nohost".into()),
            (M::POST, "/api/launch?v=terminal&host=nohost".into()),
            (M::POST, format!("/api/key?v={mute}&host=nohost")),
            (M::POST, format!("/api/key?v={term}&host=nohost")),
            (M::POST, "/api/cam-diag".into()),
        ] {
            assert_eq!(call(&c, m.clone(), &u(&p), Some(GTOK)).await.0, 400, "{m} {p}");
        }

        // everything else: 403 {"error":"forbidden"} before any handler runs, GET and POST alike
        let mut denied: Vec<(M, String)> = [
            "today", "fleet", "fleet-board", "fleet-widgets", "crons", "crons/abcdef01", "run?id=run_1", "run-last",
            "nodes", "health", "car", "disks", "sites", "traffic", "mcp", "ha", "finance", "finance-values",
            "portfolio-values", "unit?name=x.service", "nope", "",
        ]
        .iter()
        .map(|r| (M::GET, format!("/api/{r}")))
        .collect();
        denied.extend(sources::FEEDS.iter().map(|d| (M::GET, format!("/api/{}", d.name))));
        for p in [
            "lock?host=nohost".to_string(),
            "screenshot?host=nohost".into(),
            "launch?v=hermes&host=nohost".into(),
            "launch?v=obsidian&host=nohost".into(),
            "launch?v=menu&host=nohost".into(),
            "launch-item?id=skill:x&target=hermes".into(),
            "run-send".into(),
            "cron-act?id=abcdef01&act=run".into(),
            format!("key?v={lock}&host=nohost"),
            format!("key?v={hermes}&host=nohost"),
            "key?v=99&host=nohost".into(),
            format!("key?v={water}"),
            format!("key?v={tvpow}"),
            format!("key?v={status}"),
            "media?host=nohost".into(),
            "whoami".into(),
            "keys".into(),
            "today".into(),
        ] {
            denied.push((M::POST, format!("/api/{p}")));
        }
        denied.push((M::PUT, "/api/mute?host=nohost".into()));
        denied.push((M::GET, "/nope".into()));
        denied.push((M::GET, "/pad?target=mini".into()));
        for (m, p) in &denied {
            let (code, body, _) = call(&c, m.clone(), &u(p), Some(GTOK)).await;
            assert_eq!((code, body.as_str()), (403, r#"{"error":"forbidden"}"#), "{m} {p}");
        }

        // the pad: a guest drives pc-desktop and Dell (426 = past auth, no upgrade sent), never the mini
        assert_eq!(call(&c, M::GET, &u("/pad?target=pc-desktop"), Some(GTOK)).await.0, 426);
        assert_eq!(call(&c, M::GET, &u("/pad?target=Dell"), Some(GTOK)).await.0, 426);
        assert_eq!(call(&c, M::GET, &u("/pad?target=mini"), Some("tok_test-1")).await.0, 426, "owner keeps the mini");

        // owner unaffected: full key list without indexes, mini target, owner routes reach their handlers
        let (_, body, _) = call(&c, M::GET, &u("/api/keys"), Some("tok_test-1")).await;
        let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
        assert_eq!(v["keys"].as_array().map(Vec::len), Some(keys.len()));
        assert!(!body.contains("\"i\""));
        // C4: 43 keys with their groups, the ten group headings, and the second tap on every risky house key
        assert_eq!(keys.len(), 43);
        assert_eq!(v["groups"].as_array().map(Vec::len), Some(10));
        assert_eq!(v["keys"][water]["group"], "sprinklers");
        assert_eq!((&v["keys"][water]["confirm"], &v["keys"][tvpow]["confirm"]), (&json!(true), &json!(true)));
        assert_eq!(v["keys"][status]["confirm"], json!(false));
        // an owner press reaches the HA gate; this test home has no HA, so nothing can fire: 502, then the 2 s limit
        let (code, body, _) = call(&c, M::POST, &u(&format!("/api/key?v={status}")), Some("tok_test-1")).await;
        assert_eq!((code, body.as_str()), (502, r#"{"error":"ha failed","ok":false}"#));
        assert_eq!(call(&c, M::POST, &u(&format!("/api/key?v={status}")), Some("tok_test-1")).await.0, 429);
        let audit = std::fs::read_to_string(home.join(".local/state/pixel-deck/actions.jsonl")).unwrap_or_default();
        assert_eq!(audit.lines().filter(|l| l.contains("\"house_status_to_phone\"")).count(), 2, "{audit}");
        let (_, body, _) = call(&c, M::GET, &u("/api/pad-targets"), Some("tok_test-1")).await;
        assert_eq!(body, r#"{"targets":["mini","pc-desktop","Dell"]}"#);
        assert_eq!(call(&c, M::POST, &u("/api/lock?host=nohost"), Some("tok_test-1")).await.0, 400);
        assert_eq!(call(&c, M::GET, &u("/api/traffic"), Some("tok_test-1")).await.0, 200);

        // `?t=` bootstrap: the cookie set is the token that matched, never the owner's for a guest
        let (code, _, sc) = call(&c, M::GET, &u(&format!("/?t={GTOK}")), None).await;
        assert_eq!(code, 200);
        let sc = sc.unwrap_or_default();
        assert!(sc.starts_with(&format!("pdeck={GTOK};")) && !sc.contains("tok_test-1"), "{sc}");
        let (_, _, sc) = call(&c, M::GET, &u("/?t=tok_test-1"), None).await;
        assert!(sc.unwrap_or_default().starts_with("pdeck=tok_test-1;"));
        // a guest cookie wins over a `?t=`: no new cookie, still the guest
        let (code, _, sc) = call(&c, M::GET, &u("/?t=tok_test-1"), Some(GTOK)).await;
        assert_eq!((code, sc), (200, None));
        let (_, body, _) = call(&c, M::GET, &u("/api/whoami?t=tok_test-1"), Some(GTOK)).await;
        assert_eq!(body, r#"{"role":"guest"}"#);
        // guest via `?t=` on the API is still the guest and still fenced
        assert_eq!(call(&c, M::GET, &u(&format!("/api/today?t={GTOK}")), None).await.0, 403);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn no_guest_file_means_guest_cookies_are_strangers() {
        use reqwest::Method as M;
        let home = std::env::temp_dir().join(format!("pdeck-noguest-{}", std::process::id()));
        let Some((base, _)) = spawn_app_home(home.clone()).await else {
            panic!("no listener")
        };
        let c = reqwest::Client::new();
        for p in ["/api/whoami", "/api/hosts", "/api/today"] {
            assert_eq!(call(&c, M::GET, &format!("{base}{p}"), Some(GTOK)).await.0, 401, "{p}");
        }
        let (code, body, sc) = call(&c, M::GET, &format!("{base}/?t={GTOK}"), None).await;
        assert_eq!((code, sc), (401, None));
        assert!(body.contains("name=\"t\""));
        assert_eq!(call(&c, M::GET, &format!("{base}/pad?target=pc-desktop"), Some(GTOK)).await.0, 401);
        // and the owner is exactly as before
        let (code, body, _) = call(&c, M::GET, &format!("{base}/api/whoami"), Some("tok_test-1")).await;
        assert_eq!((code, body.as_str()), (200, r#"{"role":"owner"}"#));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn pad_binds_route_is_get_only_and_shapes_mini() {
        let Some((base, _)) = spawn_app().await else {
            panic!("no listener")
        };
        let c = reqwest::Client::new();
        let url = format!("{base}/api/pad-binds?target=mini");
        let res = c
            .get(&url)
            .header("Cookie", "pdeck=tok_test-1")
            .send()
            .await;
        let res = match res {
            Ok(r) => r,
            Err(_) => panic!("request failed"),
        };
        assert_eq!(res.status().as_u16(), 200);
        let v: Value = res.json().await.unwrap_or(Value::Null);
        assert_eq!(v.get("os").and_then(Value::as_str), Some("macos"));
        assert_eq!(v.get("error"), None);
        let copy = v.get("binds").and_then(Value::as_array).and_then(|rows| {
            rows.iter()
                .find(|b| b.get("label").and_then(Value::as_str) == Some("Copy"))
        });
        let copy = copy.unwrap_or(&Value::Null);
        assert_eq!(copy.get("key").and_then(Value::as_str), Some("c"));
        assert_eq!(copy.get("group").and_then(Value::as_str), Some("Clipboard"));
        assert_eq!(
            copy.get("modifiers")
                .and_then(Value::as_array)
                .and_then(|a| a.first())
                .and_then(Value::as_str),
            Some("cmd")
        );
        assert!(copy.get("dispatcher").is_none());
        assert_eq!(status(&c, reqwest::Method::POST, &url, &[]).await, 405);
        assert_eq!(
            status(
                &c,
                reqwest::Method::GET,
                &format!("{base}/api/pad-binds?target=nope"),
                &[]
            )
            .await,
            400
        );
    }

    #[tokio::test]
    async fn sigterm_resolves_shutdown_signal() {
        let h = tokio::spawn(shutdown_signal());
        tokio::time::sleep(Duration::from_millis(200)).await; // handler installed
                                                              // SAFETY: signal to our own pid; tokio's handler replaces the default action.
        unsafe {
            libc::kill(libc::getpid(), libc::SIGTERM);
        }
        // the timeout is the hang guard, not the check: 30 s instead of 2 s, so a loaded runner that takes a moment to run the
        // handler is not a failure, while a signal that never resolves still fails the gate.
        let r = tokio::time::timeout(Duration::from_secs(30), h).await;
        assert!(r.is_ok(), "SIGTERM did not resolve shutdown_signal");
    }
}
