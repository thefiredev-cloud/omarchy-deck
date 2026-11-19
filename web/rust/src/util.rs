//! Small shared helpers: time, query parsing, subprocess with timeout, structured logs.
use std::collections::HashMap;
use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

pub fn uid() -> u32 {
    std::fs::metadata("/proc/self")
        .map(|m| std::os::unix::fs::MetadataExt::uid(&m))
        .unwrap_or(1000)
}

pub fn now_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Structured stderr log line. Callers must never pass secrets or query strings.
pub fn log(level: &str, msg: &str, fields: &[(&str, String)]) {
    let mut o = serde_json::Map::new();
    o.insert("ts".into(), now_epoch().into());
    o.insert("level".into(), level.into());
    o.insert("msg".into(), msg.into());
    for (k, v) in fields {
        o.insert((*k).into(), v.clone().into());
    }
    eprintln!("{}", serde_json::Value::Object(o));
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

pub fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < b.len() => {
                if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                    out.push(h * 16 + l);
                    i += 2;
                } else {
                    out.push(b'%');
                }
            }
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// First value per key, like Python `parse_qs(...)[k][0]`.
pub fn parse_qs(q: Option<&str>) -> HashMap<String, String> {
    let mut m = HashMap::new();
    for pair in q.unwrap_or("").split('&') {
        if pair.is_empty() {
            continue;
        }
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        m.entry(pct_decode(k)).or_insert_with(|| pct_decode(v));
    }
    m
}

pub fn ct_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn ok_int(s: &str) -> bool {
    !s.is_empty() && s.len() <= 3 && s.bytes().all(|c| c.is_ascii_digit())
}

/// Run a fixed argv with a hard timeout. The child is killed on timeout or drop.
pub async fn run(
    argv: &[&str],
    stdin: Option<&[u8]>,
    secs: u64,
    env: &[(&str, String)],
) -> Result<(i32, String), String> {
    let (prog, args) = argv.split_first().ok_or("empty argv")?;
    let mut c = Command::new(prog);
    c.args(args)
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    for (k, v) in env {
        c.env(k, v);
    }
    let fut = async {
        let mut child = c.spawn().map_err(|e| format!("spawn: {e}"))?;
        if let (Some(data), Some(mut si)) = (stdin, child.stdin.take()) {
            let _ = si.write_all(data).await;
            drop(si);
        }
        let out = child
            .wait_with_output()
            .await
            .map_err(|e| format!("wait: {e}"))?;
        Ok::<_, String>((
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stdout).into_owned(),
        ))
    };
    tokio::time::timeout(Duration::from_secs(secs), fut)
        .await
        .map_err(|_| "timeout".to_string())?
}

/// Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Parse `YYYY-MM-DDTHH:MM:SS[.frac](Z|+hh:mm|-hh:mm)` to epoch seconds.
pub fn iso_to_epoch(s: &str) -> Option<u64> {
    let s = s.trim();
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || !(b[10] == b'T' || b[10] == b' ') {
        return None;
    }
    let n = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, se) = (
        n(0..4)?,
        n(5..7)?,
        n(8..10)?,
        n(11..13)?,
        n(14..16)?,
        n(17..19)?,
    );
    let mut rest = &s[19..];
    if let Some(r) = rest.strip_prefix('.') {
        let digits = r.bytes().take_while(u8::is_ascii_digit).count();
        rest = &r[digits..];
    }
    let off = match rest {
        "" | "Z" | "z" => 0,
        r if r.len() >= 6 && (r.starts_with('+') || r.starts_with('-')) => {
            let sign = if r.starts_with('-') { -1 } else { 1 };
            let oh = r.get(1..3)?.parse::<i64>().ok()?;
            let om = r.get(4..6)?.parse::<i64>().ok()?;
            sign * (oh * 3600 + om * 60)
        }
        _ => return None,
    };
    let t = days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + se - off;
    u64::try_from(t).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qs_first_value_and_decode() {
        let m = parse_qs(Some("a=1&a=2&b=x%20y+z&c"));
        assert_eq!(m["a"], "1");
        assert_eq!(m["b"], "x y z");
        assert_eq!(m["c"], "");
        assert!(parse_qs(None).is_empty());
    }

    #[test]
    fn pct_decode_bad_input_is_safe() {
        assert_eq!(pct_decode("%"), "%");
        assert_eq!(pct_decode("%zz"), "%zz");
        assert_eq!(pct_decode("%4"), "%4");
        assert_eq!(pct_decode("%41"), "A");
    }

    #[test]
    fn ints_and_compare() {
        assert!(ok_int("0") && ok_int("100") && !ok_int("1000") && !ok_int("") && !ok_int("-1"));
        assert!(ct_eq("abc", "abc") && !ct_eq("abc", "abd") && !ct_eq("abc", "ab"));
    }

    #[test]
    fn iso_parse() {
        assert_eq!(iso_to_epoch("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(iso_to_epoch("2026-09-29T18:46:10Z"), Some(1_790_707_570));
        assert_eq!(
            iso_to_epoch("2026-09-29T11:46:10-07:00"),
            Some(1_790_707_570)
        );
        assert_eq!(
            iso_to_epoch("2026-09-29T18:46:10.123456+00:00"),
            Some(1_790_707_570)
        );
        assert_eq!(iso_to_epoch("garbage"), None);
    }

    #[tokio::test]
    async fn run_times_out_and_captures() {
        assert!(run(&["sleep", "5"], None, 1, &[]).await.is_err());
        let (rc, o) = run(&["echo", "hi"], None, 2, &[])
            .await
            .unwrap_or((9, String::new()));
        assert_eq!((rc, o.trim()), (0, "hi"));
    }
}
