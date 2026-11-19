//! Launch run panel: GET /api/run?id=<run_id> and GET /api/run-last.
//! A run id is only served if the deck itself launched it: ids come from the launch log
//! (`~/.local/state/pixel-deck/launch.jsonl`, written by deck-launch, no secrets). The status comes from
//! `~/ops/bin/deck-launch status <run_id>`, which does read-only GETs on the local Hermes gateway
//! (`/v1/runs/<id>` and `/v1/runs/<id>/events`). The gateway key stays inside that script.
use crate::util::{log, run};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::Mutex;

pub const LOG_REL: &str = ".local/state/pixel-deck/launch.jsonl";
const TAIL_BYTES: u64 = 131_072;
const KEEP: usize = 30;
const TTL: Duration = Duration::from_millis(1500);

pub fn valid_run_id(s: &str) -> bool {
    (1..=80).contains(&s.len())
        && !s.starts_with('.')
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b'.'))
}

#[derive(Clone, Debug, PartialEq)]
pub struct Launched {
    pub run_id: String,
    pub id: String,
    pub t: u64,
}

/// Runs the deck started, newest last. Lines that are not ok launches with a valid run id are skipped.
pub fn parse_log(text: &str) -> Vec<Launched> {
    let mut out: Vec<Launched> = text
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| v["ok"].as_bool() == Some(true))
        .filter_map(|v| {
            let run_id = v["run_id"].as_str()?.to_string();
            valid_run_id(&run_id).then(|| Launched {
                run_id,
                id: v["id"].as_str().unwrap_or("").chars().take(120).collect(),
                t: v["t"].as_u64().unwrap_or(0),
            })
        })
        .collect();
    if out.len() > KEEP {
        out.drain(..out.len() - KEEP);
    }
    out
}

pub async fn launched(home: &Path) -> Vec<Launched> {
    let read = async {
        let mut f = tokio::fs::File::open(home.join(LOG_REL)).await.ok()?;
        let len = f.metadata().await.ok()?.len();
        let start = len.saturating_sub(TAIL_BYTES);
        f.seek(std::io::SeekFrom::Start(start)).await.ok()?;
        let mut buf = Vec::new();
        f.take(TAIL_BYTES).read_to_end(&mut buf).await.ok()?;
        let s = String::from_utf8_lossy(&buf).into_owned();
        // a tail cut mid-line: drop the partial first line
        Some(if start > 0 {
            s.split_once('\n').map(|x| x.1.to_string()).unwrap_or_default()
        } else {
            s
        })
    };
    match tokio::time::timeout(Duration::from_secs(2), read).await {
        Ok(Some(s)) => parse_log(&s),
        _ => vec![],
    }
}

/// A run still queued this long after it was created reads as stalled: Hermes never started it.
pub const QUEUE_TIMEOUT_S: u64 = 45;
pub const OFFLINE_REASON: &str = "Hermes offline";
/// The gateway answered, so it is not offline; the run just never left the queue.
pub const STUCK_REASON: &str = "Stuck in queue";

/// Marks a good status answer. `heartbeat` is when the gateway answered. A run that is still queued
/// after QUEUE_TIMEOUT_S is `stalled` with the reason "Stuck in queue", so the panel never sits on
/// "Queued" forever. "Hermes offline" is kept for reads where the gateway did not answer (`failure`).
pub fn annotate(v: &mut Value, launched_at: u64, now: u64) {
    v["heartbeat"] = json!(now);
    let since = v["created_at"]
        .as_f64()
        .map(|c| c as u64)
        .filter(|c| *c > 0)
        .unwrap_or(launched_at);
    let age = now.saturating_sub(since);
    if v["state"] == "queued" && since > 0 && age >= QUEUE_TIMEOUT_S {
        v["stalled"] = json!(true);
        v["reason"] = json!(STUCK_REASON);
        v["queued_s"] = json!(age);
    }
}

/// Body for a failed status read. A gateway that does not answer is "Hermes offline", with the last
/// time it did answer so the panel can show a heartbeat age instead of a bare error.
pub fn failure(error: &Value, run_id: &str, last_heartbeat: Option<u64>) -> Value {
    let offline = matches!(
        error.as_str(),
        Some("hermes gateway unreachable") | Some("status timeout")
    );
    let mut o = json!({"ok": false, "error": error, "run_id": run_id, "offline": offline});
    if offline {
        o["reason"] = json!(OFFLINE_REASON);
    }
    if let Some(b) = last_heartbeat {
        o["last_heartbeat"] = json!(b);
    }
    o
}

#[derive(Default)]
pub struct Runs {
    cache: Mutex<HashMap<String, (Instant, Value)>>,
    /// Last time the gateway answered for each run, so a failed read can still show a heartbeat age.
    beats: Mutex<HashMap<String, u64>>,
    /// One status reader at a time, so a fast poller cannot stack gateway reads.
    one: Mutex<()>,
}

impl Runs {
    /// Last launched run, for "reopen last run".
    pub async fn last(&self, home: &Path) -> (u16, Value) {
        match launched(home).await.pop() {
            Some(l) => (
                200,
                json!({"ok": true, "run_id": l.run_id, "id": l.id, "launched_at": l.t}),
            ),
            None => (404, json!({"ok": false, "error": "no run launched yet"})),
        }
    }

    pub async fn status(&self, home: &Path, run_id: &str) -> (u16, Value) {
        if !valid_run_id(run_id) {
            return (400, json!({"ok": false, "error": "bad run id"}));
        }
        let all = launched(home).await;
        let Some(l) = all.iter().find(|l| l.run_id == run_id).cloned() else {
            return (404, json!({"ok": false, "error": "unknown run"}));
        };
        if let Some((t, v)) = self.cache.lock().await.get(run_id) {
            if t.elapsed() < TTL {
                return (200, v.clone());
            }
        }
        let _one = self.one.lock().await;
        let script = home.join("ops/bin/deck-launch");
        let script = script.to_string_lossy();
        let r = run(&[script.as_ref(), "status", run_id], None, 12, &[]).await;
        let mut v = match r {
            Ok((code, stdout)) => stdout
                .lines()
                .rev()
                .find_map(|x| serde_json::from_str::<Value>(x.trim()).ok())
                .filter(Value::is_object)
                .unwrap_or_else(
                    || json!({"ok": false, "error": format!("status exit {code} with no result")}),
                ),
            Err(e) => json!({"ok": false, "error": format!("status {e}")}),
        };
        if v["ok"].as_bool() != Some(true) {
            let code = if v["error"] == "run not found" { 404 } else { 502 };
            log("warn", "run status failed", &[("run", run_id.to_string())]);
            let beat = self.beats.lock().await.get(run_id).copied();
            return (code, failure(&v["error"], run_id, beat));
        }
        v["item"] = json!(l.id);
        v["launched_at"] = json!(l.t);
        let now = crate::util::now_epoch();
        annotate(&mut v, l.t, now);
        {
            // only runs still in the launch log keep a heartbeat or a cached answer, so neither map grows forever
            let keep = |k: &String| all.iter().any(|x| &x.run_id == k);
            let mut beats = self.beats.lock().await;
            beats.insert(run_id.to_string(), now);
            beats.retain(|k, _| keep(k));
            let mut cache = self.cache.lock().await;
            cache.insert(run_id.to_string(), (Instant::now(), v.clone()));
            cache.retain(|k, _| keep(k));
        }
        (200, v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_ids_are_plain() {
        assert!(valid_run_id("run_77da685c4e2542eeb91631904a1023b6"));
        for bad in ["", ".x", "a/b", "a b", "a;id", "../x", "a\nb", &"a".repeat(81)] {
            assert!(!valid_run_id(bad), "{bad:?}");
        }
    }

    #[test]
    fn log_keeps_only_ok_launches_with_run_ids() {
        let t = concat!(
            "{\"id\":\"skill:a\",\"ok\":true,\"run_id\":\"run_1\",\"t\":10,\"target\":\"hermes\"}\n",
            "{\"id\":\"skill:b\",\"ok\":false,\"error\":\"bad id\",\"t\":11}\n",
            "garbage\n",
            "{\"id\":\"skill:c\",\"ok\":true,\"run_id\":\"a b\",\"t\":12}\n",
            "{\"id\":\"skill:d\",\"ok\":true,\"run_id\":\"run_2\",\"t\":13}\n"
        );
        let v = parse_log(t);
        assert_eq!(v.len(), 2);
        assert_eq!((v[0].run_id.as_str(), v[0].t), ("run_1", 10));
        assert_eq!(v[1].id, "skill:d");
    }

    #[test]
    fn log_is_capped() {
        let t: String = (0..50)
            .map(|i| format!("{{\"id\":\"skill:a\",\"ok\":true,\"run_id\":\"run_{i}\",\"t\":{i}}}\n"))
            .collect();
        let v = parse_log(&t);
        assert_eq!(v.len(), KEEP);
        assert_eq!(v[KEEP - 1].run_id, "run_49");
    }

    #[test]
    fn queued_past_the_timeout_is_stalled_with_the_reason() {
        let mut v = json!({"ok": true, "state": "queued", "created_at": 1000.0, "t": 1044});
        annotate(&mut v, 999, 1000 + QUEUE_TIMEOUT_S - 1);
        assert_eq!(v["heartbeat"], 1000 + QUEUE_TIMEOUT_S - 1);
        assert!(v.get("stalled").is_none(), "{v}");
        annotate(&mut v, 999, 1000 + QUEUE_TIMEOUT_S);
        assert_eq!(v["stalled"], true);
        assert_eq!(v["reason"], "Stuck in queue");
        assert_eq!(v["queued_s"], QUEUE_TIMEOUT_S);
        // running and finished runs are never stalled, and the launch time covers a missing created_at
        let mut r = json!({"ok": true, "state": "running", "created_at": 1.0});
        annotate(&mut r, 1, 5000);
        assert!(r.get("stalled").is_none());
        let mut q = json!({"ok": true, "state": "queued", "created_at": null});
        annotate(&mut q, 1000, 1100);
        assert_eq!(q["stalled"], true);
    }

    #[test]
    fn failure_says_hermes_offline_only_when_the_gateway_is_silent() {
        let f = failure(&json!("hermes gateway unreachable"), "run_1", Some(900));
        assert_eq!(
            (f["offline"].clone(), f["reason"].clone(), f["last_heartbeat"].clone()),
            (json!(true), json!("Hermes offline"), json!(900))
        );
        assert_eq!(failure(&json!("status timeout"), "run_1", None)["offline"], true);
        let g = failure(&json!("hermes http 500"), "run_1", None);
        assert_eq!(g["offline"], false);
        assert!(g.get("reason").is_none() && g.get("last_heartbeat").is_none());
    }

    #[tokio::test]
    async fn status_reports_offline_and_stalled_runs_from_a_fake_gateway_script() {
        use std::os::unix::fs::PermissionsExt;
        let home = std::env::temp_dir().join(format!("pdeck-runs-{}", std::process::id()));
        let bin = home.join("ops/bin");
        let log_dir = home.join(".local/state/pixel-deck");
        let _ = std::fs::create_dir_all(&bin);
        let _ = std::fs::create_dir_all(&log_dir);
        let now = crate::util::now_epoch();
        let _ = std::fs::write(
            log_dir.join("launch.jsonl"),
            format!(
                "{{\"id\":\"skill:a\",\"ok\":true,\"run_id\":\"run_q\",\"t\":{t}}}\n{{\"id\":\"skill:b\",\"ok\":true,\"run_id\":\"run_off\",\"t\":{t}}}\n",
                t = now - 120
            ),
        );
        let script = bin.join("deck-launch");
        let _ = std::fs::write(
            &script,
            "#!/bin/sh\nif [ \"$2\" = run_off ]; then echo '{\"ok\":false,\"error\":\"hermes gateway unreachable\"}'; exit 1; fi\necho '{\"ok\":true,\"run_id\":\"run_q\",\"state\":\"queued\",\"elapsed_s\":120.0,\"created_at\":null,\"lines\":[],\"more\":0}'\n",
        );
        let _ = std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755));
        let runs = Runs::default();
        let (code, v) = runs.status(&home, "run_q").await;
        assert_eq!(code, 200, "{v}");
        assert_eq!((v["stalled"].clone(), v["reason"].clone()), (json!(true), json!("Stuck in queue")));
        assert!(v["heartbeat"].as_u64().is_some());
        let (code, v) = runs.status(&home, "run_off").await;
        assert_eq!(code, 502, "{v}");
        assert_eq!((v["offline"].clone(), v["reason"].clone()), (json!(true), json!("Hermes offline")));
        let _ = std::fs::remove_dir_all(&home);
    }
}
