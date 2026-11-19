//! Apps for Home > Launch (owner sweep 2026-11-04, restored 2026-11-15).
//!   GET  /api/apps               the catalog of apps on this PC, each with what its loopback probe saw. Cached 15 s.
//!   POST /api/apps/wake?id=<id>  wakes one app that sleeps until used (owner cookie only, never `?t=`).
//! Guests and desk viewers are refused by their allowlists in guest.rs before this module runs.
//! The catalog is fixed in this file. No request names a host, port or URL, so the deck probes, links and wakes only what is
//! listed here. Probe: one loopback GET per app (1.5 s, redirects not followed); the status is what answered. `frame` is true
//! only when the app sends no X-Frame-Options and no CSP frame-ancestors, so the page may show it in a panel.
//! Links are the tailnet routes in ~/.config/dev-https/routes.json. Dell apps are left out: their tailnet routes are the
//! owner's to make, and the deck never probes the Dell.
//! Wake: the ha-apps gateway (~/projects/ha-apps, ONDEMAND.md) starts a sleeping app on the first request to its loopback door
//! and stops it again after its idle limit. The deck sends that one request; it never runs systemctl and never stops an app.
//! Same rules as the launch action: the catalog is the allowlist, one wake at a time, 4 s apart, 8 a minute, one audit line in
//! actions.jsonl. The second tap is the page's.
use crate::actions::{append, limited, rate};
use crate::launch::{MIN_GAP, PER_MINUTE};
use crate::util::{log, now_epoch};
use reqwest::header::HeaderMap;
use reqwest::redirect::Policy;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::path::Path;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

/// How long a built list is reused. The page asks again every 30 s; this keeps probes off the hot path.
const TTL_SECS: u64 = 15;
/// The PC's tailnet name (routes.json `node`). Each app has its own published HTTPS port.
pub const NODE: &str = "pc-desktop.example.ts.net";
/// How long a wake waits for the app. The gateway keeps starting it after the deck stops waiting.
const WAKE_WAIT: Duration = Duration::from_secs(8);

#[derive(Clone, Copy)]
pub struct App {
    pub id: &'static str,
    pub name: &'static str,
    /// The deck area the app belongs with, short label on the tile.
    pub area: &'static str,
    pub does: &'static str,
    /// Loopback port on the PC.
    pub port: u16,
    /// Path the status probe asks for.
    pub probe: &'static str,
    /// Published tailnet HTTPS port (routes.json). None: no route, so no link from the deck.
    pub serve: Option<u16>,
    /// Path added to the tailnet URL when the page opens the app.
    pub open: &'static str,
    /// Loopback door of the ha-apps gateway (apps.yaml `gateway_port`) for an app that sleeps until used. None: always on,
    /// or started by hand, so the deck cannot wake it.
    pub door: Option<u16>,
}

const fn app(id: &'static str, name: &'static str, area: &'static str, does: &'static str, port: u16, serve: Option<u16>) -> App {
    App { id, name, area, does, port, probe: "/", serve, open: "/", door: None }
}

const fn sleeper(id: &'static str, name: &'static str, area: &'static str, does: &'static str, port: u16, serve: u16, door: u16) -> App {
    App { id, name, area, does, port, probe: "/", serve: Some(serve), open: "/", door: Some(door) }
}

pub const PC: &[App] = &[
    app("deals", "Deals", "Shop", "Listings near home and fares", 8884, Some(10501)),
    app("findfiles", "Find Files", "Tools", "Search files on PC, Dell and Drive", 8885, Some(10502)),
    app("owner-queue", "Owner Queue", "Work", "Decisions waiting on the owner", 8883, Some(10504)),
    sleeper("almanac", "Almanac", "Life", "Your history, 2006 to now", 8795, 10505, 4801),
    sleeper("rolodex", "Rolodex", "Life", "People, follow-ups and briefs", 8812, 10506, 4802),
    sleeper("morning-brief", "Morning Brief", "Today", "Daily brief from your own apps", 8813, 10507, 4803),
    sleeper("drive-atlas", "Drive Atlas", "Tools", "Search every Drive file", 8814, 10508, 4804),
    sleeper("paperwork", "Paperwork", "Money", "Renewals and documents due", 8838, 10510, 4805),
    sleeper("photo-atlas", "Photo Atlas", "Media", "Photo search by place and year", 8863, 10511, 4806),
    sleeper("photovault", "Photovault", "Media", "Local copy of the photo library", 8879, 10512, 4808),
    App { probe: "/gallery", open: "/gallery", ..app("personal-archive", "Personal archive", "Media", "Gallery of the photo catalog", 8788, Some(10528)) },
    App { probe: "/api/status", ..sleeper("localbolt", "LocalBolt", "Make", "Prompt to web app", 8877, 10513, 4809) },
    sleeper("localclip", "LocalClip", "Make", "Long video to short clips", 8871, 10514, 4811),
    sleeper("localavatar", "LocalAvatar", "Make", "Talking avatar videos", 8870, 10515, 4812),
    sleeper("hyperframes", "HyperFrames Studio", "Make", "HTML video studio", 3002, 10516, 4817),
    app("voice-studio", "Voice Studio", "Make", "Voice generation", 17493, Some(10520)),
    app("comfyui", "ComfyUI", "Make", "Image workflows", 8188, Some(10521)),
    app("text-to-cad", "Text-to-CAD", "Make", "CAD viewer", 3245, Some(10522)),
    sleeper("commerce-ink", "Commerce Ink dashboard", "Commerce", "Operator dashboard (local build)", 4102, 10517, 4814),
    app("firestudy", "Fire Study", "Life", "LACoFD study cards and quizzes", 8806, Some(10454)),
    app("mesh-web", "Mesh web", "Work", "Mesh web app", 8790, Some(10447)),
    app("kodros-console", "Kodros Console", "Work", "Console (this PC only)", 3020, None),
    app("kodros-site-local", "Kodros site (local preview)", "Work", "Local preview of the Kodros site", 4101, Some(10518)),
    app("kodros-plugins-local", "Kodros plugins (local preview)", "Work", "Local preview of the Kodros plugins", 4107, Some(10519)),
    app("hermes-webui", "Hermes WebUI", "AI", "Hermes chat on phone and tablet", 8787, Some(8443)),
    App { probe: "/docs", open: "/docs", ..app("hindsight", "Hindsight API docs", "AI", "Memory API docs", 8890, Some(10525)) },
    app("mnemosyne", "Mnemosyne dashboard", "AI", "Memory snapshot (this PC only)", 8765, None),
    app("paperclip", "Paperclip UI", "AI", "Agent workspace", 3180, Some(10527)),
    app("xiryn", "Xiryn", "AI", "Xiryn web app", 6796, Some(10531)),
    app("mesh-remote", "Mesh Remote", "Home", "Phone remote for the Samsung TVs", 8793, None),
    app("tvhub", "TV hub", "Home", "Bedroom and living room TV remote", 8792, Some(10450)),
    App { open: "/house-ipad/start", ..app("house-assistant", "Home Assistant", "Home", "House controls and phone app", 8123, Some(8124)) },
    app("team-chat", "Team Chat", "Home", "House chat", 3080, Some(10451)),
    app("music-assistant", "Music Assistant", "Media", "House speakers and Spotify Connect", 8095, Some(10449)),
    app("jellyfin", "Jellyfin movies", "Media", "Movie library", 8920, Some(8920)),
    app("retro-games", "Games", "Media", "Retro games server", 8570, Some(8572)),
    app("rf-observatory", "RF observatory", "Tools", "Local RF dashboard", 8791, Some(10529)),
    App { probe: "/status", open: "/status", ..app("vram-pool", "VRAM pool", "Cluster", "GPU memory pool status", 8100, Some(10530)) },
    app("uptime", "Uptime", "Tools", "Site and camera uptime", 8942, Some(9444)),
    app("infra-report", "Infra report", "Tools", "Docker and Kubernetes report (this PC only)", 4850, None),
];

/// True when the app may be shown in a deck panel: no X-Frame-Options and no CSP frame-ancestors directive.
fn allows_frame(h: &HeaderMap) -> bool {
    if h.contains_key("x-frame-options") {
        return false;
    }
    !h.get_all("content-security-policy")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .any(|p| p.split(';').any(|d| d.trim().to_ascii_lowercase().starts_with("frame-ancestors")))
}

fn item(a: &App, status: &str, why: &str, frame: bool) -> Value {
    json!({
        "id": a.id,
        "name": a.name,
        "host": "PC",
        "area": a.area,
        "does": a.does,
        "status": status,
        "why": why,
        "frame": frame,
        "url": a.serve.map(|p| format!("https://{NODE}:{p}{}", a.open)),
        "wake": a.door.is_some(),
    })
}

/// One app's status. `up`, `sign-in` (401 or 403), `down` (an error page or no answer in time), `asleep` (nothing listening on
/// an app that sleeps until used: Wake starts it) or `off` (nothing listening on any other app: the deck does not start it).
async fn probe(c: reqwest::Client, a: App) -> Value {
    let url = format!("http://127.0.0.1:{}{}", a.port, a.probe);
    let (status, why, frame) = match c.get(&url).send().await {
        Ok(r) => {
            let allows = allows_frame(r.headers());
            match r.status().as_u16() {
                500..=599 => ("down", "error page", false),
                401 | 403 => ("sign-in", "needs sign-in", allows),
                _ => ("up", "", allows),
            }
        }
        Err(e) if e.is_timeout() => ("down", "no answer", false),
        Err(_) if a.door.is_some() => ("asleep", "wakes on request", false),
        Err(_) => ("off", "not running", false),
    };
    item(&a, status, why, frame && a.serve.is_some())
}

async fn build(list: &[App]) -> Value {
    let Ok(client) = reqwest::Client::builder()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_millis(800))
        .timeout(Duration::from_millis(1500))
        .build()
    else {
        return json!({"status": "not_reporting", "reason": "the probe client could not start", "t": now_epoch()});
    };
    let tasks: Vec<_> = list.iter().map(|a| tokio::spawn(probe(client.clone(), *a))).collect();
    let mut items = Vec::with_capacity(list.len());
    for t in tasks {
        if let Ok(v) = t.await {
            items.push(v);
        }
    }
    json!({"t": now_epoch(), "items": items})
}

fn fail(code: u16, error: &str) -> (u16, Value) {
    (code, json!({"ok": false, "error": error}))
}

fn id_ok(id: &str) -> bool {
    (1..=40).contains(&id.len()) && id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

/// What one request to a gateway door says about the wake.
async fn knock(url: &str) -> (u16, Value) {
    let Ok(c) = reqwest::Client::builder().redirect(Policy::none()).connect_timeout(Duration::from_secs(2)).timeout(WAKE_WAIT).build() else {
        return fail(500, "client");
    };
    // not a browser (no `Accept: text/html`): the gateway holds the request until the app answers instead of sending its
    // "Starting" page, and a request that is not the gateway's health probe counts as use, so the idle stop starts over
    match c.get(url).header("User-Agent", "pixel-deck-wake").header("Accept", "*/*").send().await {
        Ok(r) if r.status().as_u16() < 500 => (200, json!({"ok": true, "state": "up"})),
        Ok(r) => {
            let text = r.text().await.unwrap_or_default();
            if text.starts_with("Starting") {
                (202, json!({"ok": true, "state": "starting"}))
            } else {
                fail(502, "could not start")
            }
        }
        Err(e) if e.is_timeout() => (202, json!({"ok": true, "state": "starting"})),
        Err(_) => fail(502, "the app gateway is not running"),
    }
}

/// The list cache and the wake limiter.
#[derive(Default)]
pub struct Apps {
    slot: Mutex<Option<(Instant, Value)>>,
    wake_hist: Mutex<VecDeque<Instant>>,
    wake_one: Mutex<()>,
    /// Tests only: send every wake to this loopback server instead of the app's door.
    #[cfg(test)]
    door_base: Option<String>,
}

impl Apps {
    /// The last built list, reused for TTL_SECS. The lock is held while building, so concurrent asks share one build.
    pub async fn get(&self) -> Value {
        self.get_from(PC).await
    }

    async fn get_from(&self, list: &[App]) -> Value {
        let mut g = self.slot.lock().await;
        if let Some((t, v)) = g.as_ref() {
            if t.elapsed().as_secs() < TTL_SECS {
                return v.clone();
            }
        }
        let v = build(list).await;
        *g = Some((Instant::now(), v.clone()));
        v
    }

    fn door_url(&self, door: u16, path: &str) -> String {
        #[cfg(test)]
        if let Some(b) = &self.door_base {
            return format!("{b}{path}");
        }
        format!("http://127.0.0.1:{door}{path}")
    }

    /// `POST /api/apps/wake?id=<id>`. Answers 200 `{ok, id, name, state: "up"}`, 202 with `state: "starting"`, or
    /// `{ok: false, error}` with 400, 404, 409, 429 (`retry_s`) or 502.
    pub async fn wake(&self, home: &Path, id: &str) -> (u16, Value) {
        let t = now_epoch();
        let found = PC.iter().find(|a| a.id == id);
        let mut result = match found {
            _ if !id_ok(id) => fail(400, "bad id"),
            None => fail(404, "unknown app"),
            Some(a) => match a.door {
                None => fail(409, "this app does not sleep"),
                Some(door) => match self.wake_one.try_lock() {
                    Err(_) => limited(MIN_GAP.as_secs()),
                    Ok(_one) => {
                        let admitted = rate(&mut *self.wake_hist.lock().await, MIN_GAP, PER_MINUTE);
                        match admitted {
                            Err(wait) => limited(wait),
                            Ok(()) => {
                                let r = knock(&self.door_url(door, a.probe)).await;
                                *self.slot.lock().await = None;
                                r
                            }
                        }
                    }
                },
            },
        };
        if let (true, Some(a)) = (result.1["ok"] == true, found) {
            result.1["id"] = json!(a.id);
            result.1["name"] = json!(a.name);
            result.1["t"] = json!(t);
        }
        let mut audit = json!({"t": t, "act": "wake", "app": if found.is_some() { id } else { "bad" }, "ok": result.1["ok"] == true});
        if result.1["ok"] != true {
            audit["error"] = result.1["error"].clone();
        }
        if append(home, "actions.jsonl", &audit).is_err() {
            log("warn", "audit append failed", &[("act", "wake".to_string())]);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderName, HeaderValue};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.append(HeaderName::from_bytes(k.as_bytes()).unwrap_or(HeaderName::from_static("x-test")), HeaderValue::from_str(v).unwrap_or(HeaderValue::from_static("")));
        }
        h
    }

    /// A loopback server that answers every request with `reply` (after `delay`), and the port it listens on.
    async fn server(reply: &'static str, delay: Duration) -> Option<u16> {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.ok()?;
        let port = l.local_addr().ok()?.port();
        tokio::spawn(async move {
            while let Ok((mut s, _)) = l.accept().await {
                tokio::spawn(async move {
                    let mut buf = [0u8; 2048];
                    let _ = s.read(&mut buf).await;
                    tokio::time::sleep(delay).await;
                    let _ = s.write_all(reply.as_bytes()).await;
                });
            }
        });
        Some(port)
    }

    /// A loopback port with nothing listening on it.
    async fn closed_port() -> u16 {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.ok();
        l.and_then(|l| l.local_addr().ok()).map(|a| a.port()).unwrap_or(9)
    }

    const OK: &str = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok";
    const OK_DENY: &str = "HTTP/1.1 200 OK\r\nX-Frame-Options: DENY\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok";
    const AUTH: &str = "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
    const ERR: &str = "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
    const STARTING: &str = "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 8\r\nConnection: close\r\n\r\nStarting";
    const NOSTART: &str = "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 21\r\nConnection: close\r\n\r\nCould not start x: no";

    fn home(tag: &str) -> std::path::PathBuf {
        let h = std::env::temp_dir().join(format!("pdeck-apps-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&h);
        h
    }

    #[test]
    fn ids_ports_routes_and_doors_are_unique() {
        let uniq = |mut v: Vec<u16>| {
            let n = v.len();
            v.sort_unstable();
            v.dedup();
            v.len() == n
        };
        assert!(uniq(PC.iter().map(|a| a.port).collect()));
        assert!(uniq(PC.iter().filter_map(|a| a.serve).collect()));
        assert!(uniq(PC.iter().filter_map(|a| a.door).collect()));
        let mut ids: Vec<&str> = PC.iter().map(|a| a.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), PC.len());
        assert!(PC.iter().all(|a| id_ok(a.id)), "every id passes the wake id rule");
        // a sleeping app always has a route to open once it is awake; the retired ModelDeck tile stays out (Cluster reads it)
        assert!(PC.iter().filter(|a| a.door.is_some()).all(|a| a.serve.is_some()));
        assert_eq!(PC.iter().filter(|a| a.door.is_some()).count(), 12);
        assert!(!PC.iter().any(|a| a.id == "modeldeck" || a.port == 8866));
    }

    #[test]
    fn framing_follows_the_headers() {
        assert!(allows_frame(&headers(&[])));
        assert!(allows_frame(&headers(&[("content-security-policy", "default-src 'self'; img-src data:")])));
        assert!(!allows_frame(&headers(&[("x-frame-options", "DENY")])));
        assert!(!allows_frame(&headers(&[("x-frame-options", "SAMEORIGIN")])));
        assert!(!allows_frame(&headers(&[("content-security-policy", "default-src 'self'; frame-ancestors 'none'")])));
        assert!(!allows_frame(&headers(&[("content-security-policy", "frame-ancestors 'self' https://x.example")])));
    }

    #[tokio::test]
    async fn the_list_says_what_each_probe_saw_and_leaves_the_dell_out() {
        let z = Duration::ZERO;
        let (Some(up), Some(deny), Some(auth), Some(err), Some(slow)) =
            (server(OK, z).await, server(OK_DENY, z).await, server(AUTH, z).await, server(ERR, z).await, server(OK, Duration::from_secs(3)).await)
        else {
            panic!("no listener")
        };
        let (gone_a, gone_b) = (closed_port().await, closed_port().await);
        let list = [
            app("up", "Up", "Tools", "", up, Some(1)),
            app("deny", "Deny", "Tools", "", deny, Some(2)),
            app("auth", "Auth", "Tools", "", auth, Some(3)),
            app("err", "Err", "Tools", "", err, Some(4)),
            app("slow", "Slow", "Tools", "", slow, Some(5)),
            sleeper("nap", "Nap", "Life", "", gone_a, 6, 7),
            app("off", "Off", "Make", "", gone_b, None),
        ];
        let v = Apps::default().get_from(&list).await;
        let by = |id: &str| v["items"].as_array().and_then(|a| a.iter().find(|x| x["id"] == id)).cloned().unwrap_or(Value::Null);
        let st = |id: &str| (by(id)["status"].as_str().map(str::to_string), by(id)["frame"].as_bool());
        assert_eq!(st("up"), (Some("up".into()), Some(true)));
        assert_eq!(st("deny"), (Some("up".into()), Some(false)), "X-Frame-Options keeps it out of the panel");
        assert_eq!(st("auth"), (Some("sign-in".into()), Some(true)));
        assert_eq!(st("err"), (Some("down".into()), Some(false)));
        assert_eq!(st("slow"), (Some("down".into()), Some(false)));
        assert_eq!((by("slow")["why"].as_str(), by("err")["why"].as_str()), (Some("no answer"), Some("error page")));
        assert_eq!(st("nap"), (Some("asleep".into()), Some(false)));
        assert_eq!((by("nap")["wake"].as_bool(), by("up")["wake"].as_bool()), (Some(true), Some(false)));
        assert_eq!(st("off"), (Some("off".into()), Some(false)));
        assert_eq!(by("off")["url"], Value::Null, "no route, no link");
        assert_eq!(by("up")["url"], format!("https://{NODE}:1/"));
        assert!(v["t"].is_u64());
        let first = by("up");
        let keys: Vec<&str> = first.as_object().map(|o| o.keys().map(String::as_str).collect()).unwrap_or_default();
        assert_eq!(keys, ["area", "does", "frame", "host", "id", "name", "status", "url", "wake", "why"]);
        assert!(v["items"].as_array().into_iter().flatten().all(|x| x["host"] == "PC"));
        assert!(v.get("dell").is_none());
    }

    #[tokio::test]
    async fn a_fresh_probe_list_is_reused_for_the_cache_window() {
        let Some(port) = server(OK, Duration::ZERO).await else {
            panic!("no listener")
        };
        let apps = Apps::default();
        let original = [app("original", "Original", "Tools", "", port, Some(1))];

        let first = apps.get_from(&original).await;
        let cached = apps.get_from(&[]).await;

        assert_eq!(cached, first, "a fresh list is reused before another probe build");
        assert_eq!(cached["items"][0]["id"], "original");
    }

    #[tokio::test]
    async fn wake_is_allowlisted_and_never_reaches_a_door_for_a_refused_id() {
        let h = home("refuse");
        let a = Apps::default();
        assert_eq!(a.wake(&h, "").await.0, 400);
        assert_eq!(a.wake(&h, "../x").await.0, 400);
        assert_eq!(a.wake(&h, "Almanac").await.0, 400);
        assert_eq!(a.wake(&h, "nope").await.0, 404);
        assert_eq!(a.wake(&h, "modeldeck").await.0, 404);
        // always-on and hand-started apps are not the deck's to start
        for id in ["deals", "comfyui", "kodros-console"] {
            let (code, v) = a.wake(&h, id).await;
            assert_eq!((code, v["error"].as_str()), (409, Some("this app does not sleep")), "{id}");
        }
        // a refusal spends no rate slot
        assert!(a.wake_hist.lock().await.is_empty());
        let log = std::fs::read_to_string(h.join(".local/state/pixel-deck/actions.jsonl")).unwrap_or_default();
        assert_eq!(log.lines().count(), 8);
        assert!(log.lines().all(|l| l.contains(r#""act":"wake""#) && l.contains(r#""ok":false"#)));
        assert!(log.contains(r#""app":"bad""#) && log.contains(r#""app":"deals""#));
        let _ = std::fs::remove_dir_all(&h);
    }

    #[tokio::test]
    async fn wake_reads_the_gateway_answer_and_is_rate_limited() {
        let z = Duration::ZERO;
        let (Some(up), Some(starting), Some(nostart), Some(slow)) =
            (server(OK, z).await, server(STARTING, z).await, server(NOSTART, z).await, server(OK, Duration::from_secs(20)).await)
        else {
            panic!("no listener")
        };
        let gone = closed_port().await;
        let h = home("door");
        let at = |port: u16| Apps { door_base: Some(format!("http://127.0.0.1:{port}")), ..Apps::default() };
        let a = at(up);
        *a.slot.lock().await = Some((Instant::now(), json!({"items": []})));
        let (code, v) = a.wake(&h, "almanac").await;
        assert_eq!((code, v["state"].as_str(), v["id"].as_str(), v["name"].as_str()), (200, Some("up"), Some("almanac"), Some("Almanac")));
        assert!(a.slot.lock().await.is_none(), "a wake drops the cached list");
        // the next wake inside 4 s waits, whichever app it names
        let (code, v) = a.wake(&h, "paperwork").await;
        assert_eq!((code, v["error"].as_str()), (429, Some("rate limited")));
        assert!(v["retry_s"].as_u64().is_some_and(|s| (1..=4).contains(&s)));
        // eight a minute
        let mut hist = VecDeque::new();
        for _ in 0..PER_MINUTE {
            assert!(rate(&mut hist, Duration::ZERO, PER_MINUTE).is_ok());
        }
        assert!(rate(&mut hist, Duration::ZERO, PER_MINUTE).is_err());
        let (code, mut v) = at(starting).wake(&h, "localbolt").await;
        assert!(v["t"].is_u64());
        v["t"] = Value::Null;
        assert_eq!((code, v), (202, json!({"ok": true, "state": "starting", "id": "localbolt", "name": "LocalBolt", "t": null})));
        assert_eq!(at(nostart).wake(&h, "rolodex").await.1["error"], "could not start");
        assert_eq!(at(gone).wake(&h, "rolodex").await, (502, json!({"ok": false, "error": "the app gateway is not running"})));
        let (code, v) = at(slow).wake(&h, "hyperframes").await;
        assert_eq!((code, v["state"].as_str()), (202, Some("starting")), "the deck stops waiting; the gateway goes on starting it");
        let log = std::fs::read_to_string(h.join(".local/state/pixel-deck/actions.jsonl")).unwrap_or_default();
        assert_eq!(log.lines().filter(|l| l.contains(r#""ok":true"#)).count(), 3);
        let _ = std::fs::remove_dir_all(&h);
    }
}
