//! Crons tab: GET /api/crons. Read-only view of the Hermes default-profile cron list.
//! Reads `~/.hermes/cron/jobs.json` at request time (cached 5 s) and keeps ONLY: name, id (first 8
//! chars), schedule_display, state, enabled, provider, model, last_run_at, last_status, next_run_at,
//! plus a derived lane label. Prompts, scripts, skills, paths, delivery targets and errors never leave
//! this module. The separate guarded /api/cron-act route handles actions without exposing full ids.
//! GET /api/crons/<id8>: one job by its first 8 hex chars, its safe fields and the first 3 non-blank lines of its newest saved output.
use crate::util::{iso_to_epoch, now_epoch};
use serde_json::{json, Value};
use std::path::Path;
use std::time::{Duration, UNIX_EPOCH};
use tokio::io::AsyncReadExt;

pub const REL: &str = ".hermes/cron/jobs.json";
const MAX_JOBS: usize = 300;

/// CLAUDE, CODEX, NO MODEL (no provider and no model pinned) or OTHER. Derived at request time from
/// the job's own provider and model, never from a fixed list of ids.
pub fn lane(provider: Option<&str>, model: Option<&str>) -> &'static str {
    let p = provider.unwrap_or("").trim().to_ascii_lowercase();
    let m = model.unwrap_or("").trim().to_ascii_lowercase();
    if p.is_empty() && m.is_empty() {
        return "NO MODEL";
    }
    if p.contains("anthropic") || p.contains("claude") || m.contains("claude") {
        return "CLAUDE";
    }
    if p.contains("codex")
        || p.contains("openai")
        || m.contains("codex")
        || m.starts_with("gpt-")
        || m.starts_with("o1")
        || m.starts_with("o3")
        || m.starts_with("o4")
    {
        return "CODEX";
    }
    "OTHER"
}

fn text(v: Option<&Value>, n: usize) -> Option<String> {
    let s: String = v?
        .as_str()?
        .chars()
        .filter(|c| !c.is_control())
        .take(n)
        .collect();
    let s = s.trim().to_string();
    (!s.is_empty()).then_some(s)
}

/// ISO time without the fraction (`.798331`), so every browser parses it. Not a time: unchanged.
fn iso_short(v: Option<&Value>) -> Option<String> {
    let s = text(v, 40)?;
    let Some(dot) = s.find('.') else { return Some(s) };
    let rest = &s[dot + 1..];
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    Some(format!("{}{}", &s[..dot], &rest[digits..]))
}

/// Active = enabled and not paused. Everything else is Paused.
fn is_active(j: &Value) -> bool {
    j.get("enabled").and_then(Value::as_bool) == Some(true)
        && j.get("state").and_then(Value::as_str) != Some("paused")
}

/// Why a paused job was parked, in four words. The owner's own note stays in `~/.hermes/cron/jobs.json`:
/// it can quote a prompt, so only the category ever leaves this module.
fn pause_kind(reason: Option<&str>) -> &'static str {
    let r = reason.unwrap_or("").to_ascii_lowercase();
    if r.contains("removed") || r.contains("no value") {
        "removed"
    } else if r.contains("merged") || r.contains("consolidat") {
        "merged"
    } else if r.contains("stop all") || r.contains("paused all") || r.contains("turn off") {
        "stopped"
    } else if r.is_empty() {
        "unknown"
    } else {
        "other"
    }
}

/// Every job parked by the owner is not a fault: when nothing is active, say who stopped it and when,
/// so the Active column reads "you stopped these" instead of "nothing is running".
fn halt(list: &[&Value], active: usize, now: u64) -> Option<Value> {
    if active > 0 || list.is_empty() {
        return None;
    }
    let mut kinds = serde_json::Map::new();
    let mut newest: Option<String> = None;
    for j in list {
        let kind = pause_kind(j.get("paused_reason").and_then(Value::as_str));
        let n = kinds.get(kind).and_then(Value::as_u64).unwrap_or(0) + 1;
        kinds.insert(kind.to_string(), json!(n));
        if let Some(at) = j.get("paused_at").and_then(Value::as_str) {
            if newest.as_deref().is_none_or(|n| at > n) {
                newest = Some(at.to_string());
            }
        }
    }
    let since = newest.and_then(|s| iso_short(Some(&json!(s))));
    Some(json!({"all_paused": true, "counts": kinds, "since": since.unwrap_or_default(), "t": now}))
}

/// The models Hermes falls back to when a job pins none. The scheduler (`cron/scheduler.py`, `_load_cron_job_config`) reads the
/// run model as: the job's own pin, then `cron.model` in `~/.hermes/config.yaml` (the fleet cron default), then the main
/// agent model (`model.default`). The provider is the job's pin, then `cron.model_provider`, then `model.provider`.
#[derive(Default, Clone, Debug, PartialEq)]
pub struct Defaults {
    pub cron_model: Option<String>,
    pub cron_provider: Option<String>,
    pub main_model: Option<String>,
    pub main_provider: Option<String>,
}

fn unquote(v: &str) -> Option<String> {
    let v = v.trim();
    let out = match v.chars().next() {
        Some(q @ ('"' | '\'')) => v[1..].split(q).next().unwrap_or("").to_string(),
        _ => v.split(" #").next().unwrap_or("").trim().to_string(),
    };
    let out: String = out.chars().filter(|c| !c.is_control()).take(80).collect();
    (!out.is_empty()).then_some(out)
}

/// Reads only the four values above from the top-level `cron:` and `model:` blocks (two-space keys). No YAML library:
/// nothing else in the file is parsed, kept or sent.
pub fn defaults_from(yaml: &str) -> Defaults {
    let mut d = Defaults::default();
    let mut top = "";
    for raw in yaml.lines() {
        let l = raw.trim();
        if l.is_empty() || l.starts_with('#') {
            continue;
        }
        let indent = raw.len() - raw.trim_start().len();
        let Some((k, v)) = l.split_once(':') else { continue };
        if indent == 0 {
            top = match k {
                "model" => "model",
                "cron" => "cron",
                _ => "",
            };
            if top == "model" {
                d.main_model = unquote(v); // `model: name` shorthand
            }
        } else if indent == 2 {
            match (top, k) {
                ("cron", "model") => d.cron_model = unquote(v),
                ("cron", "model_provider") => d.cron_provider = unquote(v),
                ("model", "default") => d.main_model = unquote(v).or(d.main_model.take()),
                ("model", "model" | "name") => d.main_model = d.main_model.take().or_else(|| unquote(v)),
                ("model", "provider") => d.main_provider = unquote(v),
                _ => {}
            }
        }
    }
    d
}

/// (model, provider, where the model came from) the scheduler will really use for one job.
fn effective(pm: Option<&str>, pp: Option<&str>, d: &Defaults) -> (Option<String>, Option<String>, &'static str) {
    let (model, src) = match (pm, d.cron_model.as_deref(), d.main_model.as_deref()) {
        (Some(m), _, _) => (Some(m.to_string()), "pinned"),
        (None, Some(m), _) => (Some(m.to_string()), "fleet default"),
        (None, None, Some(m)) => (Some(m.to_string()), "main default"),
        _ => (None, "none"),
    };
    let provider = pp
        .map(str::to_string)
        .or_else(|| d.cron_provider.clone())
        .or_else(|| d.main_provider.clone());
    (model, provider, src)
}

/// One job in the shape the list and the detail view share: the safe fields and the derived lane, nothing else.
/// `provider` and `model` are what the job itself pins; `effective_*` are what it will run on. The lane follows the
/// effective pair, so a job with no pin reads as the fleet default's lane, never "NO MODEL" while a default exists.
fn view_row(j: &Value, d: &Defaults) -> Value {
    let provider = text(j.get("provider"), 40);
    let model = text(j.get("model"), 60);
    let (em, ep, src) = effective(model.as_deref(), provider.as_deref(), d);
    let lane_v = lane(ep.as_deref(), em.as_deref());
    json!({
        "name": text(j.get("name"), 80).unwrap_or_else(|| "unnamed".into()),
        "id": text(j.get("id"), 8),
        "schedule_display": text(j.get("schedule_display"), 48),
        "state": text(j.get("state"), 16),
        "enabled": j.get("enabled").and_then(Value::as_bool),
        "provider": provider,
        "model": model,
        "model_source": src,
        "effective_model": em,
        "effective_provider": ep,
        "lane": lane_v,
        "last_run_at": iso_short(j.get("last_run_at")),
        "last_status": text(j.get("last_status"), 24),
        "next_run_at": iso_short(j.get("next_run_at")),
    })
}

#[cfg(test)]
pub fn from_text(src: &str, file_t: Option<u64>, now: u64) -> Value {
    from_text_with(src, file_t, now, &Defaults::default())
}

pub fn from_text_with(src: &str, file_t: Option<u64>, now: u64, d: &Defaults) -> Value {
    let fail = |why: &str| json!({"error": why, "src": format!("~/{REL}"), "t": now, "file_t": file_t});
    let Ok(v) = serde_json::from_str::<Value>(src) else {
        return fail("bad json");
    };
    let Some(list) = v.get("jobs").and_then(Value::as_array) else {
        return fail("no jobs list");
    };
    let kept: Vec<&Value> = list.iter().take(MAX_JOBS).filter(|j| j.is_object()).collect();
    let mut rows: Vec<(bool, u64, String, Value)> = vec![];
    for j in &kept {
        let row = view_row(j, d);
        let name = row["name"].as_str().unwrap_or("unnamed").to_string();
        let active = is_active(j);
        let key = row["next_run_at"]
            .as_str()
            .and_then(iso_to_epoch)
            .unwrap_or(u64::MAX);
        rows.push((active, key, name.to_lowercase(), row));
    }
    // Active: soonest next run first. Paused: by name.
    rows.sort_by(|a, b| {
        b.0.cmp(&a.0).then_with(|| {
            if a.0 {
                a.1.cmp(&b.1).then_with(|| a.2.cmp(&b.2))
            } else {
                a.2.cmp(&b.2)
            }
        })
    });
    let active: Vec<Value> = rows.iter().filter(|r| r.0).map(|r| r.3.clone()).collect();
    let paused: Vec<Value> = rows.iter().filter(|r| !r.0).map(|r| r.3.clone()).collect();
    let last_failed = active
        .iter()
        .filter(|j| matches!(j["last_status"].as_str(), Some(s) if s != "ok"))
        .count();
    json!({
        "active": active,
        "paused": paused,
        "counts": {"active": active.len(), "paused": paused.len(), "total": active.len() + paused.len(), "last_failed": last_failed},
        "halt": halt(&kept, active.len(), now),
        "src": format!("~/{REL}"),
        "t": now,
        "file_t": file_t,
    })
}

/// The fleet cron default and the main model, read from `~/.hermes/config.yaml`. A missing or unreadable file means no
/// defaults: an unpinned job then reads "NO MODEL", which is what the scheduler would hit.
async fn defaults(home: &Path) -> Defaults {
    let read = tokio::fs::read_to_string(home.join(".hermes/config.yaml"));
    match tokio::time::timeout(Duration::from_secs(2), read).await {
        Ok(Ok(t)) => defaults_from(&t),
        _ => Defaults::default(),
    }
}

pub async fn build(home: &Path) -> Value {
    let path = home.join(REL);
    let now = now_epoch();
    let d = defaults(home).await;
    let read = async {
        let text = tokio::fs::read_to_string(&path).await?;
        let mtime = tokio::fs::metadata(&path)
            .await
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs());
        Ok::<_, std::io::Error>((text, mtime))
    };
    match tokio::time::timeout(Duration::from_secs(2), read).await {
        Ok(Ok((t, m))) => from_text_with(&t, m, now, &d),
        Ok(Err(e)) if e.kind() == std::io::ErrorKind::NotFound => {
            json!({"error": "file missing", "src": format!("~/{REL}"), "t": now})
        }
        Ok(Err(_)) => json!({"error": "file unreadable", "src": format!("~/{REL}"), "t": now}),
        Err(_) => json!({"error": "read timed out", "src": format!("~/{REL}"), "t": now}),
    }
}

/// Hermes writes one markdown file per run into a folder named by the job's full id.
const OUT_REL: &str = ".hermes/cron/output";
/// Only the start of the newest run file is read; the summary needs three lines.
const OUT_MAX_BYTES: u64 = 8192;

/// Lower-case hex only, so a job id can name a folder without any path escape.
fn hex_id(s: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Control characters removed, credentials and URL queries redacted the way `/api/unit` does, at most 200 characters.
fn clean_line(s: &str) -> String {
    crate::actions::scrub(&s.chars().filter(|c| !c.is_control()).collect::<String>(), 200).trim().to_string()
}

/// The first 3 non-blank lines of the newest run file for this job, or null when it has never written one.
async fn last_output(home: &Path, full_id: &str) -> Value {
    let dir = home.join(OUT_REL).join(full_id);
    let Ok(mut entries) = tokio::fs::read_dir(&dir).await else {
        return Value::Null;
    };
    // file names start with the run time (YYYY-MM-DD_HH-MM-SS.md), so the greatest name is the newest run
    let mut newest: Option<String> = None;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".md") && newest.as_deref().is_none_or(|n| name.as_str() > n) {
            newest = Some(name);
        }
    }
    let Some(name) = newest else {
        return Value::Null;
    };
    let path = dir.join(&name);
    let Ok(file) = tokio::fs::File::open(&path).await else {
        return Value::Null;
    };
    let mut head = Vec::new();
    let mut limited = file.take(OUT_MAX_BYTES);
    if limited.read_to_end(&mut head).await.is_err() {
        return Value::Null;
    }
    let t = tokio::fs::metadata(&path)
        .await
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    let lines: Vec<String> = String::from_utf8_lossy(&head)
        .lines()
        .map(clean_line)
        .filter(|l| !l.is_empty())
        .take(3)
        .collect();
    json!({"lines": lines, "t": t})
}

/// GET /api/crons/<id8>: one Hermes job by its first 8 hex chars, its safe fields and its last output. Read only.
/// Status: 200 found, 400 bad id, 404 no such job, 409 two jobs share the prefix, 503 jobs file unusable.
pub async fn detail(home: &Path, id8: &str) -> (u16, Value) {
    let now = now_epoch();
    let src = format!("~/{REL}");
    if !hex_id(id8, 8, 8) {
        return (400, json!({"error": "bad id", "t": now}));
    }
    let Ok(text_src) = tokio::fs::read_to_string(home.join(REL)).await else {
        return (503, json!({"error": "jobs file not readable", "src": src, "t": now}));
    };
    let Ok(v) = serde_json::from_str::<Value>(&text_src) else {
        return (503, json!({"error": "bad json", "src": src, "t": now}));
    };
    let Some(list) = v.get("jobs").and_then(Value::as_array) else {
        return (503, json!({"error": "no jobs list", "src": src, "t": now}));
    };
    let hits: Vec<(&str, &Value)> = list
        .iter()
        .filter_map(|j| {
            let id = j.get("id")?.as_str()?;
            (id.starts_with(id8) && hex_id(id, 8, 64)).then_some((id, j))
        })
        .collect();
    match hits.as_slice() {
        [] => (404, json!({"error": "no such job", "t": now})),
        [(full, j)] => {
            let mut out = view_row(j, &defaults(home).await);
            out["last_output"] = last_output(home, full).await;
            out["src"] = json!(src);
            out["t"] = json!(now);
            (200, out)
        }
        _ => (409, json!({"error": "more than one job has this id", "t": now})),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_790_900_000;

    const JOBS: &str = r#"{"updated_at":"x","jobs":[
      {"id":"e795b7823241abcd","name":"Digest","prompt":"SECRET PROMPT","script":"/home/x/secret.py","skills":["s1"],
       "skill":"s1","workdir":"/home/x","deliver":"telegram:123","origin":{"chat":"1"},"last_error":"boom /home/x",
       "model":"gpt-6-luna-900k","provider":"openai-codex","schedule_display":"0 7 * * *","enabled":false,"state":"paused",
       "last_run_at":"2026-09-23T07:01:26.798331-07:00","last_status":"ok","next_run_at":"2026-09-24T07:00:00-07:00"},
      {"id":"aaaa1111bbbb","name":"Later","model":"claude-opus-5-5","provider":"anthropic","schedule_display":"every 2h","enabled":true,"state":"scheduled",
       "last_run_at":null,"last_status":null,"next_run_at":"2026-10-01T20:00:00-07:00"},
      {"id":"cccc2222dddd","name":"Soon","model":null,"provider":null,"schedule_display":"every 5m","enabled":true,"state":"scheduled",
       "last_run_at":"2026-10-01T15:55:00-07:00","last_status":"error","next_run_at":"2026-10-01T16:00:00-07:00"},
      {"id":"eeee3333ffff","name":"Alpha paused","provider":"nous","model":"hermes-5","enabled":false,"state":"paused"}
    ]}"#;

    #[test]
    fn lane_comes_from_provider_and_model() {
        assert_eq!(lane(Some("anthropic"), Some("claude-opus-5-5")), "CLAUDE");
        assert_eq!(lane(None, Some("claude-sonnet-5-5")), "CLAUDE");
        assert_eq!(lane(Some("openai-codex"), Some("gpt-6-luna-900k")), "CODEX");
        assert_eq!(lane(Some("openai-codex"), None), "CODEX");
        assert_eq!(lane(None, None), "NO MODEL");
        assert_eq!(lane(Some(" "), Some("")), "NO MODEL");
        assert_eq!(lane(Some("nous"), Some("hermes-5")), "OTHER");
    }

    #[test]
    fn splits_active_and_paused_with_counts_and_order() {
        let v = from_text(JOBS, Some(NOW - 60), NOW);
        assert_eq!(v["counts"]["active"], 2);
        assert_eq!(v["counts"]["paused"], 2);
        assert_eq!(v["counts"]["total"], 4);
        assert_eq!(v["counts"]["last_failed"], 1);
        // active: soonest next run first
        assert_eq!(v["active"][0]["name"], "Soon");
        assert_eq!(v["active"][1]["name"], "Later");
        // paused: by name
        assert_eq!(v["paused"][0]["name"], "Alpha paused");
        assert_eq!(v["paused"][1]["name"], "Digest");
        assert_eq!(v["active"][0]["lane"], "NO MODEL");
        assert_eq!(v["active"][1]["lane"], "CLAUDE");
        assert_eq!(v["paused"][1]["lane"], "CODEX");
        assert_eq!(v["file_t"], NOW - 60);
        assert_eq!(v["src"], "~/.hermes/cron/jobs.json");
    }

    #[test]
    fn id_is_short_and_fraction_is_dropped() {
        let v = from_text(JOBS, None, NOW);
        assert_eq!(v["paused"][1]["id"], "e795b782");
        assert_eq!(v["paused"][1]["last_run_at"], "2026-09-23T07:01:26-07:00");
        assert_eq!(v["paused"][1]["schedule_display"], "0 7 * * *");
        assert!(v["active"][1]["last_run_at"].is_null());
    }

    #[test]
    fn only_the_listed_fields_leave() {
        let v = from_text(JOBS, None, NOW);
        let allowed = [
            "name", "id", "schedule_display", "state", "enabled", "provider", "model", "lane",
            "last_run_at", "last_status", "next_run_at", "model_source", "effective_model", "effective_provider",
        ];
        for j in v["active"].as_array().into_iter().chain(v["paused"].as_array()).flatten() {
            for k in j.as_object().map(|m| m.keys().collect::<Vec<_>>()).unwrap_or_default() {
                assert!(allowed.contains(&k.as_str()), "leaked key {k}");
            }
        }
        let all = v.to_string();
        for secret in ["SECRET PROMPT", "secret.py", "/home/x", "telegram", "boom", "s1", "workdir", "deliver", "script"] {
            assert!(!all.contains(secret), "leaked {secret}");
        }
    }

    #[test]
    fn bad_input_is_an_error_object_never_zero_jobs() {
        assert_eq!(from_text("nope", None, NOW)["error"], "bad json");
        assert_eq!(from_text("{}", None, NOW)["error"], "no jobs list");
        assert!(from_text("{}", None, NOW).get("counts").is_none());
    }

    #[test]
    fn all_paused_jobs_report_reason_counts_and_latest_pause_time() {
        let jobs = r#"{"jobs":[
            {"name":"Removed","enabled":false,"state":"paused","paused_reason":"removed because it had no value","paused_at":"2026-10-01T09:00:00Z"},
            {"name":"Merged","enabled":false,"state":"paused","paused_reason":"merged into the daily run","paused_at":"2026-10-02T09:00:00Z"},
            {"name":"Stopped","enabled":false,"state":"paused","paused_reason":"stop all cron jobs","paused_at":"2026-10-03T09:00:00.123Z"},
            {"name":"Other","enabled":false,"state":"paused","paused_reason":"owner choice"},
            {"name":"Unknown","enabled":false,"state":"paused"}
        ]}"#;

        let result = from_text(jobs, None, NOW);

        assert_eq!(result["counts"]["active"], 0);
        assert_eq!(result["halt"]["all_paused"], true);
        assert_eq!(result["halt"]["counts"]["removed"], 1);
        assert_eq!(result["halt"]["counts"]["merged"], 1);
        assert_eq!(result["halt"]["counts"]["stopped"], 1);
        assert_eq!(result["halt"]["counts"]["other"], 1);
        assert_eq!(result["halt"]["counts"]["unknown"], 1);
        assert_eq!(result["halt"]["since"], "2026-10-03T09:00:00Z");
    }

    const CONFIG: &str = "model:\n  aliases:\n    cluster:\n      model: cluster-current\n      provider: custom:cluster\n  default: deepseek/deepseek-v4.1-flash-ultrafast\n  provider: custom:opengateway # main\n  timeout: 120\ncron:\n  model: gpt-6.1-sol\n  model_provider: \"openai-codex\"\n  max_parallel_jobs: 2\nkanban:\n  model: not-this-one\n";

    #[test]
    fn defaults_read_only_the_cron_and_main_model_blocks() {
        let d = defaults_from(CONFIG);
        assert_eq!(d.cron_model.as_deref(), Some("gpt-6.1-sol"));
        assert_eq!(d.cron_provider.as_deref(), Some("openai-codex"));
        assert_eq!(d.main_model.as_deref(), Some("deepseek/deepseek-v4.1-flash-ultrafast"));
        assert_eq!(d.main_provider.as_deref(), Some("custom:opengateway"));
        assert_eq!(defaults_from("model: solo-model\n").main_model.as_deref(), Some("solo-model"));
        assert_eq!(defaults_from(""), Defaults::default());
    }

    #[test]
    fn an_unpinned_job_reads_as_the_fleet_default_not_no_model() {
        // the three Mesh jobs pin nothing; the scheduler runs them on cron.model
        let d = defaults_from(CONFIG);
        let v = from_text_with(JOBS, None, NOW, &d);
        let soon = &v["active"][0];
        assert_eq!(soon["name"], "Soon");
        assert_eq!((soon["model"].is_null(), soon["provider"].is_null()), (true, true), "the pin stays empty");
        assert_eq!(soon["model_source"], "fleet default");
        assert_eq!((soon["effective_model"].as_str(), soon["effective_provider"].as_str()), (Some("gpt-6.1-sol"), Some("openai-codex")));
        assert_eq!(soon["lane"], "CODEX");
        // a pinned job keeps its own model and says so
        assert_eq!(v["active"][1]["model_source"], "pinned");
        assert_eq!(v["active"][1]["effective_model"], "claude-opus-5-5");
        assert_eq!(v["active"][1]["lane"], "CLAUDE");
        // no cron default: the main model is next, then nothing
        let main_only = Defaults { cron_model: None, cron_provider: None, ..d.clone() };
        let w = from_text_with(JOBS, None, NOW, &main_only);
        assert_eq!((w["active"][0]["model_source"].as_str(), w["active"][0]["lane"].as_str()), (Some("main default"), Some("OTHER")));
        assert_eq!(from_text(JOBS, None, NOW)["active"][0]["model_source"], "none");
        assert_eq!(from_text(JOBS, None, NOW)["active"][0]["lane"], "NO MODEL");
    }

    #[tokio::test]
    async fn build_reads_the_file_at_call_time() {
        let home = std::env::temp_dir().join(format!("pdeck-crons-{}", std::process::id()));
        let _ = std::fs::create_dir_all(home.join(".hermes/cron"));
        assert_eq!(build(&home).await["error"], "file missing");
        let _ = std::fs::write(home.join(REL), JOBS);
        assert_eq!(build(&home).await["counts"]["total"], 4);
        let two = JOBS.replace(
            "\"name\":\"Soon\",\"model\":null,\"provider\":null",
            "\"name\":\"Soon\",\"model\":\"claude-x\",\"provider\":\"anthropic\"",
        );
        let _ = std::fs::write(home.join(REL), two);
        // a re-pin written between two requests shows up on the next read
        assert_eq!(build(&home).await["active"][0]["lane"], "CLAUDE");
        let _ = std::fs::remove_dir_all(&home);
    }

    fn home_with(tag: &str, jobs: &str) -> std::path::PathBuf {
        let home = std::env::temp_dir().join(format!("pdeck-crons-detail-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::create_dir_all(home.join(".hermes/cron"));
        let _ = std::fs::write(home.join(REL), jobs);
        home
    }

    #[tokio::test]
    async fn detail_is_one_job_with_its_newest_output_head_and_nothing_private() {
        let jobs = r#"{"jobs":[{"id":"e795b7823241","name":"Digest","prompt":"SECRET PROMPT","script":"/home/x/secret.py",
          "workdir":"/home/x","deliver":"telegram:123","model":"claude-opus-5-5","provider":"anthropic",
          "schedule_display":"0 7 * * *","enabled":true,"state":"scheduled","last_run_at":"2026-10-09T07:02:22.725421-07:00",
          "last_status":"ok","next_run_at":"2026-10-10T07:00:00-07:00"}]}"#;
        let home = home_with("one", jobs);
        let dir = home.join(OUT_REL).join("e795b7823241");
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(dir.join("2026-10-08_07-00-00.md"), "# old run\nold line\n");
        let _ = std::fs::write(dir.join("2026-10-09_07-00-00.md"), "# Cron Job: Digest\n\n**Status:** ok\n\nall good\nfourth\n");
        let (code, v) = detail(&home, "e795b782").await;
        assert_eq!(code, 200);
        assert_eq!((v["name"].as_str(), v["id"].as_str(), v["lane"].as_str()), (Some("Digest"), Some("e795b782"), Some("CLAUDE")));
        assert_eq!(v["last_output"]["lines"], serde_json::json!(["# Cron Job: Digest", "**Status:** ok", "all good"]));
        let s = v.to_string();
        for leak in ["SECRET PROMPT", "/home/x", "telegram", "e795b7823241"] {
            assert!(!s.contains(leak), "{leak}");
        }
        let allowed = ["name", "id", "schedule_display", "state", "enabled", "provider", "model", "lane", "last_run_at", "last_status", "next_run_at", "model_source", "effective_model", "effective_provider", "last_output", "src", "t"];
        for k in v.as_object().into_iter().flat_map(|o| o.keys()) {
            assert!(allowed.contains(&k.as_str()), "{k}");
        }
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn detail_refuses_bad_unknown_and_ambiguous_ids() {
        let home = home_with("refuse", r#"{"jobs":[{"id":"aaaa1111bbbb","name":"A"},{"id":"aaaa1111cccc","name":"B"}]}"#);
        for bad in ["AAAA1111", "aaaa11", "../../etc", "zzzz1111"] {
            assert_eq!(detail(&home, bad).await.0, 400, "{bad}");
        }
        assert_eq!(detail(&home, "deadbeef").await.0, 404);
        assert_eq!(detail(&home, "aaaa1111").await.0, 409);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn detail_without_output_is_null_and_an_unreadable_file_is_503() {
        let home = home_with("noout", r#"{"jobs":[{"id":"cccc2222dddd","name":"Soon","enabled":true,"state":"scheduled"}]}"#);
        let (code, v) = detail(&home, "cccc2222").await;
        assert_eq!(code, 200);
        assert!(v["last_output"].is_null());
        let _ = std::fs::remove_dir_all(&home);
        let missing = std::env::temp_dir().join(format!("pdeck-crons-detail-{}-missing", std::process::id()));
        let _ = std::fs::remove_dir_all(&missing);
        assert_eq!(detail(&missing, "cccc2222").await.0, 503);
    }

    #[tokio::test]
    async fn detail_output_lines_leave_the_server_redacted() {
        let home = home_with("redact", r#"{"jobs":[{"id":"eeee3333ffff","name":"Leaky","enabled":true,"state":"scheduled"}]}"#);
        let dir = home.join(OUT_REL).join("eeee3333ffff");
        let _ = std::fs::create_dir_all(&dir);
        // assembled at run time: a key-shaped literal in source would trip gitleaks
        let secret = "0123abcd".repeat(3);
        let body = format!("token={secret} next\nsee https://host/path?auth={secret}\nplain line\n");
        let _ = std::fs::write(dir.join("2026-10-09_07-00-00.md"), body);
        let (code, v) = detail(&home, "eeee3333").await;
        assert_eq!(code, 200);
        assert!(!v.to_string().contains(&secret), "{v}");
        assert_eq!(v["last_output"]["lines"][2], "plain line");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn active_jobs_suppress_the_halt_summary() {
        assert!(from_text(JOBS, None, NOW)["halt"].is_null());
    }

    #[test]
    fn halt_reasons_match_their_words_without_regard_to_case() {
        let jobs = r#"{"jobs":[
            {"name":"A","enabled":false,"state":"paused","paused_reason":"REMOVED by owner"},
            {"name":"B","enabled":false,"state":"paused","paused_reason":"Consolidated into digest"},
            {"name":"C","enabled":false,"state":"paused","paused_reason":"PAUSED ALL for travel"},
            {"name":"D","enabled":false,"state":"paused","paused_reason":""}
        ]}"#;
        let v = from_text(jobs, None, NOW);
        assert_eq!(v["halt"]["counts"], json!({"removed": 1, "merged": 1, "stopped": 1, "unknown": 1}));
    }

    #[test]
    fn halt_without_any_pause_time_has_an_empty_since() {
        let v = from_text(r#"{"jobs":[{"name":"A","enabled":false,"state":"paused"}]}"#, None, NOW);
        assert_eq!(v["halt"]["since"], "");
        assert_eq!(v["halt"]["all_paused"], true);
    }

    #[test]
    fn lane_reads_vendor_words_in_either_field_and_ignores_case() {
        assert_eq!(lane(Some("ANTHROPIC"), None), "CLAUDE");
        assert_eq!(lane(Some("nous"), Some("Claude-Haiku-5-5")), "CLAUDE");
        assert_eq!(lane(Some("openai"), Some("qwen-9")), "CODEX");
        assert_eq!(lane(None, Some("gpt-6-sol")), "CODEX");
        assert_eq!(lane(None, Some("o4-mini")), "CODEX");
        assert_eq!(lane(None, Some("ollama-llama")), "OTHER");
        assert_eq!(lane(None, Some("my-gpt-5")), "OTHER");
    }

    #[test]
    fn names_lose_control_characters_cap_at_80_and_blank_names_say_unnamed() {
        let v = from_text(
            &json!({"jobs": [
                {"id": "aaaa0001", "name": "\u{7}Nightly\u{1b}", "enabled": true, "state": "scheduled"},
                {"id": "aaaa0002", "name": "n".repeat(120), "enabled": true, "state": "scheduled"},
                {"id": "aaaa0003", "name": "   ", "enabled": true, "state": "scheduled"}
            ]}).to_string(),
            None,
            NOW,
        );
        let name = |id: &str| v["active"].as_array().into_iter().flatten().find(|j| j["id"] == id).map(|j| j["name"].clone());
        assert_eq!(name("aaaa0001"), Some(json!("Nightly")));
        assert_eq!(name("aaaa0002").and_then(|n| n.as_str().map(str::len)), Some(80));
        assert_eq!(name("aaaa0003"), Some(json!("unnamed")));
    }

    #[tokio::test]
    async fn detail_never_matches_an_id_with_non_hex_characters() {
        let home = home_with("nonhex", r#"{"jobs":[{"id":"abcd1234-zzzz","name":"Odd"}]}"#);
        assert_eq!(detail(&home, "abcd1234").await.0, 404);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn halt_counts_cover_only_the_paused_jobs_the_list_keeps() {
        // the list keeps the first 300 entries and only objects; halt must count that same set
        let mut jobs = vec!["\"stray\"".to_string()];
        jobs.extend((0..305).map(|i| format!(r#"{{"name":"p{i}","enabled":false,"state":"paused","paused_reason":"owner choice"}}"#)));
        let v = from_text(&format!(r#"{{"jobs":[{}]}}"#, jobs.join(",")), None, NOW);
        let paused = v["counts"]["paused"].as_u64().unwrap_or(0);
        let halted: u64 = v["halt"]["counts"].as_object().map(|m| m.values().filter_map(Value::as_u64).sum::<u64>()).unwrap_or(0);
        assert!(paused > 0);
        assert_eq!(halted, paused);
    }
}
