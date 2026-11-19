//! Saved jobs (owner order 2026-11-01). A star on a Life > Jobs row keeps that posting for Tanner, Casey or Riley, with a state
//! (saved, applied, interview, offer, passed) and the date of every change, so a posting stays tracked after it falls
//! out of the live feed. One JSON file at `~/.local/share/pixel-deck/saved-jobs.json`, mode 0600, replaced atomically
//! (write a 0600 temp file in the same directory, fsync, rename). Owner cookie only: `handle()` gates the route and the
//! guest allowlist never names it. Every field is validated; at most `CAP` postings per person.
use serde_json::{json, Map, Value};
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const REL: &str = ".local/share/pixel-deck/saved-jobs.json";
/// Morgan is a separate tenant: her list is read-only on the deck, so no tracker is kept for her here.
pub const PEOPLE: [&str; 3] = ["tanner", "casey", "riley"];
pub const STATES: [&str; 5] = ["saved", "applied", "interview", "offer", "passed"];
/// The POST state that drops a posting from the list.
pub const REMOVE: &str = "remove";
pub const CAP: usize = 500;
pub const MAX_BODY: usize = 4096;
/// A state history longer than this keeps its first and newest changes.
const MAX_HISTORY: usize = 24;

/// One writer at a time inside this process; the rename keeps readers whole.
static LOCK: Mutex<()> = Mutex::new(());

pub fn path(home: &Path) -> PathBuf {
    home.join(REL)
}

pub fn person_ok(p: &str) -> bool {
    PEOPLE.contains(&p)
}

/// Text a row may show: trimmed, no control characters, within `max` characters. Empty stays empty.
fn text(v: Option<&Value>, max: usize) -> Result<String, &'static str> {
    let s = match v {
        None | Some(Value::Null) => return Ok(String::new()),
        Some(Value::String(s)) => s.trim(),
        Some(_) => return Err("not text"),
    };
    if s.chars().any(char::is_control) {
        return Err("control character");
    }
    if s.chars().count() > max {
        return Err("too long");
    }
    Ok(s.to_string())
}

/// An http(s) link the page may open: no spaces, quotes or angle brackets, no user part. Empty is allowed.
fn url_ok(u: &str) -> bool {
    if u.is_empty() {
        return true;
    }
    let rest = u.strip_prefix("https://").or_else(|| u.strip_prefix("http://"));
    let Some(rest) = rest else { return false };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    u.len() <= 400
        && !host.is_empty()
        && !host.contains('@')
        && !u.chars().any(|c| c.is_whitespace() || c.is_control() || "\"'<>\\`".contains(c))
}

/// A validated POST: who, which posting (the page's `jobKey`), what it shows, and the new state or `remove`.
#[derive(Debug, PartialEq)]
pub struct Change {
    pub person: String,
    pub key: String,
    pub title: String,
    pub company: String,
    pub url: String,
    pub state: String,
}

pub fn parse(body: &[u8]) -> Result<Change, &'static str> {
    if body.len() > MAX_BODY {
        return Err("too large");
    }
    let v: Value = serde_json::from_slice(body).map_err(|_| "bad json")?;
    let o = v.as_object().ok_or("bad json")?;
    let person = text(o.get("person"), 10)?;
    if !person_ok(&person) {
        return Err("bad person");
    }
    let key = text(o.get("key"), 200)?;
    if key.is_empty() {
        return Err("bad key");
    }
    let state = text(o.get("state"), 12)?;
    if !STATES.contains(&state.as_str()) && state != REMOVE {
        return Err("bad state");
    }
    let title = text(o.get("title"), 140)?;
    if title.is_empty() && state != REMOVE {
        return Err("bad title");
    }
    let company = text(o.get("company"), 80)?;
    let url = text(o.get("url"), 400)?;
    if !url_ok(&url) {
        return Err("bad url");
    }
    Ok(Change { person, key, title, company, url, state })
}

/// The whole store. A missing file is an empty store; an unreadable or malformed one is an error, so a write never
/// replaces a file this code could not read.
pub fn load(file: &Path) -> Result<Map<String, Value>, String> {
    let raw = match std::fs::read(file) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(e) => return Err(format!("store unreadable: {}", e.kind())),
    };
    match serde_json::from_slice::<Value>(&raw) {
        Ok(Value::Object(m)) => Ok(m),
        _ => Err("store is not a JSON object".into()),
    }
}

fn items(store: &Map<String, Value>, person: &str) -> Vec<Value> {
    store
        .get("people")
        .and_then(|p| p.get(person))
        .and_then(Value::as_array)
        .map(|a| a.iter().filter(|x| x.is_object()).cloned().collect())
        .unwrap_or_default()
}

/// Writes the store: 0700 directory, 0600 temp file, fsync, rename over the old file.
fn save(file: &Path, store: &Map<String, Value>) -> Result<(), String> {
    let dir = file.parent().ok_or("no store directory")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("mkdir: {}", e.kind()))?;
    let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    let tmp = dir.join(format!(".saved-jobs.{}.tmp", std::process::id()));
    let body = serde_json::to_vec_pretty(&Value::Object(store.clone())).map_err(|_| "encode".to_string())?;
    let write = || -> std::io::Result<()> {
        let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&tmp)?;
        f.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        f.write_all(&body)?;
        f.sync_all()?;
        std::fs::rename(&tmp, file)
    };
    write().map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("write: {}", e.kind())
    })
}

/// Applies one change at `now` and returns the person's new list. `Err((status, reason))` refuses it.
pub fn apply(file: &Path, c: &Change, now: u64) -> Result<Vec<Value>, (u16, String)> {
    let _g = LOCK.lock().map_err(|_| (500, "store lock poisoned".to_string()))?;
    let mut store = load(file).map_err(|e| (500, e))?;
    let mut list = items(&store, &c.person);
    let at = list.iter().position(|x| x.get("key").and_then(Value::as_str) == Some(c.key.as_str()));
    match (at, c.state.as_str()) {
        (Some(i), REMOVE) => {
            list.remove(i);
        }
        (None, REMOVE) => return Err((404, "not saved".into())),
        (Some(i), st) => {
            let it = &mut list[i];
            if it.get("state").and_then(Value::as_str) != Some(st) {
                let mut hist: Vec<Value> = it.get("history").and_then(Value::as_array).cloned().unwrap_or_default();
                hist.push(json!({"state": st, "at": now}));
                if hist.len() > MAX_HISTORY {
                    hist.drain(1..hist.len() - (MAX_HISTORY - 1));
                }
                it["state"] = json!(st);
                it["history"] = Value::Array(hist);
            }
            it["updated_at"] = json!(now);
            // a later save refreshes what the row shows (a reposted title or a new link), never the key
            it["title"] = json!(c.title);
            if !c.company.is_empty() {
                it["company"] = json!(c.company);
            }
            if !c.url.is_empty() {
                it["url"] = json!(c.url);
            }
        }
        (None, st) => {
            if list.len() >= CAP {
                return Err((409, format!("{} already has {CAP} saved jobs", c.person)));
            }
            list.push(json!({"key": c.key, "title": c.title, "company": c.company, "url": c.url, "state": st,
                "saved_at": now, "updated_at": now, "history": [{"state": st, "at": now}]}));
        }
    }
    let people = store.entry("people").or_insert_with(|| json!({}));
    if !people.is_object() {
        *people = json!({});
    }
    people[c.person.as_str()] = Value::Array(list.clone());
    store.insert("version".into(), json!(1));
    store.insert("updated_at".into(), json!(now));
    save(file, &store).map_err(|e| (500, e))?;
    Ok(list)
}

fn listing(person: &str, list: Vec<Value>, now: u64) -> Value {
    json!({"person": person, "items": list, "cap": CAP, "states": STATES, "t": now})
}

/// GET `?person=` or POST a JSON `Change`. Returns (status, body).
pub async fn route(home: &Path, post: bool, person: Option<&str>, body: Option<bytes::Bytes>) -> (u16, Value) {
    let file = path(home);
    let now = crate::util::now_epoch();
    if !post {
        let p = person.unwrap_or("");
        if !person_ok(p) {
            return (400, json!({"error": "bad person"}));
        }
        let p = p.to_string();
        let got = tokio::task::spawn_blocking(move || load(&file).map(|s| items(&s, &p))).await;
        return match got {
            Ok(Ok(list)) => (200, listing(person.unwrap_or(""), list, now)),
            Ok(Err(e)) => (500, json!({"error": e})),
            Err(_) => (500, json!({"error": "store read failed"})),
        };
    }
    let Some(b) = body else { return (400, json!({"error": "bad json"})) };
    let c = match parse(&b) {
        Ok(c) => c,
        Err(e) => return (if e == "too large" { 413 } else { 400 }, json!({"error": e})),
    };
    let who = c.person.clone();
    match tokio::task::spawn_blocking(move || apply(&file, &c, now)).await {
        Ok(Ok(list)) => (200, json!({"ok": true, "person": who, "items": list, "cap": CAP, "states": STATES, "t": now})),
        Ok(Err((code, e))) => (code, json!({"ok": false, "error": e})),
        Err(_) => (500, json!({"ok": false, "error": "store write failed"})),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("pdeck-saved-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    fn body(v: Value) -> Vec<u8> {
        serde_json::to_vec(&v).unwrap_or_default()
    }

    fn ch(person: &str, key: &str, state: &str) -> Change {
        Change { person: person.into(), key: key.into(), title: "SDR".into(), company: "Acme".into(), url: "https://example.com/j".into(), state: state.into() }
    }

    #[test]
    fn parse_accepts_a_good_change_and_refuses_bad_fields() {
        let ok = parse(&body(json!({"person":"casey","key":"sdr|acme|irvine, ca","title":" SDR ","company":"Acme","url":"https://example.com/j?a=1","state":"applied"})));
        assert_eq!(ok, Ok(Change { person: "casey".into(), key: "sdr|acme|irvine, ca".into(), title: "SDR".into(), company: "Acme".into(), url: "https://example.com/j?a=1".into(), state: "applied".into() }));
        let base = json!({"person":"tanner","key":"k","title":"T","company":"C","url":"","state":"saved"});
        let with = |k: &str, v: Value| {
            let mut b = base.clone();
            b[k] = v;
            parse(&body(b))
        };
        assert!(with("url", json!("")).is_ok(), "no link is allowed");
        assert_eq!(with("person", json!("morgan")), Err("bad person"));
        assert_eq!(with("person", json!(1)), Err("not text"));
        assert_eq!(with("key", json!("")), Err("bad key"));
        assert_eq!(with("key", json!("x".repeat(201))), Err("too long"));
        assert_eq!(with("key", json!("a\nb")), Err("control character"));
        assert_eq!(with("state", json!("hired")), Err("bad state"));
        assert_eq!(with("title", json!("")), Err("bad title"));
        assert!(with("title", json!("")).is_err());
        for bad in ["javascript:alert(1)", "ftp://x", "https://", "https://a b", "https://u@evil.com/", "https://x/\"><script>", "//evil.com"] {
            assert_eq!(with("url", json!(bad)), Err("bad url"), "{bad}");
        }
        assert!(parse(b"not json").is_err());
        assert!(parse(b"[1,2]").is_err());
        assert_eq!(parse(&vec![b' '; MAX_BODY + 1]), Err("too large"));
        // remove needs no title
        let mut r = base.clone();
        r["state"] = json!("remove");
        r["title"] = json!("");
        assert!(parse(&body(r)).is_ok());
    }

    #[test]
    fn apply_saves_tracks_dates_and_persists_0600() {
        let d = tmp("persist");
        let f = d.join("saved-jobs.json");
        let Ok(l) = apply(&f, &ch("casey", "k1", "saved"), 100) else { panic!("save") };
        assert_eq!(l.len(), 1);
        let Ok(l) = apply(&f, &ch("casey", "k1", "applied"), 200) else { panic!("applied") };
        assert_eq!(l[0]["state"], "applied");
        assert_eq!(l[0]["saved_at"], 100);
        assert_eq!(l[0]["history"], json!([{"state":"saved","at":100},{"state":"applied","at":200}]));
        // the same state again is no new history line
        let Ok(l) = apply(&f, &ch("casey", "k1", "applied"), 300) else { panic!("again") };
        assert_eq!(l[0]["history"].as_array().map(Vec::len), Some(2));
        assert_eq!(l[0]["updated_at"], 300);
        // the other person's list is separate
        let Ok(t) = apply(&f, &ch("tanner", "k1", "saved"), 400) else { panic!("tanner") };
        assert_eq!(t.len(), 1);
        // reread from disk: both lists, file 0600, dir 0700, no temp file left
        let Ok(s) = load(&f) else { panic!("load") };
        assert_eq!(items(&s, "casey")[0]["state"], "applied");
        assert_eq!(items(&s, "tanner")[0]["state"], "saved");
        assert_eq!(s["version"], 1);
        let mode = |p: &Path| std::fs::metadata(p).map(|m| m.permissions().mode() & 0o777).unwrap_or(0);
        assert_eq!(mode(&f), 0o600);
        assert_eq!(mode(&d), 0o700);
        let left: Vec<_> = std::fs::read_dir(&d).map(|r| r.flatten().map(|e| e.file_name()).collect()).unwrap_or_default();
        assert_eq!(left.len(), 1, "{left:?}");
        // remove, and removing again says not saved
        let Ok(l) = apply(&f, &ch("casey", "k1", REMOVE), 500) else { panic!("remove") };
        assert!(l.is_empty());
        assert_eq!(apply(&f, &ch("casey", "k1", REMOVE), 600).map(|_| ()), Err((404, "not saved".into())));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn cap_is_per_person_and_a_bad_file_is_never_replaced() {
        let d = tmp("cap");
        let f = d.join("saved-jobs.json");
        let full: Vec<Value> = (0..CAP).map(|i| json!({"key": format!("k{i}"), "title": "T", "state": "saved"})).collect();
        let Ok(()) = std::fs::create_dir_all(&d) else { panic!("mkdir") };
        let Ok(()) = std::fs::write(&f, serde_json::to_vec(&json!({"people": {"tanner": full}})).unwrap_or_default()) else { panic!("seed") };
        assert_eq!(apply(&f, &ch("tanner", "new", "saved"), 1).map(|_| ()).map_err(|e| e.0), Err(409));
        // an existing posting can still change state at the cap, and Casey still has room
        assert!(apply(&f, &ch("tanner", "k3", "applied"), 2).is_ok());
        assert!(apply(&f, &ch("casey", "new", "saved"), 3).is_ok());
        let Ok(()) = std::fs::write(&f, b"{oops") else { panic!("corrupt") };
        assert_eq!(apply(&f, &ch("casey", "x", "saved"), 4).map(|_| ()).map_err(|e| e.0), Err(500));
        assert_eq!(std::fs::read(&f).unwrap_or_default(), b"{oops", "a file this code could not read is left alone");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn history_stays_bounded() {
        let d = tmp("hist");
        let f = d.join("saved-jobs.json");
        for i in 0..60u64 {
            let st = STATES[(i % 5) as usize];
            let _ = apply(&f, &ch("tanner", "k", st), 1000 + i);
        }
        let Ok(s) = load(&f) else { panic!("load") };
        let h = items(&s, "tanner")[0]["history"].as_array().cloned().unwrap_or_default();
        assert_eq!(h.len(), MAX_HISTORY);
        assert_eq!(h[0]["at"], 1000, "the first save stays");
        assert_eq!(h[MAX_HISTORY - 1]["at"], 1059, "the newest change stays");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[tokio::test]
    async fn route_get_and_post_round_trip() {
        let home = tmp("route");
        let (c, v) = route(&home, false, Some("casey"), None).await;
        assert_eq!((c, v["items"].as_array().map(Vec::len)), (200, Some(0)), "a missing file is an empty list");
        assert_eq!(route(&home, false, Some("nobody"), None).await.0, 400);
        assert_eq!(route(&home, false, None, None).await.0, 400);
        let b = bytes::Bytes::from(body(json!({"person":"casey","key":"k","title":"Account executive","company":"Medline","url":"https://example.com/a","state":"interview"})));
        let (c, v) = route(&home, true, None, Some(b)).await;
        assert_eq!((c, v["ok"].clone()), (200, json!(true)));
        let (c, v) = route(&home, false, Some("casey"), None).await;
        assert_eq!(c, 200);
        assert_eq!(v["items"][0]["state"], "interview");
        assert_eq!(v["states"], json!(STATES));
        assert_eq!(route(&home, true, None, Some(bytes::Bytes::from_static(b"{}"))).await.0, 400);
        assert_eq!(route(&home, true, None, None).await.0, 400);
        let _ = std::fs::remove_dir_all(&home);
    }
}
