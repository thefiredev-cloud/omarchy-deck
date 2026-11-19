//! `GET /api/models`: which models sit on which machine, with memory, GPU and resident against installed. Read-only.
//! Source: the ModelDeck collector (`~/projects/modeldeck`, loopback port 8866, unit `webapp-modeldeck.service`), read with
//! one GET of its `/api/state`, cached 5 s. Ported from the owner sweep (commit 0e0b200) without the swap: this module has no
//! POST, no ticket, never calls ModelDeck's swap routes and never starts or stops a unit. Changing what the cluster serves is
//! the owner's. ModelDeck's CSRF token, its swap state and its profile list are dropped on the server.
//! When ModelDeck does not answer the route says `{status: "not_reporting", reason, t}`, like every other feed.
//! Guests and desk viewers are refused by their allowlists in guest.rs before this module runs.
use crate::util::now_epoch;
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const DEFAULT_BASE: &str = "http://127.0.0.1:8866";
const CACHE_SECS: u64 = 5;
/// ModelDeck marks a sample stale after 90 s; the deck says the same.
const STALE_S: u64 = 90;
/// `/api/state` carries a 7-day history the deck does not read; this bounds the body.
const MAX_BODY: usize = 4 << 20;

static CACHE: Mutex<Option<(Instant, Value)>> = Mutex::new(None);

/// The ModelDeck base URL. `PIXEL_DECK_MODELDECK` may point at a stand-in on another loopback port (kit, QA); anything that is
/// not `http://127.0.0.1:<port>` is ignored.
fn base() -> String {
    match std::env::var("PIXEL_DECK_MODELDECK") {
        Ok(v) if loopback_base(&v) => v,
        _ => DEFAULT_BASE.to_string(),
    }
}

fn loopback_base(v: &str) -> bool {
    v.strip_prefix("http://127.0.0.1:")
        .is_some_and(|p| !p.is_empty() && p.len() <= 5 && p.bytes().all(|c| c.is_ascii_digit()) && p.parse::<u16>().is_ok_and(|n| n > 0))
}

fn text(v: &Value, key: &str, n: usize) -> Option<String> {
    let s: String = v.get(key)?.as_str()?.chars().filter(|c| !c.is_control()).take(n).collect();
    let s = s.trim().to_string();
    (!s.is_empty()).then_some(s)
}

fn num(v: &Value, key: &str) -> Value {
    v.get(key).filter(|x| x.is_number()).cloned().unwrap_or(Value::Null)
}

fn flag(v: &Value, key: &str) -> Value {
    v.get(key).filter(|x| x.is_boolean()).cloned().unwrap_or(Value::Null)
}

fn label(id: &str) -> String {
    match id {
        "pc-desktop" => "PC",
        "spark" => "Spark",
        "ascent" => "Ascent",
        "mac-mini" => "Mac mini",
        "dell" => "Dell",
        other => other,
    }
    .to_string()
}

/// A service that carries no weights of its own: routers and facades in front of the cluster.
fn routes_only(kind: &str) -> bool {
    let k = kind.to_ascii_lowercase();
    k.contains("not a separate") || k.contains("not separate") || k.contains("not additional") || k.contains("facade")
}

fn model_row(m: &Value, resident: Option<bool>) -> Value {
    json!({
        "id": text(m, "id", 120),
        "context_length": num(m, "context_length"),
        "format": text(m, "format", 24),
        "gpu_gib": num(m, "gpu_gib"),
        "resident": resident,
    })
}

fn service_row(s: &Value) -> Value {
    let kind = text(s, "kind", 120).unwrap_or_default();
    let status = text(s, "status", 24).unwrap_or_else(|| "unknown".into());
    let stale_cat = s.get("catalog_stale").and_then(Value::as_bool) == Some(true);
    let loaded: Option<Vec<String>> = s
        .get("loaded_models")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|x| x.as_str().map(|m| m.chars().take(120).collect())).collect());
    let weights = !routes_only(&kind);
    let models: Vec<Value> = s
        .get("models")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .map(|m| {
                    let mid = m.get("id").and_then(Value::as_str).unwrap_or("");
                    // resident: a loaded list wins (Ollama /api/ps); else a live server's catalog is what it serves; a
                    // cached catalog of a server that is not answering is installed, never resident; a router holds nothing
                    let res = if !weights {
                        None
                    } else if let Some(l) = &loaded {
                        Some(l.iter().any(|x| x == mid))
                    } else if s.get("loaded_models").is_some() {
                        None
                    } else {
                        Some(status == "online" && !stale_cat)
                    };
                    model_row(m, res)
                })
                .collect()
        })
        .unwrap_or_default();
    json!({
        "id": text(s, "id", 40).unwrap_or_default(),
        "kind": kind,
        "port": num(s, "port"),
        "status": status,
        "weights": weights,
        "catalog_stale": stale_cat,
        "last_seen": text(s, "last_seen", 40),
        "note": text(s, "label_note", 200),
        "running": num(s, "running"),
        "queue": num(s, "queue"),
        "tok_s": num(s, "tok_s"),
        "models": models,
    })
}

fn pct(used: Option<f64>, total: Option<f64>) -> Value {
    match (used, total) {
        (Some(u), Some(t)) if t > 0.0 => json!(((u / t) * 1000.0).round() / 10.0),
        _ => Value::Null,
    }
}

pub fn not_reporting(reason: &str, now: u64) -> Value {
    json!({"status": "not_reporting", "reason": reason, "t": now})
}

/// ModelDeck `/api/state` -> the deck's inventory. Unknown stays null, never zero.
pub fn shape(state: &Value, now: u64) -> Value {
    let Some(hosts_in) = state.get("hosts").and_then(Value::as_array) else {
        return not_reporting("ModelDeck sent no host list", now);
    };
    let sampled = state.get("sampled_epoch").and_then(Value::as_f64).filter(|f| *f > 0.0).map(|f| f as u64);
    let Some(sampled) = sampled else {
        return not_reporting("ModelDeck has not taken its first sample yet", now);
    };
    let empty = vec![];
    let services = state.get("models").and_then(Value::as_array).unwrap_or(&empty);
    let cl = state.get("cluster").cloned().unwrap_or_else(|| json!({}));
    let age = now.saturating_sub(sampled);
    let stale = age > STALE_S || state.get("stale").and_then(Value::as_bool) == Some(true);

    let hosts: Vec<Value> = hosts_in
        .iter()
        .map(|h| {
            let id = text(h, "id", 24).unwrap_or_default();
            let ids: Vec<&str> = h
                .get("service_ids")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            let rows: Vec<Value> = services
                .iter()
                .filter(|s| s.get("id").and_then(Value::as_str).is_some_and(|sid| ids.contains(&sid)))
                .map(service_row)
                .collect();
            let mut resident: Vec<String> = vec![];
            let mut installed: Vec<String> = vec![];
            for r in rows.iter().filter(|r| r["weights"] == true) {
                for m in r["models"].as_array().into_iter().flatten() {
                    let Some(mid) = m["id"].as_str() else { continue };
                    if !installed.iter().any(|x| x == mid) {
                        installed.push(mid.to_string());
                    }
                    if m["resident"] == true && !resident.iter().any(|x| x == mid) {
                        resident.push(mid.to_string());
                    }
                }
            }
            let tot = h.get("memory_total_gib").and_then(Value::as_f64);
            let avail = h.get("memory_available_gib").and_then(Value::as_f64);
            let used = tot.zip(avail).map(|(t, a)| (t - a).max(0.0));
            json!({
                "id": id,
                "label": label(&id),
                "status": text(h, "status", 24).unwrap_or_else(|| "unknown".into()),
                "memory_kind": text(h, "memory_kind", 24),
                "memory_total_gib": tot,
                "memory_available_gib": avail,
                "memory_used_pct": pct(used, tot),
                "gpu_name": text(h, "gpu_name", 48),
                "gpu_used_gib": num(h, "gpu_used_gib"),
                "gpu_total_gib": num(h, "gpu_total_gib"),
                "gpu_used_pct": pct(h.get("gpu_used_gib").and_then(Value::as_f64), h.get("gpu_total_gib").and_then(Value::as_f64)),
                "resident": resident,
                "installed": installed,
                "services": rows,
            })
        })
        .collect();

    let tel = cl.get("telemetry").cloned().unwrap_or_else(|| json!({}));
    json!({
        "t": sampled,
        "checked": now,
        "age": age,
        "stale": stale,
        "collector_error": text(state, "collector_error", 160),
        "hosts": hosts,
        // what the cluster serves now, read only: the swap controls, profiles and history stay with the owner's ModelDeck
        "cluster": {
            "online": flag(&cl, "online"),
            "current": text(&cl, "current", 60),
            "served": text(&tel, "display_name", 120).or_else(|| text(&tel, "model", 120)),
            "engine": text(&tel, "engine", 24),
            "telemetry_fresh": flag(&tel, "fresh"),
            "requests_running": num(&tel, "requests_running"),
            "spark_reachable": flag(&cl, "spark_reachable"),
        },
    })
}

/// One read of ModelDeck at `base`, shaped. Never a 5xx: a failure is the not-reporting answer.
pub async fn read(http: &reqwest::Client, base: &str, now: u64) -> Value {
    let r = match http.get(format!("{base}/api/state")).timeout(Duration::from_secs(4)).send().await {
        Ok(r) => r,
        Err(e) if e.is_connect() => return not_reporting("ModelDeck is not running on this computer", now),
        Err(_) => return not_reporting("ModelDeck did not answer", now),
    };
    if !r.status().is_success() {
        return not_reporting(&format!("ModelDeck answered {}", r.status().as_u16()), now);
    }
    if r.content_length().is_some_and(|n| n > MAX_BODY as u64) {
        return not_reporting("ModelDeck's answer is too large", now);
    }
    match r.bytes().await {
        Ok(b) if b.len() <= MAX_BODY => match serde_json::from_slice::<Value>(&b) {
            Ok(v) => shape(&v, now),
            Err(_) => not_reporting("ModelDeck sent unreadable JSON", now),
        },
        Ok(_) => not_reporting("ModelDeck's answer is too large", now),
        Err(_) => not_reporting("ModelDeck did not finish its answer", now),
    }
}

/// `GET /api/models`, cached 5 s.
pub async fn inventory(http: &reqwest::Client) -> Value {
    if let Ok(g) = CACHE.lock() {
        if let Some((at, v)) = g.as_ref() {
            if at.elapsed().as_secs() < CACHE_SECS {
                return v.clone();
            }
        }
    }
    let v = read(http, &base(), now_epoch()).await;
    if let Ok(mut g) = CACHE.lock() {
        *g = Some((Instant::now(), v.clone()));
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn sample() -> Value {
        json!({
            "csrf": "SECRET-CSRF", "loading": false, "sampled_epoch": 1_000_000.0,
            "history": [{"at": 1.0}],
            "hosts": [
                {"id": "pc-desktop", "status": "online", "memory_kind": "System RAM", "memory_total_gib": 100.0, "memory_available_gib": 40.0,
                 "gpu_name": "RTX 4080", "gpu_used_gib": 15.0, "gpu_total_gib": 16.0, "service_ids": ["clef", "jev"]},
                {"id": "ascent", "status": "online", "memory_kind": "Unified memory", "memory_total_gib": 120.0, "memory_available_gib": 8.0,
                 "service_ids": ["cluster", "ascent-0"]},
                {"id": "mac-mini", "status": "online", "memory_kind": "Unified memory", "memory_total_gib": 24.0, "memory_available_gib": null,
                 "service_ids": ["mac-mini-0"]}
            ],
            "models": [
                {"id": "clef", "host": "pc-desktop", "status": "online", "kind": "Decision model", "port": 8098, "endpoint": "http://127.0.0.1:8098",
                 "models": [{"id": "clef-4b", "context_length": 8192, "format": "Q4"}]},
                {"id": "jev", "host": "pc-desktop", "status": "online", "kind": "Decision router, not a separate resident model", "models": [{"id": "jev-local/x"}]},
                {"id": "cluster", "host": "Spark + Ascent", "status": "online", "kind": "Cluster front door", "port": 8080, "models": [{"id": "DeepSeek-X", "context_length": 1048576}]},
                {"id": "ascent-0", "host": "ascent", "status": "online", "kind": "Ollama installed catalogue", "models": [{"id": "llama-a"}, {"id": "llama-b"}], "loaded_models": ["llama-b"]},
                {"id": "mac-mini-0", "host": "mac-mini", "status": "offline", "kind": "mlx", "models": [{"id": "mac-qwen"}], "catalog_stale": true, "last_seen": "2026-11-01T00:00:00Z"}
            ],
            "cluster": {
                "online": true, "profiles_fresh": true, "gated_swap_available": true, "current": "a", "swap_state": "idle",
                "spark_reachable": true, "expected_outage_s": 210, "pending_job": null, "action_job": null, "swaps_stale": true,
                "route": "Spark existing swap-gate swap <profile>",
                "telemetry": {"display_name": "Model A", "engine": "tensorfold", "fresh": true, "requests_running": 1},
                "profiles": [{"id": "a", "name": "Model A"}, {"id": "b", "name": "Model B"}],
                "swaps": [{"profile": "a", "status": "ok", "duration_s": 212.0, "started_at": 5}]
            }
        })
    }

    fn keys(v: &Value) -> Vec<&str> {
        v.as_object().map(|o| o.keys().map(String::as_str).collect()).unwrap_or_default()
    }

    #[test]
    fn the_inventory_carries_no_swap_and_no_token() {
        let v = shape(&sample(), 1_000_030);
        let s = v.to_string();
        for gone in ["SECRET-CSRF", "csrf", "swap", "profiles", "pending_job", "action_job", "gated", "expected_outage", "Model B", "history", "endpoint"] {
            assert!(!s.contains(gone), "{gone} leaked: {s}");
        }
        assert_eq!(keys(&v), ["age", "checked", "cluster", "collector_error", "hosts", "stale", "t"]);
        assert_eq!(keys(&v["cluster"]), ["current", "engine", "online", "requests_running", "served", "spark_reachable", "telemetry_fresh"]);
        assert_eq!((v["age"].as_u64(), v["stale"].as_bool(), v["t"].as_u64()), (Some(30), Some(false), Some(1_000_000)));
        assert_eq!((v["cluster"]["current"].as_str(), v["cluster"]["served"].as_str()), (Some("a"), Some("Model A")));
    }

    #[test]
    fn resident_versus_installed_per_machine() {
        let v = shape(&sample(), 1_000_030);
        let h = |id: &str| v["hosts"].as_array().and_then(|a| a.iter().find(|h| h["id"] == id)).cloned().unwrap_or(Value::Null);
        // the router carries no weights: it is neither resident nor installed
        assert_eq!((h("pc-desktop")["resident"].clone(), h("pc-desktop")["installed"].clone()), (json!(["clef-4b"]), json!(["clef-4b"])));
        // Ollama: both installed, only the loaded one resident; the cluster model is resident on its node
        assert_eq!(h("ascent")["installed"], json!(["DeepSeek-X", "llama-a", "llama-b"]));
        assert_eq!(h("ascent")["resident"], json!(["DeepSeek-X", "llama-b"]));
        // an offline machine's cached catalogue is installed only, and unknown memory stays null
        assert_eq!((h("mac-mini")["installed"].clone(), h("mac-mini")["resident"].clone()), (json!(["mac-qwen"]), json!([])));
        assert_eq!(h("mac-mini")["memory_used_pct"], Value::Null);
        assert_eq!((h("pc-desktop")["memory_used_pct"].as_f64(), h("pc-desktop")["gpu_used_pct"].as_f64()), (Some(60.0), Some(93.8)));
        assert_eq!((h("pc-desktop")["label"].as_str(), h("mac-mini")["label"].as_str()), (Some("PC"), Some("Mac mini")));
        assert_eq!(keys(&h("ascent")), [
            "gpu_name", "gpu_total_gib", "gpu_used_gib", "gpu_used_pct", "id", "installed", "label", "memory_available_gib", "memory_kind",
            "memory_total_gib", "memory_used_pct", "resident", "services", "status",
        ]);
        let jev = &h("pc-desktop")["services"][1];
        assert_eq!((jev["weights"].as_bool(), jev["models"][0]["resident"].clone()), (Some(false), Value::Null));
    }

    #[test]
    fn old_or_missing_samples_say_so() {
        assert_eq!(shape(&sample(), 1_000_500)["stale"], true);
        let mut s = sample();
        s["stale"] = json!(true);
        assert_eq!(shape(&s, 1_000_010)["stale"], true);
        let first = json!({"hosts": [], "models": [], "history": [], "cluster": {}, "loading": true, "csrf": "x"});
        assert_eq!(shape(&first, 5)["status"], "not_reporting");
        assert_eq!(shape(&json!([1]), 5)["status"], "not_reporting");
        let mut e = sample();
        e["collector_error"] = json!("Collector failed. Last sample is retained; retrying in 30 seconds.");
        assert!(shape(&e, 1_000_010)["collector_error"].as_str().is_some_and(|x| x.starts_with("Collector failed")));
    }

    #[test]
    fn only_a_loopback_base_is_taken() {
        assert!(loopback_base("http://127.0.0.1:8866") && loopback_base("http://127.0.0.1:1"));
        for bad in ["http://127.0.0.1:", "http://127.0.0.1:0", "http://evil.example:8866", "http://127.0.0.1:8866/x", "https://127.0.0.1:8866",
                    "http://localhost:8866", "http://127.0.0.1:99999"] {
            assert!(!loopback_base(bad), "{bad}");
        }
    }

    async fn server(reply: String) -> Option<u16> {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.ok()?;
        let port = l.local_addr().ok()?.port();
        tokio::spawn(async move {
            while let Ok((mut s, _)) = l.accept().await {
                let reply = reply.clone();
                tokio::spawn(async move {
                    let mut buf = [0u8; 2048];
                    let _ = s.read(&mut buf).await;
                    let _ = s.write_all(reply.as_bytes()).await;
                });
            }
        });
        Some(port)
    }

    fn http(code: &str, body: &str) -> String {
        format!("HTTP/1.1 {code}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
    }

    #[tokio::test]
    async fn a_read_is_shaped_or_says_not_reporting() {
        let c = reqwest::Client::new();
        let (Some(ok), Some(err), Some(junk)) =
            (server(http("200 OK", &sample().to_string())).await, server(http("500 Internal Server Error", "{}")).await, server(http("200 OK", "<html>")).await)
        else {
            panic!("no listener")
        };
        let v = read(&c, &format!("http://127.0.0.1:{ok}"), 1_000_030).await;
        assert_eq!((v["hosts"].as_array().map(Vec::len), v.get("status")), (Some(3), None));
        let nr = |v: &Value| (v["status"].as_str().map(str::to_string), v["reason"].as_str().map(str::to_string));
        let gone = tokio::net::TcpListener::bind("127.0.0.1:0").await.ok().and_then(|l| l.local_addr().ok()).map(|a| a.port()).unwrap_or(9);
        let none = read(&c, &format!("http://127.0.0.1:{gone}"), 7).await;
        assert_eq!(nr(&none), (Some("not_reporting".into()), Some("ModelDeck is not running on this computer".into())));
        assert_eq!(keys(&none), ["reason", "status", "t"]);
        assert_eq!(nr(&read(&c, &format!("http://127.0.0.1:{err}"), 7).await), (Some("not_reporting".into()), Some("ModelDeck answered 500".into())));
        assert_eq!(nr(&read(&c, &format!("http://127.0.0.1:{junk}"), 7).await), (Some("not_reporting".into()), Some("ModelDeck sent unreadable JSON".into())));
    }
}
