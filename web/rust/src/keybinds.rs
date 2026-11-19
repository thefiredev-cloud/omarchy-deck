//! Read-only Omarchy keybinds for the Pad page.
//!
//! pc-desktop and Dell run one fixed shell script (`BINDS_SCRIPT`): it finds the live Hyprland
//! instance the way `helper.py` does, then execs `hyprctl binds -j`. Dell runs it over the same
//! ssh route as other host actions (`ssh mesh`), where a non-login shell has no instance
//! signature. Mini never runs a command; it gets a curated macOS set. Client text is not
//! accepted: the target is an allowlist and the argv is a constant.
//!
//! Owner clipboard rule (Omarchy): copy, paste and paste-plain are Ctrl+C, Ctrl+V and
//! Ctrl+Shift+V. Super+C, Super+V and Super+X must not be returned. `cmd` is the wire
//! name for Super on Linux, so a cmd-only C/V/X chord is the same forbidden bind.

use crate::util;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Instant;
use tokio::sync::Mutex;

pub const GROUPS: [&str; 9] = [
    "Workspaces",
    "Windows",
    "Apps",
    "Launchers/menus",
    "System",
    "Media",
    "Screenshots",
    "Clipboard",
    "Other",
];

const CACHE_SECS: u64 = 60;
const SHIFT: u64 = 1;
const CTRL: u64 = 4;
const ALT: u64 = 8;
const SUPER: u64 = 64;
const KNOWN: u64 = SHIFT | CTRL | ALT | SUPER;

pub struct Cache {
    inner: Mutex<HashMap<String, (Instant, Value)>>,
}

impl Cache {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    pub async fn get(&self, target: &str) -> Value {
        {
            let g = self.inner.lock().await;
            if let Some((at, v)) = g.get(target) {
                if at.elapsed().as_secs() < CACHE_SECS {
                    return v.clone();
                }
            }
        }
        let v = load(target).await;
        if v.get("error").is_none() {
            let mut g = self.inner.lock().await;
            g.insert(target.to_string(), (Instant::now(), v.clone()));
        }
        v
    }
}

/// Exit code of `BINDS_SCRIPT` when no live Hyprland instance exists (asleep, logged out, crashed).
pub const NO_HYPRLAND: i32 = 3;

/// Finds the Hyprland instance and runs `hyprctl binds -j`. Same discovery as `helper.py`: keep the
/// inherited signature while its socket is live, else take the newest `$XDG_RUNTIME_DIR/hypr/*`
/// directory that holds a live `.socket.sock`. No live instance exits `NO_HYPRLAND`.
/// No single quotes: Dell wraps it in one single-quoted `sh -c` argument for the remote shell.
pub const BINDS_SCRIPT: &str = concat!(
    "export XDG_RUNTIME_DIR=\"${XDG_RUNTIME_DIR:-/run/user/$(id -u)}\"; ",
    "r=\"$XDG_RUNTIME_DIR/hypr\"; s=\"${HYPRLAND_INSTANCE_SIGNATURE:-}\"; ",
    "if [ -z \"$s\" ] || [ ! -S \"$r/$s/.socket.sock\" ]; then s=; ",
    "for d in $(ls -td -- \"$r\"/*/ 2>/dev/null); do ",
    "if [ -S \"$d.socket.sock\" ]; then s=\"${d%/}\"; s=\"${s##*/}\"; break; fi; done; fi; ",
    "[ -n \"$s\" ] || exit 3; ",
    "export HYPRLAND_INSTANCE_SIGNATURE=\"$s\"; ",
    "exec hyprctl binds -j",
);

/// Fixed argv. `None` for Mini and for anything that is not an allowlisted target.
pub fn binds_argv(target: &str) -> Option<Vec<String>> {
    match target {
        "pc-desktop" => Some(vec!["/bin/sh".into(), "-c".into(), BINDS_SCRIPT.into()]),
        "Dell" => Some(vec![
            "ssh".into(),
            "-o".into(),
            "BatchMode=yes".into(),
            "-o".into(),
            "ConnectTimeout=5".into(),
            "-o".into(),
            "ControlMaster=auto".into(),
            "-o".into(),
            "ControlPath=/tmp/pixel-deck-%C".into(),
            "-o".into(),
            "ControlPersist=60".into(),
            "mesh".into(),
            // ssh joins its command words for the remote shell, so the script travels as one quoted word
            format!("sh -c '{BINDS_SCRIPT}'"),
        ]),
        _ => None,
    }
}

/// What the page says when the binds could not be read. A sleeping Dell (no route, ssh timeout or
/// ssh's own 255) and a missing Hyprland instance are the same fact to the owner.
pub fn asleep_error(target: &str) -> &'static str {
    if target == "Dell" {
        "Dell asleep or Hyprland not running"
    } else {
        "Hyprland not running"
    }
}

/// Map one run of the fixed argv to the payload. `Err` is a timeout or a spawn failure.
pub fn outcome(target: &str, res: Result<(i32, String), String>) -> Value {
    match res {
        Ok((0, out)) => match serde_json::from_str::<Value>(&out) {
            Ok(v) if v.is_array() => payload(target, shape_binds(&v, true), None),
            _ => payload(target, vec![], Some("bad binds")),
        },
        Ok((NO_HYPRLAND, _)) => payload(target, vec![], Some(asleep_error(target))),
        Ok((255, _)) if target == "Dell" => payload(target, vec![], Some(asleep_error(target))),
        Ok(_) => payload(target, vec![], Some("failed")),
        Err(e) if e == "timeout" && target == "Dell" => {
            payload(target, vec![], Some(asleep_error(target)))
        }
        Err(_) => payload(target, vec![], Some("unreachable")),
    }
}

pub fn timeout_secs(target: &str) -> u64 {
    match target {
        "Dell" => 8,
        "pc-desktop" => 3,
        _ => 1,
    }
}

fn os_of(target: &str) -> &'static str {
    if target == "mini" {
        "macos"
    } else {
        "linux"
    }
}

fn payload(target: &str, binds: Vec<Value>, err: Option<&str>) -> Value {
    let mut v = json!({
        "target": target,
        "os": os_of(target),
        "groups": GROUPS,
        "binds": binds,
    });
    if let Some(e) = err {
        if let Some(o) = v.as_object_mut() {
            o.insert("error".into(), json!(e));
        }
    }
    v
}

async fn load(target: &str) -> Value {
    if !crate::pad::valid_target(target) {
        return payload(target, vec![], Some("bad target"));
    }
    if target == "mini" {
        return payload(target, mac_binds(), None);
    }
    let Some(argv) = binds_argv(target) else {
        return payload(target, vec![], Some("bad target"));
    };
    let refs: Vec<&str> = argv.iter().map(String::as_str).collect();
    outcome(target, util::run(&refs, None, timeout_secs(target), &[]).await)
}

pub fn mac_binds() -> Vec<Value> {
    let rows = [
        ("Mission Control", &["ctrl"][..], "up", "Workspaces", false),
        ("Next space", &["ctrl"][..], "right", "Workspaces", false),
        ("Previous space", &["ctrl"][..], "left", "Workspaces", false),
        ("Close window", &["cmd"][..], "w", "Windows", false),
        ("Switch window", &["cmd"][..], "tab", "Windows", false),
        ("Hide window", &["cmd"][..], "h", "Windows", false),
        ("Minimize", &["cmd"][..], "m", "Windows", false),
        ("Cycle windows", &["cmd"][..], "grave", "Windows", false),
        ("Spotlight", &["cmd"][..], "space", "Launchers/menus", false),
        ("Lock screen", &["ctrl", "cmd"][..], "q", "System", false),
        ("Log out", &["cmd", "shift"][..], "q", "System", true),
        ("Volume up", &[][..], "volup", "Media", false),
        ("Volume down", &[][..], "voldown", "Media", false),
        ("Mute", &[][..], "mute", "Media", false),
        ("Play", &[][..], "playpause", "Media", false),
        ("Next track", &[][..], "next", "Media", false),
        ("Previous track", &[][..], "prev", "Media", false),
        (
            "Screenshot",
            &["cmd", "shift"][..],
            "3",
            "Screenshots",
            false,
        ),
        (
            "Screenshot selection",
            &["cmd", "shift"][..],
            "4",
            "Screenshots",
            false,
        ),
        (
            "Screenshot options",
            &["cmd", "shift"][..],
            "5",
            "Screenshots",
            false,
        ),
        ("Copy", &["cmd"][..], "c", "Clipboard", false),
        ("Paste", &["cmd"][..], "v", "Clipboard", false),
        ("Cut", &["cmd"][..], "x", "Clipboard", false),
        (
            "Paste plain",
            &["cmd", "shift"][..],
            "v",
            "Clipboard",
            false,
        ),
        ("Force quit", &["cmd", "alt"][..], "esc", "Other", false),
    ];
    rows.iter()
        .map(|(label, mods, key, group, confirm)| row(label, mods, key, group, *confirm))
        .collect()
}

fn row(label: &str, mods: &[&str], key: &str, group: &str, confirm: bool) -> Value {
    json!({
        "label": label,
        "modifiers": mods,
        "key": key,
        "group": group,
        "confirm": confirm,
    })
}

/// Shape one `hyprctl binds -j` array. `linux` turns on the Omarchy clipboard rule
/// and injects Ctrl clipboard chords. Mouse, empty, submap, release and unknown
/// modifier bits are dropped. Dangerous binds stay only when the label names the
/// action, and then only with `confirm` so the UI can require a press-and-hold.
pub fn shape_binds(raw: &Value, linux: bool) -> Vec<Value> {
    let Some(arr) = raw.as_array() else {
        return if linux { clipboard_rows() } else { vec![] };
    };
    let mut out: Vec<Value> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for b in arr {
        let Some(shaped) = shape_one(b, linux) else {
            continue;
        };
        let id = bind_id(&shaped);
        if seen.iter().any(|s| s == &id) {
            continue;
        }
        seen.push(id);
        out.push(shaped);
        if out.len() >= 400 {
            break;
        }
    }
    if linux {
        for c in clipboard_rows() {
            let id = bind_id(&c);
            if !seen.iter().any(|s| s == &id) {
                seen.push(id);
                out.push(c);
            }
        }
    }
    out.sort_by(|a, b| {
        let ga = group_index(a.get("group").and_then(Value::as_str).unwrap_or(""));
        let gb = group_index(b.get("group").and_then(Value::as_str).unwrap_or(""));
        let la = a.get("label").and_then(Value::as_str).unwrap_or("");
        let lb = b.get("label").and_then(Value::as_str).unwrap_or("");
        ga.cmp(&gb)
            .then_with(|| la.to_lowercase().cmp(&lb.to_lowercase()))
    });
    out
}

fn bind_id(v: &Value) -> String {
    let mods = v
        .get("modifiers")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join("+")
        })
        .unwrap_or_default();
    let key = v.get("key").and_then(Value::as_str).unwrap_or("");
    if mods.is_empty() {
        key.to_string()
    } else {
        format!("{mods}:{key}")
    }
}

fn group_index(g: &str) -> usize {
    GROUPS.iter().position(|x| *x == g).unwrap_or(GROUPS.len())
}

fn clipboard_rows() -> Vec<Value> {
    vec![
        row("Copy", &["ctrl"], "c", "Clipboard", false),
        row("Paste", &["ctrl"], "v", "Clipboard", false),
        row("Paste plain", &["ctrl", "shift"], "v", "Clipboard", false),
    ]
}

fn shape_one(b: &Value, linux: bool) -> Option<Value> {
    if b.get("mouse").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    if b.get("release").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    if b.get("longPress").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let sub = b.get("submap").and_then(Value::as_str).unwrap_or("");
    if !sub.is_empty() {
        return None;
    }
    let desc = b.get("description").and_then(Value::as_str).unwrap_or("");
    let reported = b.get("key").and_then(Value::as_str).unwrap_or("");
    // Omarchy binds digits, -, =, [ and ] by keycode; hyprctl then reports an empty key. Same recovery as keys_from_hypr.py.
    let raw_key = if reported.is_empty() { keycode_key(desc).unwrap_or("") } else { reported };
    if raw_key.is_empty() || raw_key.starts_with("mouse") || raw_key.starts_with("switch:") {
        return None;
    }
    if desc.to_ascii_lowercase().contains("g502") {
        return None;
    }
    let mask = b.get("modmask").and_then(Value::as_u64).unwrap_or(0);
    if mask & !KNOWN != 0 {
        return None;
    }
    let mods = mods_from(mask);
    let key = map_key(raw_key)?;
    if linux && blocked_clipboard(&mods, &key) {
        return None;
    }
    if !crate::pad::valid_key(&key) {
        return None;
    }
    for m in &mods {
        if !crate::pad::valid_mod(m) {
            return None;
        }
    }
    let dangerous = is_dangerous(desc, raw_key);
    let label = clean_label(desc);
    let label = if label.is_empty() {
        if dangerous {
            return None;
        }
        fallback_label(&mods, &key)
    } else {
        label
    };
    if dangerous && !clearly_labelled(&label) {
        return None;
    }
    let group = if dangerous {
        "System"
    } else {
        group_of(&label)
    };
    Some(row(
        &label,
        &mods.iter().map(String::as_str).collect::<Vec<_>>(),
        &key,
        group,
        dangerous,
    ))
}

/// The key behind a keycode bind, from its Omarchy description (`/usr/share/omarchy/default/hypr/bindings/*.lua`).
/// None when the description does not name it.
fn keycode_key(desc: &str) -> Option<&'static str> {
    const DIGITS: [&str; 10] = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    let d = desc.trim().to_ascii_lowercase();
    for lead in ["workspace ", "group window ", "bar panel "] {
        if let Some(i) = d.rfind(lead) {
            if let Ok(n) = d[i + lead.len()..].parse::<u32>() {
                return Some(DIGITS[(n % 10) as usize]);
            }
        }
    }
    if d.starts_with("expand window left") || d.starts_with("shrink window up") {
        return Some("MINUS");
    }
    if d.starts_with("shrink window left") || d.starts_with("expand window down") {
        return Some("EQUAL");
    }
    match d.as_str() {
        "make webcam overlay smaller" => Some("BRACKETLEFT"),
        "make webcam overlay larger" => Some("BRACKETRIGHT"),
        _ => None,
    }
}

fn mods_from(mask: u64) -> Vec<String> {
    let mut m = Vec::new();
    if mask & SUPER != 0 {
        m.push("super".into());
    }
    if mask & CTRL != 0 {
        m.push("ctrl".into());
    }
    if mask & ALT != 0 {
        m.push("alt".into());
    }
    if mask & SHIFT != 0 {
        m.push("shift".into());
    }
    m
}

/// Super-only or cmd-only C, V or X. That is Omarchy's stock universal clipboard chord.
pub fn blocked_clipboard(mods: &[String], key: &str) -> bool {
    let only = mods.len() == 1 && (mods[0] == "super" || mods[0] == "cmd");
    only && matches!(key, "c" | "v" | "x")
}

fn map_key(raw: &str) -> Option<String> {
    let named = match raw {
        "RETURN" | "return" | "Return" => "enter",
        "ESCAPE" | "ESC" | "escape" | "Escape" => "esc",
        "TAB" | "tab" | "Tab" => "tab",
        "SPACE" | "space" | "Space" => "space",
        "BACKSPACE" | "backspace" | "BackSpace" => "backspace",
        "DELETE" | "Delete" | "delete" => "delete",
        "HOME" | "Home" | "home" => "home",
        "END" | "End" | "end" => "end",
        "PRIOR" | "PGUP" | "Page_Up" | "pgup" => "pgup",
        "NEXT" | "PGDN" | "Page_Down" | "pgdn" => "pgdn",
        "LEFT" | "left" | "Left" => "left",
        "RIGHT" | "right" | "Right" => "right",
        "UP" | "up" | "Up" => "up",
        "DOWN" | "down" | "Down" => "down",
        "PERIOD" | "period" | "Period" => "period",
        "COMMA" | "comma" | "Comma" => "comma",
        "SLASH" | "slash" | "Slash" => "slash",
        "MINUS" | "minus" | "Minus" => "minus",
        "EQUAL" | "equal" | "Equal" => "equal",
        "GRAVE" | "grave" | "Grave" => "grave",
        "BRACKETLEFT" | "bracketleft" => "lbracket",
        "BRACKETRIGHT" | "bracketright" => "rbracket",
        "BACKSLASH" | "backslash" => "backslash",
        "SEMICOLON" | "semicolon" => "semicolon",
        "APOSTROPHE" | "apostrophe" => "quote",
        "PRINT" | "Print" | "SYSRQ" | "print" => "print",
        "XF86AudioRaiseVolume" => "volup",
        "XF86AudioLowerVolume" => "voldown",
        "XF86AudioMute" => "mute",
        "XF86AudioPlay" | "XF86AudioPause" => "playpause",
        "XF86AudioNext" => "next",
        "XF86AudioPrev" => "prev",
        _ => "",
    };
    if !named.is_empty() {
        return Some(named.to_string());
    }
    if raw.len() >= 2 && (raw.starts_with('F') || raw.starts_with('f')) {
        let n = &raw[1..];
        if !n.starts_with('0') {
            if let Ok(num) = n.parse::<u8>() {
                if (1..=12).contains(&num) {
                    return Some(format!("f{num}"));
                }
            }
        }
    }
    let mut chars = raw.chars();
    let c = chars.next()?;
    if chars.next().is_none() && c.is_ascii_alphanumeric() {
        return Some(c.to_ascii_lowercase().to_string());
    }
    None
}

fn clean_label(s: &str) -> String {
    let mut out = String::new();
    for ch in s.chars() {
        if ch.is_control() {
            continue;
        }
        if ch == ' ' && out.ends_with(' ') {
            continue;
        }
        out.push(ch);
        if out.chars().count() >= 80 {
            break;
        }
    }
    out.trim().to_string()
}

fn fallback_label(mods: &[String], key: &str) -> String {
    let mut parts: Vec<String> = mods.iter().map(|m| mod_title(m)).collect();
    parts.push(key.to_string());
    parts.join("+")
}

fn mod_title(m: &str) -> String {
    match m {
        "super" => "Super".into(),
        "ctrl" => "Ctrl".into(),
        "alt" => "Alt".into(),
        "shift" => "Shift".into(),
        "cmd" => "Cmd".into(),
        _ => m.to_string(),
    }
}

fn has_word(hay: &str, word: &str) -> bool {
    hay.split(|c: char| !c.is_ascii_alphanumeric())
        .any(|t| t == word)
}

fn has_phrase(hay: &str, phrase: &str) -> bool {
    hay.contains(phrase)
}

pub fn is_dangerous(label: &str, raw_key: &str) -> bool {
    let s = label.to_ascii_lowercase();
    let k = raw_key.to_ascii_lowercase();
    k == "xf86poweroff"
        || has_word(&s, "reboot")
        || has_word(&s, "logout")
        || has_word(&s, "shutdown")
        || has_word(&s, "poweroff")
        || has_word(&s, "kill")
        || has_word(&s, "power")
        || has_phrase(&s, "log out")
        || has_phrase(&s, "shut down")
        || has_phrase(&s, "power off")
}

fn clearly_labelled(label: &str) -> bool {
    is_dangerous(label, "")
}

pub fn group_of(label: &str) -> &'static str {
    let s = label.to_ascii_lowercase();
    let has = |w: &str| s.contains(w);
    if has("screenshot")
        || has("screen record")
        || has("screenrecord")
        || has("ocr")
        || has("color picker")
        || has("capture")
    {
        return "Screenshots";
    }
    if has("clipboard") || has("copy") || has("paste") || has_word(&s, "cut") {
        return "Clipboard";
    }
    if has("volume")
        || has("mute")
        || has("brightness")
        || has("track")
        || has("pause")
        || has("music")
        || has("spotify")
        || has("media")
        || has("microphone")
        || has("audio")
        || has_word(&s, "play")
    {
        return "Media";
    }
    if has("workspace") || has("spaceview") || has("overview") {
        return "Workspaces";
    }
    if has("window")
        || has("focus")
        || has("split")
        || has("float")
        || has("full screen")
        || has("fullscreen")
        || has("scratchpad")
        || has("monitor")
        || has("gap")
        || has("transparency")
        || has("tiling")
        || has("swap")
        || has("grouping")
        || has("group")
    {
        return "Windows";
    }
    if has("menu") || has("launcher") || has("app grid") || has("spotlight") || has("switcher") {
        return "Launchers/menus";
    }
    if has("lock")
        || has("idle")
        || has("theme")
        || has("wallpaper")
        || has("notification")
        || has("dictation")
        || has("voxtype")
        || has("voice")
        || has("scale")
        || has("backlight")
        || has("touchpad")
        || has("night")
    {
        return "System";
    }
    if has("terminal")
        || has("browser")
        || has("email")
        || has("calculator")
        || has("herdr")
        || has("tmux")
        || has("whatsapp")
        || has("obsidian")
        || has("calendar")
        || has("photo")
        || has("atlas")
        || has("mail")
        || s == "x"
        || s == "x post"
    {
        return "Apps";
    }
    "Other"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shaped(raw: &str) -> Vec<Value> {
        let v: Value = serde_json::from_str(raw).unwrap_or(Value::Null);
        shape_binds(&v, true)
    }

    fn by_label<'a>(rows: &'a [Value], label: &str) -> Option<&'a Value> {
        rows.iter()
            .find(|r| r.get("label").and_then(Value::as_str) == Some(label))
    }

    fn mods_of(v: &Value) -> Vec<String> {
        v.get("modifiers")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn argv_is_fixed_and_takes_no_client_text() {
        assert!(binds_argv("mini").is_none());
        assert!(binds_argv("evil").is_none());
        assert!(binds_argv("pc-desktop;rm -rf").is_none());
        assert_eq!(
            binds_argv("pc-desktop").as_deref(),
            Some(&["/bin/sh".to_string(), "-c".into(), BINDS_SCRIPT.into()][..])
        );
        let dell = binds_argv("Dell").unwrap_or_default();
        assert_eq!(dell.first().map(String::as_str), Some("ssh"));
        assert_eq!(dell.get(dell.len().saturating_sub(2)).map(String::as_str), Some("mesh"));
        assert_eq!(dell.last().cloned(), Some(format!("sh -c '{BINDS_SCRIPT}'")));
        // the remote word must stay one single-quoted word: the script itself carries no single quote
        assert!(!BINDS_SCRIPT.contains('\''));
        assert!(BINDS_SCRIPT.ends_with("exec hyprctl binds -j"));
        assert!(BINDS_SCRIPT.contains("exit 3") && NO_HYPRLAND == 3);
        assert!(!dell.iter().any(|s| s.contains("rm ")));
        assert_eq!(timeout_secs("pc-desktop"), 3);
        assert_eq!(timeout_secs("Dell"), 8);
    }

    #[test]
    fn asleep_dell_and_missing_hyprland_say_so_instead_of_failed() {
        let err = |t: &str, r: Result<(i32, String), String>| {
            outcome(t, r)["error"].as_str().unwrap_or("").to_string()
        };
        let asleep = "Dell asleep or Hyprland not running";
        assert_eq!(err("Dell", Ok((3, String::new()))), asleep);
        assert_eq!(err("Dell", Ok((255, String::new()))), asleep);
        assert_eq!(err("Dell", Err("timeout".into())), asleep);
        assert_eq!(err("pc-desktop", Ok((3, String::new()))), "Hyprland not running");
        assert_eq!(err("pc-desktop", Ok((255, String::new()))), "failed");
        assert_eq!(err("Dell", Ok((1, String::new()))), "failed");
        assert_eq!(err("Dell", Err("spawn: no ssh".into())), "unreachable");
        assert_eq!(err("Dell", Ok((0, "not json".into()))), "bad binds");
        let ok = outcome(
            "Dell",
            Ok((0, r#"[{"modmask":64,"key":"W","mouse":false,"description":"Close window","submap":""}]"#.into())),
        );
        assert!(ok.get("error").is_none(), "{ok}");
        assert!(by_label(ok["binds"].as_array().map(Vec::as_slice).unwrap_or(&[]), "Close window").is_some());
    }

    /// A throwaway `$XDG_RUNTIME_DIR` plus a fake `hyprctl` that prints the signature it was given.
    struct Runtime(std::path::PathBuf, Vec<std::os::unix::net::UnixListener>);

    impl Runtime {
        fn new() -> Self {
            use std::sync::atomic::{AtomicUsize, Ordering};
            static N: AtomicUsize = AtomicUsize::new(0);
            let dir = std::env::temp_dir()
                .join(format!("pdk-binds-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
            let _ = std::fs::remove_dir_all(&dir);
            let bin = dir.join("bin");
            assert!(std::fs::create_dir_all(&bin).is_ok());
            let fake = bin.join("hyprctl");
            assert!(std::fs::write(&fake, "#!/bin/sh\necho \"$HYPRLAND_INSTANCE_SIGNATURE $*\"\n").is_ok());
            use std::os::unix::fs::PermissionsExt;
            assert!(std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).is_ok());
            Self(dir, vec![])
        }

        /// One instance directory, `age_s` seconds old, with a live socket when `live`.
        fn instance(&mut self, sig: &str, age_s: u64, live: bool) {
            let d = self.0.join("hypr").join(sig);
            assert!(std::fs::create_dir_all(&d).is_ok());
            if live {
                match std::os::unix::net::UnixListener::bind(d.join(".socket.sock")) {
                    Ok(l) => self.1.push(l),
                    Err(e) => panic!("bind test socket: {e}"),
                }
            }
            let when = std::time::SystemTime::now() - std::time::Duration::from_secs(age_s);
            let set = std::fs::File::open(&d).and_then(|f| f.set_modified(when));
            assert!(set.is_ok(), "set mtime: {set:?}");
        }

        /// Run `argv_tail` (a `sh -c` script) the way the server or the remote shell would.
        fn run(&self, env_sig: Option<&str>, script: &str) -> (i32, String) {
            let mut c = std::process::Command::new("/bin/sh");
            c.arg("-c").arg(script).env_clear();
            c.env("PATH", format!("{}:/usr/bin:/bin", self.0.join("bin").display()));
            c.env("XDG_RUNTIME_DIR", &self.0);
            if let Some(s) = env_sig {
                c.env("HYPRLAND_INSTANCE_SIGNATURE", s);
            }
            match c.output() {
                Ok(o) => (o.status.code().unwrap_or(-1), String::from_utf8_lossy(&o.stdout).trim().to_string()),
                Err(e) => panic!("sh: {e}"),
            }
        }
    }

    impl Drop for Runtime {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn script_picks_the_newest_live_instance_like_helper_py() {
        let mut rt = Runtime::new();
        rt.instance("old_live", 300, true);
        rt.instance("new_live", 60, true);
        rt.instance("newest_dead", 5, false);
        // Dell: the remote shell receives the joined ssh command and runs it as one `sh -c` string
        let dell = binds_argv("Dell").and_then(|a| a.last().cloned()).unwrap_or_default();
        for script in [BINDS_SCRIPT.to_string(), dell] {
            assert_eq!(rt.run(None, &script), (0, "new_live binds -j".into()), "{script}");
            // a live inherited signature is kept, a stale one is replaced
            assert_eq!(rt.run(Some("old_live"), &script), (0, "old_live binds -j".into()));
            assert_eq!(rt.run(Some("gone"), &script), (0, "new_live binds -j".into()));
            assert_eq!(rt.run(Some("newest_dead"), &script), (0, "new_live binds -j".into()));
        }
    }

    #[test]
    fn script_exits_3_when_no_hyprland_is_running() {
        let mut rt = Runtime::new();
        assert_eq!(rt.run(None, BINDS_SCRIPT), (NO_HYPRLAND, String::new()), "no hypr dir");
        rt.instance("dead", 5, false);
        assert_eq!(rt.run(None, BINDS_SCRIPT), (NO_HYPRLAND, String::new()), "only a dead dir");
        assert_eq!(rt.run(Some("dead"), BINDS_SCRIPT), (NO_HYPRLAND, String::new()));
    }

    #[test]
    fn groups_clipboard_and_drops_super_copy_paste_cut() {
        let rows = shaped(
            r#"[
              {"modmask":64,"key":"C","mouse":false,"description":"Copy","submap":""},
              {"modmask":64,"key":"V","mouse":false,"description":"Paste","submap":""},
              {"modmask":64,"key":"X","mouse":false,"description":"Cut","submap":""},
              {"modmask":68,"key":"V","mouse":false,"description":"Clipboard history","submap":""},
              {"modmask":64,"key":"W","mouse":false,"description":"Close window","submap":""}
            ]"#,
        );
        assert!(rows.iter().all(|r| {
            let o = r.as_object().map(|m| m.len()).unwrap_or(0);
            o == 5
                && r.get("label").is_some()
                && r.get("modifiers").is_some()
                && r.get("key").is_some()
                && r.get("group").is_some()
                && r.get("confirm").is_some()
                && r.get("dispatcher").is_none()
                && r.get("arg").is_none()
        }));
        assert!(rows.iter().all(|r| {
            let key = r.get("key").and_then(Value::as_str).unwrap_or("");
            let only =
                mods_of(r).len() == 1 && mods_of(r).first().map(String::as_str) == Some("super");
            !(only && matches!(key, "c" | "v" | "x"))
        }));
        let copy = by_label(&rows, "Copy").unwrap_or(&Value::Null);
        assert_eq!(mods_of(copy), vec!["ctrl".to_string()]);
        assert_eq!(copy.get("key").and_then(Value::as_str), Some("c"));
        assert_eq!(copy.get("group").and_then(Value::as_str), Some("Clipboard"));
        assert_eq!(copy.get("confirm").and_then(Value::as_bool), Some(false));
        let plain = by_label(&rows, "Paste plain").unwrap_or(&Value::Null);
        assert_eq!(
            mods_of(plain),
            vec!["ctrl".to_string(), "shift".to_string()]
        );
        let hist = by_label(&rows, "Clipboard history").unwrap_or(&Value::Null);
        assert_eq!(mods_of(hist), vec!["super".to_string(), "ctrl".to_string()]);
        assert_eq!(hist.get("key").and_then(Value::as_str), Some("v"));
        assert_eq!(hist.get("group").and_then(Value::as_str), Some("Clipboard"));
    }

    #[test]
    fn groups_by_omarchy_meaning_and_gates_danger() {
        let rows = shaped(
            r#"[
              {"modmask":64,"key":"TAB","mouse":false,"description":"Next workspace","submap":""},
              {"modmask":64,"key":"SPACE","mouse":false,"description":"Omarchy menu","submap":""},
              {"modmask":64,"key":"RETURN","mouse":false,"description":"Terminal","submap":""},
              {"modmask":0,"key":"F2","mouse":false,"description":"Fullscreen screenshot","submap":""},
              {"modmask":0,"key":"XF86AudioPlay","mouse":false,"description":"Play","submap":""},
              {"modmask":0,"key":"PRINT","mouse":false,"description":"Screenshot","submap":""},
              {"modmask":68,"key":"P","mouse":false,"description":"Power","submap":""},
              {"modmask":64,"key":"Q","mouse":false,"description":"Kill session","submap":""},
              {"modmask":64,"key":"R","mouse":false,"description":"Reboot","submap":"hidden"},
              {"modmask":0,"key":"mouse:274","mouse":true,"description":"Middle click paste","submap":""},
              {"modmask":64,"key":"","mouse":false,"description":"Switch to workspace 10","submap":""},
              {"modmask":64,"key":"","mouse":false,"description":"Expand window left","submap":""},
              {"modmask":65,"key":"","mouse":false,"description":"Something bound by keycode","submap":""},
              {"modmask":0,"key":"1","mouse":false,"description":"G502 1 back thumb: Paste","submap":""},
              {"modmask":2,"key":"A","mouse":false,"description":"Caps thing","submap":""},
              {"modmask":64,"key":"W","mouse":false,"description":"Close window","submap":""},
              {"modmask":0,"key":"XF86PowerOff","mouse":false,"description":"","submap":""}
            ]"#,
        );
        let g = |label: &str| {
            by_label(&rows, label)
                .and_then(|r| r.get("group"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string()
        };
        assert_eq!(g("Next workspace"), "Workspaces");
        assert_eq!(g("Omarchy menu"), "Launchers/menus");
        assert_eq!(g("Terminal"), "Apps");
        assert_eq!(g("Fullscreen screenshot"), "Screenshots");
        assert_eq!(g("Play"), "Media");
        assert_eq!(g("Screenshot"), "Screenshots");
        assert_eq!(
            by_label(&rows, "Screenshot")
                .and_then(|r| r.get("key"))
                .and_then(Value::as_str),
            Some("print")
        );
        assert_eq!(
            by_label(&rows, "Play")
                .and_then(|r| r.get("key"))
                .and_then(Value::as_str),
            Some("playpause")
        );
        let power = by_label(&rows, "Power").unwrap_or(&Value::Null);
        assert_eq!(power.get("confirm").and_then(Value::as_bool), Some(true));
        assert_eq!(power.get("group").and_then(Value::as_str), Some("System"));
        assert_eq!(
            mods_of(power),
            vec!["super".to_string(), "ctrl".to_string()]
        );
        assert_eq!(power.get("key").and_then(Value::as_str), Some("p"));
        let kill = by_label(&rows, "Kill session").unwrap_or(&Value::Null);
        assert_eq!(kill.get("confirm").and_then(Value::as_bool), Some(true));
        assert!(by_label(&rows, "Reboot").is_none());
        assert!(by_label(&rows, "Middle click paste").is_none());
        // keycode binds (empty key) come back from their description; one that names no key stays out
        let ws = by_label(&rows, "Switch to workspace 10").unwrap_or(&Value::Null);
        assert_eq!(ws.get("key").and_then(Value::as_str), Some("0"));
        assert_eq!(mods_of(ws), vec!["super".to_string()]);
        assert_eq!(ws.get("group").and_then(Value::as_str), Some("Workspaces"));
        let grow = by_label(&rows, "Expand window left").unwrap_or(&Value::Null);
        assert_eq!(grow.get("key").and_then(Value::as_str), Some("minus"));
        assert!(by_label(&rows, "Something bound by keycode").is_none());
        assert!(by_label(&rows, "G502 1 back thumb: Paste").is_none());
        assert!(by_label(&rows, "Caps thing").is_none());
        let close = by_label(&rows, "Close window").unwrap_or(&Value::Null);
        assert_eq!(close.get("confirm").and_then(Value::as_bool), Some(false));
        assert_eq!(close.get("group").and_then(Value::as_str), Some("Windows"));
        assert!(rows
            .iter()
            .all(|r| r.get("key").and_then(Value::as_str) != Some("xf86poweroff")));
    }

    #[test]
    fn mac_set_keeps_cmd_clipboard_and_holds_logout() {
        let rows = mac_binds();
        let copy = by_label(&rows, "Copy").unwrap_or(&Value::Null);
        assert_eq!(mods_of(copy), vec!["cmd".to_string()]);
        assert_eq!(copy.get("group").and_then(Value::as_str), Some("Clipboard"));
        let out = by_label(&rows, "Log out").unwrap_or(&Value::Null);
        assert_eq!(out.get("confirm").and_then(Value::as_bool), Some(true));
        assert_eq!(out.get("group").and_then(Value::as_str), Some("System"));
        assert!(rows.iter().all(|r| {
            let key = r.get("key").and_then(Value::as_str).unwrap_or("");
            crate::pad::valid_key(key)
        }));
    }
}
