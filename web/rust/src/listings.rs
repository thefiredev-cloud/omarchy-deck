//! Paged listings for the Markets pages (program 2026-11-14). The browser used to download every listing
//! (`/api/realestate` 1.87 MB, `/api/cre` 2.99 MB) and filter it; these routes filter, sort and page on the server.
//! `/api/realestate` and `/api/cre` themselves do not change (iOS build 31 reads them).
//!
//! * `GET /api/realestate/homes`: rows of `realestate.json` `homes`.
//! * `GET /api/realestate/commercial`: rows of `house-feeds/listings-v2/commercial.json` (columnar, national) when it
//!   exists, else `realestate.json` `commercial`.
//! * `GET /api/cre/deals`: deals of `deck/cre-deals-national.json` when it exists, else `deck/cre-deals.json`, with an
//!   optional saved buy box (`box=<id>`) applied the way the desk page applies it (`static/cre.js` `match`).
//!
//! Listing rows are the objects `/api/realestate` serves (same keys, same `sources::clean` caps); deal rows are the
//! objects `/api/cre` serves. Filters: `state, metro, county, zip, q, type, min_price, max_price, beds (homes),
//! min_cap (commercial, deals), sale (sale|lease)`; `sort`; `limit` 1-100 (50); `offset`. A listing whose row has no
//! county or metro is placed through the national ZIP table. Missing files are `{status:"not_reporting"}` with
//! `total: 0`, never a 5xx; bad parameters are 400.
use crate::table::{self, read_as, read_json, Slot, Table};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

pub const COMMERCIAL_V2: &str = ".meshvault/status/house-feeds/listings-v2/commercial.json";
pub const DEALS_NATIONAL: &str = ".meshvault/status/deck/cre-deals-national.json";
const MAX_FILE: u64 = 64 * 1024 * 1024;
const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 100;
/// The realestate caps, shared with the generic feed route (`sources::deck_feed_from`) so the two never drift: the
/// collector keeps up to HOME_MAX 6000 homes and COMMERCIAL_MAX 4000 commercial rows (2026-11-17).
pub const HOMES_MAX: usize = 6000;
pub const COMMERCIAL_MAX: usize = 4000;
/// A sale under $10,000 is a rate or a parse slip, so it reads as unknown (the web's `LIST_PRICE_MIN`).
const LIST_PRICE_MIN: f64 = 10_000.0;
/// A size under 100 SF is an acreage or a unit slip (Redfin lands print 0.25), so it reads as unknown (the web's `SQFT_MIN`).
const SQFT_MIN: f64 = 100.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Homes,
    Commercial,
    Deals,
}

/// Cleaned listing rows of one file.
pub struct Rows {
    generated_at: Value,
    source: &'static str,
    rows: Vec<Value>,
}

struct RealEstate {
    homes: Rows,
    commercial: Rows,
}

#[derive(Deserialize)]
struct ColFile {
    #[serde(default)]
    generated_at: Value,
    #[serde(default)]
    t: Value,
    cols: Vec<String>,
    rows: Vec<Vec<Value>>,
}

#[derive(Default)]
pub struct Cache {
    realestate: Slot<RealEstate>,
    commercial: Slot<Rows>,
    deals: Slot<Value>,
}

fn cleaned(v: Option<&Value>, max: usize) -> Vec<Value> {
    v.and_then(Value::as_array).map(|a| a.iter().take(max).map(|r| crate::sources::clean(r, 1, 200)).collect()).unwrap_or_default()
}

/// A missing file reads as Ok(None); a present file that does not parse is an error with a reason.
async fn stamped(p: &Path) -> Result<Option<table::Stamp>, String> {
    match table::stamp(p, "absent", "unreadable").await {
        Ok((st, _)) => Ok(Some(st)),
        Err(e) if e == "absent" => Ok(None),
        Err(e) => Err(e),
    }
}

/// The national commercial file's rows as the route serves them: cleaned, then one row per listing (the same dedupe
/// `realestate.json` gets), so Showing N of M counts a repeated listing once.
fn commercial_v2_rows(cols: &[String], rows: &[Vec<Value>]) -> Vec<Value> {
    let cleaned: Vec<Value> = rows
        .iter()
        .map(|r| {
            let o: Map<String, Value> = cols.iter().cloned().zip(r.iter().cloned().chain(std::iter::repeat(Value::Null))).collect();
            crate::sources::clean(&Value::Object(o), 1, 200)
        })
        .collect();
    crate::listing_dedupe::feed_list(&cleaned)
}

impl Cache {
    async fn realestate(&self, home: &Path) -> Result<Option<Arc<RealEstate>>, String> {
        let p = home.join(crate::sources::REALESTATE.rel);
        let Some(st) = stamped(&p).await? else { return Ok(None) };
        if let Some(v) = self.realestate.get(&p, st).await {
            return Ok(Some(v));
        }
        let Some(v) = read_json(p.clone(), MAX_FILE).await? else { return Ok(None) };
        let gen = v.get("t").cloned().unwrap_or(Value::Null);
        let (homes, commercial) = crate::listing_dedupe::feed_rows(&cleaned(v.get("homes"), HOMES_MAX), &cleaned(v.get("commercial"), COMMERCIAL_MAX));
        let re = Arc::new(RealEstate {
            homes: Rows { generated_at: gen.clone(), source: "realestate", rows: homes },
            commercial: Rows { generated_at: gen, source: "realestate", rows: commercial },
        });
        self.realestate.put(&p, st, re.clone()).await;
        Ok(Some(re))
    }

    async fn commercial_v2(&self, home: &Path) -> Result<Option<Arc<Rows>>, String> {
        let p = home.join(COMMERCIAL_V2);
        let Some(st) = stamped(&p).await? else { return Ok(None) };
        if let Some(v) = self.commercial.get(&p, st).await {
            return Ok(Some(v));
        }
        let Some(f) = read_as::<ColFile>(p.clone(), MAX_FILE).await? else { return Ok(None) };
        let rows = commercial_v2_rows(&f.cols, &f.rows);
        let gen = if f.generated_at.is_null() { f.t } else { f.generated_at };
        let v = Arc::new(Rows { generated_at: gen, source: "listings-v2", rows });
        self.commercial.put(&p, st, v.clone()).await;
        Ok(Some(v))
    }

    /// The national deals file when it exists, else the desk's own (parsed once per change by `cre::deals`).
    async fn deals(&self, home: &Path) -> (Arc<Value>, &'static str) {
        let p = home.join(DEALS_NATIONAL);
        if let Ok(Some(st)) = stamped(&p).await {
            if let Some(v) = self.deals.get(&p, st).await {
                return (v, "national");
            }
            if let Ok(Some(v)) = read_json(p.clone(), MAX_FILE).await {
                if v.get("deals").is_some_and(Value::is_array) {
                    let v = Arc::new(v);
                    self.deals.put(&p, st, v.clone()).await;
                    return (v, "national");
                }
            }
        }
        let h = home.to_path_buf();
        match tokio::task::spawn_blocking(move || crate::cre::deals(&h)).await {
            Ok(v) => (v, "ca"),
            Err(_) => (Arc::new(json!({"status": "not_reporting", "reason": "the deals file could not be read"})), "ca"),
        }
    }
}

// ---------------------------------------------------------------- query

#[derive(Debug, Default)]
struct LQ {
    state: Option<String>,
    metro: Option<String>,
    county: Vec<String>,
    zips: Vec<String>,
    q: Option<String>,
    types: Vec<String>,
    min_price: Option<f64>,
    max_price: Option<f64>,
    beds: Option<f64>,
    min_cap: Option<f64>,
    sale: Option<&'static str>,
    sort: Option<&'static str>,
    limit: usize,
    offset: usize,
}

/// `price` is cheapest first, `price_desc` dearest first; both put a listing without a price last.
const LISTING_SORTS: [&str; 7] = ["feed", "price", "price_desc", "newest", "cap", "ppsf", "dom"];
const DEAL_SORTS: [&str; 6] = ["score", "cap", "price", "ppsf", "dom", "newest"];

fn parse(qs: &HashMap<String, String>, kind: Kind) -> Result<LQ, String> {
    let get = |k: &str| table::get(qs, k);
    if kind != Kind::Homes && get("beds").is_some() {
        return Err("beds is for homes".into());
    }
    if kind == Kind::Homes && get("min_cap").is_some() {
        return Err("min_cap is for commercial".into());
    }
    let sorts: &[&str] = if kind == Kind::Deals { &DEAL_SORTS } else { &LISTING_SORTS };
    let sort = match get("sort") {
        None => None,
        Some("cap") if kind == Kind::Homes => return Err("bad sort".into()),
        Some(s) => Some(*sorts.iter().find(|x| **x == s).ok_or("bad sort")?),
    };
    let zips = match get("zip") {
        None => Vec::new(),
        Some(s) => {
            let z: Vec<String> = s.split(',').map(str::trim).filter(|z| !z.is_empty()).map(str::to_string).collect();
            if z.len() > 40 || !z.iter().all(|z| (z.len() == 5 || z.len() == 3) && z.bytes().all(|b| b.is_ascii_digit())) {
                return Err("bad zip".into());
            }
            z
        }
    };
    let types: Vec<String> = get("type").map(|s| s.split(',').filter_map(|t| table::plain(t, 30)).map(|t| t.to_lowercase()).take(12).collect()).unwrap_or_default();
    let sale = match get("sale") {
        None => None,
        Some("sale") => Some("sale"),
        Some("lease") => Some("lease"),
        Some(_) => return Err("bad sale".into()),
    };
    Ok(LQ {
        state: table::state(qs)?,
        metro: get("metro").and_then(|s| table::plain(s, 80)).map(|s| s.to_lowercase()),
        county: get("county").map(|s| s.split(',').filter_map(|c| table::plain(c, 40)).map(|c| table::county_key(&c)).take(12).collect()).unwrap_or_default(),
        zips,
        q: get("q").and_then(|s| table::plain(s, 60)).map(|s| s.to_lowercase()),
        types,
        min_price: table::number(qs, "min_price", 0.0, 1.0e12)?,
        max_price: table::number(qs, "max_price", 0.0, 1.0e12)?,
        beds: table::number(qs, "beds", 0.0, 100.0)?,
        min_cap: table::number(qs, "min_cap", 0.0, 100.0)?,
        sale,
        sort,
        limit: table::int(qs, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT)?,
        offset: table::int(qs, "offset", 0, 0, 1_000_000)?,
    })
}

// ---------------------------------------------------------------- row facts

fn num(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|n| n.is_finite())
}

fn s<'a>(r: &'a Value, k: &str) -> Option<&'a str> {
    r.get(k).and_then(Value::as_str).filter(|x| !x.is_empty())
}

/// Facts one row is filtered and sorted by.
struct Facts {
    price: Option<f64>,
    cap: Option<f64>,
    ppsf: Option<f64>,
    dom: Option<f64>,
    newest: Option<f64>,
    score: Option<f64>,
}

/// A source's posted time as epoch seconds: a number (milliseconds when above 1e12), an ISO-8601 string or a bare `YYYY-MM-DD` date
/// (UTC midnight, as the web's `Date.parse` reads it); anything else is unknown.
fn posted(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::String(t) => {
            let t = t.trim();
            let iso = if t.len() == 10 { crate::util::iso_to_epoch(&format!("{t}T00:00:00Z")) } else { crate::util::iso_to_epoch(t) };
            iso.map(|e| e as f64)
        }
        n => num(Some(n)).map(|t| if t > 1e12 { t / 1000.0 } else { t }),
    }
}

/// An auction row: its `price` is the opening or minimum bid, not an asking price (the web's `isBid`). Every public-sector row (tax sale, surplus land) carries a `kind`.
fn is_bid(r: &Value) -> bool {
    s(r, "source").is_some_and(|x| x.eq_ignore_ascii_case("auction.com")) || r.get("auction_at").is_some_and(|v| !v.is_null()) || s(r, "kind").is_some()
}

fn facts(r: &Value, kind: Kind, now: f64) -> Facts {
    if kind == Kind::Deals {
        let dom = num(r.get("dom").and_then(|d| d.get("days")));
        let listed = num(r.get("listed_at"));
        return Facts {
            price: num(r.get("price")),
            cap: num(r.get("cap").and_then(|c| c.get("value"))),
            ppsf: num(r.get("ppsf")),
            dom,
            // the desk's "newest": listing date, else the fewest days on market
            newest: Some(listed.unwrap_or_else(|| -(dom.unwrap_or(1e9)))),
            score: num(r.get("score")),
        };
    }
    let usd = s(r, "currency").is_some_and(|c| c.eq_ignore_ascii_case("USD"));
    let price = num(r.get("price")).filter(|p| usd && *p >= LIST_PRICE_MIN);
    // a size under 100 SF is an acreage or a unit slip (the web's `SQFT_MIN`), so it reads as unknown
    let sqft = num(r.get("sqft")).filter(|x| *x >= SQFT_MIN);
    // a listing date is a real moment in the past (the web's `listedEpoch`); a source's own time may be epoch seconds,
    // epoch milliseconds or an ISO string (Alexandria's publishedAt), as the web's `toEpoch` reads it
    let listed = posted(r.get("listed_at")).filter(|t| *t > 0.0 && *t <= now + 300.0);
    Facts {
        price,
        cap: num(r.get("cap_rate")).filter(|c| *c > 0.0),
        // an auction.com row's price is the auction's starting bid (the web's `isBid`): it never becomes a price per square foot
        ppsf: if is_bid(r) { None } else { price.zip(sqft).map(|(p, a)| p / a) },
        dom: listed.map(|t| ((now - t) / 86400.0).max(0.0)),
        newest: listed,
        score: None,
    }
}

/// The ZIP table row's text column for a listing that does not carry it.
fn geo<'a>(r: &'a Value, k: &str, t: Option<&'a Table>) -> Option<&'a str> {
    s(r, k).or_else(|| {
        let t = t?;
        let row = t.row_of(s(r, "zip")?)?;
        Table::text(row, t.col(k))
    })
}

fn keep(r: &Value, kind: Kind, q: &LQ, f: &Facts, t: Option<&Table>) -> bool {
    if let Some(st) = &q.state {
        if !s(r, "state").is_some_and(|x| x.eq_ignore_ascii_case(st)) {
            return false;
        }
    }
    if let Some(m) = &q.metro {
        if !geo(r, "metro", t).is_some_and(|x| x.to_lowercase() == *m) {
            return false;
        }
    }
    if !q.county.is_empty() && !geo(r, "county", t).is_some_and(|c| q.county.contains(&table::county_key(c))) {
        return false;
    }
    if !q.zips.is_empty() && !s(r, "zip").is_some_and(|z| q.zips.iter().any(|p| z.starts_with(p.as_str()))) {
        return false;
    }
    if !q.types.is_empty() {
        let ty = s(r, "type").unwrap_or(if kind == Kind::Deals { "Other" } else { "" }).to_lowercase();
        if !q.types.contains(&ty) {
            return false;
        }
    }
    if let Some(min) = q.min_price {
        if !f.price.is_some_and(|p| p >= min) {
            return false;
        }
    }
    if let Some(max) = q.max_price {
        if !f.price.is_some_and(|p| p <= max) {
            return false;
        }
    }
    if let Some(b) = q.beds {
        if !num(r.get("beds")).is_some_and(|x| x >= b) {
            return false;
        }
    }
    if let Some(c) = q.min_cap {
        if !f.cap.is_some_and(|x| x >= c) {
            return false;
        }
    }
    if let Some(want) = q.sale {
        if s(r, "sale_or_lease").unwrap_or("sale") != want {
            return false;
        }
    }
    if let Some(text) = &q.q {
        let hay = ["zip", "city", "county", "metro", "addr", "title", "subtype", "broker"];
        if !hay.iter().any(|k| s(r, k).is_some_and(|x| x.to_lowercase().contains(text.as_str()))) {
            return false;
        }
    }
    true
}

/// A saved buy box, applied exactly as `static/cre.js` `match(d, f)` does.
fn box_match(d: &Value, f: &Value, now: f64) -> bool {
    let strs = |k: &str| -> Vec<&str> { f.get(k).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default() };
    let types = strs("types");
    if !types.is_empty() && !types.contains(&s(d, "type").unwrap_or("Other")) {
        return false;
    }
    let cs = strs("counties");
    if !cs.is_empty() && !cs.contains(&d.get("county").and_then(Value::as_str).unwrap_or("")) {
        return false;
    }
    let zs = strs("zips");
    let dz: String = d.get("zip").and_then(Value::as_str).unwrap_or("").chars().take(5).collect();
    if !zs.is_empty() && !zs.iter().any(|z| dz.starts_with(z)) {
        return false;
    }
    let fx = facts(d, Kind::Deals, now);
    let bound = |k: &str| num(f.get(k));
    let at_least = |k: &str, v: Option<f64>| bound(k).is_none_or(|b| v.is_some_and(|x| x >= b));
    let at_most = |k: &str, v: Option<f64>| bound(k).is_none_or(|b| v.is_some_and(|x| x <= b));
    // units: the listed count, else the desk's estimate (`units_est.value`, shown as an estimate on the card)
    let units = num(d.get("units")).or_else(|| num(d.get("units_est").and_then(|u| u.get("value"))));
    if !(at_least("price_min", fx.price)
        && at_most("price_max", fx.price)
        && at_least("cap_min", fx.cap)
        && at_least("units_min", units)
        && at_most("units_max", units)
        && at_least("sf_min", num(d.get("sqft")))
        && at_most("dom_max", fx.dom)
        && at_least("score_min", fx.score)
        // the desk's DSCR column: the deal's DSCR at the assumed commercial rate
        && at_least("dscr_min", num(d.get("dscr_cre"))))
    {
        return false;
    }
    // a deal that does not say sale or lease is a sale
    if let Some(want) = f.get("sale_or_lease").and_then(Value::as_str) {
        if s(d, "sale_or_lease").unwrap_or("sale") != want {
            return false;
        }
    }
    let q = f.get("q").and_then(Value::as_str).unwrap_or("").chars().take(60).collect::<String>().to_lowercase();
    if !q.is_empty() {
        let hay = ["zip", "city", "county", "metro", "addr", "title", "subtype", "broker"];
        return hay.iter().any(|k| d.get(*k).and_then(Value::as_str).is_some_and(|x| x.chars().take(200).collect::<String>().to_lowercase().contains(&q)));
    }
    true
}

/// (key, ascending) for a sort; None keeps the file's order.
fn sort_key(f: &Facts, sort: &str) -> Option<(Option<f64>, bool)> {
    match sort {
        "price" => Some((f.price, true)),
        "price_desc" => Some((f.price, false)),
        "ppsf" => Some((f.ppsf, true)),
        "cap" => Some((f.cap, false)),
        "dom" => Some((f.dom, false)),
        "newest" => Some((f.newest, false)),
        "score" => Some((f.score, false)),
        _ => None,
    }
}

/// Filter, sort and page `rows`. Returns (total, page rows, sort used).
fn page(rows: &[Value], kind: Kind, q: &LQ, sort: &'static str, bx: Option<&Value>, t: Option<&Table>, now: f64) -> (usize, Vec<Value>) {
    let mut hits: Vec<(usize, Option<f64>)> = Vec::new();
    let mut asc = true;
    for (i, r) in rows.iter().enumerate() {
        let f = facts(r, kind, now);
        if !keep(r, kind, q, &f, t) || bx.is_some_and(|b| !box_match(r, b, now)) {
            continue;
        }
        let key = match sort_key(&f, sort) {
            Some((k, a)) => {
                asc = a;
                k
            }
            None => Some(i as f64),
        };
        hits.push((i, key));
    }
    hits.sort_by(|a, b| table::order(a.1, b.1, asc).then(a.0.cmp(&b.0)));
    let total = hits.len();
    let out = hits.iter().skip(q.offset).take(q.limit).filter_map(|(i, _)| rows.get(*i).cloned()).collect();
    (total, out)
}

fn filters(q: &LQ) -> Value {
    json!({"state": q.state, "metro": q.metro, "county": q.county, "zip": q.zips, "q": q.q, "type": q.types,
        "min_price": q.min_price.map(table::num_value), "max_price": q.max_price.map(table::num_value),
        "beds": q.beds.map(table::num_value), "min_cap": q.min_cap, "sale": q.sale})
}

fn now_f() -> f64 {
    crate::util::now_epoch() as f64
}

async fn geo_table(q: &LQ, housing: &crate::housing::Cache, home: &Path) -> Option<Arc<Table>> {
    if q.metro.is_some() || !q.county.is_empty() {
        housing.table(home).await
    } else {
        None
    }
}

// ---------------------------------------------------------------- routes

/// `GET /api/realestate/homes` and `GET /api/realestate/commercial` -> (status, body)
pub async fn listings(c: &Cache, housing: &crate::housing::Cache, home: &Path, kind: Kind, qs: &HashMap<String, String>) -> (u16, Value) {
    let q = match parse(qs, kind) {
        Ok(q) => q,
        Err(e) => return (400, json!({"error": e})),
    };
    let sort = q.sort.unwrap_or("feed");
    let v2 = if kind == Kind::Commercial { c.commercial_v2(home).await } else { Ok(None) };
    let re;
    let rows: &Rows = match &v2 {
        Ok(Some(r)) => r,
        // a broken national file is reported, never silently replaced
        Err(e) => return (200, json!({"status": "not_reporting", "reason": format!("Commercial listings file: {e}"), "total": 0, "rows": []})),
        Ok(None) => {
            re = match c.realestate(home).await {
                Ok(Some(r)) => r,
                Ok(None) => return (200, json!({"status": "not_reporting", "reason": "The realestate collector has not written listings yet", "total": 0, "rows": []})),
                Err(e) => return (200, json!({"status": "not_reporting", "reason": format!("Realestate file: {e}"), "total": 0, "rows": []})),
            };
            if kind == Kind::Homes { &re.homes } else { &re.commercial }
        }
    };
    if q.sale == Some("lease") && kind == Kind::Homes {
        return (400, json!({"error": "bad sale"}));
    }
    let t = geo_table(&q, housing, home).await;
    let (total, out) = page(&rows.rows, kind, &q, sort, None, t.as_deref(), now_f());
    (200, json!({"total": total, "offset": q.offset, "limit": q.limit, "sort": sort, "filters": filters(&q),
        "generated_at": rows.generated_at, "source": rows.source, "rows": out}))
}

/// `GET /api/cre/deals?person=&box=&...` -> (status, body). `person` is already pinned for a desk viewer.
pub async fn deals(c: &Cache, housing: &crate::housing::Cache, home: &Path, person: &str, qs: &HashMap<String, String>) -> (u16, Value) {
    if !crate::cre::person_ok(person) {
        return (400, json!({"error": "bad person"}));
    }
    let q = match parse(qs, Kind::Deals) {
        Ok(q) => q,
        Err(e) => return (400, json!({"error": e})),
    };
    let bx = match table::get(qs, "box") {
        None => None,
        Some(id) => {
            let (store, p, id) = (home.join(crate::cre::REL), person.to_string(), id.to_string());
            let found = tokio::task::spawn_blocking(move || {
                let prof = crate::cre::profile(&crate::cre::load(&store).unwrap_or_default(), &p);
                prof["boxes"].as_array().and_then(|a| a.iter().find(|b| b["id"] == json!(id)).cloned())
            })
            .await
            .ok()
            .flatten();
            match found {
                Some(b) => Some(b),
                None => return (404, json!({"error": "no such buy box"})),
            }
        }
    };
    let bf = bx.as_ref().map(|b| b.get("f").cloned().unwrap_or_else(|| json!({})));
    let box_sort = bf.as_ref().and_then(|f| f.get("sort")).and_then(Value::as_str).and_then(|s| DEAL_SORTS.iter().find(|x| **x == s).copied());
    let sort = q.sort.or(box_sort).unwrap_or("score");
    let (file, dataset) = c.deals(home).await;
    let empty = Vec::new();
    let rows = file.get("deals").and_then(Value::as_array).unwrap_or(&empty);
    let t = geo_table(&q, housing, home).await;
    let (total, out) = page(rows, Kind::Deals, &q, sort, bf.as_ref(), t.as_deref(), now_f());
    let g = |k: &str| file.get(k).cloned().unwrap_or(Value::Null);
    let mut body = json!({"person": person, "box": bx.as_ref().map(|b| b["id"].clone()), "total": total, "offset": q.offset,
        "limit": q.limit, "sort": sort, "filters": filters(&q), "generated_at": g("generated_at"), "dataset": dataset,
        "rates": g("rates"), "assumptions": g("assumptions"), "rows": out});
    for k in ["status", "reason"] {
        if let Some(v) = file.get(k) {
            body[k] = v.clone();
        }
    }
    (200, body)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn qs(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    fn rows() -> Vec<Value> {
        let v: Value = serde_json::from_str(include_str!("../../tests/fixtures/listings-compat/realestate.json")).unwrap_or(Value::Null);
        // the collector tags every priced row USD (runner.usd); this fixture predates that
        let mut rows = cleaned(v.get("homes"), HOMES_MAX);
        for r in rows.iter_mut().filter(|r| r.get("price").is_some_and(|p| !p.is_null())) {
            r["currency"] = json!("USD");
        }
        rows
    }

    fn deal_rows() -> Vec<Value> {
        let v: Value = serde_json::from_str(include_str!("../../tests/fixtures/listings-compat/cre-deals.json")).unwrap_or(Value::Null);
        v["deals"].as_array().cloned().unwrap_or_default()
    }

    fn run(rs: &[Value], kind: Kind, pairs: &[(&str, &str)], bx: Option<&Value>) -> (usize, Vec<Value>) {
        let q = match parse(&qs(pairs), kind) {
            Ok(q) => q,
            Err(e) => panic!("refused {pairs:?}: {e}"),
        };
        let sort = q.sort.unwrap_or(if kind == Kind::Deals { "score" } else { "feed" });
        page(rs, kind, &q, sort, bx, None, 1_794_700_000.0)
    }

    #[test]
    fn the_homes_route_keeps_every_home_the_collector_writes() {
        // 2026-11-17: the route capped at 2,500 while the feed held 6,000 homes, so Multifamily read 1,080 of 4,405
        let homes: Vec<Value> = (0..4500).map(|i| json!({"addr": format!("{i} Main St, Los Angeles, CA 90001"), "price": 900_000 + i, "type": "Multifamily", "units": 2})).collect();
        let rs = cleaned(Some(&Value::Array(homes)), HOMES_MAX);
        assert_eq!(rs.len(), 4500);
        assert_eq!(run(&rs, Kind::Homes, &[], None).0, 4500);
    }

    #[test]
    fn params_are_checked_per_route() {
        for (kind, bad) in [
            (Kind::Homes, ("min_cap", "5")), (Kind::Commercial, ("beds", "2")), (Kind::Homes, ("sort", "cap")),
            (Kind::Homes, ("sort", "score")), (Kind::Deals, ("sort", "feed")), (Kind::Homes, ("limit", "101")),
            (Kind::Homes, ("limit", "0")), (Kind::Homes, ("zip", "9262")), (Kind::Commercial, ("sale", "rent")),
            (Kind::Homes, ("state", "Cal")), (Kind::Homes, ("max_price", "-1")),
        ] {
            assert!(parse(&qs(&[bad]), kind).is_err(), "{kind:?} {bad:?}");
        }
        assert!(parse(&qs(&[("zip", "926,92647"), ("sort", "ppsf")]), Kind::Homes).is_ok());
    }

    #[test]
    fn paging_keeps_the_total_and_the_feed_order() {
        let rs = rows();
        let (total, all) = run(&rs, Kind::Homes, &[("limit", "100")], None);
        assert_eq!((total, all.len()), (rs.len(), rs.len()));
        assert_eq!(all, rs, "default order is the collector's");
        let (t2, p2) = run(&rs, Kind::Homes, &[("limit", "10"), ("offset", "10")], None);
        assert_eq!((t2, p2.len()), (rs.len(), 10));
        assert_eq!(p2[0], rs[10]);
        let (_, past) = run(&rs, Kind::Homes, &[("offset", "1000")], None);
        assert!(past.is_empty());
    }

    #[test]
    fn a_repeated_row_in_the_national_commercial_file_counts_once() {
        // listings-v2/commercial.json skipped the dedupe that realestate.json gets: one listing read twice in Showing N of M.
        // The second row repeats the first (same url, same street); the third shares its url but names another street, so it stays.
        let cols: Vec<String> = ["id", "addr", "city", "type", "price", "currency", "source", "url"].iter().map(|s| s.to_string()).collect();
        let row = |id: &str, addr: &str| {
            vec![json!(id), json!(addr), json!("Huntington Beach"), json!("Office"), json!(2_000_000), json!("USD"), json!("ccafe"), json!("https://broker.example/index")]
        };
        let rows = vec![row("a1", "100 Harbor Blvd, Huntington Beach, CA 92647"), row("a1", "100 Harbor Blvd, Huntington Beach, CA 92647"), row("a2", "200 Fixture Cove Dr, Huntington Beach, CA 92647")];
        let ids: Vec<String> = commercial_v2_rows(&cols, &rows).iter().map(|r| r["id"].as_str().unwrap_or("").to_string()).collect();
        assert_eq!(ids, ["a1", "a2"]);
    }

    #[test]
    fn price_sort_is_cheapest_first_with_unknown_prices_last() {
        let rs = rows();
        let (_, p) = run(&rs, Kind::Homes, &[("sort", "price"), ("limit", "100")], None);
        let prices: Vec<Option<f64>> = p.iter().map(|r| num(r.get("price")).filter(|x| *x >= LIST_PRICE_MIN)).collect();
        let known: Vec<f64> = prices.iter().flatten().copied().collect();
        assert!(known.windows(2).all(|w| w[0] <= w[1]), "{known:?}");
        let first_none = prices.iter().position(Option::is_none).unwrap_or(prices.len());
        assert!(prices[first_none..].iter().all(Option::is_none), "unknown prices sort last");
        let (n, under) = run(&rs, Kind::Homes, &[("max_price", "900000"), ("min_price", "500000")], None);
        assert!(n > 0 && under.iter().all(|r| num(r.get("price")).is_some_and(|x| (500000.0..=900000.0).contains(&x))));
    }

    #[test]
    fn price_desc_is_dearest_first_with_unknown_prices_last() {
        let rs = rows();
        let price = |r: &Value| num(r.get("price")).filter(|x| *x >= LIST_PRICE_MIN);
        let (n, p) = run(&rs, Kind::Homes, &[("sort", "price_desc"), ("limit", "100")], None);
        let prices: Vec<Option<f64>> = p.iter().map(price).collect();
        let known: Vec<f64> = prices.iter().flatten().copied().collect();
        assert!(known.len() > 2 && known.windows(2).all(|w| w[0] >= w[1]), "{known:?}");
        let first_none = prices.iter().position(Option::is_none).unwrap_or(prices.len());
        assert!(prices[first_none..].iter().all(Option::is_none), "unknown prices sort last");
        // the same rows as the cheapest-first sort, in the other order where the price is known
        let (n2, asc) = run(&rs, Kind::Homes, &[("sort", "price"), ("limit", "100")], None);
        let mut up: Vec<f64> = asc.iter().filter_map(price).collect();
        up.reverse();
        assert_eq!((n, known), (n2, up));
        assert!(parse(&qs(&[("sort", "price_desc")]), Kind::Commercial).is_ok());
        assert!(parse(&qs(&[("sort", "price_desc")]), Kind::Deals).is_err(), "the desk keeps its own sorts");
    }

    #[test]
    fn a_price_without_a_currency_is_unknown_and_usd_is_known() {
        let now = 1_794_700_000.0;
        assert_eq!(facts(&json!({"price": 900000}), Kind::Homes, now).price, None, "no currency, no price");
        assert_eq!(facts(&json!({"price": 900000, "currency": "usd"}), Kind::Homes, now).price, Some(900000.0));
        assert_eq!(facts(&json!({"price": 900000, "currency": "GBP"}), Kind::Homes, now).price, None);
    }

    #[test]
    fn a_size_under_100_sf_is_an_acreage_and_has_no_price_per_square_foot() {
        let now = 1_794_700_000.0;
        let lot = json!({"price": 16900000, "currency": "USD", "sqft": 0.78});
        assert_eq!(facts(&lot, Kind::Homes, now).ppsf, None);
        let home = json!({"price": 900000, "currency": "USD", "sqft": 1800});
        assert_eq!(facts(&home, Kind::Homes, now).ppsf, Some(500.0));
    }

    #[test]
    fn an_auction_opening_bid_has_no_price_per_square_foot_so_the_ppsf_sort_never_ranks_it() {
        let now = 1_794_700_000.0;
        // the web (deck.js isBid, homeRow) labels an auction.com price an opening bid and never divides it by the size
        let bid = json!({"id": "bid", "price": 300000, "currency": "USD", "sqft": 2000, "source": "auction.com"});
        let dated = json!({"id": "dated", "price": 300000, "currency": "USD", "sqft": 2000, "auction_at": 1_794_800_000});
        let home = json!({"id": "home", "price": 900000, "currency": "USD", "sqft": 1800, "source": "redfin"});
        assert_eq!(facts(&bid, Kind::Homes, now).ppsf, None, "auction.com source");
        assert_eq!(facts(&dated, Kind::Homes, now).ppsf, None, "auction_at set");
        let tax = json!({"id": "tax", "price": 43000, "currency": "USD", "sqft": 900, "source": "la_ttc", "kind": "Tax sale"});
        assert_eq!(facts(&tax, Kind::Commercial, now).ppsf, None, "a tax sale's minimum bid");
        assert_eq!(facts(&home, Kind::Homes, now).ppsf, Some(500.0));
        let rs = vec![bid, dated, home];
        let (_, p) = run(&rs, Kind::Homes, &[("sort", "ppsf")], None);
        assert_eq!(p[0]["id"], "home", "a priced home ranks before bids, which sort last as unknown");
    }

    #[test]
    fn a_posted_time_may_be_seconds_milliseconds_or_iso_and_a_bad_one_is_unknown() {
        let now = 1_794_700_000.0;
        let at = |v: Value| facts(&json!({"listed_at": v}), Kind::Homes, now).newest;
        assert_eq!(at(json!(1_794_600_000)), Some(1_794_600_000.0));
        assert_eq!(at(json!(1_794_600_000_000_i64)), Some(1_794_600_000.0), "milliseconds");
        assert_eq!(at(json!("2026-11-12T00:00:00Z")), Some(1_794_441_600.0), "an ISO string");
        assert_eq!(facts(&json!({"listed_at": "2026-11-12T00:00:00Z"}), Kind::Homes, now).dom.map(f64::floor), Some(2.0));
        assert_eq!(at(json!("2030-01-01T00:00:00Z")), None, "the future is unknown");
        assert_eq!(at(json!("last week")), None);
        assert_eq!(at(json!(0)), None);
    }

    #[test]
    fn a_bare_posted_date_is_utc_midnight_and_sorts_newest_like_the_web_reads_it() {
        let now = 1_794_700_000.0;
        let at = |v: Value| facts(&json!({"listed_at": v}), Kind::Homes, now).newest;
        assert_eq!(at(json!("2026-11-12")), Some(1_794_441_600.0), "a date with no time");
        assert_eq!(at(json!(" 2026-11-12 ")), Some(1_794_441_600.0));
        assert_eq!(at(json!("2026-1x-12")), None, "a malformed date is unknown");
        assert_eq!(at(json!("2030-01-01")), None, "the future is unknown");
        let rs = vec![json!({"id": "old", "listed_at": "2026-11-01"}), json!({"id": "new", "listed_at": "2026-11-12"})];
        let (_, top) = run(&rs, Kind::Homes, &[("sort", "newest")], None);
        assert_eq!(top[0]["id"], "new");
    }

    #[test]
    fn deals_filters_sorts_and_boxes_match_the_desk() {
        let rs = deal_rows();
        let (n, top) = run(&rs, Kind::Deals, &[("limit", "100")], None);
        assert_eq!(n, rs.len());
        let scores: Vec<f64> = top.iter().filter_map(|d| num(d.get("score"))).collect();
        assert!(scores.windows(2).all(|w| w[0] >= w[1]), "best score first");
        let ind = json!({"types": ["Industrial"]});
        let (ni, ri) = run(&rs, Kind::Deals, &[("limit", "100")], Some(&ind));
        let want = rs.iter().filter(|d| d["type"] == "Industrial").count();
        assert_eq!(ni, want);
        assert!(ri.iter().all(|d| d["type"] == "Industrial"));
        // the query type filter and the box agree
        assert_eq!(run(&rs, Kind::Deals, &[("type", "industrial")], None).0, want);
        let (nc, rc) = run(&rs, Kind::Deals, &[("min_cap", "6"), ("sort", "cap"), ("limit", "100")], None);
        let caps: Vec<f64> = rc.iter().filter_map(|d| num(d.get("cap").and_then(|c| c.get("value")))).collect();
        assert_eq!(caps.len(), nc);
        assert!(caps.iter().all(|c| *c >= 6.0) && caps.windows(2).all(|w| w[0] >= w[1]));
        // a box minimum excludes deals that do not report the field, as the desk does
        let cap_box = json!({"cap_min": 6});
        assert_eq!(run(&rs, Kind::Deals, &[], Some(&cap_box)).0, nc);
        // a DSCR floor keeps deals at or above it; a deal with no DSCR never passes a floor, and no floor changes nothing.
        // Every fixture deal reports a DSCR, so the first ten lose theirs here.
        let mut rs = rs;
        for d in rs.iter_mut().take(10) {
            d["dscr_cre"] = Value::Null;
        }
        let with = rs.iter().filter(|d| num(d.get("dscr_cre")).is_some()).count();
        let at = |m: f64| rs.iter().filter(|d| num(d.get("dscr_cre")).is_some_and(|x| x >= m)).count();
        assert!(with > 0 && with < rs.len(), "deals with and without DSCR");
        assert_eq!(run(&rs, Kind::Deals, &[("limit", "100")], Some(&json!({"dscr_min": 0}))).0, with);
        let (n15, r15) = run(&rs, Kind::Deals, &[("limit", "100")], Some(&json!({"dscr_min": 1.5})));
        assert_eq!(n15, at(1.5));
        assert!(n15 > 0 && r15.iter().all(|d| num(d.get("dscr_cre")).is_some_and(|x| x >= 1.5)));
        assert_eq!(run(&rs, Kind::Deals, &[("limit", "100")], None).0, rs.len(), "no box, no floor: deals without DSCR stay");
        assert_eq!(run(&rs, Kind::Deals, &[], Some(&json!({"types": ["Industrial"]}))).0, want, "no dscr_min, no floor");
    }

    #[test]
    fn box_units_read_the_listed_count_else_the_estimate_and_sale_or_lease_defaults_to_sale() {
        let now = 1_794_700_000.0;
        let listed = json!({"type": "Multifamily", "units": 3, "price": 1500000});
        let est = json!({"type": "Multifamily", "units_est": {"value": 4, "kind": "estimate"}, "price": 2000000});
        let big = json!({"type": "Multifamily", "units": 12, "price": 6000000});
        let none = json!({"type": "Multifamily", "price": 900000});
        let small = json!({"units_min": 2, "units_max": 4});
        assert!(box_match(&listed, &small, now) && box_match(&est, &small, now));
        assert!(!box_match(&big, &small, now), "12 units is over the ceiling");
        assert!(!box_match(&none, &small, now), "no unit count, listed or estimated, never passes a units bound");
        assert!(box_match(&big, &json!({"units_min": 5}), now) && !box_match(&est, &json!({"units_min": 5}), now));
        // the listed count wins over an estimate
        let both = json!({"type": "Multifamily", "units": 8, "units_est": {"value": 3}});
        assert!(!box_match(&both, &small, now));
        let lease = json!({"type": "Industrial", "sale_or_lease": "lease", "sqft": 12000});
        let sale = json!({"type": "Industrial", "sqft": 12000, "price": 3000000});
        assert!(box_match(&lease, &json!({"sale_or_lease": "lease"}), now) && !box_match(&sale, &json!({"sale_or_lease": "lease"}), now));
        assert!(box_match(&sale, &json!({"sale_or_lease": "sale"}), now), "a deal that does not say is a sale");
        assert!(!box_match(&lease, &json!({"sale_or_lease": "sale"}), now));
    }
}
