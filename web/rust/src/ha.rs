//! Home Assistant and MediaMTX access. HA URL/token are read once from ~/.hermes/.env and never logged.
//!
//! Tanner-only allowlists (owner order 2026-10-29). Every id below is a house or Tanner device: no `person.*`
//! except `person.mesh`, no `device_tracker.*`, and nothing naming another household member (`OTHER_TENANT`).
//! Each id was confirmed in HA `/api/states` (read only) on 2026-10-29.
use crate::actions;
use crate::util::{iso_to_epoch, log, now_epoch};
use bytes::{Bytes, BytesMut};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

/// Read allowlist for `GET /api/ha`. An allowlisted id HA no longer reports still comes back as a row
/// (`state` "unavailable", `missing` true), so the page can say "Not reported" instead of guessing.
pub const HA_SENSORS: [&str; 20] = [
    "sensor.hp_envy_6400_series_black_cartridge",
    "sensor.hp_envy_6400_series_tri_color_cartridge",
    "media_player.main_bedroom",
    "weather.forecast_home",
    "camera.eufy_cam_1",
    "camera.eufy_cam_2",
    "camera.eufy_cam_3",
    "camera.eufy_cam_4",
    // network and presence
    "binary_sensor.internet_reachable",
    "binary_sensor.router_reachable",
    "person.mesh",
    // Apple Watch link (the strap battery sensor does not exist in HA, so it is not listed)
    "binary_sensor.whoop_local_connected",
    // Nest: the Home "Warmest room" fact reads any sensor.*temperature
    "sensor.nest_thermostat_temperature",
    "sensor.nest_thermostat_humidity",
    // Rain Bird ARC
    "binary_sensor.arc_4b3c_connected",
    "binary_sensor.arc_4b3c_any_zone_running",
    "binary_sensor.arc_4b3c_forecast_rain_delay",
    // TVs and music
    "media_player.living_room_samsung_tv",
    "media_player.bedroom_tv",
    "sensor.music_glance",
];

/// Words that name another household member. No allowlisted id may contain one, and a row whose HA friendly
/// name contains one is dropped at read time (it then reads as missing).
pub const OTHER_TENANT: [&str; 3] = ["morgan", "quill", "loto"];

pub fn other_tenant(s: &str) -> bool {
    let s = s.to_ascii_lowercase();
    OTHER_TENANT.iter().any(|w| s.contains(w))
}

/// House scripts a deck key may run: (script id, fixed `variables` JSON or "", second tap required). The phone
/// sends a `keys.json` index only; HA ids and variables never come from the client. Bounded actions only:
/// `water_zone` (free zone and minutes) and `tv_app_launch` (free app) are deliberately absent, and Rain Bird is
/// limited to stop, a 2-day delay and clearing the delay. TV power and every sprinkler key need a
/// second tap whatever keys.json says.
pub const HA_SCRIPTS: [(&str, &str, bool); 13] = [
    ("living_tv_power", "", true),
    ("living_volume_up", "", false),
    ("living_volume_down", "", false),
    ("living_mute", "", false),
    ("living_home", "", false),
    ("living_back", "", false),
    ("tv_volume_up", "", false),
    ("tv_volume_down", "", false),
    // the house speaker (media_player.pyleusa) is off (D12); the Bedroom HomePod is a live target the script accepts
    ("house_music_play_on", r#"{"target":"media_player.main_bedroom_2"}"#, false),
    ("stop_all_watering", "", true),
    ("rain_delay_2_days", "", true),
    ("clear_rain_delay", "", true),
    ("house_status_to_phone", "", false),
];

fn script(id: &str) -> Option<&'static (&'static str, &'static str, bool)> {
    HA_SCRIPTS.iter().find(|(s, _, _)| *s == id)
}

pub fn script_known(id: &str) -> bool {
    script(id).is_some()
}

/// True when the script needs the second tap, whatever keys.json says.
pub fn script_confirm(id: &str) -> bool {
    script(id).is_some_and(|s| s.2)
}

/// `script.turn_on` body for an allowlisted script. None for anything else.
pub fn script_body(id: &str) -> Option<Value> {
    let (sid, vars, _) = script(id)?;
    let mut b = json!({"entity_id": format!("script.{sid}")});
    if !vars.is_empty() {
        b["variables"] = serde_json::from_str(vars).ok()?;
    }
    Some(b)
}

// ---- Home page house tiles: one grouped read and a few bounded controls (owner only) ----
// `GET /api/ha?view=house` and `POST /api/ha?act=..&e=..&v=..`. Both ride the existing `ha` route, whose guest
// verdict is already "refused" in guest.rs, so a guest never reaches either one.

/// Media players a house tile may play/pause. The house speaker (`pyleusa`) is off and the MacBook Air is not Tanner's.
pub const HOUSE_MEDIA: [&str; 5] = [
    "media_player.main_bedroom",
    "media_player.main_bedroom_2",
    "media_player.bedroom_tv",
    "media_player.fire_tv",
    "media_player.samsung_tu7000_65_tv",
];
/// A thermostat set point is clamped into this range (degrees F). Nothing outside it is ever sent.
pub const CLIMATE_MIN_F: f64 = 60.0;
pub const CLIMATE_MAX_F: f64 = 80.0;
const HOUSE_TTL_SECS: u64 = 10;

/// What one allowed control sends: the service path, its body and whether the entity must be one the last
/// house read reported (lights, scenes, climate), or is on a fixed list (media).
#[derive(Debug, PartialEq)]
pub struct HousePlan {
    pub service: &'static str,
    pub body: Value,
    pub dynamic: bool,
}

fn entity_shape_ok(e: &str, domain: &str) -> bool {
    let Some(tail) = e.strip_prefix(domain).and_then(|r| r.strip_prefix('.')) else {
        return false;
    };
    !tail.is_empty()
        && e.len() <= 80
        && tail.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
        && !other_tenant(e)
}

/// The only service calls the house tiles can make. Everything else (locks, alarms, covers, garage doors, vacuum,
/// scripts, arbitrary services) is refused here, before anything reaches Home Assistant.
pub fn house_plan(act: &str, entity: &str, v: &str) -> Result<HousePlan, &'static str> {
    let (service, domain) = match act {
        "light_on" => ("light/turn_on", "light"),
        "light_off" => ("light/turn_off", "light"),
        "light_toggle" => ("light/toggle", "light"),
        "scene_on" => ("scene/turn_on", "scene"),
        "media_pp" => ("media_player/media_play_pause", "media_player"),
        "climate_set" => ("climate/set_temperature", "climate"),
        _ => return Err("not allowed"),
    };
    if !entity_shape_ok(entity, domain) {
        return Err("unknown entity");
    }
    if domain == "media_player" && !HOUSE_MEDIA.contains(&entity) {
        return Err("unknown entity");
    }
    let mut body = json!({"entity_id": entity});
    if domain == "climate" {
        let t: f64 = v.trim().parse().map_err(|_| "bad temperature")?;
        if !t.is_finite() {
            return Err("bad temperature");
        }
        body["temperature"] = json!(((t.clamp(CLIMATE_MIN_F, CLIMATE_MAX_F)) * 2.0).round() / 2.0);
    }
    Ok(HousePlan { service, body, dynamic: domain != "media_player" })
}

/// State text, or None for absent, empty, `unavailable` and `unknown`. Never a zero in disguise.
fn live(s: &str) -> Option<&str> {
    let s = s.trim();
    (!s.is_empty() && s != "unavailable" && s != "unknown").then_some(s)
}

fn clip(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// 26.3333 -> "26.3", 65.0 -> "65"; text passes through.
fn nice(s: &str) -> String {
    match s.parse::<f64>() {
        Ok(f) if f.is_finite() => {
            if (f - f.round()).abs() < 0.05 {
                format!("{}", f.round() as i64)
            } else {
                format!("{f:.1}")
            }
        }
        _ => clip(s, 60),
    }
}

/// Index of one /api/states answer. Entities naming another household member (id or friendly name) never enter.
struct Idx<'a>(HashMap<&'a str, &'a Value>);

impl<'a> Idx<'a> {
    fn new(all: &'a [Value]) -> Self {
        let mut m = HashMap::new();
        for e in all {
            let Some(id) = e.get("entity_id").and_then(Value::as_str) else { continue };
            let name = e.pointer("/attributes/friendly_name").and_then(Value::as_str).unwrap_or("");
            if other_tenant(id) || other_tenant(name) {
                continue;
            }
            m.insert(id, e);
        }
        Idx(m)
    }
    fn st(&self, id: &str) -> Option<String> {
        live(self.0.get(id)?.get("state")?.as_str()?).map(str::to_string)
    }
    fn attr(&self, id: &str, k: &str) -> Option<String> {
        let v = self.0.get(id)?.pointer(&format!("/attributes/{k}"))?;
        match v {
            Value::String(s) => live(s).map(str::to_string),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        }
    }
    fn upd(&self, id: &str) -> Option<u64> {
        iso_to_epoch(self.0.get(id)?.get("last_updated")?.as_str()?)
    }
    fn changed(&self, id: &str) -> Option<u64> {
        iso_to_epoch(self.0.get(id)?.get("last_changed")?.as_str()?)
    }
    fn name(&self, id: &str) -> String {
        self.0
            .get(id)
            .and_then(|e| e.pointer("/attributes/friendly_name"))
            .and_then(Value::as_str)
            .map(|s| clip(s, 40))
            .unwrap_or_else(|| clip(id.split_once('.').map_or(id, |x| x.1), 40))
    }
    fn ids(&self, prefix: &str) -> Vec<&'a str> {
        let mut v: Vec<&str> = self.0.keys().copied().filter(|k| k.starts_with(prefix)).collect();
        v.sort_unstable();
        v
    }
}

/// One fact row: label, value (null reads "--"), age source (`u`, last update), optional note and event time `at`.
fn row(k: &str, v: Option<String>, u: Option<u64>) -> Value {
    json!({"k": k, "v": v, "u": u})
}

fn row_note(mut r: Value, note: Option<String>) -> Value {
    r["n"] = json!(note);
    r
}

fn row_at(mut r: Value, at: Option<u64>) -> Value {
    r["at"] = json!(at);
    r
}

fn with_unit(v: Option<String>, unit: &str) -> Option<String> {
    v.map(|s| if unit.is_empty() { nice(&s) } else { format!("{} {unit}", nice(&s)) })
}

/// Dollars per kWh as cents, one decimal.
fn cents(s: &str) -> Option<String> {
    let f: f64 = s.parse().ok().filter(|f: &f64| f.is_finite() && *f >= 0.0)?;
    Some(format!("{:.1} \u{a2}/kWh", f * 100.0))
}

/// The grouped, compact house read plus the ids a control may name. Pure: tests feed it a states array.
pub fn build_house(all: &[Value], now: u64) -> (Value, HashSet<String>) {
    let ix = Idx::new(all);
    let mut ctl: HashSet<String> = HashSet::new();
    let unit = ix.attr("weather.forecast_home", "temperature_unit").unwrap_or_default();

    // weather and sun
    let sun = |k: &str| {
        ix.attr("sun.sun", k)
            .and_then(|s| iso_to_epoch(&s))
    };
    let weather = vec![
        row("Outside", with_unit(ix.st("sensor.outside_temperature"), &ix.attr("sensor.outside_temperature", "unit_of_measurement").unwrap_or_default()), ix.upd("sensor.outside_temperature")),
        row("Sky", ix.st("sensor.weather_now").or_else(|| ix.st("weather.forecast_home")).map(|s| clip(&s.replace('-', " "), 40)), ix.upd("weather.forecast_home")),
        row("Humidity", with_unit(ix.attr("weather.forecast_home", "humidity"), "%"), ix.upd("weather.forecast_home")),
        row("Wind", with_unit(ix.attr("weather.forecast_home", "wind_speed"), &ix.attr("weather.forecast_home", "wind_speed_unit").unwrap_or_default()), ix.upd("weather.forecast_home")),
        row_at(row("Sunrise", None, ix.upd("sun.sun")), sun("next_rising")),
        row_at(row("Sunset", None, ix.upd("sun.sun")), sun("next_setting")),
    ];

    // energy: the SDG&E price and period; a real power meter only if HA has one
    let mut energy = vec![
        row("Price now", ix.st("sensor.electricity_price_now").as_deref().and_then(cents), ix.upd("sensor.electricity_price_now")),
        row("Rate period", ix.st("sensor.electricity_rate_period").map(|s| clip(&s, 30)), ix.upd("sensor.electricity_rate_period")),
        row("With credit", ix.attr("sensor.electricity_price_now", "with_baseline_credit").as_deref().and_then(cents), ix.upd("sensor.electricity_price_now")),
    ];
    for id in ix.ids("sensor.") {
        if ix.attr(id, "device_class").as_deref() == Some("power") {
            if let Some(p) = ix.st(id) {
                let u = ix.attr(id, "unit_of_measurement").unwrap_or_default();
                energy.push(row("Power now", with_unit(Some(p), &u), ix.upd(id)));
                break;
            }
        }
    }

    // Rain Bird irrigation: status first, then one row per valve (read only; the sprinkler keys stay scripts)
    let arc_rows = |id: &str, label: &str, f: &dyn Fn(String) -> String| row(label, ix.st(id).map(f), ix.upd(id));
    let mut irrigation = vec![
        arc_rows("binary_sensor.arc_4b3c_connected", "Controller", &|s| if s == "on" { "Online".into() } else { "Offline".into() }),
        row("Now", ix.st("sensor.sprinkler_zone_watering").map(|s| clip(&s, 40)), ix.upd("sensor.sprinkler_zone_watering")),
        arc_rows("sensor.arc_4b3c_rain_delay", "Rain delay", &|s| if nice(&s) == "0" { "None".into() } else { format!("{} days", nice(&s)) }),
        row(
            "Alarms",
            ix.st("sensor.arc_4b3c_alarms").map(|a| format!("{} alarms, {} warnings", nice(&a), ix.st("sensor.arc_4b3c_warnings").map_or("--".into(), |w| nice(&w)))),
            ix.upd("sensor.arc_4b3c_alarms"),
        ),
    ];
    let mut valves = 0;
    for id in ix.ids("sensor.arc_4b3c_valve_") {
        let n = ix.name(id);
        irrigation.push(row(&clip(n.trim_start_matches("ARC 4B3C "), 40), ix.st(id).map(|s| clip(&s, 20)), ix.upd(id)));
        valves += 1;
    }

    // climate: HA thermostats (set point is controllable only when HA reports degrees F) and the inside readings
    let set_ok = unit == "\u{b0}F";
    let mut climate = vec![];
    for id in ix.ids("climate.") {
        if set_ok {
            ctl.insert(id.to_string());
        }
        climate.push(json!({
            "id": id, "name": ix.name(id), "mode": ix.st(id),
            "cur": ix.attr(id, "current_temperature").map(|s| nice(&s)),
            "target": ix.attr(id, "temperature").map(|s| nice(&s)),
            "action": ix.attr(id, "hvac_action"), "u": ix.upd(id),
        }));
    }
    let inside = vec![
        row("Inside", with_unit(ix.st("sensor.inside_temperature").or_else(|| ix.st("sensor.nest_thermostat_temperature")), &unit), ix.upd("sensor.inside_temperature")),
        row("Inside humidity", with_unit(ix.st("sensor.inside_humidity").or_else(|| ix.st("sensor.nest_thermostat_humidity")), "%"), ix.upd("sensor.inside_humidity")),
        row("Heating and cooling", ix.st("sensor.heating_and_cooling").map(|s| clip(&s, 30)), ix.upd("sensor.heating_and_cooling")),
    ];

    // lights and scenes
    let mut lights = vec![];
    for id in ix.ids("light.") {
        ctl.insert(id.to_string());
        lights.push(json!({"id": id, "name": ix.name(id), "on": ix.st(id).map(|s| s == "on"), "u": ix.upd(id)}));
    }
    let mut scenes = vec![];
    for id in ix.ids("scene.") {
        ctl.insert(id.to_string());
        scenes.push(json!({"id": id, "name": ix.name(id), "u": ix.upd(id)}));
    }

    // media: only the allowlisted players HA reports
    let mut media = vec![];
    for id in HOUSE_MEDIA {
        if !ix.0.contains_key(id) {
            continue;
        }
        let title = ix.attr(id, "media_title");
        let now_playing = title.map(|t| match ix.attr(id, "media_artist") {
            Some(a) => clip(&format!("{t} - {a}"), 60),
            None => clip(&t, 60),
        });
        media.push(json!({"id": id, "name": ix.name(id), "state": ix.st(id), "now": now_playing, "u": ix.upd(id)}));
    }

    // doors, locks, covers: read only. The car lock is Tanner's own Tesla.
    let mut doors = vec![];
    for id in ix.ids("lock.") {
        doors.push(row(&ix.name(id), ix.st(id).map(|s| clip(&s, 20)), ix.upd(id)));
    }
    for id in ix.ids("cover.") {
        doors.push(row(&ix.name(id), ix.st(id).map(|s| clip(&s, 20)), ix.upd(id)));
    }
    for id in ix.ids("binary_sensor.") {
        if matches!(ix.attr(id, "device_class").as_deref(), Some("door" | "garage_door" | "window" | "opening")) {
            doors.push(row(&ix.name(id), ix.st(id).map(|s| if s == "on" { "Open".into() } else { "Closed".into() }), ix.upd(id)));
        }
    }
    doors.push(row_note(
        row("Tesla", ix.st("sensor.tanner_tesla_lock").map(|s| clip(&s, 20)), ix.upd("sensor.tanner_tesla_lock")),
        ix.st("sensor.tanner_tesla_freshness").map(|s| clip(&s, 50)),
    ));

    // robot vacuum
    let mut vacuum = vec![];
    for id in ix.ids("vacuum.") {
        vacuum.push(row_note(
            row(&ix.name(id), ix.st(id).map(|s| clip(&s, 20)), ix.upd(id)),
            ix.attr(id, "battery_level").map(|b| format!("battery {}%", nice(&b))),
        ));
    }

    // presence: Tanner only (person.mesh). No other person or tracker entity is read.
    let presence = vec![row_at(
        row(
            "Tanner",
            ix.st("person.mesh").map(|s| match s.as_str() {
                "home" => "Home".to_string(),
                "not_home" => "Away".to_string(),
                other => clip(other, 20),
            }),
            ix.upd("person.mesh"),
        ),
        ix.changed("person.mesh"),
    )];

    // HA's own alerts and what the automations did last
    let autos = ix.ids("automation.");
    let on = autos.iter().filter(|a| ix.st(a).as_deref() == Some("on")).count();
    let mut fired: Vec<(u64, &str)> = autos
        .iter()
        .filter_map(|a| Some((iso_to_epoch(&ix.attr(a, "last_triggered")?)?, *a)))
        .collect();
    fired.sort_unstable_by(|a, b| b.cmp(a));
    let mut alerts = vec![
        row("Notifications", Some(ix.ids("persistent_notification.").len().to_string()), Some(now)),
        row("Updates ready", Some(ix.ids("update.").iter().filter(|u| ix.st(u).as_deref() == Some("on")).count().to_string()), Some(now)),
        row("Automations on", (!autos.is_empty()).then(|| format!("{on} of {}", autos.len())), Some(now)),
    ];
    for (t, id) in fired.iter().take(4) {
        alerts.push(row_at(row(&format!("Fired: {}", ix.name(id)), None, ix.upd(id)), Some(*t)));
    }

    // upkeep: filter, backup, network, dog, trash
    let upkeep = vec![
        row_note(
            row("HVAC filter", ix.st("sensor.hvac_filter_days_left").map(|d| format!("{} d left", nice(&d))), ix.upd("sensor.hvac_filter_days_left")),
            ix.st("sensor.hvac_filter_percent").map(|p| format!("{}% used", nice(&p))),
        ),
        row_at(
            row_note(row("Backup", None, ix.upd("sensor.backup_last_successful_automatic_backup")), ix.st("sensor.backup_backup_manager_state").map(|s| clip(&s, 20))),
            ix.st("sensor.backup_last_successful_automatic_backup").and_then(|s| iso_to_epoch(&s)),
        ),
        row_note(
            row("Internet", ix.st("sensor.internet").map(|s| clip(&s, 20)), ix.upd("sensor.internet")),
            ix.st("sensor.internet_delay").map(|d| format!("{} ms", nice(&d))),
        ),
        row("Wi-Fi devices", with_unit(ix.st("sensor.devices_on_wi_fi"), ""), ix.upd("sensor.devices_on_wi_fi")),
        row("Dog", ix.st("sensor.dog_food").map(|s| clip(&s, 30)), ix.upd("sensor.dog_food")),
        row("Trash", ix.st("sensor.home_ai_trash_next").map(|s| clip(&s, 30)), ix.upd("sensor.home_ai_trash_next")),
    ];

    // commute and tolls
    let commute = vec![
        row("Irvine via 73", with_unit(ix.st("sensor.waze_commute_irvine_via_73"), "min"), ix.upd("sensor.waze_commute_irvine_via_73")),
        row("Irvine via 405", with_unit(ix.st("sensor.waze_commute_irvine_via_i_5_405"), "min"), ix.upd("sensor.waze_commute_irvine_via_i_5_405")),
        row("San Diego via I-5", with_unit(ix.st("sensor.waze_commute_san_diego_via_i_5"), "min"), ix.upd("sensor.waze_commute_san_diego_via_i_5")),
        row("SR-73 toll north", ix.st("sensor.toll_sr_73_northbound_now").map(|d| format!("${}", nice(&d))), ix.upd("sensor.toll_sr_73_northbound_now")),
    ];

    let n = |rows: &[Value]| rows.iter().filter(|r| !r["v"].is_null() || !r["at"].is_null()).count();
    let counts = json!({
        "weather": n(&weather), "energy": n(&energy), "irrigation": n(&irrigation), "irrigation_valves": valves,
        "climate": climate.len(), "inside": n(&inside), "lights": lights.len(), "scenes": scenes.len(),
        "media": media.len(), "doors": n(&doors), "vacuum": vacuum.len(), "presence": n(&presence),
        "alerts": n(&alerts), "upkeep": n(&upkeep), "commute": n(&commute),
    });
    let v = json!({
        "t": now, "src": "Home Assistant", "unit": unit, "set_ok": set_ok,
        "groups": {
            "weather": weather, "energy": energy, "irrigation": irrigation,
            "climate": {"devices": climate, "rows": inside, "min": CLIMATE_MIN_F, "max": CLIMATE_MAX_F},
            "lights": {"lights": lights, "scenes": scenes},
            "media": media, "doors": doors, "vacuum": vacuum, "presence": presence,
            "alerts": alerts, "upkeep": upkeep, "commute": commute,
        },
        "counts": counts,
    });
    (v, ctl)
}
pub const HA_CAMS: [&str; 4] = [
    "camera.eufy_cam_1",
    "camera.eufy_cam_2",
    "camera.eufy_cam_3",
    "camera.eufy_cam_4",
];
pub const MTX_PATHS: [&str; 4] = ["eufy_cam1", "eufy_cam2", "eufy_cam3", "eufy_cam4"];
const MTX_API: &str = "http://127.0.0.1:9997";
const MTX_HLS: &str = "http://127.0.0.1:8888";

pub fn parse_env(text: &str) -> (String, String) {
    let (mut u, mut t) = (String::new(), String::new());
    for l in text.lines() {
        let l = l.trim();
        let strip = |v: &str| v.trim().trim_matches(|c| c == '"' || c == '\'').to_string();
        if let Some(v) = l.strip_prefix("HASS_URL=") {
            u = strip(v).trim_end_matches('/').to_string();
        } else if let Some(v) = l.strip_prefix("HASS_TOKEN=") {
            t = strip(v);
        }
    }
    (u, t)
}

/// `Ha::weather_line` wording from one Home Assistant weather state: the place, then the temperature and the wind
/// rounded to whole numbers like the Omarchy script's line. Only those attributes are read; the entity's own name
/// (a street address) never is. None when the state is unavailable or has no temperature.
fn weather_text(v: &Value, place: &str) -> Option<String> {
    if matches!(v.get("state").and_then(Value::as_str), None | Some("" | "unavailable" | "unknown")) {
        return None;
    }
    let a = v.get("attributes")?;
    let num = |k: &str| a.get(k).and_then(Value::as_f64).filter(|x| x.is_finite()).map(|x| x.round() as i64);
    let unit = |k: &str| -> String {
        a.get(k).and_then(Value::as_str).unwrap_or("").chars().filter(|c| !c.is_control()).take(8).collect()
    };
    let mut parts = Vec::with_capacity(3);
    if !place.is_empty() {
        parts.push(place.to_string());
    }
    parts.push(format!("Temp {}{}", num("temperature")?, unit("temperature_unit")));
    if let Some(w) = num("wind_speed") {
        parts.push(format!("Wind {w} {}", unit("wind_speed_unit")).trim_end().to_string());
    }
    Some(parts.join("  \u{b7}  "))
}

type CamEntry = (Instant, (u16, Bytes, String));

const MAX_CAM_MEDIA_BYTES: usize = 8_000_000;

/// The Content-Type a camera answer may carry on the deck origin (X5): `image/*` (never SVG, which can run script),
/// `video/*`, `audio/*` (an HLS audio rendition's segments) or an HLS playlist type, as its bare lower-case essence.
/// Anything else, a missing or malformed type included, is `application/octet-stream`, so an HTML or script answer
/// from Home Assistant or MediaMTX never opens as a deck page.
pub fn cam_type(upstream: Option<&str>) -> String {
    const PLAYLIST: [&str; 4] = ["application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl", "audio/x-mpegurl"];
    let essence = upstream.and_then(|v| v.split(';').next()).map(|v| v.trim().to_ascii_lowercase()).unwrap_or_default();
    let media = match essence.split_once('/') {
        Some(("image" | "video" | "audio", sub)) => {
            (1..=64).contains(&sub.len())
                && sub.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"+-.".contains(&b))
                && !sub.contains("svg")
        }
        _ => false,
    };
    if media || PLAYLIST.contains(&essence.as_str()) {
        essence
    } else {
        "application/octet-stream".into()
    }
}

/// Reject oversized bodies before buffering them, including chunked replies without a length.
async fn bounded_media(
    mut response: reqwest::Response,
    limit: usize,
) -> Result<Bytes, &'static str> {
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err("too large");
    }
    let mut body = BytesMut::with_capacity(response.content_length().unwrap_or(0) as usize);
    while let Some(chunk) = response.chunk().await.map_err(|_| "bad upstream")? {
        if chunk.len() > limit - body.len() {
            return Err("too large");
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body.freeze())
}

type HouseRead = (Instant, Value, HashSet<String>);

#[derive(Default)]
struct HouseState {
    sum: Mutex<Option<HouseRead>>,
    hist: Mutex<VecDeque<Instant>>,
}

pub struct Ha {
    url: String,
    token: String,
    http: reqwest::Client,
    states: Mutex<Option<(Instant, Value)>>,
    cams: Mutex<HashMap<String, CamEntry>>,
    /// One gate per entity: callers for the same camera queue behind a single in-flight fetch,
    /// other cameras are never blocked. Never held together with the `cams` map lock.
    gates: std::sync::Mutex<HashMap<String, std::sync::Arc<Mutex<()>>>>,
    mtx: Mutex<Option<(Instant, Value)>>,
    /// House script calls in the last minute (2 s apart, 20 a minute).
    house_hist: Mutex<VecDeque<Instant>>,
    /// House tiles: the cached grouped read (with the control ids it reported) and the control rate history.
    hx: HouseState,
}

impl Ha {
    pub fn load(home: &Path, http: reqwest::Client) -> Self {
        let (url, token) =
            parse_env(&std::fs::read_to_string(home.join(".hermes/.env")).unwrap_or_default());
        if url.is_empty() || token.is_empty() {
            log("warn", "home assistant not configured", &[]);
        }
        Self {
            url,
            token,
            http,
            states: Mutex::new(None),
            cams: Mutex::new(HashMap::new()),
            gates: std::sync::Mutex::new(HashMap::new()),
            mtx: Mutex::new(None),
            house_hist: Mutex::new(VecDeque::new()),
            hx: HouseState::default(),
        }
    }

    fn req(
        &self,
        method: reqwest::Method,
        path: &str,
        secs: u64,
    ) -> Result<reqwest::RequestBuilder, String> {
        if self.url.is_empty() || self.token.is_empty() {
            return Err("ha not configured".into());
        }
        Ok(self
            .http
            .request(method, format!("{}{}", self.url, path))
            .bearer_auth(&self.token)
            .timeout(Duration::from_secs(secs)))
    }

    /// Cached 10 s. Shape: {"entities": {id: {state, unit, name, updated}}} or {"error", "entities": {}}.
    pub async fn states(&self) -> Value {
        let mut g = self.states.lock().await;
        if let Some((t, v)) = g.as_ref() {
            if t.elapsed().as_secs() < 10 {
                return v.clone();
            }
        }
        let v = match self.fetch_states().await {
            Ok(v) => v,
            Err(e) => {
                log("warn", "ha states failed", &[("err", e)]);
                json!({"error": "ha unreachable", "entities": {}})
            }
        };
        *g = Some((Instant::now(), v.clone()));
        v
    }

    /// The top bar weather line from `weather.forecast_home` (allowlisted above), worded like the Omarchy weather
    /// script: "Huntington Beach  ·  Temp 68°F  ·  Wind 5 mph". The deck uses it when wttr.in, the script's source, does
    /// not answer. None when Home Assistant is not configured, does not answer, or reports no temperature.
    pub async fn weather_line(&self, place: &str) -> Option<String> {
        let r = self.req(reqwest::Method::GET, "/api/states/weather.forecast_home", 6).ok()?.send().await.ok()?;
        if !r.status().is_success() {
            return None;
        }
        weather_text(&r.json::<Value>().await.ok()?, place)
    }

    async fn fetch_states(&self) -> Result<Value, String> {
        let r = self
            .req(reqwest::Method::GET, "/api/states", 8)?
            .send()
            .await
            .map_err(|e| e.without_url().to_string())?;
        if !r.status().is_success() {
            return Err(format!("status {}", r.status().as_u16()));
        }
        let arr: Vec<Value> = r.json().await.map_err(|e| e.without_url().to_string())?;
        let mut out = serde_json::Map::new();
        for e in arr {
            let Some(id) = e.get("entity_id").and_then(Value::as_str) else {
                continue;
            };
            if !HA_SENSORS.contains(&id) {
                continue;
            }
            let a = e.get("attributes");
            let s = |k: &str| {
                a.and_then(|a| a.get(k))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string()
            };
            if other_tenant(&s("friendly_name")) {
                continue;
            }
            let updated = e.get("last_updated").and_then(Value::as_str).unwrap_or("");
            out.insert(
                id.to_string(),
                json!({
                    "state": e.get("state").and_then(Value::as_str).unwrap_or(""),
                    "unit": s("unit_of_measurement"),
                    "name": s("friendly_name"),
                    "updated": iso_to_epoch(updated),
                }),
            );
        }
        for id in HA_SENSORS {
            if !out.contains_key(id) {
                out.insert(
                    id.to_string(),
                    json!({"state": "unavailable", "unit": "", "name": "", "updated": null, "missing": true}),
                );
            }
        }
        Ok(json!({"entities": out}))
    }

    /// `script.turn_on` for one allowlisted house script. 400 for anything else, 502 when HA refuses or is
    /// down. HA's reply text never reaches the phone.
    pub async fn run_script(&self, id: &str) -> (u16, Value) {
        let Some(body) = script_body(id) else {
            return (400, json!({"ok": false, "error": "not allowed"}));
        };
        let r = self
            .req(reqwest::Method::POST, "/api/services/script/turn_on", 8)
            .map(|b| b.json(&body));
        match r {
            Ok(b) => match b.send().await {
                Ok(x) if x.status().is_success() => (200, json!({"ok": true, "script": id})),
                _ => (502, json!({"ok": false, "error": "ha failed"})),
            },
            Err(_) => (502, json!({"ok": false, "error": "ha failed"})),
        }
    }

    /// A house key press: allowlist, rate limit (2 s apart, 20 a minute), the HA call, then one line in
    /// `~/.local/state/pixel-deck/actions.jsonl` for every press, refused ones included.
    pub async fn house(&self, home: &Path, id: &str) -> (u16, Value) {
        let t = now_epoch();
        let result = if !script_known(id) {
            (400, json!({"ok": false, "error": "not allowed"}))
        } else {
            let gate = actions::rate(&mut *self.house_hist.lock().await, Duration::from_secs(2), 20);
            match gate {
                Err(wait) => actions::limited(wait),
                Ok(()) => self.run_script(id).await,
            }
        };
        let mut audit = json!({
            "t": t,
            "act": "ha-script",
            "id": if script_known(id) { id } else { "bad" },
            "ok": result.0 == 200,
        });
        if result.0 != 200 {
            audit["error"] = result.1["error"].clone();
        }
        if actions::append(home, "actions.jsonl", &audit).is_err() {
            log("warn", "audit append failed", &[("act", "ha-script".to_string())]);
        }
        result
    }

    /// HA camera_proxy snapshot. `ttl` seconds of cache on success, 10 s on failure.
    /// Returns (status, body, content-type, age of the cached frame in seconds).
    pub async fn cam(&self, ent: &str, ttl: u64) -> (u16, Bytes, String, u64) {
        if let Some(hit) = self.cam_cached(ent, ttl).await {
            return hit;
        }
        let gate = {
            let mut g = self.gates.lock().unwrap_or_else(|p| p.into_inner());
            g.entry(ent.to_string()).or_default().clone()
        };
        // same-entity callers wait here, then find the fresh entry the first one stored
        let _one_flight = gate.lock().await;
        if let Some(hit) = self.cam_cached(ent, ttl).await {
            return hit;
        }
        let v = match self.fetch_cam(ent).await {
            Ok(v) => v,
            Err(_) => (
                502,
                Bytes::from_static(b"no feed"),
                "text/plain".to_string(),
            ),
        };
        self.cams
            .lock()
            .await
            .insert(ent.to_string(), (Instant::now(), v.clone()));
        (v.0, v.1, v.2, 0)
    }

    /// Map lock is held only for the lookup.
    async fn cam_cached(&self, ent: &str, ttl: u64) -> Option<(u16, Bytes, String, u64)> {
        let g = self.cams.lock().await;
        let (t, v) = g.get(ent)?;
        let age = t.elapsed().as_secs_f64();
        let ok = v.0 == 200;
        ((ok && age < ttl as f64) || (!ok && age < 10.0))
            .then(|| (v.0, v.1.clone(), v.2.clone(), age as u64))
    }

    async fn fetch_cam(&self, ent: &str) -> Result<(u16, Bytes, String), String> {
        let r = self
            .req(
                reqwest::Method::GET,
                &format!("/api/camera_proxy/{ent}"),
                10,
            )?
            .send()
            .await
            .map_err(|e| e.without_url().to_string())?;
        if !r.status().is_success() {
            return Err("bad status".into());
        }
        let ct = cam_type(r.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).or(Some("image/jpeg")));
        let b = bounded_media(r, MAX_CAM_MEDIA_BYTES)
            .await
            .map_err(str::to_string)?;
        Ok((200, b, ct))
    }

    /// `GET /api/ha?view=house`: the grouped house read, cached 10 s. A failure is `{"error": ...}`, never a
    /// half-empty answer that could read as "all quiet".
    pub async fn house_summary(&self) -> Value {
        self.house_read().await.0
    }

    async fn house_read(&self) -> (Value, HashSet<String>) {
        let mut g = self.hx.sum.lock().await;
        if let Some((t, v, ids)) = g.as_ref() {
            if t.elapsed().as_secs() < HOUSE_TTL_SECS {
                return (v.clone(), ids.clone());
            }
        }
        match self.fetch_all_states().await {
            Ok(all) => {
                let (v, ids) = build_house(&all, now_epoch());
                *g = Some((Instant::now(), v.clone(), ids.clone()));
                (v, ids)
            }
            Err(e) => {
                log("warn", "ha house read failed", &[("err", e)]);
                (json!({"error": "ha unreachable", "t": now_epoch(), "src": "Home Assistant"}), HashSet::new())
            }
        }
    }

    async fn fetch_all_states(&self) -> Result<Vec<Value>, String> {
        let r = self
            .req(reqwest::Method::GET, "/api/states", 8)?
            .send()
            .await
            .map_err(|e| e.without_url().to_string())?;
        if !r.status().is_success() {
            return Err(format!("status {}", r.status().as_u16()));
        }
        r.json().await.map_err(|e| e.without_url().to_string())
    }

    /// `POST /api/ha?act=..&e=..&v=..`: one bounded house control. `house_plan` decides what may be sent; lights,
    /// scenes and thermostats must also be entities the last house read reported. Rate limited (1 s apart, 30 a
    /// minute) and audited to `actions.jsonl` like the house keys. HA's reply text never reaches the page.
    pub async fn house_act(&self, home: &Path, act: &str, entity: &str, v: &str) -> (u16, Value) {
        let t = now_epoch();
        let plan = house_plan(act, entity, v);
        let result = match &plan {
            Err(e) => (400, json!({"ok": false, "error": e})),
            Ok(p) => {
                let gate = actions::rate(&mut *self.hx.hist.lock().await, Duration::from_secs(1), 30);
                match gate {
                    Err(wait) => actions::limited(wait),
                    Ok(()) if p.dynamic && !self.house_read().await.1.contains(entity) => {
                        (400, json!({"ok": false, "error": "unknown entity"}))
                    }
                    Ok(()) => self.call_service(p).await,
                }
            }
        };
        if result.0 == 200 {
            *self.hx.sum.lock().await = None;
        }
        let mut audit = json!({
            "t": t, "act": "ha-house", "id": if plan.is_ok() { act } else { "bad" },
            "e": if plan.is_ok() { entity } else { "" }, "ok": result.0 == 200,
        });
        if result.0 != 200 {
            audit["error"] = result.1["error"].clone();
        }
        if actions::append(home, "actions.jsonl", &audit).is_err() {
            log("warn", "audit append failed", &[("act", "ha-house".to_string())]);
        }
        result
    }

    async fn call_service(&self, p: &HousePlan) -> (u16, Value) {
        let r = self
            .req(reqwest::Method::POST, &format!("/api/services/{}", p.service), 8)
            .map(|b| b.json(&p.body));
        match r {
            Ok(b) => match b.send().await {
                Ok(x) if x.status().is_success() => (200, json!({"ok": true})),
                _ => (502, json!({"ok": false, "error": "ha failed"})),
            },
            Err(_) => (502, json!({"ok": false, "error": "ha failed"})),
        }
    }

    pub async fn play_pause(&self) -> Value {
        let r = self
            .req(
                reqwest::Method::POST,
                "/api/services/media_player/media_play_pause",
                8,
            )
            .map(|b| b.json(&json!({"entity_id": "media_player.main_bedroom"})));
        match r {
            Ok(b) => match b.send().await {
                Ok(x) if x.status().is_success() => json!({"ok": true}),
                _ => json!({"error": "ha failed"}),
            },
            Err(_) => json!({"error": "ha failed"}),
        }
    }

    /// MediaMTX path health from its local API. Never returns source URLs (they carry camera credentials).
    pub async fn mtx_status(&self) -> Value {
        let mut g = self.mtx.lock().await;
        if let Some((t, v)) = g.as_ref() {
            if t.elapsed().as_secs() < 5 {
                return v.clone();
            }
        }
        let v = match self.fetch_mtx().await {
            Ok(v) => v,
            Err(e) => json!({"error": e, "cams": []}),
        };
        *g = Some((Instant::now(), v.clone()));
        v
    }

    async fn fetch_mtx(&self) -> Result<Value, String> {
        let r = self
            .http
            .get(format!("{MTX_API}/v3/paths/list"))
            .timeout(Duration::from_secs(3))
            .send()
            .await
            .map_err(|_| "mediamtx unreachable".to_string())?;
        let d: Value = r
            .json()
            .await
            .map_err(|_| "mediamtx bad reply".to_string())?;
        let items = d
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut cams = vec![];
        for n in MTX_PATHS {
            let it = items
                .iter()
                .find(|i| i.get("name").and_then(Value::as_str) == Some(n));
            cams.push(match it {
                Some(i) => json!({
                    "name": n,
                    "ready": i.get("ready").and_then(Value::as_bool).unwrap_or(false),
                    "readers": i.get("readers").and_then(Value::as_array).map(Vec::len).unwrap_or(0),
                    "bytes": i.get("inboundBytes").or_else(|| i.get("bytesReceived")).and_then(Value::as_u64).unwrap_or(0),
                }),
                None => json!({"name": n, "ready": false, "readers": 0, "bytes": 0}),
            });
        }
        Ok(json!({"cams": cams}))
    }

    /// Fetch one allowlisted HLS object from MediaMTX. Returns (status, content-type, body).
    pub async fn hls(&self, cam: &str, file: &str, query: &str) -> (u16, String, Bytes) {
        let url = format!("{MTX_HLS}/{cam}/{file}?cookieCheck=1{query}");
        let r = self
            .http
            .get(url)
            .timeout(Duration::from_secs(15))
            .send()
            .await;
        match r {
            Ok(r) => {
                let code = r.status().as_u16();
                let ct = cam_type(r.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()));
                match bounded_media(r, MAX_CAM_MEDIA_BYTES).await {
                    Ok(b) => (code, ct, b),
                    _ => (
                        502,
                        "text/plain".into(),
                        Bytes::from_static(b"bad upstream"),
                    ),
                }
            }
            Err(_) => (502, "text/plain".into(), Bytes::from_static(b"no feed")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_parse_strips_quotes_and_slash() {
        let (u, t) = parse_env("A=1\nHASS_URL=\"http://x:8123/\"\nHASS_TOKEN='abc'\n");
        assert_eq!((u.as_str(), t.as_str()), ("http://x:8123", "abc"));
        assert_eq!(parse_env(""), (String::new(), String::new()));
    }

    #[test]
    fn camera_types_pass_media_and_playlists_only() {
        for (up, want) in [
            (Some("image/jpeg"), "image/jpeg"),
            (Some("Image/JPEG; charset=binary"), "image/jpeg"),
            (Some("video/mp4"), "video/mp4"),
            (Some("video/MP2T"), "video/mp2t"),
            (Some("audio/mp4"), "audio/mp4"),
            (Some("application/vnd.apple.mpegurl"), "application/vnd.apple.mpegurl"),
            (Some("application/x-mpegURL"), "application/x-mpegurl"),
            (Some("audio/mpegurl"), "audio/mpegurl"),
        ] {
            assert_eq!(cam_type(up), want, "{up:?}");
        }
        for up in [
            Some("text/html"),
            Some("text/html; charset=utf-8"),
            Some("application/javascript"),
            Some("text/javascript"),
            Some("application/json"),
            Some("image/svg+xml"),
            Some("image/"),
            Some("image/jpeg\"><script>"),
            Some("text/plain"),
            Some("multipart/x-mixed-replace;boundary=frame"),
            Some(""),
            None,
        ] {
            assert_eq!(cam_type(up), "application/octet-stream", "{up:?}");
        }
    }

    /// How the mock holds cam_1 before it answers: a fixed sleep, or a gate: it says it has the request (`arrived`), then waits
    /// until the test lets it go (`release`).
    #[derive(Clone)]
    enum Hold {
        Sleep(u64),
        Gate(std::sync::Arc<tokio::sync::Notify>, std::sync::Arc<tokio::sync::Notify>),
    }

    /// Mock HA: cam_1 hangs `slow_ms` before answering, everything else answers at once.
    async fn mock_ha(slow_ms: u64) -> String {
        mock_ha_held(Hold::Sleep(slow_ms)).await
    }

    /// Mock HA: cam_1 is held as `hold` says, everything else answers at once.
    async fn mock_ha_held(hold: Hold) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let l = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map(Some)
            .unwrap_or(None);
        let Some(l) = l else { return String::new() };
        let url = l
            .local_addr()
            .map(|a| format!("http://{a}"))
            .unwrap_or_default();
        tokio::spawn(async move {
            while let Ok((mut c, _)) = l.accept().await {
                let hold = hold.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 4096];
                    let n = c.read(&mut buf).await.unwrap_or(0);
                    let head = String::from_utf8_lossy(&buf[..n]).to_string();
                    if head.contains("eufy_cam_1") {
                        match hold {
                            Hold::Sleep(ms) => tokio::time::sleep(Duration::from_millis(ms)).await,
                            Hold::Gate(arrived, release) => {
                                arrived.notify_one();
                                release.notified().await;
                            }
                        }
                    }
                    let _ = c
                        .write_all(
                            b"HTTP/1.1 200 OK\r\ncontent-type: image/jpeg\r\ncontent-length: 3\r\nconnection: close\r\n\r\njpg",
                        )
                        .await;
                });
            }
        });
        url
    }

    fn test_ha(url: String) -> std::sync::Arc<Ha> {
        std::sync::Arc::new(Ha {
            url,
            token: "t".into(),
            http: reqwest::Client::new(),
            states: Mutex::new(None),
            cams: Mutex::new(HashMap::new()),
            gates: std::sync::Mutex::new(HashMap::new()),
            mtx: Mutex::new(None),
            house_hist: Mutex::new(VecDeque::new()),
            hx: HouseState::default(),
        })
    }

    #[tokio::test]
    async fn hung_camera_does_not_block_other_cameras() {
        // the body below is the test; this guard only keeps an await that never returns (a hung mock, a lost notification) from
        // wedging the whole cargo gate: it fails in 30 s instead.
        let done = tokio::time::timeout(Duration::from_secs(30), hung_camera_does_not_block_other_cameras_now()).await;
        assert!(done.is_ok(), "cam_2 or the held cam_1 never answered within 30 s");
    }

    async fn hung_camera_does_not_block_other_cameras_now() {
        // order, not a clock: cam_1's answer is held until the test lets it go, and cam_2 must come back while it is still held.
        // Were cam_2 queued behind cam_1, it would come back only after cam_1's own 10 s request timeout, with cam_1 finished.
        let arrived = std::sync::Arc::new(tokio::sync::Notify::new());
        let release = std::sync::Arc::new(tokio::sync::Notify::new());
        let url = mock_ha_held(Hold::Gate(arrived.clone(), release.clone())).await;
        assert!(!url.is_empty(), "mock HA did not bind");
        let ha = test_ha(url);
        let slow = {
            let ha = ha.clone();
            tokio::spawn(async move { ha.cam("camera.eufy_cam_1", 30).await })
        };
        arrived.notified().await; // cam_1's request is at the camera, and it hangs there
        let fast = ha.cam("camera.eufy_cam_2", 30).await;
        assert_eq!(fast.0, 200);
        assert!(!slow.is_finished(), "cam_2 waited behind hung cam_1");
        release.notify_one();
        let r = slow.await.map(|r| r.0).unwrap_or(0);
        assert_eq!(r, 200);
    }

    #[tokio::test]
    async fn concurrent_requests_for_one_camera_share_one_fetch() {
        let ha = test_ha(mock_ha(300).await);
        let a = {
            let ha = ha.clone();
            tokio::spawn(async move { ha.cam("camera.eufy_cam_1", 30).await })
        };
        tokio::time::sleep(Duration::from_millis(50)).await;
        let b = ha.cam("camera.eufy_cam_1", 30).await;
        let a = a.await.map(|r| r.3).unwrap_or(99);
        assert_eq!(a, 0, "first caller fetched");
        assert_eq!(b.0, 200);
    }

    #[tokio::test]
    async fn chunked_media_respects_body_limit() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let Some(listener) = tokio::net::TcpListener::bind("127.0.0.1:0").await.ok() else {
            panic!("cannot bind media test");
        };
        let addr = listener.local_addr().unwrap_or_else(|_| panic!("no test address"));
        tokio::spawn(async move {
            for payload in [b"abcd".as_slice(), b"abcde".as_slice()] {
                let Ok((mut stream, _)) = listener.accept().await else {
                    break;
                };
                let mut request = [0; 1024];
                let _ = stream.read(&mut request).await;
                let header = format!(
                    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n",
                    payload.len()
                );
                let _ = stream.write_all(header.as_bytes()).await;
                let _ = stream.write_all(payload).await;
                let _ = stream.write_all(b"\r\n0\r\n\r\n").await;
            }
        });
        let client = reqwest::Client::new();
        let url = format!("http://{addr}/");
        let first = client.get(&url).send().await.unwrap_or_else(|_| panic!("no first reply"));
        assert_eq!(bounded_media(first, 4).await, Ok(Bytes::from_static(b"abcd")));
        let second = client.get(&url).send().await.unwrap_or_else(|_| panic!("no second reply"));
        assert_eq!(bounded_media(second, 4).await, Err("too large"));
    }

    #[tokio::test]
    async fn live_refreshes_old_tile_without_replacing_another_camera() {
        let ha = test_ha(mock_ha(0).await);
        {
            let mut cams = ha.cams.lock().await;
            for (name, frame) in [
                ("camera.eufy_cam_1", b"one".as_slice()),
                ("camera.eufy_cam_2", b"two".as_slice()),
            ] {
                cams.insert(
                    name.into(),
                    (
                        Instant::now() - Duration::from_secs(2),
                        (200, Bytes::copy_from_slice(frame), "image/jpeg".into()),
                    ),
                );
            }
        }
        let live = ha.cam("camera.eufy_cam_1", 1).await;
        assert_eq!(live.0, 200);
        assert_eq!(live.1, Bytes::from_static(b"jpg"));
        let other_tile = ha.cam("camera.eufy_cam_2", 5).await;
        assert_eq!(other_tile.1, Bytes::from_static(b"two"));
    }

    type Seen = std::sync::Arc<std::sync::Mutex<Vec<String>>>;

    /// Mock HA that answers every request with `status` and `body`, and records each full request
    /// (head and body) so tests can assert on method, path, auth header and payload.
    async fn recording_ha(status: u16, ctype: &str, body: &str) -> (String, Seen) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let seen: Seen = Default::default();
        let Some(l) = tokio::net::TcpListener::bind("127.0.0.1:0").await.ok() else {
            panic!("cannot bind mock ha");
        };
        let url = l.local_addr().map(|a| format!("http://{a}")).unwrap_or_default();
        let reply = format!(
            "HTTP/1.1 {status} X\r\ncontent-type: {ctype}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );
        let log = seen.clone();
        tokio::spawn(async move {
            while let Ok((mut c, _)) = l.accept().await {
                let (reply, log) = (reply.clone(), log.clone());
                tokio::spawn(async move {
                    let mut got = Vec::new();
                    let mut buf = [0u8; 2048];
                    loop {
                        let n = c.read(&mut buf).await.unwrap_or(0);
                        if n == 0 {
                            break;
                        }
                        got.extend_from_slice(&buf[..n]);
                        let text = String::from_utf8_lossy(&got).to_lowercase();
                        let Some(end) = text.find("\r\n\r\n") else { continue };
                        let want = text[..end]
                            .lines()
                            .find_map(|l| l.strip_prefix("content-length:"))
                            .and_then(|v| v.trim().parse::<usize>().ok())
                            .unwrap_or(0);
                        if got.len() >= end + 4 + want {
                            break;
                        }
                    }
                    if let Ok(mut v) = log.lock() {
                        v.push(String::from_utf8_lossy(&got).into_owned());
                    }
                    let _ = c.write_all(reply.as_bytes()).await;
                });
            }
        });
        (url, seen)
    }

    fn requests(seen: &Seen) -> Vec<String> {
        seen.lock().map(|v| v.clone()).unwrap_or_default()
    }

    #[tokio::test]
    async fn states_keep_only_allowlisted_sensors_and_flatten_attributes() {
        let body = json!([
            {"entity_id": "sensor.hp_envy_6400_series_black_cartridge", "state": "61", "last_updated": "2026-09-29T18:46:10Z",
             "attributes": {"unit_of_measurement": "%", "friendly_name": "Black", "token": "leak-me"}},
            {"entity_id": "sensor.not_on_the_list", "state": "1", "attributes": {}},
            {"entity_id": "weather.forecast_home", "state": "sunny"},
            {"state": "orphan without an entity id"},
            {"entity_id": "camera.eufy_cam_1", "state": 7, "attributes": {"friendly_name": 5}},
            {"entity_id": "person.mesh", "state": "home", "attributes": {"friendly_name": "Morgan"}}
        ])
        .to_string();
        let (url, _) = recording_ha(200, "application/json", &body).await;
        let v = test_ha(url).states().await;
        let ents = &v["entities"];
        // every allowlisted id is a row: the ones HA did not report say so instead of vanishing
        assert_eq!(ents.as_object().map(|o| o.len()), Some(HA_SENSORS.len()), "{v}");
        assert!(ents.as_object().into_iter().flatten().all(|(k, _)| HA_SENSORS.contains(&k.as_str())));
        assert_eq!(
            ents["binary_sensor.internet_reachable"],
            json!({"state": "unavailable", "unit": "", "name": "", "updated": null, "missing": true})
        );
        // a row whose HA name names another household member is dropped and reads as missing
        assert_eq!(ents["person.mesh"]["missing"], true);
        assert!(!v.to_string().to_lowercase().contains("morgan"));
        assert_eq!(
            ents["sensor.hp_envy_6400_series_black_cartridge"],
            json!({"state": "61", "unit": "%", "name": "Black", "updated": 1_790_707_570u64})
        );
        // missing attributes and timestamps are empty strings and null, never absent keys
        assert_eq!(
            ents["weather.forecast_home"],
            json!({"state": "sunny", "unit": "", "name": "", "updated": null})
        );
        // non-string state or friendly_name falls back to "" instead of failing the whole feed
        assert_eq!(ents["camera.eufy_cam_1"]["state"], "");
        assert_eq!(ents["camera.eufy_cam_1"]["name"], "");
        assert!(!v.to_string().contains("leak-me"), "unlisted attributes must not leave");
    }

    #[tokio::test]
    async fn states_request_is_a_bearer_authenticated_get_of_api_states() {
        let (url, seen) = recording_ha(200, "application/json", "[]").await;
        let _ = test_ha(url).states().await;
        let reqs = requests(&seen);
        assert_eq!(reqs.len(), 1);
        assert!(reqs[0].starts_with("GET /api/states HTTP/1.1"), "{}", reqs[0]);
        assert!(reqs[0].to_lowercase().contains("authorization: bearer t\r\n"), "{}", reqs[0]);
    }

    #[tokio::test]
    async fn states_are_cached_so_two_quick_calls_hit_home_assistant_once() {
        let (url, seen) = recording_ha(200, "application/json", "[]").await;
        let ha = test_ha(url);
        let first = ha.states().await;
        let second = ha.states().await;
        assert_eq!(first, second);
        assert_eq!(requests(&seen).len(), 1);
    }

    #[test]
    fn weather_text_reads_only_temperature_and_wind_and_rounds_them() {
        let v = json!({"state": "sunny", "attributes": {"temperature": 67.6, "temperature_unit": "\u{b0}F", "wind_speed": 4.7,
            "wind_speed_unit": "mph", "humidity": 52, "friendly_name": "Forecast 1 Example Street"}});
        assert_eq!(weather_text(&v, "Huntington Beach").as_deref(), Some("Huntington Beach  \u{b7}  Temp 68\u{b0}F  \u{b7}  Wind 5 mph"));
        assert_eq!(weather_text(&v, "").as_deref(), Some("Temp 68\u{b0}F  \u{b7}  Wind 5 mph"));
        assert!(!weather_text(&v, "").unwrap_or_default().contains("Example"), "the entity name never leaves");
        let calm = json!({"state": "clear-night", "attributes": {"temperature": -0.4, "temperature_unit": "\u{b0}C"}});
        assert_eq!(weather_text(&calm, "").as_deref(), Some("Temp 0\u{b0}C"));
        for bad in [
            json!({"state": "unavailable", "attributes": {"temperature": 60}}),
            json!({"state": "unknown", "attributes": {"temperature": 60}}),
            json!({"state": "sunny", "attributes": {"temperature": "hot"}}),
            json!({"state": "sunny", "attributes": {}}),
            json!({"state": "sunny"}),
            json!({"attributes": {"temperature": 60}}),
        ] {
            assert_eq!(weather_text(&bad, "X"), None, "{bad}");
        }
    }

    #[tokio::test]
    async fn weather_line_is_one_bearer_get_of_the_weather_entity() {
        let body = json!({"entity_id": "weather.forecast_home", "state": "sunny", "attributes": {"temperature": 68,
            "temperature_unit": "\u{b0}F", "wind_speed": 4.7, "wind_speed_unit": "mph"}})
        .to_string();
        let (url, seen) = recording_ha(200, "application/json", &body).await;
        let line = test_ha(url).weather_line("Huntington Beach").await;
        assert_eq!(line.as_deref(), Some("Huntington Beach  \u{b7}  Temp 68\u{b0}F  \u{b7}  Wind 5 mph"));
        let reqs = requests(&seen);
        assert_eq!(reqs.len(), 1);
        assert!(reqs[0].starts_with("GET /api/states/weather.forecast_home HTTP/1.1"), "{}", reqs[0]);
        assert!(reqs[0].to_lowercase().contains("authorization: bearer t\r\n"), "{}", reqs[0]);
        let (url, _) = recording_ha(500, "application/json", "{}").await;
        assert_eq!(test_ha(url).weather_line("Huntington Beach").await, None);
    }

    #[tokio::test]
    async fn states_failure_is_a_generic_error_object_without_upstream_detail() {
        for (status, body) in [(500, "{\"secret\":\"upstream detail\"}"), (200, "not json")] {
            let (url, _) = recording_ha(status, "application/json", body).await;
            let v = test_ha(url).states().await;
            assert_eq!(v, json!({"error": "ha unreachable", "entities": {}}), "status {status}");
        }
    }

    #[tokio::test]
    async fn unconfigured_ha_answers_without_touching_the_network() {
        let mut ha = Ha {
            url: String::new(),
            token: "t".into(),
            http: reqwest::Client::new(),
            states: Mutex::new(None),
            cams: Mutex::new(HashMap::new()),
            gates: std::sync::Mutex::new(HashMap::new()),
            mtx: Mutex::new(None),
            house_hist: Mutex::new(VecDeque::new()),
            hx: HouseState::default(),
        };
        assert_eq!(ha.states().await, json!({"error": "ha unreachable", "entities": {}}));
        assert_eq!(ha.play_pause().await, json!({"error": "ha failed"}));
        assert_eq!(ha.cam("camera.eufy_cam_1", 30).await.0, 502);
        // a URL without a token is just as unusable
        ha.url = "http://127.0.0.1:1".into();
        ha.token = String::new();
        assert_eq!(ha.play_pause().await, json!({"error": "ha failed"}));
    }

    #[tokio::test]
    async fn camera_upstream_error_becomes_a_502_and_is_not_retried_inside_ten_seconds() {
        let (url, seen) = recording_ha(404, "text/plain", "gone").await;
        let ha = test_ha(url);
        let first = ha.cam("camera.eufy_cam_3", 30).await;
        assert_eq!((first.0, first.1, first.2.as_str()), (502, Bytes::from_static(b"no feed"), "text/plain"));
        let second = ha.cam("camera.eufy_cam_3", 30).await;
        assert_eq!(second.0, 502);
        assert_eq!(requests(&seen).len(), 1, "failure cache must absorb the retry");
        assert!(requests(&seen)[0].starts_with("GET /api/camera_proxy/camera.eufy_cam_3 "));
    }

    #[tokio::test]
    async fn failed_camera_frame_is_retried_after_the_ten_second_failure_window() {
        let (url, seen) = recording_ha(200, "image/png", "png").await;
        let ha = test_ha(url);
        ha.cams.lock().await.insert(
            "camera.eufy_cam_4".into(),
            (
                Instant::now() - Duration::from_secs(11),
                (502, Bytes::from_static(b"no feed"), "text/plain".into()),
            ),
        );
        let r = ha.cam("camera.eufy_cam_4", 30).await;
        assert_eq!((r.0, r.1, r.2.as_str(), r.3), (200, Bytes::from_static(b"png"), "image/png", 0));
        assert_eq!(requests(&seen).len(), 1);
    }

    #[tokio::test]
    async fn fresh_camera_frame_is_served_from_cache_with_its_age_until_the_ttl_ends() {
        let (url, seen) = recording_ha(200, "image/jpeg", "new").await;
        let ha = test_ha(url);
        ha.cams.lock().await.insert(
            "camera.eufy_cam_2".into(),
            (
                Instant::now() - Duration::from_secs(3),
                (200, Bytes::from_static(b"old"), "image/jpeg".into()),
            ),
        );
        let hit = ha.cam("camera.eufy_cam_2", 30).await;
        assert_eq!((hit.1, hit.3), (Bytes::from_static(b"old"), 3));
        assert!(requests(&seen).is_empty(), "a fresh frame must not call home assistant");
        let expired = ha.cam("camera.eufy_cam_2", 2).await;
        assert_eq!((expired.1, expired.3), (Bytes::from_static(b"new"), 0));
        assert_eq!(requests(&seen).len(), 1);
    }

    #[tokio::test]
    async fn play_pause_posts_the_bedroom_player_and_reports_only_ok_or_failed() {
        let (url, seen) = recording_ha(200, "application/json", "[]").await;
        assert_eq!(test_ha(url).play_pause().await, json!({"ok": true}));
        let reqs = requests(&seen);
        assert_eq!(reqs.len(), 1);
        assert!(
            reqs[0].starts_with("POST /api/services/media_player/media_play_pause HTTP/1.1"),
            "{}",
            reqs[0]
        );
        assert!(reqs[0].contains(r#"{"entity_id":"media_player.main_bedroom"}"#), "{}", reqs[0]);
        let (url, _) = recording_ha(401, "application/json", "{\"message\":\"nope\"}").await;
        assert_eq!(test_ha(url).play_pause().await, json!({"error": "ha failed"}));
    }

    #[test]
    fn camera_lists_stay_in_step_with_the_sensor_allowlist_and_mediamtx_paths() {
        assert_eq!(HA_CAMS.len(), MTX_PATHS.len());
        for cam in HA_CAMS {
            assert!(HA_SENSORS.contains(&cam), "{cam} is a camera but not an allowlisted entity");
        }
        for (cam, path) in HA_CAMS.iter().zip(MTX_PATHS) {
            // camera.eufy_cam_N is relayed as eufy_camN
            assert_eq!(cam.replace("camera.eufy_cam_", "eufy_cam"), path);
        }
    }

    #[test]
    fn allowlists_are_tanner_and_house_only() {
        let ids = HA_SENSORS.iter().copied().chain(HA_SCRIPTS.iter().map(|s| s.0));
        for id in ids {
            assert!(!other_tenant(id), "{id} names another household member");
            assert!(!id.starts_with("device_tracker."), "{id}");
            assert!(!id.starts_with("person.") || id == "person.mesh", "{id}");
        }
        for (id, vars, _) in HA_SCRIPTS {
            assert!(!matches!(id, "water_zone" | "tv_app_launch"), "{id} takes free input");
            assert!(!other_tenant(vars), "{id} vars");
            assert!(id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_'), "{id}");
        }
        // the house speaker is off (D12): no key targets it
        assert!(HA_SCRIPTS.iter().all(|s| !s.1.contains("pyleusa")));
        for w in ["Morgan", "QUILL", "Loto"] {
            assert!(other_tenant(w));
        }
        // keys.json labels and ids carry no other household member either
        let raw = include_str!("../../keys.json");
        assert!(!other_tenant(raw), "keys.json names another household member");
    }

    #[test]
    fn risky_house_scripts_always_need_the_second_tap() {
        let confirm: Vec<&str> = HA_SCRIPTS.iter().filter(|s| s.2).map(|s| s.0).collect();
        assert_eq!(
            confirm,
            ["living_tv_power", "stop_all_watering", "rain_delay_2_days", "clear_rain_delay"]
        );
        assert!(script_confirm("stop_all_watering") && !script_confirm("living_mute") && !script_confirm("nope"));
        assert_eq!(script_body("nope"), None);
        assert_eq!(script_body("living_mute"), Some(json!({"entity_id": "script.living_mute"})));
        assert_eq!(
            script_body("house_music_play_on"),
            Some(json!({"entity_id": "script.house_music_play_on", "variables": {"target": "media_player.main_bedroom_2"}}))
        );
    }

    #[tokio::test]
    async fn run_script_posts_only_allowlisted_scripts_with_fixed_variables() {
        let (url, seen) = recording_ha(200, "application/json", "[]").await;
        let ha = test_ha(url);
        assert_eq!(ha.run_script("living_volume_up").await, (200, json!({"ok": true, "script": "living_volume_up"})));
        assert_eq!(ha.run_script("house_music_play_on").await.0, 200);
        assert_eq!(ha.run_script("water_zone").await, (400, json!({"ok": false, "error": "not allowed"})));
        assert_eq!(ha.run_script("script.living_mute").await.0, 400);
        let reqs = requests(&seen);
        assert_eq!(reqs.len(), 2, "a refused id never reaches home assistant");
        assert!(reqs[0].starts_with("POST /api/services/script/turn_on HTTP/1.1"), "{}", reqs[0]);
        assert!(reqs[0].to_lowercase().contains("authorization: bearer t\r\n"));
        assert!(reqs[0].ends_with(r#"{"entity_id":"script.living_volume_up"}"#), "{}", reqs[0]);
        assert!(reqs[1].contains(r#""variables":{"target":"media_player.main_bedroom_2"}"#), "{}", reqs[1]);
        let (url, _) = recording_ha(500, "application/json", "{\"message\":\"secret detail\"}").await;
        assert_eq!(test_ha(url).run_script("living_mute").await, (502, json!({"ok": false, "error": "ha failed"})));
    }

    #[tokio::test]
    async fn house_presses_are_rate_limited_and_every_press_is_audited() {
        let home = std::env::temp_dir().join(format!("pdeck-house-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let (url, seen) = recording_ha(200, "application/json", "[]").await;
        let ha = test_ha(url);
        assert_eq!(ha.house(&home, "living_mute").await.0, 200);
        let second = ha.house(&home, "living_mute").await;
        assert_eq!((second.0, &second.1["error"]), (429, &json!("rate limited")));
        assert_eq!(ha.house(&home, "rm -rf").await.0, 400);
        assert_eq!(requests(&seen).len(), 1, "only the first press reached home assistant");
        let log = std::fs::read_to_string(home.join(".local/state/pixel-deck/actions.jsonl")).unwrap_or_default();
        let lines: Vec<Value> = log.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
        assert_eq!(lines.len(), 3, "{log}");
        assert_eq!((&lines[0]["act"], &lines[0]["id"], &lines[0]["ok"]), (&json!("ha-script"), &json!("living_mute"), &json!(true)));
        assert_eq!((&lines[1]["ok"], &lines[1]["error"]), (&json!(false), &json!("rate limited")));
        assert_eq!((&lines[2]["id"], &lines[2]["error"]), (&json!("bad"), &json!("not allowed")));
        let _ = std::fs::remove_dir_all(&home);
    }

    // ---- house tiles: allowlist, clamp, summary shape ----

    #[test]
    fn house_plan_refuses_every_service_outside_the_allowlist() {
        for act in [
            "lock_unlock", "lock_lock", "cover_open", "garage_open", "alarm_disarm", "script_on", "vacuum_start",
            "homeassistant_restart", "light.turn_on", "light/turn_on", "", "LIGHT_ON", "shell_command",
        ] {
            assert_eq!(house_plan(act, "light.kitchen", ""), Err("not allowed"), "{act}");
        }
        for (act, e, svc) in [
            ("light_on", "light.kitchen", "light/turn_on"),
            ("light_off", "light.kitchen", "light/turn_off"),
            ("light_toggle", "light.kitchen", "light/toggle"),
            ("scene_on", "scene.dinner", "scene/turn_on"),
            ("media_pp", "media_player.main_bedroom", "media_player/media_play_pause"),
            ("climate_set", "climate.hall", "climate/set_temperature"),
        ] {
            let p = house_plan(act, e, "70").unwrap_or_else(|er| panic!("{act}: {er}"));
            assert_eq!(p.service, svc);
            assert_eq!(p.body["entity_id"], e);
        }
        // a light call carries the entity and nothing else: no brightness, colour or transition
        assert_eq!(house_plan("light_on", "light.kitchen", "99").map(|p| p.body), Ok(json!({"entity_id": "light.kitchen"})));
    }

    #[test]
    fn house_plan_rejects_unknown_or_cross_domain_entities() {
        for (act, e) in [
            ("light_on", "lock.front_door"),
            ("light_on", "cover.garage_door"),
            ("scene_on", "light.kitchen"),
            ("light_on", "script.stop_all_watering"),
            ("light_on", "light."),
            ("light_on", "light.Kitchen"),
            ("light_on", "light.a/../b"),
            ("light_on", "light.a b"),
            ("light_on", "light.morgan_lamp"),
            ("scene_on", "scene.quill_morning"),
            ("media_pp", "media_player.pyleusa"),
            ("media_pp", "media_player.los_macbook_air"),
            ("media_pp", "media_player.living_room_samsung_tv"),
            ("climate_set", "light.kitchen"),
        ] {
            assert_eq!(house_plan(act, e, "70"), Err("unknown entity"), "{act} {e}");
        }
        assert!(HOUSE_MEDIA.iter().all(|m| m.starts_with("media_player.") && !other_tenant(m) && !m.contains("pyleusa")));
    }

    #[test]
    fn climate_set_point_is_clamped_to_sixty_to_eighty_and_junk_is_refused() {
        let t = |v: &str| house_plan("climate_set", "climate.hall", v).map(|p| p.body["temperature"].as_f64());
        assert_eq!(t("72"), Ok(Some(72.0)));
        assert_eq!(t("95"), Ok(Some(80.0)));
        assert_eq!(t("40"), Ok(Some(60.0)));
        assert_eq!(t("-300"), Ok(Some(60.0)));
        assert_eq!(t("1e9"), Ok(Some(80.0)));
        assert_eq!(t(" 71.3 "), Ok(Some(71.5)));
        for bad in ["", "abc", "NaN", "inf", "-inf", "72F", "70;80"] {
            assert_eq!(t(bad), Err("bad temperature"), "{bad:?}");
        }
        assert!(t("60").is_ok() && t("80").is_ok());
    }

    fn house_fixture(unit: Option<&str>) -> Vec<Value> {
        let mut wx = json!({"humidity": 64, "wind_speed": 19.7, "wind_speed_unit": "mph", "friendly_name": "Forecast"});
        if let Some(u) = unit {
            wx["temperature_unit"] = json!(u);
        }
        let t = "2026-11-02T01:44:28Z";
        serde_json::from_value(json!([
            {"entity_id": "weather.forecast_home", "state": "clear-night", "last_updated": t, "attributes": wx},
            {"entity_id": "sensor.outside_temperature", "state": "65", "last_updated": t, "attributes": {"unit_of_measurement": "\u{b0}F"}},
            {"entity_id": "sensor.electricity_price_now", "state": "0.615", "last_updated": t, "attributes": {"with_baseline_credit": "0.50769"}},
            {"entity_id": "sensor.electricity_rate_period", "state": "On-peak", "last_updated": t, "attributes": {}},
            {"entity_id": "light.kitchen", "state": "on", "last_updated": t, "attributes": {"friendly_name": "Kitchen"}},
            {"entity_id": "light.morgan_lamp", "state": "on", "last_updated": t, "attributes": {"friendly_name": "Lamp"}},
            {"entity_id": "light.den", "state": "on", "last_updated": t, "attributes": {"friendly_name": "Morgan's den"}},
            {"entity_id": "scene.evening", "state": "unknown", "last_updated": t, "attributes": {"friendly_name": "Evening"}},
            {"entity_id": "climate.hall", "state": "heat", "last_updated": t,
             "attributes": {"current_temperature": 68, "temperature": 70, "hvac_action": "heating", "friendly_name": "Hall"}},
            {"entity_id": "lock.front", "state": "locked", "last_updated": t, "attributes": {"friendly_name": "Front door"}},
            {"entity_id": "media_player.main_bedroom", "state": "playing", "last_updated": t,
             "attributes": {"media_title": "Song", "media_artist": "Band", "friendly_name": "Main Bedroom"}},
            {"entity_id": "media_player.pyleusa", "state": "idle", "last_updated": t, "attributes": {"friendly_name": "House speaker"}},
            {"entity_id": "media_player.los_macbook_air", "state": "idle", "last_updated": t, "attributes": {}},
            {"entity_id": "person.mesh", "state": "home", "last_updated": t, "last_changed": t, "attributes": {"friendly_name": "Tanner"}},
            {"entity_id": "person.morgan_example", "state": "home", "last_updated": t, "attributes": {"friendly_name": "Morgan"}},
            {"entity_id": "device_tracker.someone", "state": "home", "last_updated": t, "attributes": {}},
            {"entity_id": "sensor.arc_4b3c_valve_1_drip", "state": "idle", "last_updated": t, "attributes": {"friendly_name": "ARC 4B3C Valve 1 drip"}},
            {"entity_id": "sensor.hvac_filter_days_left", "state": "unavailable", "last_updated": t, "attributes": {}},
            {"entity_id": "automation.morning", "state": "on", "last_updated": t,
             "attributes": {"last_triggered": "2026-10-31T14:30:00+00:00", "friendly_name": "Morning"}},
            {"entity_id": "automation.idle", "state": "off", "last_updated": t, "attributes": {"last_triggered": null, "friendly_name": "Idle"}}
        ]))
        .unwrap_or_else(|e| panic!("fixture: {e}"))
    }

    #[test]
    fn house_summary_groups_values_and_leaves_missing_ones_null() {
        let (v, ctl) = build_house(&house_fixture(Some("\u{b0}F")), 1_790_000_000);
        let g = &v["groups"];
        assert_eq!((v["src"].as_str(), v["set_ok"].as_bool()), (Some("Home Assistant"), Some(true)));
        assert_eq!(g["energy"][0], json!({"k": "Price now", "v": "61.5 \u{a2}/kWh", "u": 1_793_583_868u64}));
        // a state HA called unavailable is null, never "0" or ""
        let filter = g["upkeep"].as_array().and_then(|a| a.iter().find(|r| r["k"] == "HVAC filter")).cloned().unwrap_or_default();
        assert!(filter["v"].is_null(), "{filter}");
        assert_eq!(g["presence"][0]["v"], "Home");
        assert_eq!(g["alerts"][2]["v"], "1 of 2");
        assert_eq!(g["irrigation"].as_array().map(|a| a.len()), Some(5), "4 status rows + 1 valve");
        assert_eq!(g["climate"]["devices"][0]["target"], "70");
        assert_eq!(g["media"].as_array().map(Vec::len), Some(1));
        assert_eq!(g["media"][0]["now"], "Song - Band");
        assert_eq!(v["counts"]["lights"], 1);
        assert_eq!(v["counts"]["scenes"], 1);
        assert_eq!(v["counts"]["irrigation_valves"], 1);
        let mut ids: Vec<&str> = ctl.iter().map(String::as_str).collect();
        ids.sort_unstable();
        assert_eq!(ids, ["climate.hall", "light.kitchen", "scene.evening"]);
        // nobody else's data leaves: no other person, no tracker, no entity whose id or name names a household member
        let all = v.to_string().to_lowercase();
        for w in ["morgan", "quill", "loto", "device_tracker", "person.", "pyleusa", "macbook", "den"] {
            assert!(!all.contains(w), "{w} leaked: {all}");
        }
    }

    #[test]
    fn thermostat_is_not_controllable_unless_home_assistant_reports_degrees_f() {
        for unit in [None, Some("\u{b0}C")] {
            let (v, ctl) = build_house(&house_fixture(unit), 1_790_000_000);
            assert_eq!(v["set_ok"], false);
            assert!(!ctl.contains("climate.hall"), "{unit:?}");
            assert!(ctl.contains("light.kitchen"));
        }
    }

    #[test]
    fn an_empty_house_is_empty_groups_not_zeros() {
        let (v, ctl) = build_house(&[], 1_790_000_000);
        assert!(ctl.is_empty());
        assert!(v["groups"]["lights"]["lights"].as_array().is_some_and(Vec::is_empty));
        assert!(v["groups"]["weather"].as_array().is_some_and(|a| a.iter().all(|r| r["v"].is_null())));
        assert_eq!(v["counts"]["weather"], 0);
    }

    async fn house_mock() -> (std::sync::Arc<Ha>, Seen) {
        let body = serde_json::to_string(&house_fixture(Some("\u{b0}F"))).unwrap_or_default();
        let (url, seen) = recording_ha(200, "application/json", &body).await;
        (test_ha(url), seen)
    }

    fn posts(seen: &Seen) -> Vec<String> {
        requests(seen).into_iter().filter(|r| r.starts_with("POST ")).collect()
    }

    #[tokio::test]
    async fn house_act_refuses_forbidden_services_before_any_request() {
        let home = std::env::temp_dir().join(format!("pdeck-hact-a-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        for (act, e) in [("lock_unlock", "lock.front"), ("cover_open", "cover.garage"), ("script_on", "script.stop_all_watering"), ("light_on", "lock.front")] {
            let (ha, seen) = house_mock().await;
            let r = ha.house_act(&home, act, e, "").await;
            assert_eq!(r.0, 400, "{act}");
            assert!(requests(&seen).is_empty(), "{act} reached home assistant: {:?}", requests(&seen));
        }
        let log = std::fs::read_to_string(home.join(".local/state/pixel-deck/actions.jsonl")).unwrap_or_default();
        assert_eq!(log.lines().filter(|l| l.contains("\"ha-house\"") && l.contains("\"bad\"")).count(), 4, "{log}");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn house_act_rejects_an_entity_home_assistant_did_not_report() {
        let home = std::env::temp_dir().join(format!("pdeck-hact-b-{}", std::process::id()));
        let (ha, seen) = house_mock().await;
        let r = ha.house_act(&home, "light_toggle", "light.not_there", "").await;
        assert_eq!(r, (400, json!({"ok": false, "error": "unknown entity"})));
        assert!(posts(&seen).is_empty(), "no service call for an unknown light");
        // the other tenant's light exists in HA but is never reported, so it is unknown here too
        let (ha, seen) = house_mock().await;
        assert_eq!(ha.house_act(&home, "light_toggle", "light.den", "").await.0, 400);
        assert!(posts(&seen).is_empty());
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn house_act_sends_one_bounded_service_call_and_audits_it() {
        let home = std::env::temp_dir().join(format!("pdeck-hact-c-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let (ha, seen) = house_mock().await;
        assert_eq!(ha.house_act(&home, "light_toggle", "light.kitchen", "").await, (200, json!({"ok": true})));
        let p = posts(&seen);
        assert_eq!(p.len(), 1);
        assert!(p[0].starts_with("POST /api/services/light/toggle HTTP/1.1"), "{}", p[0]);
        assert!(p[0].to_lowercase().contains("authorization: bearer t\r\n"));
        assert!(p[0].ends_with(r#"{"entity_id":"light.kitchen"}"#), "{}", p[0]);
        // 1 s apart: a second press at once is rate limited and sends nothing
        let again = ha.house_act(&home, "light_toggle", "light.kitchen", "").await;
        assert_eq!((again.0, &again.1["error"]), (429, &json!("rate limited")));
        assert_eq!(posts(&seen).len(), 1);
        // a thermostat set point past the limit is sent clamped
        let (ha, seen) = house_mock().await;
        assert_eq!(ha.house_act(&home, "climate_set", "climate.hall", "99").await.0, 200);
        let p = posts(&seen);
        assert!(p[0].starts_with("POST /api/services/climate/set_temperature HTTP/1.1"), "{}", p[0]);
        assert!(p[0].contains(r#""temperature":80.0"#), "{}", p[0]);
        // media: a fixed list, so no states read is needed first
        let (ha, seen) = house_mock().await;
        assert_eq!(ha.house_act(&home, "media_pp", "media_player.main_bedroom", "").await.0, 200);
        assert_eq!(requests(&seen).len(), 1, "media play/pause does not read states first");
        assert!(requests(&seen)[0].starts_with("POST /api/services/media_player/media_play_pause "));
        let log = std::fs::read_to_string(home.join(".local/state/pixel-deck/actions.jsonl")).unwrap_or_default();
        let lines: Vec<Value> = log.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
        assert_eq!(lines.len(), 4, "{log}");
        assert_eq!((&lines[0]["act"], &lines[0]["id"], &lines[0]["e"], &lines[0]["ok"]), (&json!("ha-house"), &json!("light_toggle"), &json!("light.kitchen"), &json!(true)));
        assert_eq!(lines[1]["error"], "rate limited");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn house_read_failure_is_an_error_object_and_a_dead_ha_sends_no_control() {
        let (url, _) = recording_ha(500, "application/json", "{\"secret\":\"detail\"}").await;
        let ha = test_ha(url);
        let v = ha.house_summary().await;
        assert_eq!(v["error"], "ha unreachable");
        assert!(!v.to_string().contains("detail"));
        let home = std::env::temp_dir().join(format!("pdeck-hact-d-{}", std::process::id()));
        assert_eq!(ha.house_act(&home, "light_toggle", "light.kitchen", "").await.0, 400);
        let _ = std::fs::remove_dir_all(&home);
    }

    /// Read only, against the real Home Assistant (`cargo test live_house -- --ignored --nocapture`). Prints counts only.
    #[tokio::test]
    #[ignore]
    async fn live_house_read_prints_group_counts() {
        let home = std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default());
        let ha = Ha::load(&home, reqwest::Client::new());
        let v = ha.house_summary().await;
        println!("HOUSE_T {} UNIT {} SET_OK {}", v["t"], v["unit"], v["set_ok"]);
        if let Ok(p) = std::env::var("HOUSE_DUMP") {
            let _ = std::fs::write(p, v.to_string());
        }
        println!("HOUSE_COUNTS {}", v["counts"]);
        assert!(v.get("error").is_none(), "{}", v["error"]);
    }
}
