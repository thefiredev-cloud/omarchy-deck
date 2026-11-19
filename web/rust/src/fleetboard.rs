//! Fleet tab build-out: GET /api/fleet-board. Every part reads one small snapshot, labels its source and
//! age, and reports `error` instead of a number when the source is missing. Unavailable is never zero.
//! No shell access: the only subprocess-free reads are files, plus the loopback cluster GETs the
//! existing /api/fleet already makes.
//!   machines  ~/.local/state/fleet-disks.json (reachability, disk used and free)
//!   cluster   live http://127.0.0.1:8080/v1/models + /metrics, newest ~/.hermes/cache/scratch/cluster-bench-*.json
//!   models    ~/.meshvault/status/deck/device-models.json (written by another lane; "unknown" when missing)
//!   backup    ~/.meshvault/status/deck/gitsync.json (local tracking-ref estimates; no remote verification)
//!   units     ~/.meshvault/status/deck/fleet.json (written by ~/ops/bin/deck-fleet-snapshot)
use crate::util::{now_epoch, iso_to_epoch};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

pub const DISKS_REL: &str = ".local/state/fleet-disks.json";
pub const MODELS_REL: &str = ".meshvault/status/deck/device-models.json";
pub const GITSYNC_REL: &str = ".meshvault/status/deck/gitsync.json";
pub const SCRATCH_REL: &str = ".hermes/cache/scratch";
pub const UNITS_REL: &str = ".meshvault/status/deck/fleet.json";
/// Stale after two writer intervals. Disks: ten minutes per scripts/launch-names.seed.json's
/// fleet-disks entry (the installed timer unit is not available here). fleet.json: five minutes.
const DISKS_REFRESH: u64 = 600;
const UNITS_REFRESH: u64 = 300;
const MODELS_REFRESH: u64 = 3600;
const MACHINES: [&str; 5] = ["pc-desktop", "Spark", "Ascent", "Dell", "Mac Mini"];

/// Control characters (Cc) and invisible format characters (Cf: bidi overrides and isolates, zero width, BOM, tags) never reach the screen.
fn drop_char(c: char) -> bool {
    c.is_control()
        || matches!(c as u32,
            0x00AD | 0x0600..=0x0605 | 0x061C | 0x06DD | 0x070F | 0x0890..=0x0891 | 0x08E2 | 0x180E
            | 0x200B..=0x200F | 0x202A..=0x202E | 0x2060..=0x2064 | 0x2066..=0x206F
            | 0xFEFF | 0xFFF9..=0xFFFB | 0x110BD | 0x110CD | 0x13430..=0x1343F | 0x1BCA0..=0x1BCA3
            | 0x1D173..=0x1D17A | 0xE0001 | 0xE0020..=0xE007F)
}

fn clean_str(s: &str, n: usize) -> String {
    s.chars().filter(|c| !drop_char(*c)).take(n).collect::<String>().trim().to_string()
}

fn clean(v: Option<&Value>, n: usize) -> String {
    clean_str(v.and_then(Value::as_str).unwrap_or(""), n)
}

fn unavailable(src: &str, why: &str, now: u64) -> Value {
    json!({"error": why, "src": src, "t": Value::Null, "age": Value::Null, "stale": true, "checked": now})
}

fn stamp(o: &mut Map<String, Value>, src: &str, t: Option<u64>, now: u64, refresh: Option<u64>) {
    let age = t.map(|t| now.saturating_sub(t));
    o.insert("src".into(), src.into());
    o.insert("t".into(), json!(t));
    o.insert("age".into(), json!(age));
    o.insert(
        "stale".into(),
        match (age, refresh) {
            (None, _) => true.into(),
            (Some(a), Some(r)) => (a > 2 * r).into(),
            (Some(_), None) => false.into(),
        },
    );
}

async fn read_file(path: &Path) -> Result<(String, Option<u64>), &'static str> {
    let f = async {
        let text = tokio::fs::read_to_string(path).await?;
        let mtime = tokio::fs::metadata(path)
            .await
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs());
        Ok::<_, std::io::Error>((text, mtime))
    };
    match tokio::time::timeout(Duration::from_secs(2), f).await {
        Ok(Ok(x)) => Ok(x),
        Ok(Err(e)) if e.kind() == std::io::ErrorKind::NotFound => Err("file missing"),
        Ok(Err(_)) => Err("file unreadable"),
        Err(_) => Err("read timed out"),
    }
}

// ---- machines: fleet-disks.json (sizes are 1K blocks, as `df -k` writes them) ----
fn gib(kib: u64) -> f64 {
    ((kib as f64) / 1_048_576.0 * 10.0).round() / 10.0
}

pub fn machines_from(text: &str, now: u64) -> Value {
    const SRC: &str = "~/.local/state/fleet-disks.json";
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return unavailable(SRC, "bad json", now);
    };
    let Some(hosts) = v["hosts"].as_array() else {
        return unavailable(SRC, "no hosts list", now);
    };
    let mut items: Vec<Value> = vec![];
    for name in MACHINES {
        let h = hosts.iter().find(|h| h["host"].as_str() == Some(name));
        let Some(h) = h else {
            items.push(json!({"name": name, "reachable": Value::Null, "checked": Value::Null, "checked_reason": "not in snapshot", "drives": [], "note": "not in snapshot"}));
            continue;
        };
        let ok = h["ok"].as_bool();
        // A raised probe retains its last successful drives and checked time. Keep those readings
        // without changing null reachability; an answered negative still carries no disk data.
        let drives: Vec<Value> = if ok != Some(false) {
            h["drives"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .take(4)
                        .map(|d| {
                            let (total, used, avail) =
                                (d["total"].as_u64(), d["used"].as_u64(), d["avail"].as_u64());
                            json!({
                                "label": clean(d.get("label"), 20),
                                "used_gb": used.map(gib),
                                "free_gb": avail.map(gib),
                                "total_gb": total.map(gib),
                                "pct": d["pct"].as_u64(),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default()
        } else {
            vec![]
        };
        let note = crate::actions::scrub(h["error"].as_str().unwrap_or(""), 120);
        let checked = h["checked"].as_u64().filter(|t| *t > 1_500_000_000 && *t <= now);
        let checked_reason = checked.is_none().then_some("check time not reported or invalid");
        items.push(json!({"name": name, "reachable": ok, "checked": checked, "checked_reason": checked_reason, "drives": drives, "note": note}));
    }
    let t = v["generated_at"].as_u64().filter(|t| *t > 1_500_000_000);
    let mut o = Map::new();
    o.insert("items".into(), items.into());
    o.insert("refresh".into(), DISKS_REFRESH.into());
    stamp(&mut o, SRC, t, now, Some(DISKS_REFRESH));
    Value::Object(o)
}

// ---- cluster bench file ----
/// `cluster-bench-*.json`: plain name only, newest by modified time.
pub fn is_bench_name(n: &str) -> bool {
    n.starts_with("cluster-bench-")
        && n.ends_with(".json")
        && n.len() <= 80
        && n.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
}

/// `YYYYMMDD` or `YYYY-MM-DD` in the file name, as `YYYY-MM-DD`.
pub fn date_in_name(n: &str) -> Option<String> {
    let b = n.as_bytes();
    for i in 0..b.len() {
        if i + 10 <= b.len() && b[i..i + 4].iter().all(u8::is_ascii_digit) && b[i + 4] == b'-'
            && b[i + 5..i + 7].iter().all(u8::is_ascii_digit) && b[i + 7] == b'-'
            && b[i + 8..i + 10].iter().all(u8::is_ascii_digit)
        {
            return Some(n[i..i + 10].to_string());
        }
        if i + 8 <= b.len() && b[i..i + 8].iter().all(u8::is_ascii_digit)
            && (i == 0 || !b[i - 1].is_ascii_digit()) && (i + 8 == b.len() || !b[i + 8].is_ascii_digit())
        {
            let d = &n[i..i + 8];
            let (y, m, dd) = (&d[..4], &d[4..6], &d[6..]);
            if y.starts_with("20") && ("01"..="12").contains(&m) && ("01"..="31").contains(&dd) {
                return Some(format!("{y}-{m}-{dd}"));
            }
        }
    }
    None
}

pub fn bench_from(file: &str, text: &str, mtime: Option<u64>, now: u64) -> Value {
    let src = format!("{SCRATCH_REL_DISPLAY}/{file}");
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return json!({"error": "bench file is not json", "src": src, "file": file, "t": mtime, "stale": true});
    };
    let mut fields: Vec<Value> = vec![];
    // Real bench files keep results under "stats": {name: {median, ...}} and "ttft_s": {median}. Lead with those.
    if let Some(st) = v["stats"].as_object() {
        for (name, row) in st.iter().take(6) {
            let ok_name = name.len() <= 20 && name.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'));
            if let (true, Some(n)) = (ok_name, row["median"].as_f64()) {
                fields.push(json!({"k": format!("{name}_median"), "v": n}));
            }
        }
    }
    if let Some(n) = v["ttft_s"]["median"].as_f64() {
        fields.push(json!({"k": "ttft_s_median", "v": n}));
    }
    let mut take = |m: &Map<String, Value>| {
        for (k, val) in m {
            if fields.len() >= 8 {
                break;
            }
            let ok_key = k.len() <= 32 && k.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b'.'));
            if !ok_key {
                continue;
            }
            match val {
                Value::Number(n) => fields.push(json!({"k": k, "v": n})),
                Value::String(s) if s.len() <= 40 && !s.chars().any(char::is_control) => {
                    fields.push(json!({"k": k, "v": s}))
                }
                _ => {}
            }
        }
    };
    if let Some(m) = v.as_object() {
        take(m);
        if let Some(s) = m.get("summary").and_then(Value::as_object) {
            take(s);
        }
    }
    let date = date_in_name(file)
        .or_else(|| v["date"].as_str().filter(|d| d.len() == 10).map(str::to_string))
        .or_else(|| v["at"].as_str().and_then(iso_to_epoch).map(day));
    let mut o = Map::new();
    o.insert("file".into(), file.into());
    o.insert("date".into(), json!(date));
    o.insert("fields".into(), fields.into());
    stamp(&mut o, &src, mtime, now, None);
    Value::Object(o)
}

const SCRATCH_REL_DISPLAY: &str = "~/.hermes/cache/scratch";

fn day(epoch: u64) -> String {
    // civil date from epoch days (UTC), Howard Hinnant
    let z = (epoch / 86_400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    format!("{:04}-{:02}-{:02}", if m <= 2 { y + 1 } else { y }, m, d)
}

async fn latest_bench(home: &Path, now: u64) -> Value {
    let dir: PathBuf = home.join(SCRATCH_REL);
    let list = async {
        let mut rd = tokio::fs::read_dir(&dir).await.ok()?;
        let mut best: Option<(u64, String)> = None;
        while let Ok(Some(e)) = rd.next_entry().await {
            let name = e.file_name().to_string_lossy().into_owned();
            if !is_bench_name(&name) {
                continue;
            }
            let m = e
                .metadata()
                .await
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            if best.as_ref().map(|b| m > b.0).unwrap_or(true) {
                best = Some((m, name));
            }
        }
        best
    };
    let src = format!("{SCRATCH_REL_DISPLAY}/cluster-bench-*.json");
    match tokio::time::timeout(Duration::from_secs(2), list).await {
        Ok(Some((_, name))) => match read_file(&dir.join(&name)).await {
            Ok((text, mtime)) => bench_from(&name, &text, mtime, now),
            Err(e) => json!({"error": e, "src": src, "file": name, "t": Value::Null, "stale": true}),
        },
        _ => json!({"error": "no bench file", "src": src, "t": Value::Null, "age": Value::Null, "stale": true}),
    }
}

/// Fallback bench card: the deck's own cluster feed keeps the last accepted run from
/// spark ~/ops/state/glm-ratchet/RESULTS.md. Used only when no cluster-bench-*.json exists,
/// and labelled with its own source so it can never pass for a fresh bench.
async fn deck_bench(home: &Path, now: u64) -> Option<Value> {
    const REL: &str = ".meshvault/status/deck/cluster.json";
    let (text, mtime) = read_file(&home.join(REL)).await.ok()?;
    let v: Value = serde_json::from_str(&text).ok()?;
    let b = v.get("bench")?.as_object()?;
    if b.get("stale").and_then(Value::as_bool) == Some(true) {
        // Old numbers from another model never reach the card: name the model that was measured and the date.
        let or = |s: String, d: &str| if s.is_empty() { d.to_string() } else { s };
        let served = or(clean(b.get("served_model"), 60), "the served model");
        let model = or(clean(b.get("model"), 60), "an unknown model");
        let when = or(clean(b.get("measured_at"), 12), "an unknown date");
        return Some(json!({
            "error": format!("No current benchmark for {served}; last bench was {model} on {when}"),
            "src": REL, "file": REL, "t": Value::Null, "age": Value::Null, "stale": true, "checked": now
        }));
    }
    let mut fields: Vec<Value> = vec![];
    for (k, label) in [
        ("prose_tps", "prose_tps"),
        ("code_tps", "code_tps"),
        ("conc6_tps", "conc6_tps"),
        ("prefill_tps", "prefill_tps"),
    ] {
        if let Some(n) = b.get(k).and_then(Value::as_f64) {
            fields.push(json!({"k": label, "v": n}));
        }
    }
    if fields.is_empty() {
        return None;
    }
    let date = b
        .get("at")
        .and_then(Value::as_str)
        .filter(|d| d.len() == 10)
        .map(str::to_string);
    let mut o = Map::new();
    o.insert("file".into(), json!(REL));
    o.insert("date".into(), json!(date));
    o.insert("fields".into(), fields.into());
    stamp(&mut o, REL, mtime, now, None);
    Some(Value::Object(o))
}

// ---- models by device ----
fn model_list(v: &Value) -> Vec<String> {
    let items: Vec<&Value> = match v {
        Value::Array(a) => a.iter().collect(),
        Value::String(_) => vec![v],
        _ => vec![],
    };
    items
        .into_iter()
        .filter_map(|x| match x {
            Value::String(s) => Some(s.as_str()),
            Value::Object(o) => o.get("name").or_else(|| o.get("model")).and_then(Value::as_str),
            _ => None,
        })
        // a model line is kept whole up to MODEL_MAX characters ("..., 1M ctx), engine up"); a longer one ends in an ellipsis,
        // never a silent cut
        .map(|s| {
            let c: Vec<char> = s.chars().filter(|c| !c.is_control()).collect();
            if c.len() > MODEL_MAX {
                c[..MODEL_MAX - 1].iter().collect::<String>() + "\u{2026}"
            } else {
                c.into_iter().collect()
            }
        })
        .filter(|s| !s.trim().is_empty())
        .take(12)
        .collect()
}
const MODEL_MAX: usize = 160;

pub fn models_from(text: &str, mtime: Option<u64>, now: u64) -> Value {
    const SRC: &str = "~/.meshvault/status/deck/device-models.json";
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return unavailable(SRC, "bad json", now);
    };
    // accepted shapes: {"devices":[{"device","models"}]}, {"devices":{name:[..]}}, {name:[..]}
    let body = v.get("devices").unwrap_or(&v);
    let mut devices: Vec<Value> = vec![];
    match body {
        Value::Array(a) => {
            for d in a.iter().take(12) {
                let name = clean(d.get("device").or_else(|| d.get("name")), 24);
                if !name.is_empty() {
                    devices.push(json!({"device": name, "models": model_list(&d["models"])}));
                }
            }
        }
        Value::Object(m) => {
            for (k, val) in m.iter().take(12) {
                if matches!(k.as_str(), "t" | "refresh" | "src" | "errors" | "generated_at") {
                    continue;
                }
                let name = clean_str(k, 24);
                devices.push(json!({"device": name, "models": model_list(val)}));
            }
        }
        _ => {}
    }
    let t = v["t"]
        .as_u64()
        .or_else(|| v["generated_at"].as_u64())
        .filter(|t| *t > 1_500_000_000)
        .or(mtime);
    let mut o = Map::new();
    o.insert("devices".into(), devices.into());
    stamp(&mut o, SRC, t, now, Some(MODELS_REFRESH));
    Value::Object(o)
}

// ---- Git sync: bounded status snapshot, local tracking refs only ----
const GITSYNC_MAX_BYTES: u64 = 1024 * 1024;
const GITSYNC_REFRESH: u64 = 1800;
/// The feed's own refresh claim is bounded: a huge value cannot hide a stale file, a tiny one cannot fake it.
const GITSYNC_REFRESH_MIN: u64 = 60;
const GITSYNC_REFRESH_MAX: u64 = 86_400;

pub fn gitsync_from(text: &str, now: u64) -> Value {
    const SRC: &str = "~/.meshvault/status/deck/gitsync.json";
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return unavailable(SRC, "bad json", now);
    };
    let Some(hosts) = v["hosts"].as_array() else {
        return unavailable(SRC, "no hosts list", now);
    };
    let t = v["t"].as_u64().filter(|t| *t > 1_500_000_000 && *t <= now + 300);
    let refresh = v["refresh"].as_u64().filter(|r| *r > 0).map_or(GITSYNC_REFRESH, |r| r.clamp(GITSYNC_REFRESH_MIN, GITSYNC_REFRESH_MAX));
    let hosts: Vec<Value> = hosts.iter().take(32).filter_map(|h| {
        let host = clean(h.get("host"), 40);
        if host.is_empty() {
            return None;
        }
        let label = clean(h.get("label"), 40);
        let at = h["at"].as_u64().filter(|at| *at > 1_500_000_000 && *at <= now + 300);
        // the age of the data is measured from `at` when the writer gave one; the writer's own stale_s was true only when it wrote
        let stale_s = at.map(|at| now.saturating_sub(at)).or_else(|| h["stale_s"].as_u64());
        let mut row = Map::new();
        row.insert("host".into(), host.into());
        row.insert("label".into(), label.into());
        for key in ["checkouts", "repos", "own_repos", "clean", "unpushed", "no_remote", "dirty", "third_party", "unknown"] {
            row.insert(key.into(), h[key].as_u64().map_or(Value::Null, |n| json!(n)));
        }
        row.insert("at".into(), json!(at));
        row.insert("stale_s".into(), json!(stale_s));
        let error = clean(h.get("error"), 80);
        row.insert("error".into(), if error.is_empty() { Value::Null } else { Value::String(error) });
        Some(Value::Object(row))
    }).collect();
    let unpushed: Vec<Value> = v["unpushed"].as_array().into_iter().flatten().take(200).filter_map(|repo| {
        let host = clean(repo.get("host"), 40);
        let path = clean(repo.get("repo"), 120);
        if host.is_empty() || path.is_empty() {
            return None;
        }
        Some(json!({
            "host": host,
            "repo": path,
            "branch": clean(repo.get("branch"), 60),
            "ahead": repo["ahead"].as_u64(),
        }))
    }).collect();
    let mut o = Map::new();
    o.insert("hosts".into(), hosts.into());
    o.insert("unpushed".into(), unpushed.into());
    o.insert("basis".into(), clean(v.get("basis"), 100).into());
    o.insert("src".into(), SRC.into());
    o.insert("t".into(), json!(t));
    o.insert("age".into(), json!(t.map(|t| now.saturating_sub(t))));
    o.insert("refresh".into(), json!(refresh));
    o.insert("stale".into(), json!(t.is_none_or(|t| now.saturating_sub(t) > refresh.saturating_mul(2))));
    Value::Object(o)
}

async fn gitsync(home: &Path, now: u64) -> Value {
    let path = home.join(GITSYNC_REL);
    let read = async {
        use tokio::io::AsyncReadExt;
        let file = tokio::fs::File::open(&path).await?;
        let mut bytes = Vec::with_capacity(8192);
        file.take(GITSYNC_MAX_BYTES + 1).read_to_end(&mut bytes).await?;
        Ok::<_, std::io::Error>(bytes)
    };
    match tokio::time::timeout(Duration::from_secs(2), read).await {
        Ok(Ok(bytes)) if bytes.len() as u64 <= GITSYNC_MAX_BYTES =>
            gitsync_from(&String::from_utf8_lossy(&bytes), now),
        Ok(Ok(_)) => unavailable("~/.meshvault/status/deck/gitsync.json", "file too large", now),
        Ok(Err(e)) if e.kind() == std::io::ErrorKind::NotFound =>
            unavailable("~/.meshvault/status/deck/gitsync.json", "file missing", now),
        Ok(Err(_)) => unavailable("~/.meshvault/status/deck/gitsync.json", "file unreadable", now),
        Err(_) => unavailable("~/.meshvault/status/deck/gitsync.json", "read timed out", now),
    }
}

// ---- failing units snapshot ----
pub fn unit_name_ok(n: &str) -> bool {
    (1..=80).contains(&n.len())
        && n.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'@' | b'.' | b'_' | b':' | b'-' | b'\\'))
}

pub fn units_from(text: &str, mtime: Option<u64>, now: u64) -> Value {
    const SRC: &str = "~/.meshvault/status/deck/fleet.json";
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return unavailable(SRC, "bad json", now);
    };
    let Some(list) = v["failed_units"].as_array() else {
        return unavailable(SRC, "no failed_units list", now);
    };
    let names: Vec<String> = list
        .iter()
        .filter_map(Value::as_str)
        .filter(|n| unit_name_ok(n))
        .take(30)
        .map(str::to_string)
        .collect();
    let t = v["t"].as_u64().filter(|t| *t > 1_500_000_000 && *t <= now + 300).or(mtime);
    let mut o = Map::new();
    o.insert("failed_units".into(), json!(names));
    o.insert("count".into(), json!(names.len()));
    o.insert("writer_ok".into(), json!(v["ok"].as_bool()));
    stamp(&mut o, SRC, t, now, Some(UNITS_REFRESH));
    Value::Object(o)
}

async fn from_file(home: &Path, rel: &str, now: u64, f: impl Fn(&str, Option<u64>, u64) -> Value) -> Value {
    match read_file(&home.join(rel)).await {
        Ok((text, mtime)) => f(&text, mtime, now),
        Err(e) => unavailable(&format!("~/{rel}"), e, now),
    }
}

pub async fn build(home: &Path, http: &reqwest::Client) -> Value {
    let now = now_epoch();
    let (disks, bench, models, backup_v, units, cluster) = tokio::join!(
        from_file(home, DISKS_REL, now, |t, _, n| machines_from(t, n)),
        latest_bench(home, now),
        from_file(home, MODELS_REL, now, models_from),
        gitsync(home, now),
        from_file(home, UNITS_REL, now, units_from),
        crate::fleet::cluster(http),
    );
    let mut cluster = cluster;
    let bench = if bench.get("error").is_some() {
        match deck_bench(home, now).await {
            Some(b) => b,
            None => bench,
        }
    } else {
        bench
    };
    if let Some(o) = cluster.as_object_mut() {
        o.insert("bench".into(), bench);
    }
    json!({
        "machines": disks, "cluster": cluster, "models": models, "backup": backup_v, "units": units,
        "t": now,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_790_895_800;

    const DISKS: &str = r#"{"generated_at":1790895788,"hosts":[
      {"host":"pc-desktop","ok":true,"checked":1790895788,"drives":[{"mount":"/home/secret","label":"System","total":998088704,"used":656606408,"avail":326049240,"pct":67}]},
      {"host":"Mac Mini","ok":true,"checked":1790895788,"drives":[{"mount":"/Volumes/WD","label":"WD 1TB","total":976524248,"used":423562192,"avail":552759764,"pct":43}]},
      {"host":"Spark","ok":false,"checked":1790895788,"drives":[]},
      {"host":"Dell","ok":true,"checked":1790895788,"drives":[{"label":"System","total":497991680,"used":335784556,"avail":156702452,"pct":68}]}]}"#;

    #[test]
    fn machines_show_reachability_used_and_free_and_hide_mounts() {
        let v = machines_from(DISKS, NOW);
        assert_eq!(v["items"].as_array().map(Vec::len), Some(5));
        assert_eq!(v["items"][0]["name"], "pc-desktop");
        assert_eq!(v["items"][0]["reachable"], true);
        assert_eq!(v["items"][0]["drives"][0]["used_gb"], 626.2);
        assert_eq!(v["items"][0]["drives"][0]["free_gb"], 310.9);
        assert_eq!(v["items"][1]["name"], "Spark");
        assert_eq!(v["items"][1]["reachable"], false);
        assert_eq!(v["items"][1]["drives"].as_array().map(Vec::len), Some(0));
        // Ascent is absent from the file: unknown, not zero and not down
        assert_eq!(v["items"][2]["name"], "Ascent");
        assert!(v["items"][2]["reachable"].is_null());
        assert_eq!(v["stale"], false);
        assert_eq!(v["age"], 12);
        assert!(!v.to_string().contains("/home/secret") && !v.to_string().contains("/Volumes"));
        assert_eq!(machines_from("x", NOW)["error"], "bad json");
        assert_eq!(machines_from("{}", NOW)["error"], "no hosts list");
        assert_eq!(machines_from(DISKS, NOW + 2000)["stale"], true);
    }

    #[test]
    fn machines_checked_is_each_hosts_bounded_epoch_or_null_with_reason() {
        let v = machines_from(DISKS, NOW);
        assert_eq!(v["items"][0]["checked"], 1_790_895_788_u64);
        assert_eq!(v["refresh"], DISKS_REFRESH);
        assert!(v["items"][2]["checked"].is_null());
        assert_eq!(v["items"][2]["checked_reason"], "not in snapshot");
        for checked in [Value::Null, json!("1790895788"), json!(true), json!(-1),
            json!(0), json!(1_500_000_000), json!(NOW + 1), json!(u64::MAX), json!(1790895788.5)] {
            let text = json!({"hosts": [{"host": "Spark", "ok": true, "checked": checked}]}).to_string();
            let v = machines_from(&text, NOW);
            assert!(v["items"][1]["checked"].is_null(), "{checked}");
            assert_eq!(v["items"][1]["checked_reason"], "check time not reported or invalid");
        }
        let missing = machines_from(r#"{"hosts":[{"host":"Spark","ok":true}]}"#, NOW);
        assert!(missing["items"][1]["checked"].is_null());
        assert_eq!(missing["items"][1]["checked_reason"], "check time not reported or invalid");
        let old = machines_from(&json!({"generated_at": NOW, "hosts": [
            {"host": "Spark", "ok": true, "checked": NOW - 77_040}
        ]}).to_string(), NOW);
        assert_eq!(old["items"][1]["checked"], NOW - 77_040);
        assert!(old["items"][1]["checked_reason"].is_null());
        assert_eq!(old["stale"], false, "the host's age is independent of the file's");
    }

    #[test]
    fn machines_raised_probe_keeps_sanitized_last_good_disks_and_success_time() {
        let text = json!({"generated_at": NOW, "hosts": [{
            "host": "Dell", "ok": null, "reachable": null, "error": "TimeoutExpired",
            "checked": NOW - 77_040,
            "drives": [{"label": "System\u{202e}", "mount": "/private/old-mount",
                "total": 524_288_000, "used": 314_572_800, "avail": 209_715_200, "pct": 60}]
        }]}).to_string();
        let v = machines_from(&text, NOW);
        let host = &v["items"][3];
        assert!(host["reachable"].is_null());
        assert_eq!(host["checked"], NOW - 77_040);
        assert_eq!(host["note"], "TimeoutExpired");
        assert_eq!(host["drives"], json!([{
            "label": "System", "total_gb": 500.0, "used_gb": 300.0, "free_gb": 200.0, "pct": 60
        }]));
        assert!(!v.to_string().contains("/private/old-mount"));
        assert_eq!(v["refresh"], 600, "ten-minute cadence documented in launch-names.seed.json");
        assert_eq!(v["stale"], false);
    }

    #[test]
    fn machines_answered_disk_true_is_reachable_with_disks() {
        let text = json!({"hosts": [
            {"host": "pc-desktop", "ok": true, "reachable": true, "drives": [{"label": "System"}]}
        ]}).to_string();
        let v = machines_from(&text, NOW);
        assert_eq!(v["items"][0]["reachable"], true);
        assert_eq!(v["items"][0]["drives"][0]["label"], "System");
    }

    #[test]
    fn machines_answered_disk_false_is_unreachable_without_disks() {
        let text = json!({"hosts": [
            {"host": "Spark", "ok": false, "reachable": false, "drives": [{"label": "Old disk"}]}
        ]}).to_string();
        let v = machines_from(&text, NOW);
        assert_eq!(v["items"][1]["reachable"], false);
        assert_eq!(v["items"][1]["drives"], json!([]));
    }

    #[test]
    fn machines_raised_disk_null_is_unknown_with_error_not_absent() {
        let text = json!({"hosts": [
            {"host": "Ascent", "ok": null, "reachable": null, "error": "TimeoutExpired", "drives": [{"label": "Old disk"}]}
        ]}).to_string();
        let v = machines_from(&text, NOW);
        assert!(v["items"][2]["reachable"].is_null());
        assert_eq!(v["items"][2]["drives"][0]["label"], "Old disk");
        assert_eq!(v["items"][2]["note"], "TimeoutExpired");
        assert_eq!(v["items"][3]["note"], "not in snapshot");
    }

    #[test]
    fn machines_error_note_is_bounded_plain_text_and_scrubbed() {
        let read_note = |error: String| {
            let text = json!({"hosts": [{"host": "Spark", "ok": null, "error": error}]}).to_string();
            let v = machines_from(&text, NOW);
            let Some(note) = v["items"][1]["note"].as_str() else { panic!("no note in {v}") };
            note.to_string()
        };
        assert_eq!(read_note("x".repeat(200)).chars().count(), 120);
        assert_eq!(read_note("Timeout\u{202e}\nExpired".to_string()), "Timeout Expired");
        let credential = ["gh", "p_", &"0123abcd".repeat(5)].concat();
        let note = read_note(format!("probe token=private-example {credential}"));
        assert!(!note.contains("private-example") && !note.contains(&credential));
        assert!(note.contains("[redacted]"));
    }

    #[tokio::test]
    async fn deck_bench_stale_block_names_the_measured_model_and_shows_no_numbers() {
        let home = std::env::temp_dir().join(format!("pdeck-bench-stale-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let dir = home.join(".meshvault/status/deck");
        let Ok(()) = std::fs::create_dir_all(&dir) else { panic!("create deck fixture dir") };
        let fixture = r#"{"t":1790890000,"bench":{"stale":true,"reason":"bench is for glm-5.3-flash, served is DeepSeek-V4.1-Flash-1017-EXL3","measured_at":"2026-10-02","model":"glm-5.3-flash","served_model":"DeepSeek-V4.1-Flash-1017-EXL3","prose_tps":null,"code_tps":null,"conc6_tps":null,"prefill_tps":null,"at":"2026-10-02","source":"spark:~/ops/state/glm-ratchet/RESULTS.md"}}"#;
        let Ok(()) = std::fs::write(dir.join("cluster.json"), fixture) else { panic!("write cluster fixture") };
        let Some(v) = deck_bench(&home, NOW).await else { panic!("stale block is reported, not dropped") };
        assert_eq!(
            v["error"],
            "No current benchmark for DeepSeek-V4.1-Flash-1017-EXL3; last bench was glm-5.3-flash on 2026-10-02"
        );
        assert!(v.get("fields").is_none(), "{v}");
        assert_eq!(v["stale"], true);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn bench_names_dates_and_fields() {
        assert!(is_bench_name("cluster-bench-20261001.json") && is_bench_name("cluster-bench-2026-10-01-a.json"));
        for bad in ["cluster-bench-.sh", "../cluster-bench-1.json", "cluster-bench-a b.json", "x.json", "cluster-bench-1.json.bak"] {
            assert!(!is_bench_name(bad), "{bad}");
        }
        assert_eq!(date_in_name("cluster-bench-20261001.json").as_deref(), Some("2026-10-01"));
        assert_eq!(date_in_name("cluster-bench-2026-10-01-a.json").as_deref(), Some("2026-10-01"));
        assert_eq!(date_in_name("cluster-bench-final.json"), None);
        let v = bench_from(
            "cluster-bench-20261001.json",
            r#"{"prose_tps":42.5,"code_tps":40,"note":"ok","nested":{"x":1},"summary":{"conc6_tps":120}}"#,
            Some(NOW - 90),
            NOW,
        );
        assert_eq!(v["date"], "2026-10-01");
        assert_eq!(v["age"], 90);
        assert_eq!(v["stale"], false);
        let keys: Vec<&str> = v["fields"].as_array().map(|a| a.iter().filter_map(|f| f["k"].as_str()).collect()).unwrap_or_default();
        assert!(keys.contains(&"prose_tps") && keys.contains(&"conc6_tps") && !keys.contains(&"nested"));
        assert_eq!(bench_from("cluster-bench-1.json", "nope", None, NOW)["error"], "bench file is not json");
        let r = bench_from(
            "cluster-bench-20261001.json",
            r#"{"model":"m","stats":{"prose":{"median":21.74,"values":[1]},"conc6":{"median":75.35}},"ttft_s":{"median":0.3}}"#,
            Some(NOW - 90),
            NOW,
        );
        let Some(fields) = r["fields"].as_array() else { panic!("bench has no fields array") };
        let f: Vec<(String, f64)> = fields.iter().filter_map(|x| Some((x["k"].as_str()?.to_string(), x["v"].as_f64()?))).collect();
        assert_eq!(f[0], ("conc6_median".to_string(), 75.35));
        assert!(f.contains(&("prose_median".to_string(), 21.74)) && f.contains(&("ttft_s_median".to_string(), 0.3)));
    }

    #[test]
    fn models_accept_three_shapes_and_clip() {
        let a = models_from(r#"{"devices":[{"device":"Spark","models":["glm-5.3"]},{"device":"Dell","models":[]}]}"#, Some(NOW - 5), NOW);
        assert_eq!(a["devices"][0]["device"], "Spark");
        assert_eq!(a["devices"][0]["models"][0], "glm-5.3");
        assert_eq!(a["devices"][1]["models"].as_array().map(Vec::len), Some(0));
        let b = models_from(r#"{"t":1790895000,"refresh":600,"Ascent":["a",{"name":"b"}]}"#, None, NOW);
        assert_eq!(b["devices"][0]["device"], "Ascent");
        assert_eq!(b["devices"][0]["models"][1], "b");
        assert_eq!(b["devices"].as_array().map(Vec::len), Some(1));
        let long = format!("{{\"X\":[\"{}\"]}}", "m".repeat(200));
        let cut = models_from(&long, None, NOW)["devices"][0]["models"][0]
            .as_str()
            .unwrap_or_default()
            .to_string();
        assert_eq!(cut.chars().count(), MODEL_MAX);
        assert!(cut.ends_with('\u{2026}'), "a cut line says so");
        let spark = "DeepSeek-V4.1-Flash-1017-EXL3 (tensorfold-native, 1M ctx), engine up";
        let whole = models_from(&format!("{{\"X\":[\"{spark}\"]}}"), None, NOW);
        assert_eq!(whole["devices"][0]["models"][0], spark, "kept whole");
        assert_eq!(models_from("x", None, NOW)["error"], "bad json");
    }


    #[test]
    fn gitsync_counts_are_nullable_and_host_failures_keep_their_distinction() {
        let v = gitsync_from(r#"{"t":1790895700,"refresh":1800,"basis":"local tracking refs; no fetch or GitHub verification","hosts":[
          {"host":"mac-mini","label":"Mac mini","checkouts":8,"repos":5,"own_repos":3,"clean":2,"unpushed":1,"no_remote":1,"dirty":1,"third_party":2,"unknown":1,"at":1790895600,"stale_s":100},
          {"host":"dell","repos":null,"own_repos":null,"unpushed":null,"no_remote":null,"unknown":null,"at":null,"stale_s":null,"error":"unreachable"}],
          "unpushed":[{"host":"mac-mini","repo":"projects/app","branch":"main","ahead":2}]}"#, NOW);
        assert_eq!(v["hosts"][0]["repos"], 5);
        assert_eq!(v["hosts"][0]["own_repos"], 3);
        assert_eq!(v["hosts"][0]["no_remote"], 1);
        assert_eq!(v["hosts"][1]["unpushed"], Value::Null);
        assert_eq!(v["hosts"][1]["error"], "unreachable");
        assert_eq!(v["unpushed"][0]["ahead"], 2);
        assert_eq!(v["stale"], false);
        assert_eq!(gitsync_from("not json", NOW)["error"], "bad json");
        assert_eq!(gitsync_from("{}", NOW)["error"], "no hosts list");
    }

    #[tokio::test]
    async fn gitsync_missing_and_stale_file_reads_remain_unknown() {
        let home = std::env::temp_dir().join(format!("pdeck-gitsync-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        assert_eq!(gitsync(&home, NOW).await["error"], "file missing");
        let feed = home.join(GITSYNC_REL);
        let Some(dir) = feed.parent() else { panic!("feed path has no parent") };
        let Ok(()) = std::fs::create_dir_all(dir) else { panic!("create gitsync dir") };
        let Ok(()) = std::fs::write(&feed, r#"{"t":1790890000,"hosts":[{"host":"mac-mini","repos":null,"unpushed":null,"unknown":null,"no_remote":null,"stale_s":7200,"at":1790890000,"error":"timeout"}]}"#) else { panic!("write gitsync fixture") };
        let v = gitsync(&home, NOW).await;
        assert_eq!(v["hosts"][0]["repos"], Value::Null);
        assert_eq!(v["hosts"][0]["error"], "timeout");
        assert_eq!(v["hosts"][0]["stale_s"], 5800, "age is measured from `at`, not the writer's own stale_s");
        assert_eq!(v["stale"], true);
        let Ok(()) = std::fs::write(&feed, vec![b'x'; GITSYNC_MAX_BYTES as usize + 1]) else { panic!("write oversize gitsync fixture") };
        assert_eq!(gitsync(&home, NOW).await["error"], "file too large");
        let _ = std::fs::remove_dir_all(&home);
    }

    fn stale_of(refresh: &str, age: u64) -> Value {
        let t = NOW - age;
        gitsync_from(&format!(r#"{{"t":{t},"refresh":{refresh},"hosts":[{{"host":"a","at":{t},"stale_s":0}}]}}"#), NOW)
    }

    #[test]
    fn gitsync_refresh_is_clamped_so_it_cannot_mask_or_fake_staleness() {
        // u64::MAX hid a 100000 s old file; 2^63 wrapped 2*refresh to 0 in release builds. Now the claim is capped at one day, so two days is the longest it can mask.
        for huge in ["18446744073709551615", "9223372036854775808", "86401", "99999999"] {
            let v = stale_of(huge, 200_000);
            assert_eq!(v["refresh"], 86_400, "refresh {huge}");
            assert_eq!(v["stale"], true, "refresh {huge} must not hide a 200000 s old snapshot");
            assert_eq!(stale_of(huge, 100_000)["stale"], false, "within the two-day cap a claimed refresh is honoured");
        }
        assert_eq!(stale_of("1800", 100_000)["stale"], true);
        // a tiny claim cannot fake staleness on a fresh file either
        let v = stale_of("1", 100);
        assert_eq!(v["refresh"], 60);
        assert_eq!(v["stale"], false);
        assert_eq!(stale_of("0", 100)["refresh"], 1800);
        assert_eq!(stale_of("-5", 100)["refresh"], 1800);
        assert_eq!(stale_of("1800", 3601)["stale"], true);
        assert_eq!(stale_of("1800", 3600)["stale"], false);
    }

    #[test]
    fn gitsync_strips_bidi_and_format_controls_from_every_string() {
        let v = gitsync_from("{\"t\":1790895700,\"hosts\":[{\"host\":\"h\u{202E}ost\u{200B}\",\"label\":\"La\u{2066}b\u{FEFF}\",\"error\":\"er\u{202E}ror\\u0007\u{200F}\"}],\
            \"unpushed\":[{\"host\":\"host\",\"repo\":\"work/\u{202E}gpj.x\u{2069}\",\"branch\":\"fix/\u{E0041}a\u{061C}b\",\"ahead\":1}]}", NOW);
        assert_eq!(v["hosts"][0]["host"], "host");
        assert_eq!(v["hosts"][0]["label"], "Lab");
        assert_eq!(v["hosts"][0]["error"], "error");
        assert_eq!(v["unpushed"][0]["repo"], "work/gpj.x");
        assert_eq!(v["unpushed"][0]["branch"], "fix/ab");
        for c in ['\u{202A}', '\u{202E}', '\u{2066}', '\u{2069}', '\u{200B}', '\u{200D}', '\u{FEFF}', '\u{061C}', '\u{E0041}', '\u{0890}', '\u{0891}', '\u{13430}', '\u{13437}', '\u{1343F}'] {
            assert!(drop_char(c), "U+{:04X}", c as u32);
        }
        for c in ['a', ' ', '\u{00E9}', '\u{4E2D}', '\u{1F600}', '\u{2019}'] {
            assert!(!drop_char(c), "U+{:04X}", c as u32);
        }
    }

    #[test]
    fn gitsync_row_age_comes_from_at_and_falls_back_to_the_writers_stale_s() {
        let v = gitsync_from(r#"{"t":1790895700,"hosts":[{"host":"a","at":1790892200,"stale_s":0},{"host":"b","at":null,"stale_s":44},{"host":"c","at":null,"stale_s":null}]}"#, NOW);
        assert_eq!(v["hosts"][0]["stale_s"], 3600);
        assert_eq!(v["hosts"][1]["stale_s"], 44);
        assert_eq!(v["hosts"][2]["stale_s"], Value::Null);
    }

    #[test]
    fn units_keep_plain_names_only() {
        let v = units_from(r#"{"t":1790895700,"ok":true,"failed_units":["a.service","bad name","x;id","b@1.service"]}"#, None, NOW);
        assert_eq!(v["failed_units"], json!(["a.service", "b@1.service"]));
        assert_eq!(v["count"], 2);
        assert_eq!(v["age"], 100);
        assert_eq!(units_from(r#"{"t":1790895700,"failed_units":[]}"#, None, NOW)["count"], 0);
        assert_eq!(units_from("{}", None, NOW)["error"], "no failed_units list");
    }

    #[tokio::test]
    async fn build_reports_missing_sources_as_unavailable_not_zero() {
        let home = std::env::temp_dir().join(format!("pdeck-board-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&home);
        let http = reqwest::Client::new();
        let v = build(&home, &http).await;
        assert_eq!(v["machines"]["error"], "file missing");
        assert_eq!(v["models"]["error"], "file missing");
        assert_eq!(v["units"]["error"], "file missing");
        assert_eq!(v["cluster"]["bench"]["error"], "no bench file");
        assert_eq!(v["backup"]["error"], "file missing");
        // with files present: counts and newest bench by mtime
        let s = home.join(SCRATCH_REL);
        let _ = std::fs::create_dir_all(&s);
        let feed = home.join(GITSYNC_REL);
        let Some(dir) = feed.parent() else { panic!("feed path has no parent") };
        let Ok(()) = std::fs::create_dir_all(dir) else { panic!("create gitsync dir") };
        let Ok(()) = std::fs::write(&feed, format!(r#"{{"t":{},"refresh":1800,"hosts":[{{"host":"pc-desktop","repos":3,"own_repos":2,"unpushed":0,"unknown":0,"no_remote":0,"at":{}}}],"unpushed":[]}}"#, now_epoch(), now_epoch())) else { panic!("write gitsync fixture with files") };
        let _ = std::fs::write(s.join("cluster-bench-20260930.json"), r#"{"prose_tps":1}"#);
        let v = build(&home, &http).await;
        assert_eq!(v["backup"]["hosts"][0]["repos"], 3);
        assert_eq!(v["backup"]["hosts"][0]["unpushed"], 0);
        assert_eq!(v["cluster"]["bench"]["file"], "cluster-bench-20260930.json");
        assert_eq!(v["cluster"]["bench"]["date"], "2026-09-30");
        let _ = std::fs::remove_dir_all(&home);
    }
}
