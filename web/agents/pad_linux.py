#!/usr/bin/env python3
# Pixel Deck trackpad agent for Omarchy/Hyprland hosts (pc-desktop, Dell). Embedded in the
# pixel-deck binary. Writes raw input_event records to the user's ydotoold datagram socket.
# Reads one validated JSON command per stdin line. Never runs a shell.
# Safety: every pressed key, modifier and button is tracked and released on release, EOF,
# SIGTERM and SIGHUP. text() stops early when a release line is queued. A dead ydotoold
# socket is reconnected once, then the agent exits 3.
import json
import os
import queue
import signal
import socket
import struct
import sys
import threading
import time

EV_SYN, EV_KEY, EV_REL = 0, 1, 2
REL_X, REL_Y, REL_HWHEEL, REL_WHEEL = 0, 1, 6, 8
BTN = {"l": 0x110, "r": 0x111, "m": 0x112}
KEYS = {
    "esc": 1, "1": 2, "2": 3, "3": 4, "4": 5, "5": 6, "6": 7, "7": 8, "8": 9, "9": 10, "0": 11,
    "minus": 12, "equal": 13, "backspace": 14, "tab": 15, "q": 16, "w": 17, "e": 18, "r": 19,
    "t": 20, "y": 21, "u": 22, "i": 23, "o": 24, "p": 25, "lbracket": 26, "rbracket": 27,
    "enter": 28, "a": 30, "s": 31, "d": 32, "f": 33, "g": 34, "h": 35, "j": 36, "k": 37, "l": 38,
    "semicolon": 39, "quote": 40, "grave": 41, "backslash": 43, "z": 44, "x": 45, "c": 46,
    "v": 47, "b": 48, "n": 49, "m": 50, "comma": 51, "period": 52, "slash": 53, "space": 57,
    "capslock": 58, "ralt": 100,
    "f1": 59, "f2": 60, "f3": 61, "f4": 62, "f5": 63, "f6": 64, "f7": 65,
    "f8": 66, "f9": 67, "f10": 68, "f11": 87, "f12": 88, "home": 102, "up": 103, "pgup": 104,
    "left": 105, "right": 106, "end": 107, "down": 108, "pgdn": 109, "delete": 111,
    "mute": 113, "voldown": 114, "volup": 115, "next": 163, "playpause": 164, "prev": 165,
    "print": 99,
}
MODS = {"ctrl": 29, "shift": 42, "alt": 56, "cmd": 125, "super": 125}
SHIFTED = {
    "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9",
    ")": "0", "_": "minus", "+": "equal", "{": "lbracket", "}": "rbracket", "|": "backslash",
    ":": "semicolon", '"': "quote", "~": "grave", "<": "comma", ">": "period", "?": "slash",
}
PLAIN = {
    "-": "minus", "=": "equal", "[": "lbracket", "]": "rbracket", "\\": "backslash",
    ";": "semicolon", "'": "quote", "`": "grave", ",": "comma", ".": "period", "/": "slash",
    " ": "space", "\n": "enter", "\t": "tab",
}
held = set()  # mouse buttons currently down
mods_down = set()  # modifier names currently down
keys_down = set()  # key codes currently down
wheel = [0.0, 0.0]
rel = {"queued": 0, "done": 0}  # text() stops early while queued > done


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


path = os.path.join(os.environ.get("XDG_RUNTIME_DIR") or "/run/user/%d" % os.getuid(), ".ydotool_socket")
sock = None


def connect():
    global sock
    s = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
    try:
        s.connect(path)
    except OSError:
        s.close()
        raise
    old, sock = sock, s
    if old is not None:
        try:
            old.close()
        except OSError:
            pass


def gone():
    out({"error": "ydotoold gone", "fatal": True})
    os._exit(3)  # nothing can be released without the socket


try:
    connect()
except OSError:
    out({"error": "ydotoold socket unavailable", "fatal": True})
    sys.exit(3)


def ev(t, c, v):
    data = struct.pack("llHHi", 0, 0, t, c, v)
    try:
        sock.send(data)
    except OSError:
        # ydotoold restarted or the socket inode was replaced: reconnect once and retry
        try:
            connect()
        except OSError:
            gone()
        sock.send(data)


def syn():
    ev(EV_SYN, 0, 0)


def tap(code, d):
    ev(EV_KEY, code, 1 if d else 0)
    syn()


def move(dx, dy):
    if dx:
        ev(EV_REL, REL_X, dx)
    if dy:
        ev(EV_REL, REL_Y, dy)
    syn()


def scroll(dx, dy):
    # phone sends pixels; one wheel notch per 40 px, remainder carried
    wheel[0] += dx / 40.0
    wheel[1] += dy / 40.0
    nx, ny = int(wheel[0]), int(wheel[1])
    wheel[0] -= nx
    wheel[1] -= ny
    if ny:
        ev(EV_REL, REL_WHEEL, -ny)
    if nx:
        ev(EV_REL, REL_HWHEEL, nx)
    if nx or ny:
        syn()


def button(b, d):
    if d:
        held.add(b)  # track first: a signal between add and send only costs one extra release
        tap(BTN[b], True)
    else:
        tap(BTN[b], False)
        held.discard(b)


def click(b, n, s=1):
    # s (click state) is accepted for protocol parity with the Mac agent and ignored:
    # Linux apps detect double clicks by timing.
    for _ in range(n):
        try:
            button(b, True)
        finally:
            button(b, False)
        time.sleep(0.03)


def key(k, mods):
    code = KEYS[k]
    mcodes = [MODS[m] for m in mods]  # validate before pressing anything
    try:
        for m, mc in zip(mods, mcodes):
            mods_down.add(m)
            tap(mc, True)
        keys_down.add(code)
        try:
            tap(code, True)
        finally:
            tap(code, False)
            keys_down.discard(code)
    finally:
        for m in reversed(mods):
            if m in mods_down:
                tap(MODS[m], False)
                mods_down.discard(m)


def hold(k, d):
    # Press or release one key and leave it in that state. keys_down tracks it, so release_all,
    # SIGTERM, SIGHUP and EOF let go of a key the phone never got to release.
    code = KEYS[k]
    if d:
        if code not in keys_down:
            keys_down.add(code)  # track first: a signal between add and send only costs one extra release
            tap(code, True)
    else:
        try:
            tap(code, False)
        finally:
            keys_down.discard(code)


def stopping():
    return rel["queued"] > rel["done"]


def text(s):
    skipped = 0
    for ch in s:
        if stopping():
            break
        if "a" <= ch <= "z" or "0" <= ch <= "9":
            key(ch, [])
        elif "A" <= ch <= "Z":
            key(ch.lower(), ["shift"])
        elif ch in PLAIN:
            key(PLAIN[ch], [])
        elif ch in SHIFTED:
            key(SHIFTED[ch], ["shift"])
        else:
            skipped += 1
        time.sleep(0.004)
    if skipped:
        out({"warn": "skipped %d non-ASCII characters" % skipped})


def release_all():
    for b in list(held):
        try:
            button(b, False)
        except Exception:
            held.discard(b)
    for code in list(keys_down):
        try:
            tap(code, False)
        except Exception:
            pass
        keys_down.discard(code)
    for m in list(mods_down):
        try:
            tap(MODS[m], False)
        except Exception:
            pass
        mods_down.discard(m)


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
            click(c["b"], c.get("n", 1), c.get("s", 1))
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
    out({"ready": True, "os": "linux"})
    try:
        while True:
            line = q.get()
            if line is None:
                break
            handle(line)
    finally:
        release_all()


main()
