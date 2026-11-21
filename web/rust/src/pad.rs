//! Trackpad and keyboard relay. The phone sends small JSON commands over a WebSocket; each is
//! strictly validated here, re-serialized into a canonical line and written to a per-connection
//! input agent (Quartz on the Mac Mini, ydotoold socket on Omarchy hosts). Client text never
//! reaches a shell: the agent argv is fixed and commands travel on the agent's stdin.
use serde_json::{json, Value};

pub const TARGETS: [&str; 3] = ["mini", "pc-desktop", "Dell"];

pub fn valid_target(t: &str) -> bool {
    TARGETS.contains(&t)
}

#[derive(Debug, Clone, PartialEq)]
pub enum Cmd {
    Move(i32, i32),
    Scroll(i32, i32),
    /// button, click count, click state (1..=3, what the OS reports as clickState)
    Click(char, u8, u8),
    Button(char, bool),
    Key(String, Vec<String>),
    /// Press (`true`) or release (`false`) a holdable key and leave it down until released.
    Hold(String, bool),
    Text(String),
    Ping(u64),
    Release,
}

const MAX_MSG: usize = 2048;
const MAX_TEXT: usize = 256;
const MODS: [&str; 5] = ["cmd", "ctrl", "alt", "shift", "super"];
const NAMED: [&str; 34] = [
    "enter",
    "esc",
    "tab",
    "space",
    "backspace",
    "delete",
    "up",
    "down",
    "left",
    "right",
    "home",
    "end",
    "pgup",
    "pgdn",
    "minus",
    "equal",
    "lbracket",
    "rbracket",
    "backslash",
    "semicolon",
    "quote",
    "grave",
    "comma",
    "period",
    "slash",
    "volup",
    "voldown",
    "mute",
    "playpause",
    "next",
    "prev",
    "capslock",
    "ralt",
    "print",
];

/// Keys the phone may hold down. Right Alt is the VoxType dictation trigger, which records for
/// as long as the key is held. Left Alt, modifiers and everything else stay tap-only.
pub const HOLDABLE: [&str; 1] = ["ralt"];

pub fn valid_mod(m: &str) -> bool {
    MODS.contains(&m)
}

/// Named keys, a-z, 0-9 and f1-f12. Agents map the same names to their native codes.
pub fn valid_key(k: &str) -> bool {
    let b = k.as_bytes();
    if b.len() == 1 {
        return b[0].is_ascii_lowercase() || b[0].is_ascii_digit();
    }
    if let Some(n) = k.strip_prefix('f') {
        // digits only: "f+5" and "f 5" parse as numbers but are not key names
        return !n.is_empty()
            && n.bytes().all(|c| c.is_ascii_digit())
            && !n.starts_with('0')
            && matches!(n.parse::<u8>(), Ok(1..=12));
    }
    NAMED.contains(&k)
}

/// The keys a Super (`cmd`) tap may carry. The Pad latches Super for the next key, so the server holds
/// the line: a Super on any other key is refused here even if the page (or anyone with the deck cookie)
/// asks for it. The set is what Hyprland (and macOS) bind to Super: the clipboard and window keys
/// (c v x z a w f), the launcher and switcher (space, tab), Enter for the terminal, the arrows for
/// focus and the digits for workspaces, plus workspace overview (f4). Ctrl, Alt and Shift may still be
/// latched on top of them. PRODUCT.md and DESIGN.md list the same set.
pub const SUPER_KEYS: [&str; 25] = [
    "c", "v", "x", "z", "a", "w", "f", "space", "tab", "f4", "enter", "up", "down", "left", "right",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
];

/// A key tap that carries Super must be one of `SUPER_KEYS`.
pub fn super_combo_ok(k: &str, mods: &[String]) -> bool {
    !mods.iter().any(|m| m == "cmd") || SUPER_KEYS.contains(&k)
}

/// Key taps and typed text go through the session's ordered `KeyQueue` (see below), not through the limiter.
pub fn is_queued(c: &Cmd) -> bool {
    matches!(c, Cmd::Key(_, _) | Cmd::Text(_))
}

fn num(v: &Value, key: &str, lim: i32) -> Result<i32, &'static str> {
    let f = v.get(key).and_then(Value::as_f64).ok_or("bad number")?;
    if !f.is_finite() {
        return Err("bad number");
    }
    Ok(f.round().clamp(-(lim as f64), lim as f64) as i32)
}

fn btn(v: &Value) -> Result<char, &'static str> {
    match v.get("b").and_then(Value::as_str) {
        Some("l") => Ok('l'),
        Some("r") => Ok('r'),
        Some("m") => Ok('m'),
        _ => Err("bad button"),
    }
}

pub fn parse(s: &str) -> Result<Cmd, &'static str> {
    if s.len() > MAX_MSG {
        return Err("too long");
    }
    let v: Value = serde_json::from_str(s).map_err(|_| "bad json")?;
    match v.get("op").and_then(Value::as_str).ok_or("no op")? {
        "move" => Ok(Cmd::Move(num(&v, "dx", 1500)?, num(&v, "dy", 1500)?)),
        "scroll" => Ok(Cmd::Scroll(num(&v, "dx", 600)?, num(&v, "dy", 600)?)),
        "click" => {
            let n = match v.get("n") {
                None => 1,
                Some(x) => match x.as_u64() {
                    Some(n @ 1..=3) => n as u8,
                    _ => return Err("bad count"),
                },
            };
            let st = match v.get("s") {
                None => 1,
                Some(x) => match x.as_u64() {
                    Some(s @ 1..=3) => s as u8,
                    _ => return Err("bad click state"),
                },
            };
            Ok(Cmd::Click(btn(&v)?, n, st))
        }
        "button" => {
            let d = v.get("down").and_then(Value::as_bool).ok_or("bad down")?;
            Ok(Cmd::Button(btn(&v)?, d))
        }
        "key" => {
            let k = v.get("k").and_then(Value::as_str).ok_or("bad key")?;
            if !valid_key(k) {
                return Err("bad key");
            }
            let mut mods: Vec<String> = vec![];
            if let Some(m) = v.get("mods") {
                for x in m.as_array().ok_or("bad mods")? {
                    let x = x.as_str().ok_or("bad mods")?;
                    if !valid_mod(x) {
                        return Err("bad mods");
                    }
                    if !mods.iter().any(|y| y == x) {
                        mods.push(x.to_string());
                    }
                }
            }
            if !super_combo_ok(k, &mods) {
                return Err("bad combo");
            }
            Ok(Cmd::Key(k.to_string(), mods))
        }
        "hold" => {
            let k = v.get("k").and_then(Value::as_str).ok_or("bad key")?;
            if !HOLDABLE.contains(&k) {
                return Err("bad key");
            }
            let d = v.get("down").and_then(Value::as_bool).ok_or("bad down")?;
            Ok(Cmd::Hold(k.to_string(), d))
        }
        "text" => {
            let t = v.get("s").and_then(Value::as_str).ok_or("bad text")?;
            if t.is_empty() || t.chars().count() > MAX_TEXT {
                return Err("bad text length");
            }
            if t.chars().any(|c| c.is_control() && c != '\n' && c != '\t') {
                return Err("control char");
            }
            Ok(Cmd::Text(t.to_string()))
        }
        "ping" => Ok(Cmd::Ping(v.get("id").and_then(Value::as_u64).unwrap_or(0))),
        "release" => Ok(Cmd::Release),
        _ => Err("unknown op"),
    }
}

impl Cmd {
    /// Ops that release something the host may still hold. They are never rate limited. Key taps and
    /// text are not: they press and release in one agent call and wait in the ordered `KeyQueue`.
    pub fn is_safety(&self) -> bool {
        matches!(self, Cmd::Release | Cmd::Button(_, false) | Cmd::Hold(_, false))
    }

    /// One canonical JSON line for the agent. Built from validated fields only.
    pub fn line(&self) -> String {
        let v = match self {
            Cmd::Move(x, y) => json!({"op":"move","dx":x,"dy":y}),
            Cmd::Scroll(x, y) => json!({"op":"scroll","dx":x,"dy":y}),
            Cmd::Click(b, n, s) => json!({"op":"click","b":b.to_string(),"n":n,"s":s}),
            Cmd::Button(b, d) => json!({"op":"button","b":b.to_string(),"down":d}),
            Cmd::Key(k, m) => json!({"op":"key","k":k,"mods":m}),
            Cmd::Hold(k, d) => json!({"op":"hold","k":k,"down":d}),
            Cmd::Text(s) => json!({"op":"text","s":s}),
            Cmd::Ping(i) => json!({"op":"ping","id":i}),
            Cmd::Release => json!({"op":"release"}),
        };
        v.to_string()
    }
}

/// POSIX single-quote for the one remote argument ssh passes to the far shell.
pub fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r#"'"'"'"#))
}

static MAC_AGENT: &str = include_str!("../../agents/pad_mac.py");
static LINUX_AGENT: &str = include_str!("../../agents/pad_linux.py");

fn ssh(host: &str, remote: String) -> Vec<String> {
    let mut v: Vec<String> = [
        "ssh",
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=5",
        "-o",
        "ServerAliveInterval=10",
        "-o",
        "ServerAliveCountMax=2",
        host,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    v.push(remote);
    v
}

/// Browser WebSocket requests must come from the deck's own page. A missing Origin (native
/// client) is allowed because the token cookie is still required.
pub fn origin_ok(origin: Option<&str>, host: Option<&str>) -> bool {
    let Some(o) = origin else {
        return host.is_some();
    };
    let Some(h) = host else { return false };
    let rest = o
        .strip_prefix("https://")
        .or_else(|| o.strip_prefix("http://"));
    rest == Some(h)
}

/// CSRF guard for the request classes that matter: state-changing methods and the `?t=`
/// cookie bootstrap (`checked`). When Origin is present it must match Host (`origin_ok`). A
/// state-changing request the browser marks `Sec-Fetch-Site: cross-site` is refused even without
/// an Origin. Plain GETs, including a pairing link opened from another app, are not judged by
/// Sec-Fetch-Site because those navigations are legitimately cross-site.
pub fn csrf_ok(
    unsafe_method: bool,
    checked: bool,
    origin: Option<&str>,
    host: Option<&str>,
    sec_fetch_site: Option<&str>,
) -> bool {
    if unsafe_method && sec_fetch_site == Some("cross-site") {
        return false;
    }
    if !(unsafe_method || checked) {
        return true;
    }
    origin.is_none() || origin_ok(origin, host)
}

/// Fixed-window limiter: at most `cap` commands per second per session. Key taps and typed text are not
/// counted here: they wait in the ordered `KeyQueue` and leave at its own pace.
pub struct Limiter {
    cap: u32,
    n: u32,
    start: Option<std::time::Instant>,
}

impl Limiter {
    pub fn new(cap: u32) -> Self {
        Self {
            cap,
            n: 0,
            start: None,
        }
    }
    pub fn allow(&mut self, now: std::time::Instant) -> bool {
        match self.start {
            Some(t) if now.duration_since(t).as_millis() < 1000 => {}
            _ => {
                self.start = Some(now);
                self.n = 0;
            }
        }
        if self.n < self.cap {
            self.n += 1;
            true
        } else {
            false
        }
    }
    /// Safety ops (release, button up, hold up) always pass and do not use budget. Everything else
    /// counts against the per-second cap.
    pub fn allow_cmd(&mut self, c: &Cmd, now: std::time::Instant) -> bool {
        c.is_safety() || self.allow(now)
    }
}

/// Key taps and typed text wait here, in the order they arrived, and leave one at a time at least
/// `KEY_GAP_MS` apart (29 a second: the device is never handed more than 30 a second). Nothing is dropped
/// and nothing is reordered, so a Wi-Fi stall followed by a burst only types slower. The queue is bounded
/// (`KEY_QUEUE_MAX`): beyond it an op is not kept, only counted, and the count goes back to the phone as
/// one `{"lost": n}` frame (at most 10 frames a second) so it can say so. It is the session's own and ends
/// with it: keys still waiting when the phone goes away are never typed.
pub const KEY_QUEUE_MAX: usize = 256;
pub const KEY_GAP_MS: u64 = 34;
const LOST_GAP_MS: u128 = 100;

pub struct KeyQueue {
    q: std::collections::VecDeque<Cmd>,
    gap: std::time::Duration,
    last_pop: Option<std::time::Instant>,
    lost: u64,
    last_note: Option<std::time::Instant>,
}

impl KeyQueue {
    pub fn new(gap: std::time::Duration) -> Self {
        Self {
            q: std::collections::VecDeque::new(),
            gap,
            last_pop: None,
            lost: 0,
            last_note: None,
        }
    }
    /// Queue a key tap or a piece of text. False when the queue was full (the op is counted as lost).
    pub fn push(&mut self, c: Cmd) -> bool {
        if self.q.len() < KEY_QUEUE_MAX {
            self.q.push_back(c);
            true
        } else {
            self.lost += 1;
            false
        }
    }
    /// The next op, if one is waiting and the gap since the last one has passed.
    pub fn pop_ready(&mut self, now: std::time::Instant) -> Option<Cmd> {
        if self.q.is_empty() {
            return None;
        }
        if self.last_pop.is_some_and(|t| now.duration_since(t) < self.gap) {
            return None;
        }
        self.last_pop = Some(now);
        self.q.pop_front()
    }
    pub fn is_empty(&self) -> bool {
        self.q.is_empty()
    }
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.q.len()
    }
    pub fn clear(&mut self) {
        self.q.clear();
    }
    /// `{"lost": n}` when ops were turned away since the last note and 100 ms have passed.
    pub fn lost_note(&mut self, now: std::time::Instant) -> Option<Value> {
        if self.lost == 0 {
            return None;
        }
        if self.last_note.is_some_and(|t| now.duration_since(t).as_millis() < LOST_GAP_MS) {
            return None;
        }
        self.last_note = Some(now);
        let n = self.lost;
        self.lost = 0;
        Some(json!({ "lost": n }))
    }
}

/// A key the phone holds down is let go by the server after this long, whatever the phone does. It
/// matches the page's own watchdog (120 s): the page covers a stalled finger, this covers a page
/// that stopped sending.
pub const HOLD_MAX_SECS: u64 = 120;

/// Tracks the one held key of a session (Right Alt) so the server can let it go on its own.
pub struct HoldGuard {
    since: Option<std::time::Instant>,
    cap: std::time::Duration,
}

impl Default for HoldGuard {
    fn default() -> Self {
        Self::with_cap(std::time::Duration::from_secs(HOLD_MAX_SECS))
    }
}

impl HoldGuard {
    pub fn with_cap(cap: std::time::Duration) -> Self {
        Self { since: None, cap }
    }
    /// Call for every command that reaches the agent. A second `down` does not restart the clock.
    pub fn observe(&mut self, c: &Cmd, now: std::time::Instant) {
        match c {
            Cmd::Hold(_, true) => {
                self.since.get_or_insert(now);
            }
            Cmd::Hold(_, false) | Cmd::Release => self.since = None,
            _ => {}
        }
    }
    /// True once, when the held key has been down for the cap; the guard is then clear.
    pub fn expired(&mut self, now: std::time::Instant) -> bool {
        match self.since {
            Some(t) if now.duration_since(t) >= self.cap => {
                self.since = None;
                true
            }
            _ => false,
        }
    }
}

/// Fixed argv for each target. The agent source is embedded in the binary.
pub fn agent_argv(target: &str) -> Option<Vec<String>> {
    match target {
        "mini" => Some(ssh(
            "mini",
            format!("/usr/bin/python3 -u -c {}", sh_quote(MAC_AGENT)),
        )),
        "Dell" => Some(ssh(
            "mesh",
            format!("/usr/bin/python3 -u -c {}", sh_quote(LINUX_AGENT)),
        )),
        "pc-desktop" => Some(vec![
            "/usr/bin/python3".into(),
            "-u".into(),
            "-c".into(),
            LINUX_AGENT.into(),
        ]),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_are_allowlisted() {
        assert!(valid_target("mini") && valid_target("pc-desktop") && valid_target("Dell"));
        assert!(!valid_target("evil") && !valid_target("") && !valid_target("MINI"));
    }

    #[test]
    fn move_is_parsed_and_clamped() {
        assert_eq!(
            parse(r#"{"op":"move","dx":3,"dy":-4}"#),
            Ok(Cmd::Move(3, -4))
        );
        assert_eq!(
            parse(r#"{"op":"move","dx":99999,"dy":-99999}"#),
            Ok(Cmd::Move(1500, -1500))
        );
        assert_eq!(
            parse(r#"{"op":"move","dx":2.7,"dy":-2.7}"#),
            Ok(Cmd::Move(3, -3))
        );
        assert!(parse(r#"{"op":"move","dx":"3","dy":1}"#).is_err());
        assert!(parse(r#"{"op":"move"}"#).is_err());
    }

    #[test]
    fn scroll_is_clamped() {
        assert_eq!(
            parse(r#"{"op":"scroll","dx":0,"dy":5000}"#),
            Ok(Cmd::Scroll(0, 600))
        );
    }

    #[test]
    fn click_and_button_allowlist() {
        assert_eq!(
            parse(r#"{"op":"click","b":"l","n":2}"#),
            Ok(Cmd::Click('l', 2, 1))
        );
        assert_eq!(
            parse(r#"{"op":"click","b":"r"}"#),
            Ok(Cmd::Click('r', 1, 1))
        );
        assert!(parse(r#"{"op":"click","b":"x"}"#).is_err());
        assert!(parse(r#"{"op":"click","b":"l","n":4}"#).is_err());
        assert_eq!(
            parse(r#"{"op":"button","b":"l","down":true}"#),
            Ok(Cmd::Button('l', true))
        );
        assert!(parse(r#"{"op":"button","b":"l"}"#).is_err());
    }

    #[test]
    fn key_allowlist_and_mods() {
        assert!(valid_key("a") && valid_key("z") && valid_key("0") && valid_key("f12"));
        assert!(
            valid_key("enter") && valid_key("pgdn") && valid_key("playpause") && valid_key("slash")
        );
        assert!(!valid_key("f13") && !valid_key("A") && !valid_key("rm -rf") && !valid_key(""));
        assert_eq!(
            parse(r#"{"op":"key","k":"z","mods":["cmd","shift","cmd"]}"#),
            Ok(Cmd::Key("z".into(), vec!["cmd".into(), "shift".into()]))
        );
        assert!(parse(r#"{"op":"key","k":"c","mods":["hyper"]}"#).is_err());
        assert!(parse(r#"{"op":"key","k":"nope"}"#).is_err());
        assert_eq!(
            parse(r#"{"op":"key","k":"print","mods":["super"]}"#),
            Ok(Cmd::Key("print".into(), vec!["super".into()]))
        );
        assert_eq!(
            parse(r#"{"op":"key","k":"v","mods":["super","ctrl"]}"#),
            Ok(Cmd::Key("v".into(), vec!["super".into(), "ctrl".into()]))
        );
        assert!(valid_mod("super") && valid_mod("cmd") && !valid_mod("hyper"));
        assert!(valid_key("print") && !valid_key("poweroff"));
    }

    #[test]
    fn function_and_media_pages_use_only_allowed_keys() {
        // every key the Pad's Function and Media pages send, each through the real parser
        let plain = [
            "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12", "home",
            "end", "pgup", "pgdn", "delete", "playpause", "next", "prev", "volup", "voldown",
            "mute", "ralt", "enter", "backspace", "tab", "esc",
        ];
        for k in plain {
            assert_eq!(
                parse(&format!(r#"{{"op":"key","k":"{k}","mods":[]}}"#)),
                Ok(Cmd::Key(k.into(), vec![])),
                "{k}"
            );
        }
        // the combos: Super+Space launcher, Super+W close, Ctrl+Shift+V terminal paste, Alt+Tab, Super+F4
        for (k, m) in [
            ("space", vec!["cmd"]),
            ("w", vec!["cmd"]),
            ("v", vec!["ctrl", "shift"]),
            ("tab", vec!["alt"]),
            ("f4", vec!["cmd"]),
            ("a", vec!["ctrl"]),
            ("z", vec!["ctrl", "shift"]),
        ] {
            let mods = serde_json::to_string(&m).unwrap_or_default();
            assert_eq!(
                parse(&format!(r#"{{"op":"key","k":"{k}","mods":{mods}}}"#)),
                Ok(Cmd::Key(k.into(), m.iter().map(|s| s.to_string()).collect())),
                "{k}"
            );
        }
        assert!(!valid_key("f13") && !valid_key("insert") && !valid_key("ctrl"));
    }

    #[test]
    fn right_alt_is_a_distinct_key_in_both_agents() {
        assert!(valid_key("ralt"));
        // Linux evdev: KEY_RIGHTALT 100, KEY_LEFTALT 56. macOS: right Option 61, left Option 58.
        assert!(LINUX_AGENT.contains(r#""ralt": 100"#) && LINUX_AGENT.contains(r#""alt": 56"#));
        assert!(MAC_AGENT.contains(r#""ralt": 61"#) && MAC_AGENT.contains(r#""alt": 58"#));
        // left alt is a modifier name only; it is not a key and cannot be held
        assert!(!valid_key("alt") && !valid_key("lalt"));
        assert_eq!(
            parse(r#"{"op":"key","k":"ralt","mods":["alt"]}"#),
            Ok(Cmd::Key("ralt".into(), vec!["alt".into()]))
        );
    }

    #[test]
    fn hold_op_is_limited_to_right_alt_and_releases_are_never_rate_limited() {
        assert_eq!(
            parse(r#"{"op":"hold","k":"ralt","down":true}"#),
            Ok(Cmd::Hold("ralt".into(), true))
        );
        assert_eq!(
            parse(r#"{"op":"hold","k":"ralt","down":false}"#),
            Ok(Cmd::Hold("ralt".into(), false))
        );
        for bad in [
            r#"{"op":"hold","k":"a","down":true}"#,
            r#"{"op":"hold","k":"alt","down":true}"#,
            r#"{"op":"hold","k":"ctrl","down":true}"#,
            r#"{"op":"hold","k":"volup","down":true}"#,
            r#"{"op":"hold","down":true}"#,
            r#"{"op":"hold","k":"ralt"}"#,
            r#"{"op":"hold","k":"ralt","down":"yes"}"#,
        ] {
            assert!(parse(bad).is_err(), "{bad}");
        }
        assert!(Cmd::Hold("ralt".into(), false).is_safety());
        assert!(!Cmd::Hold("ralt".into(), true).is_safety());
        let v: Value = serde_json::from_str(&Cmd::Hold("ralt".into(), true).line()).unwrap_or(Value::Null);
        assert_eq!(v, json!({"op":"hold","k":"ralt","down":true}));
        // a saturated limiter still lets the key up through
        let mut l = Limiter::new(1);
        let t0 = std::time::Instant::now();
        assert!(l.allow_cmd(&Cmd::Move(1, 1), t0));
        assert!(!l.allow_cmd(&Cmd::Hold("ralt".into(), true), t0));
        assert!(l.allow_cmd(&Cmd::Hold("ralt".into(), false), t0));
    }

    #[test]
    fn text_limits() {
        assert_eq!(
            parse(r#"{"op":"text","s":"hi there"}"#),
            Ok(Cmd::Text("hi there".into()))
        );
        assert_eq!(
            parse(r#"{"op":"text","s":"a\nb"}"#),
            Ok(Cmd::Text("a\nb".into()))
        );
        assert!(parse(r#"{"op":"text","s":""}"#).is_err());
        assert!(parse(r#"{"op":"text","s":"bell\u0007"}"#).is_err());
        let long = format!(r#"{{"op":"text","s":"{}"}}"#, "x".repeat(257));
        assert!(parse(&long).is_err());
    }

    #[test]
    fn junk_is_rejected() {
        assert!(parse("not json").is_err());
        assert!(parse(r#"{"op":"exec","cmd":"ls"}"#).is_err());
        assert!(parse(&"x".repeat(5000)).is_err());
        assert_eq!(parse(r#"{"op":"ping","id":7}"#), Ok(Cmd::Ping(7)));
        assert_eq!(parse(r#"{"op":"release"}"#), Ok(Cmd::Release));
    }

    #[test]
    fn line_is_canonical_json() {
        let v: Value = serde_json::from_str(&Cmd::Move(1, -2).line()).unwrap_or(Value::Null);
        assert_eq!(v, json!({"op":"move","dx":1,"dy":-2}));
        let v: Value = serde_json::from_str(&Cmd::Key("c".into(), vec!["cmd".into()]).line())
            .unwrap_or(Value::Null);
        assert_eq!(v, json!({"op":"key","k":"c","mods":["cmd"]}));
        assert!(!Cmd::Text("a\nb".into()).line().contains('\n'));
    }

    #[test]
    fn every_allowed_key_is_mapped_by_both_agents() {
        let mut all: Vec<String> = NAMED.iter().map(|s| s.to_string()).collect();
        all.extend(('a'..='z').map(|c| c.to_string()));
        all.extend(('0'..='9').map(|c| c.to_string()));
        all.extend((1..=12).map(|n| format!("f{n}")));
        for k in &all {
            assert!(valid_key(k), "{k} should be valid");
            let pat = format!("\"{k}\":");
            assert!(MAC_AGENT.contains(&pat), "mac agent missing {k}");
            assert!(LINUX_AGENT.contains(&pat), "linux agent missing {k}");
        }
    }

    #[test]
    fn origin_must_match_host() {
        assert!(origin_ok(None, Some("pc-desktop.example.ts.net:10443")));
        assert!(origin_ok(
            Some("https://pc-desktop.example.ts.net:10443"),
            Some("pc-desktop.example.ts.net:10443")
        ));
        assert!(origin_ok(
            Some("http://127.0.0.1:8796"),
            Some("127.0.0.1:8796")
        ));
        assert!(!origin_ok(
            Some("https://evil.example"),
            Some("127.0.0.1:8796")
        ));
        assert!(!origin_ok(
            Some("https://127.0.0.1:8796.evil"),
            Some("127.0.0.1:8796")
        ));
        assert!(!origin_ok(Some("null"), Some("127.0.0.1:8796")));
        assert!(!origin_ok(Some("https://a"), None));
    }

    #[test]
    fn limiter_caps_per_second() {
        let mut l = Limiter::new(5);
        let t0 = std::time::Instant::now();
        let ok = (0..8).filter(|_| l.allow(t0)).count();
        assert_eq!(ok, 5);
        assert!(l.allow(t0 + std::time::Duration::from_millis(1001)));
    }

    #[test]
    fn shell_quote_is_single_quoted() {
        assert_eq!(sh_quote("abc"), "'abc'");
        assert_eq!(sh_quote("it's"), r#"'it'"'"'s'"#);
    }

    #[test]
    fn agent_argv_is_fixed_per_target() {
        let m = agent_argv("mini").unwrap_or_default();
        assert_eq!(m[0], "ssh");
        assert!(
            m.iter().any(|i| i == "mini")
                && m.last()
                    .is_some_and(|c| c.starts_with("/usr/bin/python3 -u -c '"))
        );
        let d = agent_argv("Dell").unwrap_or_default();
        assert!(d.iter().any(|i| i == "mesh"));
        let l = agent_argv("pc-desktop").unwrap_or_default();
        assert_eq!(&l[..3], &["/usr/bin/python3", "-u", "-c"]);
        assert!(agent_argv("evil").is_none());
    }

    #[test]
    fn click_state_parses_defaults_and_rejects() {
        assert_eq!(
            parse(r#"{"op":"click","b":"l","n":1,"s":2}"#),
            Ok(Cmd::Click('l', 1, 2))
        );
        assert_eq!(
            parse(r#"{"op":"click","b":"l","s":3}"#),
            Ok(Cmd::Click('l', 1, 3))
        );
        assert_eq!(
            parse(r#"{"op":"click","b":"l"}"#),
            Ok(Cmd::Click('l', 1, 1))
        );
        for bad in ["0", "4", "256", "-1", "1.5", "\"2\"", "null"] {
            let j = format!(r#"{{"op":"click","b":"l","s":{bad}}}"#);
            assert_eq!(parse(&j), Err("bad click state"), "s={bad}");
        }
    }

    #[test]
    fn click_state_survives_reserialization() {
        let v: Value = serde_json::from_str(&Cmd::Click('l', 1, 2).line()).unwrap_or(Value::Null);
        assert_eq!(v, json!({"op":"click","b":"l","n":1,"s":2}));
        let c = parse(r#"{"op":"click","b":"r","n":2,"s":3}"#).unwrap_or(Cmd::Release);
        let v: Value = serde_json::from_str(&c.line()).unwrap_or(Value::Null);
        assert_eq!(v, json!({"op":"click","b":"r","n":2,"s":3}));
    }

    #[test]
    fn limiter_never_drops_safety_ops() {
        let mut l = Limiter::new(3);
        let t0 = std::time::Instant::now();
        let mv = Cmd::Move(1, 1);
        assert_eq!((0..10).filter(|_| l.allow_cmd(&mv, t0)).count(), 3);
        // window is full: the ops that let something go still pass
        assert!(l.allow_cmd(&Cmd::Release, t0));
        assert!(l.allow_cmd(&Cmd::Button('l', false), t0));
        assert!(l.allow_cmd(&Cmd::Hold("ralt".into(), false), t0));
        // press, scroll, click and ping stay limited
        assert!(!l.allow_cmd(&Cmd::Button('l', true), t0));
        assert!(!l.allow_cmd(&Cmd::Scroll(0, 1), t0));
        assert!(!l.allow_cmd(&Cmd::Click('l', 1, 1), t0));
        assert!(!l.allow_cmd(&Cmd::Ping(1), t0));
        // safety ops do not eat the budget of the next window
        assert!(l.allow_cmd(&mv, t0 + std::time::Duration::from_millis(1001)));
    }

    #[test]
    fn f_keys_are_digits_only() {
        for ok in ["f1", "f9", "f10", "f12"] {
            assert!(valid_key(ok), "{ok}");
        }
        for bad in ["f+5", "f+1", "f 5", "f-1", "f05", "f0", "f13", "ff", "f1 ", "f\u{0661}", "f+12"] {
            assert!(!valid_key(bad), "{bad:?}");
            assert!(parse(&format!(r#"{{"op":"key","k":"{bad}"}}"#)).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn super_keys_are_the_documented_set() {
        // the Pad's own Super combinations on Linux and macOS, plus what Hyprland binds to Super (Enter, arrows, digits, F)
        let mut allowed: Vec<&str> = vec!["c", "v", "x", "z", "a", "w", "f", "space", "tab", "f4", "enter", "up", "down", "left", "right"];
        allowed.extend(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
        assert_eq!(allowed.len(), SUPER_KEYS.len());
        for k in &allowed {
            assert!(SUPER_KEYS.contains(k), "{k}");
            assert!(parse(&format!(r#"{{"op":"key","k":"{k}","mods":["cmd"]}}"#)).is_ok(), "{k}");
            assert!(parse(&format!(r#"{{"op":"key","k":"{k}","mods":["shift","cmd"]}}"#)).is_ok(), "shift {k}");
        }
        for (k, m) in [("z", vec!["shift", "cmd"]), ("v", vec!["cmd", "shift"]), ("c", vec!["cmd", "ctrl"]), ("w", vec!["cmd", "ctrl"]), ("z", vec!["cmd", "shift", "alt"]), ("space", vec!["cmd", "alt"])] {
            let mods = serde_json::to_string(&m).unwrap_or_default();
            assert!(parse(&format!(r#"{{"op":"key","k":"{k}","mods":{mods}}}"#)).is_ok(), "{k} {m:?}");
        }
        // a Super on any other key is refused by the server
        for k in ["q", "l", "e", "m", "delete", "backspace", "esc", "f5", "f12", "home", "pgdn", "volup", "mute", "capslock", "ralt", "minus", "slash"] {
            for m in [r#"["cmd"]"#, r#"["cmd","shift"]"#, r#"["ctrl","cmd"]"#] {
                assert_eq!(parse(&format!(r#"{{"op":"key","k":"{k}","mods":{m}}}"#)), Err("bad combo"), "{k} {m}");
            }
        }
        // without Super nothing changes
        assert!(parse(r#"{"op":"key","k":"q","mods":["ctrl","alt","shift"]}"#).is_ok());
        assert!(super_combo_ok("q", &[]));
    }

    #[test]
    fn key_taps_and_text_are_queued_not_limited() {
        for c in [Cmd::Key("a".into(), vec![]), Cmd::Key("c".into(), vec!["cmd".into()]), Cmd::Text("hi".into())] {
            assert!(is_queued(&c), "{c:?}");
            assert!(!c.is_safety(), "{c:?}");
        }
        for c in [Cmd::Move(1, 1), Cmd::Scroll(0, 1), Cmd::Click('l', 1, 1), Cmd::Button('l', true), Cmd::Button('l', false), Cmd::Ping(1), Cmd::Release, Cmd::Hold("ralt".into(), true), Cmd::Hold("ralt".into(), false)] {
            assert!(!is_queued(&c), "{c:?}");
        }
    }

    #[test]
    fn the_key_queue_keeps_order_and_never_hands_out_more_than_30_a_second() {
        use std::time::{Duration, Instant};
        let t0 = Instant::now();
        let gap = Duration::from_millis(KEY_GAP_MS);
        let mut q = KeyQueue::new(gap);
        assert_eq!(q.pop_ready(t0), None, "nothing waiting");
        // a burst far above any rate goes in at once: letters and typed text mixed, in arrival order
        let ops: Vec<Cmd> = (0..200).map(|i| if i % 7 == 3 { Cmd::Text(format!("t{i}")) } else { Cmd::Key(char::from(b'a' + (i % 26) as u8).to_string(), vec![]) }).collect();
        for c in &ops { assert!(q.push(c.clone())); }
        assert_eq!(q.len(), 200);
        // the first leaves at once, the rest one gap apart: never two inside a gap
        let mut out = Vec::new();
        let mut times = Vec::new();
        let mut ms = 0u64;
        while out.len() < 200 {
            let now = t0 + Duration::from_millis(ms);
            if let Some(c) = q.pop_ready(now) { out.push(c); times.push(ms); }
            ms += 1;
            assert!(ms < 20_000);
        }
        assert_eq!(out, ops, "order preserved, nothing dropped, text and keys interleaved as sent");
        assert_eq!(times[0], 0);
        assert!(times.windows(2).all(|w| w[1] - w[0] >= KEY_GAP_MS), "two ops inside one gap");
        // so any second holds at most 30 of them
        let worst = times.iter().map(|t| times.iter().filter(|u| **u >= *t && **u < *t + 1000).count()).max().unwrap_or(0);
        assert!(worst <= 30, "worst second {worst}");
        assert!(q.is_empty());
        assert_eq!(KEY_GAP_MS, 34);
    }

    #[test]
    fn the_key_queue_is_bounded_and_says_how_many_it_turned_away() {
        use std::time::{Duration, Instant};
        let t0 = Instant::now();
        let mut q = KeyQueue::new(Duration::from_millis(KEY_GAP_MS));
        assert_eq!(q.lost_note(t0), None);
        for i in 0..KEY_QUEUE_MAX + 40 {
            let kept = q.push(Cmd::Key("a".into(), vec![]));
            assert_eq!(kept, i < KEY_QUEUE_MAX, "op {i}");
        }
        assert_eq!(q.len(), KEY_QUEUE_MAX);
        assert_eq!(q.lost_note(t0), Some(json!({"lost": 40})));
        assert_eq!(q.lost_note(t0 + Duration::from_secs(5)), None, "said once");
        // at most ten notes a second
        for _ in 0..3 { q.push(Cmd::Key("a".into(), vec![])); }
        assert_eq!(q.lost_note(t0 + Duration::from_millis(50)), None, "inside the 100 ms gap it waits");
        assert_eq!(q.lost_note(t0 + Duration::from_millis(100)), Some(json!({"lost": 3})));
        // clearing the queue (session end, release) forgets what is waiting
        q.clear();
        assert!(q.is_empty());
        assert_eq!(q.pop_ready(t0 + Duration::from_secs(9)), None);
    }

    #[test]
    fn limiter_does_not_count_queued_ops() {
        // the limiter keeps its old job for moves, scrolls, clicks and pings; key taps never reach it
        let mut l = Limiter::new(3);
        let t0 = std::time::Instant::now();
        assert_eq!((0..10).filter(|_| l.allow_cmd(&Cmd::Move(1, 1), t0)).count(), 3);
        assert!(!l.allow_cmd(&Cmd::Ping(1), t0));
        assert!(l.allow_cmd(&Cmd::Release, t0));
    }

    #[test]
    fn a_held_key_is_let_go_by_the_server_after_the_cap() {
        use std::time::{Duration, Instant};
        let t0 = Instant::now();
        let down = Cmd::Hold("ralt".into(), true);
        let up = Cmd::Hold("ralt".into(), false);
        let mut g = HoldGuard::default();
        // nothing held: never expires
        assert!(!g.expired(t0 + Duration::from_secs(10_000)));
        g.observe(&down, t0);
        assert!(!g.expired(t0 + Duration::from_secs(HOLD_MAX_SECS - 1)));
        // a repeated down does not restart the clock
        g.observe(&down, t0 + Duration::from_secs(100));
        assert!(g.expired(t0 + Duration::from_secs(HOLD_MAX_SECS)));
        // it fires once, then the guard is clear
        assert!(!g.expired(t0 + Duration::from_secs(HOLD_MAX_SECS + 5)));
        // a normal release, or a release-all, clears it
        g.observe(&down, t0);
        g.observe(&up, t0 + Duration::from_secs(3));
        assert!(!g.expired(t0 + Duration::from_secs(500)));
        g.observe(&down, t0);
        g.observe(&Cmd::Release, t0 + Duration::from_secs(3));
        assert!(!g.expired(t0 + Duration::from_secs(500)));
        // other commands never start it
        g.observe(&Cmd::Key("a".into(), vec![]), t0);
        g.observe(&Cmd::Move(1, 1), t0);
        assert!(!g.expired(t0 + Duration::from_secs(500)));
        assert_eq!(HOLD_MAX_SECS, 120);
    }

    #[test]
    fn csrf_guard_rules() {
        let host = Some("127.0.0.1:8796");
        let same = Some("http://127.0.0.1:8796");
        // plain GET (not a bootstrap): never judged, so cross-origin cam viewers keep working
        assert!(csrf_ok(
            false,
            false,
            Some("http://127.0.0.1:8123"),
            host,
            None
        ));
        assert!(csrf_ok(false, false, None, host, Some("cross-site")));
        // ?t= bootstrap: Origin must match when present; a cross-site link without Origin passes
        assert!(csrf_ok(false, true, None, host, Some("cross-site")));
        assert!(csrf_ok(false, true, same, host, Some("same-origin")));
        assert!(!csrf_ok(
            false,
            true,
            Some("http://127.0.0.1:8123"),
            host,
            None
        ));
        // state-changing: Origin must match when present, cross-site always refused
        assert!(csrf_ok(true, false, None, host, None));
        assert!(csrf_ok(true, false, None, host, Some("none")));
        assert!(csrf_ok(true, false, same, host, Some("same-origin")));
        assert!(!csrf_ok(
            true,
            false,
            Some("http://evil.example"),
            host,
            None
        ));
        assert!(!csrf_ok(
            true,
            false,
            Some("http://127.0.0.1:8123"),
            host,
            Some("same-site")
        ));
        assert!(!csrf_ok(true, false, None, host, Some("cross-site")));
        assert!(!csrf_ok(true, false, same, host, Some("cross-site")));
        assert!(!csrf_ok(true, false, Some("null"), host, None));
    }
}
