//! Read-only, owner-local Fleet widget facts. No network discovery or account calls.
//! Missing sources remain unavailable rather than becoming zero or copied demo values.
use crate::util::{iso_to_epoch, now_epoch};
use serde_json::{json, Value};
use std::path::Path;

fn reading(data: &Value, sensor: &str, label: &str) -> Option<f64> {
    data.get("temps")?.as_array()?.iter().find_map(|v| {
        let row = v.as_array()?;
        (row.first()?.as_str()? == sensor && row.get(1)?.as_str()? == label)
            .then(|| row.get(2)?.as_f64()).flatten()
    })
}

fn hottest(data: &Value, sensor: &str) -> Option<f64> {
    data.get("temps")?.as_array()?.iter().filter_map(|v| {
        let row = v.as_array()?;
        (row.first()?.as_str()? == sensor).then(|| row.get(2)?.as_f64()).flatten()
    }).reduce(f64::max)
}

fn observation(data: Option<&Value>, name: &str) -> Value {
    let Some(data) = data else { return json!({"error":"missing reading","cpu_c":null,"gpu_c":null}); };
    if let Some(error) = data.get("error").and_then(Value::as_str) {
        return json!({"error":error,"cpu_c":null,"gpu_c":null});
    }
    match name {
        // MSI's nct6687 AMD TSI and Thermistor 0 are board readings. The Ryzen CPU
        // control temperature is k10temp Tctl; neither the board maximum nor the
        // NVIDIA GPU temperature should be relabeled as the CPU.
        "pc-desktop" => json!({"cpu_c":reading(data,"k10temp","Tctl"),"cpu_sensor":"k10temp/Tctl",
            "gpu_c":data.pointer("/gpu/temp"),"gpu_util_pct":data.pointer("/gpu/util"),
            "gpu_throttling":data.pointer("/gpu/throttling")}),
        "dell" => json!({"cpu_c":reading(data,"coretemp","Package id 0"),"cpu_sensor":"coretemp/Package id 0",
            "gpu_c":null}),
        "spark" | "ascent" => json!({"soc_c":hottest(data,"acpitz"),"soc_sensor":"acpitz/max zone",
            "gpu_c":data.pointer("/gpu/temp"),"gpu_util_pct":data.pointer("/gpu/util"),
            "gpu_throttling":data.pointer("/gpu/throttling")}),
        "mac-mini" => json!({"cpu_c":data.get("cpu_temp"),"gpu_c":data.get("gpu_temp"),
            "pressure":data.get("pressure"),"cpu_sensor":"macmon/CPU average"}),
        "pixel" => json!({"skin_c":data.get("VIRTUAL-SKIN"),"battery_c":data.get("battery"),
            "thermal_status":data.get("status")}),
        "iphone" => json!({"cpu_c":null,"gpu_c":null,"error":"no temperature sensor probe"}),
        _ => json!({"error":"unknown host"}),
    }
}

fn timestamp(at: &str) -> Option<u64> {
    // fleet-temps uses %z (+hhmm); the shared parser expects +hh:mm.
    let n = at.len();
    if n >= 5 && matches!(at.as_bytes()[n-5], b'+' | b'-') {
        return iso_to_epoch(&format!("{}:{}", &at[..n-2], &at[n-2..]));
    }
    iso_to_epoch(at)
}

pub fn thermal_from(text: &str, now: u64) -> Value {
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return json!({"error":"invalid temperature snapshot","stale":true,"src":"fleet-temps-status.json"});
    };
    let t = v.get("at").and_then(Value::as_str).and_then(timestamp);
    let age = t.map(|t| now.saturating_sub(t));
    let hosts = ["pc-desktop","spark","ascent","dell","mac-mini","pixel","iphone"]
        .into_iter().map(|n| (n.to_string(), observation(v.get("devices").and_then(|d|d.get(n)),n)))
        .collect::<serde_json::Map<_,_>>();
    let findings: Vec<_> = v.get("findings").and_then(Value::as_array).into_iter().flatten()
        .take(30).filter_map(|f| {
            let level = f.get("level")?.as_str()?;
            let (host, detail) = f.get("text")?.as_str()?.split_once(": ")?;
            let metric = detail.split_whitespace().next()?;
            let allowed_host = ["pc-desktop","spark","ascent","dell","mac-mini","pixel","iphone"].contains(&host);
            let allowed_metric = ["CPU","GPU","NVMe","SoC","ConnectX","thermal","temperature"].contains(&metric);
            (allowed_host && allowed_metric && matches!(level,"ok"|"warn"|"crit"))
                .then(|| json!({"host":host,"level":level,"metric":metric}))
        }).collect();
    json!({"src":"~/.local/state/ops/fleet-temps-status.json","t":t,"age":age,
        "stale":age.is_none_or(|a|a>600) || t.is_some_and(|t|t>now.saturating_add(60))
            || !v.get("devices").is_some_and(Value::is_object),
        "worst":v.get("worst").filter(|w|w.as_str().is_some_and(|s|matches!(s,"ok"|"warn"|"crit"))),"hosts":hosts,
        "findings":findings,"threshold_source":"~/ops/bin/fleet-temps.py LIMITS; hardware trip values there are separate from warning levels"})
}

async fn queue_count(path: &Path) -> Value {
    let Ok(mut entries) = tokio::fs::read_dir(path).await else {
        return json!({"files":null,"error":"queue unavailable"});
    };
    let mut files = 0u64;
    loop {
        match entries.next_entry().await {
            Ok(Some(e)) if e.file_name().to_string_lossy().ends_with(".json") => {
                match e.file_type().await {
                    Ok(kind) if kind.is_file() => files += 1,
                    Ok(_) => {},
                    Err(_) => return json!({"files":null,"error":"queue unreadable"}),
                }
            },
            Ok(Some(_)) => {},
            Ok(None) => break,
            Err(_) => return json!({"files":null,"error":"queue unreadable"}),
        }
    }
    json!({"files":files})
}

fn neighbors_from(text: &str) -> Value {
    let count = text.lines().skip(1).filter(|line| {
        let mut fields = line.split_whitespace();
        fields.nth(2) == Some("0x2")
            && fields.next().is_some_and(|mac| mac != "00:00:00:00:00:00")
            && fields.nth(1).is_some()
    }).count();
    json!({"cached_reachable_count":count,"src":"/proc/net/arp","discovery":false,
        "note":"Only resolved IPv4 ARP cache entries, not all network devices"})
}

pub async fn build(home: &Path) -> Value {
    let now = now_epoch();
    let temps = home.join(".local/state/ops/fleet-temps-status.json");
    let thermal = match tokio::fs::read_to_string(&temps).await {
        Ok(text) => thermal_from(&text, now),
        Err(_) => json!({"error":"temperature snapshot unavailable","stale":true,"src":"~/.local/state/ops/fleet-temps-status.json"}),
    };
    let outreach = home.join("Documents/outreach");
    let legacy = queue_count(&outreach.join("queue")).await;
    let quote = queue_count(&outreach.join("quote-followup-2026-10-03/queue")).await;
    let neighbors = match tokio::fs::read_to_string("/proc/net/arp").await {
        Ok(text) => neighbors_from(&text),
        Err(_) => json!({"cached_reachable_count":null,"error":"ARP cache unavailable","discovery":false}),
    };
    let radar = home.join(".config/omarchy/plugins/yuters.flight-radar/manifest.json");
    let radar_installed = tokio::fs::metadata(&radar).await.map(|m| m.is_file()).unwrap_or(false);
    json!({"t":now,"thermal":thermal,
        "outbound":{"src":"~/Documents/outreach/queue and quote-followup-2026-10-03/queue",
            "legacy_queue":legacy,"quote_followup_queue":quote,"drafts":null,"outbound_agents":null,
            "note":"File counts are staged queue records, not approvals, sends, distinct agents, or draft count"},
        "flightradar":{"installed":radar_installed,"live_state_observed":false,
            "src":"~/.config/omarchy/plugins/yuters.flight-radar/manifest.json",
            "note":"Plugin installation is separate from its live OpenSky aircraft state"},
        "neighbors":neighbors})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cpu_uses_k10temp_not_board_thermistor_or_gpu() {
        let data = json!({"temps":[["nct6687","Thermistor 0",95.0],["nct6687","AMD TSI Addr 98h",85.0],
            ["k10temp","Tctl",72.0]],"gpu":{"temp":44.0,"util":35.0}});
        let o = observation(Some(&data),"pc-desktop");
        assert_eq!(o["cpu_c"],72.0);
        assert_eq!(o["gpu_c"],44.0);
    }
    #[test]
    fn timestamp_and_unknowns_do_not_become_zero() {
        assert_eq!(timestamp("2026-10-04T19:18:37-0700"),iso_to_epoch("2026-10-04T19:18:37-07:00"));
        let v = thermal_from("{\"at\":\"2026-10-04T19:18:37-0700\",\"devices\":{\"iphone\":{}}}",u64::MAX);
        assert_eq!(v["stale"].as_bool(), Some(true));
        assert!(v["hosts"]["iphone"]["cpu_c"].is_null());
    }
    #[test]
    fn arp_is_cache_only() {
        let v = neighbors_from("IP address HW type Flags HW address Mask Device\n203.0.113.1 0x1 0x2 aa:bb:cc:dd:ee:ff * eth0\n10.0.0.2 0x1 0x0 00:00:00:00:00:00 * eth0\n");
        assert_eq!(v["cached_reachable_count"],1);
        assert_eq!(v["discovery"],false);
    }

    #[test]
    fn thermal_freshness_checks_age_and_future_clock_skew_boundaries() {
        const AT: u64 = 1_791_072_000;
        let text = r#"{"at":"2026-10-04T00:00:00Z","devices":{}}"#;
        for (now, age, stale) in [
            (AT, 0, false),
            (AT + 600, 600, false),
            (AT + 601, 601, true),
            (AT - 60, 0, false),
            (AT - 61, 0, true),
        ] {
            let v = thermal_from(text, now);
            assert_eq!(v["t"], AT, "now={now}");
            assert_eq!(v["age"], age, "now={now}");
            assert_eq!(v["stale"], stale, "now={now}");
        }
    }

    #[test]
    fn thermal_missing_or_invalid_evidence_never_claims_freshness() {
        const NOW: u64 = 1_791_072_000;
        for text in [
            r#"{"devices":{}}"#,
            r#"{"at":"invalid","devices":{}}"#,
            r#"{"at":"2026-10-04T00:00:00Z"}"#,
            r#"{"at":"2026-10-04T00:00:00Z","devices":[]}"#,
        ] {
            let v = thermal_from(text, NOW);
            assert_eq!(v["stale"], true, "{text}");
            assert_eq!(v["hosts"]["spark"]["error"], "missing reading");
            assert!(v["hosts"]["spark"]["cpu_c"].is_null());
        }
        for text in ["", "not json"] {
            let v = thermal_from(text, NOW);
            assert_eq!(v["error"], "invalid temperature snapshot");
            assert_eq!(v["stale"], true);
        }
    }

    #[test]
    fn thermal_selects_host_specific_sensors_and_skips_malformed_rows() {
        let text = json!({"at":"2026-10-04T00:00:00Z","devices":{
            "spark":{"temps":[null,[],["acpitz","bad","hot"],["coretemp","Package id 0",99.0],
                ["acpitz","zone0",61.0],["acpitz","zone1",73.0]],
                "gpu":{"temp":48.0,"util":35.0,"throttling":false}},
            "ascent":{"temps":[["acpitz","zone0",68.0],["acpitz","zone1",59.0]]},
            "dell":{"temps":[["coretemp","Core 0",92.0],["coretemp","Package id 0",64.0]]},
            "mac-mini":{"cpu_temp":55.0,"gpu_temp":41.0,"pressure":"Nominal"},
            "pixel":{"VIRTUAL-SKIN":32.0,"battery":34.0,"status":1}
        }}).to_string();
        let hosts = thermal_from(&text, 1_791_072_000)["hosts"].clone();
        assert_eq!(hosts["spark"]["soc_c"], 73.0);
        assert_eq!(hosts["spark"]["gpu_c"], 48.0);
        assert_eq!(hosts["spark"]["gpu_util_pct"], 35.0);
        assert_eq!(hosts["spark"]["gpu_throttling"], false);
        assert_eq!(hosts["ascent"]["soc_c"], 68.0);
        assert!(hosts["ascent"]["gpu_c"].is_null());
        assert_eq!(hosts["dell"]["cpu_c"], 64.0);
        assert_eq!(hosts["mac-mini"]["cpu_c"], 55.0);
        assert_eq!(hosts["mac-mini"]["gpu_c"], 41.0);
        assert_eq!(hosts["mac-mini"]["pressure"], "Nominal");
        assert_eq!(hosts["pixel"]["skin_c"], 32.0);
        assert_eq!(hosts["pixel"]["battery_c"], 34.0);
        assert_eq!(hosts["pixel"]["thermal_status"], 1);
    }

    #[test]
    fn thermal_probe_errors_override_leftover_temperature_readings() {
        let text = json!({"devices":{
            "pc-desktop":{"error":"probe failed","temps":[["k10temp","Tctl",72.0]],
                "gpu":{"temp":44.0}},
            "spark":{"error":"host offline","temps":[["acpitz","zone0",65.0]]}
        }}).to_string();
        let hosts = thermal_from(&text, 1_791_072_000)["hosts"].clone();
        for (host, error) in [("pc-desktop", "probe failed"), ("spark", "host offline")] {
            assert_eq!(hosts[host]["error"], error);
            assert!(hosts[host]["cpu_c"].is_null());
            assert!(hosts[host]["gpu_c"].is_null());
            assert!(hosts[host].get("soc_c").is_none());
        }
    }

    #[test]
    fn thermal_findings_only_expose_recognized_host_metric_and_severity() {
        let text = json!({"worst":"crit","findings":[
            {"level":"warn","text":"spark: SoC 88C private detail","extra":"private"},
            {"level":"crit","text":"pc-desktop: CPU 99C"},
            {"level":"ok","text":"dell: NVMe 40C"},
            {"level":"warn","text":"unknown-host: CPU 99C"},
            {"level":"warn","text":"spark: secret detail"},
            {"level":"debug","text":"spark: GPU 48C"},
            {"level":"warn","text":"spark: "},
            {"level":"warn","text":"spark CPU 99C"},
            {"level":"warn","text":null},
            {"text":"spark: GPU 48C"}
        ]}).to_string();
        let v = thermal_from(&text, 1_791_072_000);
        assert_eq!(v["worst"], "crit");
        assert_eq!(v["findings"], json!([
            {"host":"spark","level":"warn","metric":"SoC"},
            {"host":"pc-desktop","level":"crit","metric":"CPU"},
            {"host":"dell","level":"ok","metric":"NVMe"}
        ]));
        let v = thermal_from(r#"{"worst":"unknown"}"#, 1_791_072_000);
        assert!(v["worst"].is_null());
    }

    #[tokio::test]
    async fn queue_counts_only_regular_json_files_not_directories_or_symlinks() -> std::io::Result<()> {
        let root = std::env::temp_dir().join(format!("pdeck-widget-queue-{}", std::process::id()));
        std::fs::create_dir(&root)?;
        std::fs::write(root.join("first.json"), "{}")?;
        std::fs::write(root.join("second.json"), "{}")?;
        std::fs::write(root.join("notes.txt"), "not a queue record")?;
        std::fs::create_dir(root.join("nested.json"))?;
        std::fs::write(root.join("nested.json/third.json"), "{}")?;
        std::os::unix::fs::symlink(root.join("first.json"), root.join("linked.json"))?;
        std::os::unix::fs::symlink(root.join("missing.json"), root.join("broken.json"))?;
        let result = queue_count(&root).await;
        std::fs::remove_dir_all(&root)?;
        assert_eq!(result, json!({"files":2}));
        Ok(())
    }

    #[tokio::test]
    async fn queue_distinguishes_empty_from_missing_or_not_a_directory() -> std::io::Result<()> {
        let root = std::env::temp_dir().join(format!("pdeck-widget-empty-{}", std::process::id()));
        std::fs::create_dir(&root)?;
        std::fs::write(root.join("record.json"), "{}")?;
        let empty = root.join("empty");
        std::fs::create_dir(&empty)?;
        let empty_result = queue_count(&empty).await;
        let missing = queue_count(&root.join("missing")).await;
        let file = queue_count(&root.join("record.json")).await;
        std::fs::remove_dir_all(&root)?;
        assert_eq!(empty_result, json!({"files":0}));
        assert_eq!(missing, json!({"files":null,"error":"queue unavailable"}));
        assert_eq!(file, json!({"files":null,"error":"queue unavailable"}));
        Ok(())
    }
}
