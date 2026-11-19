#!/usr/bin/env python3
"""Turn Hyprland keybinds into grouped Omarchy Deck key pages.

Reads `hyprctl binds -j` (or a JSON file given as the first argument) and writes
`keys.generated.json` next to `keys.json`. Every bind lands on exactly one page.
`keys.json` is the live deck config and is never read or written here.

Usage:
    keys_from_hypr.py                    # live: hyprctl binds -j
    keys_from_hypr.py binds.json         # from a saved capture
    keys_from_hypr.py -o /tmp/out.json   # choose the output file
"""
import argparse
import datetime
import glob
import json
import os
import re
import socket
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, "keys.generated.json")
PROTECTED = os.path.join(ROOT, "keys.json")

# Page order is the deck order. First matching page wins.
PAGES = [
    ("workspaces", "Workspaces", "\U0001F5C2\uFE0F"),
    ("windows", "Windows", "\U0001FA9F"),
    ("apps", "Apps", "\U0001F680"),
    ("media", "Media", "\U0001F39B\uFE0F"),
    ("screenshots", "Screenshots", "\U0001F4F8"),
    ("dictation", "Dictation", "\U0001F399\uFE0F"),
    ("other", "Other", "\u2699\uFE0F"),
]

# Checked in this order; dictation and screenshots go first so that a
# description like "Toggle dictation" never falls into a broader page.
RULES = [
    ("dictation", re.compile(r"dictat|voxtype", re.I)),
    ("screenshots", re.compile(r"screenshot|screenrecord|color picker|\bocr\b|webcam overlay|capture menu", re.I)),
    ("media", re.compile(
        r"volume|brightness|\btrack\b|audio output|media source|eject media|keyboard backlight|mute microphone"
        r"|^(play|pause|mute)$", re.I)),
    ("workspaces", re.compile(r"workspace|scratchpad|spaceview|overview", re.I)),
    ("windows", re.compile(
        r"window|fullscreen|full screen|full width|pseudo|\bgroup|split|monitor|resize|fathom|windowpeek", re.I)),
    ("apps", re.compile(
        r"terminal|browser|file manager|editor|docker|signal|obsidian|omawrite|passwords|chatgpt|grok|calendar"
        r"|youtube|whatsapp|google|^x$|^x post$|email|spotify|music|borealis|tmux|herdr|calculator|app grid|timer",
        re.I)),
]

MODS = [(64, "Super"), (4, "Ctrl"), (8, "Alt"), (1, "Shift"), (128, "AltGr")]

KEY_WORDS = {
    "RETURN": "Enter", "ESCAPE": "Esc", "BACKSPACE": "Backspace", "DELETE": "Delete", "SPACE": "Space",
    "TAB": "Tab", "PRINT": "Print Screen", "LEFT": "Left arrow", "RIGHT": "Right arrow", "UP": "Up arrow",
    "DOWN": "Down arrow", "HOME": "Home", "PERIOD": ".", "COMMA": ",", "SLASH": "/", "MINUS": "-",
    "EQUAL": "=", "BRACKETLEFT": "[", "BRACKETRIGHT": "]",
    "MOUSE:272": "Left mouse button", "MOUSE:273": "Right mouse button", "MOUSE:274": "Middle mouse button",
    "MOUSE_DOWN": "Scroll down", "MOUSE_UP": "Scroll up",
    "XF86AUDIORAISEVOLUME": "Volume up key", "XF86AUDIOLOWERVOLUME": "Volume down key",
    "XF86AUDIOMUTE": "Mute key", "XF86AUDIOMICMUTE": "Mic mute key",
    "XF86MONBRIGHTNESSUP": "Brightness up key", "XF86MONBRIGHTNESSDOWN": "Brightness down key",
    "XF86KBDBRIGHTNESSUP": "Keyboard light up key", "XF86KBDBRIGHTNESSDOWN": "Keyboard light down key",
    "XF86KBDLIGHTONOFF": "Keyboard light key", "XF86AUDIONEXT": "Next track key",
    "XF86AUDIOPREV": "Previous track key", "XF86AUDIOPLAY": "Play key", "XF86AUDIOPAUSE": "Pause key",
    "XF86EJECT": "Eject key", "XF86POWEROFF": "Power key", "XF86CALCULATOR": "Calculator key",
    "XF86TOUCHPADTOGGLE": "Touchpad toggle key", "XF86TOUCHPADON": "Touchpad on key",
    "XF86TOUCHPADOFF": "Touchpad off key",
}

# Omarchy binds many keys by X keycode (`code:N`); hyprctl reports those with an
# empty key. Where the description names the key, recover it. Sources:
# /usr/share/omarchy/default/hypr/bindings/{tiling,utilities}.lua
_NUMBERED = re.compile(r"(?:workspace|group window|bar panel) (\d+)$", re.I)


def inferred_key(description, modmask=0):
    """Return the key a keycode bind uses, or None when it cannot be known."""
    m = _NUMBERED.search(description or "")
    if m:
        n = int(m.group(1))
        return str(n % 10)
    d = (description or "").lower()
    if re.match(r"(expand window left|shrink window up)", d):
        return "-"
    if re.match(r"(shrink window left|expand window down)", d):
        return "="
    if d == "make webcam overlay smaller":
        return "["
    if d == "make webcam overlay larger":
        return "]"
    # utilities.lua: "SUPER + SHIFT + code:201", X keycode 201 = evdev KEY_F23, which laptop Copilot keys send with Super+Shift
    if d == "omarchy menu" and modmask == 64 | 1:
        return "F23 (Copilot key)"
    return None


def key_word(key):
    k = key.strip()
    up = k.upper()
    if up in KEY_WORDS:
        return KEY_WORDS[up]
    if up.startswith("XF86"):
        words = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", k[4:])
        return words + " key"
    if re.fullmatch(r"[A-Za-z0-9]", k):
        return k.upper()
    if re.fullmatch(r"F\d{1,2}", up):
        return up
    return k


def mod_words(modmask):
    return [name for bit, name in MODS if modmask & bit]


def plain_key(bind):
    """(mods, key text, key_known, key_inferred) for one hyprctl bind record."""
    modmask = int(bind.get("modmask", 0))
    mods = mod_words(modmask)
    raw = str(bind.get("key", ""))
    m = re.match(r"switch:(on|off):(.+)$", raw)
    if m:
        # Hyprland: switch:on is the lid closing, switch:off the lid opening.
        return mods, ("Lid closes" if m.group(1) == "on" else "Lid opens"), True, False
    if raw:
        return mods, key_word(raw), True, False
    guess = inferred_key(bind.get("description", ""), modmask)
    if guess is not None:
        return mods, guess, True, True
    return mods, "", False, False


def note_for(bind, known):
    """One plain line for a bind that is not an ordinary key press, else None."""
    if str(bind.get("key", "")).startswith("switch:"):
        return "Laptop lid event, not a key. It runs by itself when the lid moves."
    if not known:
        return "Bound by keycode and hyprctl does not report which key. Check the Omarchy bindings file."
    return None


def combo_text(mods, key, known):
    return " + ".join(mods + [key]) if known else " + ".join(mods + ["(key not reported)"])


def label_for(bind):
    desc = (bind.get("description") or "").strip()
    if desc:
        return desc
    raw = str(bind.get("key", ""))
    m = re.match(r"switch:(on|off):(.+)$", raw)
    if m:
        # Hyprland: switch:on is the lid closing, switch:off the lid opening.
        return ("Closed: " if m.group(1) == "on" else "Opened: ") + m.group(2)
    return raw or "Unnamed bind"


def page_for(label):
    for page_id, rx in RULES:
        if rx.search(label):
            return page_id
    return "other"


def build(binds, source, now=None):
    pages = {pid: [] for pid, _, _ in PAGES}
    for index, b in enumerate(binds):
        mods, key, known, inferred = plain_key(b)
        label = label_for(b)
        entry = {
            "index": index,
            "label": label,
            "combo": combo_text(mods, key, known),
            "mods": mods,
            "key": key,
            "key_known": known,
            "key_inferred": inferred,
            "submap": b.get("submap", "") or "",
            "mouse": bool(b.get("mouse")),
            "locked": bool(b.get("locked")),
        }
        note = note_for(b, known)
        if note:
            entry["note"] = note
        pages[page_for(label)].append(entry)
    out_pages = [
        {"id": pid, "title": title, "icon": icon, "count": len(pages[pid]), "keys": pages[pid]}
        for pid, title, icon in PAGES
    ]
    unresolved = [{"index": k["index"], "label": k["label"], "combo": k["combo"]}
                  for p in out_pages for k in p["keys"] if not k["key_known"]]
    stamp = (now or datetime.datetime.now(datetime.timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "version": 1,
        "generated_at": stamp,
        "source": source,
        "total_binds": len(binds),
        "unresolved_count": len(unresolved),
        "unresolved": sorted(unresolved, key=lambda u: u["index"]),
        "pages": out_pages,
    }


def _live_instances():
    base = os.path.join(os.environ.get("XDG_RUNTIME_DIR", "/run/user/%d" % os.getuid()), "hypr")
    socks = glob.glob(os.path.join(base, "*", ".socket.sock"))
    socks.sort(key=os.path.getmtime, reverse=True)
    for path in socks:
        s = socket.socket(socket.AF_UNIX)
        s.settimeout(1)
        try:
            s.connect(path)
        except OSError:
            continue
        finally:
            s.close()
        yield os.path.basename(os.path.dirname(path))


def live_binds():
    """Run `hyprctl binds -j`; if the inherited instance is dead, try live ones."""
    attempts = [None] + list(_live_instances())
    last = ""
    for sig in attempts:
        env = dict(os.environ)
        if sig:
            env["HYPRLAND_INSTANCE_SIGNATURE"] = sig
        try:
            p = subprocess.run(["hyprctl", "binds", "-j"], capture_output=True, text=True, timeout=10, env=env)
        except (OSError, subprocess.TimeoutExpired) as e:
            raise SystemExit("hyprctl failed: %s" % e)
        if p.returncode == 0:
            try:
                data = json.loads(p.stdout)
            except ValueError:
                last = p.stdout.strip()[:200]
                continue
            if isinstance(data, list):
                return data, "hyprctl binds -j"
        last = (p.stdout + p.stderr).strip()[:200]
    raise SystemExit("hyprctl binds -j gave no JSON: %s" % last)


def write_json_atomic(path, doc):
    if os.path.realpath(path) == os.path.realpath(PROTECTED):
        raise SystemExit("refusing to write keys.json; it is the live deck config")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("binds_json", nargs="?", help="saved `hyprctl binds -j` output; default is live hyprctl")
    ap.add_argument("-o", "--output", default=DEFAULT_OUT, help="output file (default: %(default)s)")
    args = ap.parse_args(argv)
    if args.binds_json:
        with open(args.binds_json, encoding="utf-8") as f:
            binds = json.load(f)
        source = os.path.basename(args.binds_json)
    else:
        binds, source = live_binds()
    if not isinstance(binds, list):
        raise SystemExit("binds JSON must be a list")
    doc = build(binds, source)
    write_json_atomic(args.output, doc)
    summary = ", ".join("%s %d" % (p["id"], p["count"]) for p in doc["pages"])
    print("wrote %s: %d binds (%s), %d with no known key" % (args.output, doc["total_binds"], summary, doc["unresolved_count"]))
    for u in doc["unresolved"]:
        print("  no known key: %s (%s)" % (u["label"], u["combo"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
