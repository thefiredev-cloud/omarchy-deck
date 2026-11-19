//! One row per listing for the realestate feed's homes and commercial rows. A port of `static/deck.js`
//! `dedupeInOrder`, `dedupeListings` and `homeRows`, so the paged `/api/realestate/homes` and
//! `/api/realestate/commercial` routes count and page the rows the web shows. Keep the two in step.
//! A repeat shares a url (fragment dropped) or a normalised street address with a kept row. A priced
//! copy beats an unpriced one, a fresh copy beats a stale one, and a home beats a commercial tie.
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

const LIST_PRICE_MIN: f64 = 10_000.0;
const SQFT_MIN: f64 = 100.0;

/// deck.js `str(v, n)`: a trimmed string cut to `n` characters, anything else is "".
fn text(v: Option<&Value>, n: usize) -> String {
    v.and_then(Value::as_str).map(|s| s.trim().chars().take(n).collect::<String>()).unwrap_or_default()
}

fn num(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|n| n.is_finite())
}

/// deck.js `pfPos` and `listSqft`: a positive size, and one of at least 100 SF (an acreage reads unknown).
fn pos(v: Option<&Value>) -> Option<f64> {
    num(v).filter(|n| *n > 0.0)
}

fn list_sqft(v: Option<&Value>) -> Option<f64> {
    pos(v).filter(|n| *n >= SQFT_MIN)
}

/// deck.js `listPrice`: a price only when the row says USD and the amount is at least $10,000.
fn list_price(r: &Value) -> Option<f64> {
    if !text(r.get("currency"), 8).eq_ignore_ascii_case("USD") {
        return None;
    }
    num(r.get("price")).filter(|p| *p >= LIST_PRICE_MIN)
}

/// deck.js `staleRank`: a row the collector could not refresh ranks behind a fresh copy.
fn stale_rank(r: &Value) -> u8 {
    u8::from(r.get("stale").and_then(Value::as_bool) == Some(true))
}

/// deck.js `addrNorm`: lower case, with each run of characters outside a-z and 0-9 as one space.
fn addr_norm(s: &str) -> String {
    s.to_lowercase().split(|c: char| !(c.is_ascii_lowercase() || c.is_ascii_digit())).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ")
}

/// deck.js `ADDR_WORD`: one spelling per street word, so "Drive" and "Dr" are one address.
fn addr_word(w: &str) -> &str {
    match w {
        "street" => "st", "drive" => "dr", "avenue" => "ave", "boulevard" => "blvd", "road" => "rd", "lane" => "ln",
        "court" => "ct", "place" => "pl", "circle" => "cir", "terrace" => "ter", "highway" => "hwy", "parkway" => "pkwy",
        "north" => "n", "south" => "s", "east" => "e", "west" => "w", "northeast" => "ne", "northwest" => "nw",
        "southeast" => "se", "southwest" => "sw",
        "apartment" | "apt" | "suite" | "ste" | "space" | "spc" => "unit",
        _ => w,
    }
}

/// Scans `c` from `i` while `f` holds; returns the first index that fails it.
fn run(c: &[char], mut i: usize, f: fn(&char) -> bool) -> usize {
    while c.get(i).is_some_and(f) {
        i += 1;
    }
    i
}

fn ws(x: &char) -> bool {
    x.is_whitespace()
}

fn ascii_digit(x: &char) -> bool {
    x.is_ascii_digit()
}

fn ascii_alpha(x: &char) -> bool {
    x.is_ascii_alphabetic()
}

/// Neither `.` nor `$` may cross a line break in the JS patterns below.
fn has_line_break(c: &[char]) -> bool {
    c.iter().any(|x| matches!(x, '\n' | '\r' | '\u{2028}' | '\u{2029}'))
}

/// `^([a-z]{1,2}-?\d{1,4}[a-z]?)\s*-\s*(\d+\s+\S.*)$` (case-insensitive): a unit printed before the street.
/// Returns (unit, rest of the address).
fn unit_before_street(s: &str) -> Option<(String, String)> {
    let c: Vec<char> = s.chars().collect();
    let letters = run(&c, 0, ascii_alpha);
    if !(1..=2).contains(&letters) {
        return None;
    }
    let mut i = letters + usize::from(c.get(letters) == Some(&'-'));
    let digits = run(&c, i, ascii_digit) - i;
    if !(1..=4).contains(&digits) {
        return None;
    }
    i += digits;
    i += usize::from(c.get(i).is_some_and(ascii_alpha));
    let unit_end = i;
    i = run(&c, i, ws);
    if c.get(i) != Some(&'-') {
        return None;
    }
    let rest = run(&c, i + 1, ws);
    let num_end = run(&c, rest, ascii_digit);
    if num_end == rest || !c.get(num_end).is_some_and(ws) {
        return None;
    }
    let tail = run(&c, num_end, ws);
    if tail >= c.len() || has_line_break(&c[tail..]) {
        return None;
    }
    Some((c[..unit_end].iter().collect(), c[rest..].iter().collect()))
}

/// `^(\d+)\s*-\s*(#\s*[a-z0-9]{1,4})\s+(\S.*)$` (case-insensitive): a unit printed as "#" before the street.
/// Returns (number, "#unit", rest of the address).
fn hash_unit_before_street(s: &str) -> Option<(String, String, String)> {
    let c: Vec<char> = s.chars().collect();
    let num_end = run(&c, 0, ascii_digit);
    let i = run(&c, num_end, ws);
    if num_end == 0 || c.get(i) != Some(&'-') {
        return None;
    }
    let hash = run(&c, i + 1, ws);
    if c.get(hash) != Some(&'#') {
        return None;
    }
    let code = run(&c, hash + 1, ws);
    let code_end = run(&c, code, |x| x.is_ascii_alphanumeric());
    if !(1..=4).contains(&(code_end - code)) || !c.get(code_end).is_some_and(ws) {
        return None;
    }
    let rest = run(&c, code_end, ws);
    if rest >= c.len() || has_line_break(&c[rest..]) {
        return None;
    }
    Some((c[..num_end].iter().collect(), c[hash..code_end].iter().collect(), c[rest..].iter().collect()))
}

/// deck.js `addrUnitFirst`: "E110-24901 Dana Point Harbor Dr" reads as "24901 Dana Point Harbor Dr E110".
fn addr_unit_first(s: &str) -> String {
    if let Some((unit, rest)) = unit_before_street(s) {
        return format!("{rest} {unit}");
    }
    match hash_unit_before_street(s) {
        Some((num, unit, rest)) => format!("{num} {rest} {unit}"),
        None => s.to_string(),
    }
}

/// deck.js `addrKey`: the street as one normalised key, with unit and street words spelled one way.
fn addr_key(s: &str) -> String {
    let s: String = s.trim().chars().take(200).collect();
    addr_norm(&addr_unit_first(&s).replace('#', " unit ")).split(' ').map(addr_word).collect::<Vec<_>>().join(" ")
}

/// deck.js `ADDR_UNIT_RE`: a second address part naming a unit ("Unit 4", "#5", "Suite 200", "A-202").
fn is_unit_part(s: &str) -> bool {
    const WORDS: [&str; 16] = ["unit", "apt", "apartment", "suite", "ste", "bldg", "building", "space", "spc", "lot", "pad", "bay", "fl", "floor", "rm", "room"];
    let word: String = s.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_').collect::<String>().to_ascii_lowercase();
    s.starts_with('#') || WORDS.contains(&word.as_str()) || is_unit_code(s)
}

/// `^[a-z]{1,2}-?\d{1,4}[a-z]?$` (case-insensitive): a whole unit code such as "E110" or "A-202".
fn is_unit_code(s: &str) -> bool {
    let c: Vec<char> = s.chars().collect();
    let letters = run(&c, 0, ascii_alpha);
    if !(1..=2).contains(&letters) {
        return false;
    }
    let digits_at = letters + usize::from(c.get(letters) == Some(&'-'));
    let digits_end = run(&c, digits_at, ascii_digit);
    let end = digits_end + usize::from(c.get(digits_end).is_some_and(ascii_alpha));
    (1..=4).contains(&(digits_end - digits_at)) && end == c.len()
}

/// deck.js: a state and ZIP part ("CA", "92629", "CA 92629-1234") is not a city.
fn is_state_zip(s: &str) -> bool {
    fn zip(t: &str) -> bool {
        let (main, ext) = t.split_once('-').map_or((t, None), |(m, e)| (m, Some(e)));
        main.len() == 5 && main.bytes().all(|b| b.is_ascii_digit()) && ext.is_none_or(|e| e.len() == 4 && e.bytes().all(|b| b.is_ascii_digit()))
    }
    if zip(s) {
        return true;
    }
    match s.get(..2) {
        Some(state) if state.bytes().all(|b| b.is_ascii_alphabetic()) => {
            let rest = &s[2..];
            rest.is_empty() || (rest.starts_with(char::is_whitespace) && zip(rest.trim_start()))
        }
        _ => false,
    }
}

/// Drops a trailing " 92629" or " 92629 1234" from a key (deck.js `zip` regex).
fn strip_zip(key: &str) -> Option<String> {
    let t: Vec<&str> = key.split(' ').collect();
    let is_n = |w: &str, n: usize| w.len() == n && w.bytes().all(|b| b.is_ascii_digit());
    let last = *t.last()?;
    if t.len() >= 3 && is_n(last, 4) && is_n(t[t.len() - 2], 5) {
        return Some(t[..t.len() - 2].join(" "));
    }
    (t.len() >= 2 && is_n(last, 5)).then(|| t[..t.len() - 1].join(" "))
}

/// Drops a trailing two-letter state from a key (deck.js `/ [a-z]{2}$/`).
fn strip_state(key: &str) -> Option<String> {
    let t: Vec<&str> = key.split(' ').collect();
    let last = *t.last()?;
    (t.len() >= 2 && last.len() == 2 && last.bytes().all(|b| b.is_ascii_lowercase())).then(|| t[..t.len() - 1].join(" "))
}

fn words(k: &str) -> usize {
    k.split(' ').count()
}

/// deck.js `addrSplit`: a row's street key and city. A city field may carry its state, and the address tail
/// is the city only when the city field is empty.
fn addr_split(x: &Value) -> (String, String) {
    let addr = text(x.get("addr"), 200);
    let mut parts: Vec<&str> = addr.split(',').map(str::trim).filter(|t| !t.is_empty()).collect();
    let mut street = if parts.is_empty() { String::new() } else { parts.remove(0).to_string() };
    if parts.first().is_some_and(|p| is_unit_part(p)) {
        street.push(' ');
        street.push_str(parts.remove(0));
    }
    let tail = parts.first().filter(|t| !is_state_zip(t)).map_or(String::new(), |t| t.to_string());
    let city_raw = text(x.get("city"), 80).split(',').next().unwrap_or("").to_string();
    let mut key = addr_key(&street);
    if let Some(k) = strip_zip(&key).filter(|k| words(k) > 1) {
        key = strip_state(&k).filter(|k2| words(k2) > 1).unwrap_or(k);
    }
    let ck = addr_key(&city_raw);
    if !ck.is_empty() && key.ends_with(&format!(" {ck}")) && words(&key[..key.len() - ck.len() - 1]) > 1 {
        key.truncate(key.len() - ck.len() - 1);
    }
    let city = addr_norm(&city_raw);
    (key, if city.is_empty() { addr_norm(&tail) } else { city })
}

/// deck.js `listingKeys`: the url and the street key; a row with neither is keyed by its whole content.
fn listing_keys(x: &Value) -> Vec<String> {
    let mut k = Vec::new();
    let url = text(x.get("url"), 1000);
    let (street, _) = addr_split(x);
    if !url.is_empty() {
        k.push(format!("url:{}", url.split('#').next().unwrap_or("")));
    }
    if !street.is_empty() {
        k.push(format!("addr:{street}"));
    }
    if k.is_empty() {
        let field = |key: &str| x.get(key).cloned().unwrap_or(Value::Null);
        k.push(format!("row:{}", json!([addr_norm(&text(x.get("city"), 200)), field("type"), field("beds"), field("baths"), field("sqft"), field("price"), field("source")])));
    }
    k
}

/// deck.js `listingId`: "source#id" when the source gives the row its own id.
fn listing_id(x: &Value) -> String {
    let source = text(x.get("source"), 40);
    let id = match x.get("id") {
        Some(Value::String(s)) => s.trim().chars().take(80).collect::<String>(),
        Some(v) if num(Some(v)).is_some() => v.to_string().chars().take(80).collect(),
        _ => String::new(),
    };
    if source.is_empty() || id.is_empty() {
        String::new()
    } else {
        format!("{source}#{id}")
    }
}

/// deck.js `sizesDiffer`: two rows at one street with a different bed or size count are two homes.
fn sizes_differ(x: &Value, y: &Value) -> bool {
    let differ = |a: Option<f64>, b: Option<f64>| matches!((a, b), (Some(p), Some(q)) if p != q);
    differ(pos(x.get("beds")), pos(y.get("beds"))) || differ(list_sqft(x.get("sqft")), list_sqft(y.get("sqft")))
}

/// deck.js `sameListing`: two sources give one street the same asking price and type, so one listing.
fn same_listing(x: &Value, y: &Value) -> bool {
    let t = text(x.get("type"), 20);
    list_price(x).is_some() && list_price(x) == list_price(y) && !t.is_empty() && t == text(y.get("type"), 20) && text(x.get("source"), 40) != text(y.get("source"), 40)
}

/// deck.js `sameSourceTwin`: one source prints one listing under two ids (two Zillow ids, two Matthews ids) with the same asking
/// price and at least one bed or size count that both rows give and that agrees. A parcel list repeats prices but gives no size, so
/// its rows stay apart. A numbered street address printed with one title, type and price under several ids (Lee & Associates
/// 2777 E Cedar St, live feed 2026-11-18) is one listing too, as long as no bed or size count differs.
fn same_source_twin(x: &Value, y: &Value) -> bool {
    let agree = |a: Option<f64>, b: Option<f64>| matches!((a, b), (Some(p), Some(q)) if p == q);
    let numbered = || {
        let title = text(x.get("title"), 120);
        let starts_digit = |r: &Value| text(r.get("addr"), 200).starts_with(|c: char| c.is_ascii_digit());
        !title.is_empty() && title == text(y.get("title"), 120) && starts_digit(x) && starts_digit(y) && text(x.get("type"), 20) == text(y.get("type"), 20)
    };
    let source = text(x.get("source"), 40);
    !source.is_empty()
        && source == text(y.get("source"), 40)
        && list_price(x).is_some()
        && list_price(x) == list_price(y)
        && !sizes_differ(x, y)
        && (agree(pos(x.get("beds")), pos(y.get("beds"))) || agree(list_sqft(x.get("sqft")), list_sqft(y.get("sqft"))) || numbered())
}

/// deck.js `dedupeInOrder`: which rows of `xs`, taken in that order, are kept.
fn dedupe_in_order(xs: &[&Value]) -> Vec<bool> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut streets: HashMap<String, HashSet<String>> = HashMap::new();
    let mut url_streets: HashMap<String, HashSet<String>> = HashMap::new();
    let mut street_ids: HashMap<String, Vec<String>> = HashMap::new();
    let mut kept: HashMap<String, Vec<usize>> = HashMap::new();
    let mut flags = Vec::with_capacity(xs.len());
    for (n, &x) in xs.iter().enumerate() {
        let keys = listing_keys(x);
        let (street, city) = addr_split(x);
        let url = keys.iter().find(|k| k.starts_with("url:")).cloned();
        let id = listing_id(x);
        let repeat = {
            let cs = streets.get(&street).filter(|_| !street.is_empty());
            let us = url.as_ref().and_then(|u| url_streets.get(u));
            let ids = street_ids.get(&street).filter(|_| !street.is_empty());
            let own_ids = !id.is_empty() && ids.is_some_and(|ids| !ids.contains(&id) && ids.iter().any(|o| o.split('#').next() == id.split('#').next()));
            let at: &[usize] = match kept.get(&street) {
                Some(v) if !street.is_empty() => v,
                _ => &[],
            };
            let sized = at.iter().any(|&j| sizes_differ(x, xs[j]) && !same_listing(x, xs[j]));
            // a source's own other id at this street keeps the rows apart, unless the other row is the same listing printed twice
            let own_ids = own_ids && !at.iter().any(|&j| same_source_twin(x, xs[j]));
            let same_url = match (&url, us) {
                (Some(u), Some(us)) if !own_ids && seen.contains(u) => if street.is_empty() { us.len() == 1 && us.contains("") } else { us.contains(&street) },
                _ => false,
            };
            let row_repeat = keys.iter().any(|k| k.starts_with("row:") && seen.contains(k));
            let same_street = cs.is_some_and(|cs| !own_ids && !sized && (cs.contains(&city) || city.is_empty() || cs.contains("")));
            same_url || row_repeat || same_street
        };
        flags.push(!repeat);
        if repeat {
            continue;
        }
        seen.extend(keys);
        if let Some(u) = &url {
            url_streets.entry(u.clone()).or_default().insert(street.clone());
        }
        if !street.is_empty() {
            kept.entry(street.clone()).or_default().push(n);
            streets.entry(street.clone()).or_default().insert(city);
            if !id.is_empty() {
                street_ids.entry(street).or_default().push(id);
            }
        }
    }
    flags
}

/// deck.js `copyOrder`: a priced copy first, then a fresh copy, then the feed's own order.
fn copy_order(a: (usize, &Value), b: (usize, &Value)) -> Ordering {
    let (pa, pb) = (i32::from(list_price(a.1).is_some()), i32::from(list_price(b.1).is_some()));
    (pb - pa).cmp(&0).then_with(|| if pa == 1 && pb == 1 { stale_rank(a.1).cmp(&stale_rank(b.1)) } else { Ordering::Equal }).then(a.0.cmp(&b.0))
}

/// deck.js `dedupeListings`: the indices of one list's kept rows, in the list's own order.
fn dedupe_list(rows: &[&Value]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..rows.len()).collect();
    order.sort_by(|&a, &b| copy_order((a, rows[a]), (b, rows[b])));
    let flags = dedupe_in_order(&order.iter().map(|&i| rows[i]).collect::<Vec<_>>());
    let mut kept: Vec<usize> = order.iter().zip(flags).filter(|(_, keep)| *keep).map(|(&i, _)| i).collect();
    kept.sort_unstable();
    kept
}

fn objects(rows: &[Value]) -> Vec<Value> {
    rows.iter().filter(|x| x.is_object()).cloned().collect()
}

fn select(rows: &[Value], idx: &[usize]) -> Vec<Value> {
    idx.iter().filter_map(|&i| rows.get(i).cloned()).collect()
}

/// deck.js `homeRows`: each list without its repeats, then one copy of a listing that both lists carry.
pub fn feed_rows(homes: &[Value], commercial: &[Value]) -> (Vec<Value>, Vec<Value>) {
    let homes = objects(homes);
    let commercial = objects(commercial);
    let homes = select(&homes, &dedupe_list(&homes.iter().collect::<Vec<_>>()));
    let commercial = select(&commercial, &dedupe_list(&commercial.iter().collect::<Vec<_>>()));
    let all: Vec<Value> = homes.iter().chain(commercial.iter()).cloned().collect();
    let kept: HashSet<usize> = dedupe_list(&all.iter().collect::<Vec<_>>()).into_iter().collect();
    let n = homes.len();
    let homes = homes.into_iter().enumerate().filter(|(i, _)| kept.contains(i)).map(|(_, x)| x).collect();
    let commercial = commercial.into_iter().enumerate().filter(|(j, _)| kept.contains(&(n + j))).map(|(_, x)| x).collect();
    (homes, commercial)
}

/// deck.js `dedupeListings` for one list: its rows without repeats, in feed order.
pub fn feed_list(rows: &[Value]) -> Vec<Value> {
    let objs = objects(rows);
    let kept = dedupe_list(&objs.iter().collect::<Vec<_>>());
    select(&objs, &kept)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kept_ids(rows: &[Value]) -> Vec<String> {
        feed_rows(rows, &[]).0.iter().map(|r| r["id"].as_str().unwrap_or("").to_string()).collect()
    }

    #[test]
    fn two_sources_at_one_address_spelled_ave_and_avenue_show_once() {
        let rows = vec![
            json!({"id": "a", "addr": "9 Ocean Ave", "city": "Dana Point", "price": 900000, "currency": "USD", "beds": 3, "source": "redfin", "url": "https://www.redfin.com/a"}),
            json!({"id": "b", "addr": "9 Ocean Avenue", "city": "Dana Point", "price": 900000, "currency": "USD", "beds": 3, "source": "zillow", "url": "https://www.zillow.com/b"}),
            json!({"id": "c", "addr": "4 Harbor Way", "city": "Dana Point", "price": 1200000, "currency": "USD", "beds": 4, "source": "redfin", "url": "https://www.redfin.com/c"}),
        ];
        assert_eq!(kept_ids(&rows), vec!["a", "c"]);
    }

    #[test]
    fn a_unit_printed_before_the_street_is_the_same_unit_printed_after_it() {
        let rows = vec![
            json!({"id": "a", "addr": "E110-24901 Dana Point Harbor Dr", "city": "Dana Point", "price": 650000, "currency": "USD", "source": "redfin"}),
            json!({"id": "b", "addr": "24901 Dana Point Harbor Dr E110", "city": "Dana Point", "price": 650000, "currency": "USD", "source": "zillow"}),
        ];
        assert_eq!(kept_ids(&rows), vec!["a"]);
    }

    #[test]
    fn two_sizes_at_one_street_are_two_homes() {
        let rows = vec![
            json!({"id": "a", "addr": "100 Ocean Ave", "city": "Dana Point", "price": 800000, "currency": "USD", "beds": 2, "source": "redfin"}),
            json!({"id": "b", "addr": "100 Ocean Ave", "city": "Dana Point", "price": 950000, "currency": "USD", "beds": 3, "source": "zillow"}),
        ];
        assert_eq!(kept_ids(&rows), vec!["a", "b"]);
    }

    #[test]
    fn a_priced_copy_takes_the_place_of_an_unpriced_first_copy_and_a_fresh_one_of_a_stale_one() {
        let unpriced_first = vec![
            json!({"id": "a", "addr": "9 Ocean Ave", "city": "Dana Point", "source": "redfin"}),
            json!({"id": "b", "addr": "9 Ocean Avenue", "city": "Dana Point", "price": 900000, "currency": "USD", "source": "zillow"}),
        ];
        assert_eq!(kept_ids(&unpriced_first), vec!["b"]);
        let stale_first = vec![
            json!({"id": "a", "addr": "9 Ocean Ave", "city": "Dana Point", "price": 900000, "currency": "USD", "stale": true, "source": "redfin"}),
            json!({"id": "b", "addr": "9 Ocean Avenue", "city": "Dana Point", "price": 900000, "currency": "USD", "source": "zillow"}),
        ];
        assert_eq!(kept_ids(&stale_first), vec!["b"]);
    }

    #[test]
    fn parcels_one_source_lists_under_one_index_url_and_street_word_are_each_a_listing() {
        let parcel = |id: &str, apn: &str, price: u32| json!({"id": id, "addr": format!("Vacant land, APN {apn}, Los Angeles, CA"), "city": "Los Angeles", "type": "Land", "price": price, "currency": "USD", "source": "la_ttc", "url": "https://ttc.lacounty.gov/schedule-of-upcoming-auctions/"});
        let rows = vec![parcel("a", "5302-007-007", 20000), parcel("b", "5302-007-008", 23000), parcel("c", "5302-007-009", 41000), parcel("a", "5302-007-007", 20000)];
        assert_eq!(kept_ids(&rows), vec!["a", "b", "c"]);
    }

    #[test]
    fn a_building_on_both_lists_counts_once_and_a_home_wins_a_tie() {
        let home = vec![json!({"id": "h", "addr": "5 Harbor Way", "city": "Dana Point", "source": "redfin"})];
        let commercial = vec![json!({"id": "c", "addr": "5 Harbor Way", "city": "Dana Point", "price": 2500000, "currency": "USD", "type": "Multifamily", "source": "century21"})];
        let (h, c) = feed_rows(&home, &commercial);
        assert!(h.is_empty() && c.len() == 1, "the unpriced home copy is the repeat");
        let priced_home = vec![json!({"id": "h", "addr": "5 Harbor Way", "city": "Dana Point", "price": 2500000, "currency": "USD", "source": "redfin"})];
        let priced_com = vec![json!({"id": "c", "addr": "5 Harbor Way", "city": "Dana Point", "price": 2500000, "currency": "USD", "source": "century21"})];
        let (h, c) = feed_rows(&priced_home, &priced_com);
        assert!(h.len() == 1 && c.is_empty(), "a tie keeps the home");
    }

    #[test]
    fn rows_with_no_address_or_url_are_repeats_only_when_they_are_the_same_row() {
        let rows = vec![json!({"beds": 3, "price": 500000, "currency": "USD"}), json!({"beds": 4, "price": 500000, "currency": "USD"})];
        assert_eq!(feed_rows(&rows, &[]).0.len(), 2);
    }

    #[test]
    fn one_source_printing_one_listing_under_two_ids_counts_once_but_parcels_prices_and_sizes_stay_apart() {
        // live feed 2026-11-18: Zillow prints 400 Fixture Dr under two ids, Matthews prints 300 Example Blvd under two ids
        let zil = |id: &str| json!({"id": id, "addr": "400 Fixture Dr, Trabuco Canyon, CA 92679", "city": "Trabuco Canyon", "price": 52000000, "currency": "USD", "beds": 12, "sqft": 47044, "source": "zillow", "url": format!("https://x.test/{id}")});
        assert_eq!(kept_ids(&[zil("25617156"), zil("325857537")]), vec!["25617156"]);
        let mat = |id: &str| json!({"id": id, "addr": "300 Example Blvd, Fremont, CA 94539", "city": "Fremont", "type": "Retail", "price": 7200000, "currency": "USD", "sqft": 3500, "source": "matthews", "url": format!("https://x.test/{id}")});
        assert_eq!(feed_rows(&[], &[mat("63039"), mat("63001")]).1.len(), 1);
        // one size, two prices: two units
        let svn = |id: &str, price: u32| json!({"id": id, "addr": "330 S Garfield Ave, Unit 120, Alhambra, CA 91801", "city": "Alhambra", "type": "Retail", "price": price, "currency": "USD", "sqft": 1537, "source": "svn", "url": format!("https://x.test/{id}")});
        assert_eq!(feed_rows(&[], &[svn("2237403", 548000), svn("2237367", 685000)]).1.len(), 2);
        // one price, two sizes: two homes
        let mut other = zil("2");
        other["beds"] = json!(11);
        other["sqft"] = json!(40000);
        assert_eq!(kept_ids(&[zil("1"), other]), vec!["1", "2"]);
        // one price and no size on either row: parcels stay apart
        let lot = |id: &str| json!({"id": id, "addr": "Town Center Dr, Apple Valley, CA 92308", "city": "Apple Valley", "type": "Office", "price": 150000, "currency": "USD", "source": "lee-associates", "url": format!("https://x.test/{id}")});
        assert_eq!(feed_rows(&[], &[lot("2617480"), lot("2617471")]).1.len(), 2);
    }

    #[test]
    fn a_numbered_street_printed_under_several_ids_with_one_title_and_price_counts_once() {
        // live feed 2026-11-18: Lee & Associates prints 2777 E Cedar St, Ontario five times at $52M with no type or size
        let cedar = |id: &str| json!({"id": id, "addr": "2777 E Cedar St, Ontario, CA 91761", "city": "Ontario", "title": "2777 E Cedar St", "price": 52000000, "currency": "USD", "source": "lee-associates", "url": format!("https://x.test/?propertyId={id}")});
        assert_eq!(feed_rows(&[], &[cedar("2199278"), cedar("2199285"), cedar("2199312"), cedar("2199316"), cedar("2199318")]).1.len(), 1);
        // a different size, a different price or a different title stays a second listing
        let mut sized = cedar("2");
        sized["sqft"] = json!(5000);
        let mut other_sized = cedar("3");
        other_sized["sqft"] = json!(9000);
        assert_eq!(feed_rows(&[], &[sized, other_sized]).1.len(), 2);
        let mut cheaper = cedar("4");
        cheaper["price"] = json!(48000000);
        assert_eq!(feed_rows(&[], &[cedar("1"), cheaper]).1.len(), 2);
        let mut retitled = cedar("5");
        retitled["title"] = json!("Cedar St Industrial Park");
        assert_eq!(feed_rows(&[], &[cedar("1"), retitled]).1.len(), 2);
    }
}
