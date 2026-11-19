//! Shop > market (deck program 2026-11-14). `GET /api/ecom-market` serves `~/.meshvault/status/house-feeds/ecom-market.json`,
//! written hourly by `scripts/deck-feed-ecom-market` (schema: README, "E-commerce market feed"). Owner only: the guest
//! allowlist and the desk viewer surface name no such route. `/api/ecom` and its file stay as they are.
//!
//! The file carries lists longer than the generic feed cap of 200 rows (best sellers, movers, 60+ source rows) and
//! nests deeper than the generic cleaner keeps (category parts, product offers), so it gets its own bounded copy:
//! contract keys only, depth 8, lists up to 1000, text up to 400 characters, credential-shaped keys dropped (except the
//! field named exactly `key`, which is the row identifier of `macro[]` and `categories[]`). Numbers,
//! booleans and null pass unchanged, so a measured 0 stays 0 and an unknown stays null.
use crate::sources::{read, secret_key};
use crate::util::now_epoch;
use serde_json::{json, Map, Value};
use std::path::Path;
use std::time::Instant;
use tokio::sync::Mutex;

pub const REL: &str = ".meshvault/status/house-feeds/ecom-market.json";
/// The collector's timer (hourly); STALE after 2x.
const REFRESH: u64 = 3600;
const TTL_S: u64 = 60;
const KEYS: [&str; 12] = [
    "v", "generated_at", "macro", "platforms", "bestsellers", "movers", "categories", "watches", "trending", "sources",
    "coverage", "errors",
];
const MAX_DEPTH: u8 = 8;
const MAX_ITEMS: usize = 1000;
const MAX_KEYS: usize = 64;
const MAX_TEXT: usize = 400;

#[derive(Default)]
pub struct Cache(Mutex<Option<(Instant, Value)>>);

impl Cache {
    pub async fn get(&self, home: &Path) -> Value {
        let mut slot = self.0.lock().await;
        if let Some((t, v)) = slot.as_ref() {
            if t.elapsed().as_secs() < TTL_S {
                return v.clone();
            }
        }
        let v = match read(&home.join(REL)).await {
            Ok((text, mtime)) => from_text(&text, mtime, now_epoch()),
            Err(e) => failed(e),
        };
        *slot = Some((Instant::now(), v.clone()));
        v
    }
}

fn failed(why: &str) -> Value {
    json!({"error": why, "src": format!("~/{REL}"), "refresh": REFRESH, "t": null, "age": null, "stale": true})
}

/// The served body for one file text. `t` comes from the file (else its mtime) and `refresh` from the file when sane.
pub fn from_text(text: &str, mtime: Option<u64>, now: u64) -> Value {
    let Ok(Value::Object(m)) = serde_json::from_str::<Value>(text) else {
        return failed("bad json");
    };
    let t = m.get("t").and_then(Value::as_u64).filter(|t| *t > 1_500_000_000 && *t <= now + 300).or(mtime);
    let refresh = m.get("refresh").and_then(Value::as_u64).filter(|r| (10..=604_800).contains(r)).unwrap_or(REFRESH);
    let mut o = Map::new();
    for k in KEYS {
        if let Some(v) = m.get(k) {
            o.insert(k.to_string(), bounded(v, 0));
        }
    }
    let age = t.map(|t| now.saturating_sub(t));
    o.insert("src".into(), json!(format!("~/{REL}")));
    o.insert("refresh".into(), json!(refresh));
    o.insert("t".into(), json!(t));
    o.insert("age".into(), json!(age));
    o.insert("stale".into(), json!(age.map(|a| a > 2 * refresh).unwrap_or(true)));
    Value::Object(o)
}

fn bounded(v: &Value, depth: u8) -> Value {
    match v {
        Value::String(s) => Value::String(s.chars().filter(|c| !c.is_control()).take(MAX_TEXT).collect()),
        Value::Array(a) if depth < MAX_DEPTH => Value::Array(a.iter().take(MAX_ITEMS).map(|x| bounded(x, depth + 1)).collect()),
        Value::Object(m) if depth < MAX_DEPTH => Value::Object(
            m.iter()
                // `key` is this feed's row identifier (`macro[].key`, `categories[].key`), not a credential;
                // `sources::secret_key` drops it for other feeds, so it is exempted here by exact name only
                .filter(|(k, _)| k.as_str() == "key" || !secret_key(k))
                .take(MAX_KEYS)
                .map(|(k, x)| (k.chars().filter(|c| !c.is_control()).take(48).collect(), bounded(x, depth + 1)))
                .collect(),
        ),
        Value::Array(_) | Value::Object(_) => Value::Null,
        x => x.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_794_720_000;

    fn file(t: u64, movers: usize) -> String {
        let rows: Vec<Value> = (0..movers)
            .map(|i| json!({"gid": format!("steam:{i}"), "kind": "on_sale", "change_pct": -20.0, "rank": null,
                            "price": {"median": 9.99, "low": 9.99, "high": 9.99},
                            "detail": {"offers": [{"platform": "Steam", "price": 9.99, "source": "steam_store", "api_key": "k"}]}}))
            .collect();
        json!({"v": 1, "t": t, "refresh": 3600, "generated_at": "2026-11-14T18:40:00-08:00", "movers": rows,
               "macro": [{"key": "ecom_share", "value": 17.1, "period": "2026-Q2", "yoy": null, "change": 0.0}],
               "categories": [{"key": "apparel", "parts": [{"kind": "official", "value": 0.08}],
                               "platform_index": {"hist": [["2026-11-13", 100.0]]}}],
               "sources": [{"id": "ebay_browse", "status": "needs_key", "key_env": ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
                            "api_key": "DO_NOT_SERVE", "token": "DO_NOT_SERVE", "client_secret": "DO_NOT_SERVE",
                            "access_token": "DO_NOT_SERVE", "Authorization": "DO_NOT_SERVE", "password": "DO_NOT_SERVE"}],
               "coverage": {"ok": 30}, "token": "DO_NOT_SERVE", "private_dump": {"x": 1}})
        .to_string()
    }

    #[test]
    fn keeps_more_than_200_rows_nulls_zeros_and_deep_parts() {
        let v = from_text(&file(NOW - 60, 450), None, NOW);
        assert_eq!(v["movers"].as_array().map(Vec::len), Some(450), "the generic 200 cap must not apply");
        assert_eq!(v["macro"][0]["yoy"], Value::Null);
        assert_eq!(v["macro"][0]["change"], json!(0.0));
        assert_eq!(v["categories"][0]["platform_index"]["hist"][0][1], json!(100.0));
        assert_eq!(v["movers"][449]["detail"]["offers"][0]["platform"], "Steam");
        assert_eq!(v["sources"][0]["key_env"][1], "EBAY_CLIENT_SECRET");
        assert_eq!((v["stale"].as_bool(), v["age"].as_u64(), v["t"].as_u64()), (Some(false), Some(60), Some(NOW - 60)));
    }

    #[test]
    fn drops_credentials_and_unknown_keys() {
        let v = from_text(&file(NOW, 1), None, NOW);
        assert!(v.get("token").is_none() && v.get("private_dump").is_none());
        assert!(v["movers"][0]["detail"]["offers"][0].get("api_key").is_none());
        assert!(!v.to_string().contains("DO_NOT_SERVE"));
    }

    #[test]
    fn macro_and_category_rows_keep_their_key_while_credentials_still_drop() {
        let v = from_text(&file(NOW, 1), None, NOW);
        assert_eq!(v["macro"][0]["key"], "ecom_share");
        assert_eq!(v["categories"][0]["key"], "apparel");
        let src = &v["sources"][0];
        for k in ["api_key", "token", "client_secret", "access_token", "Authorization", "password"] {
            assert!(src.get(k).is_none(), "{k} must be dropped");
        }
        assert_eq!(src["key_env"][0], "EBAY_CLIENT_ID");
        // only the exact name is exempt: a nested `KEY` or `apikey` still drops
        let w = from_text(&json!({"t": NOW, "macro": [{"key": "a", "KEY": "x", "apikey": "y"}]}).to_string(), None, NOW);
        assert_eq!(w["macro"][0].as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()), Some(vec!["key".to_string()]));
    }

    #[test]
    fn nesting_past_the_depth_cap_reads_null() {
        let mut deep = json!("leaf");
        for _ in 0..12 {
            deep = json!({"key": deep});
        }
        let v = from_text(&json!({"t": NOW, "macro": [deep]}).to_string(), None, NOW);
        let mut cur = &v["macro"][0];
        let mut levels = 0;
        while let Some(next) = cur.get("key") {
            cur = next;
            levels += 1;
        }
        assert_eq!(*cur, Value::Null, "objects deeper than MAX_DEPTH are cut, not passed");
        assert_eq!(levels, usize::from(MAX_DEPTH) - 1, "macro[0] sits at depth 1; the object at depth 8 is cut");
    }

    /// Proof over a real collector file: `ECOM_MARKET_FILE=<path> cargo test -- --ignored real_file`.
    #[test]
    #[ignore]
    fn real_file_keeps_row_keys_and_serves_no_credential_shaped_key() {
        let Ok(path) = std::env::var("ECOM_MARKET_FILE") else { panic!("set ECOM_MARKET_FILE") };
        let Ok(text) = std::fs::read_to_string(&path) else { panic!("read {path}") };
        let v = from_text(&text, None, now_epoch());
        println!("macro[0].key={} categories[0].key={} macro={} categories={}", v["macro"][0]["key"], v["categories"][0]["key"],
                 v["macro"].as_array().map_or(0, Vec::len), v["categories"].as_array().map_or(0, Vec::len));
        assert!(v["macro"].as_array().is_some_and(|a| a.iter().all(|r| r["key"].is_string())));
        assert!(v["categories"].as_array().is_some_and(|a| a.iter().all(|r| r["key"].is_string())));
        fn walk(v: &Value, bad: &mut Vec<String>) {
            match v {
                Value::Object(m) => m.iter().for_each(|(k, x)| {
                    if k != "key" && secret_key(k) {
                        bad.push(k.clone());
                    }
                    walk(x, bad)
                }),
                Value::Array(a) => a.iter().for_each(|x| walk(x, bad)),
                _ => {}
            }
        }
        let mut bad = vec![];
        walk(&v, &mut bad);
        assert!(bad.is_empty(), "credential-shaped keys served: {bad:?}");
    }

    #[test]
    fn older_than_twice_refresh_is_stale_but_still_served() {
        let v = from_text(&file(NOW - 7201, 3), None, NOW);
        assert_eq!(v["stale"], true);
        assert_eq!(v["movers"].as_array().map(Vec::len), Some(3));
    }

    #[test]
    fn lists_and_text_stay_bounded() {
        let long = "x".repeat(2000);
        let rows: Vec<Value> = (0..1500).map(|i| json!(i)).collect();
        let v = from_text(&json!({"t": NOW, "bestsellers": rows, "errors": [{"source": "s", "reason": long}]}).to_string(), None, NOW);
        assert_eq!(v["bestsellers"].as_array().map(Vec::len), Some(MAX_ITEMS));
        assert_eq!(v["errors"][0]["reason"].as_str().map(|s| s.chars().count()), Some(MAX_TEXT));
    }

    #[test]
    fn bad_json_and_a_missing_t_read_as_failures_or_mtime() {
        assert_eq!(from_text("not json", None, NOW)["error"], "bad json");
        let v = from_text(r#"{"coverage":{"ok":1}}"#, Some(NOW - 30), NOW);
        assert_eq!((v["t"].as_u64(), v["stale"].as_bool()), (Some(NOW - 30), Some(false)));
        assert_eq!(failed("file missing")["src"], "~/.meshvault/status/house-feeds/ecom-market.json");
    }
}
