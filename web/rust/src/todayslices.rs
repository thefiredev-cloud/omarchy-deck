//! Today reads slices, not whole feeds (round "Better" item 7, SeePerf P2). The Today glance used to download the whole
//! Surf overview (about 1 MB), the whole Shop market feed (about 260 KB) and the whole Real estate feed (about 1.9 MB) for
//! three tiles. `/api/today` now carries the three cuts those tiles read, built on the server from the same answers the
//! full routes serve:
//! - `surf_best`: the Surf overview's own keys (`t`, `age`, `stale`, `refresh`, `errors`, `status`, `reason`, ...);
//!   `regions` cut to `{id, name, wave_ft}` for the regions that hold a pinned spot (a pinned spot whose `now.height_basis`
//!   is `region` prints its region's height, decision 4); `spots` holds every pinned home spot with `id`, `name`,
//!   `region`, `pinned` and `now` (no hourly days), then every other spot of those regions as
//!   `{id, region, pinned: null, now: {confidence: {model_only}}}`, `now` only when the feed has `model_only` (the tile
//!   marks a region forecast-only when every spot of it is). No spot outside those regions. Shape agreed with lane
//!   `DoToday2`; at most `MAX_REGIONS` regions and `MAX_SPOTS` spots;
//! - `shop_moves`: the Shop market feed's own keys with `watches.items` cut to `slug`, `label`, `category`, `median`,
//!   `change_7d`, `change_30d`, `confidence`, `best`, `best_used` and `best_reason` (the tile names the best new and used
//!   price), and none of its other lists;
//! - `home_area`: `{zip, name}` of the Real estate feed's home market (`market.residential.areas`, tier `home`, else the
//!   first area), or `{zip: null, reason}` saying why there is none.
//!
//! A feed that is not reporting stays not reporting in its slice, with its reason, so a tile still says why it is missing.
use serde_json::{json, Map, Value};

/// Keys of a spot the glance tile reads.
const SPOT_KEYS: [&str; 5] = ["id", "name", "region", "pinned", "now"];
/// Keys of a watch the glance tile reads.
const WATCH_KEYS: [&str; 10] =
    ["slug", "label", "category", "median", "change_7d", "change_30d", "confidence", "best", "best_used", "best_reason"];
/// List keys that stay in a slice: they are small and say why a feed is short (`errors`, `gaps`, `src`).
const KEEP_LISTS: [&str; 3] = ["errors", "gaps", "src"];
/// Bounds of the Surf cut (14 regions and about 250 spots exist on the whole coast).
pub const MAX_REGIONS: usize = 14;
pub const MAX_SPOTS: usize = 300;

fn pick(o: &Map<String, Value>, keys: &[&str]) -> Value {
    Value::Object(keys.iter().filter_map(|k| o.get(*k).map(|v| (k.to_string(), v.clone()))).collect())
}

/// A feed's own top-level scalars and small objects (`t`, `age`, `stale`, `status`, `reason`, `coverage`, `method` ...)
/// and the small lists in `KEEP_LISTS`; every other list is left out.
fn head(feed: &Map<String, Value>, also_skip: &[&str]) -> Map<String, Value> {
    feed.iter()
        .filter(|(k, v)| !also_skip.contains(&k.as_str()) && (!v.is_array() || KEEP_LISTS.contains(&k.as_str())))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect()
}

/// The pinned home spots of the Surf overview with what the glance reads, their regions' heights, and the other spots
/// of those regions cut to the one mark the tile reads from them.
pub fn surf_best(overview: &Value) -> Value {
    let Some(o) = overview.as_object() else { return json!({"status": "not_reporting", "reason": "no surf overview"}) };
    let mut out = head(o, &["water"]);
    let all: Vec<&Map<String, Value>> = o.get("spots").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_object).collect();
    let pinned = |s: &Map<String, Value>| s.get("pinned").is_some_and(|p| !p.is_null());
    let region_of = |s: &Map<String, Value>| s.get("region").and_then(Value::as_str).map(str::to_string);
    let home: Vec<&Map<String, Value>> = all.iter().copied().filter(|s| pinned(s)).collect();
    let mut held: Vec<String> = Vec::new();
    for r in home.iter().filter_map(|s| region_of(s)) {
        if !held.contains(&r) {
            held.push(r);
        }
    }
    let mut spots: Vec<Value> = home.iter().map(|s| pick(s, &SPOT_KEYS)).collect();
    // a text field as text, cut: never a nested value copied whole
    let text = |v: Option<&Value>, n: usize| -> Value {
        v.and_then(Value::as_str).map_or(Value::Null, |s| Value::String(s.chars().filter(|c| !c.is_control()).take(n).collect()))
    };
    let model_only = |s: &Map<String, Value>| s.get("now").and_then(|n| n.get("confidence")).and_then(|c| c.get("model_only")).cloned();
    let others: Vec<&Map<String, Value>> = all.iter().copied().filter(|s| !pinned(s) && region_of(s).is_some_and(|r| held.contains(&r))).collect();
    // Witnesses first: a spot that is not model_only decides the region's forecast-only mark (the tile reads
    // `every(model_only)`), so one witness of each region, then the other witnesses, then the rest, before the cut.
    let witness = |s: &Map<String, Value>| model_only(s) != Some(Value::Bool(true));
    let mut order: Vec<usize> = Vec::with_capacity(others.len());
    for r in &held {
        if let Some(i) = others.iter().position(|s| witness(s) && region_of(s).as_ref() == Some(r)) {
            order.push(i);
        }
    }
    order.extend((0..others.len()).filter(|i| witness(others[*i]) && !order.contains(i)).collect::<Vec<_>>());
    order.extend((0..others.len()).filter(|i| !witness(others[*i])));
    for s in order.into_iter().map(|i| others[i]) {
        let mut row = json!({"id": text(s.get("id"), 64), "region": text(s.get("region"), 64), "pinned": null});
        // `model_only` only when the feed has it, `now` left out otherwise: `=== true` reads the same as on the full feed
        if let Some(m) = model_only(s) {
            row["now"] = json!({"confidence": {"model_only": m}});
        }
        spots.push(row);
    }
    spots.truncate(MAX_SPOTS);
    if o.contains_key("spots") {
        out.insert("spots".into(), Value::Array(spots));
    }
    if let Some(rs) = o.get("regions").and_then(Value::as_array) {
        let regions: Vec<Value> = rs
            .iter()
            .filter_map(Value::as_object)
            .filter(|r| r.get("id").and_then(Value::as_str).is_some_and(|id| held.iter().any(|h| h == id)))
            .take(MAX_REGIONS)
            .map(|r| json!({"id": text(r.get("id"), 64), "name": text(r.get("name"), 40), "wave_ft": r.get("wave_ft").cloned().unwrap_or(Value::Null)}))
            .collect();
        out.insert("regions".into(), Value::Array(regions));
    }
    Value::Object(out)
}

/// The Shop market feed's watches, each with what the glance reads.
pub fn shop_moves(feed: &Value) -> Value {
    let Some(o) = feed.as_object() else { return json!({"status": "not_reporting", "reason": "no shop market feed"}) };
    let mut out = head(o, &["watches"]);
    if let Some(w) = o.get("watches").and_then(Value::as_object) {
        let mut wo = head(w, &["items"]);
        let items: Vec<Value> = w.get("items").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_object).map(|x| pick(x, &WATCH_KEYS)).collect();
        wo.insert("items".into(), Value::Array(items));
        out.insert("watches".into(), Value::Object(wo));
    }
    Value::Object(out)
}

/// The home market of the Real estate feed: `{zip, name}`, or `{zip: null, reason}` when the feed names none with a
/// five-digit ZIP or is not reporting.
pub fn home_area(realestate: &Value) -> Value {
    let none = |why: &str| json!({"zip": null, "reason": why});
    if let Some(e) = realestate.get("error").and_then(Value::as_str) {
        return none(&format!("the Real estate feed is not reporting: {}", e.chars().take(80).collect::<String>()));
    }
    if realestate.get("status").and_then(Value::as_str) == Some("not_reporting") {
        return none("the Real estate feed is not reporting");
    }
    let areas: Vec<&Map<String, Value>> =
        realestate.pointer("/market/residential/areas").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_object).collect();
    let Some(a) = areas.iter().find(|a| a.get("tier").and_then(Value::as_str) == Some("home")).or(areas.first()) else {
        return none("the Real estate feed names no home market");
    };
    let zip = match a.get("zip") {
        Some(Value::String(z)) => z.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    };
    if zip.len() != 5 || !zip.bytes().all(|b| b.is_ascii_digit()) {
        return none("the home market has no five-digit ZIP");
    }
    let name: String = a.get("name").and_then(Value::as_str).unwrap_or("").chars().filter(|c| !c.is_control()).take(40).collect();
    json!({"zip": zip, "name": name})
}

/// Adds the three slices to a built `/api/today` answer.
pub fn attach(today: &mut Value, surf: &Value, shop: &Value, realestate: &Value) {
    if let Some(o) = today.as_object_mut() {
        o.insert("surf_best".into(), surf_best(surf));
        o.insert("shop_moves".into(), shop_moves(shop));
        o.insert("home_area".into(), home_area(realestate));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The Today Surf tile's reader (`tdSurfTile`, PR #392) ported line for line: (header, height, forecast-only) or none.
    fn tile(s: &Value) -> Option<(String, String, bool)> {
        let num = |v: &Value| v.as_f64();
        let spots: Vec<&Value> = s["spots"].as_array().into_iter().flatten().collect();
        let home: Vec<&Value> = spots.iter().copied().filter(|x| num(&x["pinned"]).is_some() && x["now"].is_object() && num(&x["now"]["wave_ft"][0]).is_some()).collect();
        let r = |x: &Value| num(&x["now"]["rating"]).unwrap_or(-1.0);
        let best = home.iter().copied().min_by(|a, b| r(b).partial_cmp(&r(a)).unwrap_or(std::cmp::Ordering::Equal).then((num(&a["pinned"]).unwrap_or(0.0)).total_cmp(&num(&b["pinned"]).unwrap_or(0.0))))?;
        let ht = |w: &Value| -> Option<String> {
            let lo = num(&w[0])?.round();
            let hi = num(&w[1]).map(f64::round).unwrap_or(lo);
            Some(if lo == hi { format!("{lo}") } else { format!("{lo}-{hi}") })
        };
        let mo = |x: &Value| x["now"]["confidence"]["model_only"] == json!(true);
        let own = matches!(best["now"]["height_basis"].as_str(), Some("spot" | "sensor"));
        if own {
            return Some((best["name"].as_str().unwrap_or("").to_string(), ht(&best["now"]["wave_ft"])?, mo(best)));
        }
        let rg = s["regions"].as_array().into_iter().flatten().find(|x| x["id"] == best["region"])?;
        let h = ht(&rg["wave_ft"])?;
        let model = spots.iter().filter(|x| x["region"] == best["region"]).all(|x| mo(x));
        Some((rg["name"].as_str().or(rg["id"].as_str()).unwrap_or("").to_string(), h, model))
    }

    fn coast(other_model_only: Option<bool>, basis: &str) -> Value {
        let mut other = json!({"id": "t-street", "name": "T Street", "region": "orange-county", "pinned": null, "now": {"wave_ft": [2, 3], "rating": 4}, "days": [1, 2]});
        if let Some(m) = other_model_only {
            other["now"]["confidence"] = json!({"level": "low", "score": 0.3, "sources": 1, "model_only": m});
        }
        json!({"t": 1, "age": 60, "stale": false, "refresh": 1800, "errors": [{"source": "x"}],
            "regions": [{"id": "orange-county", "name": "Orange County", "order": 4, "wave_ft": [4, 5], "swell": {"ft": 3}, "best": {"spot": "a"}},
                        {"id": "baja-sur", "name": "Baja Sur", "wave_ft": [7, 9]}],
            "buoys": [1, 2], "water": {"big": true}, "tides": [1],
            "spots": [
                {"id": "a", "name": "Salt Creek", "region": "orange-county", "pinned": 1, "days": [1, 2, 3], "best": {},
                 "now": {"wave_ft": [3, 4], "rating": 6, "word": "Fair", "height_basis": basis, "confidence": {"model_only": true}}},
                {"id": "c", "name": "Doheny", "region": "orange-county", "pinned": 2, "now": {"wave_ft": [2], "rating": 4, "height_basis": basis, "confidence": {"model_only": true}}},
                other,
                {"id": "cabo", "name": "Cabo", "region": "baja-sur", "pinned": null, "now": {"wave_ft": [8], "confidence": {"model_only": false}}}
            ]})
    }

    #[test]
    fn surf_keeps_what_the_tile_reads_for_spot_and_region_heights() {
        let s = surf_best(&coast(Some(false), "region"));
        // regions: only those holding a pinned spot, three keys
        assert_eq!(s["regions"], json!([{"id": "orange-county", "name": "Orange County", "wave_ft": [4, 5]}]));
        // spots: the pinned ones whole, then the region's others with the one mark, nothing from other regions
        let ids: Vec<&str> = s["spots"].as_array().into_iter().flatten().filter_map(|x| x["id"].as_str()).collect();
        assert_eq!(ids, ["a", "c", "t-street"]);
        assert_eq!(s["spots"][0]["now"]["height_basis"], "region");
        assert!(s["spots"][0].get("days").is_none());
        assert_eq!(s["spots"][2], json!({"id": "t-street", "region": "orange-county", "pinned": null, "now": {"confidence": {"model_only": false}}}));
        // no model_only in the feed: no `now` in the cut, so `=== true` reads the same
        assert_eq!(surf_best(&coast(None, "region"))["spots"][2], json!({"id": "t-street", "region": "orange-county", "pinned": null}));
        assert_eq!((s["t"].clone(), s["stale"].clone(), s["errors"][0]["source"].clone()), (json!(1), json!(false), json!("x")));
        for gone in ["buoys", "water", "tides"] {
            assert!(s.get(gone).is_none(), "{gone}");
        }
        // not reporting stays not reporting, with its reason
        let nr = surf_best(&json!({"status": "not_reporting", "reason": "surf is not reporting yet"}));
        assert_eq!(nr, json!({"status": "not_reporting", "reason": "surf is not reporting yet"}));
    }

    /// One reader, two inputs: the tile drawn from the slice is the tile drawn from the whole feed.
    #[test]
    fn the_tile_reads_the_same_from_the_slice_and_from_the_feed() {
        for (m, basis) in [(Some(false), "region"), (Some(true), "region"), (None, "region"), (Some(false), "spot"), (Some(true), "sensor")] {
            let full = coast(m, basis);
            let t = tile(&full);
            assert!(t.is_some(), "{m:?} {basis}");
            assert_eq!(tile(&surf_best(&full)), t, "{m:?} {basis}");
        }
        // a region basis reads the region's height and name; forecast-only only when every spot of the region is
        assert_eq!(tile(&surf_best(&coast(Some(true), "region"))), Some(("Orange County".into(), "4-5".into(), true)));
        assert_eq!(tile(&surf_best(&coast(Some(false), "region"))), Some(("Orange County".into(), "4-5".into(), false)));
        assert_eq!(tile(&surf_best(&coast(Some(false), "spot"))), Some(("Salt Creek".into(), "3-4".into(), true)));
        // the region has no height: no figure is claimed, from either input
        let mut bare = coast(Some(false), "region");
        bare["regions"][0]["wave_ft"] = Value::Null;
        assert_eq!((tile(&bare), tile(&surf_best(&bare))), (None, None));
    }

    /// A region with more spots than the cut, its only witness (a spot that is not model_only) last in the feed, and a
    /// second region whose witness sits behind 400 of the first region's: each region keeps its witness, so the
    /// forecast-only mark reads the same from the slice as from the feed.
    #[test]
    fn a_late_witness_survives_the_cut() {
        let mut feed = coast(Some(true), "region");
        let mo = |id: String, region: &str, m: bool| json!({"id": id, "region": region, "pinned": null, "now": {"confidence": {"model_only": m}}});
        let mut extra: Vec<Value> = (0..600).map(|i| mo(format!("m{i}"), "orange-county", true)).collect();
        extra.push(mo("late".into(), "orange-county", false));
        if let Some(a) = feed["spots"].as_array_mut() {
            a.extend(extra);
        }
        let full_tile = tile(&feed);
        assert_eq!(full_tile.as_ref().map(|t| t.2), Some(false), "the late witness makes the region not forecast-only");
        let s = surf_best(&feed);
        assert_eq!(s["spots"].as_array().map(Vec::len), Some(MAX_SPOTS));
        assert_eq!(tile(&s), full_tile);
        // two regions: the second region's late witness is kept behind 400 witnesses of the first
        let mut two = json!({"regions": [{"id": "a", "name": "A", "wave_ft": [3, 4]}, {"id": "b", "name": "B", "wave_ft": [5, 6]}],
            "spots": [{"id": "pa", "name": "PA", "region": "a", "pinned": 1, "now": {"wave_ft": [3], "rating": 2, "height_basis": "region", "confidence": {"model_only": true}}},
                      {"id": "pb", "name": "PB", "region": "b", "pinned": 2, "now": {"wave_ft": [5], "rating": 9, "height_basis": "region", "confidence": {"model_only": true}}}]});
        if let Some(a) = two["spots"].as_array_mut() {
            a.extend((0..400).map(|i| mo(format!("a{i}"), "a", false)));
            a.extend((0..50).map(|i| mo(format!("b{i}"), "b", true)));
            a.push(mo("b-late".into(), "b", false));
        }
        let s2 = surf_best(&two);
        assert!(s2["spots"].as_array().is_some_and(|a| a.iter().any(|x| x["id"] == "b-late")), "region b keeps its witness");
        assert_eq!(tile(&s2), tile(&two));
        assert_eq!(tile(&two).map(|t| (t.0, t.2)), Some(("B".to_string(), false)));
    }

    #[test]
    fn region_names_and_spot_ids_are_text_cut_to_size() {
        let mut feed = coast(Some(false), "region");
        feed["regions"][0]["name"] = json!("N".repeat(100));
        feed["spots"][2]["id"] = json!({"nested": "x".repeat(500)});
        let s = surf_best(&feed);
        assert_eq!(s["regions"][0]["name"].as_str().map(|n| n.chars().count()), Some(40));
        assert!(s["spots"][2]["id"].is_null(), "a non-text id is never copied");
        assert_eq!(s["spots"][2]["region"], "orange-county");
    }

    #[test]
    fn the_surf_cut_is_bounded() {
        let mut big = coast(Some(false), "region");
        let extra: Vec<Value> = (0..600)
            .map(|i| json!({"id": format!("s{i}"), "name": "x".repeat(40), "region": "orange-county", "pinned": null,
                "now": {"wave_ft": [1, 2], "confidence": {"model_only": false, "level": "low"}}, "days": [[1, 2, 3, 4, 5, 6]]}))
            .collect();
        if let Some(a) = big["spots"].as_array_mut() {
            a.extend(extra);
        }
        let s = surf_best(&big);
        assert_eq!(s["spots"].as_array().map(Vec::len), Some(MAX_SPOTS));
        assert!(s["regions"].as_array().is_some_and(|r| r.len() <= MAX_REGIONS));
        let bytes = s.to_string().len();
        assert!(bytes < 40 * 1024, "{bytes} bytes");
    }

    #[test]
    fn shop_keeps_the_watch_moves_only() {
        let f = json!({"t": 1, "generated_at": "2026-11-15T00:00:00Z", "errors": [], "macro": [1], "movers": [1], "bestsellers": [1],
            "watches": {"as_of": "2026-11-15", "window_days": 30, "items": [
                {"slug": "rtx-4080", "label": "rtx 4080", "median": 999.0, "change_7d": -4.2, "change_30d": -6.0, "hist": [1, 2, 3], "detail": {"x": 1},
                 "best": {"price": 949.0, "site": "eBay"}, "best_used": {"price": 780.0, "condition": "used"}, "best_reason": null}
            ]}});
        let s = shop_moves(&f);
        // the tile reads best.price, best_used.price and best_used.condition (Today PR #376)
        assert_eq!(s["watches"]["items"][0], json!({"slug": "rtx-4080", "label": "rtx 4080", "median": 999.0, "change_7d": -4.2, "change_30d": -6.0,
            "best": {"price": 949.0, "site": "eBay"}, "best_used": {"price": 780.0, "condition": "used"}, "best_reason": null}));
        assert_eq!((s["watches"]["as_of"].as_str(), s["watches"]["window_days"].as_u64()), (Some("2026-11-15"), Some(30)));
        for gone in ["macro", "movers", "bestsellers"] {
            assert!(s.get(gone).is_none(), "{gone}");
        }
        assert_eq!(s["generated_at"], "2026-11-15T00:00:00Z");
        assert_eq!(shop_moves(&json!({"error": "x"})), json!({"error": "x"}));
    }

    #[test]
    fn home_area_is_the_home_tier_or_the_first_area() {
        let re = |areas: Value| json!({"market": {"residential": {"areas": areas}}, "homes": [1, 2]});
        assert_eq!(home_area(&re(json!([{"zip": "92672", "name": "San Clemente"}, {"zip": "92629", "name": "Dana Point", "tier": "home"}]))), json!({"zip": "92629", "name": "Dana Point"}));
        assert_eq!(home_area(&re(json!([{"zip": "92672", "name": "San Clemente"}]))), json!({"zip": "92672", "name": "San Clemente"}));
        let why = |v: Value| home_area(&v)["reason"].as_str().map(str::to_string);
        assert_eq!(why(re(json!([{"zip": "9262", "tier": "home"}]))).as_deref(), Some("the home market has no five-digit ZIP"));
        assert_eq!(why(re(json!([]))).as_deref(), Some("the Real estate feed names no home market"));
        assert_eq!(home_area(&json!({"error": "file missing"})), json!({"zip": null, "reason": "the Real estate feed is not reporting: file missing"}));
        assert_eq!(why(json!({"status": "not_reporting"})).as_deref(), Some("the Real estate feed is not reporting"));
        let mut t = json!({"cron": {}});
        attach(&mut t, &json!({"spots": []}), &json!({"watches": {"items": []}}), &re(json!([{"zip": 92629, "tier": "home"}])));
        assert_eq!((t["surf_best"]["spots"].clone(), t["home_area"]["zip"].clone()), (json!([]), json!("92629")));
        assert!(t["cron"].is_object(), "the rest of the answer is untouched");
    }
}
