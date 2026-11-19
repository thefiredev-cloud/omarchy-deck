//! Launch action: POST /api/launch-item?id=<kind>:<slug>&target=hermes (v8: the OMP target is retired).
//! The id must exist in launch.json and the target must be in that item's `targets`.
//! The server then runs `~/ops/bin/deck-launch <target> <id>` with argv only (no shell),
//! one launch at a time, rate limited. deck-launch repeats the same checks on its own.
use crate::util::{log, run};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::path::Path;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

pub const TARGETS: [&str; 1] = ["hermes"];
pub const KINDS: [&str; 6] = ["skill", "mcp", "tool", "plugin", "automation", "command"];
/// Minimum gap between two launches, and the most launches in one minute.
pub const MIN_GAP: Duration = Duration::from_secs(4);
pub const PER_MINUTE: usize = 8;

/// `<kind>:<slug>`, slug `[a-z0-9._-]{1,96}`.
pub fn valid_id(id: &str) -> bool {
    let Some((kind, slug)) = id.split_once(':') else {
        return false;
    };
    KINDS.contains(&kind)
        && (1..=96).contains(&slug.len())
        && slug
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"._-".contains(&c))
}

/// Check one request against the launch list text. Errors are short fixed words.
pub fn check(launch_json: &str, id: &str, target: &str) -> Result<(), &'static str> {
    if !TARGETS.contains(&target) {
        return Err("bad target");
    }
    if !valid_id(id) {
        return Err("bad id");
    }
    let v: Value = serde_json::from_str(launch_json).map_err(|_| "launch list unreadable")?;
    let items = v["items"].as_array().ok_or("launch list unreadable")?;
    let item = items
        .iter()
        .find(|x| x["id"].as_str() == Some(id))
        .ok_or("unknown id")?;
    let kind = id.split_once(':').map(|(k, _)| k).unwrap_or("");
    if item["kind"].as_str() != Some(kind) {
        return Err("kind mismatch");
    }
    let allowed = item["targets"]
        .as_array()
        .map(|a| a.iter().any(|t| t.as_str() == Some(target)))
        .unwrap_or(false);
    if !allowed {
        return Err("target not allowed");
    }
    Ok(())
}

/// Sliding-window limiter. Ok, or Err(seconds to wait).
pub fn admit(hist: &mut VecDeque<Instant>, now: Instant) -> Result<(), u64> {
    while hist
        .front()
        .is_some_and(|t| now.duration_since(*t) >= Duration::from_secs(60))
    {
        hist.pop_front();
    }
    if let Some(last) = hist.back() {
        let since = now.duration_since(*last);
        if since < MIN_GAP {
            return Err((MIN_GAP - since).as_secs() + 1);
        }
    }
    if hist.len() >= PER_MINUTE {
        let oldest = hist.front().copied().unwrap_or(now);
        return Err(60u64
            .saturating_sub(now.duration_since(oldest).as_secs())
            .max(1));
    }
    hist.push_back(now);
    Ok(())
}

#[derive(Default)]
pub struct Launcher {
    hist: Mutex<VecDeque<Instant>>,
    /// Held while deck-launch runs, so launches never overlap.
    running: Mutex<()>,
}

impl Launcher {
    /// Returns (http status, body).
    pub async fn launch(&self, home: &Path, id: &str, target: &str) -> (u16, Value) {
        let text = match tokio::time::timeout(
            Duration::from_secs(2),
            tokio::fs::read_to_string(home.join(".meshvault/status/deck/launch.json")),
        )
        .await
        {
            Ok(Ok(t)) => t,
            _ => {
                return (
                    503,
                    json!({"ok": false, "error": "launch list unavailable"}),
                )
            }
        };
        if let Err(e) = check(&text, id, target) {
            return (400, json!({"ok": false, "error": e}));
        }
        let Ok(_one) = self.running.try_lock() else {
            return (
                429,
                json!({"ok": false, "error": "a launch is running", "retry_s": 3}),
            );
        };
        if let Err(wait) = admit(&mut *self.hist.lock().await, Instant::now()) {
            return (
                429,
                json!({"ok": false, "error": "rate limited", "retry_s": wait}),
            );
        }
        let script = home.join("ops/bin/deck-launch");
        let script = script.to_string_lossy();
        let r = run(&[script.as_ref(), target, id], None, 40, &[]).await;
        let out = match r {
            Ok((code, stdout)) => {
                let parsed = stdout
                    .lines()
                    .rev()
                    .find_map(|l| serde_json::from_str::<Value>(l.trim()).ok())
                    .filter(Value::is_object);
                match parsed {
                    Some(v) => v,
                    None => {
                        json!({"ok": false, "error": format!("launcher exit {code} with no result")})
                    }
                }
            }
            Err(e) => json!({"ok": false, "error": format!("launcher {e}")}),
        };
        log(
            "info",
            "launch",
            &[
                ("id", id.to_string()),
                ("target", target.to_string()),
                ("ok", out["ok"].to_string()),
            ],
        );
        (200, out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIST: &str = r#"{"items":[
        {"id":"skill:fleet-audit","kind":"skill","targets":["omp","hermes"],"arg":"fleet-audit"},
        {"id":"automation:deck-feed-jobs.timer","kind":"automation","targets":[],"arg":"deck-feed-jobs.timer"},
        {"id":"command:deck-audit","kind":"command","targets":["hermes"],"arg":"deck-audit"},
        {"id":"mcp:kraken","kind":"skill","targets":["hermes"]},
        {"id":"skill:old-omp-only","kind":"skill","targets":["omp"],"arg":"old"}]}"#;

    #[test]
    fn ids_follow_the_contract() {
        assert!(valid_id("skill:fleet-audit") && valid_id("command:a.b_c-1"));
        for bad in [
            "",
            "skill",
            "skill:",
            "bogus:x",
            "skill:Fleet",
            "skill:a b",
            "skill:a;rm -rf ~",
            "skill:$(id)",
            "skill:a|b",
            "skill:`x`",
            "skill:a&b",
            "skill:../x",
            "command:x\ny",
        ] {
            assert!(!valid_id(bad), "{bad:?} must be rejected");
        }
        assert!(!valid_id(&format!("skill:{}", "a".repeat(97))));
    }

    #[test]
    fn check_rejects_unknown_wrong_target_and_metacharacters() {
        assert_eq!(check(LIST, "skill:fleet-audit", "hermes"), Ok(()));
        assert_eq!(check(LIST, "command:deck-audit", "hermes"), Ok(()));
        // v8: the OMP target is retired, even for items that still list it
        assert_eq!(check(LIST, "skill:fleet-audit", "omp"), Err("bad target"));
        assert_eq!(check(LIST, "skill:old-omp-only", "omp"), Err("bad target"));
        assert_eq!(
            check(LIST, "skill:old-omp-only", "hermes"),
            Err("target not allowed")
        );
        assert_eq!(
            check(LIST, "automation:deck-feed-jobs.timer", "hermes"),
            Err("target not allowed")
        );
        assert_eq!(check(LIST, "skill:nope", "hermes"), Err("unknown id"));
        assert_eq!(check(LIST, "skill:fleet-audit", "bash"), Err("bad target"));
        assert_eq!(check(LIST, "skill:fleet-audit;id", "hermes"), Err("bad id"));
        assert_eq!(check(LIST, "mcp:kraken", "hermes"), Err("kind mismatch"));
        assert_eq!(
            check("nope", "skill:fleet-audit", "hermes"),
            Err("launch list unreadable")
        );
    }

    #[test]
    fn limiter_enforces_gap_and_minute_cap() {
        let mut h = VecDeque::new();
        let t0 = Instant::now();
        assert!(admit(&mut h, t0).is_ok());
        assert!(admit(&mut h, t0 + Duration::from_secs(1)).is_err());
        let mut t = t0;
        for _ in 1..PER_MINUTE {
            t += Duration::from_secs(5);
            assert!(admit(&mut h, t).is_ok());
        }
        // 8 launches in 35 s: the ninth waits for the window to roll
        assert!(admit(&mut h, t + Duration::from_secs(5)).is_err());
        assert!(admit(&mut h, t0 + Duration::from_secs(61)).is_ok());
    }
}
