//! Where the deck's own page errors go: `POST /api/client-error` takes one bounded report from the page (an uncaught
//! error, an unhandled rejection, a section that failed to draw, a report-only policy violation) and appends it to
//! `~/.local/state/pixel-deck/client-error.jsonl` beside the camera beacon's log; `GET /api/client-error` gives Home >
//! Fleet its count for the last 24 hours and the five newest rows.
//!
//! Fences, the camera beacon's: a 2,048-byte body (413 above, read in `main.rs`), JSON only, CSRF as every POST, the
//! owner only (the guest and desk-viewer allowlists never name the route), whitelisted fields with checked values (an
//! unknown `e`, a route that is not a page, a `src` that is not a script basename: 400), the message scrubbed of
//! credentials and query strings and cut to 120 characters, 60 reports a minute, and the file capped at 256 KB.
use crate::actions::{append_capped, limited, rate, scrub};
use crate::util;
use serde_json::{json, Map, Value};
use std::collections::VecDeque;
use std::path::Path;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

pub const FILE: &str = "client-error.jsonl";
/// The largest request body the route reads.
pub const MAX_BODY: usize = 2048;
/// The log is halved past this size, newest rows kept.
pub const CAP: u64 = 256 * 1024;
/// Reports a minute, across every page.
const PER_MIN: usize = 60;
/// The kinds of report a page may send.
pub const KINDS: [&str; 4] = ["error", "rejection", "render", "csp"];
/// Rows `GET` returns, newest first.
const LAST: usize = 5;
const DAY: u64 = 24 * 3600;
/// Line and column numbers above this are not a real position.
const MAX_POS: u64 = 100_000_000;

#[derive(Default)]
pub struct ClientErrors {
    hist: Mutex<VecDeque<Instant>>,
}

fn bad(field: &str) -> (u16, Value) {
    (400, json!({"ok": false, "error": "bad report", "field": field}))
}

/// The page route, the rule of `app.js` `DEEP`: one or two lower-case words of 2 to 16 letters. Empty: no route.
fn route_ok(s: &str) -> bool {
    let word = |w: &str| (2..=16).contains(&w.len()) && w.bytes().all(|b| b.is_ascii_lowercase());
    s.is_empty()
        || match s.split_once('/') {
            Some((a, b)) => word(a) && word(b),
            None => word(s),
        }
}

/// A script file's basename (`deck.js`, `hls.min.js`), never a path or a URL. Empty: not known.
fn src_ok(s: &str) -> bool {
    s.is_empty()
        || ((4..=64).contains(&s.len())
            && s.ends_with(".js")
            && !s.starts_with('.')
            && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b)))
}

/// The shell build the page runs: 16 lower-case hex digits. Empty: not known.
fn build_ok(s: &str) -> bool {
    s.is_empty() || (s.len() == 16 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}

/// The one clean row a report becomes, or the 400 that names the first field refused. Fields outside the list are
/// dropped unread.
pub fn clean(body: &[u8]) -> Result<Map<String, Value>, (u16, Value)> {
    let Ok(Value::Object(v)) = serde_json::from_slice::<Value>(body) else {
        return Err(bad("body"));
    };
    let text = |k: &str| -> Result<&str, (u16, Value)> {
        match v.get(k) {
            None | Some(Value::Null) => Ok(""),
            Some(Value::String(s)) => Ok(s.as_str()),
            Some(_) => Err(bad(k)),
        }
    };
    let pos = |k: &str| -> Result<Value, (u16, Value)> {
        match v.get(k) {
            None | Some(Value::Null) => Ok(Value::Null),
            Some(n) => n.as_u64().filter(|n| *n <= MAX_POS).map(Value::from).ok_or_else(|| bad(k)),
        }
    };
    let e = text("e")?;
    if !KINDS.contains(&e) {
        return Err(bad("e"));
    }
    let route = text("route")?;
    if !route_ok(route) {
        return Err(bad("route"));
    }
    let src = text("src")?;
    if !src_ok(src) {
        return Err(bad("src"));
    }
    let build = text("build")?;
    if !build_ok(build) {
        return Err(bad("build"));
    }
    let (line, col) = (pos("line")?, pos("col")?);
    let msg = scrub(text("msg")?, 120);
    let mut row = Map::new();
    row.insert("e".into(), e.into());
    row.insert("route".into(), route.into());
    row.insert("src".into(), src.into());
    row.insert("line".into(), line);
    row.insert("col".into(), col);
    row.insert("msg".into(), msg.into());
    row.insert("build".into(), build.into());
    Ok(row)
}

impl ClientErrors {
    /// One report: checked, rate limited, appended with its time and the scrubbed user agent.
    pub async fn post(&self, home: &Path, body: &[u8], ua: &str) -> (u16, Value) {
        let mut row = match clean(body) {
            Ok(r) => r,
            Err(r) => return r,
        };
        // the lock is held through the write, so two reports never halve the file at once
        let mut h = self.hist.lock().await;
        if let Err(wait) = rate(&mut h, Duration::ZERO, PER_MIN) {
            return limited(wait);
        }
        row.insert("t".into(), util::now_epoch().into());
        row.insert("ua".into(), scrub(ua, 160).into());
        if append_capped(home, FILE, &Value::Object(row), CAP).is_err() {
            return (502, json!({"ok": false, "error": "log unavailable"}));
        }
        (200, json!({"ok": true}))
    }
}

/// How much of the log one GET reads: the newest rows only, so Home's poll never parses the whole capped file.
pub const TAIL: u64 = 64 * 1024;

/// The last `TAIL` bytes of the log from the first whole row, and whether older rows were left unread.
fn tail(path: &Path) -> std::io::Result<(String, bool)> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path)?;
    let len = f.metadata()?.len();
    // one byte more than the tail, so a row that starts exactly at the cut is kept: the byte before it is its `\n`
    let start = len.saturating_sub(TAIL + 1);
    f.seek(SeekFrom::Start(start))?;
    let mut b = Vec::with_capacity((len - start) as usize);
    f.read_to_end(&mut b)?;
    let cut = start > 0;
    // a read that starts mid-row drops that partial row
    let from = if cut { b.iter().position(|c| *c == b'\n').map_or(b.len(), |n| n + 1) } else { 0 };
    Ok((String::from_utf8_lossy(&b[from..]).into_owned(), cut))
}

/// `{ok, n_24h, last, t}` plus `partial`: reports in the 24 hours before `now`, and the five newest rows (any age,
/// newest first, without the user agent), read from the newest 64 KB of the log. `partial` is true when older rows
/// were left unread and the oldest row read is still inside the 24 hours, so `n_24h` is a floor ("300 or more").
/// No file yet is zero reports.
pub fn recent(home: &Path, now: u64) -> (u16, Value) {
    let path = home.join(".local/state/pixel-deck").join(FILE);
    let (text, cut) = match tail(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (String::new(), false),
        Err(_) => return (502, json!({"ok": false, "error": "log unavailable"})),
    };
    let rows: Vec<Value> = text.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).filter(Value::is_object).collect();
    let in_day = |r: &Value| r["t"].as_u64().is_some_and(|t| t + DAY > now);
    let n_24h = rows.iter().filter(|r| in_day(r)).count();
    let partial = cut && rows.first().is_some_and(in_day);
    let keys = ["t", "e", "route", "src", "line", "col", "msg", "build"];
    let last: Vec<Value> = rows
        .iter()
        .rev()
        .take(LAST)
        .map(|r| Value::Object(keys.iter().map(|k| (k.to_string(), r[*k].clone())).collect()))
        .collect();
    (200, json!({"ok": true, "n_24h": n_24h, "partial": partial, "last": last, "t": now}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home(tag: &str) -> std::path::PathBuf {
        let h = std::env::temp_dir().join(format!("pdeck-clienterr-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&h);
        h
    }

    #[test]
    fn whitelisted_fields_only_with_checked_values() {
        let Ok(row) = clean(br#"{"e":"render","route":"shop/market","src":"shop.js","line":12,"col":3,"msg":"x is undefined","build":"0123456789abcdef","cookie":"PRIVATE","extra":{"a":1}}"#) else {
            panic!("a good report was refused")
        };
        let keys: Vec<&str> = row.keys().map(String::as_str).collect();
        assert_eq!(keys.len(), 7, "{keys:?}");
        assert!(row.get("cookie").is_none() && row.get("extra").is_none());
        assert_eq!((row["e"].as_str(), row["route"].as_str(), row["line"].as_u64()), (Some("render"), Some("shop/market"), Some(12)));
        // the bare minimum: a kind
        assert!(clean(br#"{"e":"csp"}"#).is_ok());
        for (body, field) in [
            (&br#"{"e":"panic"}"#[..], "e"),
            (br#"{"e":"ERROR"}"#, "e"),
            (br#"{}"#, "e"),
            (br#"{"e":1}"#, "e"),
            (br#"{"e":"error","route":"Shop"}"#, "route"),
            (br#"{"e":"error","route":"shop/market/x"}"#, "route"),
            (br#"{"e":"error","route":"a"}"#, "route"),
            (br#"{"e":"error","src":"https://evil.example/x.js"}"#, "src"),
            (br#"{"e":"error","src":"../deck.js"}"#, "src"),
            (br#"{"e":"error","src":"deck.html"}"#, "src"),
            (br#"{"e":"error","line":-1}"#, "line"),
            (br#"{"e":"error","col":"3"}"#, "col"),
            (br#"{"e":"error","line":1.5}"#, "line"),
            (br#"{"e":"error","msg":{"a":1}}"#, "msg"),
            (br#"{"e":"error","build":"XYZ"}"#, "build"),
            (br#"{"e":"error","build":"0123456789ABCDEF"}"#, "build"),
            (br#"[1,2]"#, "body"),
            (br#"not json"#, "body"),
        ] {
            match clean(body) {
                Ok(r) => panic!("{} passed: {r:?}", String::from_utf8_lossy(body)),
                Err((code, v)) => assert_eq!((code, v["field"].as_str()), (400, Some(field)), "{}", String::from_utf8_lossy(body)),
            }
        }
    }

    #[test]
    fn validation_accepts_boundary_routes_sources_and_positions() {
        let body = json!({
            "e": "error",
            "route": "ab/abcdefghijklmnop",
            "src": format!("{}.js", "a".repeat(61)),
            "line": 100_000_000,
            "col": 0,
            "build": "0123456789abcdef"
        });

        let Ok(row) = clean(body.to_string().as_bytes()) else {
            panic!("boundary values were refused")
        };

        assert_eq!(row["route"], "ab/abcdefghijklmnop");
        assert_eq!(row["src"], format!("{}.js", "a".repeat(61)));
        assert_eq!(row["line"], 100_000_000);
        assert_eq!(row["col"], 0);
    }

    #[test]
    fn validation_rejects_values_past_the_route_source_and_position_limits() {
        for (body, field) in [
            (
                json!({"e":"error","route":format!("{}/x", "a".repeat(17))}),
                "route",
            ),
            (
                json!({"e":"error","src":format!("{}.js", "a".repeat(62))}),
                "src",
            ),
            (json!({"e":"error","line":100_000_001}), "line"),
            (json!({"e":"error","col":100_000_001}), "col"),
        ] {
            match clean(body.to_string().as_bytes()) {
                Ok(row) => panic!("{field} boundary unexpectedly passed: {row:?}"),
                Err((code, value)) => {
                    assert_eq!((code, value["field"].as_str()), (400, Some(field)));
                }
            }
        }
    }

    #[test]
    fn message_is_scrubbed_and_cut() {
        // assembled at run time: a token-shaped literal in source would trip gitleaks
        let secret = ["abc123", "def456ghi789"].concat();
        let body = json!({"e": "error", "msg": format!("failed https://host/api/x?t={secret} token={secret} {}", "y".repeat(400))});
        let Ok(row) = clean(body.to_string().as_bytes()) else { panic!("refused") };
        let msg = row["msg"].as_str().unwrap_or("");
        assert!(!msg.contains(&secret), "{msg}");
        assert!(msg.chars().count() <= 120);
        assert!(msg.starts_with("failed https://host/api/x"));
    }

    #[tokio::test]
    async fn reports_land_capped_and_count_for_the_fleet_line() {
        let h = home("log");
        let log = ClientErrors::default();
        let (code, _) = recent(&h, 1000);
        assert_eq!(code, 200, "no file is zero reports");
        assert_eq!(recent(&h, 1000).1, json!({"ok": true, "n_24h": 0, "partial": false, "last": [], "t": 1000}));
        for i in 0..3 {
            let body = json!({"e": "render", "route": "shop/market", "src": "shop.js", "line": i, "msg": format!("boom {i}")});
            let (code, v) = log.post(&h, body.to_string().as_bytes(), "Agent/1?token=PRIVATE").await;
            assert_eq!((code, v["ok"].as_bool()), (200, Some(true)));
        }
        let now = util::now_epoch();
        let (code, v) = recent(&h, now);
        assert_eq!((code, v["n_24h"].as_u64()), (200, Some(3)));
        assert_eq!(v["last"][0]["msg"], "boom 2", "newest first");
        assert_eq!(v["last"][0]["route"], "shop/market");
        assert!(v["last"][0].get("ua").is_none());
        let file = h.join(".local/state/pixel-deck").join(FILE);
        let Ok(text) = std::fs::read_to_string(&file) else { panic!("no log") };
        assert!(!text.contains("PRIVATE"));
        // a day later the rows still list, but no longer count
        assert_eq!(recent(&h, now + DAY + 1).1["n_24h"], 0);
        assert_eq!(recent(&h, now + DAY + 1).1["last"].as_array().map(Vec::len), Some(3));
        // the cap: a full file is halved at a line start and the newest row survives
        let old = format!("{}\n", json!({"t": 1, "e": "error", "msg": "x".repeat(100)}));
        let Ok(()) = std::fs::write(&file, old.repeat((CAP as usize / old.len()) + 1)) else { panic!("seed") };
        let (code, _) = log.post(&h, br#"{"e":"csp","msg":"newest"}"#, "").await;
        assert_eq!(code, 200);
        let Ok(text) = std::fs::read_to_string(&file) else { panic!("no log") };
        assert!(text.len() as u64 <= CAP, "{} bytes", text.len());
        assert!(text.lines().all(|l| serde_json::from_str::<Value>(l).is_ok()), "a row was cut mid-line");
        assert!(text.lines().last().is_some_and(|l| l.contains("newest")));
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn a_get_reads_only_the_newest_64_kb() {
        let h = home("tail");
        let dir = h.join(".local/state/pixel-deck");
        let Ok(()) = std::fs::create_dir_all(&dir) else { panic!("dir") };
        let row = |t: u64, m: &str| format!("{}\n", json!({"t": t, "e": "error", "msg": m}));
        // rows of exactly 128 bytes: the 64 KB tail starts exactly at a row, so a whole row at the cut must be kept
        let new = row(1_000_000, &"n".repeat(93));
        assert_eq!(new.len(), 128);
        let old = row(1, &"o".repeat(90));
        // 200 KB of old rows, then 200 KB of rows from today
        let body = format!("{}{}", old.repeat(200 * 1024 / old.len()), new.repeat(200 * 1024 / new.len()));
        let Ok(()) = std::fs::write(dir.join(FILE), &body) else { panic!("seed") };
        let (code, v) = recent(&h, 1_000_100);
        assert_eq!((code, v["n_24h"].as_u64()), (200, Some(TAIL / 128)), "every row of the tail, none cut, none older");
        assert_eq!(v["partial"], true, "older rows were left unread and the oldest read is from today");
        assert_eq!(v["last"].as_array().map(Vec::len), Some(5));
        // the tail reaches back past today: nothing unread counts, so the count is whole
        let Ok(()) = std::fs::write(dir.join(FILE), format!("{}{}", old.repeat(1000), new.repeat(10))) else { panic!("seed") };
        assert_eq!((recent(&h, 1_000_100).1["n_24h"].as_u64(), recent(&h, 1_000_100).1["partial"].as_bool()), (Some(10), Some(false)));
        // a short file is read whole
        let Ok(()) = std::fs::write(dir.join(FILE), new.repeat(3)) else { panic!("seed") };
        assert_eq!((recent(&h, 1_000_100).1["n_24h"].as_u64(), recent(&h, 1_000_100).1["partial"].as_bool()), (Some(3), Some(false)));
        let _ = std::fs::remove_dir_all(&h);
    }

    #[tokio::test]
    async fn sixty_a_minute() {
        let h = home("rate");
        let log = ClientErrors::default();
        for _ in 0..PER_MIN {
            assert_eq!(log.post(&h, br#"{"e":"error"}"#, "").await.0, 200);
        }
        let (code, v) = log.post(&h, br#"{"e":"error"}"#, "").await;
        assert_eq!((code, v["error"].as_str()), (429, Some("rate limited")));
        // a refused report never spends the budget or touches the file
        assert_eq!(log.post(&h, br#"{"e":"nope"}"#, "").await.0, 400);
        let _ = std::fs::remove_dir_all(&h);
    }
}
