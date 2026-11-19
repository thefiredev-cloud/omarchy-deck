//! Guest principal (owner order 2026-10-13). An optional second token in `~/.config/pixel-deck/token-guest`
//! lets a household member drive pc-desktop and Dell (pad, media, volume, workspaces, harmless launches) and see
//! the house cameras, and nothing else. `allowed` is the whole guest surface: `handle()` asks it before any route
//! runs, for every method, and anything it does not name is refused. No file, or an empty one, means no guest.
use crate::hosts;
use crate::util::log;
use axum::http::Method;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Owner,
    Guest,
    /// A commercial deal desk viewer (2026-11-12): the index into `cre::VIEWERS` of the person the token names.
    Viewer(u8),
}

impl Role {
    pub fn name(self) -> &'static str {
        match self {
            Role::Owner => "owner",
            Role::Guest => "guest",
            Role::Viewer(_) => "viewer",
        }
    }

    /// The desk a viewer token is for.
    pub fn viewer_person(self) -> Option<&'static str> {
        match self {
            Role::Viewer(i) => crate::cre::VIEWERS.get(i as usize).copied(),
            _ => None,
        }
    }
}

pub const TOKEN_REL: &str = ".config/pixel-deck/token-guest";
/// `<prefix><person>`: one optional viewer token per `cre::VIEWERS` person.
pub const VIEWER_REL: &str = ".config/pixel-deck/token-cre-";

/// Pad targets a guest may drive. Never the Mac mini.
pub const PAD_TARGETS: [&str; 2] = ["pc-desktop", "Dell"];

/// `hosts::LAUNCH` items a guest may open. Left out: `hermes` (Tanner's agent), `obsidian` (his private vault),
/// `menu` (the Omarchy system menu: lock, screenshot, power, settings).
pub const LAUNCH: [&str; 7] = [
    "terminal",
    "browser",
    "files",
    "spotify",
    "nightlight",
    "apps",
    "spaces",
];

/// Reads the guest token. `None` (no guest principal) when the file is missing or empty, when it equals the owner
/// token, or when it holds characters the `pdeck` cookie cannot carry. Never logs a value.
pub fn read_token(home: &Path, owner: &str) -> Option<String> {
    read_token_file(home, TOKEN_REL, owner, &[])
}

/// The viewer tokens that exist, as (index into `cre::VIEWERS`, token). Same checks as the guest token, and a viewer
/// token may equal neither the owner's, the guest's nor another viewer's.
pub fn read_viewer_tokens(home: &Path, owner: &str, guest: Option<&str>) -> Vec<(u8, String)> {
    let mut out: Vec<(u8, String)> = Vec::new();
    for (i, p) in crate::cre::VIEWERS.iter().enumerate() {
        let mut taken: Vec<&str> = out.iter().map(|(_, t)| t.as_str()).collect();
        taken.extend(guest);
        if let Some(t) = read_token_file(home, &format!("{VIEWER_REL}{p}"), owner, &taken) {
            out.push((i as u8, t));
        }
    }
    out
}

fn read_token_file(home: &Path, rel: &str, owner: &str, taken: &[&str]) -> Option<String> {
    let raw = match std::fs::read_to_string(home.join(rel)) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
        Err(e) => {
            log("warn", "token unreadable, principal disabled", &[("file", rel.to_string()), ("err", format!("{:?}", e.kind()))]);
            return None;
        }
    };
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    if !t.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-') {
        log("warn", "token has characters a cookie cannot carry, principal disabled", &[("file", rel.to_string())]);
        return None;
    }
    if hosts::token_ok(t, owner) || taken.iter().any(|o| hosts::token_ok(t, o)) {
        log("warn", "token equals another principal's token, principal disabled", &[("file", rel.to_string())]);
        return None;
    }
    Some(t.to_string())
}

/// The whole viewer surface: the desk page, its theme, who am I, the desk route and its paged deals (own desk only,
/// pinned in `main.rs`). Static files are public already.
pub fn viewer_allowed(method: &Method, path: &str) -> bool {
    let get = *method == Method::GET || *method == Method::HEAD;
    match path {
        "/" | "/cre" | "/theme.css" | "/healthz" | "/api/whoami" | "/api/cre/deals" => get,
        "/api/cre" => get || *method == Method::POST,
        _ => false,
    }
}

/// One host action a guest may run, directly or through a `keys.json` macro: media, volume, workspaces and the
/// harmless launches, plus the bedroom play/pause its own `/api/ha-media` route already allows. Lock, screenshot,
/// every other launch and every house script (`ha-script`: TV power, consoles, sprinklers, music, house status)
/// are owner-only.
pub fn action_ok(action: &str, arg: &str) -> bool {
    match action {
        "media-act" => hosts::media_ok(arg),
        "vol-set" => hosts::vol_ok(arg),
        "mute" => arg.is_empty(),
        "ws" | "mvws" => hosts::ws_ok(arg),
        "launch" => LAUNCH.contains(&arg),
        "ha-media" => arg == "play-pause",
        "ha-script" => false,
        _ => false,
    }
}

/// The guest allowlist. `path` is the URI path, `v` the `?v=` argument, `target` the `?target=` argument and
/// `key_macro` the (action, arg) of the `keys.json` entry a `POST /api/key` names (None when it names none).
/// Public static files and `/healthz` are answered before authentication and never reach this check.
pub fn allowed(
    method: &Method,
    path: &str,
    v: &str,
    target: &str,
    key_macro: Option<(&str, &str)>,
) -> bool {
    let get = *method == Method::GET || *method == Method::HEAD;
    let post = *method == Method::POST;
    match path {
        "/" | "/theme.css" | "/healthz" => return get,
        "/pad" => return get && PAD_TARGETS.contains(&target),
        p if p.starts_with("/cam/") => return get,
        _ => {}
    }
    let Some(a) = path.strip_prefix("/api/") else {
        return false;
    };
    match a {
        "whoami" | "cam" | "cams" | "camkey" | "hosts" | "pad-targets" | "keys" | "media" | "vol"
        | "ws-now" | "ws-list" | "ping" | "stats" | "weather" => get,
        // bind names for a computer the guest may already drive. Mini stays out. POST stays out.
        "pad-binds" => get && PAD_TARGETS.contains(&target),
        "media-act" | "vol-set" | "ws" | "mvws" | "launch" => post && action_ok(a, v),
        "mute" => post,
        "ha-media" => post && v == "play-pause",
        "key" => post && key_macro.is_some_and(|(act, arg)| action_ok(act, arg)),
        // the camera tiles' own bounded diagnostics beacon (2 KB, 60 a minute, whitelisted fields)
        "cam-diag" => post,
        _ => false,
    }
}

/// Route name for the audit line: the path only (never the query), cut to a safe charset and length.
pub fn route_name(path: &str) -> String {
    path.chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.'))
        .take(64)
        .collect()
}

/// Audit of refused guest requests, at most `MAX` lines a minute; the rest are counted and reported in one line
/// when the next minute opens, so a loop cannot flood the journal.
pub struct Audit {
    st: Mutex<(Instant, u32, u32)>,
}

impl Audit {
    pub const MAX: u32 = 20;
    const WINDOW: Duration = Duration::from_secs(60);

    pub fn new() -> Self {
        Self {
            st: Mutex::new((Instant::now(), 0, 0)),
        }
    }

    /// Records one refusal. Returns true when a line was written for it.
    pub fn denied(&self, method: &Method, path: &str) -> bool {
        let Ok(mut g) = self.st.lock() else {
            return false;
        };
        if g.0.elapsed() >= Self::WINDOW {
            if g.2 > 0 {
                log("warn", "guest denied, suppressed", &[("role", "guest".into()), ("count", g.2.to_string())]);
            }
            *g = (Instant::now(), 0, 0);
        }
        if g.1 >= Self::MAX {
            g.2 += 1;
            return false;
        }
        g.1 += 1;
        log(
            "warn",
            "guest denied",
            &[
                ("role", "guest".into()),
                ("method", method.as_str().chars().take(8).collect()),
                ("route", route_name(path)),
            ],
        );
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{hosts, pad, sources};

    const G: Method = Method::GET;
    const P: Method = Method::POST;

    /// Every route `handle()` dispatches, with the guest verdict. Feeds from `sources::FEEDS` are walked separately.
    /// `dispatch_literals_are_all_in_this_table` fails when main.rs grows a route that is not listed here, so a new
    /// route is a deliberate guest decision; until it is listed, `allowed` already refuses it (no catch-all).
    const TABLE: &[(&str, &str, &str, &str, bool)] = &[
        // method, path, v, target, guest allowed
        ("GET", "/", "", "", true),
        ("POST", "/", "", "", false),
        ("GET", "/theme.css", "", "", true),
        ("GET", "/healthz", "", "", true),
        ("GET", "/cam/eufy_cam1/index.m3u8", "", "", true),
        ("POST", "/cam/eufy_cam1/index.m3u8", "", "", false),
        ("GET", "/pad", "", "pc-desktop", true),
        ("GET", "/pad", "", "Dell", true),
        ("GET", "/pad", "", "mini", false),
        ("GET", "/pad", "", "", false),
        ("GET", "/api/pad-binds", "", "pc-desktop", true),
        ("GET", "/api/pad-binds", "", "Dell", true),
        ("GET", "/api/pad-binds", "", "mini", false),
        ("GET", "/api/pad-binds", "", "", false),
        ("POST", "/api/pad-binds", "", "pc-desktop", false),
        ("GET", "/manifest.webmanifest", "", "", false), // public: served before auth, never asked
        ("GET", "/api/whoami", "", "", true),
        ("POST", "/api/whoami", "", "", false),
        ("GET", "/api/cam", "", "", true),
        ("GET", "/api/cams", "", "", true),
        ("GET", "/api/camkey", "", "", true),
        ("GET", "/api/hosts", "", "", true),
        ("GET", "/api/pad-targets", "", "", true),
        ("GET", "/api/keys", "", "", true),
        ("GET", "/api/media", "", "", true),
        ("GET", "/api/vol", "", "", true),
        ("GET", "/api/ws-now", "", "", true),
        ("GET", "/api/ws-list", "", "", true),
        ("GET", "/api/ping", "", "", true),
        ("GET", "/api/stats", "", "", true),
        ("GET", "/api/weather", "", "", true),
        ("POST", "/api/media", "", "", false),
        ("POST", "/api/media-act", "play-pause", "", true),
        ("POST", "/api/media-act", "next", "", true),
        ("POST", "/api/media-act", "rm", "", false),
        ("GET", "/api/media-act", "play-pause", "", false),
        ("POST", "/api/vol-set", "40", "", true),
        ("POST", "/api/vol-set", "101", "", false),
        ("POST", "/api/mute", "", "", true),
        ("GET", "/api/mute", "", "", false),
        ("POST", "/api/ws", "3", "", true),
        ("POST", "/api/ws", "9", "", false),
        ("POST", "/api/mvws", "2", "", true),
        ("POST", "/api/launch", "terminal", "", true),
        ("POST", "/api/launch", "browser", "", true),
        ("POST", "/api/launch", "files", "", true),
        ("POST", "/api/launch", "spotify", "", true),
        ("POST", "/api/launch", "nightlight", "", true),
        ("POST", "/api/launch", "apps", "", true),
        ("POST", "/api/launch", "spaces", "", true),
        ("POST", "/api/launch", "hermes", "", false),
        ("POST", "/api/launch", "obsidian", "", false),
        ("POST", "/api/launch", "menu", "", false),
        ("POST", "/api/launch", "amazon-orders", "", false),
        ("POST", "/api/launch", "amazon-returns", "", false),
        ("POST", "/api/launch", "commerce-ink", "", false),
        ("POST", "/api/launch", "commerce-ink-dashboard", "", false),
        ("GET", "/api/commerce", "", "", false),
        ("POST", "/api/commerce", "", "", false),
        // the commercial deal desk (2026-11-12): owner and desk viewers only, never the household guest
        ("GET", "/cre", "", "", false),
        ("GET", "/api/cre", "", "", false),
        ("POST", "/api/cre", "", "", false),
        ("GET", "/almanac", "", "", false),
        ("GET", "/almanac/", "", "", false),
        ("POST", "/almanac/api/ask", "", "", false),
        ("POST", "/api/ha-media", "play-pause", "", true),
        ("POST", "/api/ha-media", "off", "", false),
        ("POST", "/api/cam-diag", "", "", true),
        ("GET", "/api/cam-diag", "", "", false),
        // page errors (2026-11-15): the owner's pages only; a guest device sending errors is the owner's decision
        ("POST", "/api/client-error", "", "", false),
        ("GET", "/api/client-error", "", "", false),
        ("POST", "/api/lock", "", "", false),
        ("POST", "/api/screenshot", "", "", false),
        ("POST", "/api/launch-item", "", "", false),
        ("POST", "/api/run-send", "", "", false),
        ("POST", "/api/cron-act", "", "", false),
        ("GET", "/api/unit", "", "", false),
        ("GET", "/api/crons/abcdef01", "", "", false),
        ("GET", "/api/finance", "", "", false),
        ("GET", "/api/finance-values", "", "", false),
        ("GET", "/api/portfolio-values", "", "", false),
        // saved jobs (2026-11-01): Tanner's and Casey's job tracker is owner-only, both ways
        ("GET", "/api/saved-jobs", "", "", false),
        ("POST", "/api/saved-jobs", "", "", false),
        // Markets > Housing and Commercial (2026-11-11): the household budget and the national data are owner-only
        ("GET", "/api/housing/national", "", "", false),
        ("GET", "/api/housing/rank", "", "", false),
        ("GET", "/api/housing/zip/92629", "", "", false),
        ("GET", "/api/housing/profile", "", "", false),
        ("POST", "/api/housing/profile", "", "", false),
        // national dataset v2 and paged listings (2026-11-14): owner-only like the rest of housing; deals reach the
        // desk viewers through `viewer_allowed`, never the household guest
        ("GET", "/api/housing/fields", "", "", false),
        ("GET", "/api/housing/zip/92629/hist", "", "", false),
        ("GET", "/api/realestate/homes", "", "", false),
        ("GET", "/api/realestate/commercial", "", "", false),
        ("GET", "/api/cre/deals", "", "", false),
        ("POST", "/api/cre/deals", "", "", false),
        ("POST", "/api/housing/zip/92629/listings", "", "", false),
        // Shop > market feed (2026-11-14): owner only, like every feed
        ("GET", "/api/ecom-market", "", "", false),
        // Surf, Cabo to the Columbia River (2026-11-14): owner-only like every feed
        ("GET", "/api/surf-coast", "", "", false),
        ("GET", "/api/surf-coast/region/orange-county", "", "", false),
        ("POST", "/api/surf-coast", "", "", false),
        ("GET", "/api/fleet", "", "", false),
        ("GET", "/api/amazon", "", "", false),
        // Home > Launch Apps and models by machine (owner sweep, restored 2026-11-15): owner only, every method
        ("GET", "/api/apps", "", "", false),
        ("POST", "/api/apps/wake", "", "", false),
        ("GET", "/api/models", "", "", false),
        ("POST", "/api/models", "", "", false),
        ("GET", "/api/crons", "", "", false),
        ("GET", "/api/fleet-board", "", "", false),
        ("GET", "/api/fleet-widgets", "", "", false),
        ("GET", "/api/run", "", "", false),
        ("GET", "/api/run-last", "", "", false),
        ("GET", "/api/today", "", "", false),
        ("GET", "/api/nodes", "", "", false),
        ("GET", "/api/health", "", "", false),
        ("GET", "/api/car", "", "", false),
        ("GET", "/api/disks", "", "", false),
        ("GET", "/api/sites", "", "", false),
        ("GET", "/api/traffic", "", "", false),
        ("GET", "/api/mcp", "", "", false),
        ("GET", "/api/ha", "", "", false),
        ("POST", "/api/key", "0", "", false), // no macro resolved: refused
        ("GET", "/api/nope", "", "", false),
        ("GET", "/api/", "", "", false),
        ("GET", "/nope", "", "", false),
        ("PUT", "/api/mute", "", "", false),
        ("DELETE", "/api/keys", "", "", false),
    ];

    fn m(s: &str) -> Method {
        Method::from_bytes(s.as_bytes()).unwrap_or(Method::OPTIONS)
    }

    #[test]
    fn table_verdicts() {
        for (meth, path, v, target, want) in TABLE {
            assert_eq!(allowed(&m(meth), path, v, target, None), *want, "{meth} {path} v={v} target={target}");
        }
    }

    #[test]
    fn every_feed_is_denied_for_guest() {
        for d in sources::FEEDS {
            let p = format!("/api/{}", d.name);
            assert!(!allowed(&G, &p, "", "", None), "{p}");
            assert!(!allowed(&P, &p, "", "", None), "{p} POST");
        }
        for d in [&sources::FINANCE, &sources::PORTFOLIO_VALUES] {
            assert!(!allowed(&G, &format!("/api/{}", d.name), "", "", None), "{}", d.name);
        }
    }

    /// The answers the 2026-11-04 sweep restore widens (Shop `resale` and `movers_info`, Surf `break_cams`, the Vercel
    /// traffic block, Fleet hosts, the crons model, Today's briefing, health and car, the finance basis and ages and the
    /// amounts view) stay owner-only: refused for the household guest and every desk viewer, whatever the method.
    #[test]
    fn restored_answers_stay_refused_for_guest_and_viewer() {
        let routes = [
            "/api/ecom", "/api/outdoors", "/api/traffic", "/api/fleet", "/api/crons", "/api/crons/abcdef01", "/api/today",
            "/api/health", "/api/car", "/api/finance", "/api/finance-values",
        ];
        for p in routes {
            for meth in [Method::GET, Method::HEAD, Method::POST, Method::PUT, Method::DELETE] {
                assert!(!allowed(&meth, p, "", "", None), "guest {meth} {p}");
                assert!(!viewer_allowed(&meth, p), "viewer {meth} {p}");
            }
        }
    }

    /// The Invest tab: positions, their amounts, the markets board and the commerce amounts are owner-only. The household
    /// guest and every desk viewer are refused whatever the method, with or without a query string or a trailing slash.
    #[test]
    fn portfolio_and_amount_routes_stay_refused_for_guest_and_viewer() {
        let routes = ["/api/portfolio", "/api/portfolio-values", "/api/markets", "/api/commerce", "/api/portfolio/", "/api/portfolio-values/"];
        for p in routes {
            for meth in [Method::GET, Method::HEAD, Method::POST, Method::PUT, Method::DELETE] {
                assert!(!allowed(&meth, p, "", "", None), "guest {meth} {p}");
                assert!(!allowed(&meth, p, "positions", "portfolio-values", None), "guest {meth} {p} with arguments");
                assert!(!viewer_allowed(&meth, p), "viewer {meth} {p}");
            }
        }
        assert!(sources::feed_def("portfolio").is_some() && sources::feed_def("portfolio-values").is_none());
    }

    #[test]
    fn key_macros_follow_the_action_rule() {
        let key = |act: &str, arg: &str| allowed(&P, "/api/key", "0", "", Some((act, arg)));
        assert!(key("media-act", "play-pause") && key("mute", "") && key("ws", "4") && key("mvws", "5"));
        assert!(key("launch", "terminal") && key("launch", "spaces"));
        assert!(!key("launch", "hermes") && !key("launch", "obsidian") && !key("launch", "menu"));
        assert!(!key("lock", "") && !key("screenshot", "") && !key("bogus", ""));
        assert!(!allowed(&G, "/api/key", "0", "", Some(("mute", ""))), "GET key");
        // the repo's keys.json: lock, screenshot, hermes, obsidian, menu and every house script are owner-only
        let raw = include_str!("../../keys.json");
        let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else { panic!("keys.json") };
        let mut denied = vec![];
        let mut house = 0;
        for k in v["keys"].as_array().into_iter().flatten() {
            let (a, g) = (k["action"].as_str().unwrap_or(""), k["arg"].as_str().unwrap_or(""));
            if a == "ha-script" {
                assert!(!key(a, g), "guest may fire house script {g}");
                house += 1;
            } else if !key(a, g) {
                denied.push(format!("{a}:{g}"));
            }
        }
        denied.sort();
        assert_eq!(denied, ["launch:hermes", "launch:menu", "launch:obsidian", "lock:", "screenshot:"]);
        assert_eq!(house, crate::ha::HA_SCRIPTS.len());
        assert!(key("ha-media", "play-pause") && !key("ha-media", "off"));
        for (id, _, _) in crate::ha::HA_SCRIPTS {
            assert!(!key("ha-script", id), "{id}");
        }
    }

    #[test]
    fn guest_lists_are_subsets_of_the_owner_lists() {
        for t in PAD_TARGETS {
            assert!(pad::valid_target(t));
        }
        assert!(!PAD_TARGETS.contains(&"mini"));
        for l in LAUNCH {
            assert!(hosts::LAUNCH.contains(&l), "{l}");
        }
    }

    /// Every route literal in `handle()` (match arms, `a == ".."`, `path == ".."`, `starts_with`, `strip_prefix`)
    /// must appear in TABLE, so adding a route forces a guest verdict.
    #[test]
    fn dispatch_literals_are_all_in_this_table() {
        let src = include_str!("main.rs");
        let (Some(a), Some(b)) = (src.find("async fn handle("), src.find("\nfn fleet_path")) else {
            panic!("handle() markers moved")
        };
        let body = &src[a..b];
        let mut found = vec![];
        let bytes = body.as_bytes();
        let mut i = 0;
        while let Some(off) = body[i..].find('"') {
            let s = i + off + 1;
            let Some(len) = body[s..].find('"') else { break };
            let lit = &body[s..s + len];
            let before = body[..s - 1].trim_end();
            let after = body[s + len + 1..].trim_start();
            // `arg == "play-pause" =>` is a guard on an argument, not a route
            let arm = (after.starts_with("=>") || after.starts_with('|') || after.starts_with("if ")
                || before.ends_with('|') || before.ends_with("matches!(a,"))
                && !before.ends_with("==");
            let cmp = before.ends_with("a ==") || before.ends_with("path ==")
                || before.ends_with("starts_with(") || before.ends_with("strip_prefix(");
            let route_like = !lit.is_empty() && lit.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"/-._".contains(&c));
            if (arm || cmp) && route_like {
                found.push(lit.to_string());
            }
            i = s + len + 1;
            if i >= bytes.len() {
                break;
            }
        }
        assert!(found.len() > 40, "scan found too few route literals: {found:?}");
        let listed = |lit: &str| {
            TABLE.iter().any(|(_, p, _, _, _)| {
                *p == lit || p.strip_prefix("/api/") == Some(lit) || p.strip_prefix("/api/").is_some_and(|x| x.starts_with(lit))
                    || (lit.ends_with('/') && p.starts_with(lit))
            })
        };
        // public static files are answered before authentication, so a guest verdict does not apply to them
        let public = |lit: &str| lit.starts_with('/') && lit.contains('.') && lit != "/theme.css";
        let missing: Vec<_> = found.iter().filter(|l| !listed(l) && !public(l)).collect();
        assert!(missing.is_empty(), "routes without a guest verdict in TABLE: {missing:?}");
    }

    #[test]
    fn route_name_drops_query_and_odd_bytes() {
        assert_eq!(route_name("/api/today"), "/api/today");
        assert_eq!(route_name("/api/x\"y\n<z>"), "/api/xyz");
        assert_eq!(route_name(&"a".repeat(200)).len(), 64);
    }

    #[test]
    fn audit_is_rate_limited() {
        let a = Audit::new();
        let n = (0..Audit::MAX + 15).filter(|_| a.denied(&G, "/api/today")).count();
        assert_eq!(n as u32, Audit::MAX);
        let g = a.st.lock().map(|g| (g.1, g.2)).unwrap_or((0, 0));
        assert_eq!(g, (Audit::MAX, 15));
    }

    #[test]
    fn token_file_rules() {
        let home = std::env::temp_dir().join(format!("pdeck-guest-tok-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let Ok(()) = std::fs::create_dir_all(home.join(".config/pixel-deck")) else { panic!("mkdir") };
        let owner = ["own", "er_test-1"].concat();
        assert_eq!(read_token(&home, &owner), None, "absent");
        let w = |s: &str| std::fs::write(home.join(TOKEN_REL), s).is_ok();
        assert!(w("  \n"));
        assert_eq!(read_token(&home, &owner), None, "empty");
        assert!(w(&format!("{owner}\n")));
        assert_eq!(read_token(&home, &owner), None, "equal to owner");
        assert!(w("has space;x"));
        assert_eq!(read_token(&home, &owner), None, "bad charset");
        let guest = ["gue", "st_test-2"].concat();
        assert!(w(&format!("{guest}\n")));
        assert_eq!(read_token(&home, &owner).as_deref(), Some(guest.as_str()));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn viewer_tokens_and_surface() {
        let home = std::env::temp_dir().join(format!("pdeck-viewer-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::create_dir_all(home.join(".config/pixel-deck"));
        let owner = ["own", "er_test-1"].concat();
        let guest = ["gue", "st_test-2"].concat();
        let w = |p: &str, s: &str| std::fs::write(home.join(format!("{VIEWER_REL}{p}")), s).is_ok();
        assert!(read_viewer_tokens(&home, &owner, Some(&guest)).is_empty(), "no files, no viewers");
        assert!(w("jordan", "cre_jordan-1\n") && w("riley", &guest));
        let v = read_viewer_tokens(&home, &owner, Some(&guest));
        assert_eq!(v, vec![(0u8, "cre_jordan-1".to_string())], "a viewer token equal to the guest token is refused");
        assert!(w("riley", "cre_jordan-1"));
        assert_eq!(read_viewer_tokens(&home, &owner, None).len(), 1, "two viewers never share a token");
        assert_eq!(Role::Viewer(1).viewer_person(), Some("riley"));
        assert_eq!(Role::Viewer(9).viewer_person(), None);
        assert_eq!(Role::Owner.viewer_person(), None);
        // the viewer surface: the desk and nothing else
        assert!(viewer_allowed(&Method::GET, "/cre") && viewer_allowed(&Method::GET, "/api/cre") && viewer_allowed(&Method::POST, "/api/cre"));
        assert!(viewer_allowed(&Method::GET, "/") && viewer_allowed(&Method::GET, "/api/whoami"));
        for p in [
            "/api/realestate", "/api/realestate/homes", "/api/realestate/commercial", "/api/housing/profile", "/api/housing/rank",
            "/api/housing/fields", "/api/housing/zip/92629/hist", "/api/saved-jobs", "/api/today", "/pad", "/cam/x/index.m3u8",
            "/api/keys", "/almanac/",
        ] {
            assert!(!viewer_allowed(&Method::GET, p), "{p}");
        }
        assert!(!viewer_allowed(&Method::POST, "/api/whoami") && !viewer_allowed(&Method::DELETE, "/api/cre"));
        assert!(!viewer_allowed(&Method::POST, "/api/client-error") && !viewer_allowed(&Method::GET, "/api/client-error"));
        // paged deals: read-only for a viewer (the route pins the desk to the viewer)
        assert!(viewer_allowed(&Method::GET, "/api/cre/deals") && !viewer_allowed(&Method::POST, "/api/cre/deals"));
        // Apps and models by machine are the owner's
        for (meth, p) in [(Method::GET, "/api/apps"), (Method::POST, "/api/apps/wake"), (Method::GET, "/api/models")] {
            assert!(!viewer_allowed(&meth, p), "{p}");
        }
        let _ = std::fs::remove_dir_all(&home);
    }
}
