//! Money tab (v9): `finance.json` becomes two views, so a page load never carries an amount.
//!
//! * `GET /api/finance` is the sanitised view: ids, names, kinds, routes, statuses, ages and inventory counts.
//!   Every `values` object and `totals` is dropped here, and each app field is rebuilt from an allow-list
//!   (an unexpected field such as a stray `balance_usd` never leaves).
//! * `GET /api/finance-values` is the values view, requested only when the owner taps Reveal.
//!
//! Both are cookie-only, GET-only and `Cache-Control: no-store` (see `main.rs`). The file is read on every request and
//! nothing is cached in memory, so no amount outlives the response. Nothing in this module logs.
use crate::sources::{self, FINANCE};
use crate::util::now_epoch;
use serde_json::{json, Map, Value};
use std::path::Path;

const KINDS: [&str; 10] = [
    "bank",
    "brokerage",
    "crypto",
    "payments",
    "wallet",
    "networth",
    "tax",
    "shopping",
    "receipts",
    "other",
];
const ROUTES: [&str; 3] = ["iphone_screen", "api", "none"];
const STATUSES: [&str; 6] = [
    "never",
    "ok",
    "stale",
    "needs_owner",
    "needs_unlock",
    "blocked",
];
const MAX_APPS: usize = 120;
/// How a source is read: a live API call, an end-of-day report, or a provider snapshot taken once a day.
const BASES: [&str; 3] = ["live", "eod", "daily"];
const SENSES: [&str; 2] = ["asset", "liability"];
const MAX_GROUPS: usize = 12;

/// Enum field: anything outside the contract becomes the fallback, never free text.
fn pick(v: Option<&Value>, allowed: &[&str], fallback: &str) -> String {
    match v.and_then(Value::as_str) {
        Some(s) if allowed.contains(&s) => s.to_string(),
        _ => fallback.to_string(),
    }
}

/// App id: the key a Reveal tap looks up. Only `[A-Za-z0-9._-]`, 40 chars at most.
fn ident(v: Option<&Value>, index: usize) -> String {
    let s: String = v
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .take(40)
        .collect();
    if s.is_empty() {
        format!("app{index}")
    } else {
        s
    }
}

fn text(v: Option<&Value>, n: usize) -> String {
    v.and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .chars()
        .take(n)
        .collect()
}

/// Status prose (`reason`, `explain`) that leaves the machine: capped like `text`, and dropped whole unless every
/// number in it is a date (2026-10-21), a clock time (6:40) or a count of at most two digits ("34 apps"). So an amount
/// in any shape ("4,242", "4242", "12.34", "12k", full-width digits), a currency sign or word, or an account number
/// never leaves.
pub(crate) fn note(v: Option<&Value>, n: usize) -> Option<String> {
    let s = text(v, n);
    let money_word = |w: &str| ["usd", "dollar", "dollars", "eur", "euro", "euros", "gbp", "bucks"].contains(&w.to_lowercase().as_str());
    if s.is_empty() || s.contains(['$', '€', '£', '¥', '₹']) || s.split(|c: char| !c.is_alphanumeric()).any(money_word) {
        return None;
    }
    let date = |t: &str| {
        let b = t.as_bytes();
        b.len() == 10 && b[4] == b'-' && b[7] == b'-' && t.chars().filter(char::is_ascii_digit).count() == 8
    };
    let time = |t: &str| {
        t.split_once(':').is_some_and(|(h, m)| {
            (1..=2).contains(&h.len()) && m.len() == 2 && h.chars().chain(m.chars()).all(|c| c.is_ascii_digit())
        })
    };
    let ok = s.split_whitespace().all(|w| {
        let t = w.trim_matches(|c: char| !c.is_alphanumeric());
        !t.chars().any(char::is_numeric) || date(t) || time(t) || (t.len() <= 2 && t.chars().all(|c| c.is_ascii_digit()))
    });
    ok.then_some(s)
}

/// A collector's diagnostic line (an `errors` row's source or reason, a `src` entry) on a public route. `note` is too strict
/// for these: "HTTP 503 from query1.finance.yahoo.com" is normal wording and must survive. This drops the line whole when
/// it carries a currency sign or word, a bare number of more than three digits or with a decimal or group separator
/// ("4242", "12.34", "4,242"), a `12k` style suffix, or a mixed token with a run of four or more digits.
/// A date, a clock time, a status code and a host name pass. Capped like `text`.
pub(crate) fn diag(v: Option<&Value>, n: usize) -> Option<String> {
    let s = text(v, n);
    let money_word = |w: &str| ["usd", "dollar", "dollars", "eur", "euro", "euros", "gbp", "bucks"].contains(&w.to_lowercase().as_str());
    if s.is_empty() || s.contains(['$', '€', '£', '¥', '₹']) || s.split(|c: char| !c.is_alphanumeric()).any(money_word) {
        return None;
    }
    let date = |t: &str| {
        let b = t.as_bytes();
        b.len() == 10 && b[4] == b'-' && b[7] == b'-' && t.chars().filter(char::is_ascii_digit).count() == 8
    };
    let time = |t: &str| {
        t.split_once(':').is_some_and(|(h, m)| {
            (1..=2).contains(&h.len()) && m.len() == 2 && h.chars().chain(m.chars()).all(|c| c.is_ascii_digit())
        })
    };
    let ok = s.split_whitespace().all(|w| {
        let t = w.trim_matches(|c: char| !c.is_alphanumeric());
        if !t.chars().any(char::is_numeric) || date(t) || time(t) {
            return true;
        }
        if t.chars().all(|c| c.is_numeric() || matches!(c, '.' | ',' | '\'' | '_')) {
            return t.len() <= 3 && t.chars().all(|c| c.is_ascii_digit());
        }
        let (mut run, mut longest) = (0usize, 0usize);
        for c in t.chars() {
            run = if c.is_numeric() { run + 1 } else { 0 };
            longest = longest.max(run);
        }
        let scaled = t.strip_suffix(['k', 'K', 'm', 'M', 'b', 'B']).is_some_and(|d| !d.is_empty() && d.chars().all(|c| c.is_ascii_digit() || c == '.'));
        longest < 4 && !scaled
    });
    ok.then_some(s)
}

fn count(v: Option<&Value>) -> Value {
    json!(v.and_then(Value::as_u64).filter(|n| *n <= 10_000_000))
}

fn plausible(v: Option<&Value>, now: u64) -> Option<u64> {
    v.and_then(Value::as_u64)
        .filter(|t| *t > 1_500_000_000 && *t <= now + 300)
}

fn amount(v: Option<&Value>) -> Value {
    json!(v.and_then(Value::as_f64).filter(|n| n.is_finite() && n.abs() < 1e12))
}

/// Assets, liabilities and net for the values view only. Every field is rebuilt from an allow-list: numbers, a short label,
/// two enums. Null when the file has no `money` object.
fn money_view(v: Option<&Value>) -> Value {
    let Some(m) = v.filter(|m| m.is_object()) else {
        return Value::Null;
    };
    let groups: Vec<Value> = m
        .get("groups")
        .and_then(Value::as_array)
        .map(|g| {
            g.iter()
                .take(MAX_GROUPS)
                .enumerate()
                .map(|(i, g)| {
                    json!({
                        "id": ident(g.get("id"), i),
                        "label": text(g.get("label"), 32),
                        "class": pick(g.get("class"), &SENSES, "asset"),
                        "usd": amount(g.get("usd")),
                        "n": count(g.get("n")),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    json!({
        "assets_usd": amount(m.get("assets_usd")),
        "liabilities_usd": amount(m.get("liabilities_usd")),
        "net_usd": amount(m.get("net_usd")),
        "groups": groups,
    })
}

/// Source ids the totals could not count (a bank read failed): ids only, no amount.
fn missing_view(v: Option<&Value>) -> Value {
    let ids: Vec<Value> = v
        .and_then(|m| m.get("missing"))
        .and_then(Value::as_array)
        .map(|a| a.iter().take(8).enumerate().map(|(i, s)| json!(ident(Some(s), i))).collect())
        .unwrap_or_default();
    Value::Array(ids)
}

/// Split one file into (sanitised view, values view). A missing, unreadable or bad file is the same error
/// object in both and carries no data.
pub fn views(body: &str, mtime: Option<u64>, now: u64) -> (Value, Value) {
    let full = sources::deck_feed_from(&FINANCE, body, mtime, now);
    if full.get("error").is_some() {
        return (full.clone(), full);
    }
    let empty = Vec::new();
    let list = full["apps"].as_array().unwrap_or(&empty);
    let mut apps = vec![];
    let mut vals = Map::new();
    for (i, a) in list.iter().take(MAX_APPS).enumerate() {
        let id = ident(a.get("id"), i);
        let last_ok = plausible(a.get("last_ok"), now);
        let values = a.get("values").filter(|v| v.is_object());
        apps.push(json!({
            "id": id,
            "name": text(a.get("name"), 48),
            "kind": pick(a.get("kind"), &KINDS, "other"),
            "route": pick(a.get("route"), &ROUTES, "none"),
            "status": pick(a.get("status"), &STATUSES, "never"),
            "last_ok": last_ok,
            "age": last_ok.map(|t| now.saturating_sub(t)),
            "has_values": values.is_some(),
            // how this source is read and how old its data is: a plain label and the data's own oldest and newest times
            "basis": pick(a.get("basis"), &BASES, ""),
            "data_as_of": plausible(a.get("data_as_of"), now),
            "data_newest": plausible(a.get("data_newest"), now),
            "sense": pick(a.get("sense"), &SENSES, "asset"),
            "note": note(a.get("note"), 160),
            // why the app is not ok (null while ok): one capped sentence, never free structure, never an amount
            "reason": note(a.get("reason"), 160),
            // how often the writer reads this source (seconds): the page calls an "ok" capture out of date after twice this
            "cadence_s": a.get("cadence_s").and_then(Value::as_u64).filter(|n| *n > 0 && *n <= 366 * 86_400),
        }));
        if let Some(v) = values {
            vals.entry(id).or_insert_with(|| v.clone());
        }
    }
    let inv = full.get("inventory");
    let inv_t = plausible(inv.and_then(|i| i.get("t")), now);
    let has_totals = full["totals"].is_object();
    let mut public = Map::new();
    let mut values = Map::new();
    for k in ["src", "refresh", "t", "age", "stale"] {
        public.insert(k.into(), full[k].clone());
        values.insert(k.into(), full[k].clone());
    }
    public.insert("sources".into(), full["sources"].clone());
    public.insert("not_counted".into(), missing_view(full.get("money")));
    // one `generated_at` per feed and `as_of` per block (balances, inventory); old files carry neither and read null
    public.insert("generated_at".into(), json!(plausible(full.get("generated_at"), now)));
    public.insert(
        "as_of".into(),
        json!({
            "balances": plausible(full.get("as_of").and_then(|a| a.get("balances")), now),
            "inventory": plausible(full.get("as_of").and_then(|a| a.get("inventory")), now),
        }),
    );
    // status counts: only the six contract statuses, counts as plain numbers (an unknown key never leaves)
    let mut counts = Map::new();
    for s in STATUSES {
        let n = count(full.get("status_counts").and_then(|c| c.get(s)));
        if !n.is_null() {
            counts.insert(s.into(), n);
        }
    }
    public.insert("status_counts".into(), if full.get("status_counts").is_some_and(Value::is_object) { Value::Object(counts) } else { Value::Null });
    public.insert(
        "explain".into(),
        json!({
            "never": note(full.get("explain").and_then(|e| e.get("never")), 200),
            "last_checked": note(full.get("explain").and_then(|e| e.get("last_checked")), 200),
        }),
    );
    let errors: Vec<Value> = full["errors"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .map(|row| {
                    let mut row = row.clone();
                    row["reason"] = json!(note(row.get("reason"), 160).unwrap_or_else(|| "reason withheld".into()));
                    row
                })
                .collect()
        })
        .unwrap_or_default();
    public.insert("errors".into(), Value::Array(errors));
    public.insert("sample".into(), json!(full["sample"] == Value::Bool(true)));
    public.insert(
        "inventory".into(),
        json!({
            "installed": count(inv.and_then(|i| i.get("installed"))),
            "finance_related": count(inv.and_then(|i| i.get("finance_related"))),
            "covered": count(inv.and_then(|i| i.get("covered"))),
            "src": text(inv.and_then(|i| i.get("src")), 80),
            "t": inv_t,
        }),
    );
    public.insert("apps".into(), Value::Array(apps));
    public.insert("has_totals".into(), json!(has_totals));
    values.insert("apps".into(), Value::Object(vals));
    values.insert("money".into(), money_view(full.get("money")));
    values.insert(
        "totals".into(),
        if has_totals {
            full["totals"].clone()
        } else {
            Value::Null
        },
    );
    (Value::Object(public), Value::Object(values))
}

/// Read the file and return (sanitised view, values view). Nothing is kept.
pub async fn load(home: &Path) -> (Value, Value) {
    match sources::read(&home.join(FINANCE.rel)).await {
        Ok((body, mtime)) => views(&body, mtime, now_epoch()),
        Err(e) => {
            let f = sources::fail(&FINANCE, e);
            (f.clone(), f)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_790_712_300;
    // obviously fake round numbers; the probes below must never appear in the sanitised view
    const FILE: &str = r#"{"v":1,"t":1790712000,"refresh":3600,"src":["finance-master ledger (sample)"],
      "errors":[{"source":"coinbase","reason":"needs you present"}],"sample":true,
      "inventory":{"installed":190,"finance_related":14,"covered":2,"src":"iphone_apps cache","t":1790700000},
      "apps":[
       {"id":"coinbase","name":"Coinbase","bundle":"com.coinbase.Coinbase","kind":"crypto","route":"iphone_screen","status":"ok",
        "last_ok":1790711000,"age_s":1000,"balance_usd":777777.77,
        "values":{"balance_usd":424242.42,"as_of":1790711000,"items":[{"label":"BTC","usd":313131.31}]}},
       {"id":"chase","name":"Chase","kind":"bank","route":"api","status":"stale","last_ok":1790600000,"age_s":112300,
        "values":{"balance_usd":919191.91,"as_of":1790600000,"items":[]}},
       {"id":"fidelity","name":"Fidelity","kind":"brokerage","route":"iphone_screen","status":"never","last_ok":null,"age_s":null,"values":null},
       {"id":"x<b>","name":"Evil <img src=x onerror=alert(1)>","kind":"casino","route":"telepathy","status":"great","last_ok":"yesterday","values":null}
      ],
      "totals":{"net_usd":565656.56,"by_kind":{"bank":919191.91},"apps_ok":1,"apps":4}}"#;

    #[test]
    fn finance_is_not_in_the_generic_feed_route() {
        assert!(sources::feed_def("finance").is_none(), "FINANCE must never be in FEEDS");
    }

    #[test]
    fn sanitised_view_has_no_amounts_no_values_and_no_totals() {
        let (p, _) = views(FILE, None, NOW);
        let s = p.to_string();
        for amount in ["424242", "313131", "919191", "777777", "565656"] {
            assert!(!s.contains(amount), "{amount} leaked");
        }
        // `as_of` is the public {balances, inventory} timestamp block (2026-10-21); a balance's own `values.as_of` never leaves
        for key in [
            "values", "totals", "balance_usd", "net_usd", "by_kind", "items", "usd", "bundle", "age_s",
        ] {
            assert!(!s.contains(&format!("\"{key}\"")), "{key} leaked");
        }
        assert_eq!(p["sample"], true);
        assert_eq!(p["has_totals"], true);
        assert_eq!(p["inventory"]["installed"], 190);
        assert_eq!(p["inventory"]["finance_related"], 14);
        assert_eq!(p["inventory"]["covered"], 2);
        assert_eq!(p["inventory"]["src"], "iphone_apps cache");
        assert_eq!(p["age"], 300);
        assert_eq!(p["stale"], false);
        assert_eq!(p["refresh"], 3600);
        assert_eq!(p["errors"][0]["source"], "coinbase");
    }

    #[test]
    fn error_reasons_never_carry_an_amount() {
        let file = r#"{"v":1,"t":1790712000,"refresh":3600,"src":["x"],"sample":true,
          "errors":[{"source":"chase","reason":"balance 424242.42 did not parse"},
                    {"source":"coinbase","reason":"needs you present"}],"apps":[]}"#;
        let (p, _) = views(file, None, NOW);
        let s = p.to_string();
        assert!(!s.contains("424242"), "{s}");
        assert_eq!(p["errors"][0]["reason"], "reason withheld");
        assert_eq!(p["errors"][1]["reason"], "needs you present");
    }

    #[test]
    fn status_fields_pass_as_numbers_and_short_text_only() {
        let file = r#"{"v":1,"t":1790712000,"generated_at":1790712000,"refresh":3600,"src":["x"],"errors":[],
          "as_of":{"balances":1790700000,"inventory":1790690000,"secret":777777},
          "status_counts":{"never":34,"ok":3,"needs_owner":1,"evil":5,"blocked":"many"},
          "explain":{"never":"Never means not read yet.","last_checked":"Last checked is the app list scan.","token":"x"},
          "inventory":{"installed":1,"finance_related":1,"covered":1,"t":1790690000},
          "apps":[{"id":"a","name":"A","kind":"bank","route":"api","status":"never","reason":"Needs the iPhone unlocked","values":null},
                  {"id":"b","name":"B","kind":"bank","route":"api","status":"ok","last_ok":1790711000,"values":{"balance_usd":424242.42}}]}"#;
        let (p, v) = views(file, None, NOW);
        assert_eq!(p["generated_at"], 1_790_712_000u64);
        assert_eq!(p["as_of"], json!({"balances": 1_790_700_000u64, "inventory": 1_790_690_000u64}));
        assert_eq!(p["status_counts"], json!({"never": 34, "ok": 3, "needs_owner": 1}));
        assert_eq!(p["explain"]["never"], "Never means not read yet.");
        assert_eq!(p["explain"]["last_checked"], "Last checked is the app list scan.");
        assert_eq!(p["apps"][0]["reason"], "Needs the iPhone unlocked");
        assert_eq!(p["apps"][1]["reason"], Value::Null);
        let s = p.to_string();
        assert!(!s.contains("777777") && !s.contains("424242") && !s.contains("evil") && !s.contains("token"), "{s}");
        // the values view carries none of it
        assert!(v.get("status_counts").is_none() && v.get("explain").is_none());
    }

    #[test]
    fn sources_carry_basis_ages_and_the_money_block_stays_in_the_values_view() {
        let file = r#"{"v":1,"t":1790712000,"generated_at":1790712000,"refresh":300,"src":["x"],"errors":[],
          "inventory":{"installed":1,"finance_related":1,"covered":1,"t":1790690000},
          "apps":[{"id":"simplefin-debts","name":"Cards and loans","kind":"bank","route":"api","status":"ok","last_ok":1790711000,
                   "basis":"daily","cadence_s":10800,"data_as_of":1790600000,"data_newest":1790700000,"sense":"liability",
                   "note":"SimpleFIN says: a warning on the last read.","values":{"balance_usd":424242.42,"items":[]}},
                  {"id":"ibkr","name":"IBKR","kind":"brokerage","route":"api","status":"ok","last_ok":1790711000,
                   "basis":"hourly-ish","cadence_s":"fast","data_as_of":"never","sense":"debt","values":{"balance_usd":313131.31}}],
          "money":{"assets_usd":919191.91,"liabilities_usd":565656.56,"net_usd":353535.35,"missing":["kraken","x y"],
                   "groups":[{"id":"cards","label":"Credit cards","class":"liability","usd":565656.56,"n":3,"secret":"x"},
                             {"id":"cash","label":"Cash (bank)","class":"weird","usd":919191.91}]}}"#;
        let (p, v) = views(file, None, NOW);
        let s = p.to_string();
        for amount in ["424242", "313131", "919191", "565656", "353535"] {
            assert!(!s.contains(amount), "{amount} leaked into the public view");
        }
        assert!(p.get("money").is_none());
        assert_eq!(p["not_counted"], json!(["kraken", "xy"]));
        let d = &p["apps"][0];
        assert_eq!((d["basis"].as_str(), d["cadence_s"].as_u64(), d["sense"].as_str()), (Some("daily"), Some(10800), Some("liability")));
        assert_eq!((d["data_as_of"].as_u64(), d["data_newest"].as_u64()), (Some(1_790_600_000), Some(1_790_700_000)));
        assert_eq!(d["note"], "SimpleFIN says: a warning on the last read.");
        // anything outside the contract falls back: unknown basis is empty, bad numbers are null, unknown sense is asset
        let b = &p["apps"][1];
        assert_eq!((b["basis"].as_str(), b["sense"].as_str()), (Some(""), Some("asset")));
        assert!(b["cadence_s"].is_null() && b["data_as_of"].is_null());
        // the values view carries the money block, rebuilt from an allow-list
        let m = &v["money"];
        assert_eq!((m["assets_usd"].as_f64(), m["liabilities_usd"].as_f64(), m["net_usd"].as_f64()), (Some(919191.91), Some(565656.56), Some(353535.35)));
        assert_eq!(m["groups"][0]["class"], "liability");
        assert_eq!(m["groups"][1]["class"], "asset");
        assert!(m["groups"][0].get("secret").is_none());
        // a file without the block has none
        let (_, v2) = views(r#"{"t":1790712000,"apps":[]}"#, None, NOW);
        assert!(v2["money"].is_null());
    }

    #[test]
    fn status_prose_with_an_amount_or_account_number_never_leaves() {
        let s = |x: &str| note(Some(&json!(x)), 160);
        assert_eq!(s("Needs the iPhone unlocked since 2026-10-21"), Some("Needs the iPhone unlocked since 2026-10-21".into()));
        assert_eq!(s("34 apps were never read"), Some("34 apps were never read".into()));
        assert_eq!(s("Checked 2026-10-21 at 6:40, neural sync idle"), Some("Checked 2026-10-21 at 6:40, neural sync idle".into()));
        for leak in ["Balance $4,242.42 is low", "Balance 4242.42 read", "Account 12345678 locked", "Owes £30", "  ",
            "Balance 4,242 low", "1,234,567", "USD 4242", "4242 dollars", "12k left", "owes 300", "\u{FF14}\u{FF12}"] {
            assert_eq!(s(leak), None, "{leak}");
        }
    }

    #[test]
    fn an_older_file_reads_null_status_fields() {
        let (p, _) = views(FILE, None, NOW);
        assert_eq!(p["generated_at"], Value::Null);
        assert_eq!(p["as_of"], json!({"balances": null, "inventory": null}));
        assert_eq!(p["status_counts"], Value::Null);
        assert_eq!(p["explain"], json!({"never": null, "last_checked": null}));
        assert_eq!(p["apps"][0]["reason"], Value::Null);
    }

    #[test]
    fn sanitised_apps_carry_only_the_allow_listed_fields() {
        let (p, _) = views(FILE, None, NOW);
        let a = &p["apps"][0];
        let mut keys: Vec<&str> = a.as_object().map(|o| o.keys().map(String::as_str).collect()).unwrap_or_default();
        keys.sort();
        assert_eq!(
            keys,
            ["age", "basis", "cadence_s", "data_as_of", "data_newest", "has_values", "id", "kind", "last_ok", "name", "note", "reason", "route", "sense", "status"]
        );
        assert_eq!(a["id"], "coinbase");
        assert_eq!(a["kind"], "crypto");
        assert_eq!(a["route"], "iphone_screen");
        assert_eq!(a["status"], "ok");
        assert_eq!(a["age"], 1300);
        assert_eq!(a["has_values"], true);
        assert_eq!(p["apps"][2]["has_values"], false);
        assert_eq!(p["apps"][2]["last_ok"], Value::Null);
        assert_eq!(p["apps"][2]["age"], Value::Null);
        // no cadence in the file: null, never a guess
        assert_eq!(a["cadence_s"], Value::Null);
        let with = FILE.replace(r#""status":"ok",
        "last_ok":1790711000"#, r#""status":"ok","cadence_s":10800,
        "last_ok":1790711000"#);
        assert_eq!(views(&with, None, NOW).0["apps"][0]["cadence_s"], 10800);
        let silly = FILE.replace(r#""status":"ok",
        "last_ok":1790711000"#, r#""status":"ok","cadence_s":-5,
        "last_ok":1790711000"#);
        assert_eq!(views(&silly, None, NOW).0["apps"][0]["cadence_s"], Value::Null);
    }

    #[test]
    fn contract_enums_hold_and_ids_are_clean() {
        let (p, v) = views(FILE, None, NOW);
        let bad = &p["apps"][3];
        assert_eq!(bad["id"], "xb"); // angle brackets stripped from the id
        assert_eq!(bad["kind"], "other");
        assert_eq!(bad["route"], "none");
        assert_eq!(bad["status"], "never");
        assert_eq!(bad["last_ok"], Value::Null);
        assert_eq!(bad["has_values"], false);
        // the name is free text; the deck escapes it (node test), the server only bounds it
        assert!(bad["name"].as_str().unwrap_or("").starts_with("Evil"));
        assert!(v["apps"].get("xb").is_none());
    }

    #[test]
    fn values_view_has_values_and_totals_keyed_by_id_and_nothing_else() {
        let (_, v) = views(FILE, None, NOW);
        assert_eq!(v["apps"]["coinbase"]["balance_usd"], 424242.42);
        assert_eq!(v["apps"]["coinbase"]["items"][0]["label"], "BTC");
        assert_eq!(v["apps"]["chase"]["balance_usd"], 919191.91);
        assert!(v["apps"].get("fidelity").is_none(), "null values are not listed");
        assert_eq!(v["totals"]["net_usd"], 565656.56);
        assert_eq!(v["totals"]["by_kind"]["bank"], 919191.91);
        let s = v.to_string();
        assert!(!s.contains("777777"), "a field outside values must not appear");
        assert!(!s.contains("bundle") && !s.contains("Coinbase"));
        assert_eq!(v["age"], 300);
    }

    #[test]
    fn no_totals_means_null_totals_and_flag_false() {
        let f = r#"{"t":1790712000,"refresh":3600,"apps":[],"totals":null}"#;
        let (p, v) = views(f, None, NOW);
        assert_eq!(p["has_totals"], false);
        assert_eq!(v["totals"], Value::Null);
        assert_eq!(p["apps"].as_array().map(Vec::len), Some(0));
    }

    #[test]
    fn stale_after_two_refreshes_and_rows_survive() {
        let at = |age: u64| {
            format!(
                r#"{{"t":{},"refresh":3600,"apps":[{{"id":"a","name":"A","kind":"bank","route":"api","status":"ok","values":{{"balance_usd":1.5}}}}]}}"#,
                NOW - age
            )
        };
        assert_eq!(views(&at(7140), None, NOW).0["stale"], false);
        let (p, v) = views(&at(7260), None, NOW);
        assert_eq!(p["stale"], true);
        assert_eq!(v["stale"], true);
        assert_eq!(p["apps"][0]["id"], "a");
    }

    #[test]
    fn bad_json_and_non_objects_are_error_objects_without_data() {
        for body in ["", "not json", "[1,2]", "42"] {
            let (p, v) = views(body, None, NOW);
            assert_eq!(p["error"], "bad json", "{body:?}");
            assert_eq!(v["error"], "bad json");
            assert!(p.get("apps").is_none() && v.get("apps").is_none());
            assert_eq!(p["stale"], true);
        }
    }

    #[test]
    fn credential_shaped_keys_inside_values_are_dropped_too() {
        let f = r#"{"t":1790712000,"apps":[{"id":"a","values":{"balance_usd":1.0,"token":"SECRETTOK","api_key":"K"}}]}"#;
        let (_, v) = views(f, None, NOW);
        let s = v.to_string();
        assert!(!s.contains("SECRETTOK") && !s.contains("api_key"));
        assert_eq!(v["apps"]["a"]["balance_usd"], 1.0);
    }

    #[test]
    fn app_list_is_capped() {
        let mut apps = String::from("[");
        for i in 0..150 {
            if i > 0 {
                apps.push(',');
            }
            apps.push_str(&format!(r#"{{"id":"a{i}","values":{{"balance_usd":{i}.5}}}}"#));
        }
        apps.push(']');
        let f = format!(r#"{{"t":1790712000,"apps":{apps}}}"#);
        let (p, v) = views(&f, None, NOW);
        assert_eq!(p["apps"].as_array().map(Vec::len), Some(MAX_APPS));
        assert_eq!(v["apps"].as_object().map(Map::len), Some(MAX_APPS));
    }

    #[test]
    fn duplicate_ids_keep_the_first_values() {
        let f = r#"{"t":1790712000,"apps":[{"id":"a","values":{"balance_usd":1.5}},{"id":"a","values":{"balance_usd":99999.5}}]}"#;
        let (_, v) = views(f, None, NOW);
        assert_eq!(v["apps"]["a"]["balance_usd"], 1.5);
    }

    #[tokio::test]
    async fn load_missing_file_is_one_error_object_for_both_views() {
        let home = std::env::temp_dir().join(format!("pdeck-fin-missing-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let (p, v) = load(&home).await;
        assert_eq!(p["error"], "file missing");
        assert_eq!(v["error"], "file missing");
        assert_eq!(p["stale"], true);
        assert_eq!(p["src"], "~/.meshvault/status/deck/finance.json");
    }

    #[test]
    fn this_module_has_no_logging_calls() {
        // the module comment promises it; keep it true. Counted over the non-test source only.
        let whole = include_str!("finance.rs");
        let code = whole.split("#[cfg(test)]").next().unwrap_or("");
        for banned in ["log(", "println!", "eprintln!", "dbg!", "tracing::", "format!(\"{:?}\""] {
            assert!(!code.contains(banned), "{banned}");
        }
    }
}
