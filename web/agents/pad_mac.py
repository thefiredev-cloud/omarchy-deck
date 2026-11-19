#!/usr/bin/env python3
# Pixel Deck trackpad agent for macOS (Mac Mini). Embedded in the pixel-deck binary and started
# over ssh as `python3 -u -c <this>`. Reads one validated JSON command per stdin line, posts
# Quartz events. Python 3.9 compatible (system python). Never runs a shell.
# Safety: every pressed key, modifier and button is tracked and released on release, EOF,
# SIGTERM and SIGHUP. text() stops early when a release line is queued.
import json
import os
import queue
import signal
import sys
import threading

import Quartz
from AppKit import NSEvent

KEYS = {
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11,
    "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21,
    "6": 22, "5": 23, "equal": 24, "9": 25, "7": 26, "minus": 27, "8": 28, "0": 29,
    "rbracket": 30, "o": 31, "u": 32, "lbracket": 33, "i": 34, "p": 35, "enter": 36, "l": 37,
    "j": 38, "quote": 39, "k": 40, "semicolon": 41, "backslash": 42, "comma": 43, "slash": 44,
    "n": 45, "m": 46, "period": 47, "tab": 48, "space": 49, "grave": 50, "backspace": 51,
    "esc": 53, "capslock": 57, "ralt": 61, "f5": 96, "f6": 97, "f7": 98, "f3": 99, "f8": 100, "f9": 101,
    "f11": 103, "f10": 109, "f12": 111, "home": 115, "pgup": 116, "delete": 117, "f4": 118,
    "end": 119, "f2": 120, "pgdn": 121, "f1": 122, "left": 123, "right": 124, "down": 125,
    "up": 126, "print": 105,
}
MEDIA = {"volup": 0, "voldown": 1, "mute": 7, "playpause": 16, "next": 17, "prev": 18}
KEYMOD = {"ralt": "alt"}  # keys that are modifiers themselves: their own key-down carries that flag
FLAGS = {
    "cmd": Quartz.kCGEventFlagMaskCommand,
    "ctrl": Quartz.kCGEventFlagMaskControl,
    "alt": Quartz.kCGEventFlagMaskAlternate,
    "shift": Quartz.kCGEventFlagMaskShift,
    "super": Quartz.kCGEventFlagMaskCommand,
}
MODKEY = {"cmd": 55, "ctrl": 59, "alt": 58, "shift": 56, "super": 55}
BTN = {
    "l": (Quartz.kCGEventLeftMouseDown, Quartz.kCGEventLeftMouseUp, Quartz.kCGEventLeftMouseDragged, 0),
    "r": (Quartz.kCGEventRightMouseDown, Quartz.kCGEventRightMouseUp, Quartz.kCGEventRightMouseDragged, 1),
    "m": (Quartz.kCGEventOtherMouseDown, Quartz.kCGEventOtherMouseUp, Quartz.kCGEventOtherMouseDragged, 2),
}
TAP = Quartz.kCGHIDEventTap
held = set()  # mouse buttons currently down
mods_down = set()  # modifier names currently down
hold_mods = set()  # modifier names of modifier KEYS the phone is holding down (Right Option): their flag rides on every other event
keys_down = set()  # key codes currently down
rel = {"queued": 0, "done": 0}  # text() stops early while queued > done
TEXT_UNITS = 20  # CGEventKeyboardSetUnicodeString limit, in UTF-16 units


def out(o):
    # a closed stdout (ssh dropped) must never stop the cleanup path
    try:
        sys.stdout.write(json.dumps(o) + "\n")
        sys.stdout.flush()
    except (OSError, ValueError):
        try:
            os.dup2(os.open(os.devnull, os.O_WRONLY), 1)  # later writes and the exit flush go nowhere
        except OSError:
            pass


def bounds():
    err, ids, n = Quartz.CGGetActiveDisplayList(16, None, None)
    rs = [Quartz.CGDisplayBounds(i) for i in (ids or [])[:n]] or [Quartz.CGDisplayBounds(Quartz.CGMainDisplayID())]
    x0 = min(r.origin.x for r in rs)
    y0 = min(r.origin.y for r in rs)
    x1 = max(r.origin.x + r.size.width for r in rs) - 1
    y1 = max(r.origin.y + r.size.height for r in rs) - 1
    return x0, y0, x1, y1


B = bounds()


def pos():
    p = Quartz.CGEventGetLocation(Quartz.CGEventCreate(None))
    return p.x, p.y


def mouse(kind, xy, b=0, state=None):
    e = Quartz.CGEventCreateMouseEvent(None, kind, xy, b)
    if state:
        Quartz.CGEventSetIntegerValueField(e, Quartz.kCGMouseEventClickState, state)
    Quartz.CGEventPost(TAP, e)


def move(dx, dy):
    x, y = pos()
    x = min(max(x + dx, B[0]), B[2])
    y = min(max(y + dy, B[1]), B[3])
    kind = Quartz.kCGEventMouseMoved
    num = 0
    for b in ("l", "r", "m"):
        if b in held:
            kind, num = BTN[b][2], BTN[b][3]
            break
    mouse(kind, (x, y), num)


def button(b, d):
    down, up, _, num = BTN[b]
    if d:
        held.add(b)  # track first: a signal between add and post only costs one extra release
    mouse(down if d else up, pos(), num, 1)
    if not d:
        held.discard(b)


def click(b, n, s=1):
    # s is the click state of the first click (2 = double click); later clicks count up
    down, up, _, num = BTN[b]
    xy = pos()
    for i in range(s, s + n):
        held.add(b)
        try:
            mouse(down, xy, num, i)
        finally:
            mouse(up, xy, num, i)
            held.discard(b)


def scroll(dx, dy):
    e = Quartz.CGEventCreateScrollWheelEvent(None, Quartz.kCGScrollEventUnitPixel, 2, int(-dy), int(-dx))
    Quartz.CGEventPost(TAP, e)


def media(code):
    for st in (0xA, 0xB):
        ev = NSEvent.otherEventWithType_location_modifierFlags_timestamp_windowNumber_context_subtype_data1_data2_(
            14, (0, 0), st << 8, 0, 0, None, 8, (code << 16) | (st << 8), -1)
        Quartz.CGEventPost(TAP, ev.CGEvent())


def held_flags():
    f = 0
    for m in hold_mods:
        f |= FLAGS[m]
    return f


def flags_now():
    f = held_flags()
    for m in mods_down:
        f |= FLAGS[m]
    return f


def post_key(code, down, flags):
    e = Quartz.CGEventCreateKeyboardEvent(None, code, down)
    Quartz.CGEventSetFlags(e, flags)
    Quartz.CGEventPost(TAP, e)


def key(k, mods):
    if k in MEDIA:
        return media(MEDIA[k])
    code = KEYS[k]
    own = FLAGS[KEYMOD[k]] if k in KEYMOD else 0
    for m in mods:  # validate before pressing anything
        FLAGS[m], MODKEY[m]
    base = held_flags()  # modifier keys the phone is holding (Right Option) stay in every event
    flags = base
    try:
        for m in mods:
            flags |= FLAGS[m]
            mods_down.add(m)
            post_key(MODKEY[m], True, flags)
        keys_down.add(code)
        try:
            post_key(code, True, flags | own)
        finally:
            post_key(code, False, flags)
            keys_down.discard(code)
    finally:
        for m in reversed(mods):
            if m in mods_down:
                flags = (flags & ~FLAGS[m]) | base
                post_key(MODKEY[m], False, flags)
                mods_down.discard(m)


def hold(k, d):
    # Press or release one key and leave it in that state. keys_down tracks it, so release_all,
    # SIGTERM, SIGHUP and EOF let go of a key the phone never got to release. A held modifier key
    # (Right Option) is also in hold_mods, so every key pressed meanwhile carries its flag, as on a real keyboard.
    code = KEYS[k]
    if d:
        if code not in keys_down:
            keys_down.add(code)  # track first: a signal between add and post only costs one extra release
            if k in KEYMOD:
                hold_mods.add(KEYMOD[k])
            post_key(code, True, flags_now())
    else:
        if k in KEYMOD:
            hold_mods.discard(KEYMOD[k])  # the key-up itself carries no flag of its own
        try:
            post_key(code, False, flags_now())
        finally:
            keys_down.discard(code)


def stopping():
    return rel["queued"] > rel["done"]


def utf16_chunks(part, limit=TEXT_UNITS):
    """Split into pieces of at most `limit` UTF-16 units, never inside a surrogate pair."""
    cur, units = [], 0
    for ch in part:
        w = 2 if ord(ch) > 0xFFFF else 1
        if units + w > limit:
            yield "".join(cur), units
            cur, units = [], 0
        cur.append(ch)
        units += w
    if cur:
        yield "".join(cur), units


def text(s):
    parts = s.replace("\r", "").split("\n")
    for n, part in enumerate(parts):
        if stopping():
            return
        if n:
            key("enter", [])
        for chunk, units in utf16_chunks(part):
            if stopping():
                return
            code = 0
            keys_down.add(code)
            try:
                for d in (True, False):
                    e = Quartz.CGEventCreateKeyboardEvent(None, code, d)
                    Quartz.CGEventKeyboardSetUnicodeString(e, units, chunk)
                    Quartz.CGEventPost(TAP, e)
            finally:
                keys_down.discard(code)


def release_all():
    for b in list(held):
        try:
            button(b, False)
        except Exception:
            held.discard(b)
    hold_mods.clear()  # a released Right Option's own key-up carries no Alternate flag
    for code in list(keys_down):
        try:
            post_key(code, False, flags_now())
        except Exception:
            pass
        keys_down.discard(code)
    for m in list(mods_down):
        try:
            mods_down.discard(m)
            post_key(MODKEY[m], False, flags_now())
        except Exception:
            pass


def on_term(signum, frame):
    release_all()
    sys.exit(0)


def reader(q):
    # raw fd reads: no buffered-stdin lock to trip over at interpreter shutdown
    buf = b""
    while True:
        try:
            chunk = os.read(0, 65536)
        except OSError:
            chunk = b""
        if not chunk:
            q.put(None)
            return
        buf += chunk
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            try:
                if json.loads(line).get("op") == "release":
                    rel["queued"] += 1
            except Exception:
                pass
            q.put(line)


def handle(line):
    try:
        c = json.loads(line)
        op = c.get("op")
        if op == "move":
            move(c["dx"], c["dy"])
        elif op == "scroll":
            scroll(c["dx"], c["dy"])
        elif op == "click":
            click(c["b"], c.get("n", 1), min(max(int(c.get("s", 1)), 1), 3))
        elif op == "button":
            button(c["b"], c["down"])
        elif op == "key":
            key(c["k"], c.get("mods", []))
        elif op == "hold":
            hold(c["k"], bool(c["down"]))
        elif op == "text":
            text(c["s"])
        elif op == "ping":
            out({"pong": c.get("id", 0)})
        elif op == "release":
            release_all()
            rel["done"] += 1
    except Exception as ex:  # one bad command never kills the session
        out({"error": type(ex).__name__})


def main():
    signal.signal(signal.SIGTERM, on_term)
    signal.signal(signal.SIGHUP, on_term)
    q = queue.Queue()
    threading.Thread(target=reader, args=(q,), daemon=True).start()
    out({"ready": True, "os": "macos", "screen": [B[2] - B[0] + 1, B[3] - B[1] + 1]})
    try:
        while True:
            line = q.get()
            if line is None:
                break
            handle(line)
    finally:
        release_all()


main()
