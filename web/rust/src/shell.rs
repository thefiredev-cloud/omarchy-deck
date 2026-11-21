//! The shell version that nobody edits (mechanism A). `static/sw.js` names its cache `pdeck-shell-__SHELL_HASH__`;
//! the server swaps the token for 16 hex digits of FNV-1a 64 over the worker's own bytes and, in list order, every
//! path of its `SHELL=[...]` list with that file's length and bytes. Any byte of a cached file, or of the worker,
//! gives a new name, so the browser installs a new worker after every merge that changes the shell.
//! A list entry with no bytes is a problem the caller logs; its name is hashed in, so the raw token is never served.
use std::borrow::Cow;

pub const TOKEN: &[u8] = b"__SHELL_HASH__";

/// The served worker and what went wrong while stamping it (empty when every entry resolved).
pub struct Stamped {
    pub body: Vec<u8>,
    pub problems: Vec<String>,
}

/// The paths of the `SHELL=[...]` list, in order; None when the worker declares no list.
pub fn shell_list(sw: &[u8]) -> Option<Vec<String>> {
    let s = std::str::from_utf8(sw).ok()?;
    let start = s.find("SHELL=[")? + "SHELL=[".len();
    let end = start + s[start..].find(']')?;
    let mut out = Vec::new();
    let mut rest = &s[start..end];
    while let Some(i) = rest.find(['\'', '"']) {
        let q = rest.as_bytes()[i] as char;
        let tail = &rest[i + 1..];
        let Some(j) = tail.find(q) else { break };
        out.push(tail[..j].to_string());
        rest = &tail[j + 1..];
    }
    Some(out)
}

struct Fnv(u64);

impl Fnv {
    fn eat(&mut self, bytes: &[u8]) {
        for b in bytes {
            self.0 ^= u64::from(*b);
            self.0 = self.0.wrapping_mul(0x0100_0000_01b3);
        }
    }
    /// One field: its length first, so two fields can never run together into the same stream.
    fn field(&mut self, bytes: &[u8]) {
        self.eat(&(bytes.len() as u64).to_le_bytes());
        self.eat(bytes);
    }
}

/// Stamp the worker. `get` answers the bytes a list path serves (`/` is the page itself).
pub fn build(sw: &[u8], get: &dyn Fn(&str) -> Option<Cow<'static, [u8]>>) -> Stamped {
    let mut problems = Vec::new();
    let mut h = Fnv(0xcbf2_9ce4_8422_2325);
    h.field(sw);
    match shell_list(sw) {
        Some(list) => {
            for p in list {
                h.field(p.as_bytes());
                match get(&p) {
                    Some(b) => h.field(&b),
                    None => {
                        h.field(b"\0missing");
                        problems.push(format!("{p} has no bytes"));
                    }
                }
            }
        }
        None => problems.push("sw.js declares no SHELL list".into()),
    }
    let hex = format!("{:016x}", h.0);
    let mut body = Vec::with_capacity(sw.len() + 2);
    let mut rest = sw;
    let mut swapped = false;
    while let Some(i) = rest.windows(TOKEN.len()).position(|w| w == TOKEN) {
        body.extend_from_slice(&rest[..i]);
        body.extend_from_slice(hex.as_bytes());
        rest = &rest[i + TOKEN.len()..];
        swapped = true;
    }
    body.extend_from_slice(rest);
    if !swapped {
        problems.push("sw.js has no __SHELL_HASH__ token".into());
    }
    Stamped { body, problems }
}

/// The stamped worker, or the first problem (tests; the server serves `build`'s body and logs its problems).
#[cfg(test)]
pub fn stamp(sw: &[u8], get: &dyn Fn(&str) -> Option<Cow<'static, [u8]>>) -> Result<Vec<u8>, String> {
    let s = build(sw, get);
    match s.problems.into_iter().next() {
        Some(p) => Err(p),
        None => Ok(s.body),
    }
}

/// The 16 hex digits of the cache name in a served worker (`V='pdeck-shell-<hex>'`).
#[cfg(test)]
pub fn version_of(served: &[u8]) -> Option<String> {
    let pre = b"V='pdeck-shell-";
    let i = served.windows(pre.len()).position(|w| w == pre)? + pre.len();
    let v = served.get(i..i + 17)?;
    (v[16] == b'\'' && v[..16].iter().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(c)))
        .then(|| String::from_utf8_lossy(&v[..16]).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    const SW: &[u8] = b"const V='pdeck-shell-__SHELL_HASH__',SHELL=['/','/app.js',\n '/css/a.css'];";

    fn files(app: &'static [u8]) -> HashMap<&'static str, &'static [u8]> {
        HashMap::from([("/", b"<html>".as_slice()), ("/app.js", app), ("/css/a.css", b"a{}".as_slice())])
    }

    fn with(m: HashMap<&'static str, &'static [u8]>) -> impl Fn(&str) -> Option<Cow<'static, [u8]>> {
        move |p| m.get(p).map(|b| Cow::Borrowed(*b))
    }

    #[test]
    fn reads_the_list_in_order() {
        assert_eq!(
            shell_list(SW),
            Some(vec!["/".to_string(), "/app.js".into(), "/css/a.css".into()])
        );
        assert_eq!(shell_list(b"const V='x';"), None);
    }

    #[test]
    fn stamp_changes_with_one_byte() {
        let Ok(a) = stamp(SW, &with(files(b"let x=1"))) else { panic!("stamps") };
        let Ok(b) = stamp(SW, &with(files(b"let x=2"))) else { panic!("stamps") };
        let Ok(again) = stamp(SW, &with(files(b"let x=1"))) else { panic!("stamps") };
        let (Some(va), Some(vb)) = (version_of(&a), version_of(&b)) else { panic!("hex") };
        assert_ne!(va, vb, "one byte of one cached file gives a new cache name");
        assert_eq!(a, again, "the same bytes always give the same name (no reload loop)");
        assert!(!a.windows(TOKEN.len()).any(|w| w == TOKEN));
        assert_eq!(a.len(), SW.len() + 16 - TOKEN.len());
        // the worker's own bytes count too
        let sw2 = [SW, b"//"].concat();
        let Ok(c) = stamp(&sw2, &with(files(b"let x=1"))) else { panic!("stamps") };
        assert_ne!(version_of(&c), Some(va.clone()));
        // a byte moved from one file to the next is a different shell
        let mut m = files(b"let x=1a");
        m.insert("/css/a.css", b"{}");
        let Ok(d) = stamp(SW, &with(m)) else { panic!("stamps") };
        let mut m = files(b"let x=1");
        m.insert("/css/a.css", b"a{}");
        let Ok(e) = stamp(SW, &with(m)) else { panic!("stamps") };
        assert_ne!(version_of(&d), version_of(&e));
    }

    #[test]
    fn sw_version_tracks_every_shell_file() {
        let Some(list) = shell_list(crate::SW_JS) else { panic!("sw.js declares SHELL") };
        assert!(list.len() > 20, "the real list is read, {} entries", list.len());
        assert!(list.iter().any(|i: &String| i == "/") && !list.iter().any(|i: &String| i == "/sw.js"));
        let tokens = crate::SW_JS.windows(TOKEN.len()).filter(|w| *w == TOKEN).count();
        assert_eq!(tokens, 1, "the token appears once, in V only");
        for p in &list {
            assert!(crate::shell_file(p).is_some(), "{p} is in SHELL but the server has no bytes for it");
            if p != "/" {
                assert!(crate::public_asset(p).is_some(), "{p} is in SHELL but not public before sign-in");
            }
        }
        let served = crate::SW_SERVED.as_slice();
        assert_eq!(stamp(crate::SW_JS, &crate::shell_file).as_deref(), Ok(served));
        assert!(version_of(served).is_some(), "the served worker names a 16 hex cache");
        assert!(!served.windows(TOKEN.len()).any(|w| w == TOKEN), "the token is never served");
        assert_eq!(crate::public_asset("/sw.js").map(|(b, _)| b), Some(served));
        // each entry moves the name: a one-byte change of any one file changes the stamp
        let base = version_of(served);
        for p in &list {
            let get = |q: &str| -> Option<Cow<'static, [u8]>> {
                let b = crate::shell_file(q)?;
                if q != p.as_str() {
                    return Some(b);
                }
                let mut v = b.into_owned();
                v.push(b'\n');
                Some(Cow::Owned(v))
            };
            assert_ne!(version_of(&build(crate::SW_JS, &get).body), base, "{p} does not move the stamp");
        }
        // `/` is both pages the page answer can be: the deck's index.html and the deal desk's cre.html (a viewer's `/`)
        let Some(root) = crate::shell_file("/") else { panic!("the page") };
        assert_eq!(root.as_ref(), [crate::INDEX, crate::CRE_HTML].concat().as_slice());
        let desk = |q: &str| -> Option<Cow<'static, [u8]>> {
            if q == "/" {
                return Some(Cow::Owned([crate::INDEX, crate::CRE_HTML, b"\n".as_slice()].concat()));
            }
            crate::shell_file(q)
        };
        assert_ne!(version_of(&build(crate::SW_JS, &desk).body), base, "a change to cre.html moves the stamp");
    }

    #[test]
    fn a_missing_entry_is_named_and_still_never_serves_the_token() {
        let mut m = files(b"x");
        m.remove("/css/a.css");
        assert_eq!(stamp(SW, &with(m.clone())), Err("/css/a.css has no bytes".into()));
        let s = build(SW, &with(m));
        assert_eq!(s.problems.len(), 1);
        assert!(version_of(&s.body).is_some(), "a stamp is served anyway");
        assert!(stamp(b"SHELL=['/'];", &with(files(b"x"))).is_err(), "no token is a problem");
    }
}
