//! Cookie/CSRF-protected deck controls and bounded camera diagnostics.
use crate::{crons, fleetboard, runs, util};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    os::unix::fs::OpenOptionsExt,
    path::Path,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct Actions {
    cron_hist: Mutex<VecDeque<Instant>>,
    cron_one: Mutex<()>,
    send_hist: Mutex<VecDeque<Instant>>,
    send_one: Mutex<()>,
    cam_hist: Mutex<VecDeque<Instant>>,
}
fn fail(code: u16, error: &str) -> (u16, Value) {
    (code, json!({"ok":false,"error":error}))
}
pub(crate) fn rate(hist: &mut VecDeque<Instant>, gap: Duration, max: usize) -> Result<(), u64> {
    let now = Instant::now();
    while hist
        .front()
        .is_some_and(|t| now.duration_since(*t) >= Duration::from_secs(60))
    {
        hist.pop_front();
    }
    if let Some(last) = hist.back() {
        if now.duration_since(*last) < gap {
            return Err(((gap - now.duration_since(*last)).as_secs_f64().ceil() as u64).max(1));
        }
    }
    if hist.len() >= max {
        let oldest_age = hist.front().map_or(0, |t| now.duration_since(*t).as_secs());
        return Err((60 - oldest_age).max(1));
    }
    hist.push_back(now);
    Ok(())
}
pub(crate) fn limited(wait: u64) -> (u16, Value) {
    (
        429,
        json!({"ok":false,"error":"rate limited","retry_s":wait}),
    )
}
fn helper_result(result: Result<(i32, String), String>) -> (u16, Value) {
    match result {
        Ok((0, text)) => {
            let v = text
                .lines()
                .last()
                .and_then(|s| serde_json::from_str::<Value>(s).ok());
            match v {
                Some(v) if v["ok"] == true => (200, v),
                _ => fail(502, "launcher failed"),
            }
        }
        Ok((rc, text)) => {
            let word = text
                .lines()
                .last()
                .and_then(|s| serde_json::from_str::<Value>(s).ok())
                .and_then(|v| v["error"].as_str().map(str::to_owned));
            let word = word.as_deref().unwrap_or("");
            // Only fixed words the helper itself writes may reach the phone, never gateway text: a refusal keeps its
            // meaning and status, an upstream failure says what failed.
            if rc == 2 {
                let code = match word {
                    "already paused" | "already active" => 409,
                    "unknown job" | "unknown run" => 404,
                    "bad id" | "bad act" | "bad text" | "bad run id" | "bad gateway override" => 400,
                    // run routing (deck-launch): the saved model route is unusable, or Jev/Clef did not approve the text
                    "route invalid" | "gate blocked" | "gate unsure" => 422,
                    _ => 0,
                };
                if code != 0 {
                    return fail(code, word);
                }
            }
            let http_status = word
                .strip_prefix("hermes http ")
                .is_some_and(|c| c.len() == 3 && c.bytes().all(|b| b.is_ascii_digit()));
            let upstream = [
                "hermes gateway unreachable",
                "gate unavailable",
                "hermes reply not json",
                "hermes gave no run id",
                "hermes key missing",
                "hermes env unreadable",
                "hermes rejected action",
                "run not found",
                "run status unavailable",
                "launch log unavailable",
                "jobs unreadable",
            ];
            if http_status || upstream.contains(&word) {
                fail(502, word)
            } else {
                fail(502, "launcher failed")
            }
        }
        Err(_) => fail(502, "launcher failed"),
    }
}
pub(crate) fn append(home: &Path, file: &str, value: &Value) -> std::io::Result<()> {
    use std::io::Write;
    let dir = home.join(".local/state/pixel-deck");
    std::fs::create_dir_all(&dir)?;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .open(dir.join(file))?;
    use std::os::unix::fs::PermissionsExt;
    f.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    f.write_all(value.to_string().as_bytes())?;
    f.write_all(b"\n")
}
/// `append`, then keep the file under `cap` bytes: past it, the older half is dropped at a line start, so the newest
/// rows survive (the camera beacon's and the page-error log's own fence).
pub(crate) fn append_capped(home: &Path, file: &str, value: &Value, cap: u64) -> std::io::Result<()> {
    append(home, file, value)?;
    let path = home.join(".local/state/pixel-deck").join(file);
    if std::fs::metadata(&path)?.len() <= cap {
        return Ok(());
    }
    let b = std::fs::read(&path)?;
    let cut = b.len() / 2;
    let start = b[cut..]
        .iter()
        .position(|c| *c == b'\n')
        .map(|n| cut + n + 1)
        .filter(|n| *n < b.len())
        .unwrap_or_else(|| b.len().saturating_sub(value.to_string().len() + 1));
    std::fs::write(&path, &b[start..])
}
fn helper_env() -> Vec<(&'static str, String)> {
    std::env::var("DECK_HERMES_BASE")
        .ok()
        .map(|v| vec![("DECK_HERMES_BASE", v)])
        .unwrap_or_default()
}
fn active(job: &Value) -> bool {
    job["enabled"] == true && job["state"] != "paused"
}
fn id8(id: &str) -> bool {
    id.len() == 8
        && id
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}
/// Message text for the agent: every space character other than U+0020 (no-break, en/em/thin/ideographic: phone keyboards,
/// IMEs and pasted web text carry them) becomes a plain space, then 1 to 2000 chars of text plus `\n` and `\t`. Refused:
/// control characters and line and paragraph separators. Format characters stay (emoji sequences use U+200D and U+FE0F);
/// static/deck.js `cleanText` and scripts/deck-launch `send_text` apply the same rule.
pub fn clean_text(raw: &str) -> Option<String> {
    let owned: String = raw
        .chars()
        .map(|c| {
            if matches!(c, '\u{00A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{202F}' | '\u{205F}' | '\u{3000}') {
                ' '
            } else {
                c
            }
        })
        .collect();
    let text = owned.trim();
    if !(1..=2000).contains(&text.chars().count())
        || text.chars().any(|c| {
            (c.is_control() || (c.is_whitespace() && c != ' ')) && c != '\n' && c != '\t'
        })
    {
        return None;
    }
    Some(text.to_owned())
}
impl Actions {
    pub async fn cron(
        &self,
        home: &Path,
        id: &str,
        act: &str,
        cache: &Mutex<Option<(Instant, Value)>>,
    ) -> (u16, Value) {
        let t = util::now_epoch();
        let result = if !id8(id) {
            fail(400, "bad id")
        } else if !["run", "pause", "resume"].contains(&act) {
            fail(400, "bad act")
        } else {
            match tokio::fs::read_to_string(home.join(crons::REL))
                .await
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            {
                None => fail(502, "jobs unreadable"),
                Some(jobs) => {
                    let matches: Vec<(&Value, &str)> = jobs["jobs"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|j| {
                            let full = j["id"].as_str()?;
                            (full.starts_with(id)
                                && full.len() <= 64
                                && full
                                    .bytes()
                                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b)))
                            .then_some((j, full))
                        })
                        .collect();
                    match matches.as_slice() {
                        [] => fail(404, "unknown job"),
                        [(job, full)] => {
                            if act == "pause" && !active(job) {
                                fail(409, "already paused")
                            } else if act == "resume" && active(job) {
                                fail(409, "already active")
                            } else if let Ok(_one) = self.cron_one.try_lock() {
                                let mut hist = self.cron_hist.lock().await;
                                if let Err(wait) = rate(&mut hist, Duration::from_secs(2), 20) {
                                    limited(wait)
                                } else {
                                    drop(hist);
                                    let script = home.join("ops/bin/deck-launch");
                                    let (code, out) = helper_result(
                                        util::run(
                                            &[script.to_str().unwrap_or(""), "cron", act, *full],
                                            None,
                                            25,
                                            &helper_env(),
                                        )
                                        .await,
                                    );
                                    if code == 200 {
                                        *cache.lock().await = None;
                                        (
                                            200,
                                            json!({"ok":true,"act":act,"id":id,"name":job["name"].as_str().unwrap_or("").chars().take(80).collect::<String>(),"t":t}),
                                        )
                                    } else {
                                        (code, out)
                                    }
                                }
                            } else {
                                limited(2)
                            }
                        }
                        _ => fail(409, "ambiguous id"),
                    }
                }
            }
        };
        let mut audit = json!({"t":t,"act":if ["run","pause","resume"].contains(&act) {act} else {"bad"},"id8":if id8(id) {id} else {"bad"},"ok":result.0==200});
        if result.0 != 200 {
            audit["error"] = result.1["error"].clone();
        }
        if append(home, "actions.jsonl", &audit).is_err() {
            // the action already ran (or was refused): answer truthfully and leave a journal trace of the missing audit line
            util::log("warn", "audit append failed", &[("act", audit["act"].as_str().unwrap_or("bad").to_string())]);
        }
        result
    }
    pub async fn send(&self, home: &Path, body: &[u8]) -> (u16, Value) {
        let Ok(v) = serde_json::from_slice::<Value>(body) else {
            return fail(400, "bad text");
        };
        let Some(text) = v["text"].as_str().and_then(clean_text) else {
            return fail(400, "bad text");
        };
        let text = text.as_str();
        let id = match v.get("run_id") {
            None | Some(Value::Null) => "-",
            Some(Value::String(s)) if runs::valid_run_id(s) => s,
            _ => return fail(400, "bad run id"),
        };
        if id != "-" && !runs::launched(home).await.iter().any(|r| r.run_id == id) {
            return fail(404, "unknown run");
        }
        let Ok(_one) = self.send_one.try_lock() else {
            return limited(2);
        };
        if let Err(wait) = rate(
            &mut *self.send_hist.lock().await,
            Duration::from_millis(1500),
            20,
        ) {
            return limited(wait);
        }
        let script = home.join("ops/bin/deck-launch");
        let (code, v) = helper_result(
            util::run(
                &[script.to_str().unwrap_or(""), "send", id],
                Some(text.as_bytes()),
                30,
                &helper_env(),
            )
            .await,
        );
        if code != 200 {
            return (code, v);
        }
        let mode = v["mode"].as_str().unwrap_or("");
        let run_id = v["run_id"].as_str().unwrap_or("");
        if !["new", "reply", "steer"].contains(&mode)
            || !runs::valid_run_id(run_id)
            || (mode == "steer" && id != run_id)
        {
            return fail(502, "launcher failed");
        }
        (
            200,
            json!({"ok":true,"mode":mode,"run_id":run_id,"t":v["t"].as_u64().unwrap_or_else(util::now_epoch)}),
        )
    }
    pub async fn cam_diag(&self, home: &Path, body: &[u8], ua: &str) -> (u16, Value) {
        let Ok(v) = serde_json::from_slice::<Value>(body) else {
            return fail(400, "bad diag");
        };
        let Some(e) = v["e"].as_str() else {
            return fail(400, "bad diag");
        };
        if !(1..=32).contains(&e.len())
            || !e
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"_.".contains(&b))
        {
            return fail(400, "bad diag");
        }
        let Some(cam) = v["cam"].as_u64().filter(|n| *n <= 4) else {
            return fail(400, "bad diag");
        };
        let Some(mode) = v["mode"]
            .as_str()
            .filter(|s| ["hls", "snap", "native", "boot"].contains(s))
        else {
            return fail(400, "bad diag");
        };
        let Some(data) = v["d"].as_object().filter(|d| d.len() <= 12) else {
            return fail(400, "bad diag");
        };
        let mut clean = serde_json::Map::new();
        for (k, val) in data {
            if !(1..=32).contains(&k.len())
                || !k
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
            {
                continue;
            }
            if [
                "token",
                "key",
                "cookie",
                "authorization",
                "url",
                "uri",
                "password",
                "secret",
            ]
            .contains(&k.to_ascii_lowercase().as_str())
            {
                continue;
            }
            let safe = match val {
                Value::String(s) if s.chars().count() <= 120 => Some(Value::String(scrub(s, 120))),
                Value::Bool(_) | Value::Number(_) => Some(val.clone()),
                _ => return fail(400, "bad diag"),
            };
            if let Some(safe) = safe {
                clean.insert(k.clone(), safe);
            }
        }
        let mut h = self.cam_hist.lock().await;
        if let Err(wait) = rate(&mut h, Duration::ZERO, 60) {
            return limited(wait);
        }
        let rec =
            json!({"t":util::now_epoch(),"e":e,"cam":cam,"mode":mode,"ua":scrub(ua,160),"d":clean});
        if append_capped(home, "cam-diag.jsonl", &rec, 256 * 1024).is_err() {
            return fail(502, "diag unavailable");
        }
        (200, json!({"ok":true}))
    }
}
/// Words that make an identifier a credential name (`API_SERVER_KEY`, `accessToken`, `--password`, `Set-Cookie`).
/// Matched on whole words, so `monkey`, `keyboard` and `author` stay readable.
const SECRET_WORDS: [&str; 19] = [
    "key", "token", "secret", "password", "passwd", "passphrase", "auth", "authorization", "cookie", "credential",
    "credentials", "apikey", "apitoken", "authtoken", "accesstoken", "privatekey", "session", "sessionid", "pdeck",
];
/// Names whose value is the whole rest of the line (`Authorization: Bearer x`, `Cookie: a=1; b=2`).
const REST_OF_LINE_WORDS: [&str; 2] = ["authorization", "cookie"];
/// Lower-case words of an identifier: split on anything that is not a letter or digit, on camelCase humps
/// (`apiKey`), at the end of an acronym (`HAToken`, `OpenAIKey`) and between letters and digits (`KEY2`, `token2`).
fn name_words(name: &str) -> Vec<String> {
    let chars: Vec<char> = name.chars().collect();
    let mut words = Vec::new();
    let mut cur = String::new();
    for (i, &c) in chars.iter().enumerate() {
        if !c.is_ascii_alphanumeric() {
            if !cur.is_empty() {
                words.push(std::mem::take(&mut cur));
            }
            continue;
        }
        if let (Some(&p), false) = (i.checked_sub(1).and_then(|j| chars.get(j)), cur.is_empty()) {
            let next_lower = chars.get(i + 1).is_some_and(|n| n.is_ascii_lowercase());
            let hump = c.is_ascii_uppercase() && p.is_ascii_lowercase();
            let acronym_end = c.is_ascii_uppercase() && p.is_ascii_uppercase() && next_lower;
            let digit_edge = c.is_ascii_digit() != p.is_ascii_digit();
            if hump || acronym_end || digit_edge {
                words.push(std::mem::take(&mut cur));
            }
        }
        cur.push(c.to_ascii_lowercase());
    }
    if !cur.is_empty() {
        words.push(cur);
    }
    words
}
fn secret_name(name: &str) -> bool {
    name_words(name).iter().any(|w| SECRET_WORDS.contains(&w.as_str()))
}
fn rest_of_line_name(name: &str) -> bool {
    name_words(name).iter().any(|w| REST_OF_LINE_WORDS.contains(&w.as_str()))
}
/// Known credential shapes (the same family as deck-launch `_SECRET_RE`, plus GitHub fine-grained, Slack, AWS and JWT).
fn secret_shape(low: &str) -> bool {
    // prefix plus a body of at least n bytes (alnum: letters and digits only, so `hf_download_dir` is a name, not a token)
    let body = |p: &str, n: usize, alnum: bool| {
        low.strip_prefix(p)
            .is_some_and(|r| r.len() >= n && (!alnum || r.bytes().all(|b| b.is_ascii_alphanumeric())))
    };
    [
        "sk-", "sk_", "pk_", "rk_", "rk-", "ghp_", "gho_", "ghs_", "ghu_", "github_pat_", "xoxb-", "xoxa-", "xoxp-", "xoxr-",
        "xoxs-", "akia",
    ]
    .iter()
    .any(|p| body(p, 8, false))
        || body("glpat-", 16, false)
        || body("hf_", 16, true)
        || body("npm_", 16, true)
        || body("aiza", 16, false)
        || (low.starts_with("eyj") && low.len() >= 20)
}
/// `Basic` credentials are base64 of at least 8 characters that is not an ordinary word: a digit, `=`, `+`, `/` or a capital after the first letter.
fn base64_credential(c: &str) -> bool {
    c.len() >= 8
        && c.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='))
        && (c.bytes().any(|b| b.is_ascii_digit() || matches!(b, b'+' | b'/' | b'='))
            || c[1..].bytes().any(|b| b.is_ascii_uppercase()))
}
fn is_name_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.')
}
fn is_value_end(b: u8) -> bool {
    matches!(b, b' ' | b',' | b';' | b'&' | b')' | b'}' | b']' | b'"' | b'\'')
}
/// `scheme://user:pass@host/path?query#frag` becomes `scheme://[redacted]@host/path`.
fn clean_url_word(word: &str) -> String {
    let Some(i) = word.find("://") else {
        return word.to_string();
    };
    let (scheme, rest) = (&word[..i + 3], &word[i + 3..]);
    let host_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let rest = match rest[..host_end].rfind('@') {
        Some(at) => format!("[redacted]@{}", &rest[at + 1..]),
        None => rest.to_string(),
    };
    let cut = rest.find(['?', '#']).unwrap_or(rest.len());
    format!("{scheme}{}", &rest[..cut])
}
/// Scan one ASCII line: credential names take their value (quoted values whole, `Bearer x` with its token, cookie and
/// authorization headers to the end of the line), known shapes and a bare `Bearer x` are redacted wherever they stand.
fn redact(line: &str) -> String {
    let b = line.as_bytes();
    let mut out = String::with_capacity(line.len());
    let mut i = 0;
    while i < b.len() {
        if !is_name_byte(b[i]) {
            out.push(b[i] as char);
            i += 1;
            continue;
        }
        let start = i;
        while i < b.len() && is_name_byte(b[i]) {
            i += 1;
        }
        let run = &line[start..i];
        let low = run.to_ascii_lowercase();
        if low == "bearer" {
            out.push_str(run);
            let mut j = i;
            while j < b.len() && b[j] == b' ' {
                j += 1;
            }
            if j > i && j < b.len() {
                let mut k = j;
                while k < b.len() && b[k] != b' ' {
                    k += 1;
                }
                out.push_str(&line[i..j]);
                // a name after a stray `Bearer` (`password:`, `KEY=`) is scanned as a name, not eaten as the token
                if line[j..k].ends_with(':') || line[j..k].ends_with('=') {
                    i = j;
                } else {
                    out.push_str("[redacted]");
                    i = k;
                }
            }
            continue;
        }
        if low == "basic" {
            // `Basic dXNlcjpwYXNz`: the scheme word stays, the base64 credential goes
            out.push_str(run);
            let mut j = i;
            while j < b.len() && b[j] == b' ' {
                j += 1;
            }
            if j > i {
                let mut k = j;
                while k < b.len() && (b[k].is_ascii_alphanumeric() || matches!(b[k], b'+' | b'/' | b'=')) {
                    k += 1;
                }
                if base64_credential(&line[j..k]) && (k >= b.len() || is_value_end(b[k])) {
                    out.push_str(&line[i..j]);
                    out.push_str("[redacted]");
                    i = k;
                }
            }
            continue;
        }
        if secret_shape(&low) {
            out.push_str("[redacted]");
            continue;
        }
        // NAME, an optional closing quote, optional spaces, then `=` or `:` (but not the `://` of a URL)
        let mut k = i;
        if k < b.len() && (b[k] == b'"' || b[k] == b'\'') {
            k += 1;
        }
        while k < b.len() && b[k] == b' ' {
            k += 1;
        }
        let sep = k < b.len() && (b[k] == b'=' || b[k] == b':') && !(b[k] == b':' && b.get(k + 1) == Some(&b'/'));
        // `?k=<camera key>` and `&k=<camera key>` are credentials although `k` is not a credential word
        let cam_key = low == "k" && start > 0 && matches!(b[start - 1], b'?' | b'&');
        if !(sep && (secret_name(run) || cam_key)) {
            out.push_str(run);
            continue;
        }
        let mut v = k + 1;
        while v < b.len() && b[v] == b' ' {
            v += 1;
        }
        out.push_str(&line[start..=k]);
        if v > k + 1 {
            out.push(' ');
        }
        out.push_str("[redacted]");
        let end = if line[v..].starts_with("[redacted]") {
            v + "[redacted]".len() // already cut: a second pass over a scrubbed line changes nothing
        } else if rest_of_line_name(run) {
            b.len()
        } else if v < b.len() && (b[v] == b'"' || b[v] == b'\'') {
            let q = b[v];
            let mut e = v + 1;
            while e < b.len() && b[e] != q {
                e += if b[e] == b'\\' { 2 } else { 1 };
            }
            (e + 1).min(b.len())
        } else {
            let mut e = v;
            while e < b.len() && !is_value_end(b[e]) {
                e += 1;
            }
            // `Bearer x`, `Basic x`: the scheme word is not the secret, the word after it is
            if matches!(line[v..e].to_ascii_lowercase().as_str(), "bearer" | "basic" | "digest") {
                let mut e2 = e;
                while e2 < b.len() && b[e2] == b' ' {
                    e2 += 1;
                }
                while e2 < b.len() && !is_value_end(b[e2]) {
                    e2 += 1;
                }
                e2
            } else {
                e
            }
        };
        i = end;
    }
    out
}
/// One journal or beacon line: ASCII only, URL userinfo and query strings cut, credentials redacted, length capped.
pub(crate) fn scrub(s: &str, n: usize) -> String {
    let text: String = s
        .chars()
        .map(|c| if c.is_ascii_control() { ' ' } else { c })
        .filter(|c| c.is_ascii_graphic() || *c == ' ')
        .take(4000)
        .collect();
    let words: Vec<String> = text.split_whitespace().map(clean_url_word).collect();
    redact(&words.join(" ")).chars().take(n).collect()
}
pub fn unit_name(s: &str) -> bool {
    let prefix = s
        .strip_suffix(".service")
        .or_else(|| s.strip_suffix(".timer"));
    prefix.is_some_and(|p| (1..=96).contains(&p.len()))
        && s.as_bytes().first().is_some_and(u8::is_ascii_alphanumeric)
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"@._-".contains(&b))
}
pub async fn unit(home: &Path, name: &str) -> (u16, Value) {
    if !unit_name(name) {
        return fail(400, "bad name");
    }
    let Ok(text) = tokio::fs::read_to_string(home.join(fleetboard::UNITS_REL)).await else {
        return fail(404, "not a failing unit");
    };
    let Ok(v) = serde_json::from_str::<Value>(&text) else {
        return fail(404, "not a failing unit");
    };
    if !v["failed_units"]
        .as_array()
        .is_some_and(|rows| rows.iter().any(|r| r.as_str() == Some(name)))
    {
        return fail(404, "not a failing unit");
    }
    let a=util::run(&["systemctl","--user","show",name,"--property=ActiveState,SubState,Result,ExecMainStatus,ActiveEnterTimestamp,InactiveEnterTimestamp"],None,4,&[]).await;
    let b = util::run(
        &[
            "journalctl",
            "--user",
            "-u",
            name,
            "-n",
            "25",
            "--no-pager",
            "-o",
            "cat",
        ],
        None,
        4,
        &[],
    )
    .await;
    let (Ok((0, show)), Ok((0, journal))) = (a, b) else {
        return fail(502, "unit unavailable");
    };
    let field = |key: &str| {
        show.lines()
            .find_map(|l| l.strip_prefix(&format!("{key}=")).map(str::to_owned))
    };
    let since = field("ActiveEnterTimestamp")
        .filter(|s| !s.is_empty() && s != "n/a")
        .or_else(|| field("InactiveEnterTimestamp").filter(|s| !s.is_empty() && s != "n/a"));
    let lines: Vec<String> = journal.lines().take(25).map(|s| scrub(s, 240)).collect();
    (
        200,
        json!({"ok":true,"unit":name,"active":field("ActiveState"),"sub":field("SubState"),"result":field("Result"),"exit":field("ExecMainStatus").and_then(|s|s.parse::<i32>().ok()),"since":since,"lines":lines,"t":util::now_epoch()}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scrubber_redacts_credentials_and_strips_query_strings() {
        let s="Bearer abcdefghijk sk-secret123 ghp_abcdef123 key=abc123 token=abc123 https://host/path?token=secret";
        let o = scrub(s, 240);
        for secret in [
            "abcdefghijk",
            "sk-secret123",
            "ghp_abcdef123",
            "key=abc123",
            "token=abc123",
            "token=secret",
        ] {
            assert!(!o.contains(secret), "{secret}");
        }
        assert!(o.contains("https://host/path"));
    }
    #[test]
    fn scrubber_redacts_realistic_journal_credential_shapes() {
        // Fixtures are assembled at run time: key-shaped literals in source would (rightly) trip gitleaks.
        let v = "0123abcd".repeat(3);
        let gh = ["gh", "p_"].concat() + &v;
        let slack = ["xo", "xb-"].concat() + "1234567890-" + &v;
        let aws = ["AK", "IA"].concat() + "IOSFODNN7EXAMPLE";
        let pk = ["p", "k_live_"].concat() + &v;
        for (line, secret) in [
            (format!("API_SERVER_KEY={v} started"), v.clone()),
            (format!("HA_TOKEN={v} loaded"), v.clone()),
            (format!("PIXEL_DECK_TOKEN={v} set"), v.clone()),
            (format!("GITHUB_TOKEN={gh} used"), gh.clone()),
            (format!("token: {v} rejected"), v.clone()),
            (format!("password: {v} wrong"), v.clone()),
            (format!("slack {slack} posted"), slack.clone()),
            (format!("aws {aws} seen"), aws.clone()),
            (format!("curl api-key={v} failed"), v.clone()),
            (format!("fetch https://user:{v}@example.com/x?y=1 ok"), v.clone()),
            (format!("Authorization: Bearer {v} sent"), v.clone()),
            (format!("{pk} charged"), pk.clone()),
        ] {
            let o = scrub(&line, 240);
            assert!(!o.contains(&secret), "{line} -> {o}");
            assert!(o.contains("[redacted]"), "{line} -> {o}");
        }
        // ordinary lines survive untouched
        let plain = "Main process exited, code=exited, status=1/FAILURE";
        assert_eq!(scrub(plain, 240), plain);
        assert_eq!(scrub("https://host/path?a=1#x", 240), "https://host/path");
    }
    #[test]
    fn scrubber_takes_whole_quoted_values_json_flags_and_cookie_lines() {
        for (line, secrets) in [
            (r#"KEY="x y secretword" tail"#, vec!["secretword"]),
            (r#"AUTH_HEADER="Bearer abcdefgh" ok"#, vec!["abcdefgh"]),
            (r#"Environment='FOO_TOKEN=abc123 BAR=ok' next"#, vec!["abc123"]),
            (r#"{"token":"abc123xyz","user":"tanner"}"#, vec!["abc123xyz"]),
            (r#"{"api_key": "abc 123 xyz"}"#, vec!["abc 123", "xyz"]),
            ("--password=hunter2hunter2 --user=tanner", vec!["hunter2hunter2"]),
            ("export FOO_SECRET=s3cr3t-value done", vec!["s3cr3t-value"]),
            ("Set-Cookie: session=abc123; Path=/; HttpOnly", vec!["abc123"]),
            ("Cookie: pdeck=abcdef123456; other=zzz999", vec!["abcdef123456", "zzz999"]),
            ("GET /x?token=abcdef123456&b=1 HTTP/1.1", vec!["abcdef123456"]),
            ("accessToken=abc.def.ghi clientSecret=zzz111", vec!["abc.def.ghi", "zzz111"]),
            ("Authorization: Basic dXNlcjpwYXNzd29yZA==", vec!["dXNlcjpwYXNzd29yZA"]),
            ("sent eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 ok", vec!["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"]),
            (r#"KEY="a\"b secretword" tail"#, vec!["secretword"]),
            ("Bearer\tabc123xyz456 sent", vec!["abc123xyz456"]),
            ("Bearer password: hunter2hunter2", vec!["hunter2hunter2"]),
            (r#"KEY2="two words" tail"#, vec!["two words"]),
        ] {
            let o = scrub(line, 400);
            for s in &secrets {
                assert!(!o.contains(s), "{line} -> {o}");
            }
            assert!(o.contains("[redacted]"), "{line} -> {o}");
        }
        // what is around a quoted value stays readable
        assert_eq!(scrub(r#"KEY="x y" tail"#, 100), "KEY=[redacted] tail");
        assert_eq!(scrub(r#"{"token":"abc","user":"tanner"}"#, 100), r#"{"token":[redacted],"user":"tanner"}"#);
    }
    #[test]
    fn scrubber_splits_acronym_camel_and_digit_names() {
        // built at run time: name=value literals in source would trip gitleaks
        let v = "abc123def456";
        for name in ["HAToken", "OpenAIKey", "KEY2", "token2", "API_KEY_2", "APIKey", "apiKey", "x-api-key"] {
            let line = format!("{name}={v} next");
            let o = scrub(&line, 200);
            assert!(!o.contains(v), "{line} -> {o}");
            assert!(o.contains("next"), "{line} -> {o}");
        }
        for plain in ["sha256=abc123def456", "utf8=ok", "k8s=abc123def456", "monkey2=abc123def456", "v2=abc123def456"] {
            assert_eq!(scrub(plain, 200), plain, "{plain}");
        }
        // name_words never panics on odd input
        for odd in ["", "1", "A", "_", "--", "123", "aA", "AAA", "aAa1", "\u{7f}"] {
            let _ = name_words(odd);
        }
    }
    #[test]
    fn scrubber_matches_whole_words_only_and_leaves_plain_lines_alone() {
        for plain in [
            "monkey=banana keyboard=us author=tanner hockey=ducks pwd=/home/alice",
            "Started deck feed job.",
            "mesh-backup.service: Main process exited, code=exited, status=1/FAILURE",
            "Keyword search done in 3 ms",
            "authenticating user tanner",
            "Failed with result 'exit-code'.",
            "commit 0123456789abcdef0123456789abcdef01234567 built",
            "https://github.com/thefiredev-cloud/pixel-deck",
        ] {
            assert_eq!(scrub(plain, 400), plain, "{plain}");
        }
    }
    /// The reviewer repro inputs and the plain lines every implementation of the redaction rule must agree on:
    /// tests/fixtures/redact-cases.json is also run through scripts/deck-launch clean_line and static/deck.js scanSecrets.
    #[test]
    fn shared_redaction_corpus_is_cut_and_plain_lines_survive() {
        let load = |s: &str| s.replace('\u{1}', "");
        let Ok(corpus) = serde_json::from_str::<Value>(include_str!("../../tests/fixtures/redact-cases.json")) else { panic!("redact-cases.json is not JSON") };
        let Some(cases) = corpus["cases"].as_array() else { panic!("no cases array") };
        assert!(cases.len() >= 40);
        for c in cases {
            let Some(raw) = c["in"].as_str() else { panic!("case without in") };
            let input = load(raw);
            let out = scrub(&input, 400);
            let Some(secrets) = c["secrets"].as_array() else { panic!("case without secrets") };
            for s in secrets {
                let Some(s) = s.as_str() else { panic!("secret is not a string") };
                let s = load(s);
                assert!(!out.contains(&s), "{input:?} -> {out:?} still holds {s:?}");
            }
            // the journal scrub cuts a url's query string whole, so that line has nothing left to mark
            assert!(c["nomark"] == true || out.contains("[redacted]"), "{input:?} -> {out:?}");
            for k in c["keep"].as_array().into_iter().flatten() {
                let Some(k) = k.as_str() else { panic!("keep entry is not a string") };
                let k = load(k);
                assert!(out.contains(&k), "{input:?} -> {out:?} lost {k:?}");
            }
            assert_eq!(scrub(&out, 400), out, "a second pass over {input:?} changes it");
        }
        let Some(plain) = corpus["plain"].as_array() else { panic!("no plain array") };
        for p in plain {
            let Some(p) = p.as_str() else { panic!("plain entry is not a string") };
            assert_eq!(scrub(p, 400), p);
        }
    }
    #[test]
    fn scrubber_cuts_the_shapes_the_review_found_in_unit_logs() {
        // assembled at run time: whole token literals in source would trip gitleaks
        let v = "abcdefghijklmnopqrstuvwx";
        for (line, secret) in [
            (["npm", "_"].concat() + v, v),
            (["glp", "at-"].concat() + "abcdefghijklmnopqrst", "abcdefghijklmnopqrst"),
            (["h", "f_"].concat() + v, v),
            (["AI", "zaSyA-"].concat() + "abcdefghijklmnopqrstuvwxyz0123456", "abcdefghijklmnopqrstuvwxyz0123456"),
            (["r", "k_live_"].concat() + v, v),
            ("Basic dXNlcjpwYXNzd29yZA==".to_string(), "dXNlcjpwYXNzd29yZA"),
            ("session=abcdef123456".to_string(), "abcdef123456"),
            ("pdeck=AbCdEf0123456789".to_string(), "AbCdEf0123456789"),
            ("/cam/eufy_cam1/index.m3u8?k=0123456789ABCDEF".to_string(), "0123456789ABCDEF"),
            ("GET /x?a=1&k=0123456789ABCDEF HTTP/1.1".to_string(), "0123456789ABCDEF"),
        ] {
            let o = scrub(&line, 240);
            assert!(!o.contains(secret), "{line} -> {o}");
            assert!(o.contains("[redacted]"), "{line} -> {o}");
        }
        // ordinary words next to the new shapes stay readable
        for plain in ["Basic functionality works", "hf_download_dir=/srv/models", "npm_config_cache=/tmp/x", "key points: first", "k=v and ok"] {
            assert_eq!(scrub(plain, 240), plain, "{plain}");
        }
    }
    #[test]
    fn unit_names_cannot_look_like_options() {
        assert!(unit_name("fleet-health-check.service"));
        assert!(unit_name("mv-camera-recorder@eufy_cam1.service"));
        assert!(!unit_name("-n.service"));
        assert!(!unit_name("--now.timer"));
        assert!(!unit_name("a b.service"));
        assert!(!unit_name(".service"));
    }
    #[test]
    fn helper_failures_keep_their_meaning_and_never_pass_gateway_text() {
        let failed = |w: &str| helper_result(Ok((1, format!("noise\n{{\"ok\":false,\"error\":\"{w}\"}}\n"))));
        let refused = |w: &str| helper_result(Ok((2, format!("{{\"ok\":false,\"error\":\"{w}\"}}\n"))));
        // upstream failures: fixed words and a bare three-digit status say what failed
        assert_eq!(failed("hermes http 404"), (502, json!({"ok":false,"error":"hermes http 404"})));
        assert_eq!(failed("hermes gateway unreachable").1["error"], "hermes gateway unreachable");
        assert_eq!(failed("run not found").1["error"], "run not found");
        // anything else, including gateway text with a secret in it, is replaced
        for w in ["hermes http 40x", "hermes http 4040", "provider said token=abc123 no", "", "launcher failed"] {
            assert_eq!(failed(w), (502, json!({"ok":false,"error":"launcher failed"})), "{w}");
        }
        assert_eq!(helper_result(Ok((1, "not json".into()))).1["error"], "launcher failed");
        assert_eq!(helper_result(Err("spawn failed".into())).0, 502);
        // a refusal by the helper (a race with the server's own checks) keeps its status and word
        assert_eq!(refused("already paused"), (409, json!({"ok":false,"error":"already paused"})));
        assert_eq!(refused("already active").0, 409);
        assert_eq!(refused("unknown job").0, 404);
        assert_eq!(refused("unknown run").0, 404);
        for w in ["bad id", "bad act", "bad text", "bad run id", "bad gateway override"] {
            assert_eq!(refused(w).0, 400, "{w}");
        }
        // run routing: a Jev/Clef refusal or a bad saved route is a 422 with its own word; both services down is an upstream failure
        for w in ["route invalid", "gate blocked", "gate unsure"] {
            assert_eq!(refused(w), (422, json!({"ok":false,"error":w})), "{w}");
        }
        assert_eq!(failed("gate unavailable"), (502, json!({"ok":false,"error":"gate unavailable"})));
        assert_eq!(refused("something else"), (502, json!({"ok":false,"error":"launcher failed"})));
        // success needs ok:true on the last line
        assert_eq!(helper_result(Ok((0, "{\"ok\":true,\"mode\":\"new\"}\n".into()))).0, 200);
        assert_eq!(helper_result(Ok((0, "{\"ok\":false}\n".into()))).0, 502);
    }
    #[test]
    fn message_text_accepts_phone_spaces_and_refuses_control_characters() {
        // emoji sequences keep their joiner and variation selector
        assert!(clean_text("family \u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467} rainbow \u{1F3F3}\u{FE0F}\u{200D}\u{1F308}").is_some());
        assert!(clean_text("rtl\u{200F}mark soft\u{00AD}hyphen").is_some());
        assert_eq!(clean_text("a\u{00A0}b\u{202F}c\nd\te").as_deref(), Some("a b c\nd\te"));
        // every other Unicode space (category Zs) is a plain space too: em, thin, ideographic (a Japanese keyboard space), medium math, ogham
        for sp in ['\u{1680}', '\u{2000}', '\u{2002}', '\u{2003}', '\u{2009}', '\u{200A}', '\u{205F}', '\u{3000}'] {
            assert_eq!(clean_text(&format!("a{sp}b")).as_deref(), Some("a b"), "{sp:?}");
            assert_eq!(clean_text(&format!("{sp}  {sp}")).as_deref(), None, "{sp:?} alone is empty");
        }
        assert_eq!(clean_text("\u{3000}hi\u{3000}").as_deref(), Some("hi"));
        assert_eq!(clean_text("\u{00A0}  ").as_deref(), None);
        assert_eq!(clean_text("bad\u{0001}").as_deref(), None);
        assert_eq!(clean_text("bad\r\nline").as_deref(), None);
        assert_eq!(clean_text("line\u{2028}break").as_deref(), None);
        assert!(clean_text(&"x".repeat(2000)).is_some());
        assert!(clean_text(&"x".repeat(2001)).is_none());
        assert!(clean_text("it\u{2019}s fine \u{1F44D}").is_some());
    }
    #[test]
    fn rate_rejects_gap_and_minute_window() {
        let mut h = VecDeque::new();
        assert!(rate(&mut h, Duration::from_secs(2), 20).is_ok());
        assert!(rate(&mut h, Duration::from_secs(2), 20).is_err());
        let mut h = VecDeque::new();
        for _ in 0..20 {
            assert!(rate(&mut h, Duration::ZERO, 20).is_ok());
        }
        assert!(rate(&mut h, Duration::ZERO, 20).is_err());
    }
    #[test]
    fn rate_releases_capacity_after_the_minute_window_expires() {
        let mut history = VecDeque::from([Instant::now() - Duration::from_secs(60)]);

        assert!(rate(&mut history, Duration::ZERO, 1).is_ok());
        assert_eq!(history.len(), 1);
    }
    #[tokio::test]
    async fn camera_diag_drops_unknown_fields_and_caps_old_records() {
        let home = std::env::temp_dir().join(format!("pdeck-cam-diag-{}", std::process::id()));
        let Ok(()) = std::fs::create_dir_all(home.join(".local/state/pixel-deck")) else { panic!("create cam-diag state dir") };
        let file = home.join(".local/state/pixel-deck/cam-diag.jsonl");
        let Ok(()) = std::fs::write(&file, vec![b'x'; 256 * 1024]) else { panic!("seed cam-diag file") };
        let a = Actions::default();
        let (code,v)=a.cam_diag(&home, br#"{"e":"hls.timeout","cam":2,"mode":"hls","d":{"good":7,"token":"abc123","secret":"token=abc123"},"cookie":"PRIVATE"}"#, "Agent/1?token=PRIVATE").await;
        assert_eq!((code, v["ok"].as_bool()), (200, Some(true)));
        let Ok(text) = std::fs::read_to_string(&file) else { panic!("read cam-diag file") };
        assert!(text.len() <= 256 * 1024);
        assert!(!text.contains("PRIVATE") && !text.contains("abc123"));
        let Some(last) = text.lines().last() else { panic!("cam-diag file has no rows") };
        let Ok(row) = serde_json::from_str::<Value>(last) else { panic!("cam-diag row is not JSON") };
        assert!(row.get("cookie").is_none());
        assert!(row["d"].get("token").is_none());
        assert_eq!(row["d"]["good"], 7);
        assert_eq!(
            a.cam_diag(
                &home,
                br#"{"e":"boot","cam":0,"mode":"boot","d":{"bad":{"nested":1}}}"#,
                ""
            )
            .await
            .0,
            400
        );
        let _ = std::fs::remove_file(file);
    }
    #[test]
    fn append_keeps_journal_private_and_adds_one_json_value_per_line() {
        use std::os::unix::fs::PermissionsExt;

        let home = std::env::temp_dir().join(format!("pdeck-actions-{}", std::process::id()));
        let file = home.join(".local/state/pixel-deck/actions.jsonl");
        let _ = std::fs::remove_dir_all(&home);

        assert!(append(&home, "actions.jsonl", &json!({"event": "first"})).is_ok());
        let Ok(metadata) = std::fs::metadata(&file) else { panic!("stat actions journal") };
        assert_eq!(metadata.permissions().mode() & 0o777, 0o600);

        assert!(std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).is_ok());
        assert!(append(&home, "actions.jsonl", &json!({"event": "second"})).is_ok());
        let Ok(metadata) = std::fs::metadata(&file) else { panic!("stat actions journal") };
        assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
        let Ok(contents) = std::fs::read_to_string(&file) else { panic!("read actions journal") };
        assert_eq!(contents.lines().collect::<Vec<_>>(), [
            r#"{"event":"first"}"#,
            r#"{"event":"second"}"#,
        ]);

        let _ = std::fs::remove_dir_all(home);
    }
    #[test]
    fn capped_journal_keeps_newest_complete_rows() {
        let home = std::env::temp_dir().join(format!(
            "pdeck-capped-journal-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&home);
        let file = home.join(".local/state/pixel-deck/events.jsonl");
        let rows = ["old-1", "old-2", "old-3", "old-4"]
            .map(|row| json!({"row": row}).to_string() + "\n")
            .concat();
        assert!(std::fs::create_dir_all(home.join(".local/state/pixel-deck")).is_ok());
        assert!(std::fs::write(&file, rows).is_ok());

        assert!(
            append_capped(&home, "events.jsonl", &json!({"row": "new"}), 40).is_ok()
        );

        let contents = std::fs::read_to_string(&file).unwrap_or_default();
        let got = contents
            .lines()
            .map(|line| {
                serde_json::from_str::<Value>(line)
                    .map(|row| row["row"].as_str().unwrap_or_default().to_string())
            })
            .collect::<Result<Vec<_>, _>>()
            .unwrap_or_default();
        assert!(contents.len() <= 40, "journal exceeded cap: {}", contents.len());
        assert_eq!(got, ["old-4", "new"]);
        let _ = std::fs::remove_dir_all(home);
    }
    #[tokio::test]
    async fn cron_refuses_ambiguous_eight_character_ids_before_dispatch() {
        let home = std::env::temp_dir().join(format!("pdeck-cron-ambiguous-{}", std::process::id()));
        let jobs_path = home.join(crons::REL);
        let _ = std::fs::remove_dir_all(&home);
        assert!(std::fs::create_dir_all(jobs_path.parent().unwrap_or(&home)).is_ok());
        assert!(std::fs::write(
            &jobs_path,
            r#"{"jobs":[
                {"id":"a1b2c3d4one","enabled":true,"state":"scheduled"},
                {"id":"a1b2c3d4two","enabled":true,"state":"scheduled"}
            ]}"#,
        )
        .is_ok());

        let (code, result) = Actions::default()
            .cron(&home, "a1b2c3d4", "pause", &Mutex::new(None))
            .await;

        assert_eq!(code, 409);
        assert_eq!(result["error"], "ambiguous id");
        let _ = std::fs::remove_dir_all(home);
    }
}
