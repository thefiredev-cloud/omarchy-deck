//! Today page: read-only sources that replace the Hermes Desktop Home tab.
//! Every section carries `src` and a timestamp. Failures render as `{"error": ...}`, never a 5xx.
use crate::ha::Ha;
use crate::util::{iso_to_epoch, now_epoch, run};
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

pub async fn gateway(http: &reqwest::Client, url: &str) -> Value {
    let t = now_epoch();
    let src = "live GET /health on the gateway API";
    let r = http.get(url).timeout(Duration::from_secs(3)).send().await;
    match r {
        Ok(r) if r.status().is_success() => match r.json::<Value>().await {
            Ok(v) => json!({
                "ok": v.get("status").and_then(Value::as_str) == Some("ok"),
                "status": v.get("status"), "version": v.get("version"), "src": src, "t": t,
            }),
            Err(_) => json!({"error": "bad reply", "src": src, "t": t}),
        },
        _ => json!({"error": "gateway unreachable", "src": src, "t": t}),
    }
}

/// Roles and unread counts only. Never addresses, subjects or bodies.
pub fn mail_from(text: &str, now: u64) -> Value {
    let src = "~/.meshvault/status/mail/inbox-full.json";
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return json!({"error": "no reading", "src": src});
    };
    let boxes: Vec<Value> = v
        .get("mailboxes")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .map(|b| {
                    json!({
                        "role": b.get("role").and_then(Value::as_str).unwrap_or("mailbox").chars().take(24).collect::<String>(),
                        "unread": b.get("unread").and_then(Value::as_u64),
                        "ok": b.get("ok").and_then(Value::as_bool).unwrap_or(false),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let at = v
        .get("generated_at")
        .and_then(Value::as_str)
        .and_then(iso_to_epoch);
    let all_ok =
        v.get("ok").and_then(Value::as_bool) == Some(true) && boxes.iter().all(|b| b["ok"] == true);
    let stale = at.map(|a| now.saturating_sub(a) > 1800).unwrap_or(true);
    let status = if boxes.is_empty() {
        "unavailable"
    } else if all_ok && !stale {
        "ok"
    } else {
        "partial"
    };
    json!({"status": status, "mailboxes": boxes, "t": at, "stale": stale, "src": src})
}

pub fn cron_from(text: &str, now: u64) -> Value {
    let src = "~/.hermes/cron/jobs.json";
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return json!({"error": "jobs file not readable", "src": src});
    };
    let jobs: Vec<&Value> = match v.get("jobs").unwrap_or(&v) {
        Value::Array(a) => a.iter().collect(),
        _ => return json!({"error": "no job list", "src": src}),
    };
    let enabled: Vec<&&Value> = jobs
        .iter()
        .filter(|j| j.get("enabled").and_then(Value::as_bool) == Some(true)
            && !j.get("state").and_then(Value::as_str).unwrap_or("").eq_ignore_ascii_case("paused"))
        .collect();
    let healthy = |j: &Value| {
        matches!(j.get("last_status"), None | Some(Value::Null))
            || matches!(
                j.get("last_status").and_then(Value::as_str),
                Some("" | "ok" | "success")
            )
    };
    let failing: Vec<String> = enabled
        .iter()
        .filter(|j| !healthy(j))
        .map(|j| {
            j.get("name")
                .and_then(Value::as_str)
                .unwrap_or("?")
                .chars()
                .take(40)
                .collect()
        })
        .collect();
    let mut nxt: Vec<(u64, String)> = enabled
        .iter()
        .filter_map(|j| {
            let at = iso_to_epoch(j.get("next_run_at")?.as_str()?)?;
            (at >= now).then(|| {
                (
                    at,
                    j.get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("?")
                        .chars()
                        .take(40)
                        .collect(),
                )
            })
        })
        .collect();
    nxt.sort();
    let next: Vec<Value> = nxt
        .iter()
        .take(3)
        .map(|(a, n)| json!({"at": a, "name": n}))
        .collect();
    // a briefing is any enabled job whose name says brief ("Morning Inbox and Briefing", "Mesh · Morning brief"); jobs get renamed,
    // so matching two exact titles left the Today card at "No briefing scheduled" while a briefing was queued
    let briefings: Vec<Value> = nxt.iter()
        .filter(|(_, n)| n.to_ascii_lowercase().contains("brief"))
        .map(|(a, n)| json!({"at": a, "name": n}))
        .collect();
    json!({
        "enabled": enabled.len(), "paused": jobs.len() - enabled.len(), "failing": failing,
        "next": next, "briefings": briefings, "src": src, "t": now,
    })
}

async fn markets(home: &Path) -> Value {
    let src = "newswire.db finance, real estate, local, fire, sports and AI-company feeds (read-only sqlite3)";
    let db = home.join(".hermes/state/newswire/newswire.db");
    let Some(db) = db.to_str() else {
        return json!({"error": "bad path", "src": src});
    };
    // Owner's beats, not every finance ticker: housing, rates, OC/LA economy, fire and public
    // safety, sports business, and the AI companies he works with. A per-category row cap keeps
    // a high-volume finance feed from burying the low-volume housing and fire feeds.
    let q = "select name, category, title, published_at, canonical_url from ( \
               select s.name, s.category, a.title, a.published_at, a.canonical_url, \
                      row_number() over (partition by s.category order by a.published_at desc) rn \
               from articles a join sources s on s.id=a.source_id \
               where s.enabled=1 and a.published_at is not null \
                 and s.category in ('real-estate','finance','local','westcoast','ems','fire','sports','ai','local-ai','startup') \
             ) where rn <= 40";
    match run(&["sqlite3", "-readonly", "-json", db, q], None, 4, &[]).await {
        Ok((0, o)) => {
            let rows: Vec<Value> = serde_json::from_str(&o).unwrap_or_default();
            let mut seen: Vec<(String, String)> = Vec::new();
            let mut buckets: Vec<(&'static str, Vec<Value>)> =
                TOPIC_ORDER.iter().map(|t| (*t, Vec::new())).collect();
            for r in rows.iter() {
                let category = r.get("category").and_then(Value::as_str).unwrap_or("");
                let source = r.get("name").and_then(Value::as_str).unwrap_or("feed");
                let title = r
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .chars()
                    .take(160)
                    .collect::<String>();
                if title.is_empty() {
                    continue;
                }
                let Some((topic, _rank)) = topic_of(category, source, &title) else {
                    continue;
                };
                let p = r.get("published_at").and_then(Value::as_str).unwrap_or("");
                let Some(at) = iso_to_epoch(p) else {
                    continue;
                };
                if at == 0 {
                    continue;
                }
                let key = (source.to_string(), title.clone());
                if seen.contains(&key) {
                    continue;
                }
                seen.push(key);
                let mut item = json!({"source": source, "title": title, "at": at, "topic": topic});
                if let Some(url) = r.get("canonical_url").and_then(Value::as_str)
                    .filter(|u| (u.starts_with("https://") || u.starts_with("http://")) && !u.chars().any(char::is_whitespace)) {
                    item["url"] = json!(url);
                }
                if let Some((_, list)) = buckets.iter_mut().find(|(t, _)| *t == topic) {
                    list.push(item);
                }
            }
            for (_, list) in buckets.iter_mut() {
                // newest first inside each beat
                list.sort_by(|a, b| {
                    let x = a.get("at").and_then(Value::as_u64).unwrap_or(0);
                    let y = b.get("at").and_then(Value::as_u64).unwrap_or(0);
                    y.cmp(&x)
                });
            }
            // Fixed quotas, so one noisy feed cannot crowd out housing or fire. Unfilled slots
            // are backfilled from whatever is fresh elsewhere.
            let mut out: Vec<Value> = Vec::new();
            for (topic, quota) in TOPIC_QUOTA {
                if let Some((_, list)) = buckets.iter_mut().find(|(t, _)| *t == topic) {
                    // take only the quota: draining the whole list and truncating with `.take()` would drop the rest, so nothing could backfill
                    let n = quota.min(list.len());
                    out.extend(list.drain(..n));
                }
            }
            let mut rest: Vec<Value> = buckets.into_iter().flat_map(|(_, l)| l).collect();
            rest.sort_by(|a, b| {
                let x = a.get("at").and_then(Value::as_u64).unwrap_or(0);
                let y = b.get("at").and_then(Value::as_u64).unwrap_or(0);
                y.cmp(&x)
            });
            out.extend(rest.into_iter().take(8usize.saturating_sub(out.len())));
            if out.is_empty() {
                json!({"error": "no relevant headlines", "src": src})
            } else {
                json!({"items": out, "src": src, "t": now_epoch()})
            }
        }
        _ => json!({"error": "newswire db unreadable", "src": src}),
    }
}

/// Beat order and how many headlines each one gets before the rest fill by recency.
const TOPIC_ORDER: [&str; 7] = ["housing", "local", "rates", "ai", "fire", "sports", "markets"];
const TOPIC_QUOTA: [(&str, usize); 7] = [
    ("housing", 2),
    ("local", 2),
    ("rates", 1),
    ("ai", 1),
    ("fire", 1),
    ("sports", 1),
    ("markets", 0),
];

/// AI companies and tools the owner actually runs. The only way into the `ai` beat.
const AI_NAMED: &[&str] = &[
    "anthropic", "claude", "openai", "chatgpt", "codex", "cursor", "grok", "xai", "nvidia",
    "google", "deepmind", "gemini", "meta", "muse", "hugging face",
];

/// Places that anchor a headline to his home beats: OC, LA, SD and the cities he tracks.
const HOME_PLACES: &[&str] = &[
    "orange county", "los angeles", "san diego", "southern california", "socal", "huntington beach",
    "newport beach", "huntington beach", "costa mesa", "santa ana", "anaheim", "irvine",
    "laguna beach", "laguna niguel", "lake forest", "mission viejo", "san clemente",
    "san juan capistrano", "aliso viejo", "tustin", "fullerton", "yorba linda", "garden grove",
    "westminster", "fountain valley", "seal beach", "los alamitos", "oceanside", "carlsbad",
    "escondido", "chula vista", "el cajon", "del mar", "la jolla", "otay mesa", "mission bay",
    "pacific beach", "long beach", "pasadena", "santa monica", "burbank", "glendale",
    "culver city", "west hollywood", "boyle heights", "downtown la", "dtla", "south bay",
    "sherman oaks", "van nuys", "riverside", "san bernardino", "coachella",
];

/// Local outlets whose business and civic reporting counts even when the title names no city.
const HOME_OUTLETS: &[&str] = &[
    "voice of oc", "laist", "times of san diego", "mynewsla", "la times",
    "los angeles times", "orange county register", "oc register", "san diego union-tribune",
    "orange county business journal", "san diego business journal",
    "los angeles business journal", "socal news group", "hoodline",
];

/// Regions outside OC/LA/SD. A local claim naming one of these is not his local beat.
const OTHER_REGIONS: &[&str] = &[
    "portland", "seattle", "oregon", "washington state", "san francisco", "sf bay", "bay area",
    "oakland", "san jose", "sacramento", "las vegas", "phoenix", "denver", "chicago", "new york",
    "boston", "texas", "florida", "south carolina", "north carolina", "atlanta", "miami",
    "detroit", "philadelphia", "hawaii",
];

/// National politics is never one of his beats, whatever feed carries it.
const POLITICS: &[&str] = &[
    "trump", "biden", "harris", "democrat", "republican", "gop", "white house", "congress",
    "senate", "senator", "election", "voter", "ballot measure", "maga", "president", "newsom",
];

/// Crime blotter is never one of his beats, whatever feed carries it.
const CRIME_BLOTTER: &[&str] = &[
    "sentenc", "arrest", "charged with", "convicted", "probation", "jail", "prison", "homicide",
    "murder", "shooting", "stabbing", "robbery", "burglar", "suspect", "coroner",
    "sex trafficking",
];

fn any_in(hay: &str, keys: &[&str]) -> bool {
    keys.iter().any(|k| hay.contains(k))
}

fn ai_beat(low: &str) -> Option<(&'static str, u64)> {
    any_in(low, AI_NAMED).then_some(("ai", 3))
}

fn is_noise(low: &str) -> bool {
    any_in(low, POLITICS) || any_in(low, CRIME_BLOTTER)
}

/// Home-region place name, or the `la`/`oc` abbreviations as standalone words so
/// "Las" or "Chargers" never count as Los Angeles.
fn names_home_region(low: &str) -> bool {
    any_in(low, HOME_PLACES)
        || low
            .split(|c: char| !c.is_ascii_alphanumeric())
            .any(|w| w == "la" || w == "oc")
}

/// The local beat: OC/LA/SD business and civic news only. Portland, Seattle and the Bay
/// are dropped unless the story is about an AI company he uses, which `topic_of` checks first.
fn local_beat(source: &str, low: &str) -> Option<(&'static str, u64)> {
    if any_in(low, OTHER_REGIONS) {
        return None;
    }
    let src = source.to_lowercase();
    (names_home_region(low) || any_in(&src, HOME_OUTLETS)).then_some(("local", 4))
}

/// Which of the owner's beats a story belongs to, and how much it should be pushed up.
/// `ai` only counts when the title names a company or tool he actually uses, and it wins over
/// the local veto so a national outlet's OpenAI story still lands on the AI beat.
fn topic_of(category: &str, source: &str, title: &str) -> Option<(&'static str, u64)> {
    let low = title.to_lowercase();
    match category {
        "ai" | "local-ai" | "startup" => ai_beat(&low),
        "local" | "westcoast" => {
            if is_noise(&low) {
                None
            } else {
                ai_beat(&low).or_else(|| local_beat(source, &low))
            }
        }
        _ if is_noise(&low) => None,
        "real-estate" => Some(("housing", 5)),
        "fire" | "ems" => Some(("fire", 4)),
        "sports" => Some(("sports", 3)),
        "finance" => {
            let rates = ["mortgage", "rate", "fed", "treasur", "yield", "home price", "housing", "rent"];
            if rates.iter().any(|k| low.contains(k)) {
                Some(("rates", 4))
            } else {
                Some(("markets", 1))
            }
        }
        _ => None,
    }
}

async fn watch_feed(home: &Path, now: u64) -> Value {
    match crate::sources::read(&home.join(crate::sources::WATCH.rel)).await {
        Ok((body, mtime)) => crate::sources::deck_feed_from(&crate::sources::WATCH, &body, mtime, now),
        Err(e) => crate::sources::fail(&crate::sources::WATCH, e),
    }
}

pub async fn build(home: &Path, http: &reqwest::Client, ha: &Ha, gw_url: &str) -> Value {
    let _ = ha;
    let now = now_epoch();
    let (gw, mail, cron, mk, watch) = tokio::join!(
        gateway(http, gw_url),
        async {
            match tokio::fs::read_to_string(home.join(".meshvault/status/mail/inbox-full.json"))
                .await
            {
                Ok(t) => mail_from(&t, now),
                Err(_) => {
                    json!({"error": "no reading", "src": "~/.meshvault/status/mail/inbox-full.json"})
                }
            }
        },
        async {
            match tokio::fs::read_to_string(home.join(".hermes/cron/jobs.json")).await {
                Ok(t) => cron_from(&t, now),
                Err(_) => {
                    json!({"error": "jobs file not readable", "src": "~/.hermes/cron/jobs.json"})
                }
            }
        },
        markets(home),
        watch_feed(home, now)
    );
    json!({
        "t": now, "gateway": gw, "mail": mail, "cron": cron, "markets": mk,
        "watch": watch,
        "unavailable": [
            {"name": "Desktop Home board (Next Action, Fleet check chips)", "why": "Desktop backend needs a per-launch session token that only its own process holds; not copied"},
            {"name": "Markets ticker (BTC/ETH/stocks)", "why": "same Desktop backend route /api/plugins/hermes-newswire/market; headlines use the newswire db instead"}
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The beat `topic_of` gives a story, for the tests below (the crate denies `unwrap`/`expect`).
    fn beat(cat: &str, source: &str, title: &str) -> String {
        match topic_of(cat, source, title) {
            Some(v) => v.0.to_string(),
            None => panic!("no beat for {title}"),
        }
    }

    #[tokio::test]
    async fn markets_only_expose_http_canonical_links() {
        let home = std::env::temp_dir().join(format!("deck-markets-{}",std::process::id()));
        let dir = home.join(".hermes/state/newswire");
        let Ok(()) = std::fs::create_dir_all(&dir) else { panic!("create newswire dir") };
        let db = dir.join("newswire.db");
        let _=std::fs::remove_file(&db);
        let q="create table sources (id integer, name text, category text, enabled integer); \
            create table articles (source_id integer, title text, published_at text, canonical_url text); \
            insert into sources values(1,'Fixture','real-estate',1); \
            insert into articles values(1,'OC home prices hold','2026-10-04T01:00:00Z','https://example.com/a'); \
            insert into articles values(1,'OC home prices jump','2026-10-04T02:00:00Z','javascript:alert(1)');";
        let Some(db_str) = db.to_str() else { panic!("db path is not UTF-8") };
        let Ok(seed) = run(&["sqlite3", db_str, q],None,4,&[]).await else { panic!("sqlite3 seed failed") };
        assert_eq!(seed.0,0);
        let out=markets(&home).await;
        assert_eq!(out["items"][0]["title"],"OC home prices jump");
        assert!(out["items"][0].get("url").is_none());
        assert_eq!(out["items"][1]["url"],"https://example.com/a");
        let _=std::fs::remove_file(db);
    }

    #[tokio::test]
    async fn headlines_past_a_beat_quota_backfill_the_free_slots() {
        // a finance-only wire has quota 0 for `markets` and two housing rows exceed the housing quota of 2: nothing may be dropped while slots are free
        let home = std::env::temp_dir().join(format!("deck-markets-backfill-{}", std::process::id()));
        let dir = home.join(".hermes/state/newswire");
        let Ok(()) = std::fs::create_dir_all(&dir) else { panic!("create newswire dir") };
        let db = dir.join("newswire.db");
        let _ = std::fs::remove_file(&db);
        let q = "create table sources (id integer, name text, category text, enabled integer); \
            create table articles (source_id integer, title text, published_at text, canonical_url text); \
            insert into sources values(1,'Wire','finance',1); insert into sources values(2,'Homes','real-estate',1); \
            insert into articles values(1,'Stocks rise on earnings','2026-10-04T01:00:00Z','https://example.com/s1'); \
            insert into articles values(1,'Chip makers lead gains','2026-10-04T02:00:00Z','https://example.com/s2'); \
            insert into articles values(2,'Listing one','2026-10-04T03:00:00Z','https://example.com/h1'); \
            insert into articles values(2,'Listing two','2026-10-04T04:00:00Z','https://example.com/h2'); \
            insert into articles values(2,'Listing three','2026-10-04T05:00:00Z','https://example.com/h3');";
        let Some(db_str) = db.to_str() else { panic!("db path is not UTF-8") };
        let Ok(seed) = run(&["sqlite3", db_str, q], None, 4, &[]).await else { panic!("sqlite3 seed failed") };
        assert_eq!(seed.0, 0);
        let out = markets(&home).await;
        let titles: Vec<&str> = out["items"].as_array().map(|a| a.iter().filter_map(|i| i["title"].as_str()).collect()).unwrap_or_default();
        assert_eq!(titles.len(), 5, "{titles:?}");
        assert_eq!(&titles[..2], ["Listing three", "Listing two"], "the housing quota comes first, newest first");
        assert!(titles.contains(&"Listing one") && titles.contains(&"Stocks rise on earnings") && titles.contains(&"Chip makers lead gains"), "{titles:?}");
        let _ = std::fs::remove_file(db);
    }

    #[test]
    fn mail_never_leaks_addresses() {
        let t = r#"{"ok":false,"generated_at":"2026-09-29T18:46:10Z","mailboxes":[{"role":"primary","count":0,"unread":0,"ok":false,"address":"a@b.c"},{"role":"personal","count":198,"unread":176,"ok":true}]}"#;
        let v = mail_from(t, 1_790_707_600);
        assert_eq!(v["status"], "partial");
        assert!(!v.to_string().contains("a@b.c"));
        assert_eq!(mail_from("nope", 0)["error"], "no reading");
    }

    #[test]
    fn cron_next_and_failing() {
        let t = r#"{"jobs":[{"name":"a","enabled":true,"last_status":"ok","next_run_at":"2026-09-30T05:00:00-07:00"},
            {"name":"b","enabled":true,"last_status":"error","next_run_at":"2026-09-29T12:00:00-07:00"},
            {"name":"c","enabled":false}]}"#;
        let v = cron_from(t, 1_790_707_570);
        assert_eq!(
            (v["enabled"].as_u64(), v["paused"].as_u64()),
            (Some(2), Some(1))
        );
        assert_eq!(v["failing"][0], "b");
        assert_eq!(v["next"][0]["name"], "b");
        assert!(cron_from("{}", 0).get("error").is_some());
    }

    #[test]
    fn topics_keep_only_the_owners_beats() {
        assert_eq!(beat("real-estate", "HousingWire", "OC home prices fall"), "housing");
        assert_eq!(beat("finance", "MarketWatch Top Stories", "Mortgage rates hit 7.3 percent"), "rates");
        assert_eq!(beat("finance", "CNBC Top News", "Treasury yields climb"), "rates");
        assert_eq!(beat("local", "Google News: OC Register", "Huntington Beach harbor plan advances"), "local");
        assert_eq!(beat("fire", "LA County Fire", "LA County Fire adds crews"), "fire");
        assert_eq!(beat("sports", "ESPN NHL", "NHL jersey sponsor deal"), "sports");
        assert_eq!(beat("ai", "OpenAI News", "Anthropic ships a new agent tool"), "ai");
        assert!(topic_of("ai", "arXiv cs.AI", "A generic model paper").is_none());
        assert!(topic_of("world", "Reuters World", "Election result").is_none());
    }

    #[test]
    fn local_beat_drops_national_politics_out_of_region_and_crime() {
        // the two stories the owner saw on the live deck
        assert!(topic_of(
            "westcoast",
            "Oregonian News",
            "Trump savaged as ‘idiot’ by Democrat who concedes president has this ‘one genius’"
        )
        .is_none());
        assert!(topic_of(
            "westcoast",
            "Oregonian News",
            "Downtown Portland hotel fetches $6.8M in steep markdown sale"
        )
        .is_none());
        // a local-labelled feed does not launder an out-of-region story
        assert!(topic_of(
            "local",
            "Google News: San Diego safety",
            "South Carolina police close investigation into Hayden Panettiere’s death after coroner’s ruling"
        )
        .is_none());
        // a finance/real-estate feed does not launder a crime blotter item either
        assert!(topic_of(
            "real-estate",
            "HousingWire",
            "Alexander brothers sentenced to 30 years for sex trafficking"
        )
        .is_none());
        // Bay Area local news with no AI company stays out
        assert!(topic_of("westcoast", "SFGate Bay Area", "Oakland council weighs a new budget").is_none());
    }

    #[test]
    fn local_beat_keeps_home_region_news_and_local_outlets() {
        assert_eq!(beat("local", "Google News: OC Register", "OC Register: Huntington Beach harbor plan advances"), "local");
        assert_eq!(beat("local", "Times of San Diego", "San Diego port approves budget"), "local");
        assert_eq!(beat("local", "Some Wire", "Huntington Beach approves new housing plan"), "local");
        assert_eq!(beat("local", "MyNewsLA California", "LA Council Approves First $5M to Aid Boyle Heights Residents"), "local");
        // a local outlet's business story needs no city in the title
        assert_eq!(beat("local", "Google News: OC Register", "GKN Aerospace executives answer questions, but concerns endure"), "local");
    }

    #[test]
    fn national_outlet_ai_company_story_lands_on_the_ai_beat() {
        assert_eq!(beat("westcoast", "SFGate Bay Area", "OpenAI leases more San Francisco office space"), "ai");
        assert_eq!(beat("local", "LA Times California", "Anthropic opens a Los Angeles office"), "ai");
    }

    #[test]
    fn briefing_schedule_is_not_lost_after_next_three_jobs() {
        let t = r#"{"jobs":[{"name":"Automation 1","enabled":true,"next_run_at":"2030-01-01T00:00:00Z"},{"name":"Automation 2","enabled":true,"next_run_at":"2030-01-01T00:01:00Z"},{"name":"Automation 3","enabled":true,"next_run_at":"2030-01-01T00:02:00Z"},{"name":"Markets Daily Brief","enabled":true,"next_run_at":"2030-01-02T00:00:00Z"}]}"#;
        let v=cron_from(t,1_790_707_570);
        assert_eq!(v["next"].as_array().map(Vec::len),Some(3));
        assert_eq!(v["briefings"][0]["name"],"Markets Daily Brief");
    }

    #[test]
    fn paused_enabled_records_are_never_scheduled_or_failing() {
        let t = r#"{"jobs":[{"name":"Imported old job","enabled":true,"state":"paused","last_status":"error","next_run_at":"2030-01-01T00:00:00Z"},{"name":"Current job","enabled":true,"state":"scheduled","last_status":"ok","next_run_at":"2030-01-02T00:00:00Z"}]}"#;
        let v = cron_from(t, 1_790_707_570);
        assert_eq!(v["enabled"], 1);
        assert_eq!(v["paused"], 1);
        assert_eq!(v["failing"], json!([]));
        assert_eq!(v["next"][0]["name"], "Current job");
    }

    #[test]
    fn a_renamed_briefing_job_is_still_the_next_briefing() {
        let t = r#"{"jobs":[{"name":"Mesh · New leads","enabled":true,"last_status":"ok","next_run_at":"2030-01-01T08:00:00Z"},{"name":"Mesh · Morning brief","enabled":true,"last_status":"ok","next_run_at":"2030-01-01T15:00:00Z"},{"name":"Morning Inbox and Briefing","enabled":true,"last_status":"ok","next_run_at":"2030-01-02T15:00:00Z"}]}"#;
        let v = cron_from(t, 1_790_707_570);
        let b: Vec<&str> = v["briefings"].as_array().map(|a| a.iter().filter_map(|x| x["name"].as_str()).collect()).unwrap_or_default();
        assert_eq!(b, vec!["Mesh · Morning brief", "Morning Inbox and Briefing"]);
    }

    #[test]
    fn watch_feed_keeps_readings_and_drops_strain() {
        let body = r#"{"t":1790712000,"refresh":3600,"src":["apple watch"],"errors":[],"connected":true,"hr":61,"hrv":42,"sleep_h":7.5,"battery":80,"reason":"Sleep is from last night","strain":4.4}"#;
        let v = crate::sources::deck_feed_from(&crate::sources::WATCH, body, None, 1_790_712_300);
        assert_eq!(v["hr"], 61);
        assert_eq!(v["connected"], true);
        assert_eq!(v["reason"], "Sleep is from last night");
        assert!(v.get("strain").is_none());
        assert_eq!(v["stale"], false);
        assert_eq!(crate::sources::fail(&crate::sources::WATCH, "file missing")["error"], "file missing");
    }
}
