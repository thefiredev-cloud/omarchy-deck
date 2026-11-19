//! Host actions: allowlist, helper.py dispatch (local or over ssh), keys.json, theme, weather.
use crate::util::{ct_eq, ok_int, run};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// helper.py is the remote-side agent; it is embedded so the binary is self-contained.
static HELPER: &[u8] = include_bytes!("../../helper.py");

pub const HOSTS: [&str; 2] = ["pc-desktop", "Dell"];

pub fn valid_host(h: &str) -> bool {
    HOSTS.contains(&h)
}

/// Commerce tab tiles: the Omarchy Amazon web app on its Orders and Returns pages, commerceink.com and the
/// local Commerce Ink operator dashboard. Read-only pages; the deck never orders or changes an account.
pub const LAUNCH: [&str; 14] = [
    "terminal",
    "browser",
    "hermes",
    "files",
    "spotify",
    "obsidian",
    "menu",
    "nightlight",
    "apps",
    "spaces",
    "amazon-orders",
    "amazon-returns",
    "commerce-ink",
    "commerce-ink-dashboard",
];
const MEDIA_ACT: [&str; 3] = ["play-pause", "next", "prev"];

fn allowed(action: &str, arg: &str) -> bool {
    match action {
        "launch" => LAUNCH.contains(&arg),
        "media-act" => MEDIA_ACT.contains(&arg),
        "ws" | "mvws" => matches!(arg, "1" | "2" | "3" | "4" | "5"),
        "mute" | "lock" | "screenshot" => arg.is_empty(),
        // house keys: the arg names an `ha::HA_SCRIPTS` entry, resolved by the server, never sent by the phone
        "ha-script" => crate::ha::script_known(arg),
        "ha-media" => arg == "play-pause",
        _ => false,
    }
}

/// Most keys keys.json may serve. `POST /api/key?v=` indexes this list, so order is stable.
pub const MAX_KEYS: usize = 64;

/// A keys.json group id: short lowercase word, the same charset the page uses as a data attribute.
fn group_id(s: &str) -> Option<String> {
    let ok = !s.is_empty() && s.len() <= 20 && s.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-');
    ok.then(|| s.to_string())
}

pub fn ws_ok(arg: &str) -> bool {
    matches!(arg, "1" | "2" | "3" | "4" | "5")
}

pub fn vol_ok(arg: &str) -> bool {
    ok_int(arg) && arg.parse::<u32>().map(|n| n <= 100).unwrap_or(false)
}

pub fn media_ok(arg: &str) -> bool {
    MEDIA_ACT.contains(&arg)
}

pub struct Hosts {
    cpu: Mutex<HashMap<String, (Vec<u64>, Instant)>>,
    /// The last weather line, when it was read and how long it is kept.
    weather: Mutex<Option<(Instant, Duration, String)>>,
    uid: u32,
}

impl Hosts {
    pub fn new(uid: u32) -> Self {
        Self {
            cpu: Mutex::new(HashMap::new()),
            weather: Mutex::new(None),
            uid,
        }
    }

    /// Run one helper command on a host. Never panics; failure becomes `{"error": ...}`.
    pub async fn call(&self, host: &str, args: &[&str], secs: u64) -> Value {
        let local = host == "pc-desktop";
        if !valid_host(host) {
            return json!({"error": "bad host"});
        }
        let mut argv: Vec<&str> = if local {
            vec!["/usr/bin/python3", "-"]
        } else {
            vec![
                "ssh",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=5",
                "-o",
                "ControlMaster=auto",
                "-o",
                "ControlPath=/tmp/pixel-deck-%C",
                "-o",
                "ControlPersist=60",
                "mesh",
                "python3",
                "-",
            ]
        };
        argv.extend_from_slice(args);
        let env = [("XDG_RUNTIME_DIR", format!("/run/user/{}", self.uid))];
        let fail = if local { "failed" } else { "unreachable" };
        match run(&argv, Some(HELPER), secs, &env).await {
            Ok((_, out)) => out
                .trim()
                .lines()
                .last()
                .and_then(|l| serde_json::from_str::<Value>(l).ok())
                .unwrap_or_else(|| json!({"error": fail})),
            Err(_) => json!({"error": fail}),
        }
    }

    pub async fn stats(&self, host: &str) -> Value {
        let mut r = self.call(host, &["stats"], 10).await;
        let cur: Option<Vec<u64>> = r
            .as_object_mut()
            .and_then(|o| o.remove("_cpu"))
            .and_then(|v| serde_json::from_value(v).ok());
        if let (Some(c), Some(o)) = (cur, r.as_object_mut()) {
            let prev = self
                .cpu
                .lock()
                .ok()
                .and_then(|mut m| m.insert(host.to_string(), (c.clone(), Instant::now())));
            if let Some((p, at)) = prev {
                if at.elapsed().as_secs() < 120 && p.len() == c.len() && c.len() >= 5 {
                    let d: Vec<i64> = c
                        .iter()
                        .zip(&p)
                        .map(|(a, b)| *a as i64 - *b as i64)
                        .collect();
                    let tot: i64 = d.iter().sum();
                    let idle = d[3] + d[4];
                    if tot > 0 {
                        o.insert(
                            "cpu_pct".into(),
                            json!((100.0 * (1.0 - idle as f64 / tot as f64)).round() as i64),
                        );
                    } else {
                        o.insert("cpu_pct".into(), Value::Null);
                    }
                }
            }
        }
        r
    }

    /// The top bar weather line: the Omarchy weather script first (wttr.in, kept 30 minutes), else `fallback`
    /// (Home Assistant's forecast, then Open-Meteo; kept 10 minutes so the script is tried again soon), else
    /// "Weather unavailable".
    pub async fn weather<F, Fut>(&self, fallback: F) -> Value
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Option<String>>,
    {
        self.weather_from(&[WEATHER_SCRIPT], fallback).await
    }

    async fn weather_from<F, Fut>(&self, script: &[&str], fallback: F) -> Value
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Option<String>>,
    {
        if let Ok(g) = self.weather.lock() {
            if let Some((t, keep, v)) = g.as_ref() {
                if t.elapsed() < *keep {
                    return json!({"text": v});
                }
            }
        }
        let said = match run(script, None, 8, &[]).await {
            Ok((0, o)) => Some(o.trim().to_string()).filter(|t| !t.is_empty()),
            _ => None,
        };
        let (text, keep) = match said {
            Some(t) => (t, WEATHER_KEEP),
            None => match fallback().await {
                Some(t) => (t, WEATHER_FALLBACK_KEEP),
                None => return json!({"text": WEATHER_NONE}),
            },
        };
        if let Ok(mut g) = self.weather.lock() {
            *g = Some((Instant::now(), keep, text.clone()));
        }
        json!({"text": text})
    }
}

/// The Omarchy bar's weather script (wttr.in): when it answers, the deck's top bar says what the Omarchy bar says.
const WEATHER_SCRIPT: &str = "/usr/share/omarchy/bin/omarchy-weather-status";
const WEATHER_KEEP: Duration = Duration::from_secs(1800);
const WEATHER_FALLBACK_KEEP: Duration = Duration::from_secs(600);
const WEATHER_NONE: &str = "Weather unavailable";

/// Open-Meteo's keyless forecast API: the last source, for when wttr.in and Home Assistant both fail.
pub const OPEN_METEO: &str = "https://api.open-meteo.com/v1/forecast";

/// The place the Omarchy weather script reports for (`omarchy-weather-location` keeps it in this file): its name,
/// so every fallback line names the same place, and its coordinates for Open-Meteo.
#[derive(Debug, Default, PartialEq)]
pub struct WeatherPlace {
    /// "" when unset or unreadable; at most 40 characters.
    pub name: String,
    /// None unless both are finite and in range.
    pub coords: Option<(f64, f64)>,
}

pub async fn weather_place(home: &Path) -> WeatherPlace {
    let raw = tokio::fs::read(home.join(".local/state/omarchy/settings/weather.json")).await.unwrap_or_default();
    let v = serde_json::from_slice::<Value>(&raw).unwrap_or(Value::Null);
    let name: String = v.get("name").and_then(Value::as_str).unwrap_or("").chars().filter(|c| !c.is_control()).take(40).collect();
    let deg = |k: &str, max: f64| v.get(k).and_then(Value::as_f64).filter(|x| x.is_finite() && x.abs() <= max);
    WeatherPlace {
        name: name.trim().to_string(),
        coords: deg("latitude", 90.0).zip(deg("longitude", 180.0)),
    }
}

/// The weather line from Open-Meteo's current conditions at the place's coordinates, worded like the Omarchy
/// script's: "Huntington Beach  ·  Temp 70°F  ·  Wind 5 mph". `api` is `OPEN_METEO` outside tests. None when the place
/// has no coordinates, Open-Meteo does not answer in 6 s, or it reports no temperature.
pub async fn open_meteo_line(http: &reqwest::Client, api: &str, place: &WeatherPlace) -> Option<String> {
    let (lat, lon) = place.coords?;
    let url = format!(
        "{api}?latitude={lat:.3}&longitude={lon:.3}&current=temperature_2m,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph"
    );
    let r = http.get(url).timeout(Duration::from_secs(6)).send().await.ok()?;
    if !r.status().is_success() {
        return None;
    }
    open_meteo_text(&r.json::<Value>().await.ok()?, &place.name)
}

/// Temperature and wind from an Open-Meteo `current` block (asked for in °F and mph), rounded like wttr.in's.
fn open_meteo_text(v: &Value, place: &str) -> Option<String> {
    let cur = v.get("current")?;
    let num = |k: &str| cur.get(k).and_then(Value::as_f64).filter(|x| x.is_finite()).map(|x| x.round() as i64);
    let mut parts = Vec::with_capacity(3);
    if !place.is_empty() {
        parts.push(place.to_string());
    }
    parts.push(format!("Temp {}\u{b0}F", num("temperature_2m")?));
    if let Some(w) = num("wind_speed_10m") {
        parts.push(format!("Wind {w} mph"));
    }
    Some(parts.join("  \u{b7}  "))
}

// ---- keys.json ----
async fn key_file(base: &Path) -> Option<Value> {
    let raw = tokio::fs::read(base.join("keys.json")).await.ok()?;
    serde_json::from_slice::<Value>(&raw).ok()
}

/// The served key list. Each key keeps its keys.json `group` (a short id, "" when absent or malformed). House
/// scripts that `ha::script_confirm` marks always come back with `confirm` true, whatever the file says.
pub async fn load_keys(base: &Path) -> Vec<Value> {
    let list = match key_file(base).await.and_then(|v| v.get("keys").cloned()) {
        Some(Value::Array(a)) => a,
        _ => return vec![],
    };
    let mut out = vec![];
    for k in list.iter().take(MAX_KEYS) {
        let Some(o) = k.as_object() else { continue };
        let a = o.get("action").and_then(Value::as_str).unwrap_or("");
        let v = match o.get("arg") {
            None | Some(Value::Null) => String::new(),
            Some(Value::String(s)) => s.clone(),
            Some(other) => other.to_string(),
        };
        if !allowed(a, &v) {
            continue;
        }
        let s = |key: &str, n: usize| -> String {
            o.get(key)
                .and_then(Value::as_str)
                .unwrap_or("")
                .chars()
                .take(n)
                .collect()
        };
        let confirm = match o.get("confirm") {
            Some(Value::Bool(b)) => *b,
            Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
            Some(Value::String(s)) => !s.is_empty(),
            _ => false,
        } || (a == "ha-script" && crate::ha::script_confirm(&v));
        let group = o.get("group").and_then(Value::as_str).and_then(group_id).unwrap_or_default();
        out.push(json!({"label": s("label", 14), "icon": s("icon", 6), "action": a, "arg": v, "confirm": confirm, "group": group}));
    }
    out
}

/// keys.json `groups` as `[{id, name}]` in file order, for the page's row headings. Malformed rows are dropped.
pub async fn load_groups(base: &Path) -> Vec<Value> {
    let Some(Value::Array(list)) = key_file(base).await.and_then(|v| v.get("groups").cloned()) else {
        return vec![];
    };
    list.iter()
        .take(16)
        .filter_map(|g| {
            let id = g.get("id").and_then(Value::as_str).and_then(group_id)?;
            let name: String = g.get("name").and_then(Value::as_str).unwrap_or("").chars().take(24).collect();
            Some(json!({"id": id, "name": name}))
        })
        .collect()
}

// ---- theme ----
pub fn parse_theme(text: &str) -> String {
    let mut vars: HashMap<String, String> = HashMap::new();
    for l in text.lines() {
        let l = l.trim_start();
        let key_end = l
            .find(|c: char| !(c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'))
            .unwrap_or(l.len());
        if key_end == 0 {
            continue;
        }
        let rest = l[key_end..].trim_start();
        let Some(rest) = rest.strip_prefix('=') else {
            continue;
        };
        let Some(rest) = rest.trim_start().strip_prefix("\"#") else {
            continue;
        };
        if let Some(h) = rest.get(..6) {
            if h.bytes().all(|c| c.is_ascii_hexdigit()) {
                vars.insert(l[..key_end].to_string(), format!("#{h}"));
            }
        }
    }
    // Light Omarchy themes keep the OLED-dark deck surfaces; dark themes flow their surfaces through.
    if text.lines().any(|l| l.replace(' ', "") == "mode=\"dark\"") {
        for (from, to) in [
            ("background", "bg"),
            ("foreground", "fg"),
            ("lighter_background", "lighter_bg"),
            ("darker_background", "dark_bg"),
        ] {
            if let Some(v) = vars.get(from).cloned() {
                vars.insert(to.to_string(), v);
            }
        }
    }
    let defaults = [
        ("bg", "#111"),
        ("fg", "#ddd"),
        ("accent", "#88a"),
        ("muted", "#555"),
        ("lighter_bg", "#222"),
        ("dark_bg", "#0a0a0a"),
        ("green", "#8c8"),
        ("red", "#c88"),
        ("cyan", "#8cc"),
    ];
    let mut s = String::from(":root{");
    for (k, d) in defaults {
        let v = vars.get(k).map(String::as_str).unwrap_or(d);
        s.push_str(&format!("--{}:{};", k.replace('_', "-"), v));
    }
    s.push('}');
    s
}

pub async fn theme_css(path: &Path) -> String {
    parse_theme(&tokio::fs::read_to_string(path).await.unwrap_or_default())
}

pub fn colors_path(home: &Path) -> PathBuf {
    home.join(".local/state/omarchy/current/theme/colors.toml")
}

/// Token check helper used by auth.
pub fn token_ok(given: &str, token: &str) -> bool {
    !given.is_empty() && ct_eq(given, token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist() {
        assert!(allowed("launch", "terminal") && !allowed("launch", "rm"));
        assert!(allowed("launch", "apps") && allowed("launch", "spaces") && !allowed("launch", "app-grid"));
        assert!(allowed("launch", "amazon-orders") && allowed("launch", "commerce-ink-dashboard") && !allowed("launch", "amazon"));
        assert!(allowed("ws", "5") && !allowed("ws", "6") && !allowed("ws", "12"));
        assert!(allowed("lock", "") && !allowed("lock", "x") && !allowed("bogus", ""));
        assert!(vol_ok("0") && vol_ok("100") && !vol_ok("101") && !vol_ok("a"));
    }

    #[test]
    fn embedded_helper_answers_ws_list_and_the_two_shell_launches() {
        let Ok(h) = std::str::from_utf8(HELPER) else { panic!("helper is not utf-8") };
        assert!(h.contains("if c == \"ws-list\": out(ws_list())"));
        assert!(h.contains("a[1] == \"apps\"") && h.contains("a[1] == \"spaces\""));
    }

    #[test]
    fn every_launch_key_in_keys_json_is_allowed() {
        let raw = include_str!("../../keys.json");
        let Ok(v) = serde_json::from_str::<Value>(raw) else { panic!("keys.json does not parse") };
        let Some(keys) = v["keys"].as_array() else { panic!("keys.json has no keys array") };
        assert!(keys.len() <= MAX_KEYS);
        for k in keys {
            let (a, arg) = (k["action"].as_str().unwrap_or(""), k["arg"].as_str().unwrap_or(""));
            assert!(allowed(a, arg), "keys.json carries {a} {arg}, which the server refuses");
        }
        assert!(keys.iter().any(|k| k["arg"] == "apps") && keys.iter().any(|k| k["arg"] == "spaces"));
    }

    #[test]
    fn house_keys_name_only_allowlisted_scripts_and_carry_their_group() {
        assert!(allowed("ha-script", "stop_all_watering") && allowed("ha-media", "play-pause"));
        assert!(!allowed("ha-script", "water_zone") && !allowed("ha-script", "") && !allowed("ha-media", "off"));
        let raw = include_str!("../../keys.json");
        let Ok(v) = serde_json::from_str::<Value>(raw) else { panic!("keys.json does not parse") };
        let keys = v["keys"].as_array().cloned().unwrap_or_default();
        assert_eq!(keys.len(), 43);
        let groups: Vec<&str> = v["groups"].as_array().into_iter().flatten().filter_map(|g| g["id"].as_str()).collect();
        assert_eq!(groups, ["apps", "media", "workspaces", "window", "system", "tv", "games", "music", "sprinklers", "house"]);
        for k in &keys {
            let g = k["group"].as_str().unwrap_or("");
            assert!(groups.contains(&g), "{k} has group {g}");
            assert!(k["label"].as_str().is_some_and(|l| (1..=14).contains(&l.chars().count())), "{k}");
        }
        // every allowlisted script has exactly one key, and each risky one asks for the second tap in the file too
        for (id, _, confirm) in crate::ha::HA_SCRIPTS {
            let hits: Vec<&Value> = keys.iter().filter(|k| k["action"] == "ha-script" && k["arg"] == id).collect();
            assert_eq!(hits.len(), 1, "{id}");
            assert_eq!(hits[0]["confirm"].as_bool().unwrap_or(false), confirm, "{id}");
        }
        // the older 26 keys keep their indexes: house keys only ever append
        assert!(keys.iter().take(26).all(|k| !k["action"].as_str().unwrap_or("").starts_with("ha-")));
    }

    #[test]
    fn theme_defaults_and_override() {
        let t = parse_theme("accent = \"#112233\"\nbg=\"#abcdef\"\nbad = \"#12\"\n");
        assert!(t.contains("--accent:#112233;") && t.contains("--bg:#abcdef;"));
        assert!(t.contains("--fg:#ddd;") && t.contains("--lighter-bg:#222;"));
    }

    #[test]
    fn dark_theme_flows_surfaces_light_keeps_defaults() {
        let dark = parse_theme("mode = \"dark\"\nbackground = \"#101820\"\nforeground = \"#e0e8f0\"\ngreen = \"#22aa55\"\n");
        assert!(
            dark.contains("--bg:#101820;")
                && dark.contains("--fg:#e0e8f0;")
                && dark.contains("--green:#22aa55;")
        );
        let light =
            parse_theme("mode = \"light\"\nbackground = \"#ffffff\"\nforeground = \"#000000\"\n");
        assert!(light.contains("--bg:#111;") && light.contains("--fg:#ddd;"));
    }

    /// A throwaway base dir holding one keys.json, removed on drop.
    struct KeysDir(PathBuf);

    impl KeysDir {
        fn with(contents: &str) -> Self {
            use std::sync::atomic::{AtomicUsize, Ordering};
            static N: AtomicUsize = AtomicUsize::new(0);
            let dir = std::env::temp_dir().join(format!(
                "pixel-deck-keys-{}-{}",
                std::process::id(),
                N.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = std::fs::create_dir_all(&dir);
            let _ = std::fs::write(dir.join("keys.json"), contents);
            Self(dir)
        }
    }

    impl Drop for KeysDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    async fn load_keys_drops_refused_entries_and_keeps_the_rest_in_order() {
        let d = KeysDir::with(
            r#"{"keys":[
                {"label":"Term","icon":"T","action":"launch","arg":"terminal"},
                {"label":"Bad","action":"launch","arg":"rm -rf"},
                {"label":"Nope","action":"bogus"},
                "not an object",
                {"label":"Lock","action":"lock"},
                {"label":"WS3","action":"ws","arg":3}
            ]}"#,
        );
        let keys = load_keys(&d.0).await;
        let got: Vec<(&str, &str, &str)> = keys
            .iter()
            .map(|k| {
                (
                    k["label"].as_str().unwrap_or("?"),
                    k["action"].as_str().unwrap_or("?"),
                    k["arg"].as_str().unwrap_or("?"),
                )
            })
            .collect();
        // a missing arg is "", a numeric arg becomes its decimal text, so both pass the allowlist
        assert_eq!(
            got,
            vec![("Term", "launch", "terminal"), ("Lock", "lock", ""), ("WS3", "ws", "3")]
        );
    }

    #[tokio::test]
    async fn load_keys_clips_label_and_icon_by_characters_not_bytes() {
        let d = KeysDir::with(
            r#"{"keys":[{"label":"ééééééééééééééééé","icon":"🙂🙂🙂🙂🙂🙂🙂🙂","action":"lock"}]}"#,
        );
        let keys = load_keys(&d.0).await;
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0]["label"].as_str().map(|s| s.chars().count()), Some(14));
        assert_eq!(keys[0]["icon"].as_str().map(|s| s.chars().count()), Some(6));
        // a missing label or icon is an empty string, never null
        let d = KeysDir::with(r#"{"keys":[{"action":"mute"}]}"#);
        let keys = load_keys(&d.0).await;
        assert_eq!((keys[0]["label"].as_str(), keys[0]["icon"].as_str()), (Some(""), Some("")));
    }

    #[tokio::test]
    async fn load_keys_confirm_is_a_real_bool_whatever_shape_the_file_uses() {
        let confirm = |v: &str| {
            format!(r#"{{"keys":[{{"action":"lock","confirm":{v}}}]}}"#)
        };
        for (raw, want) in [
            ("true", true),
            ("false", false),
            ("1", true),
            ("0", false),
            (r#""yes""#, true),
            (r#""""#, false),
            ("null", false),
            ("[]", false),
        ] {
            let d = KeysDir::with(&confirm(raw));
            let keys = load_keys(&d.0).await;
            assert_eq!(keys[0]["confirm"], json!(want), "confirm={raw}");
        }
        let d = KeysDir::with(r#"{"keys":[{"action":"lock"}]}"#);
        assert_eq!(load_keys(&d.0).await[0]["confirm"], json!(false));
        // a risky house script asks for the second tap even when the file forgets it
        let d = KeysDir::with(r#"{"keys":[{"action":"ha-script","arg":"stop_all_watering","confirm":false},{"action":"ha-script","arg":"living_mute"}]}"#);
        let keys = load_keys(&d.0).await;
        assert_eq!((&keys[0]["confirm"], &keys[1]["confirm"]), (&json!(true), &json!(false)));
    }

    #[tokio::test]
    async fn load_keys_never_returns_more_than_max_keys_entries() {
        let rows: Vec<String> = (0..MAX_KEYS + 8).map(|_| r#"{"action":"lock"}"#.to_string()).collect();
        let d = KeysDir::with(&format!(r#"{{"keys":[{}]}}"#, rows.join(",")));
        assert_eq!(load_keys(&d.0).await.len(), MAX_KEYS);
    }

    #[tokio::test]
    async fn groups_come_from_the_file_and_bad_ids_never_reach_the_page() {
        let d = KeysDir::with(
            r#"{"groups":[{"id":"tv","name":"TV"},{"id":"Bad Id","name":"x"},{"name":"no id"},{"id":"house","name":"House status and more words here"}],
               "keys":[{"action":"mute","group":"tv"},{"action":"lock","group":"<b>"},{"action":"lock"}]}"#,
        );
        assert_eq!(
            load_groups(&d.0).await,
            vec![json!({"id":"tv","name":"TV"}), json!({"id":"house","name":"House status and more wo"})]
        );
        let keys = load_keys(&d.0).await;
        let g: Vec<&str> = keys.iter().map(|k| k["group"].as_str().unwrap_or("?")).collect();
        assert_eq!(g, ["tv", "", ""]);
        let d = KeysDir::with("not json");
        assert!(load_groups(&d.0).await.is_empty());
    }

    #[tokio::test]
    async fn load_keys_is_empty_for_missing_broken_or_wrongly_shaped_files() {
        let missing = std::env::temp_dir().join("pixel-deck-keys-does-not-exist");
        assert!(load_keys(&missing).await.is_empty());
        for body in ["", "not json", "[]", r#"{"keys":"lock"}"#, r#"{"keys":{"action":"lock"}}"#, r#"{}"#] {
            let d = KeysDir::with(body);
            assert!(load_keys(&d.0).await.is_empty(), "body={body:?}");
        }
    }

    #[test]
    fn argument_checks_accept_only_the_documented_values() {
        assert!(ws_ok("1") && ws_ok("5") && !ws_ok("0") && !ws_ok("6") && !ws_ok("") && !ws_ok("01"));
        assert!(media_ok("play-pause") && media_ok("next") && media_ok("prev"));
        assert!(!media_ok("") && !media_ok("Next") && !media_ok("stop"));
        // volume: digits only, three characters at most, value at most 100
        assert!(vol_ok("50") && vol_ok("100"));
        assert!(!vol_ok("") && !vol_ok("-1") && !vol_ok("1000") && !vol_ok("999") && !vol_ok("5 "));
        assert!(valid_host("pc-desktop") && valid_host("Dell") && !valid_host("dell") && !valid_host(""));
    }

    #[test]
    fn token_check_refuses_empty_and_near_miss_tokens() {
        assert!(token_ok("s3cret", "s3cret"));
        assert!(!token_ok("", ""), "an empty token must never authenticate");
        assert!(!token_ok("s3cre", "s3cret") && !token_ok("s3cret!", "s3cret") && !token_ok("S3CRET", "s3cret"));
    }

    #[test]
    fn colors_path_points_at_the_current_omarchy_theme() {
        assert_eq!(
            colors_path(Path::new("/home/x")),
            PathBuf::from("/home/x/.local/state/omarchy/current/theme/colors.toml")
        );
    }

    #[tokio::test]
    async fn theme_css_falls_back_to_the_defaults_when_the_file_is_missing() {
        let css = theme_css(Path::new("/nonexistent/pixel-deck/colors.toml")).await;
        assert_eq!(css, parse_theme(""));
        assert!(css.starts_with(":root{") && css.ends_with('}') && css.contains("--bg:#111;"));
    }

    #[tokio::test]
    async fn bad_host_rejected() {
        let h = Hosts::new(1000);
        assert_eq!(h.call("evil", &["x"], 1).await["error"], "bad host");
    }

    #[tokio::test]
    async fn weather_says_what_the_omarchy_script_says_when_it_answers() {
        let h = Hosts::new(1000);
        let asked = std::sync::atomic::AtomicUsize::new(0);
        let house = || async {
            asked.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Some("house".to_string())
        };
        let v = h.weather_from(&["/bin/sh", "-c", "echo 'Huntington beach  \u{b7}  Temp 68\u{b0}F  \u{b7}  Wind 5mph'"], house).await;
        assert_eq!(v["text"], "Huntington beach  \u{b7}  Temp 68\u{b0}F  \u{b7}  Wind 5mph");
        assert_eq!(asked.load(std::sync::atomic::Ordering::SeqCst), 0, "the house forecast is not asked when the script answers");
    }

    #[tokio::test]
    async fn a_silent_weather_script_hands_over_to_the_house_forecast_and_keeps_it() {
        let h = Hosts::new(1000);
        let asked = std::sync::atomic::AtomicUsize::new(0);
        let house = || async {
            asked.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Some("Huntington Beach  \u{b7}  Temp 68\u{b0}F  \u{b7}  Wind 5 mph".to_string())
        };
        let v = h.weather_from(&["/bin/false"], house).await;
        assert_eq!(v["text"], "Huntington Beach  \u{b7}  Temp 68\u{b0}F  \u{b7}  Wind 5 mph");
        // a second read inside the ten minutes is the kept line: neither the script nor the house is asked again
        let again = h.weather_from(&["/bin/false"], house).await;
        assert_eq!(again, v);
        assert_eq!(asked.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert_eq!(h.weather.lock().map(|g| g.as_ref().map(|w| w.1)).ok().flatten(), Some(WEATHER_FALLBACK_KEEP));
    }

    #[tokio::test]
    async fn weather_is_unavailable_only_when_no_source_answers_and_that_is_not_kept() {
        let h = Hosts::new(1000);
        assert_eq!(h.weather_from(&["/bin/false"], || async { None }).await["text"], WEATHER_NONE);
        assert!(h.weather.lock().map(|g| g.is_none()).unwrap_or(false), "a failure is never kept");
        // an empty answer with exit 0 is no answer either
        let v = h.weather_from(&["/bin/true"], || async { Some("Temp 61\u{b0}F".to_string()) }).await;
        assert_eq!(v["text"], "Temp 61\u{b0}F");
    }

    #[tokio::test]
    async fn weather_place_is_the_omarchy_location_name_and_coordinates() {
        let home = std::env::temp_dir().join(format!("pdeck-wxplace-{}", std::process::id()));
        let dir = home.join(".local/state/omarchy/settings");
        assert!(std::fs::create_dir_all(&dir).is_ok());
        assert_eq!(weather_place(&home).await, WeatherPlace::default(), "no file: no place");
        assert!(std::fs::write(dir.join("weather.json"), r#"{"name": " Huntington Beach ", "latitude": 33.4, "longitude": -117.7}"#).is_ok());
        assert_eq!(
            weather_place(&home).await,
            WeatherPlace { name: "Huntington Beach".into(), coords: Some((33.4, -117.7)) }
        );
        assert!(std::fs::write(dir.join("weather.json"), r#"{"name": "X", "latitude": 95, "longitude": -117.7}"#).is_ok());
        assert_eq!(weather_place(&home).await.coords, None, "out of range: no coordinates");
        assert!(std::fs::write(dir.join("weather.json"), "not json").is_ok());
        assert_eq!(weather_place(&home).await, WeatherPlace::default());
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn open_meteo_text_reads_current_temperature_and_wind_and_rounds_them() {
        let v = json!({"current_units": {"temperature_2m": "\u{b0}F", "wind_speed_10m": "mp/h"},
            "current": {"time": "2026-11-02T19:00", "temperature_2m": 70.4, "wind_speed_10m": 4.8}});
        assert_eq!(open_meteo_text(&v, "Huntington Beach").as_deref(), Some("Huntington Beach  \u{b7}  Temp 70\u{b0}F  \u{b7}  Wind 5 mph"));
        assert_eq!(open_meteo_text(&json!({"current": {"temperature_2m": -0.4}}), "").as_deref(), Some("Temp 0\u{b0}F"));
        for bad in [json!({}), json!({"current": {}}), json!({"current": {"temperature_2m": "hot"}}), json!({"error": true})] {
            assert_eq!(open_meteo_text(&bad, "X"), None, "{bad}");
        }
    }

    /// One-request mock HTTP server: answers `status`/`body` and hands back the request head it saw.
    async fn mock_once(status: u16, body: &'static str) -> (String, tokio::task::JoinHandle<String>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let Ok(l) = tokio::net::TcpListener::bind("127.0.0.1:0").await else {
            panic!("cannot bind mock");
        };
        let url = l.local_addr().map(|a| format!("http://{a}/v1/forecast")).unwrap_or_default();
        let task = tokio::spawn(async move {
            let Ok((mut c, _)) = l.accept().await else { return String::new() };
            let mut got = Vec::new();
            let mut buf = [0u8; 2048];
            while !String::from_utf8_lossy(&got).contains("\r\n\r\n") {
                match c.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => got.extend_from_slice(&buf[..n]),
                }
            }
            let reply = format!(
                "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = c.write_all(reply.as_bytes()).await;
            String::from_utf8_lossy(&got).into_owned()
        });
        (url, task)
    }

    #[tokio::test]
    async fn open_meteo_line_is_one_get_at_the_place_coordinates() {
        let http = reqwest::Client::new();
        let place = WeatherPlace { name: "Huntington Beach".into(), coords: Some((33.46697, -117.69811)) };
        let (url, seen) = mock_once(200, r#"{"current": {"temperature_2m": 70.4, "wind_speed_10m": 4.8}}"#).await;
        let line = open_meteo_line(&http, &url, &place).await;
        assert_eq!(line.as_deref(), Some("Huntington Beach  \u{b7}  Temp 70\u{b0}F  \u{b7}  Wind 5 mph"));
        let head = seen.await.unwrap_or_default();
        assert!(
            head.starts_with("GET /v1/forecast?latitude=33.467&longitude=-117.698&current=temperature_2m,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph HTTP/1.1"),
            "{head}"
        );
        let (url, _) = mock_once(500, "{}").await;
        assert_eq!(open_meteo_line(&http, &url, &place).await, None);
        // no coordinates: nothing is asked
        assert_eq!(open_meteo_line(&http, "http://127.0.0.1:9/never", &WeatherPlace::default()).await, None);
    }
}
