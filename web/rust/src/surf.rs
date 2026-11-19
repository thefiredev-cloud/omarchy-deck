//! Surf, Cabo San Lucas to the Columbia River (owner order 2026-11-14). `deck-feed-surf-coast` writes the overview
//! `house-feeds/surf-coast.json` and one detail file per region under `house-feeds/surf-coast/`; contract in
//! `docs/surf-coast.md`. `GET /api/surf-coast` serves the overview and `GET /api/surf-coast/region/<id>` one region,
//! both owner only (the guest allowlist names neither).
//!
//! The generic feed cleaner in `sources.rs` keeps contract keys and cuts arrays at 200 rows; this feed carries about
//! 246 spots, 400 water rows and 72-step hourly series, so it is served whole with control characters removed and
//! a generous cap. `age`, `stale` (age over 2x `refresh`) and `refresh` are added like every other feed. A missing
//! file is `{status:"not_reporting", reason}`, never a 5xx.
use crate::util::now_epoch;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const OVERVIEW: &str = ".meshvault/status/house-feeds/surf-coast.json";
pub const REGION_DIR: &str = ".meshvault/status/house-feeds/surf-coast";
/// The writer's documented refresh interval (30 min), used when the file carries none.
pub const REFRESH: u64 = 1800;
/// Region ids, south to north. Anything else is a 404, so a path never leaves `REGION_DIR`.
pub const REGIONS: [&str; 14] = [
    "baja-sur",
    "baja-norte",
    "san-diego",
    "orange-county",
    "los-angeles",
    "ventura",
    "santa-barbara",
    "san-luis-obispo",
    "monterey-santa-cruz",
    "san-francisco-marin",
    "sonoma-del-norte",
    "oregon-south",
    "oregon-central",
    "oregon-north",
];
const MAX_FILE: u64 = 16 * 1024 * 1024;
const MAX_TEXT: usize = 600;
const MAX_ITEMS: usize = 5000;
const MAX_DEPTH: u8 = 12;

pub fn not_reporting(reason: &str) -> Value {
    json!({"status": "not_reporting", "reason": reason, "t": now_epoch()})
}

/// `GET /api/surf-coast`
pub async fn overview(home: &Path) -> Value {
    read(home.join(OVERVIEW), now_epoch()).await
}

/// `GET /api/surf-coast/region/<id>`: 404 for an id that is not one of the 14 regions.
pub async fn region(home: &Path, id: &str) -> (u16, Value) {
    if !REGIONS.contains(&id) {
        return (404, json!({"error": "unknown region"}));
    }
    (200, read(home.join(REGION_DIR).join(format!("{id}.json")), now_epoch()).await)
}

async fn read(p: PathBuf, now: u64) -> Value {
    let meta = match tokio::fs::metadata(&p).await {
        Ok(m) if m.is_file() => m,
        Ok(_) => return not_reporting("not a file"),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return not_reporting("surf is not reporting yet"),
        Err(e) => return not_reporting(&format!("unreadable: {}", e.kind())),
    };
    if meta.len() > MAX_FILE {
        return not_reporting("file is too large");
    }
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs());
    match tokio::fs::read_to_string(&p).await {
        Ok(text) => from_text(&text, mtime, now),
        Err(e) => not_reporting(&format!("unreadable: {}", e.kind())),
    }
}

/// The served document: the file's own object with text cleaned, plus `t`, `age`, `refresh` and `stale`.
pub fn from_text(text: &str, mtime: Option<u64>, now: u64) -> Value {
    let Ok(Value::Object(m)) = serde_json::from_str::<Value>(text) else {
        return not_reporting("bad json");
    };
    let t = m
        .get("t")
        .and_then(Value::as_u64)
        .filter(|t| *t > 1_500_000_000 && *t <= now + 300)
        .or(mtime);
    let refresh = m
        .get("refresh")
        .and_then(Value::as_u64)
        .filter(|r| (10..=604_800).contains(r))
        .unwrap_or(REFRESH);
    let Value::Object(mut o) = clean(&Value::Object(m), 0) else {
        return not_reporting("bad json");
    };
    let age = t.map(|t| now.saturating_sub(t));
    o.insert("t".into(), t.map_or(Value::Null, Value::from));
    o.insert("age".into(), age.map_or(Value::Null, Value::from));
    o.insert("refresh".into(), refresh.into());
    o.insert("stale".into(), age.map(|a| a > 2 * refresh).unwrap_or(true).into());
    Value::Object(o)
}

/// Control characters out, text and lists capped well above what the collector writes, nesting bounded.
/// Numbers, booleans and nulls pass unchanged, so a measured 0 stays 0 and a missing value stays null.
fn clean(v: &Value, depth: u8) -> Value {
    match v {
        Value::String(s) => Value::String(s.chars().filter(|c| !c.is_control()).take(MAX_TEXT).collect()),
        Value::Array(a) if depth < MAX_DEPTH => Value::Array(a.iter().take(MAX_ITEMS).map(|x| clean(x, depth + 1)).collect()),
        Value::Object(m) if depth < MAX_DEPTH => Value::Object(
            m.iter()
                .take(MAX_ITEMS)
                .map(|(k, x)| (k.chars().filter(|c| !c.is_control()).take(64).collect::<String>(), clean(x, depth + 1)))
                .collect::<Map<String, Value>>(),
        ),
        Value::Array(_) | Value::Object(_) => Value::Null,
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_794_715_200;

    #[test]
    fn keeps_every_spot_and_adds_age_and_stale() {
        // the generic feed cleaner cuts arrays at 200 rows; 246 spots must all reach the page
        let spots: Vec<Value> = (0..246).map(|i| json!({"id": format!("s{i}"), "now": {"hs_ft": 0.0, "rating": null}})).collect();
        let file = json!({"v": 1, "t": NOW - 600, "refresh": 1800, "spots": spots, "regions": []}).to_string();
        let v = from_text(&file, None, NOW);
        assert_eq!(v["spots"].as_array().map(Vec::len), Some(246));
        assert_eq!((v["age"].as_u64(), v["stale"].as_bool(), v["refresh"].as_u64()), (Some(600), Some(false), Some(1800)));
        // a measured 0 stays 0 and a missing value stays null
        assert_eq!(v["spots"][5]["now"]["hs_ft"], json!(0.0));
        assert!(v["spots"][5]["now"]["rating"].is_null());
    }

    #[test]
    fn older_than_twice_refresh_is_stale_and_a_future_t_falls_back_to_mtime() {
        let file = json!({"t": NOW - 3601, "refresh": 1800}).to_string();
        assert_eq!(from_text(&file, None, NOW)["stale"], true);
        let file = json!({"t": NOW - 3600, "refresh": 1800}).to_string();
        assert_eq!(from_text(&file, None, NOW)["stale"], false);
        let future = json!({"t": NOW + 9999}).to_string();
        let v = from_text(&future, Some(NOW - 60), NOW);
        assert_eq!((v["t"].as_u64(), v["age"].as_u64(), v["refresh"].as_u64()), (Some(NOW - 60), Some(60), Some(REFRESH)));
        let v = from_text("{}", None, NOW);
        assert_eq!((v["stale"].as_bool(), v["age"].is_null()), (Some(true), true));
    }

    #[test]
    fn text_loses_control_characters_and_bad_json_is_not_reporting() {
        let file = json!({"t": NOW, "alerts": [{"text": "High surf\u{0007} advisory\n until Sun 10 am."}]}).to_string();
        let v = from_text(&file, None, NOW);
        assert_eq!(v["alerts"][0]["text"], "High surf advisory until Sun 10 am.");
        assert_eq!(from_text("[1,2]", None, NOW)["status"], "not_reporting");
        assert_eq!(from_text("nope", None, NOW)["reason"], "bad json");
    }

    #[tokio::test]
    async fn region_ids_are_validated_and_missing_files_say_not_reporting() {
        let home = std::env::temp_dir().join(format!("pdeck-surf-unit-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        for bad in ["../surf-coast", "orange-county/../../x", "Orange-County", "", "atlantis"] {
            assert_eq!(region(&home, bad).await.0, 404, "{bad}");
        }
        let (code, v) = region(&home, "orange-county").await;
        assert_eq!((code, v["status"].as_str()), (200, Some("not_reporting")));
        assert_eq!(overview(&home).await["status"], "not_reporting");
        let dir = home.join(REGION_DIR);
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(dir.join("baja-sur.json"), json!({"t": now_epoch(), "region": {"id": "baja-sur"}}).to_string());
        let (code, v) = region(&home, "baja-sur").await;
        assert_eq!((code, v["region"]["id"].as_str(), v["stale"].as_bool()), (200, Some("baja-sur"), Some(false)));
        let _ = std::fs::remove_dir_all(&home);
    }
}
