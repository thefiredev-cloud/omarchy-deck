//! Shared readers for the large collector files the Markets pages page through: the typed columnar `zips.json`
//! table, file stamps, bounded JSON reads, a stamp-checked slot and a small stamp-checked LRU. Used by `housing.rs`
//! (national ZIP data) and `listings.rs` (homes, commercial listings and deals).
use serde::de::{Deserializer, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use tokio::sync::Mutex;

/// One `zips.json` cell. Numbers and text are kept; null, booleans, lists and objects are null (no contract column
/// holds them), so an unexpected shape never becomes a number.
#[derive(Clone, Debug, PartialEq)]
pub enum Cell {
    Null,
    Num(f64),
    Str(Box<str>),
}

impl<'de> Deserialize<'de> for Cell {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Cell;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a number, text or null")
            }
            fn visit_unit<E>(self) -> Result<Cell, E> {
                Ok(Cell::Null)
            }
            fn visit_none<E>(self) -> Result<Cell, E> {
                Ok(Cell::Null)
            }
            fn visit_some<D2: Deserializer<'de>>(self, d: D2) -> Result<Cell, D2::Error> {
                Cell::deserialize(d)
            }
            fn visit_bool<E>(self, _: bool) -> Result<Cell, E> {
                Ok(Cell::Null)
            }
            fn visit_i64<E>(self, v: i64) -> Result<Cell, E> {
                Ok(Cell::Num(v as f64))
            }
            fn visit_u64<E>(self, v: u64) -> Result<Cell, E> {
                Ok(Cell::Num(v as f64))
            }
            fn visit_f64<E>(self, v: f64) -> Result<Cell, E> {
                Ok(if v.is_finite() { Cell::Num(v) } else { Cell::Null })
            }
            fn visit_str<E>(self, v: &str) -> Result<Cell, E> {
                Ok(Cell::Str(v.into()))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<Cell, A::Error> {
                while a.next_element::<IgnoredAny>()?.is_some() {}
                Ok(Cell::Null)
            }
            fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Cell, A::Error> {
                while a.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                Ok(Cell::Null)
            }
        }
        d.deserialize_any(V)
    }
}

/// A whole number prints without ".0"; any other finite number as it is.
pub fn num_value(n: f64) -> Value {
    if n.fract() == 0.0 && n.abs() < 9.0e15 {
        Value::from(n as i64)
    } else {
        Value::from(n)
    }
}

impl Cell {
    pub fn value(&self) -> Value {
        match self {
            Cell::Null => Value::Null,
            Cell::Num(n) => num_value(*n),
            Cell::Str(s) => Value::String(s.to_string()),
        }
    }
}

#[derive(Deserialize)]
pub struct ZipsFile {
    #[serde(default)]
    pub generated_at: Value,
    pub cols: Vec<String>,
    pub rows: Vec<Vec<Cell>>,
}

/// (mtime seconds, mtime nanoseconds, size): a file whose stamp changed is parsed again.
pub type Stamp = (i64, i64, u64);

/// A parsed `zips.json`. The `Slot` that holds it keeps the file stamp.
pub struct Table {
    pub generated_at: Value,
    pub cols: Vec<String>,
    ix: HashMap<String, usize>,
    pub rows: Vec<Vec<Cell>>,
    /// ZIP -> row, built on first use (listings look up a listing's county and metro by its ZIP).
    by_zip: OnceLock<HashMap<String, usize>>,
}

impl Table {
    pub fn from_file(f: ZipsFile) -> Table {
        let ix = f.cols.iter().enumerate().map(|(i, c)| (c.clone(), i)).collect();
        Table { generated_at: f.generated_at, cols: f.cols, ix, rows: f.rows, by_zip: OnceLock::new() }
    }
    pub fn col(&self, name: &str) -> Option<usize> {
        self.ix.get(name).copied()
    }
    pub fn num(row: &[Cell], c: Option<usize>) -> Option<f64> {
        match c.and_then(|i| row.get(i)) {
            Some(Cell::Num(n)) => Some(*n),
            _ => None,
        }
    }
    pub fn text(row: &[Cell], c: Option<usize>) -> Option<&str> {
        match c.and_then(|i| row.get(i)) {
            Some(Cell::Str(s)) => Some(s),
            _ => None,
        }
    }
    /// The ZIP as five digits, whether the publisher wrote text or a number.
    pub fn zip(row: &[Cell], c: Option<usize>) -> String {
        match c.and_then(|i| row.get(i)) {
            Some(Cell::Str(s)) => s.to_string(),
            Some(Cell::Num(n)) if *n >= 0.0 && *n < 100_000.0 => format!("{:05}", *n as u32),
            _ => String::new(),
        }
    }
    pub fn object(&self, row: &[Cell]) -> Map<String, Value> {
        self.cols
            .iter()
            .enumerate()
            .map(|(i, c)| (c.clone(), row.get(i).map(Cell::value).unwrap_or(Value::Null)))
            .collect()
    }
    /// The named columns of one row, in the given order.
    pub fn object_cols(&self, row: &[Cell], cols: &[(String, usize)]) -> Map<String, Value> {
        cols.iter().map(|(c, i)| (c.clone(), row.get(*i).map(Cell::value).unwrap_or(Value::Null))).collect()
    }
    /// The row of one ZIP.
    pub fn row_of(&self, zip: &str) -> Option<&[Cell]> {
        let ix = self.by_zip.get_or_init(|| {
            let cz = self.col("zip");
            self.rows.iter().enumerate().map(|(i, r)| (Table::zip(r, cz), i)).collect()
        });
        ix.get(zip).and_then(|i| self.rows.get(*i)).map(Vec::as_slice)
    }
}

/// The file's stamp and size. `absent` is the error text for a missing file, `unreadable` the prefix for any other.
pub async fn stamp(p: &Path, absent: &str, unreadable: &str) -> Result<(Stamp, u64), String> {
    match tokio::fs::metadata(p).await {
        Ok(m) if m.is_file() => Ok(((m.mtime(), m.mtime_nsec(), m.len()), m.len())),
        Ok(_) => Err("not a file".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(absent.into()),
        Err(e) => Err(format!("{unreadable}: {}", e.kind())),
    }
}

/// A JSON file of at most `max` bytes, parsed off the async threads into `T`. `Ok(None)` when it does not exist.
pub async fn read_as<T: serde::de::DeserializeOwned + Send + 'static>(p: PathBuf, max: u64) -> Result<Option<T>, String> {
    match tokio::fs::metadata(&p).await {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("unreadable: {}", e.kind())),
        Ok(m) if m.len() > max => return Err("file is too large".into()),
        Ok(_) => {}
    }
    let got = tokio::task::spawn_blocking(move || -> Result<T, String> {
        let b = std::fs::read(&p).map_err(|e| format!("unreadable: {}", e.kind()))?;
        serde_json::from_slice::<T>(&b).map_err(|_| "not valid JSON".to_string())
    })
    .await
    .map_err(|_| "read failed".to_string())?;
    got.map(Some)
}

/// A JSON file of at most `max` bytes, parsed off the async threads. `Ok(None)` when it does not exist.
pub async fn read_json(p: PathBuf, max: u64) -> Result<Option<Value>, String> {
    read_as::<Value>(p, max).await
}

/// One parsed file kept while its path and stamp stay the same.
pub struct Slot<T>(Mutex<Option<(PathBuf, Stamp, Arc<T>)>>);

impl<T> Default for Slot<T> {
    fn default() -> Self {
        Slot(Mutex::new(None))
    }
}

impl<T> Slot<T> {
    pub async fn get(&self, p: &Path, st: Stamp) -> Option<Arc<T>> {
        let g = self.0.lock().await;
        g.as_ref().filter(|(q, s, _)| q == p && *s == st).map(|(_, _, v)| v.clone())
    }
    pub async fn put(&self, p: &Path, st: Stamp, v: Arc<T>) {
        *self.0.lock().await = Some((p.to_path_buf(), st, v));
    }
}

/// At most `cap` parsed files, most recently used first. An entry whose file stamp changed is parsed again.
pub struct Lru<T> {
    cap: usize,
    items: Mutex<Vec<(PathBuf, Stamp, Arc<T>)>>,
}

impl<T> Lru<T> {
    pub fn new(cap: usize) -> Lru<T> {
        Lru { cap: cap.max(1), items: Mutex::new(Vec::new()) }
    }
    pub async fn get(&self, p: &Path, st: Stamp) -> Option<Arc<T>> {
        let mut g = self.items.lock().await;
        let i = g.iter().position(|(q, _, _)| q == p)?;
        if g[i].1 != st {
            g.remove(i);
            return None;
        }
        let e = g.remove(i);
        let v = e.2.clone();
        g.insert(0, e);
        Some(v)
    }
    pub async fn put(&self, p: &Path, st: Stamp, v: Arc<T>) {
        let mut g = self.items.lock().await;
        g.retain(|(q, _, _)| q != p);
        g.insert(0, (p.to_path_buf(), st, v));
        g.truncate(self.cap);
    }
    #[cfg(test)]
    pub async fn len(&self) -> usize {
        self.items.lock().await.len()
    }
}

// ---------------------------------------------------------------- query helpers shared by the paged routes

/// Trimmed text without control characters, at most `max` characters; None when empty.
pub fn plain(s: &str, max: usize) -> Option<String> {
    let t: String = s.trim().chars().filter(|c| !c.is_control()).take(max).collect();
    (!t.is_empty()).then_some(t)
}

/// "Orange County" and "orange" name the same county.
pub fn county_key(s: &str) -> String {
    let l = s.trim().to_lowercase();
    l.strip_suffix(" county").unwrap_or(&l).trim().to_string()
}

/// The non-empty, trimmed value of one query parameter.
pub fn get<'a>(qs: &'a HashMap<String, String>, k: &str) -> Option<&'a str> {
    qs.get(k).map(|s| s.trim()).filter(|s| !s.is_empty())
}

/// A number in `[min, max]`, None when absent; anything else is `bad <k>`.
pub fn number(qs: &HashMap<String, String>, k: &str, min: f64, max: f64) -> Result<Option<f64>, String> {
    match get(qs, k) {
        None => Ok(None),
        Some(s) => match s.parse::<f64>() {
            Ok(v) if v.is_finite() && v >= min && v <= max => Ok(Some(v)),
            _ => Err(format!("bad {k}")),
        },
    }
}

/// A whole number in `[lo, hi]`, `dflt` when absent; anything else is `bad <k>`.
pub fn int(qs: &HashMap<String, String>, k: &str, dflt: usize, lo: usize, hi: usize) -> Result<usize, String> {
    match get(qs, k) {
        None => Ok(dflt),
        Some(s) => match s.parse::<usize>() {
            Ok(v) if (lo..=hi).contains(&v) => Ok(v),
            _ => Err(format!("bad {k}")),
        },
    }
}

/// Two letters, upper-cased; None when absent.
pub fn state(qs: &HashMap<String, String>) -> Result<Option<String>, String> {
    match get(qs, "state") {
        None => Ok(None),
        Some(s) if s.len() == 2 && s.bytes().all(|b| b.is_ascii_alphabetic()) => Ok(Some(s.to_ascii_uppercase())),
        Some(_) => Err("bad state".into()),
    }
}

/// Every value of a repeatable parameter in the raw query string (`f=a&f=b`), each split on commas.
pub fn all_values(raw: Option<&str>, k: &str) -> Vec<String> {
    let mut out = Vec::new();
    for pair in raw.unwrap_or("").split('&') {
        let (key, v) = pair.split_once('=').unwrap_or((pair, ""));
        if crate::util::pct_decode(key) == k {
            out.extend(crate::util::pct_decode(v).split(',').map(str::trim).filter(|s| !s.is_empty()).map(str::to_string));
        }
    }
    out
}

/// Sort helper: present values first in the asked direction, missing values last, then `tie`.
pub fn order(a: Option<f64>, b: Option<f64>, asc: bool) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    match (a, b) {
        (Some(x), Some(y)) => {
            let o = x.partial_cmp(&y).unwrap_or(Ordering::Equal);
            if asc { o } else { o.reverse() }
        }
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lru_keeps_the_newest_and_drops_a_changed_stamp() {
        let l: Lru<u8> = Lru::new(2);
        let (a, b, c) = (PathBuf::from("/a"), PathBuf::from("/b"), PathBuf::from("/c"));
        l.put(&a, (1, 0, 1), Arc::new(1)).await;
        l.put(&b, (1, 0, 1), Arc::new(2)).await;
        assert_eq!(l.get(&a, (1, 0, 1)).await.as_deref(), Some(&1), "a is now the newest");
        l.put(&c, (1, 0, 1), Arc::new(3)).await;
        assert!(l.get(&b, (1, 0, 1)).await.is_none(), "b was the oldest and left");
        assert_eq!(l.len().await, 2);
        assert!(l.get(&a, (2, 0, 1)).await.is_none(), "a changed on disk: parse again");
        assert_eq!(l.len().await, 1);
    }

    #[test]
    fn repeated_values_and_commas_both_count() {
        assert_eq!(all_values(Some("f=a:ge:1&x=2&f=b%3Ale%3A3,c:ge:4"), "f"), vec!["a:ge:1", "b:le:3", "c:ge:4"]);
        assert!(all_values(None, "f").is_empty());
    }

    #[test]
    fn missing_values_sort_last_both_ways() {
        use std::cmp::Ordering::*;
        assert_eq!(order(Some(1.0), Some(2.0), true), Less);
        assert_eq!(order(Some(1.0), Some(2.0), false), Greater);
        assert_eq!(order(None, Some(2.0), false), Greater);
        assert_eq!(order(None, Some(2.0), true), Greater);
    }

    #[test]
    fn cell_keeps_numbers_and_text_and_nulls_other_shapes() {
        let cell = |s: &str| serde_json::from_str::<Cell>(s).unwrap_or_else(|e| panic!("{s}: {e}"));
        assert_eq!(cell("2.5"), Cell::Num(2.5));
        assert_eq!(cell("7"), Cell::Num(7.0));
        assert_eq!(cell("\"90210\""), Cell::Str("90210".into()));
        assert_eq!(cell("null"), Cell::Null);
        for shape in ["true", "[1,2]", "{\"a\":1}"] {
            assert_eq!(cell(shape), Cell::Null, "{shape} is not a column value");
        }
    }

    #[test]
    fn whole_numbers_print_without_a_fraction() {
        use serde_json::json;
        assert_eq!(num_value(3.0), json!(3));
        assert_eq!(num_value(-2.0), json!(-2));
        assert_eq!(num_value(2.5), json!(2.5));
        assert_eq!(num_value(f64::NAN), Value::Null);
    }

    #[test]
    fn plain_trims_strips_controls_and_caps_length() {
        assert_eq!(plain("  Irvine\u{7}\n ", 40).as_deref(), Some("Irvine"));
        assert_eq!(plain("abcdef", 3).as_deref(), Some("abc"));
        assert_eq!(plain(" \t\n", 10), None);
        assert_eq!(plain("\u{7}", 10), None);
    }

    #[test]
    fn county_names_match_with_or_without_the_suffix() {
        assert_eq!(county_key("Orange County"), "orange");
        assert_eq!(county_key("  orange "), "orange");
        assert_eq!(county_key("San Diego county"), "san diego");
    }

    #[test]
    fn query_numbers_ints_and_states_refuse_out_of_range_text() {
        fn q(pairs: &[(&str, &str)]) -> HashMap<String, String> {
            pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
        }
        let n = q(&[("min", " 2.5 "), ("blank", "  "), ("nan", "NaN"), ("big", "1e3")]);
        assert_eq!(number(&n, "min", 0.0, 10.0), Ok(Some(2.5)));
        assert_eq!(number(&n, "blank", 0.0, 10.0), Ok(None));
        assert_eq!(number(&n, "absent", 0.0, 10.0), Ok(None));
        assert_eq!(number(&n, "nan", 0.0, 10.0), Err("bad nan".to_string()));
        assert_eq!(number(&n, "big", 0.0, 10.0), Err("bad big".to_string()));
        let i = q(&[("n", "12"), ("neg", "-1"), ("frac", "1.5"), ("zero", "0"), ("top", "50")]);
        assert_eq!(int(&i, "n", 5, 1, 50), Ok(12));
        assert_eq!(int(&i, "top", 5, 1, 50), Ok(50), "the upper bound is inclusive");
        assert_eq!(int(&i, "absent", 5, 1, 50), Ok(5));
        assert_eq!(int(&i, "n", 5, 1, 10), Err("bad n".to_string()));
        assert_eq!(int(&i, "neg", 5, 1, 50), Err("bad neg".to_string()));
        assert_eq!(int(&i, "frac", 5, 1, 50), Err("bad frac".to_string()));
        assert_eq!(int(&i, "zero", 5, 1, 50), Err("bad zero".to_string()));
        assert_eq!(state(&q(&[("state", " ca ")])), Ok(Some("CA".to_string())));
        assert_eq!(state(&q(&[])), Ok(None));
        for bad in ["C", "CAL", "C1", "Ö"] {
            assert_eq!(state(&q(&[("state", bad)])), Err("bad state".to_string()), "{bad}");
        }
    }

    #[tokio::test]
    async fn json_reads_refuse_large_and_broken_files() {
        use serde_json::json;
        let dir = std::env::temp_dir().join(format!("pdeck-table-read-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap_or_else(|e| panic!("{e}"));
        let ok = dir.join("ok.json");
        std::fs::write(&ok, br#"{"a":1}"#).unwrap_or_else(|e| panic!("{e}"));
        let bad = dir.join("bad.json");
        std::fs::write(&bad, b"{not json").unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(read_json(ok.clone(), 1024).await, Ok(Some(json!({"a": 1}))));
        assert_eq!(read_json(dir.join("missing.json"), 1024).await, Ok(None));
        assert_eq!(read_json(ok, 4).await, Err("file is too large".to_string()));
        assert_eq!(read_json(bad, 1024).await, Err("not valid JSON".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn stamps_name_missing_and_non_file_paths() {
        let dir = std::env::temp_dir().join(format!("pdeck-table-stamp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap_or_else(|e| panic!("{e}"));
        let f = dir.join("zips.json");
        std::fs::write(&f, b"[]").unwrap_or_else(|e| panic!("{e}"));
        let (st, size) = stamp(&f, "absent", "unreadable").await.unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(size, 2);
        assert_eq!(st.2, 2, "the stamp carries the size too");
        assert_eq!(stamp(&dir.join("missing.json"), "absent", "unreadable").await, Err("absent".to_string()));
        assert_eq!(stamp(&dir, "absent", "unreadable").await, Err("not a file".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn slot_misses_on_another_path_or_a_changed_stamp() {
        let slot: Slot<u8> = Slot::default();
        let (p, other) = (Path::new("/zips/a.json"), Path::new("/zips/b.json"));
        slot.put(p, (1, 0, 2), Arc::new(7)).await;
        assert_eq!(slot.get(p, (1, 0, 2)).await.as_deref(), Some(&7));
        assert!(slot.get(p, (2, 0, 2)).await.is_none(), "a changed stamp misses");
        assert!(slot.get(other, (1, 0, 2)).await.is_none(), "another path misses");
    }
}
