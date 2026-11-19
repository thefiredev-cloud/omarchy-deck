//! Fleet page: fleet-facts tiles, service health, cluster health, host reachability. Cached 15 s.
use crate::util::{now_epoch, run};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tokio::net::TcpStream;

pub const UNITS: [&str; 6] = [
    "hermes-gateway",
    "pixel-deck",
    "mediamtx",
    "jev-local",
    "homeassistant",
    "hermes-webui",
];

pub fn parse_fact(l: &str) -> Value {
    let l = l.trim_end();
    let mut tag = "";
    let mut body = l;
    if l.ends_with(']') {
        let end = l.len() - 1;
        for (i, c) in l.char_indices() {
            if c == '[' && i < end && !l[i + 1..end].contains(']') {
                body = l[..i].trim_end();
                tag = &l[i + 1..end];
                break;
            }
        }
    }
    let (kind, rest) = body.split_once(':').unwrap_or((body, ""));
    json!({"head": kind.trim(), "text": rest.trim(), "tag": tag, "raw": body})
}

/// Why the facts list is empty, so the Fleet page can say it instead of showing a blank column.
pub fn empty_reason(rc: i32, item_count: usize) -> Option<String> {
    if item_count > 0 {
        return None;
    }
    Some(if rc == 0 {
        "fleet-facts ran but printed no facts".to_string()
    } else {
        format!("fleet-facts exited {rc} and printed no facts")
    })
}

pub async fn facts(path: &str) -> Value {
    match run(&[path], None, 10, &[]).await {
        Ok((rc, out)) => {
            let mut items = vec![];
            let mut stamp = String::new();
            for l in out.lines() {
                if let Some(s) = l.trim_end().strip_prefix("fleet-facts") {
                    stamp = s.trim().to_string();
                    continue;
                }
                items.push(parse_fact(l));
            }
            let reason = empty_reason(rc, items.len());
            let mut v = json!({"items": items, "stamp": stamp, "rc": rc});
            if let Some(r) = reason {
                v["empty_reason"] = json!(r);
            }
            v
        }
        Err(_) => json!({"error": "fleet-facts failed", "items": []}),
    }
}

/// Largest value across every line of one metric: per-stream gauges (the tensorfold engine labels
/// `kv_cache_usage_perc{stream="N"}`) report one line each, and the fullest stream is the load.
pub fn parse_metric_max(text: &str, name: &str) -> Option<f64> {
    text.lines()
        .filter(|l| l.starts_with(name))
        .filter_map(|l| l.rsplit(' ').next().and_then(|v| v.parse::<f64>().ok()))
        .reduce(f64::max)
}

/// First of `names` that the page exports, and its largest value. vLLM names come from older
/// engines; the resident DeepSeek engine exports the same gauges under `tensorfold:`.
fn parse_gauge(text: &str, names: &[&str]) -> Option<f64> {
    names.iter().find_map(|n| parse_metric_max(text, n))
}

pub async fn cluster(http: &reqwest::Client) -> Value {
    let t = now_epoch();
    let get = |p: &'static str| {
        let h = http.clone();
        async move {
            h.get(format!("http://127.0.0.1:8080{p}"))
                .timeout(Duration::from_secs(3))
                .send()
                .await
                .ok()?
                .text()
                .await
                .ok()
        }
    };
    let (models, metrics) = tokio::join!(get("/v1/models"), get("/metrics"));
    let model = models
        .and_then(|m| serde_json::from_str::<Value>(&m).ok())
        .and_then(|v| {
            v.pointer("/data/0/id")
                .and_then(Value::as_str)
                .map(str::to_string)
        });
    let (run_n, wait_n, kv) = match metrics.as_deref() {
        Some(m) => (
            parse_gauge(
                m,
                &["tensorfold:num_requests_running", "vllm:num_requests_running"],
            ),
            parse_gauge(
                m,
                &["tensorfold:num_requests_waiting", "vllm:num_requests_waiting"],
            ),
            kv_percent(m),
        ),
        None => (None, None, None),
    };
    json!({
        "ok": model.is_some(), "model": model, "running": run_n, "waiting": wait_n, "kv_cache_pct": kv,
        "src": "live http://127.0.0.1:8080/v1/models + /metrics", "t": t,
    })
}

/// KV cache use as a percent. The engine reports a 0..1 fraction per stream (`kv_cache_usage_perc`,
/// or `kv_cache_usage_ratio`; vLLM's older name is `gpu_cache_usage_perc`). Missing is None, never 0.
pub fn kv_percent(text: &str) -> Option<f64> {
    let f = parse_gauge(
        text,
        &[
            "tensorfold:kv_cache_usage_perc",
            "tensorfold:kv_cache_usage_ratio",
            "vllm:kv_cache_usage_perc",
            "vllm:gpu_cache_usage_perc",
        ],
    )?;
    (0.0..=1.0)
        .contains(&f)
        .then(|| (f * 1000.0).round() / 10.0)
}

async fn services() -> Value {
    let t = now_epoch();
    let mut argv = vec!["systemctl", "--user", "is-active"];
    let names: Vec<String> = UNITS.iter().map(|u| format!("{u}.service")).collect();
    argv.extend(names.iter().map(String::as_str));
    let env = [(
        "XDG_RUNTIME_DIR",
        format!("/run/user/{}", crate::util::uid()),
    )];
    let states: Vec<String> = match run(&argv, None, 5, &env).await {
        Ok((_, o)) => o.lines().map(|l| l.trim().to_string()).collect(),
        Err(_) => vec![],
    };
    let items: Vec<Value> = UNITS
        .iter()
        .enumerate()
        .map(|(i, u)| {
            let s = states.get(i).map(String::as_str).unwrap_or("unknown");
            json!({"unit": u, "state": s, "ok": s == "active", "src": "systemctl --user is-active", "t": t})
        })
        .collect();
    json!({"items": items})
}

/// `HostName` and `Port` of one `Host` alias in an ssh config: the same file `ssh <alias>` reads, so the Hosts probes
/// and the Machines disk check (fleet-disks, which runs over ssh) look at the same address. First value wins, like ssh.
/// Wildcard blocks are skipped.
pub fn ssh_target(cfg: &str, alias: &str) -> Option<(String, u16)> {
    let (mut inside, mut name, mut port) = (false, None::<String>, None::<u16>);
    let mut found = false;
    for raw in cfg.lines() {
        let l = raw.trim();
        let (k, rest) = l.split_once(char::is_whitespace).unwrap_or((l, ""));
        let rest = rest.trim().trim_start_matches('=').trim();
        if k.eq_ignore_ascii_case("host") {
            inside = rest.split_whitespace().any(|a| a == alias);
            found |= inside;
        } else if inside && k.eq_ignore_ascii_case("hostname") && name.is_none() {
            name = rest.split_whitespace().next().map(str::to_string);
        } else if inside && k.eq_ignore_ascii_case("port") && port.is_none() {
            port = rest.parse().ok();
        }
    }
    found.then(|| (name.unwrap_or_else(|| alias.to_string()), port.unwrap_or(22)))
}

/// TCP connect to each address in turn; the first that answers is the route. A machine can be off the tailnet and
/// still on the LAN (the Mac mini since 2026-11-02), so one dead address is not "not reachable".
async fn probe(name: &str, targets: &[(String, u16)]) -> Value {
    let t0 = Instant::now();
    for (host, port) in targets {
        let r = tokio::time::timeout(Duration::from_secs(2), TcpStream::connect((host.as_str(), *port))).await;
        if matches!(r, Ok(Ok(_))) {
            return json!({
                "name": name, "ok": true, "ms": t0.elapsed().as_millis() as u64, "via": format!("{host}:{port}"),
                "src": "tcp connect to the ssh port, address from ~/.ssh/config, 2 s each", "t": now_epoch(),
            });
        }
    }
    json!({
        "name": name, "ok": false, "ms": Value::Null, "tried": targets.len(),
        "src": "tcp connect to the ssh port, address from ~/.ssh/config, 2 s each", "t": now_epoch(),
    })
}

/// The ssh alias, then the last known tailnet address, for one host. The config comes first: it holds the route
/// that works today. Duplicates are dropped.
fn targets(cfg: &str, alias: &str, fallback: &str) -> Vec<(String, u16)> {
    let mut v: Vec<(String, u16)> = vec![];
    if let Some(t) = ssh_target(cfg, alias) {
        v.push(t);
    }
    let fb = (fallback.to_string(), 22u16);
    if !v.contains(&fb) {
        v.push(fb);
    }
    v
}

async fn reach() -> Value {
    let cfg = match std::env::var("HOME") {
        Ok(h) => tokio::fs::read_to_string(format!("{h}/.ssh/config")).await.unwrap_or_default(),
        Err(_) => String::new(),
    };
    let (ts, ta, tm, td) = (
        targets(&cfg, "spark", "192.0.2.63"),
        targets(&cfg, "ascent", "192.0.2.81"),
        targets(&cfg, "mac-mini", "192.0.2.48"),
        targets(&cfg, "dell", "192.0.2.50"),
    );
    let (a, b, c, d) = tokio::join!(probe("Spark", &ts), probe("Ascent", &ta), probe("Mini", &tm), probe("Dell", &td));
    json!({"items": [a, b, c, d]})
}

pub async fn build(facts_path: &str, http: &reqwest::Client) -> Value {
    let (f, s, c, r) = tokio::join!(facts(facts_path), services(), cluster(http), reach());
    let mut v = f;
    if let Some(o) = v.as_object_mut() {
        o.insert("services".into(), s);
        o.insert("cluster".into(), c);
        o.insert("reach".into(), r);
        o.insert("t".into(), now_epoch().into());
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fact_line_parses_tag() {
        let v = parse_fact("cluster model: glm max_model_len=1 [live http://x]");
        assert_eq!(v["head"], "cluster model");
        assert_eq!(v["text"], "glm max_model_len=1");
        assert_eq!(v["tag"], "live http://x");
        let v = parse_fact("no tag here");
        assert_eq!(
            (v["head"].as_str(), v["tag"].as_str()),
            (Some("no tag here"), Some(""))
        );
    }

    #[test]
    fn kv_percent_is_a_percent_or_none() {
        let m = "vllm:kv_cache_usage_perc{engine=\"0\"} 0.1234\n";
        assert_eq!(kv_percent(m), Some(12.3));
        assert_eq!(kv_percent("vllm:gpu_cache_usage_perc 0.5\n"), Some(50.0));
        assert_eq!(kv_percent("vllm:kv_cache_usage_perc{a=\"b\"} 0.0\n"), Some(0.0));
        assert_eq!(kv_percent("nothing here"), None);
        assert_eq!(kv_percent("vllm:kv_cache_usage_perc 7\n"), None);
    }

    #[test]
    fn resident_engine_metrics_use_the_tensorfold_names_and_fullest_stream() {
        let m = "tensorfold:num_requests_running 2\ntensorfold:num_requests_waiting 0\n\
                 tensorfold:kv_cache_usage_perc{stream=\"0\"} 0.083\ntensorfold:kv_cache_usage_perc{stream=\"1\"} 0.25\n";
        assert_eq!(parse_gauge(m, &["tensorfold:num_requests_running"]), Some(2.0));
        assert_eq!(parse_gauge(m, &["tensorfold:num_requests_waiting"]), Some(0.0));
        assert_eq!(kv_percent(m), Some(25.0));
    }

    #[test]
    fn metric_parse() {
        let m = "# HELP x\nvllm:num_requests_running{engine=\"0\"} 1.0\nvllm:num_requests_waiting{engine=\"0\"} 0.0\n";
        assert_eq!(parse_metric_max(m, "vllm:num_requests_running"), Some(1.0));
        assert_eq!(parse_metric_max(m, "nope"), None);
    }

    #[test]
    fn fact_tag_is_only_a_trailing_bracket_group_and_text_keeps_later_colons() {
        let v = parse_fact("disk: 40% used: ok [live ssh://h]   ");
        assert_eq!((v["head"].as_str(), v["text"].as_str()), (Some("disk"), Some("40% used: ok")));
        assert_eq!((v["tag"].as_str(), v["raw"].as_str()), (Some("live ssh://h"), Some("disk: 40% used: ok")));
        // a bracket that is not at the end of the line is body text, not a tag
        let v = parse_fact("a [b] c: d");
        assert_eq!((v["head"].as_str(), v["tag"].as_str()), (Some("a [b] c"), Some("")));
        // with two trailing groups the last one is the tag and the first stays in the body
        let v = parse_fact("a: b [x] [y]");
        assert_eq!((v["text"].as_str(), v["tag"].as_str()), (Some("b [x]"), Some("y")));
    }

    #[test]
    fn fact_parser_survives_blank_lines_bare_tags_and_non_ascii_text() {
        for line in ["", "   ", "[]", "]", "[", "[[]]", "x]", "é: ü [ö]", ":", "a:[b]"] {
            let v = parse_fact(line);
            assert!(v["head"].is_string() && v["text"].is_string() && v["tag"].is_string(), "{line:?}");
        }
        let v = parse_fact("[live]");
        assert_eq!((v["head"].as_str(), v["tag"].as_str()), (Some(""), Some("live")));
        let v = parse_fact("é: ü [ö]");
        assert_eq!((v["head"].as_str(), v["text"].as_str(), v["tag"].as_str()), (Some("é"), Some("ü"), Some("ö")));
    }

    #[test]
    fn metric_parse_max_skips_unparsable_series_and_reads_exponents() {
        // parse_metric_max replaced the single-line parser: per-stream gauges report one line each and the
        // fullest stream is the load, so the maximum of the parsable series is the reading.
        let m = "foo_total{a=\"1\"} NaNx\nfoo_total{a=\"2\"} 7\nfoo_total{a=\"3\"} 9\n";
        assert_eq!(parse_metric_max(m, "foo_total"), Some(9.0));
        assert_eq!(parse_metric_max("foo 1e3\n", "foo"), Some(1000.0));
        assert_eq!(parse_metric_max("# TYPE foo gauge\nbar 1\n", "foo"), None);
        assert_eq!(parse_metric_max("", "foo"), None);
    }

    #[test]
    fn kv_percent_rejects_out_of_range_and_prefers_the_current_metric_name() {
        assert_eq!(kv_percent("vllm:kv_cache_usage_perc 1.0\n"), Some(100.0));
        assert_eq!(kv_percent("vllm:kv_cache_usage_perc 1.01\n"), None);
        assert_eq!(kv_percent("vllm:kv_cache_usage_perc -0.1\n"), None);
        let both = "vllm:gpu_cache_usage_perc 0.9\nvllm:kv_cache_usage_perc 0.25\n";
        assert_eq!(kv_percent(both), Some(25.0));
        // an out-of-range new-style value is "unknown", not a fallback to the old metric
        let bad = "vllm:kv_cache_usage_perc 5\nvllm:gpu_cache_usage_perc 0.9\n";
        assert_eq!(kv_percent(bad), None);
    }

    /// Write an executable shell script into a fresh temp dir and return its path.
    fn script(body: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        use std::sync::atomic::{AtomicUsize, Ordering};
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "pixel-deck-facts-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("fleet-facts");
        let _ = std::fs::write(&path, format!("#!/bin/sh\n{body}\n"));
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755));
        path
    }

    fn cleanup(path: &std::path::Path) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    /// `facts` on a freshly written script. Another test thread can fork while the script's write handle is still
    /// open, and exec then fails with "text file busy" for a moment; a few short retries ride that out.
    async fn facts_of(path: &str) -> Value {
        for _ in 0..20 {
            let v = facts(path).await;
            if v.get("error").is_none() {
                return v;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        facts(path).await
    }

    #[tokio::test]
    async fn facts_splits_the_stamp_line_from_the_fact_lines() {
        let p = script("printf 'fleet-facts 2026-10-10 06:00\\ncluster model: glm [live http://x]\\n\\nplain line\\n'");
        let Some(path) = p.to_str() else { panic!("temp path is not utf-8") };
        let v = facts_of(path).await;
        cleanup(&p);
        assert_eq!(v["stamp"], "2026-10-10 06:00");
        assert_eq!(v["rc"], 0);
        let items = v["items"].as_array().cloned().unwrap_or_default();
        // the stamp line is not an item; the blank line is kept as an empty fact so row order matches the script
        assert!(items.iter().all(|i| i["head"] != "fleet-facts"), "{v}");
        assert_eq!(items[0]["head"], "cluster model");
        assert_eq!(items[0]["tag"], "live http://x");
        assert_eq!(items.last().map(|i| i["head"].clone()), Some(json!("plain line")));
    }

    #[tokio::test]
    async fn facts_keeps_the_exit_code_of_a_failing_script_and_its_partial_output() {
        let p = script("echo 'a: b'; exit 3");
        let Some(path) = p.to_str() else { panic!("temp path is not utf-8") };
        let v = facts_of(path).await;
        cleanup(&p);
        assert_eq!(v["rc"], 3);
        assert_eq!(v["items"][0]["text"], "b");
        assert_eq!(v["stamp"], "");
    }

    #[tokio::test]
    async fn facts_with_a_missing_script_is_an_error_object_with_no_items() {
        let v = facts("/nonexistent/pixel-deck/fleet-facts").await;
        assert_eq!(v, json!({"error": "fleet-facts failed", "items": []}));
    }

    #[test]
    fn empty_facts_say_why() {
        assert_eq!(empty_reason(0, 3), None);
        assert_eq!(empty_reason(0, 0).as_deref(), Some("fleet-facts ran but printed no facts"));
        assert_eq!(empty_reason(2, 0).as_deref(), Some("fleet-facts exited 2 and printed no facts"));
    }

    const SSH_CFG: &str = "Host cluster spark spark2\n    HostName 192.0.2.63\n    User x\n\
        Host mac-mini mini\n    # Revert: restore the old file\n    HostName 198.51.100.132\n    User y\n\
        Host pixel\n    HostName 192.0.2.117\n    Port 8022\n\
        Host *\n    HostName ignored.example\n";

    #[test]
    fn ssh_target_reads_hostname_and_port_from_the_alias_block() {
        assert_eq!(ssh_target(SSH_CFG, "spark"), Some(("192.0.2.63".into(), 22)));
        assert_eq!(ssh_target(SSH_CFG, "mac-mini"), Some(("198.51.100.132".into(), 22)));
        assert_eq!(ssh_target(SSH_CFG, "pixel"), Some(("192.0.2.117".into(), 8022)));
        assert_eq!(ssh_target(SSH_CFG, "nope"), None);
        assert_eq!(ssh_target("", "spark"), None);
        // a Host block with no HostName is the alias itself
        assert_eq!(ssh_target("Host solo\n  User z\n", "solo"), Some(("solo".into(), 22)));
    }

    #[test]
    fn targets_put_the_config_route_first_and_never_repeat_it() {
        let t = targets(SSH_CFG, "mac-mini", "192.0.2.48");
        assert_eq!(t, vec![("198.51.100.132".to_string(), 22), ("192.0.2.48".to_string(), 22)]);
        let same = targets(SSH_CFG, "spark", "192.0.2.63");
        assert_eq!(same, vec![("192.0.2.63".to_string(), 22)]);
        // no config entry: only the fallback
        assert_eq!(targets("", "dell", "192.0.2.50"), vec![("192.0.2.50".to_string(), 22)]);
    }

    #[tokio::test]
    async fn probe_reports_the_address_that_answered_and_skips_a_dead_one() {
        let Ok(l) = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await else { panic!("bind") };
        let live = l.local_addr().map(|a| a.port()).unwrap_or(0);
        // a port nothing listens on: bind then drop
        let dead = {
            let Ok(d) = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await else { panic!("bind") };
            d.local_addr().map(|a| a.port()).unwrap_or(0)
        };
        let v = probe("X", &[("127.0.0.1".into(), dead), ("127.0.0.1".into(), live)]).await;
        assert_eq!(v["ok"], true, "{v}");
        assert_eq!(v["via"], format!("127.0.0.1:{live}"));
        let v = probe("X", &[("127.0.0.1".into(), dead)]).await;
        assert_eq!((v["ok"].as_bool(), v["ms"].is_null(), v["tried"].as_u64()), (Some(false), true, Some(1)));
    }
}
