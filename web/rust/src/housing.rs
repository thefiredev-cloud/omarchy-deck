//! Markets > Housing and Markets > Commercial (owner order 2026-11-11, national dataset v2 2026-11-14). The national
//! housing collector writes `~/.meshvault/status/house-feeds/national-v2/` (schema 2: `manifest.json` with the fields
//! catalog, columnar `zips.json`, columnar `zip/<3 digits>.json` shards, `hist/<3 digits>.json` series) and the compat
//! `national/` (schema 1, today's shape). Every request picks v2 when its manifest says `schema: 2`, else v1. The
//! on-demand `listings/<zip>.json` files stay under `national/`. The investor profile lives in
//! `~/.config/pixel-deck/invest-profile.json` (0600). Contract for pages: `plan/NationalApi.md` of program 2026-11-14.
//!
//! * `GET /api/housing/national[?part=summary|sources|fields|metrics|states|metros|segments]` serves the manifest or one
//!   slice. `part=segments` is the Markets spec: the segments (manifest copy, else the repo's segments.json as built)
//!   cut to the fields the catalog carries, with each field's label, unit, better and sources.
//! * `GET /api/housing/rank` ranks ZIP rows on the server. `zips.json` is parsed once into typed cells (`table.rs`),
//!   kept in memory and parsed again only when its mtime or size changes. Readers find columns by name through `cols`.
//!   `grade=A,B` keeps rows whose rental area grade is one of those letters; `sort=grade` orders by `area_score`.
//!   On v2 data `sort` also takes any column the catalog marks `rankable` (direction from `better`), and `type`,
//!   `min_conf`, `area`, `f=<col>:<ge|le>:<num>` and `cols` filter and shape the rows. On v1 data the body is today's.
//!   A v2 row whose asked column is a county or metro value (not the ZIP's own) says so in `from: {col: "county"}`.
//! * `GET /api/housing/zip/<zip>` serves one ZIP record, plus that ZIP's listings file when it exists. On v2 data the
//!   record is rebuilt from a stamp-checked LRU of parsed shards, with `hist` merged and `field_sources` rebuilt from
//!   the catalog so v1 readers keep working. A ZIP no shard carries is 404 `{error:"unknown zip"}`.
//! * `GET /api/housing/zip/<zip>/hist?fields=a,b` serves that ZIP's history series; `GET /api/housing/fields` the
//!   fields catalog joined with the source rows.
//! * `GET|POST /api/housing/profile` reads or saves the editable profile fields and returns the budget block with
//!   every input echoed. `main.rs` gates it like saved jobs: owner cookie only, never `?t=`, same origin. The guest
//!   allowlist names no housing route at all.
//!
//! A missing directory or file is `{status:"not_reporting", reason}`, never a 5xx. Nothing here logs a value.
use crate::table::{self, num_value, read_as, read_json, Cell, Lru, Slot, Stamp, Table, ZipsFile};
use crate::util::now_epoch;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;

pub const DIR: &str = ".meshvault/status/house-feeds/national";
pub const DIR_V2: &str = ".meshvault/status/house-feeds/national-v2";
pub const PROFILE: &str = ".config/pixel-deck/invest-profile.json";
/// The realestate feed: the mortgage rate stands in from it when the manifest carries none.
const REALESTATE: &str = ".meshvault/status/house-feeds/realestate.json";
pub const MAX_BODY: usize = 4096;
const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 200;
const MAX_ZIPS: u64 = 256 * 1024 * 1024;
const MAX_FILE: u64 = 32 * 1024 * 1024;
/// Parsed v2 shards (and, separately, history shards) kept in memory.
pub const SHARD_CACHE: usize = 64;
const ABSENT: &str = "National housing data has not been written yet";
const UNREADABLE: &str = "National housing file is unreadable";

/// What the v2 catalog says about one field.
#[derive(Clone, Debug, Default)]
struct FieldInfo {
    rankable: bool,
    /// `better: lower`: a rank on this field puts the smallest value first.
    lower: bool,
    level: Option<String>,
    /// (source id, the catalog's own as_of for this field or null), in catalog order.
    sources: Vec<(String, Value)>,
}

/// One manifest source row, as `field_sources`, the catalog route and the Markets spec need it.
#[derive(Clone, Debug)]
struct SrcInfo {
    name: Value,
    as_of: Value,
    status: String,
    /// The source's own geography (`cbsa`, `state`, `zip`, ...): a catalog field with no level of its own takes it.
    level: Option<String>,
    publisher: Value,
}

/// A v2 manifest, its fields catalog and its source rows indexed by id.
pub struct Manifest {
    value: Arc<Value>,
    fields: HashMap<String, FieldInfo>,
    sources: HashMap<String, SrcInfo>,
}

impl Manifest {
    fn new(v: Value) -> Manifest {
        let mut fields = HashMap::new();
        let mut add = |name: &str, e: &Value| {
            // a catalog source is an id ("zillow_zhvi") or an object ({"id": "zillow_zhvi", "as_of": "2026-09"})
            let srcs = |k: &str| -> Vec<(String, Value)> {
                e.get(k)
                    .and_then(Value::as_array)
                    .map(|a| {
                        a.iter()
                            .filter_map(|s| match s {
                                Value::String(id) => Some((id.clone(), Value::Null)),
                                Value::Object(o) => Some((o.get("id")?.as_str()?.to_string(), o.get("as_of").cloned().unwrap_or(Value::Null))),
                                _ => None,
                            })
                            .collect()
                    })
                    .unwrap_or_default()
            };
            fields.insert(
                name.to_string(),
                FieldInfo {
                    rankable: e.get("rankable").and_then(Value::as_bool) == Some(true),
                    lower: e.get("better").and_then(Value::as_str) == Some("lower"),
                    level: e.get("level").and_then(Value::as_str).map(str::to_string),
                    sources: srcs("sources"),
                },
            );
        };
        // `fields` is an object keyed by name (DataArch section 7); a list of entries with `name` reads the same
        match v.get("fields") {
            Some(Value::Object(m)) => m.iter().filter(|(_, e)| e.is_object()).for_each(|(k, e)| add(k, e)),
            Some(Value::Array(a)) => a.iter().for_each(|e| {
                if let Some(n) = e.get("name").and_then(Value::as_str) {
                    add(n, e)
                }
            }),
            _ => {}
        }
        let sources = v
            .get("sources")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|s| {
                        let id = s.get("id")?.as_str()?.to_string();
                        let g = |k: &str| s.get(k).cloned().unwrap_or(Value::Null);
                        Some((
                            id,
                            SrcInfo {
                                name: g("name"),
                                as_of: g("as_of"),
                                status: s.get("status").and_then(Value::as_str).unwrap_or("").to_string(),
                                level: s.get("level").and_then(Value::as_str).map(str::to_string),
                                publisher: g("publisher"),
                            },
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default();
        Manifest { value: Arc::new(v), fields, sources }
    }
    fn rankable(&self, col: &str) -> bool {
        self.fields.get(col).is_some_and(|f| f.rankable)
    }
}

/// One v2 shard: `{schema, generated_at, cols, rows: {zip: [...]}, x: {zip: {m, score_parts, ...}}}`.
#[derive(Deserialize)]
struct ShardFile {
    cols: Vec<String>,
    rows: HashMap<String, Vec<Value>>,
    #[serde(default)]
    x: HashMap<String, Map<String, Value>>,
}

/// One v2 history shard: `{fields, zips: {zip: {field: series}}, county: {fips: {field: series}}}`. County-level
/// series are stored once per county and belong to every ZIP whose `county_fips` names that county.
#[derive(Deserialize)]
struct HistFile {
    #[serde(default)]
    fields: Vec<String>,
    #[serde(default)]
    zips: HashMap<String, Map<String, Value>>,
    #[serde(default)]
    county: HashMap<String, Map<String, Value>>,
}

impl HistFile {
    /// Every series of one ZIP: its own, then its county's for fields the ZIP does not carry.
    fn series(&self, z: &str, fips: Option<&str>) -> Map<String, Value> {
        let mut one = self.zips.get(z).cloned().unwrap_or_default();
        if let Some(c) = fips.and_then(|f| self.county.get(f)) {
            for (k, v) in c {
                one.entry(k.clone()).or_insert_with(|| v.clone());
            }
        }
        one
    }
}

impl ShardFile {
    fn text(&self, z: &str, col: &str) -> Option<&str> {
        let i = self.cols.iter().position(|c| c == col)?;
        self.rows.get(z)?.get(i)?.as_str()
    }
}

/// In-memory parses keyed by path and stamp: both manifests, the `zips.json` table, v2 shards and history shards,
/// plus the on-demand listings limiter.
pub struct Cache {
    zips: Slot<Table>,
    manifest: Slot<Value>,
    manifest_v2: Slot<Manifest>,
    shards: Lru<ShardFile>,
    hists: Lru<HistFile>,
    fetch_hist: Mutex<std::collections::VecDeque<std::time::Instant>>,
    /// Held while the collector runs, so two on-demand reads never overlap.
    fetch_running: Mutex<()>,
}

impl Default for Cache {
    fn default() -> Self {
        Cache {
            zips: Slot::default(),
            manifest: Slot::default(),
            manifest_v2: Slot::default(),
            shards: Lru::new(SHARD_CACHE),
            hists: Lru::new(SHARD_CACHE),
            fetch_hist: Mutex::default(),
            fetch_running: Mutex::default(),
        }
    }
}

/// The dataset one request reads: v2 (with its parsed manifest) or the v1 directory.
pub struct Ds {
    pub dir: PathBuf,
    v2: Option<Arc<Manifest>>,
}

impl Ds {
    pub fn is_v2(&self) -> bool {
        self.v2.is_some()
    }
}

/// The v1 directory: on-demand listings files live here whichever dataset answers.
pub fn dir(home: &Path) -> PathBuf {
    home.join(DIR)
}

pub fn not_reporting(reason: &str) -> Value {
    json!({"status": "not_reporting", "reason": reason, "t": now_epoch()})
}

async fn stamp(p: &Path) -> Result<(Stamp, u64), String> {
    table::stamp(p, ABSENT, UNREADABLE).await
}

impl Cache {
    /// v2 when `national-v2/manifest.json` parses and says `schema: 2`, else the v1 directory. Decided per request
    /// from the manifest stamp, so a collector run that writes v2 switches readers without a restart.
    pub async fn pick(&self, home: &Path) -> Ds {
        let p = home.join(DIR_V2).join("manifest.json");
        if let Ok((st, len)) = stamp(&p).await {
            let m = match self.manifest_v2.get(&p, st).await {
                Some(m) => Some(m),
                None if len <= MAX_FILE => match read_json(p.clone(), MAX_FILE).await {
                    Ok(Some(v)) if v.get("schema").and_then(Value::as_u64) == Some(2) => {
                        let m = Arc::new(Manifest::new(v));
                        self.manifest_v2.put(&p, st, m.clone()).await;
                        Some(m)
                    }
                    _ => None,
                },
                None => None,
            };
            if let Some(m) = m {
                return Ds { dir: home.join(DIR_V2), v2: Some(m) };
            }
        }
        Ds { dir: home.join(DIR), v2: None }
    }

    /// The manifest of the dataset that answers.
    pub async fn manifest(&self, home: &Path) -> Result<Arc<Value>, String> {
        let ds = self.pick(home).await;
        match &ds.v2 {
            Some(m) => Ok(m.value.clone()),
            None => self.manifest_v1(&ds.dir).await,
        }
    }

    async fn manifest_v1(&self, d: &Path) -> Result<Arc<Value>, String> {
        let p = d.join("manifest.json");
        let (st, len) = stamp(&p).await?;
        if let Some(v) = self.manifest.get(&p, st).await {
            return Ok(v);
        }
        if len > MAX_FILE {
            return Err("National housing manifest is too large".into());
        }
        let v = match read_json(p.clone(), MAX_FILE).await {
            Ok(Some(v)) if v.is_object() => Arc::new(v),
            Ok(Some(_)) => return Err("National housing manifest is not a JSON object".into()),
            Ok(None) => return Err(ABSENT.into()),
            Err(e) => return Err(format!("National housing manifest: {e}")),
        };
        self.manifest.put(&p, st, v.clone()).await;
        Ok(v)
    }

    async fn zips(&self, ds: &Ds) -> Result<Arc<Table>, String> {
        let p = ds.dir.join("zips.json");
        let (st, len) = stamp(&p).await?;
        if let Some(t) = self.zips.get(&p, st).await {
            return Ok(t);
        }
        if len > MAX_ZIPS {
            return Err("National ZIP table is too large".into());
        }
        let q = p.clone();
        let parsed = tokio::task::spawn_blocking(move || -> Result<ZipsFile, String> {
            let b = std::fs::read(&q).map_err(|e| format!("National ZIP table is unreadable: {}", e.kind()))?;
            serde_json::from_slice::<ZipsFile>(&b).map_err(|_| "National ZIP table is not valid JSON".to_string())
        })
        .await
        .map_err(|_| "National ZIP table read failed".to_string())??;
        let t = Arc::new(Table::from_file(parsed));
        self.zips.put(&p, st, t.clone()).await;
        Ok(t)
    }

    /// The ZIP table of the dataset that answers (listings use it to place a listing's ZIP in its county and metro).
    pub async fn table(&self, home: &Path) -> Option<Arc<Table>> {
        let ds = self.pick(home).await;
        self.zips(&ds).await.ok()
    }

    /// One parsed file from an LRU. `Ok(None)` when the file does not exist.
    async fn cached<T: serde::de::DeserializeOwned + Send + 'static>(lru: &Lru<T>, p: PathBuf) -> Result<Option<Arc<T>>, String> {
        let st = match tokio::fs::metadata(&p).await {
            Ok(m) if m.is_file() => {
                use std::os::unix::fs::MetadataExt;
                (m.mtime(), m.mtime_nsec(), m.len())
            }
            Ok(_) => return Err("not a file".into()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(format!("unreadable: {}", e.kind())),
        };
        if let Some(v) = lru.get(&p, st).await {
            return Ok(Some(v));
        }
        match read_as::<T>(p.clone(), MAX_FILE).await? {
            Some(v) => {
                let v = Arc::new(v);
                lru.put(&p, st, v.clone()).await;
                Ok(Some(v))
            }
            None => Ok(None),
        }
    }

    async fn shard(&self, ds: &Ds, z: &str) -> Result<Option<Arc<ShardFile>>, String> {
        Self::cached(&self.shards, ds.dir.join("zip").join(format!("{}.json", &z[..3]))).await
    }

    async fn hist(&self, ds: &Ds, z: &str) -> Result<Option<Arc<HistFile>>, String> {
        Self::cached(&self.hists, ds.dir.join("hist").join(format!("{}.json", &z[..3]))).await
    }
}

// ---------------------------------------------------------------- ranking

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Housing,
    Commercial,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Kind::Housing => "housing",
            Kind::Commercial => "commercial",
        }
    }
}

/// (sort key, column, ascending). Price sorts cheapest first; every other key largest first. `grade` sorts by the
/// rental area score behind the A/B/C/D grade. These v1 keys stay valid on v2 data as aliases.
const HOUSING_SORTS: [(&str, &str, bool); 11] = [
    ("score", "h_score", false),
    ("grade", "area_score", false),
    ("yield", "yield_gross", false),
    ("change_1y", "zhvi_yoy", false),
    ("change_5y", "zhvi_5y", false),
    ("price", "price", true),
    ("rent", "rent", false),
    ("pop", "pop", false),
    ("renters", "renter_share", false),
    ("income", "hh_income", false),
    ("colleges", "college_enroll_5mi", false),
];
/// On v2 data the v1 housing sort names rank on the blended metric the page shows, not the raw v1 column: the page's
/// Rent column is `typical_rent`, so ranking by `rent` would lead with rows that read "No data". (name, v2 column).
/// Used only when the table has the column; direction stays the v1 one, missing values sort last either way.
const HOUSING_V2_SORTS: [(&str, &str); 7] = [
    ("price", "home_value"),
    ("rent", "typical_rent"),
    ("yield", "gross_yield"),
    ("change_1y", "value_trend_1y"),
    ("change_5y", "value_trend_5y"),
    ("pop", "population"),
    ("income", "income"),
];
/// The rental area grades a `grade=` filter may name.
const GRADES: [&str; 4] = ["A", "B", "C", "D"];
const COMMERCIAL_SORTS: [(&str, &str, bool); 9] = [
    ("score", "c_score", false),
    ("estabs", "biz_estabs", false),
    ("growth_5y", "biz_estabs_5y", false),
    ("emp", "biz_emp", false),
    ("pay", "biz_pay_per_emp", false),
    ("per_1k", "estabs_per_1k", false),
    ("listings", "com_listings", false),
    ("cap", "com_median_cap", false),
    ("price", "price", true),
];
/// v2 commercial score selectors: `type=<t>` and `sort=<t>` both mean the column `<t>_score`.
const COMMERCIAL_TYPES: [&str; 4] = ["retail", "office", "industrial", "multifamily"];
/// `area=` names and the `ruca_class` values they keep (USDA's four-way grouping, `usda_ruca_zip`).
const AREAS: [(&str, &str); 4] = [("metro", "Metropolitan"), ("micro", "Micropolitan"), ("small", "Small town"), ("rural", "Rural")];
const MAX_F: usize = 4;
/// The 48 v1 `zips.json` columns: the default v2 row starts with these (in the table's own order).
const V1_COLS: [&str; 48] = [
    "zip", "city", "state", "county", "metro", "lat", "lon", "pop", "hh_income", "zhvi", "zhvi_yoy", "zhvi_5y", "rent",
    "rent_src", "rent_yoy", "list_price", "active", "dom", "price_cut_share", "yield_gross", "price_to_income", "vacancy",
    "owner_share", "biz_estabs", "biz_estabs_5y", "biz_emp", "biz_pay_per_emp", "estabs_per_1k", "retail_estabs",
    "office_estabs", "industrial_estabs", "com_listings", "com_median_price", "com_median_cap", "h_score", "c_score",
    "renter_share", "median_age", "rent_to_income", "homicide_rate", "colleges_5mi", "college_enroll_5mi", "colleges_10mi",
    "college_enroll_10mi", "schools_5mi", "area_score", "area_grade", "area_conf",
];
/// The headline v2 columns a default v2 row adds to the v1 ones.
const HEADLINE_COLS: [&str; 15] = [
    "home_value", "home_value_conf", "typical_rent", "typical_rent_conf", "gross_yield", "value_trend_1y", "value_trend_5y",
    "h_conf", "retail_score", "office_score", "industrial_score", "multifamily_score", "ruca_class", "county_fips", "cbsa",
];

/// What a rank query is validated against: the dataset, its table and its catalog.
#[derive(Clone, Copy, Default)]
pub struct Ctx<'a> {
    table: Option<&'a Table>,
    man: Option<&'a Manifest>,
}

impl Ctx<'_> {
    fn v2(&self) -> bool {
        self.man.is_some()
    }
    fn has(&self, col: &str) -> bool {
        self.table.is_some_and(|t| t.col(col).is_some())
    }
    /// A `zips.json` column the catalog marks rankable.
    fn rankable(&self, col: &str) -> bool {
        self.man.is_some_and(|m| m.rankable(col)) && self.has(col)
    }
    /// The confidence column of a sort column: `<col>_conf`, or `<x>_conf` for `<x>_score`.
    fn conf_of(&self, col: &str) -> Option<String> {
        let mut c = vec![format!("{col}_conf")];
        if let Some(x) = col.strip_suffix("_score") {
            c.push(format!("{x}_conf"));
        }
        c.into_iter().find(|c| self.has(c))
    }
}

#[derive(Debug, PartialEq)]
pub struct RankQ {
    pub kind: Kind,
    pub state: Option<String>,
    pub metro: Option<String>,
    pub county: Vec<String>,
    pub q: Option<String>,
    pub max_price: Option<f64>,
    pub min_pop: Option<f64>,
    /// The sort key as asked (echoed back), the column it reads and its direction.
    pub sort: String,
    pub sort_col: String,
    pub asc: bool,
    /// Rental area grades to keep (`grade=A,B`); empty keeps every row, graded or not.
    pub grades: Vec<&'static str>,
    pub limit: usize,
    pub offset: usize,
    /// v2 data answers: the body carries `dataset`, `cols`, `sort_col`, `sort_dir` and the v2 filters.
    pub v2: bool,
    pub ctype: Option<&'static str>,
    pub min_conf: Option<f64>,
    pub conf_col: Option<String>,
    pub areas: Vec<&'static str>,
    /// (column, at least (else at most), value)
    pub f: Vec<(String, bool, f64)>,
    pub cols: Option<Vec<String>>,
    /// `zip=a,b`: only these ZIPs (at most 40), e.g. a page's own markets.
    pub zips: Vec<String>,
}

/// The query string of `GET /api/housing/rank`, validated against the dataset. Unknown values are refused, never
/// guessed. `raw_f` holds every `f=` value (repeated or comma-joined). A v2 parameter on v1 data is refused.
pub fn rank_query(qs: &HashMap<String, String>, raw_f: &[String], ctx: Ctx) -> Result<RankQ, String> {
    let get = |k: &str| table::get(qs, k);
    let kind = match get("kind").unwrap_or("housing") {
        "housing" => Kind::Housing,
        "commercial" => Kind::Commercial,
        _ => return Err("bad kind".into()),
    };
    let state = table::state(qs)?;
    let max_price = table::number(qs, "max_price", 1.0, 1.0e12)?;
    let min_pop = table::number(qs, "min_pop", 0.0, 1.0e12)?;
    let v2 = ctx.v2();
    for k in ["type", "min_conf", "area", "cols", "dir"] {
        if !v2 && get(k).is_some() {
            return Err(format!("{k} needs national v2"));
        }
    }
    if !v2 && !raw_f.is_empty() {
        return Err("f needs national v2".into());
    }
    let ctype = match get("type") {
        None => None,
        Some(_) if kind != Kind::Commercial => return Err("type needs kind=commercial".into()),
        Some(t) => Some(*COMMERCIAL_TYPES.iter().find(|x| **x == t).ok_or("bad type")?),
    };
    let sorts: &[(&str, &str, bool)] = match kind {
        Kind::Housing => &HOUSING_SORTS,
        Kind::Commercial => &COMMERCIAL_SORTS,
    };
    let sort = get("sort").unwrap_or("score");
    let (sort_col, asc) = match (ctype, sorts.iter().find(|x| x.0 == sort)) {
        (Some(t), _) if sort == "score" => (format!("{t}_score"), false),
        (_, Some(x)) => match HOUSING_V2_SORTS.iter().find(|a| v2 && kind == Kind::Housing && a.0 == sort && ctx.has(a.1)) {
            Some(a) => (a.1.to_string(), x.2),
            None => (x.1.to_string(), x.2),
        },
        _ if v2 && kind == Kind::Commercial && COMMERCIAL_TYPES.contains(&sort) => (format!("{sort}_score"), false),
        _ if ctx.rankable(sort) => (sort.to_string(), ctx.man.is_some_and(|m| m.fields.get(sort).is_some_and(|f| f.lower))),
        _ => return Err("bad sort".into()),
    };
    // `dir=asc|desc` (v2) overrides the best-first direction; missing values still sort last either way
    let asc = match get("dir") {
        None => asc,
        Some("asc") => true,
        Some("desc") => false,
        Some(_) => return Err("bad dir".into()),
    };
    let conf_col = if v2 { ctx.conf_of(&sort_col) } else { None };
    let min_conf = table::number(qs, "min_conf", 0.0, 1.0)?;
    if min_conf.is_some() && conf_col.is_none() {
        return Err("min_conf does not apply to this sort".into());
    }
    let mut areas: Vec<&'static str> = Vec::new();
    if let Some(s) = get("area") {
        if !ctx.has("ruca_class") {
            return Err("area needs ruca_class".into());
        }
        for a in s.split(',').map(str::trim).filter(|a| !a.is_empty()) {
            match AREAS.iter().find(|x| x.0.eq_ignore_ascii_case(a)) {
                Some(x) if !areas.contains(&x.1) => areas.push(x.1),
                Some(_) => {}
                None => return Err("bad area".into()),
            }
        }
    }
    if raw_f.len() > MAX_F {
        return Err(format!("at most {MAX_F} f filters"));
    }
    let mut f = Vec::new();
    for one in raw_f {
        let mut p = one.splitn(3, ':');
        let (Some(col), Some(op), Some(n)) = (p.next(), p.next(), p.next()) else { return Err("bad f".into()) };
        let ge = match op {
            "ge" => true,
            "le" => false,
            _ => return Err("bad f".into()),
        };
        let n = n.trim().parse::<f64>().ok().filter(|n| n.is_finite()).ok_or("bad f")?;
        if !ctx.rankable(col) {
            return Err("bad f".into());
        }
        f.push((col.to_string(), ge, n));
    }
    let cols = match get("cols") {
        None => None,
        Some(s) => {
            let mut v: Vec<String> = Vec::new();
            for c in s.split(',').map(str::trim).filter(|c| !c.is_empty()) {
                if !ctx.has(c) || v.len() >= 200 {
                    return Err("bad cols".into());
                }
                if !v.iter().any(|x| x == c) {
                    v.push(c.to_string());
                }
            }
            Some(v)
        }
    };
    let zips: Vec<String> = match get("zip") {
        None => Vec::new(),
        Some(s) => {
            let z: Vec<String> = s.split(',').map(str::trim).filter(|z| !z.is_empty()).map(str::to_string).collect();
            if z.len() > 40 || !z.iter().all(|z| zip_ok(z)) {
                return Err("bad zip".into());
            }
            z
        }
    };
    let limit = table::int(qs, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT)?;
    let offset = table::int(qs, "offset", 0, 0, 1_000_000)?;
    let county = get("county")
        .map(|s| s.split(',').filter_map(|c| table::plain(c, 40)).map(|c| table::county_key(&c)).take(12).collect())
        .unwrap_or_default();
    let mut grades: Vec<&'static str> = Vec::new();
    if let Some(s) = get("grade") {
        for g in s.split(',').map(str::trim).filter(|g| !g.is_empty()) {
            match GRADES.iter().find(|x| x.eq_ignore_ascii_case(g)) {
                Some(x) if !grades.contains(x) => grades.push(x),
                Some(_) => {}
                None => return Err("bad grade".into()),
            }
        }
    }
    Ok(RankQ {
        kind,
        state,
        metro: get("metro").and_then(|s| table::plain(s, 80)),
        county,
        q: get("q").and_then(|s| table::plain(s, 40)),
        max_price,
        min_pop,
        sort: sort.to_string(),
        sort_col,
        asc,
        grades,
        limit,
        offset,
        v2,
        ctype,
        min_conf,
        conf_col,
        areas,
        f,
        cols,
        zips,
    })
}

/// The price a row is judged by: housing uses the home value index, else the median list price; commercial uses
/// the median asking price where listings report one.
fn price_of(t: &Table, row: &[Cell], kind: Kind) -> (Option<f64>, Option<&'static str>) {
    match kind {
        Kind::Housing => match Table::num(row, t.col("zhvi")) {
            Some(v) => (Some(v), Some("zhvi")),
            None => match Table::num(row, t.col("list_price")) {
                Some(v) => (Some(v), Some("list_price")),
                None => (None, None),
            },
        },
        Kind::Commercial => match Table::num(row, t.col("com_median_price")) {
            Some(v) => (Some(v), Some("com_median_price")),
            None => (None, None),
        },
    }
}

/// The `zips.json` text column the national writer fills where a headline metric is an area value, not the ZIP's own:
/// `"days_on_market:county,price_cuts:metro"` (blend.py `area_fallback`). A v2 rank row carries those of its columns as
/// `from: {days_on_market: "county"}`, so a page never shows them as the ZIP's own figure.
const AREA_FROM: &str = "area_from";

/// `metric:county|metro` pairs of one `area_from` cell; anything else in it is ignored.
fn area_from(cell: Option<&str>) -> Option<Vec<(&str, &'static str)>> {
    let v: Vec<(&str, &'static str)> = cell?
        .split(',')
        .filter_map(|p| {
            let (k, a) = p.trim().split_once(':')?;
            let a = ["county", "metro"].into_iter().find(|x| *x == a.trim())?;
            (!k.is_empty()).then_some((k.trim(), a))
        })
        .collect();
    (!v.is_empty()).then_some(v)
}

/// One row that passed the filters: its index, sort key, judged price and the price's column, and the ZIP for ties.
struct Hit {
    i: usize,
    key: Option<f64>,
    price: Option<f64>,
    psrc: Option<&'static str>,
    zip: String,
}

fn rank_rows(t: &Table, q: &RankQ) -> Value {
    let (cz, cs, cm, cc, ccity, cpop) = (t.col("zip"), t.col("state"), t.col("metro"), t.col("county"), t.col("city"), t.col("pop"));
    let cg = t.col("area_grade");
    let (cconf, cruca) = (q.conf_col.as_deref().and_then(|c| t.col(c)), t.col("ruca_class"));
    let fcols: Vec<(Option<usize>, bool, f64)> = q.f.iter().map(|(c, ge, n)| (t.col(c), *ge, *n)).collect();
    let digits = q.q.as_deref().is_some_and(|s| s.bytes().all(|b| b.is_ascii_digit()));
    let ql = q.q.as_deref().map(str::to_lowercase);
    let ml = q.metro.as_deref().map(str::to_lowercase);
    let sc = t.col(&q.sort_col);
    let mut hits: Vec<Hit> = Vec::new();
    for (i, row) in t.rows.iter().enumerate() {
        let zip = Table::zip(row, cz);
        if let Some(s) = &q.state {
            if Table::text(row, cs).map(str::to_ascii_uppercase).as_deref() != Some(s.as_str()) {
                continue;
            }
        }
        if let Some(m) = &ml {
            if Table::text(row, cm).map(str::to_lowercase).as_deref() != Some(m.as_str()) {
                continue;
            }
        }
        if !q.county.is_empty() && !Table::text(row, cc).is_some_and(|c| q.county.contains(&table::county_key(c))) {
            continue;
        }
        if let Some(s) = &ql {
            let ok = if digits {
                zip.starts_with(s.as_str())
            } else {
                [ccity, cc, cm].iter().any(|c| Table::text(row, *c).is_some_and(|x| x.to_lowercase().contains(s.as_str())))
            };
            if !ok {
                continue;
            }
        }
        if !q.zips.is_empty() && !q.zips.contains(&zip) {
            continue;
        }
        if let Some(min) = q.min_pop {
            if !Table::num(row, cpop).is_some_and(|p| p >= min) {
                continue;
            }
        }
        if !q.grades.is_empty() && !Table::text(row, cg).is_some_and(|g| q.grades.contains(&g)) {
            continue;
        }
        if let Some(min) = q.min_conf {
            if !Table::num(row, cconf).is_some_and(|c| c >= min) {
                continue;
            }
        }
        if !q.areas.is_empty() && !Table::text(row, cruca).is_some_and(|a| q.areas.contains(&a)) {
            continue;
        }
        if !fcols.iter().all(|(c, ge, n)| Table::num(row, *c).is_some_and(|v| if *ge { v >= *n } else { v <= *n })) {
            continue;
        }
        let (price, psrc) = price_of(t, row, q.kind);
        if let Some(max) = q.max_price {
            let within = match (q.kind, price) {
                (_, Some(p)) => p <= max,
                // a home with no value index and no list price cannot be judged within budget
                (Kind::Housing, None) => false,
                // commercial: the budget filter applies only where listings report a price
                (Kind::Commercial, None) => true,
            };
            if !within {
                continue;
            }
        }
        let key = if q.sort_col == "price" { price } else { Table::num(row, sc) };
        hits.push(Hit { i, key, price, psrc, zip });
    }
    hits.sort_by(|a, b| table::order(a.key, b.key, q.asc).then_with(|| a.zip.cmp(&b.zip)));
    let total = hits.len();
    // v1 rows carry every column, as today; v2 rows the asked (or default) columns plus the ZIP, sort and conf columns
    let pick: Option<Vec<(String, usize)>> = q.v2.then(|| {
        let mut names: Vec<String> = match &q.cols {
            Some(c) => c.clone(),
            None => t.cols.iter().filter(|c| V1_COLS.contains(&c.as_str()) || HEADLINE_COLS.contains(&c.as_str())).cloned().collect(),
        };
        if !names.iter().any(|c| c == "zip") {
            names.insert(0, "zip".into());
        }
        for extra in [Some(q.sort_col.clone()), q.conf_col.clone()].into_iter().flatten() {
            if !names.contains(&extra) {
                names.push(extra);
            }
        }
        names.into_iter().filter_map(|c| t.col(&c).map(|i| (c, i))).collect()
    });
    let cfrom = t.col(AREA_FROM);
    let rows: Vec<Value> = hits
        .iter()
        .enumerate()
        .skip(q.offset)
        .take(q.limit)
        .filter_map(|(n, h)| {
            let row = t.rows.get(h.i)?;
            let mut o = match &pick {
                Some(p) => t.object_cols(row, p),
                None => t.object(row),
            };
            o.insert("rank".into(), json!(n + 1));
            o.insert("price".into(), h.price.map(num_value).unwrap_or(Value::Null));
            o.insert("price_src".into(), json!(h.psrc));
            if let (Some(p), Some(f)) = (&pick, area_from(Table::text(row, cfrom))) {
                let marks: Map<String, Value> = f.into_iter().filter(|(k, _)| p.iter().any(|(c, _)| c == k)).map(|(k, v)| (k.to_string(), json!(v))).collect();
                if !marks.is_empty() {
                    o.insert("from".into(), Value::Object(marks));
                }
            }
            Some(Value::Object(o))
        })
        .collect();
    let mut body = json!({
        "kind": q.kind.name(),
        "total": total,
        "zips_total": t.rows.len(),
        "offset": q.offset,
        "limit": q.limit,
        "sort": q.sort,
        "filters": {
            "state": q.state, "metro": q.metro, "county": q.county, "q": q.q,
            "max_price": q.max_price.map(num_value), "min_pop": q.min_pop.map(num_value), "grade": q.grades,
        },
        "generated_at": t.generated_at,
        "rows": rows,
    });
    // `zip=` is echoed only when asked, so a v1 body without it stays today's byte for byte
    if !q.zips.is_empty() {
        body["filters"]["zip"] = json!(q.zips);
    }
    if let Some(p) = &pick {
        body["dataset"] = json!("v2");
        body["cols"] = json!(p.iter().map(|(c, _)| c).collect::<Vec<_>>());
        body["sort_col"] = json!(q.sort_col);
        body["sort_dir"] = json!(if q.asc { "asc" } else { "desc" });
        let areas: Vec<&str> = q.areas.iter().filter_map(|a| AREAS.iter().find(|x| x.1 == *a).map(|x| x.0)).collect();
        let f: Vec<String> = q.f.iter().map(|(c, ge, n)| format!("{c}:{}:{n}", if *ge { "ge" } else { "le" })).collect();
        for (k, v) in [("type", json!(q.ctype)), ("min_conf", json!(q.min_conf)), ("area", json!(areas)), ("f", json!(f))] {
            body["filters"][k] = v;
        }
    }
    body
}

// ---------------------------------------------------------------- routes

/// Top-level manifest keys `part=summary` leaves out (each has its own part).
const HEAVY: [&str; 7] = ["sources", "fields", "metrics", "states", "metros", "segments", "segments_missing"];
const PARTS: [&str; 7] = ["summary", "sources", "fields", "metrics", "states", "metros", "segments"];
/// The most keys `fields=` takes on `part=states|metros`: every field of the widest segment plus the row keys.
const MAX_LIST_FIELDS: usize = 100;
/// The most fields one segment serves (so a page can always ask for all of them with its row keys).
const MAX_SEG_FIELDS: usize = 96;
/// The segments spec as built (owner order 2026-11-17): the fallback while the manifest carries no `segments`.
const SEGMENTS_SPEC: &str = include_str!("../../scripts/national/segments.json");

/// `GET /api/housing/national[?part=...]` -> (status, body). No `part`: the compat manifest verbatim (`national/`,
/// schema 1, today's 530 KB body), as the frozen contract promises; the v2 manifest stands in only when no compat file
/// exists. Every `part=` reads the v2 manifest (95 sources) when it is there, else v1.
/// `part=metros` and `part=states` (the heavy lists, about 7 MB of metros) also take `state=CA` (a metro is kept when
/// its name's state suffix names the state: "…, NY-NJ-PA" is in all three) and `fields=a,b` (each row keeps only those
/// keys, so a picker asks for `fields=cbsa,name`). Item 6: Residential reads only what it shows.
pub async fn national(c: &Cache, home: &Path, qs: &HashMap<String, String>) -> (u16, Value) {
    let part = match table::get(qs, "part").map(str::trim).filter(|p| !p.is_empty()) {
        None => None,
        Some(p) => match PARTS.iter().find(|x| **x == p) {
            Some(x) => Some(*x),
            None => return (400, json!({"error": "bad part"})),
        },
    };
    let list = matches!(part, Some("metros" | "states"));
    let state = match table::state(qs) {
        Ok(s) => s,
        Err(e) => return (400, json!({"error": e})),
    };
    let fields: Option<Vec<String>> = match table::get(qs, "fields") {
        None => None,
        Some(s) => {
            let f: Vec<String> = s.split(',').map(str::trim).filter(|x| !x.is_empty()).map(str::to_string).collect();
            let ok = |x: &String| (1..=40).contains(&x.len()) && x.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
            if f.is_empty() || f.len() > MAX_LIST_FIELDS || !f.iter().all(ok) {
                return (400, json!({"error": "bad fields"}));
            }
            Some(f)
        }
    };
    if !list && (state.is_some() || fields.is_some()) {
        return (400, json!({"error": "state and fields need part=metros or part=states"}));
    }
    let ds = c.pick(home).await;
    if part.is_none() {
        // the compat writer's file first (`national/`), never the multi-MB v2 one: the iOS Housing section fetches this
        match c.manifest_v1(&dir(home)).await {
            Ok(v) => return (200, (*v).clone()),
            Err(e) if ds.v2.is_none() => return (200, not_reporting(&e)),
            Err(_) => {}
        }
        if let Some(m) = &ds.v2 {
            return (200, (*m.value).clone());
        }
    }
    let m = match &ds.v2 {
        Some(m) => m.value.clone(),
        None => match c.manifest_v1(&ds.dir).await {
            Ok(v) => v,
            Err(e) => return (200, not_reporting(&e)),
        },
    };
    let Some(part) = part else { return (200, (*m).clone()) };
    let g = |k: &str| m.get(k).cloned().unwrap_or(Value::Null);
    let mut out = json!({"dataset": if ds.is_v2() { "v2" } else { "v1" }, "part": part, "schema": g("schema"), "generated_at": g("generated_at")});
    match part {
        "summary" => {
            if let Some(o) = m.as_object() {
                for (k, v) in o.iter().filter(|(k, _)| !HEAVY.contains(&k.as_str())) {
                    out[k.as_str()] = v.clone();
                }
            }
        }
        "metrics" => {
            out["metrics"] = g("metrics");
            out["scores"] = g("scores");
        }
        "segments" => {
            let (segs, fields, from) = segments_of(&m, ds.v2.as_deref());
            out["segments"] = segs;
            out["fields"] = fields;
            out["spec"] = json!(from);
            if !ds.is_v2() {
                out["reason"] = json!("The national data is still the v1 set; segment fields arrive with v2");
            }
        }
        k => out[k] = if list { rows_of(&g(k), k, state.as_deref(), fields.as_deref()) } else { g(k) },
    }
    // the summary and the Markets spec carry the page's one freshness mark (age, refresh, stale)
    if part == "summary" || part == "segments" {
        for (k, v) in freshness(&m, now_epoch()) {
            out[k] = v;
        }
    }
    (200, out)
}

/// The state codes a `metros` row covers (its name's suffix after the last ", ": "NY-NJ-PA") or a `states` row is.
fn row_states(row: &Value, part: &str) -> Vec<String> {
    match part {
        "states" => row.get("state").and_then(Value::as_str).map(|s| vec![s.to_ascii_uppercase()]).unwrap_or_default(),
        _ => row
            .get("name")
            .and_then(Value::as_str)
            .and_then(|n| n.rsplit_once(", "))
            .map(|(_, s)| s.split('-').map(|x| x.trim().to_ascii_uppercase()).collect())
            .unwrap_or_default(),
    }
}

/// A heavy list cut to one state and to the asked keys (in the asked order). Anything that is not a list passes as is.
fn rows_of(list: &Value, part: &str, state: Option<&str>, fields: Option<&[String]>) -> Value {
    let Some(rows) = list.as_array() else { return list.clone() };
    let out = rows
        .iter()
        .filter(|r| state.is_none_or(|s| row_states(r, part).iter().any(|x| x == s)))
        .map(|r| match (fields, r.as_object()) {
            (Some(f), Some(o)) => Value::Object(f.iter().filter_map(|k| o.get(k).map(|v| (k.clone(), v.clone()))).collect()),
            _ => r.clone(),
        })
        .collect();
    Value::Array(out)
}

/// One catalog entry by name: the catalog is an object keyed by name or a list of entries with `name`.
fn catalog_entry<'a>(cat: Option<&'a Value>, n: &str) -> Option<&'a Value> {
    match cat? {
        Value::Object(o) => o.get(n),
        Value::Array(a) => a.iter().find(|e| e.get("name").and_then(Value::as_str) == Some(n)),
        _ => None,
    }
}

/// The segment list: the manifest's own copy (`segments` as a list, or the spec object with `segments`), else the
/// built-in spec. Returns the list and where it came from.
fn segment_list(m: &Value) -> (Vec<Value>, &'static str) {
    fn from(v: &Value) -> Option<Vec<Value>> {
        match v {
            Value::Array(a) => Some(a.clone()),
            Value::Object(o) => o.get("segments")?.as_array().cloned(),
            _ => None,
        }
    }
    if let Some(l) = m.get("segments").and_then(from).filter(|l| !l.is_empty()) {
        return (l, "manifest");
    }
    let spec: Value = serde_json::from_str(SEGMENTS_SPEC).unwrap_or(Value::Null);
    (from(&spec).unwrap_or_default(), "built_in")
}

/// `part=segments`: each segment `{id, label, lead, fields, skipped}` with `fields` cut to the ones the catalog
/// carries (in spec order, no repeats, at most MAX_SEG_FIELDS) and `skipped` the rest; `lead` falls back to the first
/// kept field. `fields` maps every kept field to `{label, unit, better, level, group, sources: [{id, name, publisher,
/// as_of}]}`. `level` is the catalog's own, else the one level all its sources share (a metro plugin's field is `cbsa`,
/// a state plugin's `state`), so Markets can keep state fields off metro rows and back. Without a v2 catalog no field
/// is kept: a field the build does not produce is never shown.
fn segments_of(m: &Value, man: Option<&Manifest>) -> (Value, Value, &'static str) {
    let (list, from) = segment_list(m);
    let cat = man.and_then(|x| x.value.get("fields"));
    let id_ok = |s: &str| (1..=40).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
    let mut fields = Map::new();
    let mut segs = Vec::new();
    for s in &list {
        let Some(id) = s.get("id").and_then(Value::as_str).filter(|x| id_ok(x)) else { continue };
        let (mut kept, mut skipped) = (Vec::<String>::new(), Vec::<String>::new());
        for f in s.get("fields").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
            if !id_ok(f) || kept.iter().chain(skipped.iter()).any(|x| x == f) {
                continue;
            }
            match (man, catalog_entry(cat, f)) {
                (Some(mm), Some(e)) if kept.len() < MAX_SEG_FIELDS => {
                    if !fields.contains_key(f) {
                        let g = |k: &str| e.get(k).cloned().unwrap_or(Value::Null);
                        let fsrc = mm.fields.get(f).map(|fi| fi.sources.as_slice()).unwrap_or_default();
                        let srcs: Vec<Value> = fsrc
                            .iter()
                            .map(|(sid, as_of)| {
                                let s = mm.sources.get(sid);
                                json!({"id": sid, "name": s.map(|x| x.name.clone()), "publisher": s.map(|x| x.publisher.clone()),
                                    "as_of": if as_of.is_null() { s.map(|x| x.as_of.clone()).unwrap_or(Value::Null) } else { as_of.clone() }})
                            })
                            .collect();
                        let level = match e.get("level").and_then(Value::as_str) {
                            Some(l) => Some(l.to_string()),
                            None => {
                                let mut ls = fsrc.iter().map(|(sid, _)| mm.sources.get(sid).and_then(|s| s.level.clone()));
                                let first = ls.next().flatten();
                                first.filter(|l| ls.all(|x| x.as_deref() == Some(l.as_str())))
                            }
                        };
                        fields.insert(
                            f.to_string(),
                            json!({"label": g("label"), "unit": g("unit"), "better": g("better"), "level": level, "group": g("group"), "sources": srcs}),
                        );
                    }
                    kept.push(f.to_string());
                }
                _ => skipped.push(f.to_string()),
            }
        }
        let lead = s.get("lead").and_then(Value::as_str).filter(|l| kept.iter().any(|x| x == l)).map(str::to_string).or_else(|| kept.first().cloned());
        let label = s.get("label").and_then(Value::as_str).map(|l| l.chars().take(60).collect::<String>()).unwrap_or_else(|| id.to_string());
        segs.push(json!({"id": id, "label": label, "lead": lead, "fields": kept, "skipped": skipped}));
    }
    (Value::Array(segs), Value::Object(fields), from)
}

/// The weekly national build (`deck-feed-housing-national.timer`, Mondays): the cadence when the manifest names none.
pub const REFRESH_S: u64 = 604_800;

/// `age`, `refresh` and `stale` for the freshness mark of a page, by the rule every deck feed uses (`sources::wrap`):
/// stale when older than two refreshes, or when the manifest carries no usable `generated_at`. `refresh` is the
/// manifest's own top-level `refresh` (seconds) when it has one, else the weekly build.
fn freshness(m: &Value, now: u64) -> [(&'static str, Value); 3] {
    let refresh = m.get("refresh").and_then(Value::as_u64).filter(|r| (3600..=31 * 86_400).contains(r)).unwrap_or(REFRESH_S);
    let t = m
        .get("generated_at")
        .and_then(|v| v.as_u64().or_else(|| v.as_f64().filter(|f| f.is_finite() && *f > 0.0).map(|f| f as u64)))
        .filter(|t| *t > 1_500_000_000 && *t <= now + 300);
    let age = t.map(|t| now.saturating_sub(t));
    [("age", json!(age)), ("refresh", json!(refresh)), ("stale", json!(age.map(|a| a > 2 * refresh).unwrap_or(true)))]
}

fn sort_aliases() -> Value {
    let map = |s: &[(&str, &str, bool)]| s.iter().map(|(k, c, _)| ((*k).to_string(), json!(c))).collect::<Map<String, Value>>();
    let mut com = map(&COMMERCIAL_SORTS);
    for t in COMMERCIAL_TYPES {
        com.insert(t.into(), json!(format!("{t}_score")));
    }
    json!({"housing": map(&HOUSING_SORTS), "commercial": com})
}

/// `GET /api/housing/fields`: the v2 fields catalog, each entry's source ids joined with the manifest source rows.
pub async fn fields(c: &Cache, home: &Path) -> (u16, Value) {
    let ds = c.pick(home).await;
    let Some(m) = &ds.v2 else {
        let mv1 = match c.manifest_v1(&ds.dir).await {
            Ok(v) => v,
            Err(e) => return (200, not_reporting(&e)),
        };
        let mut out = json!({"dataset": "v1", "generated_at": mv1.get("generated_at").cloned().unwrap_or(Value::Null), "count": 0,
            "fields": [], "sort_aliases": sort_aliases(), "reason": "The national data is still the v1 set; the field catalog arrives with v2"});
        for (k, v) in freshness(&mv1, now_epoch()) {
            out[k] = v;
        }
        return (200, out);
    };
    let in_table = c.zips(&ds).await.ok();
    let mut names: Vec<&String> = m.fields.keys().collect();
    names.sort();
    let cat = m.value.get("fields");
    let out: Vec<Value> = names
        .into_iter()
        .filter_map(|n| {
            let mut e = catalog_entry(cat, n)?.clone();
            let fi = m.fields.get(n)?;
            let srcs: Vec<Value> = fi
                .sources
                .iter()
                .map(|(id, as_of)| match m.sources.get(id) {
                    Some(s) => json!({"id": id, "name": s.name, "as_of": if as_of.is_null() { &s.as_of } else { as_of }, "status": s.status}),
                    None => json!({"id": id, "name": null, "as_of": as_of, "status": null}),
                })
                .collect();
            e["name"] = json!(n);
            e["sources"] = json!(srcs);
            if let Some(t) = &in_table {
                e["in_zips"] = json!(t.col(n).is_some());
                e["rankable"] = json!(fi.rankable && t.col(n).is_some());
            }
            Some(e)
        })
        .collect();
    let mut body = json!({"dataset": "v2", "generated_at": m.value.get("generated_at").cloned().unwrap_or(Value::Null),
        "count": out.len(), "sort_aliases": sort_aliases(), "fields": out});
    for (k, v) in freshness(&m.value, now_epoch()) {
        body[k] = v;
    }
    (200, body)
}

/// `GET /api/housing/rank?...` -> (status, body). `raw_q` is the raw query string (for repeated `f=`).
pub async fn rank(c: &Cache, home: &Path, qs: &HashMap<String, String>, raw_q: Option<&str>) -> (u16, Value) {
    let raw_f = table::all_values(raw_q, "f");
    let ds = c.pick(home).await;
    let t = match c.zips(&ds).await {
        Ok(t) => t,
        Err(e) => {
            // no data: a bad query is still a bad query
            return match rank_query(qs, &raw_f, Ctx::default()) {
                Err(err) if !err.ends_with("needs national v2") => (400, json!({"error": err})),
                _ => (200, not_reporting(&e)),
            };
        }
    };
    let ctx = Ctx { table: Some(&t), man: ds.v2.as_deref() };
    match rank_query(qs, &raw_f, ctx) {
        Ok(q) => (200, rank_rows(&t, &q)),
        Err(e) => (400, json!({"error": e})),
    }
}

pub fn zip_ok(z: &str) -> bool {
    z.len() == 5 && z.bytes().all(|b| b.is_ascii_digit())
}

/// The on-demand listings file of one ZIP, attached to its record the same way on v1 and v2.
async fn attach_listings(home: &Path, z: &str, rec: &mut Map<String, Value>) {
    match read_json(dir(home).join("listings").join(format!("{z}.json")), MAX_FILE).await {
        Ok(Some(v)) => {
            rec.insert("listings".into(), v);
        }
        Ok(None) => {}
        Err(e) => {
            rec.insert("listings".into(), json!({"status": "unavailable", "reason": format!("Listings file: {e}")}));
        }
    }
}

/// The scalar shard fields a v1 record carried beyond the 48 `zips.json` columns.
const V1_SHARD_EXTRAS: [&str; 3] = ["fhfa_hpi_5y", "county_fips", "cbsa"];

/// The v1 per-field provenance, rebuilt from the v2 catalog: `{field: {source, as_of, level?}}` for every v1 scalar
/// field whose first catalog source that loaded (`ok` or `stale`) is in the manifest. The web's ZIP sheet resolves
/// `source` against `manifest.sources[].id` and lists every entry, so v2-only fields stay out (their provenance is the
/// fields catalog and `m[*].p`).
fn field_sources(rec: &Map<String, Value>, m: &Manifest) -> Value {
    // the ZIP's own `rent_src` names which publisher its rent came from (ZORI where Zillow reports, else HUD SAFMR);
    // fields that list that source take it ahead of the catalog order
    let rent_src = rec.get("rent_src").and_then(Value::as_str).and_then(|s| RENT_SRC.iter().find(|(p, _)| s.starts_with(p))).map(|(_, id)| *id);
    let mut fs = Map::new();
    for (k, v) in rec {
        let v1 = V1_COLS.contains(&k.as_str()) || V1_SHARD_EXTRAS.contains(&k.as_str());
        if !v1 || v.is_null() || v.is_object() || v.is_array() {
            continue;
        }
        let Some(fi) = m.fields.get(k) else { continue };
        let loaded = |id: &String| m.sources.get(id).filter(|s| s.status == "ok" || s.status == "stale");
        let pick = |(id, as_of): &(String, Value)| loaded(id).map(|s| (id.clone(), if as_of.is_null() { s.as_of.clone() } else { as_of.clone() }));
        let found = rent_src
            .and_then(|r| fi.sources.iter().find(|(id, _)| id == r))
            .and_then(pick)
            .or_else(|| fi.sources.iter().find_map(pick));
        let Some((id, as_of)) = found else { continue };
        let mut e = json!({"source": id, "as_of": as_of});
        if let Some(l) = fi.level.as_deref().filter(|l| *l != "zip") {
            e["level"] = json!(l);
        }
        fs.insert(k.clone(), e);
    }
    Value::Object(fs)
}

/// `rent_src` prefixes and the source id each names.
const RENT_SRC: [(&str, &str); 2] = [("zori", "zillow_zori"), ("hud_safmr", "hud_safmr")];

/// `GET /api/housing/zip/<zip>` -> (status, body)
pub async fn zip(c: &Cache, home: &Path, z: &str) -> (u16, Value) {
    if !zip_ok(z) {
        return (400, json!({"error": "bad zip"}));
    }
    let ds = c.pick(home).await;
    let Some(m) = &ds.v2 else { return zip_v1(home, &ds.dir, z).await };
    let shard = match c.shard(&ds, z).await {
        Ok(Some(s)) => s,
        Ok(None) => return (404, json!({"error": "unknown zip"})),
        Err(e) => return (200, not_reporting(&format!("ZIP file: {e}"))),
    };
    let Some(row) = shard.rows.get(z) else { return (404, json!({"error": "unknown zip"})) };
    let mut rec: Map<String, Value> = shard.cols.iter().cloned().zip(row.iter().cloned().chain(std::iter::repeat(Value::Null))).collect();
    if let Some(x) = shard.x.get(z) {
        rec.extend(x.iter().map(|(k, v)| (k.clone(), v.clone())));
    }
    let fs = field_sources(&rec, m);
    rec.insert("field_sources".into(), fs);
    match c.hist(&ds, z).await {
        Ok(h) => {
            let one = h.map(|h| h.series(z, rec.get("county_fips").and_then(Value::as_str))).unwrap_or_default();
            rec.insert("hist".into(), Value::Object(one));
        }
        Err(e) => {
            rec.insert("hist".into(), json!({}));
            rec.insert("hist_reason".into(), json!(format!("History file: {e}")));
        }
    }
    rec.entry("zip").or_insert_with(|| json!(z));
    attach_listings(home, z, &mut rec).await;
    rec.insert("dataset".into(), json!("v2"));
    (200, Value::Object(rec))
}

/// Today's route on v1 data: the whole shard is read and parsed per call.
async fn zip_v1(home: &Path, d: &Path, z: &str) -> (u16, Value) {
    if !tokio::fs::try_exists(d.join("manifest.json")).await.unwrap_or(false)
        && !tokio::fs::try_exists(d.join("zip")).await.unwrap_or(false)
    {
        return (200, not_reporting(ABSENT));
    }
    let shard = match read_json(d.join("zip").join(format!("{}.json", &z[..3])), MAX_FILE).await {
        Ok(Some(v)) => v,
        Ok(None) => return (404, json!({"error": "unknown zip"})),
        Err(e) => return (200, not_reporting(&format!("ZIP file: {e}"))),
    };
    let Some(mut rec) = shard.get("zips").and_then(|m| m.get(z)).and_then(Value::as_object).cloned() else {
        return (404, json!({"error": "unknown zip"}));
    };
    rec.entry("zip").or_insert_with(|| json!(z));
    attach_listings(home, z, &mut rec).await;
    (200, Value::Object(rec))
}

/// `GET /api/housing/zip/<zip>/hist?fields=a,b` -> (status, body). Only series the history shard declares may be
/// asked for; no `fields` returns every series of the ZIP.
pub async fn zip_hist(c: &Cache, home: &Path, z: &str, fields: Option<&str>) -> (u16, Value) {
    if !zip_ok(z) {
        return (400, json!({"error": "bad zip"}));
    }
    let ds = c.pick(home).await;
    let (declared, series): (Vec<String>, Map<String, Value>) = if ds.is_v2() {
        let fips = match c.shard(&ds, z).await {
            Ok(Some(s)) if s.rows.contains_key(z) => s.text(z, "county_fips").map(str::to_string),
            Ok(_) => return (404, json!({"error": "unknown zip"})),
            Err(e) => return (200, not_reporting(&format!("ZIP file: {e}"))),
        };
        match c.hist(&ds, z).await {
            Ok(h) => {
                let one = h.as_ref().map(|h| h.series(z, fips.as_deref())).unwrap_or_default();
                let decl = h.map(|h| h.fields.clone()).filter(|f| !f.is_empty()).unwrap_or_else(|| one.keys().cloned().collect());
                (decl, one)
            }
            Err(e) => return (200, not_reporting(&format!("History file: {e}"))),
        }
    } else {
        match zip_v1(home, &ds.dir, z).await {
            (200, v) if v.get("status").is_none() => {
                let one = v.get("hist").and_then(Value::as_object).cloned().unwrap_or_default();
                (one.keys().cloned().collect(), one)
            }
            other => return other,
        }
    };
    let asked: Vec<String> = match fields.map(str::trim).filter(|s| !s.is_empty()) {
        None => series.keys().cloned().collect(),
        Some(s) => {
            let a: Vec<String> = s.split(',').map(str::trim).filter(|x| !x.is_empty()).map(str::to_string).collect();
            if a.len() > 64 || a.iter().any(|x| !declared.contains(x)) {
                return (400, json!({"error": "bad fields"}));
            }
            a
        }
    };
    let hist: Map<String, Value> = asked.into_iter().map(|k| {
        let v = series.get(&k).cloned().unwrap_or_else(|| json!([]));
        (k, v)
    }).collect();
    (200, json!({"zip": z, "dataset": if ds.is_v2() { "v2" } else { "v1" }, "fields": declared, "hist": hist}))
}

// ---------------------------------------------------------------- on-demand listings for one ZIP

/// The realestate collector, run with argv only (no shell) the way `launch.rs` runs `deck-launch`.
pub const COLLECTOR: &str = "ops/bin/deck-feed-realestate";
/// At least this long between two on-demand reads, and at most `FETCH_PER_HOUR` in an hour. The collector keeps its own
/// daily cap (exit 3) and answers a ZIP read in the last 6 hours from its cache.
pub const FETCH_GAP: std::time::Duration = std::time::Duration::from_secs(10);
pub const FETCH_PER_HOUR: usize = 12;
const FETCH_TIMEOUT_S: u64 = 90;

/// Sliding-window limiter. Ok, or Err(seconds to wait).
pub fn admit_fetch(hist: &mut std::collections::VecDeque<std::time::Instant>, now: std::time::Instant) -> Result<(), u64> {
    let hour = std::time::Duration::from_secs(3600);
    while hist.front().is_some_and(|t| now.duration_since(*t) >= hour) {
        hist.pop_front();
    }
    if let Some(last) = hist.back() {
        let since = now.duration_since(*last);
        if since < FETCH_GAP {
            return Err((FETCH_GAP - since).as_secs() + 1);
        }
    }
    if hist.len() >= FETCH_PER_HOUR {
        let oldest = hist.front().copied().unwrap_or(now);
        return Err(3600u64.saturating_sub(now.duration_since(oldest).as_secs()).max(1));
    }
    hist.push_back(now);
    Ok(())
}

impl Cache {
    /// `POST /api/housing/zip/<zip>/listings`: runs `python3 ~/ops/bin/deck-feed-realestate --zip <zip> --on-demand` when the
    /// collector has that flag, then returns the listings file it wrote. Returns (status, body).
    pub async fn fetch_listings(&self, home: &Path, z: &str) -> (u16, Value) {
        if !zip_ok(z) {
            return (400, json!({"ok": false, "error": "bad zip"}));
        }
        let script = home.join(COLLECTOR);
        let has_flag = read_text(script.clone()).await.is_some_and(|t| t.contains("--on-demand"));
        if !has_flag {
            return (501, json!({"ok": false, "error": "on-demand listings are not available"}));
        }
        let Ok(_one) = self.fetch_running.try_lock() else {
            return (429, json!({"ok": false, "error": "a listings read is running", "retry_s": 5}));
        };
        if let Err(wait) = admit_fetch(&mut *self.fetch_hist.lock().await, std::time::Instant::now()) {
            return (429, json!({"ok": false, "error": "rate limited", "retry_s": wait}));
        }
        let script = script.to_string_lossy();
        let r = crate::util::run(&["python3", script.as_ref(), "--zip", z, "--on-demand"], None, FETCH_TIMEOUT_S, &[]).await;
        match r {
            Ok((0, _)) => match read_json(dir(home).join("listings").join(format!("{z}.json")), MAX_FILE).await {
                Ok(Some(v)) => (200, json!({"ok": true, "zip": z, "listings": v})),
                Ok(None) => (502, json!({"ok": false, "error": "the collector wrote no listings file"})),
                Err(e) => (502, json!({"ok": false, "error": format!("listings file: {e}")})),
            },
            Ok((2, _)) => (400, json!({"ok": false, "error": "bad zip"})),
            Ok((3, _)) => (429, json!({"ok": false, "error": "daily limit reached"})),
            Ok((code, _)) => (502, json!({"ok": false, "error": format!("collector exited {code}")})),
            Err(e) if e == "timeout" => (504, json!({"ok": false, "error": "the collector took too long"})),
            Err(_) => (502, json!({"ok": false, "error": "the collector did not start"})),
        }
    }
}

// ---------------------------------------------------------------- investor profile and budget

pub fn profile_path(home: &Path) -> PathBuf {
    home.join(PROFILE)
}

/// One writer at a time inside this process; the rename keeps readers whole.
static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// The values the collector writes when it creates the file; a save before that starts from these.
fn defaults() -> Map<String, Value> {
    let v = json!({
        "schema": 1, "income_annual": null, "income_src": null, "income_asof": null, "co_income_annual": 0,
        "monthly_debt": 0, "cash_mode": "auto", "cash_manual": null, "down_pct": 0.25, "closing_pct": 0.03,
        "dti_max": 0.43, "tax_ins_rate": 0.015, "rate_adj": 0, "updated_at": null,
    });
    match v {
        Value::Object(m) => m,
        _ => Map::new(),
    }
}

/// (field, min, max, null allowed) for every editable number.
const NUM_FIELDS: [(&str, f64, f64, bool); 9] = [
    ("income_annual", 0.0, 100_000_000.0, true),
    ("co_income_annual", 0.0, 100_000_000.0, false),
    ("monthly_debt", 0.0, 10_000_000.0, false),
    ("cash_manual", 0.0, 10_000_000_000.0, true),
    ("down_pct", 0.0, 0.95, false),
    ("closing_pct", 0.0, 0.2, false),
    ("dti_max", 0.05, 0.65, false),
    ("tax_ins_rate", 0.0, 0.05, false),
    ("rate_adj", -5.0, 5.0, false),
];

fn date_ok(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-' && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

/// A POST body: a JSON object of editable fields only. Every value is checked; any unknown field refuses the whole body.
pub fn parse_profile(body: &[u8]) -> Result<Map<String, Value>, String> {
    if body.len() > MAX_BODY {
        return Err("too large".into());
    }
    let Ok(Value::Object(m)) = serde_json::from_slice::<Value>(body) else {
        return Err("bad json".into());
    };
    if m.is_empty() {
        return Err("no fields".into());
    }
    let mut out = Map::new();
    for (k, v) in m {
        if let Some((_, lo, hi, nullable)) = NUM_FIELDS.iter().find(|f| f.0 == k) {
            match v.as_f64() {
                Some(n) if n.is_finite() && n >= *lo && n <= *hi => {
                    out.insert(k, num_value(n));
                }
                None if v.is_null() && *nullable => {
                    out.insert(k, Value::Null);
                }
                _ => return Err(format!("bad {k}")),
            }
            continue;
        }
        match k.as_str() {
            "cash_mode" => match v.as_str() {
                Some(s @ ("auto" | "manual")) => {
                    out.insert(k, json!(s));
                }
                _ => return Err("bad cash_mode".into()),
            },
            "income_src" => match &v {
                Value::Null => {
                    out.insert(k, Value::Null);
                }
                Value::String(s) if s.chars().count() <= 300 && !s.chars().any(char::is_control) => {
                    out.insert(k, json!(s.trim()));
                }
                _ => return Err("bad income_src".into()),
            },
            "income_asof" => match &v {
                Value::Null => {
                    out.insert(k, Value::Null);
                }
                Value::String(s) if date_ok(s) => {
                    out.insert(k, v.clone());
                }
                _ => return Err("bad income_asof".into()),
            },
            _ => return Err("unknown field".into()),
        }
    }
    Ok(out)
}

/// The file as an object. Missing is `Ok(None)`; unreadable or malformed is an error, so a save never replaces a
/// file this code could not read.
fn load_profile(file: &Path) -> Result<Option<Map<String, Value>>, String> {
    let raw = match std::fs::read(file) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("profile unreadable: {}", e.kind())),
    };
    match serde_json::from_slice::<Value>(&raw) {
        Ok(Value::Object(m)) => Ok(Some(m)),
        _ => Err("profile is not a JSON object".into()),
    }
}

/// 0700 directory, 0600 temp file, fsync, rename over the old file.
fn save_profile(file: &Path, m: &Map<String, Value>) -> Result<(), String> {
    let dir = file.parent().ok_or("no profile directory")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("mkdir: {}", e.kind()))?;
    let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    let tmp = dir.join(format!(".invest-profile.{}.tmp", std::process::id()));
    let body = serde_json::to_vec_pretty(&Value::Object(m.clone())).map_err(|_| "encode".to_string())?;
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

fn epoch_of(v: Option<&Value>) -> Option<u64> {
    v.and_then(Value::as_u64).filter(|t| *t > 1_000_000_000)
}

/// Liquid cash for `cash_mode: auto`: the Money feed's cash and brokerage group totals. Returns
/// {value, source, as_of, reason}; the value is null with the reason when the feed cannot give one.
pub fn cash_from_finance(body: Option<&str>) -> Value {
    let miss = |r: &str| json!({"value": null, "source": "Money feed", "as_of": null, "reason": r});
    let Some(body) = body else { return miss("Money feed is not reporting") };
    let Ok(f) = serde_json::from_str::<Value>(body) else { return miss("Money feed is not valid JSON") };
    if f.get("sample") == Some(&Value::Bool(true)) {
        return miss("Money feed holds sample data");
    }
    let groups = f.get("money").and_then(|m| m.get("groups")).and_then(Value::as_array);
    let mut total = 0.0;
    let mut seen = vec![];
    for g in groups.into_iter().flatten() {
        let id = g.get("id").and_then(Value::as_str).unwrap_or("");
        if id == "cash" || id == "brokerage" {
            if let Some(n) = g.get("usd").and_then(Value::as_f64).filter(|n| n.is_finite()) {
                total += n;
                seen.push(id);
            }
        }
    }
    if seen.is_empty() {
        return miss("Money feed has no cash or brokerage total");
    }
    let as_of = epoch_of(f.get("as_of").and_then(|a| a.get("balances"))).or(epoch_of(f.get("generated_at"))).or(epoch_of(f.get("t")));
    json!({"value": num_value(total.round()), "source": format!("Money feed ({})", seen.join(" + ")), "as_of": as_of, "reason": null})
}

/// The 30-year rate in percent: the manifest's, else the realestate feed's FRED reading.
fn rate_from(manifest: Option<&Value>, realestate: Option<&Value>) -> Value {
    if let Some(m) = manifest.and_then(|m| m.get("mortgage")) {
        if let Some(r) = m.get("rate_30y").and_then(Value::as_f64).filter(|r| r.is_finite() && *r > 0.0) {
            return json!({"rate_30y": r, "as_of": m.get("as_of").cloned().unwrap_or(Value::Null),
                "source": m.get("source").and_then(Value::as_str).unwrap_or("national housing manifest")});
        }
    }
    if let Some(r) = realestate.and_then(|f| f.get("market")).and_then(|m| m.get("mortgage")).and_then(|m| m.get("rate_30y")) {
        if let Some(v) = r.get("value").and_then(Value::as_f64).filter(|r| r.is_finite() && *r > 0.0) {
            return json!({"rate_30y": v, "as_of": r.get("as_of").cloned().unwrap_or(Value::Null), "source": "FRED MORTGAGE30US (realestate feed)"});
        }
    }
    json!({"rate_30y": null, "as_of": null, "source": null, "reason": "No mortgage rate reported"})
}

fn f(m: &Map<String, Value>, k: &str) -> Option<f64> {
    m.get(k).and_then(Value::as_f64).filter(|n| n.is_finite())
}

/// Monthly payment per dollar borrowed over 30 years at `rate_pct` percent a year.
pub fn payment_factor(rate_pct: f64) -> f64 {
    let r = rate_pct / 100.0 / 12.0;
    if r.abs() < 1e-12 {
        1.0 / 360.0
    } else {
        r / (1.0 - (1.0 + r).powi(-360))
    }
}

/// The budget block (formula in the contract), every input echoed. `cash` is `cash_from_finance` or the manual value.
pub fn budget(p: &Map<String, Value>, rate: &Value, cash: &Value) -> Value {
    let income = f(p, "income_annual");
    let co = f(p, "co_income_annual").unwrap_or(0.0);
    let debt = f(p, "monthly_debt").unwrap_or(0.0);
    let dti = f(p, "dti_max").unwrap_or(0.43);
    let down = f(p, "down_pct").unwrap_or(0.25);
    let closing = f(p, "closing_pct").unwrap_or(0.03);
    let tax = f(p, "tax_ins_rate").unwrap_or(0.015);
    let adj = f(p, "rate_adj").unwrap_or(0.0);
    let base = rate.get("rate_30y").and_then(Value::as_f64);
    let used = base.map(|r| r + adj);
    let k = used.map(payment_factor);
    let monthly = income.map(|i| (i + co) / 12.0 * dti - debt);
    let max_income = match (monthly, k) {
        (Some(m), Some(k)) => {
            let denom = (1.0 - down) * k + tax / 12.0;
            Some(if m <= 0.0 || denom <= 0.0 { 0.0 } else { m / denom })
        }
        _ => None,
    };
    let cash_v = cash.get("value").and_then(Value::as_f64);
    let max_cash = cash_v.filter(|_| down + closing > 0.0).map(|c| c / (down + closing));
    let (value, basis) = match (max_income, max_cash) {
        (Some(a), Some(b)) => (Some(a.min(b)), Some(if a <= b { "income" } else { "cash" })),
        (Some(a), None) => (Some(a), Some("income only")),
        (None, Some(b)) => (Some(b), Some("cash only")),
        (None, None) => (None, None),
    };
    let reason = if value.is_some() {
        Value::Null
    } else if base.is_none() {
        json!("No mortgage rate and no cash reading")
    } else {
        json!("Income is not set and there is no cash reading")
    };
    let money = |v: Option<f64>| v.map(|x| num_value(x.round())).unwrap_or(Value::Null);
    json!({
        "status": if value.is_some() { "ok" } else { "unavailable" },
        "reason": reason,
        "budget": money(value),
        "basis": basis,
        "max_price_income": money(max_income),
        "max_price_cash": money(max_cash),
        "monthly_capacity": money(monthly),
        "payment_factor": k.map(|k| (k * 1e8).round() / 1e8),
        "rate": {"rate_30y": base, "rate_adj": adj, "rate_used": used.map(|r| (r * 1000.0).round() / 1000.0),
                 "as_of": rate.get("as_of").cloned().unwrap_or(Value::Null), "source": rate.get("source").cloned().unwrap_or(Value::Null)},
        "cash": cash,
        "income": {"income_annual": money(income), "co_income_annual": money(Some(co)),
                   "src": p.get("income_src").cloned().unwrap_or(Value::Null), "as_of": p.get("income_asof").cloned().unwrap_or(Value::Null)},
        "inputs": {"monthly_debt": money(Some(debt)), "dti_max": dti, "down_pct": down, "closing_pct": closing, "tax_ins_rate": tax},
        "formula": "M = (income_annual + co_income_annual) / 12 * dti_max - monthly_debt; k = 30-year payment factor at rate_30y + rate_adj; max_price_income = M / ((1 - down_pct) * k + tax_ins_rate / 12); max_price_cash = cash / (down_pct + closing_pct); budget = min of both",
    })
}

async fn read_text(p: PathBuf) -> Option<String> {
    match tokio::fs::metadata(&p).await {
        Ok(m) if m.len() <= MAX_FILE => tokio::fs::read_to_string(&p).await.ok(),
        _ => None,
    }
}

async fn profile_view(c: &Cache, home: &Path, p: Option<Map<String, Value>>) -> Value {
    let stored = p.is_some();
    let prof = p.unwrap_or_else(defaults);
    let manifest = c.manifest(home).await.ok();
    let rate = match manifest.as_deref().and_then(|m| m.get("mortgage")).and_then(|m| m.get("rate_30y")) {
        Some(_) => rate_from(manifest.as_deref(), None),
        None => {
            let re = read_text(home.join(REALESTATE)).await.and_then(|t| serde_json::from_str::<Value>(&t).ok());
            rate_from(None, re.as_ref())
        }
    };
    let cash = if prof.get("cash_mode").and_then(Value::as_str) == Some("manual") {
        match f(&prof, "cash_manual") {
            Some(v) => json!({"value": num_value(v.round()), "source": "Entered by hand", "as_of": epoch_of(prof.get("updated_at")), "reason": null}),
            None => json!({"value": null, "source": "Entered by hand", "as_of": null, "reason": "No cash amount entered"}),
        }
    } else {
        cash_from_finance(read_text(home.join(crate::sources::FINANCE.rel)).await.as_deref())
    };
    let b = budget(&prof, &rate, &cash);
    json!({"profile": Value::Object(prof), "stored": stored, "budget": b, "t": now_epoch()})
}

/// `GET /api/housing/profile`
pub async fn profile_get(c: &Cache, home: &Path) -> (u16, Value) {
    let file = profile_path(home);
    match tokio::task::spawn_blocking(move || load_profile(&file)).await {
        Ok(Ok(p)) => (200, profile_view(c, home, p).await),
        Ok(Err(e)) => (500, json!({"error": e})),
        Err(_) => (500, json!({"error": "profile read failed"})),
    }
}

/// `POST /api/housing/profile` with a JSON object of editable fields.
pub async fn profile_post(c: &Cache, home: &Path, body: &[u8]) -> (u16, Value) {
    let change = match parse_profile(body) {
        Ok(m) => m,
        Err(e) => return (if e == "too large" { 413 } else { 400 }, json!({"ok": false, "error": e})),
    };
    let file = profile_path(home);
    let now = now_epoch();
    let saved = tokio::task::spawn_blocking(move || -> Result<Map<String, Value>, String> {
        let _g = LOCK.lock().map_err(|_| "profile lock poisoned".to_string())?;
        let mut m = load_profile(&file)?.unwrap_or_else(defaults);
        for (k, v) in change {
            m.insert(k, v);
        }
        m.insert("schema".into(), json!(1));
        m.insert("updated_at".into(), json!(now));
        save_profile(&file, &m)?;
        Ok(m)
    })
    .await;
    match saved {
        Ok(Ok(m)) => {
            let mut v = profile_view(c, home, Some(m)).await;
            v["ok"] = json!(true);
            (200, v)
        }
        Ok(Err(e)) => (500, json!({"ok": false, "error": e})),
        Err(_) => (500, json!({"ok": false, "error": "profile write failed"})),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn qs(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    fn table() -> Table {
        let raw = include_str!("../../tests/fixtures/housing-national/zips.json");
        let f: ZipsFile = match serde_json::from_str(raw) {
            Ok(f) => f,
            Err(e) => panic!("fixture zips.json: {e}"),
        };
        Table::from_file(f)
    }

    fn zips(v: &Value) -> Vec<String> {
        v["rows"].as_array().map(|a| a.iter().filter_map(|r| r["zip"].as_str().map(str::to_string)).collect()).unwrap_or_default()
    }

    /// A rank query on the v1 fixture (aliases only, no catalog).
    fn v1q(q: &HashMap<String, String>) -> Result<RankQ, String> {
        let t = table();
        rank_query(q, &[], Ctx { table: Some(&t), man: None })
    }

    fn rank_of(pairs: &[(&str, &str)]) -> Value {
        match v1q(&qs(pairs)) {
            Ok(q) => rank_rows(&table(), &q),
            Err(e) => panic!("query refused: {e}"),
        }
    }

    #[test]
    fn query_validation_refuses_bad_values() {
        assert!(v1q(&qs(&[])).is_ok());
        for bad in [
            ("kind", "land"), ("state", "Cal"), ("state", "C1"), ("max_price", "-5"), ("max_price", "abc"),
            ("min_pop", "-1"), ("sort", "nope"), ("limit", "0"), ("limit", "201"), ("offset", "x"),
        ] {
            assert!(v1q(&qs(&[bad])).is_err(), "{bad:?}");
            assert!(rank_query(&qs(&[bad]), &[], Ctx::default()).is_err(), "no data: {bad:?}");
        }
        assert!(v1q(&qs(&[("kind", "housing"), ("sort", "estabs")])).is_err(), "commercial sort on housing");
        let Ok(q) = v1q(&qs(&[("state", "ca"), ("county", "Orange County, los angeles")])) else { panic!("ok") };
        assert_eq!(q.state.as_deref(), Some("CA"));
        assert_eq!(q.county, vec!["orange".to_string(), "los angeles".to_string()]);
    }

    #[test]
    fn housing_rank_sorts_by_score_with_unknown_scores_last() {
        let v = rank_of(&[]);
        assert_eq!(v["total"], 8);
        let z = zips(&v);
        assert_eq!(z.first().map(String::as_str), Some("77494"), "highest h_score first");
        assert_eq!(z.last().map(String::as_str), Some("99999"), "no score sorts last");
        assert_eq!(v["rows"][0]["rank"], 1);
        // a value the publisher does not report stays null, never 0
        let last = &v["rows"][7];
        assert!(last["zhvi"].is_null() && last["h_score"].is_null() && last["pop"].is_null());
    }

    #[test]
    fn housing_filters_state_metro_county_population_and_price() {
        assert_eq!(zips(&rank_of(&[("state", "CA")])).len(), 5);
        let m = rank_of(&[("metro", "san diego-chula vista-carlsbad, ca")]);
        assert_eq!(zips(&m), vec!["92101"]);
        let c = rank_of(&[("county", "Orange,Los Angeles,San Diego"), ("state", "CA")]);
        assert_eq!(c["total"], 4);
        assert_eq!(zips(&rank_of(&[("min_pop", "40000")])).len(), 3);
        // max_price judges zhvi, else list_price; a ZIP with neither is out
        let p = rank_of(&[("max_price", "700000"), ("sort", "price")]);
        assert_eq!(zips(&p), vec!["93501", "77494", "90011", "92101"]);
        assert_eq!(p["rows"][0]["price_src"], "list_price");
        assert_eq!(p["filters"]["max_price"], 700000);
        let q = rank_of(&[("q", "926")]);
        assert_eq!(q["total"], 2);
        assert_eq!(rank_of(&[("q", "huntington")])["total"], 1);
    }

    #[test]
    fn commercial_rank_keeps_unpriced_rows_under_a_budget() {
        let v = rank_of(&[("kind", "commercial"), ("state", "CA"), ("max_price", "1000000")]);
        let z = zips(&v);
        assert!(!z.contains(&"92647".to_string()), "priced above the budget");
        assert!(z.contains(&"92624".to_string()), "no commercial price: the budget does not apply");
        assert_eq!(z.first().map(String::as_str), Some("92101"), "highest c_score first");
        let e = rank_of(&[("kind", "commercial"), ("sort", "estabs"), ("limit", "2")]);
        assert_eq!(e["rows"].as_array().map(Vec::len), Some(2));
        assert_eq!(e["total"], 8);
        assert_eq!(zips(&e), vec!["10001", "90011"]);
        let o = rank_of(&[("kind", "commercial"), ("sort", "estabs"), ("limit", "2"), ("offset", "2")]);
        assert_eq!(o["rows"][0]["rank"], 3);
    }

    #[test]
    fn grade_filter_keeps_named_grades_and_refuses_unknown_letters() {
        for bad in [("grade", "E"), ("grade", "A,X"), ("grade", "AB")] {
            assert!(v1q(&qs(&[bad])).is_err(), "{bad:?}");
        }
        let Ok(q) = v1q(&qs(&[("grade", "a, B,a")])) else { panic!("ok") };
        assert_eq!(q.grades, vec!["A", "B"]);
        let ab = rank_of(&[("grade", "A,B"), ("sort", "grade")]);
        assert_eq!(zips(&ab), vec!["92101", "10001", "77494"], "A and B only, highest area score first");
        assert_eq!(ab["filters"]["grade"], json!(["A", "B"]));
        assert_eq!(ab["rows"][0]["area_grade"], "A");
        // an ungraded ZIP (too little data) is never kept by a grade filter, and its missing grade stays null
        let d = rank_of(&[("grade", "D")]);
        assert_eq!(zips(&d), vec!["92624"]);
        let all = rank_of(&[("sort", "grade")]);
        assert_eq!(all["total"], 8, "no grade filter keeps every row");
        let z = zips(&all);
        assert_eq!(z.first().map(String::as_str), Some("92101"));
        assert!(z[6..].contains(&"93501".to_string()) && z[6..].contains(&"99999".to_string()), "ungraded sort last");
        assert!(all["rows"][7]["area_grade"].is_null());
    }

    #[test]
    fn housing_sorts_by_renters_income_and_colleges() {
        assert_eq!(zips(&rank_of(&[("sort", "renters"), ("limit", "2")])), vec!["10001", "90011"]);
        assert_eq!(zips(&rank_of(&[("sort", "income"), ("limit", "1")])), vec!["92647"]);
        assert_eq!(zips(&rank_of(&[("sort", "colleges"), ("limit", "2")])), vec!["10001", "92101"]);
    }

    // ---- national v2 (tests/fixtures/housing-national-v2: 12 ZIPs, catalog from plan/fields.json) ----

    fn v2() -> (Table, Manifest) {
        let z: ZipsFile = match serde_json::from_str(include_str!("../../tests/fixtures/housing-national-v2/zips.json")) {
            Ok(f) => f,
            Err(e) => panic!("v2 zips.json: {e}"),
        };
        let m: Value = serde_json::from_str(include_str!("../../tests/fixtures/housing-national-v2/manifest.json")).unwrap_or(Value::Null);
        (Table::from_file(z), Manifest::new(m))
    }

    fn rank_v2(pairs: &[(&str, &str)], f: &[&str]) -> Result<Value, String> {
        let (t, m) = v2();
        let f: Vec<String> = f.iter().map(|s| s.to_string()).collect();
        rank_query(&qs(pairs), &f, Ctx { table: Some(&t), man: Some(&m) }).map(|q| rank_rows(&t, &q))
    }

    fn ok_v2(pairs: &[(&str, &str)], f: &[&str]) -> Value {
        rank_v2(pairs, f).unwrap_or_else(|e| panic!("refused {pairs:?} {f:?}: {e}"))
    }

    #[test]
    fn v2_keeps_the_v1_aliases_and_adds_the_headline_columns() {
        let v = ok_v2(&[], &[]);
        assert_eq!((v["total"].as_u64(), v["dataset"].as_str(), v["sort_col"].as_str()), (Some(12), Some("v2"), Some("h_score")));
        assert_eq!(zips(&v).first().map(String::as_str), Some("77494"), "same h_score order as v1");
        let cols: Vec<&str> = v["cols"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
        assert_eq!(&cols[..48], &V1_COLS[..], "v1 columns first, in order");
        for c in ["home_value", "gross_yield", "industrial_score", "ruca_class", "h_conf"] {
            assert!(cols.contains(&c), "{c}");
        }
        assert!(!cols.contains(&"broadband"), "not a default column");
        let row = &v["rows"][0];
        assert!(row.get("rank").is_some() && row.get("price").is_some() && row["broadband"].is_null() && row.get("broadband").is_none());
        assert_eq!(ok_v2(&[("sort", "grade")], &[])["sort_col"], "area_score");
    }

    #[test]
    fn heavy_lists_cut_to_a_state_and_to_the_asked_keys() {
        let metros = json!([
            {"cbsa": "35620", "name": "New York-Newark-Jersey City, NY-NJ-PA", "zips": 900},
            {"cbsa": "31080", "name": "Los Angeles-Long Beach-Anaheim, CA", "zips": 300},
            {"cbsa": "1", "zips": 1},
        ]);
        let f = |s: Option<&str>, k: Option<&[String]>| rows_of(&metros, "metros", s, k);
        assert_eq!(f(Some("NJ"), None).as_array().map(Vec::len), Some(1), "a multi-state metro is in each of its states");
        assert_eq!(f(Some("PA"), None)[0]["cbsa"], "35620");
        assert_eq!(f(Some("CA"), None)[0]["cbsa"], "31080");
        assert_eq!(f(Some("TX"), None), json!([]), "a metro without a name is in no state");
        let keys = ["name".to_string(), "cbsa".to_string()];
        assert_eq!(f(None, Some(&keys))[2], json!({"cbsa": "1"}), "asked keys only, missing ones left out");
        assert_eq!(f(None, None), metros);
        let states = json!([{"state": "CA", "name": "California"}, {"state": "NV", "name": "Nevada"}]);
        assert_eq!(rows_of(&states, "states", Some("NV"), None), json!([{"state": "NV", "name": "Nevada"}]));
    }

    #[test]
    fn v2_sorts_any_rankable_column_by_its_better_direction() {
        // better: higher -> largest first, nulls last
        let gy = ok_v2(&[("sort", "gross_yield")], &[]);
        let z = zips(&gy);
        assert_eq!(&z[..2], &["44507".to_string(), "93501".to_string()]);
        assert_eq!(gy["sort_dir"], "desc");
        assert!(z[10..].contains(&"59001".to_string()) && z[10..].contains(&"99999".to_string()), "no yield sorts last");
        // better: lower -> smallest first
        let dom = ok_v2(&[("sort", "days_on_market"), ("limit", "2")], &[]);
        assert_eq!((zips(&dom), dom["sort_dir"].as_str()), (vec!["90011".to_string(), "77494".to_string()], Some("asc")));
        // unknown, text and commercial-only keys
        for bad in ["nope", "rent_src", "ruca_class", "retail", "lat"] {
            assert_eq!(rank_v2(&[("sort", bad)], &[]).err().as_deref(), Some("bad sort"), "{bad}");
        }
    }

    #[test]
    fn v2_dir_overrides_the_best_first_direction_and_keeps_nulls_last() {
        // L15 (2026-11-17): a second tap on a sorted header flips it
        let up = ok_v2(&[("sort", "gross_yield"), ("dir", "asc")], &[]);
        assert_eq!(up["sort_dir"], "asc");
        let z = zips(&up);
        let down = zips(&ok_v2(&[("sort", "gross_yield")], &[]));
        let present: Vec<&String> = down.iter().filter(|x| !["59001", "99999"].contains(&x.as_str())).collect();
        assert_eq!(z.first(), present.last().copied(), "the lowest yield first");
        assert!(z[10..].contains(&"59001".to_string()) && z[10..].contains(&"99999".to_string()), "no yield still sorts last");
        let dom = ok_v2(&[("sort", "days_on_market"), ("dir", "desc"), ("limit", "1")], &[]);
        assert_eq!(dom["sort_dir"], "desc");
        assert_ne!(zips(&dom), vec!["90011".to_string()]);
        assert_eq!(rank_v2(&[("dir", "up")], &[]).err().as_deref(), Some("bad dir"));
        assert_eq!(v1q(&qs(&[("dir", "asc")])).err().as_deref(), Some("dir needs national v2"), "v1 bodies stay as they are");
    }

    #[test]
    fn v2_sort_names_rank_on_the_blended_metric_with_nulls_last() {
        for (name, col, dir) in [
            ("rent", "typical_rent", "desc"),
            ("yield", "gross_yield", "desc"),
            ("change_1y", "value_trend_1y", "desc"),
            ("change_5y", "value_trend_5y", "desc"),
            ("price", "home_value", "asc"),
            ("pop", "population", "desc"),
            ("income", "income", "desc"),
        ] {
            let v = ok_v2(&[("sort", name), ("limit", "100")], &[]);
            assert_eq!((v["sort"].as_str(), v["sort_col"].as_str(), v["sort_dir"].as_str()), (Some(name), Some(col), Some(dir)));
            let vals: Vec<Option<f64>> = v["rows"].as_array().into_iter().flatten().map(|r| r[col].as_f64()).collect();
            assert_eq!(vals.len(), 12, "{name}");
            let known: Vec<f64> = vals.iter().flatten().copied().collect();
            let first_none = vals.iter().position(Option::is_none).unwrap_or(vals.len());
            assert!(vals[first_none..].iter().all(Option::is_none), "{name}: a row without the blended value sorts last");
            assert!(known.windows(2).all(|w| if dir == "asc" { w[0] <= w[1] } else { w[0] >= w[1] }), "{name}: {known:?}");
        }
        // the raw v1 column orders differently in the fixture: the Rent sort no longer follows `rent`
        let rent = ok_v2(&[("sort", "rent"), ("limit", "1")], &[]);
        assert_eq!(rent["rows"][0]["typical_rent"], 1439);
        assert_ne!(rent["rows"][0]["rent"], 4800);
        // v1 data keeps the v1 columns
        assert_eq!(v1q(&qs(&[("sort", "rent")])).map(|q| q.sort_col).ok().as_deref(), Some("rent"));
    }

    #[test]
    fn v2_commercial_type_selects_a_score_and_min_conf_uses_its_confidence() {
        let t = ok_v2(&[("kind", "commercial"), ("type", "industrial")], &[]);
        assert_eq!((t["sort_col"].as_str(), zips(&t).first().map(String::as_str)), (Some("industrial_score"), Some("77494")));
        assert_eq!(zips(&ok_v2(&[("kind", "commercial"), ("sort", "industrial")], &[])), zips(&t), "sort=industrial is the same rank");
        let c = ok_v2(&[("kind", "commercial"), ("type", "industrial"), ("min_conf", "0.5")], &[]);
        let z = zips(&c);
        assert_eq!(z.first().map(String::as_str), Some("92101"), "77494 has conf 0.3");
        assert!(!z.contains(&"59001".to_string()), "null conf is dropped");
        assert_eq!(c["filters"]["min_conf"], 0.5);
        assert!(c["cols"].as_array().is_some_and(|a| a.contains(&json!("industrial_conf"))), "the conf column rides along");
        assert_eq!(rank_v2(&[("kind", "commercial"), ("min_conf", "0.5")], &[]).err().as_deref(), Some("min_conf does not apply to this sort"));
        assert_eq!(rank_v2(&[("type", "retail")], &[]).err().as_deref(), Some("type needs kind=commercial"));
        assert!(rank_v2(&[("kind", "commercial"), ("type", "land")], &[]).is_err());
        assert!(rank_v2(&[("min_conf", "1.5")], &[]).is_err());
        // h_score has a conf column
        assert_eq!(zips(&ok_v2(&[("min_conf", "0.85")], &[])), vec!["77494", "92101"]);
    }

    #[test]
    fn v2_area_and_f_filters() {
        assert_eq!(zips(&ok_v2(&[("area", "rural")], &[])), vec!["59001"]);
        let mut sm = zips(&ok_v2(&[("area", "small, micro")], &[]));
        sm.sort();
        assert_eq!(sm, vec!["44507", "93501"]);
        assert_eq!(ok_v2(&[("area", "rural")], &[])["filters"]["area"], json!(["rural"]));
        assert!(rank_v2(&[("area", "suburb")], &[]).is_err());
        let f = ok_v2(&[("sort", "gross_yield")], &["gross_yield:ge:5", "days_on_market:le:40"]);
        assert_eq!(zips(&f), vec!["44507", "77494", "90011", "92101"]);
        assert_eq!(f["filters"]["f"], json!(["gross_yield:ge:5", "days_on_market:le:40"]));
        for bad in [&["rent_src:ge:1"][..], &["gross_yield:gt:5"], &["gross_yield:ge:x"], &["nope:ge:1"], &["a:ge:1", "b:ge:1", "c:ge:1", "d:ge:1", "e:ge:1"]] {
            assert!(rank_v2(&[], bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn v2_cols_pick_columns_and_refuse_unknown_ones() {
        let v = ok_v2(&[("cols", "gross_yield,zip,gross_yield"), ("limit", "1")], &[]);
        assert_eq!(v["cols"], json!(["gross_yield", "zip", "h_score", "h_conf"]), "asked, then the sort and conf columns");
        let keys: Vec<&String> = v["rows"][0].as_object().map(|o| o.keys().collect()).unwrap_or_default();
        assert_eq!(keys.len(), 7, "{keys:?}");
        assert_eq!(rank_v2(&[("cols", "zip,nope")], &[]).err().as_deref(), Some("bad cols"));
        // a page's own markets in one call, any dataset
        let mine = ok_v2(&[("zip", "92647, 10001,99999"), ("cols", "zip,home_value")], &[]);
        let mut z = zips(&mine);
        z.sort();
        assert_eq!((z, mine["filters"]["zip"].clone()), (vec!["10001".to_string(), "92647".into(), "99999".into()], json!(["92647", "10001", "99999"])));
        assert_eq!(zips(&rank_of(&[("zip", "92647")])), vec!["92647"]);
        assert!(rank_of(&[])["filters"].get("zip").is_none(), "no zip= keeps today's filters");
        for bad in ["9262", "92647,abcde", &vec!["92647"; 41].join(",")] {
            assert_eq!(rank_v2(&[("zip", bad)], &[]).err().as_deref(), Some("bad zip"), "{bad}");
        }
    }

    #[test]
    fn v1_data_refuses_v2_parameters_and_keeps_todays_body() {
        for (k, v) in [("type", "retail"), ("min_conf", "0.5"), ("area", "rural"), ("cols", "zip")] {
            assert_eq!(v1q(&qs(&[("kind", "commercial"), (k, v)])).err(), Some(format!("{k} needs national v2")));
        }
        let t = table();
        assert_eq!(rank_query(&qs(&[]), &["pop:ge:1".into()], Ctx { table: Some(&t), man: None }).err().as_deref(), Some("f needs national v2"));
        let v = rank_of(&[]);
        for k in ["dataset", "cols", "sort_col", "sort_dir"] {
            assert!(v.get(k).is_none(), "{k}");
        }
        assert!(v["filters"].get("area").is_none());
        assert_eq!(v["rows"][0].as_object().map(|o| o.len()), Some(51), "48 columns + rank, price, price_src");
    }

    #[test]
    fn field_sources_name_the_first_loaded_catalog_source() {
        let (_, m) = v2();
        let rec = match json!({"zhvi": 1, "renter_share": 30.0, "homicide_rate": 4.0, "city": null, "acs": {"x": 1}, "unknown_field": 1}) {
            Value::Object(o) => o,
            _ => Map::new(),
        };
        let fs = field_sources(&rec, &m);
        assert_eq!(fs["zhvi"]["source"], "zillow_zhvi");
        assert!(fs["zhvi"]["as_of"].is_string());
        assert!(fs.get("city").is_none() && fs.get("acs").is_none() && fs.get("unknown_field").is_none());
        // renter_share comes from census_acs5, which did not load in the fixture manifest
        assert!(fs.get("renter_share").is_none(), "{fs}");
        assert_eq!(fs["homicide_rate"]["level"], "county");
        // the staged writer lists sources as objects with the field's own as_of; that date wins over the source row's
        let m2 = Manifest::new(json!({"schema": 2,
            "sources": [{"id": "redfin_zip_market", "name": "Redfin", "status": "ok", "as_of": "2026-10"},
                        {"id": "zillow_zhvi", "name": "Zillow", "status": "unavailable", "as_of": null}],
            "fields": {"zhvi": {"rankable": true, "level": "zip",
                "sources": [{"id": "zillow_zhvi", "as_of": "2026-09"}, {"id": "redfin_zip_market", "as_of": "2026-09-30"}]}}}));
        let rec = match json!({"zhvi": 800000, "home_value": 800000}) {
            Value::Object(o) => o,
            _ => Map::new(),
        };
        assert_eq!(field_sources(&rec, &m2), json!({"zhvi": {"source": "redfin_zip_market", "as_of": "2026-09-30"}}), "v2-only fields stay out");
        assert!(m2.rankable("zhvi"));
        // a ZIP whose rent is the HUD fallback names HUD, not the first catalog source
        let m3 = Manifest::new(json!({"schema": 2,
            "sources": [{"id": "zillow_zori", "status": "ok", "as_of": "2026-09"}, {"id": "hud_safmr", "status": "ok", "as_of": "FY2027"}],
            "fields": {"rent": {"sources": [{"id": "zillow_zori", "as_of": "2026-09"}, {"id": "hud_safmr", "as_of": "FY2027"}]}}}));
        let rec = |src: &str| match json!({"rent": 1290, "rent_src": src}) {
            Value::Object(o) => o,
            _ => Map::new(),
        };
        assert_eq!(field_sources(&rec("hud_safmr_2br"), &m3)["rent"]["source"], "hud_safmr");
        assert_eq!(field_sources(&rec("zori"), &m3)["rent"]["source"], "zillow_zori");
    }

    #[test]
    fn freshness_is_fresh_at_3_days_and_stale_at_15_with_the_weekly_cadence() {
        let now = 1_794_700_000u64;
        let day = 86_400u64;
        let f = |m: Value| freshness(&m, now).into_iter().map(|(k, v)| (k.to_string(), v)).collect::<Map<String, Value>>();
        let fresh = f(json!({"generated_at": now - 3 * day}));
        assert_eq!((fresh["age"].as_u64(), fresh["refresh"].as_u64(), fresh["stale"].as_bool()), (Some(3 * day), Some(604_800), Some(false)));
        let old = f(json!({"generated_at": now - 15 * day}));
        assert_eq!((old["age"].as_u64(), old["stale"].as_bool()), (Some(15 * day), Some(true)));
        // the boundary is two refreshes, as for every deck feed
        assert_eq!(f(json!({"generated_at": now - 14 * day}))["stale"], false);
        // a manifest that names its own cadence wins; an undated or future one is stale with no age
        assert_eq!(f(json!({"generated_at": now - 3 * day, "refresh": 86_400}))["stale"], true);
        for m in [json!({}), json!({"generated_at": "2026-11-14"}), json!({"generated_at": now + 86_400})] {
            let x = f(m);
            assert!(x["age"].is_null() && x["stale"] == true, "{x:?}");
        }
    }

    #[test]
    fn payment_factor_matches_the_standard_formula() {
        // 6% a year: 0.0059955 per dollar per month (standard amortization table)
        assert!((payment_factor(6.0) - 0.005_995_5).abs() < 1e-6);
        assert!((payment_factor(0.0) - 1.0 / 360.0).abs() < 1e-12);
    }

    #[test]
    fn budget_is_the_lower_limit_with_every_input_echoed() {
        let p = match json!({"income_annual": 120000, "co_income_annual": 0, "monthly_debt": 500, "dti_max": 0.4,
            "down_pct": 0.2, "closing_pct": 0.05, "tax_ins_rate": 0.012, "rate_adj": 0}) {
            Value::Object(m) => m,
            _ => Map::new(),
        };
        let rate = json!({"rate_30y": 6.0, "as_of": "2026-11-06", "source": "fixture"});
        let cash = json!({"value": 100000, "source": "fixture", "as_of": 1_794_000_000u64, "reason": null});
        let b = budget(&p, &rate, &cash);
        // M = 120000/12*0.4 - 500 = 3500; k(6%) = 0.0059955; 3500 / (0.8*0.0059955 + 0.001) = about 603,822
        assert_eq!(b["monthly_capacity"], 3500);
        let inc = b["max_price_income"].as_f64().unwrap_or(0.0);
        assert!((inc - 603_822.0).abs() < 50.0, "{inc}");
        assert_eq!(b["max_price_cash"], 400000);
        assert_eq!(b["budget"], 400000);
        assert_eq!(b["basis"], "cash");
        assert_eq!(b["rate"]["rate_used"], 6.0);
        assert_eq!(b["inputs"]["down_pct"], 0.2);
        // no cash reading: the income limit alone, labelled
        let none = json!({"value": null, "source": "Money feed", "as_of": null, "reason": "Money feed is not reporting"});
        let b2 = budget(&p, &rate, &none);
        assert_eq!(b2["basis"], "income only");
        assert!(b2["max_price_cash"].is_null());
        assert_eq!(b2["cash"]["reason"], "Money feed is not reporting");
    }

    #[test]
    fn cash_reads_cash_and_brokerage_groups_only() {
        let body = r#"{"t":1794000000,"sample":false,"as_of":{"balances":1794000100},
            "money":{"groups":[{"id":"cash","usd":1000.4},{"id":"brokerage","usd":2000},{"id":"crypto","usd":5000},{"id":"cards","usd":-300}]}}"#;
        let c = cash_from_finance(Some(body));
        assert_eq!(c["value"], 3000);
        assert_eq!(c["as_of"], 1_794_000_100u64);
        assert_eq!(c["source"], "Money feed (cash + brokerage)");
        assert!(cash_from_finance(Some(r#"{"sample":true,"money":{"groups":[{"id":"cash","usd":5}]}}"#))["value"].is_null());
        assert!(cash_from_finance(Some(r#"{"money":{}}"#))["value"].is_null());
        assert!(cash_from_finance(None)["value"].is_null());
    }

    #[test]
    fn profile_post_validation() {
        assert!(parse_profile(br#"{"down_pct":0.2,"cash_mode":"manual","cash_manual":null,"income_asof":"2026-11-01"}"#).is_ok());
        for bad in [
            &br#"{"down_pct":1.5}"#[..], br#"{"dti_max":0}"#, br#"{"income_annual":-1}"#, br#"{"cash_mode":"magic"}"#,
            br#"{"monthly_debt":null}"#, br#"{"income_asof":"11/01/2026"}"#, br#"{"secret":1}"#, br#"[]"#, br#"{}"#, b"nope",
            br#"{"down_pct":"0.2"}"#,
        ] {
            assert!(parse_profile(bad).is_err(), "{}", String::from_utf8_lossy(bad));
        }
        let big = format!(r#"{{"income_src":"{}"}}"#, "x".repeat(MAX_BODY));
        assert_eq!(parse_profile(big.as_bytes()), Err("too large".into()));
    }

    #[test]
    fn on_demand_reads_are_spaced_and_capped_per_hour() {
        use std::time::{Duration, Instant};
        let mut h = std::collections::VecDeque::new();
        let t0 = Instant::now();
        assert!(admit_fetch(&mut h, t0).is_ok());
        assert!(admit_fetch(&mut h, t0 + Duration::from_secs(3)).is_err(), "too soon");
        for i in 1..FETCH_PER_HOUR as u64 {
            assert!(admit_fetch(&mut h, t0 + Duration::from_secs(20 * i)).is_ok(), "{i}");
        }
        assert!(admit_fetch(&mut h, t0 + Duration::from_secs(20 * FETCH_PER_HOUR as u64)).is_err(), "hourly cap");
        assert!(admit_fetch(&mut h, t0 + Duration::from_secs(3601)).is_ok(), "the oldest left the window");
    }

    // ---- Real estate > Markets (2026-11-17): tests/fixtures/housing-markets is a real excerpt of the live v2 manifest ----

    fn markets_value() -> Value {
        serde_json::from_str(include_str!("../../tests/fixtures/housing-markets/manifest.json")).unwrap_or(Value::Null)
    }

    fn strs(v: &Value) -> Vec<String> {
        v.as_array().map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default()
    }

    #[test]
    fn segments_fall_back_to_the_built_spec_and_keep_catalog_fields_only() {
        let v = markets_value();
        let man = Manifest::new(v.clone());
        let (segs, fields, from) = segments_of(&v, Some(&man));
        assert_eq!(from, "built_in");
        let ids: Vec<String> = segs.as_array().map(|a| a.iter().filter_map(|s| s["id"].as_str().map(str::to_string)).collect()).unwrap_or_default();
        assert_eq!(ids, ["residential", "multifamily", "retail", "office", "industrial", "economy"]);
        let res = &segs[0];
        assert_eq!(res["label"], "Residential");
        assert_eq!(res["lead"], "gross_yield");
        // spec order, catalog fields only
        assert_eq!(strs(&res["fields"]), ["home_value", "value_trend_1y", "typical_rent", "gross_yield", "days_on_market", "price_cuts", "affordability", "mortgage_rate"]);
        assert!(strs(&res["skipped"]).contains(&"zm_heat".to_string()), "a field the build lacks is skipped, never zero");
        // the multifamily lead is not in this build: the first kept field leads
        let mf = &segs[1];
        assert!(strs(&mf["skipped"]).contains(&"zm_zori_mf_yoy".to_string()));
        assert_eq!(mf["lead"], json!(strs(&mf["fields"]).first()));
        assert_eq!(segs[5]["label"], "People and jobs");
        assert_eq!(segs[5]["lead"], "pep_pop_change_1y");
        // the catalog travels with labels, units, direction and named sources
        let gy = &fields["gross_yield"];
        assert_eq!((gy["label"].as_str(), gy["unit"].as_str(), gy["better"].as_str()), (Some("Gross rent yield"), Some("pct"), Some("higher")));
        assert!(gy["sources"].as_array().is_some_and(|a| !a.is_empty() && a.iter().all(|s| s["id"].is_string())));
        assert!(fields["days_on_market"]["better"] == "lower");
        let every: Vec<String> = segs.as_array().into_iter().flatten().flat_map(|s| strs(&s["fields"])).collect();
        assert!(every.iter().all(|f| fields.get(f).is_some()), "every kept field has a catalog entry");
        assert!(fields.get("zm_heat").is_none());
    }

    #[test]
    fn segments_read_the_manifest_copy_in_either_shape_and_drop_bad_entries() {
        let mut v = markets_value();
        v["segments"] = json!([
            {"id": "mine", "label": "Mine", "lead": "nope", "fields": ["pop", "pop", "BAD", "gross_yield", "zm_heat"]},
            {"id": "Bad Id", "label": "x", "fields": ["pop"]},
            {"label": "no id", "fields": ["pop"]},
        ]);
        let man = Manifest::new(v.clone());
        let (segs, _, from) = segments_of(&v, Some(&man));
        assert_eq!(from, "manifest");
        assert_eq!(segs.as_array().map(Vec::len), Some(1), "entries without a clean id are dropped");
        assert_eq!(strs(&segs[0]["fields"]), ["pop", "gross_yield"], "no repeats, no bad ids");
        assert_eq!(strs(&segs[0]["skipped"]), ["zm_heat"]);
        assert_eq!(segs[0]["lead"], "pop", "an unknown lead falls back to the first kept field");
        // the spec object as a whole reads the same
        v["segments"] = json!({"schema": 1, "segments": [{"id": "retail", "label": "Retail", "lead": "retail_score", "fields": ["retail_score"]}]});
        let (segs, _, from) = segments_of(&v, Some(&Manifest::new(v.clone())));
        assert_eq!((from, segs[0]["lead"].as_str()), ("manifest", Some("retail_score")));
        // v1 data has no catalog: nothing is kept, so nothing is shown
        let (segs, fields, _) = segments_of(&json!({}), None);
        assert!(segs.as_array().is_some_and(|a| a.len() == 6 && a.iter().all(|s| strs(&s["fields"]).is_empty() && s["lead"].is_null())));
        assert_eq!(fields, json!({}));
    }

    #[test]
    fn segment_fields_take_their_sources_level_and_name_the_publisher() {
        let v = json!({
            "fields": {
                "rfm_dom": {"label": "Metro median days on market (Redfin)", "unit": "days", "level": null, "sources": [{"id": "redfin_metro_market"}]},
                "rfs_dom": {"label": "State median days on market (Redfin)", "unit": "days", "sources": ["redfin_state_market"]},
                "home_value": {"label": "Typical home value", "unit": "usd", "level": null, "sources": ["redfin_zip", "acs_county"]},
                "qcew_emp_yoy": {"label": "Job change", "unit": "pct", "level": "county", "sources": ["redfin_metro_market"]},
            },
            "sources": [
                {"id": "redfin_metro_market", "name": "Redfin by CBSA", "publisher": "Redfin", "level": "cbsa"},
                {"id": "redfin_state_market", "name": "Redfin by state", "publisher": "Redfin", "level": "state"},
                {"id": "redfin_zip", "level": "zip"},
                {"id": "acs_county", "level": "county"},
            ],
            "segments": [{"id": "residential", "label": "Residential", "fields": ["rfm_dom", "rfs_dom", "home_value", "qcew_emp_yoy"]}],
        });
        let (_, fields, _) = segments_of(&v, Some(&Manifest::new(v.clone())));
        assert_eq!(fields["rfm_dom"]["level"], "cbsa", "a metro plugin's field is a metro field");
        assert_eq!(fields["rfs_dom"]["level"], "state");
        assert!(fields["home_value"]["level"].is_null(), "sources at different levels give no level");
        assert_eq!(fields["qcew_emp_yoy"]["level"], "county", "the catalog's own level wins");
        assert_eq!(fields["rfm_dom"]["sources"][0]["publisher"], "Redfin");
    }

    #[test]
    fn v2_rows_mark_area_values_on_the_asked_columns_only() {
        let (t0, m) = v2();
        let cz = t0.col("zip");
        let mut cols = t0.cols.clone();
        cols.push(AREA_FROM.into());
        let rows = t0
            .rows
            .iter()
            .map(|r| {
                let mut r = r.clone();
                r.push(match Table::zip(&r, cz).as_str() {
                    "92647" => Cell::Str("days_on_market:county, price_cuts:metro,bogus,gross_yield:city".into()),
                    _ => Cell::Null,
                });
                r
            })
            .collect();
        let t = Table::from_file(ZipsFile { generated_at: Value::Null, cols, rows });
        let q = rank_query(&qs(&[("cols", "days_on_market,gross_yield"), ("zip", "92647,77494")]), &[], Ctx { table: Some(&t), man: Some(&m) });
        let v = rank_rows(&t, &q.unwrap_or_else(|e| panic!("{e}")));
        let row = |z: &str| v["rows"].as_array().and_then(|a| a.iter().find(|r| r["zip"] == z).cloned()).unwrap_or(Value::Null);
        assert_eq!(row("92647")["from"], json!({"days_on_market": "county"}), "price_cuts was not asked; a city or bare entry is no mark");
        assert!(row("77494").get("from").is_none(), "a ZIP's own figures carry no mark");
        assert!(row("92647").get(AREA_FROM).is_none(), "the raw column stays out unless asked");
        assert_eq!(area_from(Some("price_cuts:metro")), Some(vec![("price_cuts", "metro")]));
        assert_eq!(area_from(Some(":county,x")), None);
        assert_eq!(area_from(None), None);
    }

    #[tokio::test]
    async fn national_serves_segments_and_takes_every_segment_field_on_the_lists() {
        let home = std::env::temp_dir().join(format!("pdeck-markets-{}", std::process::id()));
        let d = home.join(DIR_V2);
        let _ = std::fs::create_dir_all(&d);
        let _ = std::fs::write(d.join("manifest.json"), include_str!("../../tests/fixtures/housing-markets/manifest.json"));
        let c = Cache::default();
        let (code, v) = national(&c, &home, &qs(&[("part", "segments")])).await;
        assert_eq!((code, v["dataset"].as_str(), v["part"].as_str()), (200, Some("v2"), Some("segments")));
        assert_eq!(v["segments"].as_array().map(Vec::len), Some(6));
        assert!(v["fields"]["home_value"]["label"].is_string());
        assert!(v["refresh"].as_u64().is_some() && v["stale"].is_boolean(), "the page's freshness mark rides along");
        // the widest segment's every field id plus the row keys is one accepted request
        let spec: Value = serde_json::from_str(SEGMENTS_SPEC).unwrap_or(Value::Null);
        let mut keys = vec!["cbsa".to_string(), "name".to_string()];
        keys.extend(strs(&spec["segments"][1]["fields"]));
        assert!(keys.len() > 40, "wider than the old cap");
        let kj = keys.join(",");
        let (code, v) = national(&c, &home, &qs(&[("part", "metros"), ("state", "CA"), ("fields", kj.as_str())])).await;
        assert_eq!(code, 200);
        let rows = v["metros"].as_array().cloned().unwrap_or_default();
        assert_eq!(rows.len(), 3, "the three home metros");
        assert!(rows.iter().all(|r| r["name"].is_string() && r.get("home_value").is_none() && r.get("vacancy_rate").is_some()));
        // too many keys, or a bad key, is refused
        let many = (0..=MAX_LIST_FIELDS).map(|i| format!("f{i}")).collect::<Vec<String>>().join(",");
        assert_eq!(national(&c, &home, &qs(&[("part", "states"), ("fields", many.as_str())])).await.0, 400);
        assert_eq!(national(&c, &home, &qs(&[("part", "states"), ("fields", "Name")])).await.0, 400);
        assert_eq!(national(&c, &home, &qs(&[("part", "segments"), ("fields", "pop")])).await.0, 400, "fields needs a list part");
        let _ = std::fs::remove_dir_all(&home);
    }
}
