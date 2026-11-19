//! `/api/amazon`: the Amazon view of the Shop tab. Read-only: the shoptrends database the shopping collectors write
//! (`~/.local/share/hermes-shop/trends.db`) is opened with `sqlite3 -readonly`. The one write is this route's own last good
//! answer (`LAST_REL`, mode 600), so the first read after a start answers at once instead of waiting about 2 s for sqlite
//! (SeePerf P11). Nothing here buys, adds to a cart or signs in; a link is the public product page on www.amazon.com.
//!
//! Per watched search: the best current Amazon price, up to MAX_ITEMS current offers, the 30 day line of the lowest
//! Amazon price per day, the 7 and 30 day change (`chg30` compares with 28 days back, the oldest day a 30 day window
//! reliably holds), and which offers dropped. Across watches: the deal list, the same drops (lower than the price
//! before, or at least DROP under their own 7 day average), one row per product page. The watch's own filters and the
//! shoptrends title rules (relevance.rs) are applied here, so a case never counts as a headphone or vacuum price.
use crate::relevance::{deal_title_ok, price_band, title_ok};
use crate::util::{iso_to_epoch, now_epoch, run};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

pub const DB_REL: &str = ".local/share/hermes-shop/trends.db";
const SQL: &str = include_str!("amazon.sql");
const MAX_WATCH: usize = 20;
const MAX_ITEMS: usize = 4;
const MAX_DEALS: usize = 6;
/// An offer last seen more than this long ago is history, not a current price.
const CURRENT_S: u64 = 3 * 86400;
/// A price at least this far under its own 7 day average is a drop.
pub const DROP: f64 = 0.05;
/// Amazon is collected hourly; a newest price older than this reads out of date.
const STALE_S: u64 = 6 * 3600;
pub const SRC: &str = "shop trends database (Amazon search pages)";
/// The last good answer, kept beside the deck's other state.
pub const LAST_REL: &str = ".local/state/pixel-deck/amazon-last.json";
/// The largest kept answer (today's is about 19 KB): a bigger one is neither written nor read.
pub const MAX_KEPT: u64 = 1024 * 1024;

/// Keep a good answer (no `error`) for the next start. Written whole then renamed, so a reader never sees half a file.
pub fn remember(home: &Path, v: &Value) {
    use std::os::unix::fs::OpenOptionsExt;
    if v.get("error").is_some_and(|e| !e.is_null()) || !v["watch"].is_array() {
        return;
    }
    let path = home.join(LAST_REL);
    let Some(dir) = path.parent() else { return };
    let tmp = dir.join("amazon-last.json.tmp");
    let body = json!({"kept_at": now_epoch(), "answer": v}).to_string();
    if body.len() as u64 > MAX_KEPT {
        return;
    }
    let written = std::fs::create_dir_all(dir).and_then(|_| {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().create(true).write(true).truncate(true).mode(0o600).open(&tmp)?;
        f.write_all(body.as_bytes())
    });
    if written.is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

/// The kept answer, marked `stale` with the time it was kept (`kept_at`): it stands in only until the background
/// refresh lands. None when there is none or it does not read as an answer.
pub async fn last(home: &Path) -> Option<Value> {
    let p = home.join(LAST_REL);
    if tokio::fs::metadata(&p).await.ok()?.len() > MAX_KEPT {
        return None;
    }
    let text = tokio::fs::read_to_string(&p).await.ok()?;
    let file: Value = serde_json::from_str(&text).ok()?;
    let mut v = file.get("answer").filter(|a| a["watch"].is_array() && a.get("error").is_none_or(Value::is_null))?.clone();
    v["stale"] = json!(true);
    v["kept_at"] = file.get("kept_at").filter(|t| t.is_u64()).cloned().unwrap_or(Value::Null);
    Some(v)
}

pub async fn get(home: &Path) -> Value {
    let db = home.join(DB_REL);
    if !db.exists() {
        return fail("shop database missing");
    }
    let Some(dbs) = db.to_str() else {
        return fail("database path is not text");
    };
    // the SQL goes on stdin: as an argument its leading "--" comment would read as a command-line option
    match run(&["sqlite3", "-readonly", "-json", "-cmd", ".timeout 3000", dbs], Some(SQL.as_bytes()), 20, &[]).await {
        Ok((0, out)) => from_rows(&out, now_epoch()),
        Ok((rc, _)) => fail(&format!("sqlite3 exited {rc}")),
        Err(e) => fail(&format!("sqlite3 {e}")),
    }
}

fn fail(e: &str) -> Value {
    json!({"error": e, "stale": true, "src": SRC, "watch": [], "deals": []})
}

fn f(v: &Value, k: &str) -> Option<f64> {
    v.get(k).and_then(Value::as_f64).filter(|x| x.is_finite())
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("")
}

/// The watch's own filters, as the collectors apply them: a price inside [lo, hi] and a title that looks like the watched
/// product (query, `must` and `exclude` words, no accessories; see relevance.rs).
fn keep(item: &Value, price: f64) -> bool {
    if f(item, "lo").is_some_and(|lo| price < lo) || f(item, "hi").is_some_and(|hi| price > hi) {
        return false;
    }
    // a protection plan or gift card is never this product's price, in the best price, the deals or the 30 day line
    title_ok(s(item, "title"), s(item, "query"), s(item, "must"), s(item, "excl")) && deal_title_ok(s(item, "title"))
}

/// Only a public product page on www.amazon.com leaves; anything else reads null and is not linked.
fn link(u: &str) -> Option<String> {
    let ok = u.starts_with("https://www.amazon.com/") && u.len() <= 300 && !u.chars().any(|c| c.is_whitespace() || c.is_control() || c == '"');
    ok.then(|| u.to_string())
}

fn day_of(d: &str) -> Option<u64> {
    iso_to_epoch(&format!("{d}T00:00:00Z")).map(|t| t / 86400)
}

fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

/// Change from the price `back` days before the newest day (the nearest earlier day with a price), as a fraction.
fn change(hist: &[(u64, f64)], back: u64) -> Option<f64> {
    let &(last_d, last_p) = hist.last()?;
    let &(_, then) = hist.iter().rev().find(|(d, _)| *d + back <= last_d)?;
    (then > 0.0).then(|| (last_p - then) / then).map(|c| (c * 10_000.0).round() / 10_000.0)
}

pub fn from_rows(text: &str, now: u64) -> Value {
    let rows: Vec<Value> = if text.trim().is_empty() {
        vec![]
    } else {
        match serde_json::from_str::<Value>(text) {
            Ok(Value::Array(a)) => a,
            _ => return fail("bad sqlite3 output"),
        }
    };
    // watch slug -> (query, kept items); every kept listing id joins the day line
    let mut watches: BTreeMap<String, (String, Vec<Value>)> = BTreeMap::new();
    let mut kept: HashSet<(String, i64)> = HashSet::new();
    let mut bounds: HashMap<String, (Option<f64>, Option<f64>)> = HashMap::new();
    let mut newest = 0u64;
    for r in rows.iter().filter(|r| s(r, "kind") == "item") {
        let slug = s(r, "slug").chars().take(60).collect::<String>();
        let (Some(price), Some(id), Some(url)) = (f(r, "price"), r.get("id").and_then(Value::as_i64), link(s(r, "url"))) else {
            continue;
        };
        bounds.insert(slug.clone(), (f(r, "lo"), f(r, "hi")));
        if price <= 0.0 || !keep(r, price) {
            continue;
        }
        kept.insert((slug.clone(), id));
        let seen = r.get("seen").and_then(Value::as_f64).filter(|t| *t > 0.0).map_or(0, |t| t as u64);
        newest = newest.max(seen);
        let (prev, avg7, min30, max30) = (f(r, "prev"), f(r, "avg7"), f(r, "min30"), f(r, "max30"));
        let below = avg7.filter(|a| *a > 0.0).map(|a| (a - price) / a).filter(|d| *d >= DROP);
        let item = json!({
            "title": s(r, "title").chars().take(140).collect::<String>(),
            "url": url,
            "price": round2(price),
            "seen": seen,
            "prev": prev.map(round2),
            "min7": f(r, "min7").map(round2),
            "avg7": avg7.map(round2),
            "min30": min30.map(round2),
            "max30": max30.map(round2),
            "dropped": prev.is_some_and(|p| price < p * 0.99),
            "below_avg": below.map(|d| (d * 1000.0).round() / 1000.0),
            "low30": min30.is_some_and(|m| price <= m) && max30.zip(min30).is_some_and(|(hi, lo)| hi > lo * 1.02),
            "current": now.saturating_sub(seen) <= CURRENT_S,
        });
        watches.entry(slug).or_insert_with(|| (s(r, "query").chars().take(60).collect(), vec![])).1.push(item);
    }
    // the 30 day line: per watch and local day, every price of an offer the filters kept (the band is applied per watch below)
    let mut days: HashMap<String, BTreeMap<u64, Vec<f64>>> = HashMap::new();
    for r in rows.iter().filter(|r| s(r, "kind") == "day") {
        let slug = s(r, "slug").chars().take(60).collect::<String>();
        let (Some(id), Some(p), Some(d)) = (r.get("id").and_then(Value::as_i64), f(r, "price"), day_of(s(r, "day"))) else {
            continue;
        };
        let (lo, hi) = bounds.get(&slug).copied().unwrap_or((None, None));
        if !kept.contains(&(slug.clone(), id)) || lo.is_some_and(|lo| p < lo) || hi.is_some_and(|hi| p > hi) {
            continue;
        }
        days.entry(slug).or_default().entry(d).or_default().push(p);
    }
    let mut deals: Vec<Value> = vec![];
    let mut out: Vec<Value> = vec![];
    for (slug, (query, mut items)) in watches.into_iter().take(MAX_WATCH) {
        items.sort_by(|a, b| f(a, "price").partial_cmp(&f(b, "price")).unwrap_or(std::cmp::Ordering::Equal));
        // shoptrends price sanity: with 5 or more current prices, an offer outside 0.3 to 4 times their median is not this
        // product (a filter under a vacuum search); a protection plan or gift card is never a price
        let band = price_band(&items.iter().filter(|i| i["current"] == true).filter_map(|i| f(i, "price")).collect::<Vec<_>>());
        let inside = |p: f64| band.is_none_or(|(lo, hi)| p >= lo && p <= hi);
        let cur: Vec<&Value> = items
            .iter()
            .filter(|i| i["current"] == true && f(i, "price").is_some_and(inside))
            .collect();
        let hist: Vec<(u64, f64)> = days
            .get(&slug)
            .map(|m| {
                m.iter()
                    .filter_map(|(d, ps)| ps.iter().copied().filter(|p| inside(*p)).reduce(f64::min).map(|p| (*d, round2(p))))
                    .collect()
            })
            .unwrap_or_default();
        let line: Vec<f64> = hist.iter().rev().take(30).rev().map(|(_, p)| *p).collect();
        // one rule for the drop count and the deal list: lower than the price before it, or under its own 7 day average
        let drops: Vec<&&Value> = cur.iter().filter(|i| i["dropped"] == true || !i["below_avg"].is_null()).collect();
        for d in &drops {
            let mut x = (**d).clone();
            x["query"] = json!(query);
            deals.push(x);
        }
        let low30 = hist.iter().map(|(_, p)| *p).fold(None, |m: Option<f64>, p| Some(m.map_or(p, |m| m.min(p))));
        out.push(json!({
            "slug": slug,
            "query": query,
            "best": cur.first().map(|b| (*b).clone()),
            "items": cur.iter().take(MAX_ITEMS).map(|i| (*i).clone()).collect::<Vec<_>>(),
            "offers": cur.len(),
            "drops": drops.len(),
            "line": line,
            "days": hist.len(),
            "chg7": change(&hist, 7),
            "chg30": change(&hist, 28),
            "low30": low30,
        }));
    }
    // biggest gap under the 7 day average first, then the biggest fall from the price before; one row per product page
    let fall = |v: &Value| f(v, "prev").zip(f(v, "price")).map_or(0.0, |(p, n)| if p > 0.0 { (p - n) / p } else { 0.0 });
    deals.sort_by(|a, b| {
        (f(b, "below_avg").unwrap_or(0.0), fall(b)).partial_cmp(&(f(a, "below_avg").unwrap_or(0.0), fall(a))).unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut seen_urls = HashSet::new();
    deals.retain(|d| seen_urls.insert(s(d, "url").to_string()));
    deals.truncate(MAX_DEALS);
    let t = (newest > 0).then_some(newest);
    json!({
        "t": t,
        "generated_at": now,
        "as_of": t,
        "age": t.map(|t| now.saturating_sub(t)),
        "stale": t.is_none_or(|t| now.saturating_sub(t) > STALE_S),
        "src": SRC,
        "drop_rule": format!("A drop is a price at least {}% under its own 7 day average, or lower than the price before it.", (DROP * 100.0).round()),
        "watch": out,
        "deals": deals,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_792_640_000; // 2026-10-22T03:33:20Z

    fn item(slug: &str, id: i64, title: &str, price: f64, seen: u64, extra: Value) -> Value {
        let mut v = json!({"kind": "item", "slug": slug, "query": slug.replace('-', " "), "id": id, "title": title,
            "url": format!("https://www.amazon.com/dp/B0{id:08}"), "price": price, "seen": seen, "prev": null,
            "min7": price, "avg7": price, "min30": price, "max30": price, "day": null, "lo": null, "hi": null, "must": null, "excl": null});
        if let (Some(o), Some(e)) = (v.as_object_mut(), extra.as_object()) {
            for (k, x) in e {
                o.insert(k.clone(), x.clone());
            }
        }
        v
    }

    fn day(slug: &str, id: i64, d: &str, p: f64) -> Value {
        json!({"kind": "day", "slug": slug, "id": id, "price": p, "day": d})
    }

    fn rows(v: Vec<Value>) -> String {
        Value::Array(v).to_string()
    }

    #[test]
    fn best_price_drops_deals_and_the_day_line_come_from_kept_current_offers() {
        let t = NOW - 600;
        let r = rows(vec![
            // a real drop: 10% under its 7 day average and lower than the price before it
            item("sony-wh-1000xm5", 1, "Sony WH-1000XM5 Wireless Headphones", 198.0, t,
                json!({"prev": 228.0, "avg7": 220.0, "min7": 198.0, "min30": 198.0, "max30": 298.0, "lo": 80.0})),
            item("sony-wh-1000xm5", 2, "Sony WH-1000XM5 Headphones Silver", 248.0, t, json!({"lo": 80.0})),
            // under the watch's min price: an accessory, never the best price
            item("sony-wh-1000xm5", 3, "Case for Sony WH-1000XM5", 15.0, t, json!({"lo": 80.0})),
            // not seen for 5 days: history, not a current offer
            item("sony-wh-1000xm5", 4, "Sony WH-1000XM5 Black", 150.0, NOW - 5 * 86400, json!({"lo": 80.0})),
            day("sony-wh-1000xm5", 1, "2026-10-14", 240.0),
            day("sony-wh-1000xm5", 2, "2026-10-14", 250.0),
            day("sony-wh-1000xm5", 3, "2026-10-14", 15.0),
            day("sony-wh-1000xm5", 1, "2026-10-21", 198.0),
        ]);
        let v = from_rows(&r, NOW);
        let w = &v["watch"][0];
        assert_eq!(w["query"], "sony wh 1000xm5");
        assert_eq!(w["best"]["price"], 198.0);
        assert_eq!(w["best"]["url"], "https://www.amazon.com/dp/B000000001");
        assert_eq!(w["best"]["dropped"], true);
        assert_eq!(w["best"]["below_avg"], 0.1);
        assert_eq!(w["best"]["low30"], true);
        assert_eq!(w["offers"], 2, "{w}");
        assert_eq!(w["drops"], 1);
        // the case's $15 day is not the line's low; the line is 240 then 198
        assert_eq!(w["line"], json!([240.0, 198.0]));
        assert_eq!(w["chg7"], json!(-0.175));
        assert_eq!(w["chg30"], Value::Null);
        assert_eq!(v["deals"].as_array().map(Vec::len), Some(1));
        assert_eq!(v["deals"][0]["query"], "sony wh 1000xm5");
        assert_eq!(v["stale"], false);
        assert_eq!(v["age"], 600);
    }

    #[test]
    fn must_and_exclude_words_follow_the_watch_and_links_stay_on_amazon() {
        let t = NOW - 60;
        let r = rows(vec![
            item("kitchenaid-mixer", 1, "KitchenAid Artisan Stand Mixer", 299.0, t, json!({"must": "stand"})),
            item("kitchenaid-mixer", 2, "KitchenAid Hand Mixer", 59.0, t, json!({"must": "stand"})),
            item("robot-vacuum", 3, "Side Brush (L/R) for Robot Vacuum", 70.0, t, json!({"excl": "l r"})),
            item("robot-vacuum", 4, "Robot Vacuum S8", 299.0, t, json!({"excl": "l r"})),
            item("robot-vacuum", 5, "Robot Vacuum S8 Lite", 199.0, t, json!({"url": "https://evil.example/dp/1"})),
            item("robot-vacuum", 6, "Robot Vacuum \"quoted\"", 189.0, t, json!({"url": "https://www.amazon.com/dp/\"x"})),
        ]);
        let v = from_rows(&r, NOW);
        let by = |slug: &str| v["watch"].as_array().and_then(|a| a.iter().find(|w| w["slug"] == slug)).cloned().unwrap_or_default();
        assert_eq!(by("kitchenaid-mixer")["best"]["title"], "KitchenAid Artisan Stand Mixer");
        assert_eq!(by("kitchenaid-mixer")["offers"], 1);
        assert_eq!(by("robot-vacuum")["best"]["title"], "Robot Vacuum S8");
        assert_eq!(by("robot-vacuum")["offers"], 1);
        assert!(!v.to_string().contains("evil.example"));
    }

    #[test]
    fn a_protection_plan_never_feeds_the_line_and_a_product_page_is_one_deal() {
        let t = NOW - 60;
        let r = rows(vec![
            item("iphone-13", 1, "Apple iPhone 13 128GB", 250.0, t, json!({"prev": 300.0})),
            item("iphone-13", 2, "iPhone 13 3-Year Protection Plan", 60.0, t, json!({})),
            day("iphone-13", 1, "2026-10-21", 250.0),
            day("iphone-13", 2, "2026-10-21", 60.0),
            // the same product page found by a second watch is one deal row
            item("iphone", 1, "Apple iPhone 13 128GB", 250.0, t, json!({"prev": 300.0})),
        ]);
        let v = from_rows(&r, NOW);
        let w = &v["watch"][1];
        assert_eq!((w["slug"].clone(), w["offers"].clone(), w["line"].clone()), (json!("iphone-13"), json!(1), json!([250.0])));
        assert_eq!(v["deals"].as_array().map(Vec::len), Some(1), "{}", v["deals"]);
        assert_eq!(v["deals"][0]["dropped"], true);
    }

    #[test]
    fn empty_old_and_broken_output_say_so() {
        let v = from_rows("", NOW);
        assert_eq!((v["watch"].clone(), v["stale"].clone(), v["t"].clone()), (json!([]), json!(true), Value::Null));
        let old = from_rows(&rows(vec![item("x", 1, "X thing", 10.0, NOW - 7 * 3600, json!({}))]), NOW);
        assert_eq!(old["stale"], true);
        assert_eq!(old["watch"][0]["best"]["price"], 10.0);
        assert_eq!(from_rows("not json", NOW)["error"], "bad sqlite3 output");
    }

    #[tokio::test]
    async fn a_missing_database_is_an_error_object() {
        let v = get(Path::new("/nonexistent/pixel-deck-amazon")).await;
        assert_eq!((v["error"].clone(), v["stale"].clone()), (json!("shop database missing"), json!(true)));
    }

    #[tokio::test]
    async fn the_last_good_answer_is_kept_and_read_back_stale() {
        let home = std::env::temp_dir().join(format!("pdeck-amazon-last-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        assert!(last(&home).await.is_none(), "nothing kept yet");
        // an error answer is never kept
        remember(&home, &fail("sqlite3 exited 1"));
        assert!(last(&home).await.is_none());
        let good = json!({"src": SRC, "stale": false, "watch": [{"slug": "kitchenaid-mixer", "best": 199.0}], "deals": []});
        remember(&home, &good);
        let path = home.join(LAST_REL);
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&path).map(|m| m.permissions().mode() & 0o777).ok(), Some(0o600));
        let Some(v) = last(&home).await else { panic!("kept answer not read") };
        assert_eq!(v["watch"], good["watch"]);
        assert_eq!(v["stale"], true, "a kept answer reads out of date until the refresh lands");
        assert!(v["kept_at"].is_u64());
        // a later error leaves the good one in place; a file that is not an answer reads as none
        remember(&home, &fail("shop database missing"));
        assert!(last(&home).await.is_some());
        let _ = std::fs::write(&path, r#"{"kept_at":1,"answer":{"error":"x","watch":[]}}"#);
        assert!(last(&home).await.is_none());
        let _ = std::fs::write(&path, "not json");
        assert!(last(&home).await.is_none());
        // the size cap: an answer over 1 MB is not written, and a file over 1 MB is not read
        remember(&home, &good);
        let huge = json!({"src": SRC, "watch": [{"slug": "x".repeat(MAX_KEPT as usize)}], "deals": []});
        remember(&home, &huge);
        assert_eq!(last(&home).await.map(|v| v["watch"].clone()), Some(good["watch"].clone()), "the big one was not kept");
        let _ = std::fs::write(&path, json!({"kept_at": 1, "answer": huge}).to_string());
        assert!(last(&home).await.is_none());
        let _ = std::fs::remove_dir_all(&home);
    }
}
