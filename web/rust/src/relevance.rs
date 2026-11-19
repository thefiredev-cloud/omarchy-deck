//! Does a listing title look like the watched product? A port of shoptrends `parse.py` `Matcher.title_ok` (shopping MCP,
//! 2026-10-21), so the deck's Amazon view keeps exactly the listings the Shop trends use. Keep the two in step.
//!
//! A title passes when ALL of these hold (case-insensitive, apostrophes ignored, punctuation splits tokens):
//!   1. exclude: none of the watch's `exclude` words or phrases occurs;
//!   2. must: every `must` word or phrase occurs;
//!   3. query: every non-stopword query token occurs as a whole token (numbers and model codes exact; a simple plural and
//!      tv / television count; two adjacent query tokens may be one title token; "55inch" counts as "55");
//!   4. accessory: no accessory word or phrase unless the query or `must` uses it (a "with ... <accessory>" bundle and
//!      "stand mixer" do not count);
//!   5. compat: a for / fits / compatible marker before the first query token rejects ("Case for Sony WH-1000XM5");
//!   6. variant: a variant word right after a query number the query does not use rejects ("iPhone 13 Pro", "RTX 4070 Ti").
use std::collections::{HashMap, HashSet};

const STOPWORDS: &[&str] = &["the", "a", "an", "of", "for", "with", "and", "in", "inch", "inches"];
const SYNONYMS: &[(&str, &[&str])] =
    &[("tv", &["television", "tvs"]), ("television", &["tv", "tvs"]), ("laptop", &["notebook"]), ("notebook", &["laptop"])];
const ACCESSORY_WORDS: &[&str] = &[
    // protection, fit and cosmetics
    "case", "cases", "cover", "covers", "protector", "protectors", "protective", "tempered", "skin", "skins", "sleeve", "sleeves",
    "pouch", "bag", "bags", "strap", "straps", "band", "bands", "lanyard", "sticker", "stickers", "decal", "decals", "cushion",
    "cushions", "pad", "pads", "earpad", "earpads", "tip", "tips",
    // power, cables and mounting
    "charger", "chargers", "charging", "cable", "cables", "cord", "adapter", "adapters", "adaptor", "adaptors", "stand", "stands",
    "mount", "mounts", "holder", "holders",
    // replacement and service
    "replacement", "replacements", "repair", "accessory", "accessories", "attachment", "attachments", "liner", "liners", "parchment",
    // non-products and digital goods
    "membership", "subscription", "download", "downloads",
    // clothing and gear sold around bikes and electronics
    "shorts", "bib", "bibs", "jersey", "jerseys", "helmet", "helmets", "gloves", "pedals", "pump", "controller", "controllers",
    "grip", "grips",
];
const ACCESSORY_PHRASES: &[&str] = &[
    "screen protector", "tempered glass", "digital code", "digital download", "gift card", "user manual", "instruction manual",
    "service manual", "repair manual", "memory card", "online membership", "spare parts", "parts only",
    "for parts", "parts or repair", "parts kit",
];
const EXEMPT_PHRASES: &[&str] = &["stand mixer", "stand mixers"];
const VARIANT_WORDS: &[&str] = &["pro", "max", "mini", "plus", "ultra", "ti", "super", "xt", "xtx"];
const COMPAT_MARKERS: &[&str] = &["for", "fits", "compatible", "compatibility"];
const BUNDLE_MARKERS: &[&str] = &["with", "w", "and", "include", "includes", "including", "incl", "plus"];
const UNITS: &[&str] = &["inch", "in", "gb", "tb", "oz", "mm", "cm", "ft", "lb", "lbs", "qt", "pack", "pc", "pcs", "hz", "w"];

/// Lowercase ASCII alphanumeric tokens, apostrophes dropped (levi's -> levis).
pub fn norm_tokens(text: &str) -> Vec<String> {
    let t: String = text.to_lowercase().chars().filter(|c| !matches!(c, '\'' | '\u{2019}' | '`')).collect();
    t.split(|c: char| !(c.is_ascii_lowercase() || c.is_ascii_digit())).filter(|w| !w.is_empty()).map(str::to_string).collect()
}

/// "Screen Protector, case" -> ["screen protector", "case"]: normalised phrases, no empties, no duplicates.
fn split_terms(v: &str) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for it in v.split(',') {
        let t = norm_tokens(it).join(" ");
        if !t.is_empty() && !out.contains(&t) {
            out.push(t);
        }
    }
    out
}

fn accessory(w: &str) -> bool {
    ACCESSORY_WORDS.contains(&w)
}

/// "55inch" -> "55": a number glued to a unit also counts as the bare number (UNITS plus a trailing "w" for watts).
fn unit_number(t: &str) -> Option<&str> {
    let i = t.find(|c: char| !c.is_ascii_digit())?;
    (i > 0 && UNITS.contains(&&t[i..])).then(|| &t[..i])
}

/// shoptrends `deal_title_ok`: false for a title that sells a paper promise with or instead of the product (protection plan,
/// warranty, subscription, membership, insurance, care pack, gift card, digital code, "with 3-year ..."), so its price is
/// never the best price or a deal.
pub fn deal_title_ok(title: &str) -> bool {
    const WORDS: &[&str] = &["protection", "plan", "plans", "warranty", "warranties", "subscription", "membership", "insurance",
        "carepack", "applecare", "giftcard", "egift"];
    const PAIRS: &[(&str, &str)] = &[("care", "pack"), ("gift", "card"), ("digital", "code"), ("digital", "download"), ("e", "gift")];
    const SPANS: &[&str] = &["year", "years", "yr", "yrs", "month", "months", "mo", "mos"];
    let t = norm_tokens(title);
    if t.is_empty() {
        return false;
    }
    let w = |i: usize| t.get(i).map(String::as_str).unwrap_or("");
    for i in 0..t.len() {
        if WORDS.contains(&w(i)) || PAIRS.iter().any(|(a, b)| w(i) == *a && w(i + 1) == *b) {
            return false;
        }
        // "with 3 year", "with a 2-year", "with 12 months"
        if w(i) == "with" {
            let j = if matches!(w(i + 1), "a" | "an") { i + 2 } else { i + 1 };
            let num = w(j);
            let n = num.find(|c: char| !c.is_ascii_digit()).unwrap_or(num.len());
            if n > 0 && (SPANS.contains(&&num[n..]) || (n == num.len() && SPANS.contains(&w(j + 1)))) {
                return false;
            }
        }
    }
    true
}

/// shoptrends price sanity: with at least 5 prices, keep only those within [0.3, 4] x their median.
pub fn price_band(prices: &[f64]) -> Option<(f64, f64)> {
    if prices.len() < 5 {
        return None;
    }
    let mut p = prices.to_vec();
    p.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let m = p.len() / 2;
    let med = if p.len().is_multiple_of(2) { (p[m - 1] + p[m]) / 2.0 } else { p[m] };
    Some((0.3 * med, 4.0 * med))
}

fn present(q: &str, have: &HashSet<&str>) -> bool {
    if have.contains(q) {
        return true;
    }
    if q.chars().any(|c| c.is_ascii_digit()) {
        return false; // numbers and model codes are exact
    }
    if have.contains(format!("{q}s").as_str()) || (q.len() > 3 && q.ends_with('s') && have.contains(&q[..q.len() - 1])) {
        return true;
    }
    SYNONYMS.iter().find(|(k, _)| *k == q).is_some_and(|(_, ss)| ss.iter().any(|s| have.contains(s)))
}

/// The tokens left after "with / and / includes ... <accessory>" bundles (up to 6 words between) are cut out, as the
/// shoptrends `_BUNDLE` substitution does: scanning left to right, the shortest bundle from each marker.
fn strip_bundles(raw: &[String]) -> Vec<&str> {
    let mut out = vec![];
    let mut i = 0;
    while i < raw.len() {
        if BUNDLE_MARKERS.contains(&raw[i].as_str()) {
            if let Some(j) = (i + 1..raw.len().min(i + 8)).find(|j| accessory(&raw[*j])) {
                i = j + 1;
                continue;
            }
        }
        out.push(raw[i].as_str());
        i += 1;
    }
    out
}

pub fn title_ok(title: &str, query: &str, must: &str, exclude: &str) -> bool {
    let raw = norm_tokens(title);
    if raw.is_empty() {
        return false;
    }
    let body = format!(" {} ", raw.join(" "));
    let has = |t: &String| body.contains(&format!(" {t} "));
    let (must, exclude) = (split_terms(must), split_terms(exclude));
    if exclude.iter().any(has) || !must.iter().all(has) {
        return false;
    }
    let q: Vec<String> = norm_tokens(query).into_iter().filter(|t| !STOPWORDS.contains(&t.as_str())).collect();
    let mut allowed: HashSet<&str> = q.iter().map(String::as_str).collect();
    for m in &must {
        allowed.extend(m.split(' '));
    }
    let mut pos: HashMap<&str, usize> = HashMap::new();
    for (i, t) in raw.iter().enumerate() {
        pos.entry(t.as_str()).or_insert(i);
        if let Some(n) = unit_number(t) {
            pos.entry(n).or_insert(i);
        }
    }
    let have: HashSet<&str> = pos.keys().copied().collect();
    let joined: HashMap<String, usize> = (0..raw.len().saturating_sub(1)).rev().map(|i| (format!("{}{}", raw[i], raw[i + 1]), i)).collect();
    let mut first: Vec<usize> = vec![];
    let mut sat = vec![false; q.len()];
    for (i, t) in q.iter().enumerate() {
        if present(t, &have) {
            sat[i] = true;
            let plural = format!("{t}s");
            let mut cands: Vec<&str> = vec![t.as_str(), plural.as_str()];
            if !t.is_empty() {
                cands.push(&t[..t.len() - 1]);
            }
            if let Some((_, ss)) = SYNONYMS.iter().find(|(k, _)| *k == t.as_str()) {
                cands.extend(ss.iter());
            }
            first.push(cands.iter().filter_map(|c| pos.get(c).copied()).min().unwrap_or(0));
        } else if let Some(&j) = joined.get(t.as_str()) {
            sat[i] = true;
            first.push(j);
        }
    }
    for i in 0..q.len().saturating_sub(1) {
        if !(sat[i] && sat[i + 1]) {
            let pair = format!("{}{}", q[i], q[i + 1]);
            if let Some(p) = pos.get(pair.as_str()).copied().or_else(|| joined.get(&pair).copied()) {
                sat[i] = true;
                sat[i + 1] = true;
                first.push(p);
            }
        }
    }
    if !sat.iter().all(|s| *s) {
        return false;
    }
    // accessory and non-product words, after bundles and "stand mixer" are taken out
    let mut stripped = format!(" {} ", strip_bundles(&raw).join(" "));
    for ph in EXEMPT_PHRASES {
        stripped = stripped.replace(&format!(" {ph} "), " ");
    }
    if stripped.split_whitespace().any(|w| accessory(w) && !allowed.contains(w)) {
        return false;
    }
    let qjoined = norm_tokens(query).join(" ");
    if ACCESSORY_PHRASES.iter().any(|ph| stripped.contains(&format!(" {ph} ")) && !qjoined.contains(ph) && !must.iter().any(|m| m == ph)) {
        return false;
    }
    // for / fits / compatible in front of the first query token
    if let (Some(&lo), Some(marker)) = (first.iter().min(), raw.iter().position(|t| COMPAT_MARKERS.contains(&t.as_str()))) {
        if lo > marker {
            return false;
        }
    }
    // another model of the same family right after a query number
    for t in q.iter().filter(|t| t.chars().any(|c| c.is_ascii_digit())) {
        if let Some(&p) = pos.get(t.as_str()) {
            if raw.get(p + 1).is_some_and(|n| VARIANT_WORDS.contains(&n.as_str()) && !allowed.contains(n.as_str())) {
                return false;
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shoptrends_examples_pass_and_fail_the_same_way() {
        let ok = |t: &str, q: &str| title_ok(t, q, "", "");
        assert!(ok("Sony WH-1000XM5 Wireless Noise Canceling Headphones", "sony wh-1000xm5"));
        assert!(ok("Sony WH1000XM5 Headphones", "sony wh-1000xm5"));
        assert!(!ok("Case for Sony WH-1000XM5", "sony wh-1000xm5"));
        assert!(!ok("Sony WH-CH720N Wireless Headphones", "sony wh-1000xm5"));
        assert!(ok("Apple iPhone 13, 128GB, Blue - Unlocked (Renewed)", "iphone 13"));
        assert!(!ok("Apple iPhone 13 Pro 256GB", "iphone 13"));
        assert!(!ok("Galaxy A15 5G, 64GB", "iphone 13"));
        assert!(!ok("Tempered Glass Screen Protector for iPhone 13", "iphone 13"));
        assert!(ok("Levi's Men's 501 Original Fit Jeans", "levi's 501 jeans"));
        assert!(!ok("Levi's Men's 505 Regular Fit Jeans", "levi's 501 jeans"));
        assert!(ok("MSI GeForce RTX 4070 Ventus 2X 12G", "rtx 4070"));
        assert!(!ok("ASUS RTX 4070 Ti Super", "rtx 4070"));
        assert!(ok("SAMSUNG 55-Inch Class QLED Q60D Smart TV", "samsung 55 inch tv"));
        assert!(ok("Samsung 55inch Crystal UHD Television", "samsung 55 inch tv"));
        assert!(ok("Road Bikes for Men, 700C", "road bike"));
    }

    #[test]
    fn paper_promises_are_never_a_deal_and_outliers_leave_the_band() {
        assert!(deal_title_ok("Apple iPhone 13 128GB Unlocked"));
        for bad in ["iPhone 13 with AppleCare+", "TV 3-Year Protection Plan", "Switch with 2 Year Warranty", "Laptop with a 12-month plan",
            "Store Gift Card", "Ninja Air Fryer with 3 years", ""] {
            assert!(!deal_title_ok(bad), "{bad}");
        }
        assert!(deal_title_ok("Road Bike with 21 Speeds"));
        assert_eq!(price_band(&[1.0, 2.0]), None);
        assert_eq!(price_band(&[300.0, 290.0, 310.0, 89.97, 305.0]), Some((90.0, 1200.0)));
    }

    #[test]
    fn must_and_exclude_are_whole_phrases() {
        assert!(title_ok("KitchenAid Artisan Stand Mixer 5 Qt", "kitchenaid mixer", "stand", ""));
        assert!(!title_ok("KitchenAid Hand Mixer", "kitchenaid mixer", "stand", ""));
        assert!(!title_ok("Side Brush (L/R) for Robot Vacuum", "robot vacuum", "", "l r"));
        assert!(title_ok("Robot Vacuum S8 Black", "robot vacuum", "", "l r"));
        assert!(!title_ok("Desktop PC RTX 4070", "rtx 4070", "", "pc,laptop"));
        assert!(!title_ok("", "rtx 4070", "", ""));
    }

    #[test]
    fn tokens_drop_apostrophes_and_split_on_everything_else() {
        assert_eq!(norm_tokens("Levi\u{2019}s Men's  501-Fit, 12\"x3`"), ["levis", "mens", "501", "fit", "12", "x3"]);
        assert_eq!(norm_tokens("\u{e9}clair \u{4e2d}\u{6587}"), ["clair"]);
        assert!(norm_tokens(" -- ").is_empty());
    }

    #[test]
    fn terms_are_normalised_phrases_without_empties_or_repeats() {
        assert_eq!(split_terms("Screen Protector, case, screen  protector,, ,"), ["screen protector", "case"]);
        assert!(split_terms("").is_empty());
    }

    #[test]
    fn a_number_glued_to_a_known_unit_is_the_bare_number() {
        assert_eq!(unit_number("55inch"), Some("55"));
        assert_eq!(unit_number("65w"), Some("65"));
        assert_eq!(unit_number("128gb"), Some("128"));
        assert_eq!(unit_number("55"), None);
        assert_eq!(unit_number("inch"), None);
        assert_eq!(unit_number("55foo"), None);
    }

    #[test]
    fn price_band_uses_the_median_of_an_even_count_and_ignores_input_order() {
        let band = price_band(&[60.0, 10.0, 40.0, 20.0, 50.0, 30.0]).map(|(lo, hi)| ((lo * 10.0).round(), (hi * 10.0).round()));
        assert_eq!(band, Some((105.0, 1400.0)));
        assert_eq!(price_band(&[1.0, 2.0, 3.0, 4.0]), None);
    }

    #[test]
    fn a_bundled_accessory_is_cut_out_but_a_bare_one_rejects() {
        assert!(title_ok("Canon EOS R50 Camera with Carrying Case", "canon eos r50", "", ""));
        assert!(title_ok("Canon EOS R50 and Battery Grip Bundle", "canon eos r50", "", ""));
        assert!(!title_ok("Canon EOS R50 Carrying Case", "canon eos r50", "", ""));
        assert!(!title_ok("Canon EOS R50 Grip", "canon eos r50", "", ""));
        // a bundle marker with no accessory after it removes nothing
        assert!(title_ok("Canon EOS R50 with Dock", "canon eos r50", "", ""));
        assert!(strip_bundles(&norm_tokens("Camera with Dock")).contains(&"with"));
    }

    #[test]
    fn an_accessory_the_query_or_must_asks_for_is_allowed() {
        assert!(title_ok("Anker Phone Charger 20W", "phone charger", "", ""));
        assert!(!title_ok("Anker Phone Charger 20W", "phone", "", ""));
        assert!(title_ok("Anker Phone Charger 20W", "phone", "charger", ""));
    }

    #[test]
    fn accessory_phrases_reject_unless_the_query_names_them() {
        assert!(!title_ok("Samsung TV for parts", "samsung tv", "", ""));
        assert!(!title_ok("Canon EOS R50 Memory Card", "canon eos r50", "", ""));
        assert!(title_ok("Amazon Gift Card 50", "amazon gift card", "", ""));
    }

    #[test]
    fn plurals_synonyms_and_joined_words_match_but_model_numbers_are_exact() {
        assert!(title_ok("Specialized Road Bike", "road bikes", "", ""));
        assert!(title_ok("Sony Headphones", "sony headphone", "", ""));
        assert!(title_ok("Dell Notebook 15 Inch", "dell laptop", "", ""));
        assert!(title_ok("Samsung 55 Inch Television", "samsung tv", "", ""));
        assert!(title_ok("Apple AirPods Pro", "apple air pods", "", ""));
        assert!(title_ok("Apple Air Pods Pro", "apple airpods", "", ""));
        assert!(!title_ok("Apple iPhone 130", "iphone 13", "", ""));
        assert!(!title_ok("Sony Headphones", "sony speaker", "", ""));
    }

    #[test]
    fn a_variant_after_a_query_number_is_fine_when_the_query_asks_for_it() {
        assert!(title_ok("ASUS RTX 4070 Ti Super 16GB", "rtx 4070 ti super", "", ""));
        assert!(!title_ok("ASUS RTX 4070 Ti 16GB", "rtx 4070", "", ""));
        assert!(title_ok("Apple iPhone 13 Pro Max", "iphone 13", "pro max", ""));
    }

    #[test]
    fn a_compat_marker_after_the_first_query_word_does_not_reject() {
        assert!(title_ok("Sony WH-1000XM5 Headphones for Travel", "sony wh-1000xm5", "", ""));
        assert!(!title_ok("Fits Sony WH-1000XM5 Headphones", "sony wh-1000xm5", "", ""));
        assert!(!title_ok("Compatible with Sony WH-1000XM5", "sony wh-1000xm5", "", ""));
    }

    #[test]
    fn more_paper_promises_are_not_deals() {
        for bad in ["Laptop HP Care Pack 3 Years", "Photoshop Digital Download", "Costco Membership 1 Year", "Store E-Gift Card",
            "Camera with 1yr Warranty", "Laptop with 12 months support"] {
            assert!(!deal_title_ok(bad), "{bad}");
        }
        assert!(deal_title_ok("Camera with 3 Lenses"));
        assert!(deal_title_ok("Mattress with a Memory Foam Top"));
    }
}
