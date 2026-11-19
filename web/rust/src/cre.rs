//! Markets > Commercial deal desk (owner order 2026-11-12). `GET /api/cre?person=` returns the scored deals the realestate
//! collector writes to `~/.meshvault/status/deck/cre-deals.json`, plus that person's buy boxes and which matches they have
//! already seen (new-match alerts). `POST /api/cre` saves or deletes a buy box, or marks a box's matches seen.
//!
//! People: Tanner (owner), Jordan Example and Riley Example. Each of Jordan and Riley may get a read-mostly viewer token at
//! `~/.config/pixel-deck/token-cre-<person>` (same rules as the guest token); a viewer sees only this desk, only as
//! themselves, and may edit only their own buy boxes. Nothing here sends anything to anyone.
//! Buy boxes live in `~/.local/share/pixel-deck/cre-profiles.json` (0600, atomic rename), every field validated.
use serde_json::{json, Map, Value};
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

pub const REL: &str = ".local/share/pixel-deck/cre-profiles.json";
pub const DEALS_REL: &str = ".meshvault/status/deck/cre-deals.json";
pub const PEOPLE: [&str; 3] = ["tanner", "jordan", "riley"];
/// People who may hold a viewer token. Never the owner.
pub const VIEWERS: [&str; 2] = ["jordan", "riley"];
pub const TYPES: [&str; 10] =
    ["Multifamily", "Industrial", "Office", "Retail", "Mixed use", "Land", "Hospitality", "Special purpose", "Residential", "Other"];
pub const SORTS: [&str; 6] = ["score", "cap", "price", "ppsf", "dom", "newest"];
pub const MAX_BOXES: usize = 12;
pub const MAX_SEEN: usize = 6000;
pub const MAX_BODY: usize = 131_072;

static LOCK: Mutex<()> = Mutex::new(());
type DealsCache = Option<(SystemTime, Arc<Value>)>;
static DEALS: Mutex<DealsCache> = Mutex::new(None);

pub fn person_ok(p: &str) -> bool {
    PEOPLE.contains(&p)
}

/// Who each desk is for and the buy boxes it starts from. Jordan Example: multifamily 2-4 and 5+ units in
/// Los Angeles, Orange, San Diego and Riverside counties (screens on cap rate, DSCR and cash flow).
/// Riley Example: industrial sale and lease in Orange, Los Angeles, Riverside and San Bernardino counties.
/// Tanner: South Orange County, Orange County and the Inland Empire, small 2-4 unit buys, plus his co-invest
/// views of the other two desks (static/cre.js). Defaults only seed a person with no saved boxes; saved boxes always win.
pub fn defaults(person: &str) -> Value {
    match person {
        "jordan" => json!({
            "label": "Jordan Example",
            "about": "Multifamily acquisitions, 2-4 and 5+ units, in Los Angeles, Orange, San Diego and Riverside counties. A starting point; edit the boxes to fit.",
            "boxes": [
                {"id": "mf-core", "name": "Multifamily 5+ units", "f": {"types": ["Multifamily"], "counties": ["Los Angeles County", "Orange County", "San Diego County", "Riverside County"], "units_min": 5, "sort": "score"}},
                {"id": "mf-small", "name": "Small multifamily 2-4 units", "f": {"types": ["Multifamily"], "counties": ["Los Angeles County", "Orange County", "San Diego County", "Riverside County"], "units_min": 2, "units_max": 4, "price_max": 2500000, "sort": "score"}},
                {"id": "value-add", "name": "Value-add, 6%+ cap at market rent", "f": {"types": ["Multifamily", "Mixed use"], "counties": ["Los Angeles County", "Orange County", "San Diego County", "Riverside County"], "cap_min": 6, "sort": "cap"}}
            ]
        }),
        "riley" => json!({
            "label": "Riley Example",
            "about": "Industrial for sale and for lease in Orange, Los Angeles, Riverside and San Bernardino counties. A starting point; edit the boxes to fit.",
            "boxes": [
                {"id": "ind-oc-la", "name": "Industrial for sale 5,000 SF+", "f": {"types": ["Industrial"], "counties": ["Orange County", "Los Angeles County"], "sf_min": 5000, "sale_or_lease": "sale", "sort": "score"}},
                {"id": "ind-lease", "name": "Industrial for lease", "f": {"types": ["Industrial"], "counties": ["Orange County", "Los Angeles County", "Riverside County", "San Bernardino County"], "sale_or_lease": "lease", "sort": "newest"}},
                {"id": "ind-ie", "name": "Inland Empire industrial 10,000 SF+", "f": {"types": ["Industrial"], "counties": ["Riverside County", "San Bernardino County"], "sf_min": 10000, "sale_or_lease": "sale", "sort": "ppsf"}}
            ]
        }),
        _ => json!({
            "label": "Tanner",
            "about": "A smaller investor in the same deals: each listing shows the stake your Housing budget can take (LP or co-invest), your share of the cash flow, and the small deals you could buy whole.",
            "boxes": [
                {"id": "south-oc", "name": "South OC, any type", "f": {"zips": ["92629", "92624", "92672", "92673", "92677", "92675", "92651", "92656", "92691", "92692", "92694", "92688", "92653", "92630"], "sort": "score"}},
                {"id": "small-mf", "name": "Small multifamily to buy (2-4 units)", "f": {"types": ["Multifamily"], "counties": ["Orange County", "Riverside County", "San Bernardino County"], "units_min": 2, "units_max": 4, "sort": "score"}}
            ]
        }),
    }
}

/// True when a buy box asks for lease listings only.
fn lease_box(b: &Value) -> bool {
    b["f"]["sale_or_lease"] == "lease"
}

/// True when the deals file holds any lease listing.
fn has_lease(d: &Value) -> bool {
    d.get("deals").and_then(Value::as_array).is_some_and(|a| a.iter().any(|x| x.get("sale_or_lease").and_then(Value::as_str) == Some("lease")))
}

/// A default lease box shows only once the feed has lease rows, so a fresh desk never opens on a box that cannot match yet.
/// Saved boxes are the person's own and are never trimmed.
pub fn trim_defaults(prof: &mut Value, deals: &Value) {
    if prof.get("edited").is_some() || has_lease(deals) {
        return;
    }
    if let Some(a) = prof.get_mut("boxes").and_then(Value::as_array_mut) {
        a.retain(|b| !lease_box(b));
    }
}

fn text(v: Option<&Value>, max: usize) -> Result<String, &'static str> {
    let s = match v {
        None | Some(Value::Null) => return Ok(String::new()),
        Some(Value::String(s)) => s.trim(),
        Some(_) => return Err("not text"),
    };
    if s.chars().any(char::is_control) || s.contains(['<', '>']) {
        return Err("bad character");
    }
    if s.chars().count() > max {
        return Err("too long");
    }
    Ok(s.to_string())
}

fn id_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 24 && s.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

fn deal_id_ok(s: &str) -> bool {
    s.len() == 12 && s.bytes().all(|c| c.is_ascii_hexdigit())
}

/// A buy box's filters: only known keys, each checked. Unknown keys are refused so a typo never silently widens a box.
pub fn clean_filters(v: &Value) -> Result<Value, &'static str> {
    let o = v.as_object().ok_or("bad filters")?;
    let mut out = Map::new();
    for (k, val) in o {
        match k.as_str() {
            "types" => {
                let a = val.as_array().ok_or("bad types")?;
                if a.len() > TYPES.len() || !a.iter().all(|t| t.as_str().is_some_and(|t| TYPES.contains(&t))) {
                    return Err("bad types");
                }
                out.insert(k.clone(), val.clone());
            }
            "counties" => {
                let a = val.as_array().ok_or("bad counties")?;
                if a.len() > 12 {
                    return Err("bad counties");
                }
                for c in a {
                    let s = text(Some(c), 40)?;
                    if s.is_empty() || !s.chars().all(|ch| ch.is_alphanumeric() || " .'-".contains(ch)) {
                        return Err("bad counties");
                    }
                }
                out.insert(k.clone(), val.clone());
            }
            "zips" => {
                let a = val.as_array().ok_or("bad zips")?;
                if a.len() > 40 || !a.iter().all(|z| z.as_str().is_some_and(|z| (z.len() == 5 || z.len() == 3) && z.bytes().all(|c| c.is_ascii_digit()))) {
                    return Err("bad zips");
                }
                out.insert(k.clone(), val.clone());
            }
            // `dscr_min` (2026-11-14): a floor on the deal's DSCR at the assumed commercial rate (`dscr_cre`).
            // `units_max` (2026-11-17): a ceiling on units; like `units_min` it reads the listed count, else the estimate (`units_est`)
            "price_min" | "price_max" | "cap_min" | "units_min" | "units_max" | "sf_min" | "dom_max" | "score_min" | "dscr_min" => {
                if val.is_null() {
                    continue;
                }
                let n = val.as_f64().ok_or("bad number")?;
                if !n.is_finite() || !(0.0..=1e10).contains(&n) {
                    return Err("bad number");
                }
                out.insert(k.clone(), json!(n));
            }
            "q" => {
                let s = text(Some(val), 60)?;
                if !s.is_empty() {
                    out.insert(k.clone(), json!(s));
                }
            }
            // 2026-11-17: sale or lease listings only; a deal that does not say is a sale
            "sale_or_lease" => {
                if val.is_null() {
                    continue;
                }
                match val.as_str() {
                    Some(s @ ("sale" | "lease")) => {
                        out.insert(k.clone(), json!(s));
                    }
                    _ => return Err("bad sale_or_lease"),
                }
            }
            "sort" => {
                let s = val.as_str().ok_or("bad sort")?;
                if !SORTS.contains(&s) {
                    return Err("bad sort");
                }
                out.insert(k.clone(), json!(s));
            }
            _ => return Err("unknown filter"),
        }
    }
    Ok(Value::Object(out))
}

/// A validated POST.
#[derive(Debug, PartialEq)]
pub enum Change {
    Box { person: String, id: String, name: String, f: Value },
    Delete { person: String, id: String },
    Seen { person: String, id: String, ids: Vec<String> },
}

impl Change {
    pub fn person(&self) -> &str {
        match self {
            Change::Box { person, .. } | Change::Delete { person, .. } | Change::Seen { person, .. } => person,
        }
    }
}

pub fn parse(body: &[u8]) -> Result<Change, &'static str> {
    if body.len() > MAX_BODY {
        return Err("too large");
    }
    let v: Value = serde_json::from_slice(body).map_err(|_| "bad json")?;
    let o = v.as_object().ok_or("bad json")?;
    let person = text(o.get("person"), 10)?;
    if !person_ok(&person) {
        return Err("bad person");
    }
    let op = text(o.get("op"), 8)?;
    match op.as_str() {
        "box" => {
            let b = o.get("box").and_then(Value::as_object).ok_or("bad box")?;
            let id = text(b.get("id"), 24)?;
            let name = text(b.get("name"), 40)?;
            if !id_ok(&id) || name.is_empty() {
                return Err("bad box");
            }
            let f = clean_filters(b.get("f").unwrap_or(&Value::Null))?;
            Ok(Change::Box { person, id, name, f })
        }
        "delete" => {
            let id = text(o.get("id"), 24)?;
            if !id_ok(&id) {
                return Err("bad id");
            }
            Ok(Change::Delete { person, id })
        }
        "seen" => {
            let id = text(o.get("id"), 24)?;
            let a = o.get("ids").and_then(Value::as_array).ok_or("bad ids")?;
            if !id_ok(&id) || a.len() > MAX_SEEN {
                return Err("bad ids");
            }
            let ids: Option<Vec<String>> = a.iter().map(|x| x.as_str().filter(|s| deal_id_ok(s)).map(str::to_string)).collect();
            Ok(Change::Seen { person, id, ids: ids.ok_or("bad ids")? })
        }
        _ => Err("bad op"),
    }
}

pub fn load(file: &Path) -> Result<Map<String, Value>, String> {
    let raw = match std::fs::read(file) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(e) => return Err(format!("store unreadable: {}", e.kind())),
    };
    match serde_json::from_slice::<Value>(&raw) {
        Ok(Value::Object(m)) => Ok(m),
        _ => Err("store is not a JSON object".into()),
    }
}

fn save(file: &Path, store: &Map<String, Value>) -> Result<(), String> {
    let dir = file.parent().ok_or("no store directory")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("mkdir: {}", e.kind()))?;
    let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    let tmp = dir.join(format!(".cre-profiles.{}.tmp", std::process::id()));
    let body = serde_json::to_vec_pretty(&Value::Object(store.clone())).map_err(|_| "encode".to_string())?;
    let write = || -> std::io::Result<()> {
        let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&tmp)?;
        f.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        f.write_all(&body)?;
        f.sync_all()?;
        std::fs::rename(&tmp, file)
    };
    write().map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("write: {}", e.kind())
    })
}

/// The person's profile: the stored boxes, else the defaults; `seen` per box.
pub fn profile(store: &Map<String, Value>, person: &str) -> Value {
    let mut d = defaults(person);
    let mine = store.get("people").and_then(|p| p.get(person));
    if let Some(boxes) = mine.and_then(|m| m.get("boxes")).filter(|b| b.is_array()) {
        d["boxes"] = boxes.clone();
        d["edited"] = json!(true);
    }
    d["seen"] = mine.and_then(|m| m.get("seen")).cloned().unwrap_or_else(|| json!({}));
    d["person"] = json!(person);
    d
}

pub fn apply(file: &Path, c: &Change, now: u64) -> Result<Value, (u16, String)> {
    let _g = LOCK.lock().map_err(|_| (500, "store lock poisoned".to_string()))?;
    let mut store = load(file).map_err(|e| (500, e))?;
    let person = c.person().to_string();
    let current = profile(&store, &person);
    let mut boxes: Vec<Value> = current["boxes"].as_array().cloned().unwrap_or_default();
    let mut seen = current["seen"].as_object().cloned().unwrap_or_default();
    match c {
        Change::Box { id, name, f, .. } => {
            let b = json!({"id": id, "name": name, "f": f, "t": now});
            match boxes.iter().position(|x| x["id"] == json!(id)) {
                Some(i) => boxes[i] = b,
                None if boxes.len() >= MAX_BOXES => return Err((409, format!("at most {MAX_BOXES} buy boxes"))),
                None => boxes.push(b),
            }
        }
        Change::Delete { id, .. } => {
            boxes.retain(|x| x["id"] != json!(id));
            seen.remove(id);
        }
        Change::Seen { id, ids, .. } => {
            if !boxes.iter().any(|x| x["id"] == json!(id)) {
                return Err((404, "no such buy box".into()));
            }
            seen.insert(id.clone(), json!({"ids": ids, "t": now}));
        }
    }
    let people = store.entry("people").or_insert_with(|| json!({}));
    if !people.is_object() {
        *people = json!({});
    }
    people[&person] = json!({"boxes": boxes, "seen": seen, "t": now});
    save(file, &store).map_err(|e| (500, e))?;
    Ok(profile(&store, &person))
}

/// The deals file, parsed once per change of its modification time.
pub fn deals(home: &Path) -> Arc<Value> {
    let path = home.join(DEALS_REL);
    let mtime = std::fs::metadata(&path).and_then(|m| m.modified()).ok();
    if let (Some(m), Ok(g)) = (mtime, DEALS.lock()) {
        if let Some((t, v)) = g.as_ref() {
            if *t == m {
                return v.clone();
            }
        }
    }
    let v = match std::fs::read(&path) {
        Ok(b) => serde_json::from_slice::<Value>(&b).unwrap_or_else(|_| json!({"status": "not_reporting", "reason": "the deals file is not valid JSON"})),
        Err(_) => json!({"status": "not_reporting", "reason": "the realestate collector has not written the deal desk yet"}),
    };
    let v = Arc::new(v);
    if let (Some(m), Ok(mut g)) = (mtime, DEALS.lock()) {
        *g = Some((m, v.clone()));
    }
    v
}

fn store_path(home: &Path) -> PathBuf {
    home.join(REL)
}

/// GET: `person` is the desk to show. `viewer` is Some(person) for a viewer token, which pins the person and hides the
/// list of other desks. Returns (status, body).
pub async fn route(home: &Path, post: bool, person: &str, viewer: bool, body: Option<bytes::Bytes>) -> (u16, Value) {
    let file = store_path(home);
    let now = crate::util::now_epoch();
    if !post {
        if !person_ok(person) {
            return (400, json!({"error": "bad person"}));
        }
        let p = person.to_string();
        let h = home.to_path_buf();
        let got = tokio::task::spawn_blocking(move || (load(&file).map(|s| profile(&s, &p)), deals(&h))).await;
        let Ok((prof, d)) = got else { return (500, json!({"error": "read failed"})) };
        let mut prof = match prof {
            Ok(p) => p,
            Err(e) => return (500, json!({"error": e})),
        };
        trim_defaults(&mut prof, &d);
        let mut out = json!({"person": person, "profile": prof, "viewer": viewer, "t": now, "types": TYPES, "sorts": SORTS});
        if !viewer {
            out["people"] = json!(PEOPLE.iter().map(|p| json!({"id": p, "label": defaults(p)["label"]})).collect::<Vec<_>>());
            // the owner's co-invest view reads the other desks' buy boxes (never their seen lists)
            let store = load(&store_path(home)).unwrap_or_default();
            out["boxes_of"] = json!(VIEWERS.iter().map(|p| (p.to_string(), profile(&store, p)["boxes"].clone())).collect::<Map<String, Value>>());
        }
        // `zips` (2026-11-17): the ZIP facts the deal sheet shows, once per ZIP instead of on every deal
        for k in ["generated_at", "rates", "assumptions", "method", "counts", "sources_note", "deals", "zips", "status", "reason"] {
            if let Some(v) = d.get(k) {
                out[k] = v.clone();
            }
        }
        return (200, out);
    }
    let Some(b) = body else { return (400, json!({"ok": false, "error": "bad json"})) };
    let c = match parse(&b) {
        Ok(c) => c,
        Err(e) => return (if e == "too large" { 413 } else { 400 }, json!({"ok": false, "error": e})),
    };
    if c.person() != person {
        return (403, json!({"ok": false, "error": "not your desk"}));
    }
    match tokio::task::spawn_blocking(move || apply(&file, &c, now)).await {
        Ok(Ok(p)) => (200, json!({"ok": true, "profile": p, "t": now})),
        Ok(Err((code, e))) => (code, json!({"ok": false, "error": e})),
        Err(_) => (500, json!({"ok": false, "error": "store write failed"})),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_refuse_unknown_keys_and_bad_values() {
        assert!(clean_filters(&json!({"types": ["Industrial"], "sf_min": 5000, "sort": "score"})).is_ok());
        assert_eq!(clean_filters(&json!({"typez": ["Industrial"]})), Err("unknown filter"));
        assert_eq!(clean_filters(&json!({"types": ["Castle"]})), Err("bad types"));
        assert_eq!(clean_filters(&json!({"cap_min": -1})), Err("bad number"));
        assert_eq!(clean_filters(&json!({"zips": ["9262"]})), Err("bad zips"));
        assert_eq!(clean_filters(&json!({"counties": ["<script>"]})), Err("bad character"));
        assert_eq!(clean_filters(&json!({"sort": "random"})), Err("bad sort"));
        // DSCR floor: optional, a number of 0 or more, null drops it like the other minimums
        assert_eq!(clean_filters(&json!({"dscr_min": 1.25})), Ok(json!({"dscr_min": 1.25})));
        assert_eq!(clean_filters(&json!({"dscr_min": 0})), Ok(json!({"dscr_min": 0.0})));
        assert_eq!(clean_filters(&json!({"dscr_min": null, "types": ["Retail"]})), Ok(json!({"types": ["Retail"]})));
        for bad in [json!({"dscr_min": -0.5}), json!({"dscr_min": "1.2"}), json!({"dscr_min": [1]})] {
            assert_eq!(clean_filters(&bad), Err("bad number"), "{bad}");
        }
        assert_eq!(clean_filters(&json!({"dscr": 1.2})), Err("unknown filter"), "the key is dscr_min");
        // units ceiling and sale or lease (2026-11-17)
        assert_eq!(clean_filters(&json!({"units_min": 2, "units_max": 4})), Ok(json!({"units_min": 2.0, "units_max": 4.0})));
        assert_eq!(clean_filters(&json!({"units_max": null})), Ok(json!({})));
        for bad in [json!({"units_max": -1}), json!({"units_max": "4"}), json!({"units_max": 1e11})] {
            assert_eq!(clean_filters(&bad), Err("bad number"), "{bad}");
        }
        assert_eq!(clean_filters(&json!({"sale_or_lease": "lease"})), Ok(json!({"sale_or_lease": "lease"})));
        assert_eq!(clean_filters(&json!({"sale_or_lease": "sale"})), Ok(json!({"sale_or_lease": "sale"})));
        assert_eq!(clean_filters(&json!({"sale_or_lease": null})), Ok(json!({})));
        for bad in [json!({"sale_or_lease": "rent"}), json!({"sale_or_lease": 1}), json!({"sale_or_lease": "Lease"})] {
            assert_eq!(clean_filters(&bad), Err("bad sale_or_lease"), "{bad}");
        }
        assert_eq!(clean_filters(&json!({"units_maximum": 4})), Err("unknown filter"));
        // a save body with and without the floor
        let with = parse(br#"{"person":"jordan","op":"box","box":{"id":"mf-dscr","name":"Covers debt","f":{"types":["Multifamily"],"dscr_min":1.2}}}"#);
        assert!(matches!(&with, Ok(Change::Box { f, .. }) if f["dscr_min"] == 1.2), "{with:?}");
        let without = parse(br#"{"person":"jordan","op":"box","box":{"id":"mf","name":"Any","f":{"types":["Multifamily"]}}}"#);
        assert!(matches!(&without, Ok(Change::Box { f, .. }) if f.get("dscr_min").is_none()), "{without:?}");
        assert_eq!(parse(br#"{"person":"jordan","op":"box","box":{"id":"x","name":"x","f":{"dscr_min":-1}}}"#), Err("bad number"));
    }

    #[test]
    fn parse_checks_person_op_and_ids() {
        let ok = br#"{"person":"riley","op":"box","box":{"id":"ind-2","name":"Flex","f":{"types":["Industrial"]}}}"#;
        assert!(matches!(parse(ok), Ok(Change::Box { .. })));
        assert_eq!(parse(br#"{"person":"morgan","op":"box"}"#), Err("bad person"));
        assert_eq!(parse(br#"{"person":"riley","op":"seen","id":"ind-2","ids":["nothex"]}"#), Err("bad ids"));
        assert_eq!(parse(br#"{"person":"riley","op":"nuke"}"#), Err("bad op"));
        assert_eq!(parse(br#"{"person":"riley","op":"box","box":{"id":"Bad Id","name":"x","f":{}}}"#), Err("bad box"));
    }

    #[test]
    fn boxes_save_delete_and_seen_round_trip() {
        let dir = std::env::temp_dir().join(format!("pdeck-cre-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let file = dir.join("cre.json");
        // defaults first
        let p = profile(&load(&file).unwrap_or_default(), "jordan");
        assert_eq!(p["boxes"][0]["f"]["types"][0], "Multifamily");
        let add = parse(br#"{"person":"jordan","op":"box","box":{"id":"sd-mf","name":"SD 10+","f":{"types":["Multifamily"],"units_min":10}}}"#).unwrap_or_else(|e| panic!("{e}"));
        let p = apply(&file, &add, 1).unwrap_or_else(|e| panic!("{e:?}"));
        assert_eq!(p["boxes"].as_array().map(Vec::len), Some(4), "defaults kept, one added");
        let seen = parse(br#"{"person":"jordan","op":"seen","id":"sd-mf","ids":["0123456789ab"]}"#).unwrap_or_else(|e| panic!("{e}"));
        let p = apply(&file, &seen, 2).unwrap_or_else(|e| panic!("{e:?}"));
        assert_eq!(p["seen"]["sd-mf"]["ids"][0], "0123456789ab");
        let del = parse(br#"{"person":"jordan","op":"delete","id":"sd-mf"}"#).unwrap_or_else(|e| panic!("{e}"));
        let p = apply(&file, &del, 3).unwrap_or_else(|e| panic!("{e:?}"));
        assert_eq!(p["boxes"].as_array().map(Vec::len), Some(3));
        assert!(p["seen"].get("sd-mf").is_none());
        // another person's store is untouched
        assert!(profile(&load(&file).unwrap_or_default(), "riley").get("edited").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
    #[tokio::test]
    async fn viewer_is_pinned_to_own_profile_and_cannot_write_other_desks() {
        let home = std::env::temp_dir().join(format!("pdeck-cre-viewer-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);

        let (code, view) = route(&home, false, "jordan", true, None).await;
        assert_eq!(code, 200);
        assert_eq!(view["person"], "jordan");
        assert_eq!(view["viewer"], true);
        assert!(view.get("people").is_none());
        assert!(view.get("boxes_of").is_none());

        let body = bytes::Bytes::from_static(
            br#"{"person":"riley","op":"box","box":{"id":"ind-3","name":"Industrial","f":{"types":["Industrial"]}}}"#,
        );
        let (code, result) = route(&home, true, "jordan", true, Some(body)).await;
        assert_eq!(code, 403);
        assert_eq!(result["error"], "not your desk");
        assert!(!home.join(REL).exists(), "a refused write must not create a profile");

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn default_boxes_are_valid_and_cover_each_desk() {
        let names = |p: &str| -> Vec<String> { defaults(p)["boxes"].as_array().map(|a| a.iter().map(|b| b["name"].as_str().unwrap_or("").to_string()).collect()).unwrap_or_default() };
        for p in PEOPLE {
            let d = defaults(p);
            let boxes = d["boxes"].as_array().cloned().unwrap_or_default();
            assert!(!boxes.is_empty() && boxes.len() <= MAX_BOXES, "{p}");
            for b in &boxes {
                // a default box saves unchanged through the same checks as an edited one
                let id = b["id"].as_str().unwrap_or("");
                let name = b["name"].as_str().unwrap_or("");
                assert!(id_ok(id) && !name.is_empty() && name.chars().count() <= 40, "{p} {b}");
                assert!(clean_filters(&b["f"]).is_ok(), "{p} {b}");
            }
        }
        assert_eq!(defaults("jordan")["label"], "Jordan Example");
        assert_eq!(names("jordan"), ["Multifamily 5+ units", "Small multifamily 2-4 units", "Value-add, 6%+ cap at market rent"]);
        assert_eq!(names("riley"), ["Industrial for sale 5,000 SF+", "Industrial for lease", "Inland Empire industrial 10,000 SF+"]);
        assert_eq!(names("tanner"), ["South OC, any type", "Small multifamily to buy (2-4 units)"]);
        let small = &defaults("jordan")["boxes"][1]["f"];
        assert_eq!((small["units_min"].as_f64(), small["units_max"].as_f64(), small["price_max"].as_f64()), (Some(2.0), Some(4.0), Some(2_500_000.0)));
        let counties = defaults("jordan")["boxes"][0]["f"]["counties"].clone();
        assert_eq!(counties, json!(["Los Angeles County", "Orange County", "San Diego County", "Riverside County"]));
    }

    #[test]
    fn the_lease_default_waits_for_lease_rows_and_saved_boxes_are_never_trimmed() {
        let no_lease = json!({"deals": [{"id": "0123456789ab", "type": "Industrial"}]});
        let lease = json!({"deals": [{"id": "0123456789ab", "type": "Industrial", "sale_or_lease": "lease"}]});
        let ids = |p: &Value| -> Vec<String> { p["boxes"].as_array().map(|a| a.iter().map(|b| b["id"].as_str().unwrap_or("").to_string()).collect()).unwrap_or_default() };
        let mut p = profile(&Map::new(), "riley");
        trim_defaults(&mut p, &no_lease);
        assert_eq!(ids(&p), ["ind-oc-la", "ind-ie"]);
        let mut p = profile(&Map::new(), "riley");
        trim_defaults(&mut p, &lease);
        assert_eq!(ids(&p), ["ind-oc-la", "ind-lease", "ind-ie"]);
        // a store written before 2026-11-17 (old default names, no new keys) loads as saved, lease box and all
        let old: Map<String, Value> = serde_json::from_value(json!({"people": {
            "riley": {"boxes": [{"id": "ind-oc-la", "name": "Industrial 5,000 SF+", "f": {"types": ["Industrial"], "sf_min": 5000.0}},
                               {"id": "mine", "name": "Mine", "f": {"sale_or_lease": "lease"}}], "seen": {"ind-oc-la": {"ids": [], "t": 1}}},
            "tanner": {"boxes": [{"id": "all-oc", "name": "Orange County, any type", "f": {"counties": ["Orange County"]}}]}}}))
        .unwrap_or_default();
        let mut p = profile(&old, "riley");
        trim_defaults(&mut p, &no_lease);
        assert_eq!(ids(&p), ["ind-oc-la", "mine"]);
        assert_eq!(p["edited"], true);
        assert!(p["seen"].get("ind-oc-la").is_some());
        assert_eq!(ids(&profile(&old, "tanner")), ["all-oc"]);
        assert_eq!(ids(&profile(&old, "jordan")), ["mf-core", "mf-small", "value-add"], "a person with no saved boxes gets the new defaults");
    }
}
