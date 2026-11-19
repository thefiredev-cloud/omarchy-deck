//! Read-only website traffic connector. Reads ONE small normalized cache file written hourly
//! (FeedsHourly, no network here), keeps a bounded, validated copy
//! in memory, and reports `status`, `sites`, `src`, `t`, `age`, `stale`.
//!
//! Truth rules (owner data-truth order 2026-09-29):
//! * Provider metrics stay distinct. Search Console counts `organic_search_clicks`; only a real
//!   analytics provider may claim `visits`. A provider/metric pair that disagrees is not shown as a
//!   number.
//! * A value that is missing, negative, non-finite or not a number is `null`, never 0.
//! * Missing, oversize, unreadable or malformed cache is `status: "unavailable"` with an error,
//!   never a fabricated row and never a 5xx.
//! * Every row keeps its own window (`start_date`, `end_date`) and timestamp `t` (epoch seconds).
use crate::util::now_epoch;
use serde_json::{json, Map, Value};
use std::path::Path;
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::sync::Mutex;

pub const REL: &str = ".meshvault/status/traffic/traffic.json";
/// Hard cap on the bytes read from the cache file.
pub const MAX_BYTES: u64 = 256 * 1024;
/// Rows kept from the cache.
pub const MAX_SITES: usize = 32;
/// Writer cadence is 3600 s. Stale after 2x, same rule as the other deck feeds.
pub const STALE_AFTER: u64 = 2 * 3600;
/// Documented refresh cadence. The clock is `generated_at`.
pub const REFRESH: u64 = 3600;
/// In-memory cache lifetime.
const TTL: u64 = 30;
const READ_TIMEOUT: Duration = Duration::from_secs(2);
/// A row time this far past now is a clock error, not data.
const FUTURE_SLACK: u64 = 600;

const GSC: &str = "google_search_console";
const CLICKS: &str = "organic_search_clicks";
const VISITS: &str = "visits";

#[derive(Default)]
pub struct Cache(Mutex<Option<(Instant, Value)>>);

impl Cache {
    pub async fn get(&self, home: &Path) -> Value {
        let mut g = self.0.lock().await;
        if let Some((t, v)) = g.as_ref() {
            if t.elapsed().as_secs() < TTL {
                return v.clone();
            }
        }
        let v = load(home).await;
        *g = Some((Instant::now(), v.clone()));
        v
    }
}

async fn read(path: &Path) -> Result<(String, Option<u64>), &'static str> {
    let f = async {
        let file = tokio::fs::File::open(path).await?;
        let mtime = file
            .metadata()
            .await
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs());
        let mut buf = Vec::new();
        file.take(MAX_BYTES + 1).read_to_end(&mut buf).await?;
        Ok::<_, std::io::Error>((buf, mtime))
    };
    match tokio::time::timeout(READ_TIMEOUT, f).await {
        Ok(Ok((buf, _))) if buf.len() as u64 > MAX_BYTES => Err("cache too large"),
        Ok(Ok((buf, mtime))) => match String::from_utf8(buf) {
            Ok(s) => Ok((s, mtime)),
            Err(_) => Err("cache not utf-8"),
        },
        Ok(Err(e)) if e.kind() == std::io::ErrorKind::NotFound => Err("cache missing"),
        Ok(Err(_)) => Err("cache unreadable"),
        Err(_) => Err("read timed out"),
    }
}

async fn load(home: &Path) -> Value {
    let now = now_epoch();
    match read(&home.join(REL)).await {
        Ok((text, mtime)) => normalize(&text, mtime, now),
        Err(e) => unavailable(e),
    }
}

fn src() -> String {
    format!("~/{REL}")
}

fn unavailable(why: &str) -> Value {
    json!({
        "status": "unavailable",
        "sites": [],
        "daily": unavailable_daily(why),
        "src": src(),
        "t": Value::Null,
        "age": Value::Null,
        "refresh": REFRESH,
        "stale": true,
        "error": why,
    })
}

fn clean(v: Option<&Value>, n: usize) -> String {
    v.and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .filter(|c| !c.is_control())
        .take(n)
        .collect()
}

/// Non-negative finite number, or None. JSON has no NaN/Inf, but a producer may emit a huge or
/// negative number or a string; all of those become null.
fn num(v: Option<&Value>) -> Option<f64> {
    let f = v?.as_f64()?;
    (f.is_finite() && f >= 0.0).then_some(f)
}

fn num_json(f: Option<f64>) -> Value {
    match f {
        Some(f) if f.fract() == 0.0 && f < 9.0e15 => json!(f as u64),
        Some(f) => json!(f),
        None => Value::Null,
    }
}

fn valid_domain(d: &str) -> bool {
    let b = d.as_bytes();
    (3..=253).contains(&b.len())
        && d.contains('.')
        && !d.starts_with(['.', '-'])
        && !d.ends_with(['.', '-'])
        && !d.contains("..")
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'.' | b'-'))
}

fn valid_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
        && matches!(s[5..7].parse::<u8>(), Ok(1..=12))
        && matches!(s[8..10].parse::<u8>(), Ok(1..=31))
}

fn date_or_empty(v: Option<&Value>) -> Value {
    match v.and_then(Value::as_str) {
        Some(s) if valid_date(s) => json!(s),
        _ => Value::Null,
    }
}

/// Which metric a provider is allowed to report. Search Console never reports visits.
fn metric_matches(provider: &str, metric: &str) -> bool {
    match metric {
        CLICKS => provider == GSC,
        VISITS => provider != GSC && !provider.is_empty(),
        _ => false,
    }
}

/// One validated row, or None if the row cannot be identified at all.
fn site_from(r: &Value, now: u64) -> Option<Value> {
    let domain = clean(r.get("domain"), 253).to_lowercase();
    if !valid_domain(&domain) {
        return None;
    }
    let provider = clean(r.get("provider"), 40);
    let metric = clean(r.get("metric"), 32);
    let mut status = clean(r.get("status"), 16);
    let mut error = clean(r.get("error"), 120);
    let mut value = num(r.get("value"));
    let mut imps = num(r.get("impressions"));
    let mut t = r
        .get("t")
        .and_then(Value::as_u64)
        .filter(|t| *t <= now + FUTURE_SLACK);
    if !metric_matches(&provider, &metric) {
        // a mislabeled count must not be shown as if it were a real one
        value = None;
        imps = None;
        t = None;
        status = "unavailable".into();
        error = "provider and metric do not match".into();
    } else if status != "ok" && status != "no_data" {
        // unknown or failed status carries no number
        value = None;
        imps = None;
        status = "unavailable".into();
    } else if status == "ok" && value.is_none() {
        status = "unavailable".into();
        if error.is_empty() {
            error = "no value".into();
        }
    } else if status == "no_data" {
        value = None;
        imps = None;
    }
    let mut o = Map::new();
    // owner monitoring scope (2026-10-29): the producer says it; an older cache file falls back to the same list
    let tracked = r.get("tracked").and_then(Value::as_bool).unwrap_or_else(|| TRACKED_SCOPE.contains(&domain.as_str()));
    o.insert("domain".into(), domain.into());
    o.insert("tracked".into(), tracked.into());
    o.insert("provider".into(), provider.into());
    o.insert("metric".into(), metric.into());
    o.insert("value".into(), num_json(value));
    o.insert("impressions".into(), num_json(imps));
    o.insert("start_date".into(), date_or_empty(r.get("start_date")));
    o.insert("end_date".into(), date_or_empty(r.get("end_date")));
    o.insert("t".into(), json!(t));
    o.insert("status".into(), status.clone().into());
    if !error.is_empty() && status != "ok" {
        o.insert("error".into(), error.into());
    }
    // C3 (deck 2026-10-29): why a row has no number. `no_access` is the owner's to fix (add or verify the property),
    // `failed` is retried by the next run. Anything else the producer wrote, or no reason at all, reads `failed`.
    if status == "unavailable" {
        let reason = if clean(r.get("reason"), 16) == "no_access" { "no_access" } else { "failed" };
        o.insert("reason".into(), reason.into());
    }
    Some(Value::Object(o))
}

/// The owner monitoring scope. Mirrors `TRACKED` in `scripts/deck_traffic.py`; only used when a cache file has no `tracked`.
pub const TRACKED_SCOPE: [&str; 3] = ["meshvault.ai", "protocol-guide.com", "pepgo.org"];
/// Hard cap on daily rows kept from the cache (the deck tracks three sites, owner scope 2026-10-29).
pub const DAILY_MAX: usize = 8;

fn unavailable_daily(why: &str) -> Value {
    json!({
        "status": "unavailable",
        "date": Value::Null,
        "lag_days": Value::Null,
        "goal": Value::Null,
        "metric": CLICKS,
        "sites": [],
        "aggregate": {"clicks": Value::Null, "measured": 0, "tracked": 0, "complete": false, "pct": Value::Null},
        "error": why,
    })
}

/// The latest-complete-day block. Every row must be for exactly the block's date, must keep the
/// clicks/Search Console pairing, and only rows with a real number count toward the aggregate.
/// A tracked site that is missing, unverified or failed stays a row with a null value.
fn daily_from(v: &Value, now: u64) -> Value {
    let Some(d) = v.get("daily").filter(|d| d.is_object()) else {
        return unavailable_daily("no daily data in cache");
    };
    let date = date_or_empty(d.get("date"));
    let Some(day) = date.as_str().map(str::to_owned) else {
        return unavailable_daily("bad daily date");
    };
    let Some(list) = d.get("sites").and_then(Value::as_array) else {
        return unavailable_daily("no daily sites");
    };
    let mut seen = std::collections::HashSet::new();
    let mut sites: Vec<Value> = list
        .iter()
        .filter_map(|r| site_from(r, now))
        .filter(|s| seen.insert(clean(s.get("domain"), 253)))
        .take(DAILY_MAX)
        .collect();
    for s in &mut sites {
        let same_day = s["start_date"] == day && s["end_date"] == day;
        if let (false, Some(o)) = (same_day, s.as_object_mut()) {
            o.insert("value".into(), Value::Null);
            o.insert("impressions".into(), Value::Null);
            o.insert("status".into(), "unavailable".into());
            o.insert("error".into(), "row is not for the daily date".into());
            o.insert("reason".into(), "failed".into());
        }
    }
    let clicks: Vec<f64> = sites
        .iter()
        .filter(|s| s["status"] == "ok")
        .filter_map(|s| s["value"].as_f64())
        .collect();
    let measured = clicks.len();
    let total = clicks.iter().sum::<f64>();
    let goal = num(d.get("goal")).filter(|g| *g > 0.0);
    let lag = d
        .get("lag_days")
        .and_then(Value::as_u64)
        .filter(|l| *l <= 30);
    let status = if measured == 0 {
        "unavailable"
    } else if measured == sites.len() {
        "ok"
    } else {
        "partial"
    };
    let pct = goal
        .filter(|_| measured > 0)
        .map(|g| (total / g * 1000.0).round() / 10.0);
    json!({
        "status": status,
        "date": day,
        "lag_days": lag,
        "goal": num_json(goal),
        "metric": CLICKS,
        "sites": sites,
        "aggregate": {
            "clicks": if measured > 0 { num_json(Some(total)) } else { Value::Null },
            "measured": measured,
            "tracked": sites.len(),
            "complete": measured > 0 && measured == sites.len(),
            "pct": pct,
        },
    })
}

/// `generated_at` is the clock: epoch seconds, or an ISO time. `mtime` is only the fallback.
fn clock_of(v: Option<&Value>) -> Option<u64> {
    let v = v?;
    v.as_u64()
        .or_else(|| v.as_i64().filter(|n| *n >= 0).map(|n| n as u64))
        .or_else(|| v.as_str().and_then(crate::util::iso_to_epoch))
}

/// Vercel Web Analytics block (2026-11-04): page views and visitors per Vercel project, with every domain the project serves.
/// Counts are per project (Vercel has no per-hostname split), so a row names all its domains. Junk becomes null, never 0; a
/// missing or broken block is `{"status":"unavailable","projects":[]}` and the deck keeps its Search Console rows.
fn vercel_from(v: &Value, now: u64) -> Value {
    let none = |why: &str| json!({"status": "unavailable", "error": why, "projects": []});
    let Some(b) = v.get("vercel").filter(|b| b.is_object()) else {
        return none("no Vercel block in cache");
    };
    let mut projects: Vec<Value> = Vec::new();
    for p in b.get("projects").and_then(Value::as_array).into_iter().flatten().take(24) {
        let domains: Vec<String> = p
            .get("domains")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|d| d.as_str().map(|s| s.to_lowercase()))
            .filter(|d| valid_domain(d))
            .take(16)
            .collect();
        let domain = clean(p.get("domain"), 253).to_lowercase();
        if !valid_domain(&domain) || domains.is_empty() {
            continue;
        }
        let ok = p.get("status").and_then(Value::as_str) == Some("ok");
        let pv = if ok { num(p.get("pageviews")) } else { None };
        let vis = if ok { num(p.get("visitors")) } else { None };
        let st = if pv.is_some() { "ok" } else { "unavailable" };
        let t = p.get("t").and_then(Value::as_u64).filter(|t| *t <= now + FUTURE_SLACK);
        let mut o = Map::new();
        o.insert("project".into(), clean(p.get("project"), 60).into());
        o.insert("domain".into(), domain.into());
        o.insert("domains".into(), json!(domains));
        o.insert("pageviews".into(), num_json(pv));
        o.insert("visitors".into(), num_json(vis));
        o.insert("status".into(), st.into());
        o.insert("t".into(), json!(t));
        o.insert("tracked".into(), p.get("tracked").and_then(Value::as_bool).unwrap_or(false).into());
        if st != "ok" {
            o.insert("error".into(), clean(p.get("error"), 80).into());
        }
        projects.push(Value::Object(o));
    }
    let any_ok = projects.iter().any(|p| p["status"] == "ok");
    let mut o = Map::new();
    o.insert("status".into(), if any_ok { "ok" } else { "unavailable" }.into());
    o.insert("provider".into(), "vercel_web_analytics".into());
    o.insert("metric".into(), "pageviews".into());
    o.insert("start_date".into(), date_or_empty(b.get("start_date")));
    o.insert("end_date".into(), date_or_empty(b.get("end_date")));
    o.insert("t".into(), json!(b.get("t").and_then(Value::as_u64).filter(|t| *t <= now + FUTURE_SLACK)));
    if !any_ok {
        o.insert("error".into(), clean(b.get("error"), 80).into());
    }
    o.insert("projects".into(), Value::Array(projects));
    Value::Object(o)
}

/// Normalize the producer's cache file. `mtime` is only the fallback clock.
pub fn normalize(text: &str, mtime: Option<u64>, now: u64) -> Value {
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return unavailable("bad json");
    };
    if v.get("schema").and_then(Value::as_u64) != Some(1) {
        return unavailable("unknown schema");
    }
    let Some(list) = v.get("sites").and_then(Value::as_array) else {
        return unavailable("no sites list");
    };
    let mut seen = std::collections::HashSet::new();
    let sites: Vec<Value> = list
        .iter()
        .filter_map(|r| site_from(r, now))
        .filter(|s| {
            seen.insert((
                clean(s.get("domain"), 253),
                clean(s.get("provider"), 40),
                clean(s.get("metric"), 32),
            ))
        })
        .take(MAX_SITES)
        .collect();
    let ok = sites.iter().filter(|s| s["status"] == "ok").count();
    let status = if sites.is_empty() || ok == 0 {
        "unavailable"
    } else if ok == sites.len() {
        "ok"
    } else {
        "partial"
    };
    let t = clock_of(v.get("generated_at"))
        .filter(|t| *t <= now + FUTURE_SLACK)
        .or(mtime.filter(|t| *t <= now + FUTURE_SLACK));
    let age = t.map(|t| now.saturating_sub(t));
    let mut o = Map::new();
    o.insert("status".into(), status.into());
    o.insert("sites".into(), Value::Array(sites));
    o.insert("src".into(), src().into());
    o.insert("origin".into(), clean(v.get("src"), 80).into());
    o.insert("t".into(), json!(t));
    o.insert("age".into(), json!(age));
    o.insert("refresh".into(), REFRESH.into());
    o.insert(
        "stale".into(),
        age.map(|a| a > STALE_AFTER).unwrap_or(true).into(),
    );
    let w = v.get("window");
    o.insert(
        "window".into(),
        json!({
            "start_date": date_or_empty(w.and_then(|w| w.get("start_date"))),
            "end_date": date_or_empty(w.and_then(|w| w.get("end_date"))),
        }),
    );
    o.insert(
        "note".into(),
        "organic_search_clicks are Google Search clicks, not total visits".into(),
    );
    o.insert("daily".into(), daily_from(&v, now));
    o.insert("vercel".into(), vercel_from(&v, now));
    if status == "unavailable" {
        o.insert(
            "error".into(),
            if o["sites"].as_array().map(Vec::is_empty).unwrap_or(true) {
                "no sites in cache"
            } else {
                "no site has data"
            }
            .into(),
        );
    }
    Value::Object(o)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_790_756_200;

    fn row(domain: &str, value: &str, status: &str) -> String {
        format!(
            r#"{{"domain":"{domain}","provider":"google_search_console","metric":"organic_search_clicks","value":{value},"impressions":10,"start_date":"2026-09-01","end_date":"2026-09-28","t":{},"status":"{status}"}}"#,
            NOW - 60
        )
    }

    fn file(rows: &[String], generated: u64) -> String {
        format!(
            r#"{{"schema":1,"generated_at":{generated},"src":"google-apis MCP","window":{{"start_date":"2026-09-01","end_date":"2026-09-28"}},"sites":[{}]}}"#,
            rows.join(",")
        )
    }

    fn drow(domain: &str, value: &str, status: &str, err: &str) -> String {
        let e = if err.is_empty() { String::new() } else { format!(r#","error":"{err}""#) };
        format!(
            r#"{{"domain":"{domain}","provider":"google_search_console","metric":"organic_search_clicks","value":{value},"impressions":10,"start_date":"2026-09-28","end_date":"2026-09-28","t":{},"status":"{status}"{e}}}"#,
            NOW - 60
        )
    }

    fn with_daily(daily: &str) -> String {
        let base = file(&[row("a.com", "166", "ok")], NOW - 100);
        format!(r#"{},"daily":{daily}}}"#, &base[..base.len() - 1])
    }

    fn daily(rows: &[String]) -> String {
        format!(
            r#"{{"date":"2026-09-28","lag_days":2,"goal":2000,"sites":[{}]}}"#,
            rows.join(",")
        )
    }

    #[test]
    fn daily_sums_only_measured_sites_and_never_turns_gaps_into_zero() {
        let d = daily(&[
            drow("a.com", "120", "ok", ""),
            drow("b.com", "null", "unavailable", "Search Console HTTP 403"),
            drow("c.com", "0", "ok", ""),
            drow("d.com", "null", "unavailable", "no Search Console property"),
        ]);
        let v = normalize(&with_daily(&d), None, NOW);
        let dv = &v["daily"];
        assert_eq!(dv["status"], "partial");
        assert_eq!(dv["date"], "2026-09-28");
        assert_eq!(dv["lag_days"], 2);
        assert_eq!(dv["goal"], 2000);
        assert_eq!(dv["sites"].as_array().map(Vec::len), Some(4));
        assert_eq!(dv["sites"][0]["value"], 120);
        assert_eq!(dv["sites"][2]["value"], 0);
        assert!(dv["sites"][1]["value"].is_null());
        assert_eq!(dv["sites"][3]["error"], "no Search Console property");
        let a = &dv["aggregate"];
        assert_eq!(a["clicks"], 120);
        assert_eq!(a["measured"], 2);
        assert_eq!(a["tracked"], 4);
        assert_eq!(a["complete"], false);
        assert_eq!(a["pct"], 6.0);
        // the 28-day rows are untouched by the daily block
        assert_eq!(v["sites"][0]["value"], 166);
        assert_eq!(v["sites"][0]["start_date"], "2026-09-01");
        assert_eq!(v["window"]["end_date"], "2026-09-28");
    }

    #[test]
    fn daily_complete_only_when_every_tracked_site_is_measured() {
        let d = daily(&[drow("a.com", "1500", "ok", ""), drow("b.com", "600", "ok", "")]);
        let a = &normalize(&with_daily(&d), None, NOW)["daily"];
        assert_eq!(a["status"], "ok");
        assert_eq!(a["aggregate"]["clicks"], 2100);
        assert_eq!(a["aggregate"]["complete"], true);
        assert_eq!(a["aggregate"]["pct"], 105.0);
    }

    #[test]
    fn daily_with_no_measured_site_has_null_aggregate_not_zero() {
        let d = daily(&[
            drow("a.com", "null", "unavailable", "property not verified"),
            drow("b.com", "null", "no_data", "no rows returned for window"),
        ]);
        let dv = &normalize(&with_daily(&d), None, NOW)["daily"];
        assert_eq!(dv["status"], "unavailable");
        assert!(dv["aggregate"]["clicks"].is_null());
        assert!(dv["aggregate"]["pct"].is_null());
        assert_eq!(dv["aggregate"]["measured"], 0);
        assert_eq!(dv["aggregate"]["tracked"], 2);
    }

    #[test]
    fn daily_row_for_another_day_or_wrong_metric_carries_no_number() {
        let other = drow("a.com", "50", "ok", "").replace(r#""end_date":"2026-09-28""#, r#""end_date":"2026-09-27""#);
        let visits = drow("b.com", "50", "ok", "").replace("organic_search_clicks", "visits");
        let dv = &normalize(&with_daily(&daily(&[other, visits])), None, NOW)["daily"];
        assert_eq!(dv["status"], "unavailable");
        assert!(dv["sites"][0]["value"].is_null());
        assert_eq!(dv["sites"][0]["error"], "row is not for the daily date");
        assert!(dv["sites"][1]["value"].is_null());
        assert!(dv["aggregate"]["clicks"].is_null());
    }

    #[test]
    fn daily_absent_or_broken_is_unavailable_and_keeps_28_day_rows() {
        let plain = normalize(&file(&[row("a.com", "166", "ok")], NOW - 100), None, NOW);
        assert_eq!(plain["status"], "ok");
        assert_eq!(plain["daily"]["status"], "unavailable");
        assert_eq!(plain["daily"]["error"], "no daily data in cache");
        assert!(plain["daily"]["aggregate"]["clicks"].is_null());
        for bad in [
            r#"{"date":"nope","goal":2000,"sites":[]}"#,
            r#"{"date":"2026-09-28","goal":2000}"#,
            r#""text""#,
        ] {
            let v = normalize(&with_daily(bad), None, NOW);
            assert_eq!(v["daily"]["status"], "unavailable", "{bad}");
            assert_eq!(v["status"], "ok", "{bad}");
        }
    }

    #[test]
    fn daily_goal_and_lag_junk_become_null() {
        for goal in ["0", "-5", r#""2000""#, "null"] {
            let d = format!(
                r#"{{"date":"2026-09-28","lag_days":400,"goal":{goal},"sites":[{}]}}"#,
                drow("a.com", "10", "ok", "")
            );
            let dv = &normalize(&with_daily(&d), None, NOW)["daily"];
            assert!(dv["goal"].is_null(), "{goal}");
            assert!(dv["lag_days"].is_null());
            assert!(dv["aggregate"]["pct"].is_null());
            assert_eq!(dv["aggregate"]["clicks"], 10);
        }
    }

    #[test]
    fn daily_rows_dedupe_and_cap() {
        let mut rows = vec![drow("a.com", "1", "ok", ""), drow("a.com", "2", "ok", "")];
        rows.extend((0..20).map(|i| drow(&format!("s{i}.com"), "1", "ok", "")));
        let dv = &normalize(&with_daily(&daily(&rows)), None, NOW)["daily"];
        let list = dv["sites"].as_array().cloned().unwrap_or_default();
        assert_eq!(list.len(), DAILY_MAX);
        assert_eq!(list[0]["value"], 1);
    }

    #[test]
    fn ok_keeps_metric_window_and_time() {
        let v = normalize(&file(&[row("a.com", "166", "ok")], NOW - 100), None, NOW);
        assert_eq!(v["status"], "ok");
        assert_eq!(v["stale"], false);
        assert_eq!(v["t"], NOW - 100);
        assert_eq!(v["age"], 100);
        assert_eq!(v["src"], "~/.meshvault/status/traffic/traffic.json");
        let s = &v["sites"][0];
        assert_eq!(s["metric"], "organic_search_clicks");
        assert_eq!(s["provider"], "google_search_console");
        assert_eq!(s["value"], 166);
        assert_eq!(s["impressions"], 10);
        assert_eq!(s["start_date"], "2026-09-01");
        assert_eq!(s["end_date"], "2026-09-28");
        assert_eq!(s["t"], NOW - 60);
        assert!(v["note"]
            .as_str()
            .unwrap_or("")
            .contains("not total visits"));
    }

    #[test]
    fn measured_zero_stays_zero_but_null_stays_null() {
        let rows = [row("a.com", "0", "ok"), row("b.com", "null", "ok")];
        let v = normalize(&file(&rows, NOW), None, NOW);
        assert_eq!(v["sites"][0]["value"], 0);
        assert_eq!(v["sites"][0]["status"], "ok");
        assert!(v["sites"][1]["value"].is_null());
        assert_eq!(v["sites"][1]["status"], "unavailable");
        assert_eq!(v["status"], "partial");
    }

    #[test]
    fn junk_values_become_null_not_zero() {
        for bad in [r#""12""#, "-5", "true", "[]", "{}"] {
            let v = normalize(&file(&[row("a.com", bad, "ok")], NOW), None, NOW);
            assert!(v["sites"][0]["value"].is_null(), "{bad}");
            assert_eq!(v["status"], "unavailable", "{bad}");
        }
    }

    #[test]
    fn failed_and_no_data_rows_carry_no_number() {
        let rows = [
            row("a.com", "5", "unavailable"),
            row("b.com", "7", "no_data"),
            row("c.com", "9", "weird"),
            row("d.com", "3", "ok"),
        ];
        let v = normalize(&file(&rows, NOW), None, NOW);
        for i in 0..3 {
            assert!(v["sites"][i]["value"].is_null(), "row {i}");
            assert!(v["sites"][i]["impressions"].is_null(), "row {i}");
        }
        assert_eq!(v["sites"][1]["status"], "no_data");
        assert_eq!(v["sites"][2]["status"], "unavailable");
        assert_eq!(v["sites"][3]["value"], 3);
        assert_eq!(v["status"], "partial");
    }

    #[test]
    fn gsc_cannot_claim_visits_and_analytics_cannot_claim_clicks() {
        let r = |p: &str, m: &str| {
            format!(
                r#"{{"domain":"a.com","provider":"{p}","metric":"{m}","value":42,"impressions":null,"start_date":"2026-09-01","end_date":"2026-09-28","t":{NOW},"status":"ok"}}"#
            )
        };
        let v = normalize(
            &file(&[r("google_search_console", "visits")], NOW),
            None,
            NOW,
        );
        assert!(v["sites"][0]["value"].is_null());
        assert_eq!(v["sites"][0]["error"], "provider and metric do not match");
        assert_eq!(v["status"], "unavailable");
        let v = normalize(&file(&[r("ga4", "organic_search_clicks")], NOW), None, NOW);
        assert!(v["sites"][0]["value"].is_null());
        let v = normalize(&file(&[r("ga4", "visits")], NOW), None, NOW);
        assert_eq!(v["sites"][0]["value"], 42);
        assert_eq!(v["sites"][0]["metric"], "visits");
        assert_eq!(v["status"], "ok");
        let v = normalize(&file(&[r("", "visits")], NOW), None, NOW);
        assert!(v["sites"][0]["value"].is_null());
        let v = normalize(&file(&[r("ga4", "pageviews")], NOW), None, NOW);
        assert!(v["sites"][0]["value"].is_null());
    }

    #[test]
    fn same_domain_two_providers_stay_separate() {
        let ga = format!(
            r#"{{"domain":"a.com","provider":"ga4","metric":"visits","value":900,"impressions":null,"start_date":"2026-09-01","end_date":"2026-09-28","t":{NOW},"status":"ok"}}"#
        );
        let v = normalize(&file(&[row("a.com", "12", "ok"), ga], NOW), None, NOW);
        assert_eq!(v["sites"].as_array().map(Vec::len), Some(2));
        assert_eq!(v["sites"][0]["value"], 12);
        assert_eq!(v["sites"][1]["value"], 900);
    }

    #[test]
    fn stale_after_two_refreshes_but_rows_survive() {
        let v = normalize(
            &file(&[row("a.com", "1", "ok")], NOW - STALE_AFTER - 1),
            None,
            NOW,
        );
        assert_eq!(v["stale"], true);
        assert_eq!(v["status"], "ok");
        assert_eq!(v["sites"][0]["value"], 1);
        let v = normalize(
            &file(&[row("a.com", "1", "ok")], NOW - STALE_AFTER),
            None,
            NOW,
        );
        assert_eq!(v["stale"], false);
    }

    #[test]
    fn missing_clock_is_stale_and_mtime_is_the_fallback() {
        let no_t = r#"{"schema":1,"sites":[]}"#;
        let v = normalize(no_t, None, NOW);
        assert!(v["t"].is_null() && v["age"].is_null());
        assert_eq!(v["stale"], true);
        let v = normalize(no_t, Some(NOW - 5), NOW);
        assert_eq!(v["t"], NOW - 5);
        assert_eq!(v["stale"], false);
        let iso = format!(
            r#"{{"schema":1,"generated_at":"2026-09-30T08:14:40Z","sites":[{}]}}"#,
            row("a.com", "1", "ok")
        );
        let v = normalize(&iso, Some(NOW - 9_000), NOW);
        assert_eq!(v["t"], NOW - 120);
        assert_eq!(v["stale"], false);
        assert_eq!(v["refresh"], REFRESH);
        // a future generated_at is a clock error, not a fresh reading
        let v = normalize(&file(&[row("a.com", "1", "ok")], NOW + 10_000), None, NOW);
        assert!(v["t"].is_null());
        assert_eq!(v["stale"], true);
    }

    #[test]
    fn future_row_time_is_dropped() {
        let r = format!(
            r#"{{"domain":"a.com","provider":"google_search_console","metric":"organic_search_clicks","value":1,"impressions":1,"start_date":"2026-09-01","end_date":"2026-09-28","t":{},"status":"ok"}}"#,
            NOW + 99_999
        );
        let v = normalize(&file(&[r], NOW), None, NOW);
        assert!(v["sites"][0]["t"].is_null());
        assert_eq!(v["sites"][0]["value"], 1);
    }

    #[test]
    fn bad_input_is_unavailable_never_a_panic() {
        for (text, why) in [
            ("not json", "bad json"),
            ("[]", "unknown schema"),
            (r#"{"schema":2,"sites":[]}"#, "unknown schema"),
            (r#"{"schema":1}"#, "no sites list"),
            (r#"{"schema":1,"sites":{}}"#, "no sites list"),
        ] {
            let v = normalize(text, None, NOW);
            assert_eq!(v["status"], "unavailable", "{text}");
            assert_eq!(v["error"], why, "{text}");
            assert_eq!(v["sites"].as_array().map(Vec::len), Some(0));
        }
        let v = normalize(
            r#"{"schema":1,"sites":[1,null,"x",{"domain":5},{"domain":"nodot"}]}"#,
            None,
            NOW,
        );
        assert_eq!(v["sites"].as_array().map(Vec::len), Some(0));
        assert_eq!(v["error"], "no sites in cache");
    }

    #[test]
    fn hostile_strings_are_cleaned_and_clipped() {
        let long = "e".repeat(500);
        let r = format!(
            r#"{{"domain":"A.Com","provider":"google_search_console","metric":"organic_search_clicks","value":null,"impressions":null,"start_date":"<b>","end_date":"2026-13-45","t":null,"status":"unavailable","error":"bad\u0007\n{long}"}}"#
        );
        let v = normalize(&file(&[r], NOW), None, NOW);
        let s = &v["sites"][0];
        assert_eq!(s["domain"], "a.com");
        assert!(s["start_date"].is_null() && s["end_date"].is_null());
        let e = s["error"].as_str().unwrap_or("");
        assert!(e.len() <= 120 && !e.chars().any(char::is_control));
        assert!(!valid_domain("a.com/../x") && !valid_domain("-a.com") && !valid_domain("a..com"));
    }

    #[test]
    fn duplicates_collapse_and_rows_are_capped() {
        let dup = normalize(
            &file(&[row("a.com", "1", "ok"), row("A.com", "2", "ok")], NOW),
            None,
            NOW,
        );
        assert_eq!(dup["sites"].as_array().map(Vec::len), Some(1));
        assert_eq!(dup["sites"][0]["value"], 1);
        let many: Vec<String> = (0..100)
            .map(|i| row(&format!("s{i}.com"), "1", "ok"))
            .collect();
        let v = normalize(&file(&many, NOW), None, NOW);
        assert_eq!(v["sites"].as_array().map(Vec::len), Some(MAX_SITES));
    }

    #[test]
    fn all_no_data_is_unavailable() {
        let v = normalize(&file(&[row("a.com", "null", "no_data")], NOW), None, NOW);
        assert_eq!(v["status"], "unavailable");
        assert_eq!(v["error"], "no site has data");
    }

    #[test]
    fn fractional_and_large_numbers_survive_as_numbers() {
        let v = normalize(&file(&[row("a.com", "12.5", "ok")], NOW), None, NOW);
        assert_eq!(v["sites"][0]["value"], 12.5);
        let v = normalize(&file(&[row("a.com", "3.0", "ok")], NOW), None, NOW);
        assert_eq!(v["sites"][0]["value"], 3);
    }

    fn tmp_home(tag: &str) -> std::path::PathBuf {
        let h = std::env::temp_dir().join(format!("pdeck-traffic-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&h);
        let _ = std::fs::create_dir_all(h.join(".meshvault/status/traffic"));
        h
    }

    #[tokio::test]
    async fn load_missing_oversize_and_good_file() {
        let h = tmp_home("load");
        let v = load(&h).await;
        assert_eq!(
            (v["status"].as_str(), v["error"].as_str()),
            (Some("unavailable"), Some("cache missing"))
        );
        let p = h.join(REL);
        let _ = std::fs::write(&p, vec![b' '; (MAX_BYTES + 10) as usize]);
        assert_eq!(load(&h).await["error"], "cache too large");
        let _ = std::fs::write(&p, [0xff, 0xfe, 0xfd]);
        assert_eq!(load(&h).await["error"], "cache not utf-8");
        let _ = std::fs::write(&p, file(&[row("a.com", "8", "ok")], now_epoch()));
        let v = load(&h).await;
        assert_eq!(v["status"], "ok");
        assert_eq!(v["sites"][0]["value"], 8);
        assert_eq!(v["stale"], false);
        let _ = std::fs::remove_dir_all(&h);
    }

    #[tokio::test]
    async fn memory_cache_serves_within_ttl() {
        let h = tmp_home("ttl");
        let c = Cache::default();
        assert_eq!(c.get(&h).await["status"], "unavailable");
        let _ = std::fs::write(h.join(REL), file(&[row("a.com", "8", "ok")], now_epoch()));
        // still inside the 30 s window: the earlier answer is served, no re-read
        assert_eq!(c.get(&h).await["status"], "unavailable");
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn unavailable_rows_carry_a_reason_and_ok_rows_never_do() {
        let with = |domain: &str, value: &str, status: &str, reason: &str| {
            drow(domain, value, status, "Search Console HTTP 403").replace(
                r#","status":"#,
                &format!(r#","reason":"{reason}","status":"#),
            )
        };
        let d = daily(&[
            with("a.com", "null", "unavailable", "no_access"),
            with("b.com", "null", "unavailable", "failed"),
            with("c.com", "null", "unavailable", "<script>"),
            drow("d.com", "null", "unavailable", "timed out"),
            with("e.com", "9", "ok", "no_access"),
            with("f.com", "null", "no_data", "no_access"),
        ]);
        let v = normalize(&with_daily(&d), None, NOW);
        let reasons: Vec<Value> = v["daily"]["sites"].as_array().cloned().unwrap_or_default().iter().map(|s| s["reason"].clone()).collect();
        // junk or missing reason reads failed; ok and no_data rows have none
        assert_eq!(reasons, [json!("no_access"), json!("failed"), json!("failed"), json!("failed"), Value::Null, Value::Null]);
        // the 28-day rows follow the same rule
        let sites = normalize(&file(&[with("a.com", "null", "unavailable", "no_access"), row("b.com", "3", "ok")], NOW), None, NOW);
        assert_eq!(sites["sites"][0]["reason"], "no_access");
        assert!(sites["sites"][1].get("reason").is_none());
        // a daily row for another day is unavailable with reason failed
        let other = drow("a.com", "50", "ok", "").replace(r#""end_date":"2026-09-28""#, r#""end_date":"2026-09-27""#);
        let dv = &normalize(&with_daily(&daily(&[other])), None, NOW)["daily"];
        assert_eq!(dv["sites"][0]["reason"], "failed");
    }

    #[test]
    fn tracked_comes_from_the_producer_else_from_the_owner_scope_list() {
        let t = normalize(&file(&[row("pepgo.org", "1", "ok"), row("judgefinder.io", "2", "ok")], NOW), None, NOW);
        assert_eq!((t["sites"][0]["tracked"].clone(), t["sites"][1]["tracked"].clone()), (json!(true), json!(false)));
        let explicit = row("judgefinder.io", "2", "ok").replace(r#""domain":"judgefinder.io","#, r#""domain":"judgefinder.io","tracked":true,"#);
        assert_eq!(normalize(&file(&[explicit], NOW), None, NOW)["sites"][0]["tracked"], true);
    }

    #[test]
    fn vercel_block_keeps_real_counts_and_never_turns_gaps_into_zero() {
        let base = file(&[row("a.com", "5", "ok")], NOW - 100);
        let vz = format!(
            r#","vercel":{{"provider":"vercel_web_analytics","metric":"pageviews","start_date":"2026-10-08","end_date":"2026-11-04","t":{},"status":"ok","projects":[
              {{"project":"pepgo","domain":"pepgo.org","domains":["pepgo.org"],"pageviews":113,"visitors":34,"status":"ok","t":{},"tracked":true}},
              {{"project":"shared","domain":"a.org","domains":["a.org","b.org","bad domain"],"pageviews":0,"visitors":0,"status":"ok","t":{},"tracked":false}},
              {{"project":"broken","domain":"c.org","domains":["c.org"],"pageviews":9,"visitors":3,"status":"unavailable","error":"Vercel HTTP 403","t":{},"tracked":false}},
              {{"project":"junk","domain":"not a domain","domains":["x.org"],"pageviews":1,"status":"ok"}}]}}}}"#,
            NOW - 50, NOW - 50, NOW - 50, NOW - 50
        );
        let v = normalize(&format!("{}{}", &base[..base.len() - 1], vz), None, NOW);
        let p = v["vercel"]["projects"].as_array().cloned().unwrap_or_default();
        assert_eq!(v["vercel"]["status"], "ok");
        assert_eq!(p.len(), 3, "the row without a valid domain is dropped");
        assert_eq!((p[0]["pageviews"].clone(), p[0]["visitors"].clone(), p[0]["tracked"].clone()), (json!(113), json!(34), json!(true)));
        assert_eq!(p[1]["pageviews"], 0, "a measured zero stays zero");
        assert_eq!(p[1]["domains"], json!(["a.org", "b.org"]), "a bad hostname is dropped from the list");
        assert!(p[2]["pageviews"].is_null() && p[2]["visitors"].is_null(), "a failed project carries no number");
        assert_eq!(p[2]["status"], "unavailable");
        // no block at all: unavailable, and the Search Console rows are untouched
        let none = normalize(&base, None, NOW);
        assert_eq!(none["vercel"]["status"], "unavailable");
        assert_eq!(none["sites"][0]["value"], 5);
    }
}
