//! Commerce tab (GET /api/commerce): Amazon orders and return deadlines, read-only.
//! Source: `~/.hermes/watcher-state/purchases-ledger.json`, written by the Hermes cron "Money - Purchase monitor"
//! (purchase_tracker.py, daily 05:40 PT, Gmail-fed) plus manual rows added by an agent from the owner's Amazon
//! Your Orders page. Only Amazon rows leave the machine, and only: id, title, date, return_by, amount, currency and
//! whether the row was entered by hand. Mail thread ids, senders and every other vendor stay here.
//! `monitor` (deck 2026-10-29, C2) says whether that cron is enabled, paused by the owner or missing, read from
//! `~/.hermes/cron/jobs.json`: name, state and run times only, never the prompt, script or pause note.
use crate::sources::{self, Def};
use crate::util::{iso_to_epoch, now_epoch};
use serde_json::{json, Value};
use std::path::Path;

pub const LEDGER: Def = Def {
    name: "purchases",
    rel: ".hermes/watcher-state/purchases-ledger.json",
    refresh: 86_400,
    ttl: 60,
};
const MAX_ORDERS: usize = 20;
const MAX_PULLS: usize = 4;
/// Hermes cron list (read only here; `crons.rs` owns the full Crons tab view of it).
const JOBS_REL: &str = ".hermes/cron/jobs.json";
/// The monitor job's name starts with this; the clock time in brackets may change.
const MONITOR_NAME: &str = "Money - Purchase monitor";

pub async fn get(home: &Path) -> Value {
    let jobs = sources::read(&home.join(JOBS_REL)).await.ok().map(|(t, _)| t);
    match sources::read(&home.join(LEDGER.rel)).await {
        Ok((text, mtime)) => with_monitor(from_text(&text, mtime, now_epoch()), jobs.as_deref(), Some(&text)),
        Err(e) => with_monitor(sources::fail(&LEDGER, e), jobs.as_deref(), None),
    }
}

fn with_monitor(mut v: Value, jobs: Option<&str>, ledger: Option<&str>) -> Value {
    let ledger_run = ledger
        .and_then(|t| serde_json::from_str::<Value>(t).ok())
        .and_then(|l| l.get("last_run_at").and_then(Value::as_str).map(str::to_string));
    v["monitor"] = monitor_from(jobs, ledger_run.as_deref());
    v
}

/// C2: `{state: "enabled"|"paused"|"missing", name, last_run_at, paused_at}`. `missing` covers an unreadable jobs file
/// and a list without the job, so the page never claims a monitor that is not there. `paused` is the owner's own stop
/// (enabled false or state paused), the same test `crons.rs` uses for its Paused column.
pub fn monitor_from(jobs: Option<&str>, ledger_run: Option<&str>) -> Value {
    let job = jobs
        .and_then(|t| serde_json::from_str::<Value>(t).ok())
        .and_then(|v| v.get("jobs").and_then(Value::as_array).cloned())
        .and_then(|list| list.into_iter().find(|j| clean(j.get("name"), 80).starts_with(MONITOR_NAME)));
    let Some(j) = job else {
        return json!({"state": "missing", "name": MONITOR_NAME, "last_run_at": ledger_run, "paused_at": Value::Null});
    };
    let active = j.get("enabled").and_then(Value::as_bool) == Some(true)
        && j.get("state").and_then(Value::as_str) != Some("paused");
    let stamp = |v: Option<&Value>| Some(clean(v, 40)).filter(|s| !s.is_empty());
    json!({
        "state": if active { "enabled" } else { "paused" },
        "name": clean(j.get("name"), 60),
        "last_run_at": stamp(j.get("last_run_at")).or_else(|| ledger_run.map(str::to_string)),
        "paused_at": if active { None } else { stamp(j.get("paused_at")) },
    })
}

/// Printable text, at most `n` characters.
fn clean(v: Option<&Value>, n: usize) -> String {
    v.and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .filter(|c| !c.is_control())
        .take(n)
        .collect::<String>()
        .trim()
        .to_string()
}

/// `YYYY-MM-DD` (the first ten characters of a date or a timestamp), else None.
fn day(v: Option<&Value>) -> Option<String> {
    let s = v.and_then(Value::as_str)?.trim();
    let d = s.get(..10)?;
    let b = d.as_bytes();
    let digits = |r: std::ops::Range<usize>| b[r].iter().all(u8::is_ascii_digit);
    (b[4] == b'-' && b[7] == b'-' && digits(0..4) && digits(5..7) && digits(8..10)).then(|| d.to_string())
}

/// The item name from a mail subject or a manual note: "Delivered 2026-10-21: NuPhy ..." reads "NuPhy ...".
fn title(subject: &str) -> String {
    let mut t = subject.trim();
    for p in ["Delivered:", "Shipped:", "Ordered:", "Your Amazon.com order of", "Your order of"] {
        if let Some(r) = t.strip_prefix(p) {
            t = r.trim();
        }
    }
    if let Some((head, rest)) = t.split_once(':') {
        let h = head.trim();
        if h.starts_with("Delivered") || h.starts_with("Shipped") || h.starts_with("Ordered") {
            t = rest.trim();
        }
    }
    // a note about the return window belongs in `return_by`, not in the item name
    if let Some(i) = t.to_ascii_lowercase().find(" (return") {
        t = &t[..i];
    }
    t.trim_matches(|c: char| c == '"' || c == '\'').trim().to_string()
}

fn is_amazon(r: &Value) -> bool {
    let v = clean(r.get("vendor"), 40).to_ascii_lowercase();
    v == "amazon" || v.starts_with("amazon.") || v == "amazon.com"
}

pub fn from_text(text: &str, mtime: Option<u64>, now: u64) -> Value {
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return sources::fail(&LEDGER, "bad json");
    };
    let Some(rows) = v.get("purchases").and_then(Value::as_array) else {
        return sources::fail(&LEDGER, "no purchases list");
    };
    let mut orders: Vec<Value> = rows
        .iter()
        .filter(|r| r.is_object() && is_amazon(r))
        .map(|r| {
            let t = title(&clean(r.get("subject"), 160));
            json!({
                "id": clean(r.get("id"), 80),
                "title": if t.is_empty() { "Amazon order".to_string() } else { t.chars().take(100).collect() },
                "date": day(r.get("received_at")).or_else(|| day(r.get("captured_at"))),
                "return_by": day(r.get("return_by")),
                "amount": r.get("amount").and_then(Value::as_f64),
                "currency": clean(r.get("currency"), 3),
                "manual": clean(r.get("account"), 20) == "manual",
            })
        })
        .collect();
    // open return windows first (soonest first), then everything else newest first. A window that closed (its last
    // day ended, Pacific time) is "everything else", so old deadlines never crowd live ones out of the MAX_ORDERS rows.
    let open = |o: &Value| {
        o["return_by"]
            .as_str()
            .and_then(|d| iso_to_epoch(&format!("{d}T23:59:59-08:00")))
            .filter(|end| *end >= now)
            .map(|_| o["return_by"].as_str().unwrap_or_default().to_string())
    };
    orders.sort_by(|a, b| match (open(a), open(b)) {
        (Some(x), Some(y)) => x.cmp(&y),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => b["date"].as_str().cmp(&a["date"].as_str()),
    });
    let total = orders.len();
    orders.truncate(MAX_ORDERS);
    let pulls: Vec<Value> = v
        .get("account_status")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|p| p.is_object())
        .take(MAX_PULLS)
        .map(|p| {
            json!({
                "account": clean(p.get("account"), 30),
                "ok": p.get("ok").and_then(Value::as_bool).unwrap_or(false),
                "error": clean(p.get("error"), 80),
            })
        })
        .collect();
    let checked = v.get("last_run_at").and_then(Value::as_str).and_then(iso_to_epoch);
    let age = mtime.map(|t| now.saturating_sub(t));
    json!({
        "orders": orders,
        "total": total,
        "pulls": pulls,
        "checked": checked,
        "src": format!("~/{}", LEDGER.rel),
        "refresh": LEDGER.refresh,
        "t": mtime,
        "age": age,
        "stale": checked.map(|c| now.saturating_sub(c) > 2 * LEDGER.refresh).unwrap_or(true),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_792_640_000; // 2026-10-22T03:33:20Z
    const FILE: &str = r#"{"purchases":[
        {"id":"m1","thread_id":"SECRET-THREAD","account":"manual","vendor":"Amazon","amount":null,"currency":"USD",
         "subject":"Delivered 2026-10-21: NuPhy Air75 V3 Low Profile Mechanical Keyboard","sender":"owner report","received_at":"2026-10-21",
         "captured_at":"2026-10-22T03:42:25+00:00","return_by":"2026-11-20"},
        {"id":"g1","thread_id":"T2","account":"tanner","vendor":"Amazon","amount":19.99,"currency":"USD",
         "subject":"Shipped: \"USB-C cable\"","sender":"shipment-tracking@amazon.com","received_at":"2026-10-02T10:00:00Z","captured_at":"x"},
        {"id":"u1","thread_id":"T3","account":"tanner","vendor":"Unknown","amount":null,"currency":"USD","subject":"PRIVATE","sender":"bank@x","received_at":""},
        {"id":"m2","account":"manual","vendor":"Amazon","subject":"Delivered 2026-10-21: XVX keycaps","received_at":"2026-10-21","return_by":"2026-11-05"},
        "junk"
    ],"seen_ids":["SECRET-SEEN"],"accounts":["tanner"],
    "account_status":[{"account":"tanner","ok":false,"error":"list failed","hydration_failures":0}],
    "last_run_at":"2026-10-21T12:42:27.807512+00:00"}"#;

    #[test]
    fn only_amazon_rows_leave_with_the_allowed_keys_and_soonest_deadline_first() {
        let v = from_text(FILE, Some(NOW - 600), NOW);
        let o = v["orders"].as_array().cloned().unwrap_or_default();
        assert_eq!(o.len(), 3);
        assert_eq!(v["total"], 3);
        let ids: Vec<&str> = o.iter().filter_map(|x| x["id"].as_str()).collect();
        assert_eq!(ids, ["m2", "m1", "g1"]);
        assert_eq!(o[1]["title"], "NuPhy Air75 V3 Low Profile Mechanical Keyboard");
        assert_eq!(o[1]["return_by"], "2026-11-20");
        assert_eq!(o[1]["date"], "2026-10-21");
        assert_eq!(o[1]["manual"], true);
        assert_eq!(o[1]["amount"], Value::Null);
        assert_eq!(o[2]["title"], "USB-C cable");
        assert_eq!(o[2]["date"], "2026-10-02");
        assert_eq!(o[2]["return_by"], Value::Null);
        assert_eq!(o[2]["amount"], 19.99);
        for x in &o {
            let mut keys: Vec<&String> = x.as_object().map(|m| m.keys().collect()).unwrap_or_default();
            keys.sort();
            assert_eq!(keys, ["amount", "currency", "date", "id", "manual", "return_by", "title"]);
        }
        let s = v.to_string();
        for leak in ["SECRET", "PRIVATE", "bank@x", "shipment-tracking", "owner report", "T2"] {
            assert!(!s.contains(leak), "{leak} leaked: {s}");
        }
    }

    #[test]
    fn mail_pull_state_age_and_staleness_are_reported() {
        let v = from_text(FILE, Some(NOW - 600), NOW);
        assert_eq!(v["pulls"], json!([{"account": "tanner", "ok": false, "error": "list failed"}]));
        assert_eq!(v["checked"], iso_to_epoch("2026-10-21T12:42:27Z").map(Value::from).unwrap_or(Value::Null));
        assert_eq!(v["age"], 600);
        assert_eq!(v["stale"], false);
        assert_eq!(v["src"], "~/.hermes/watcher-state/purchases-ledger.json");
        // a mail check older than two days is stale even when an agent touched the file since
        assert_eq!(from_text(FILE, Some(NOW), NOW + 3 * 86_400)["stale"], true);
        // no mail check time at all is stale
        assert_eq!(from_text(r#"{"purchases":[]}"#, Some(NOW), NOW)["stale"], true);
    }

    #[test]
    fn bad_files_are_error_objects_never_rows() {
        assert_eq!(from_text("nope", None, NOW)["error"], "bad json");
        assert_eq!(from_text("[]", None, NOW)["error"], "no purchases list");
        assert_eq!(from_text(r#"{"purchases":{}}"#, None, NOW)["error"], "no purchases list");
        let v = from_text(r#"{"purchases":[{"vendor":"Amazon","subject":"","received_at":"soon","return_by":"20261120"}]}"#, None, NOW);
        assert_eq!(v["orders"][0]["title"], "Amazon order");
        assert_eq!(v["orders"][0]["date"], Value::Null);
        assert_eq!(v["orders"][0]["return_by"], Value::Null);
    }

    #[test]
    fn a_closed_return_window_sorts_with_the_plain_orders_not_ahead_of_open_ones() {
        let f = r#"{"purchases":[
          {"id":"old","vendor":"Amazon","subject":"Delivered: Old lamp","received_at":"2026-06-01","return_by":"2026-07-01"},
          {"id":"new","vendor":"Amazon","subject":"Delivered: New mug","received_at":"2026-10-20"},
          {"id":"live","vendor":"Amazon","subject":"Delivered: Desk","received_at":"2026-10-10","return_by":"2026-11-09"},
          {"id":"today","vendor":"Amazon","subject":"Delivered: Cable","received_at":"2026-09-21","return_by":"2026-10-21"}]}"#;
        // NOW is 2026-10-21 20:33 PT, so a window ending 2026-10-21 is still open and 2026-07-01 is closed
        let ids: Vec<String> = from_text(f, None, NOW)["orders"]
            .as_array()
            .map(|a| a.iter().map(|o| o["id"].as_str().unwrap_or_default().to_string()).collect())
            .unwrap_or_default();
        assert_eq!(ids, ["today", "live", "new", "old"]);
    }

    #[test]
    fn titles_lose_the_mail_prefix_only() {
        assert_eq!(title("Delivered 2026-10-21: XVX keycaps"), "XVX keycaps");
        assert_eq!(title("Delivered 2026-10-21: XVX keycaps (return/replace eligible through 2026-11-20)"), "XVX keycaps");
        assert_eq!(title("Your Amazon.com order of \"Desk lamp\""), "Desk lamp");
        assert_eq!(title("Ordered: Ratio 3:2 monitor"), "Ratio 3:2 monitor");
        assert_eq!(title("Monitor arm: dual"), "Monitor arm: dual");
    }

    #[tokio::test]
    async fn a_missing_file_is_an_error_object() {
        let v = get(Path::new("/nonexistent/pixel-deck-commerce")).await;
        assert_eq!(v["error"], "file missing");
        assert_eq!(v["stale"], true);
        // no jobs file either: the page learns the monitor is missing, not that it is fine
        assert_eq!(v["monitor"]["state"], "missing");
    }

    const JOBS_PAUSED: &str = r#"{"jobs":[
        {"id":"1","name":"Brief - Morning","enabled":true,"state":"scheduled"},
        {"id":"95084b4bc556","name":"Money - Purchase monitor (05:40)","prompt":"SECRET PROMPT","script":"/home/x/s.py",
         "enabled":false,"state":"paused","paused_at":"2026-10-26T15:06:16.937099-07:00",
         "paused_reason":"Tanner 2026-10-26: stop all Hermes crons","last_run_at":"2026-10-26T05:40:12-07:00"}]}"#;

    #[test]
    fn monitor_paused_by_the_owner_carries_state_and_times_only() {
        let m = monitor_from(Some(JOBS_PAUSED), Some("2026-10-21T12:42:27+00:00"));
        assert_eq!(m["state"], "paused");
        assert_eq!(m["name"], "Money - Purchase monitor (05:40)");
        assert_eq!(m["last_run_at"], "2026-10-26T05:40:12-07:00");
        assert_eq!(m["paused_at"], "2026-10-26T15:06:16.937099-07:00");
        let s = m.to_string();
        for leak in ["SECRET", "/home/x", "stop all"] {
            assert!(!s.contains(leak), "{leak} leaked: {s}");
        }
    }

    #[test]
    fn monitor_enabled_missing_and_unreadable() {
        let on = r#"{"jobs":[{"name":"Money - Purchase monitor (05:40)","enabled":true,"state":"scheduled"}]}"#;
        let m = monitor_from(Some(on), Some("2026-10-27T12:00:00+00:00"));
        assert_eq!(m["state"], "enabled");
        // the job never ran: the ledger's own last run stands in
        assert_eq!(m["last_run_at"], "2026-10-27T12:00:00+00:00");
        assert!(m["paused_at"].is_null());
        // enabled flag true but state paused still reads paused (the Crons tab's rule)
        let both = r#"{"jobs":[{"name":"Money - Purchase monitor","enabled":true,"state":"paused"}]}"#;
        assert_eq!(monitor_from(Some(both), None)["state"], "paused");
        for jobs in [Some(r#"{"jobs":[{"name":"Other"}]}"#), Some("nope"), Some("{}"), None] {
            let m = monitor_from(jobs, None);
            assert_eq!(m["state"], "missing");
            assert_eq!(m["name"], MONITOR_NAME);
        }
    }

    #[tokio::test]
    async fn get_adds_monitor_to_a_good_ledger() {
        let home = std::env::temp_dir().join(format!("pdeck-commerce-monitor-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::create_dir_all(home.join(".hermes/watcher-state"));
        let _ = std::fs::create_dir_all(home.join(".hermes/cron"));
        let _ = std::fs::write(home.join(LEDGER.rel), FILE);
        let _ = std::fs::write(home.join(JOBS_REL), JOBS_PAUSED);
        let v = get(&home).await;
        assert_eq!(v["monitor"]["state"], "paused");
        assert_eq!(v["total"], 3);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn order_limit_keeps_total_and_returns_only_newest_twenty() {
        let purchases: Vec<Value> = (0..25)
            .map(|i| {
                json!({
                    "id": format!("order-{i:02}"),
                    "vendor": "Amazon",
                    "subject": format!("Delivered: Item {i:02}"),
                    "received_at": format!("2026-10-{:02}", i + 1),
                })
            })
            .collect();
        let text = json!({"purchases": purchases}).to_string();

        let result = from_text(&text, None, NOW);
        let orders = result["orders"].as_array().unwrap_or_else(|| panic!("orders missing"));

        assert_eq!(result["total"], 25);
        assert_eq!(orders.len(), MAX_ORDERS);
        assert_eq!(orders[0]["id"], "order-24");
        assert_eq!(orders[19]["id"], "order-05");
    }

    #[test]
    fn account_status_is_limited_to_four_pulls() {
        let statuses: Vec<Value> = (0..6)
            .map(|i| json!({"account": format!("account-{i}"), "ok": true}))
            .collect();
        let text = json!({"purchases": [], "account_status": statuses}).to_string();

        let pulls = from_text(&text, None, NOW)["pulls"]
            .as_array()
            .cloned()
            .unwrap_or_default();

        assert_eq!(pulls.len(), MAX_PULLS);
        assert_eq!(pulls[0]["account"], "account-0");
        assert_eq!(pulls[3]["account"], "account-3");
    }
}
