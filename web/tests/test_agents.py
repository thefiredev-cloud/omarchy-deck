"""Tests for agents/pad_linux.py and agents/pad_mac.py.

Run: python3 -m unittest tests/test_agents.py -v

Linux agent: run as a subprocess against a private fake ydotool datagram socket
(XDG_RUNTIME_DIR override). The real /run/user/*/.ydotool_socket is never touched.
Mac agent: run as a subprocess with a fake Quartz/AppKit injected into sys.modules that
records every posted event to a JSON-lines file. No real input is generated anywhere.
PAD_AGENT_RUNS overrides the number of SIGTERM runs (default 12, acceptance harness uses 40).
"""
import json
import os
import queue
import random
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LINUX = os.path.join(ROOT, "agents", "pad_linux.py")
MAC = os.path.join(ROOT, "agents", "pad_mac.py")
RUNS = int(os.environ.get("PAD_AGENT_RUNS", "12"))

MIXED = "The Quick Brown Fox Jumps Over The Lazy Dog 0123456789 ABC!? " * 4  # 240 chars


def scratch():
    base = os.environ.get("TMPDIR") or None
    return tempfile.mkdtemp(prefix="padagents-", dir=base)


class Agent:
    """Subprocess wrapper with a line reader thread."""

    def __init__(self, argv, env):
        # stdout is our own os.pipe so a test can close the read end cleanly (no reader
        # thread is blocked on it: lines are pumped with os.read and a short poll).
        r, w = os.pipe()
        self.p = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=w,
                                  stderr=subprocess.PIPE, env=env)
        os.close(w)
        self.rfd = r
        self.lines = queue.Queue()
        self.seen = []
        self.dropped = False
        self.buf = b""
        self.stderr_data = b""
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        import select
        while not self.dropped:
            ready, _, _ = select.select([self.rfd], [], [], 0.05)
            if self.dropped:
                return
            if not ready:
                continue
            try:
                chunk = os.read(self.rfd, 65536)
            except OSError:
                return
            if not chunk:
                self.lines.put(None)
                return
            self.buf += chunk
            while b"\n" in self.buf:
                line, self.buf = self.buf.split(b"\n", 1)
                self.lines.put(line.decode())

    def drop_stdout(self):
        """Close the read end: the agent's next write gets EPIPE."""
        self.dropped = True
        time.sleep(0.15)  # let the pump thread exit its select
        os.close(self.rfd)
        self.rfd = -1

    def send(self, obj):
        self.p.stdin.write((json.dumps(obj) + "\n").encode())
        self.p.stdin.flush()

    def wait_line(self, pred=lambda o: True, timeout=5.0):
        end = time.time() + timeout
        while time.time() < end:
            try:
                raw = self.lines.get(timeout=max(0.01, end - time.time()))
            except queue.Empty:
                break
            if raw is None:
                return None
            o = json.loads(raw)
            self.seen.append(o)
            if pred(o):
                return o
        return None

    def finish(self, timeout=5.0):
        try:
            self.p.stdin.close()
        except OSError:
            pass
        try:
            return self.p.wait(timeout)
        except subprocess.TimeoutExpired:
            self.p.kill()
            self.p.wait()
            return None

    def cleanup(self):
        if self.p.poll() is None:
            self.p.kill()
            self.p.wait()
        self.dropped = True
        for f in (self.p.stdin, self.p.stderr):
            try:
                f.close()
            except Exception:
                pass
        if self.rfd >= 0:
            time.sleep(0.1)
            try:
                os.close(self.rfd)
            except OSError:
                pass
            self.rfd = -1


# ---------------------------------------------------------------- linux harness

class FakeYdotoold:
    def __init__(self, rundir):
        self.path = os.path.join(rundir, ".ydotool_socket")
        self.events = []  # (type, code, value) in arrival order
        self.lock = threading.Lock()
        self.sock = None
        self.stop = None
        self.thread = None

    def open(self):
        if os.path.exists(self.path):
            os.unlink(self.path)
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        self.sock.bind(self.path)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 * 1024 * 1024)
        self.sock.settimeout(0.05)
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._loop, args=(self.sock, self.stop), daemon=True)
        self.thread.start()

    def _loop(self, sock, stop):
        while not stop.is_set():
            try:
                b = sock.recv(64)
            except socket.timeout:
                continue
            except OSError:
                return
            if len(b) == struct.calcsize("llHHi"):
                _, _, t, c, v = struct.unpack("llHHi", b)
                with self.lock:
                    self.events.append((t, c, v))

    def close(self):
        if self.stop:
            self.stop.set()
            self.thread.join(2)
        if self.sock:
            self.sock.close()
            self.sock = None
        if os.path.exists(self.path):
            os.unlink(self.path)

    def snapshot(self):
        with self.lock:
            return list(self.events)

    def down_keys(self):
        st = {}
        for t, c, v in self.snapshot():
            if t == 1:
                st[c] = v
        return sorted(c for c, v in st.items() if v)


class LinuxCase(unittest.TestCase):
    def setUp(self):
        self.dir = scratch()
        self.srv = FakeYdotoold(self.dir)
        self.srv.open()
        self.agents = []
        with open(LINUX) as f:
            self.src = f.read()

    def tearDown(self):
        for a in self.agents:
            a.cleanup()
        self.srv.close()

    def start(self):
        env = dict(os.environ, XDG_RUNTIME_DIR=self.dir)
        a = Agent([sys.executable, "-u", "-c", self.src], env)
        self.agents.append(a)
        hello = a.wait_line()
        self.assertEqual(hello, {"ready": True, "os": "linux"})
        return a

    def settle(self):
        time.sleep(0.15)


class TestLinuxStuckKeys(LinuxCase):
    def test_sigterm_mid_text_leaves_nothing_down(self):
        stuck = []
        for i in range(RUNS):
            self.srv.events.clear()
            a = self.start()
            a.send({"op": "text", "s": "ABCDEFGHIJKLMNOPQRSTUVWXYZ" * 9})
            time.sleep(random.uniform(0.05, 0.6))
            a.p.send_signal(signal.SIGTERM)
            rc = a.p.wait(5)
            self.settle()
            down = self.srv.down_keys()
            if down or rc != 0:
                stuck.append((i, down, rc))
        self.assertEqual(stuck, [])

    def test_sighup_releases_and_exits_zero(self):
        a = self.start()
        a.send({"op": "text", "s": "ABCDEFGHIJKLMNOPQRSTUVWXYZ" * 9})
        time.sleep(0.2)
        a.p.send_signal(signal.SIGHUP)
        self.assertEqual(a.p.wait(5), 0)
        self.settle()
        self.assertEqual(self.srv.down_keys(), [])

    def test_sigterm_releases_held_mouse_button(self):
        a = self.start()
        a.send({"op": "button", "b": "l", "down": True})
        a.send({"op": "button", "b": "r", "down": True})
        a.send({"op": "ping", "id": 1})
        self.assertIsNotNone(a.wait_line(lambda o: "pong" in o))
        self.settle()
        self.assertEqual(self.srv.down_keys(), [0x110, 0x111])
        a.p.send_signal(signal.SIGTERM)
        self.assertEqual(a.p.wait(5), 0)
        self.settle()
        self.assertEqual(self.srv.down_keys(), [])

    def test_stdin_eof_releases_buttons(self):
        a = self.start()
        a.send({"op": "button", "b": "m", "down": True})
        a.send({"op": "ping", "id": 1})
        a.wait_line(lambda o: "pong" in o)
        self.assertEqual(a.finish(), 0)
        self.settle()
        self.assertEqual(self.srv.down_keys(), [])

    def test_release_line_cuts_long_text_short(self):
        a = self.start()
        s = MIXED * 3  # 720 chars, at 4 ms a char well over 2 s uninterrupted
        a.send({"op": "text", "s": s})
        time.sleep(0.3)
        a.send({"op": "release"})
        a.send({"op": "ping", "id": 7})
        # the agent answers the ping only once text() returns: the pong comes back with the text cut short, or after all of it
        pong = a.wait_line(lambda o: "pong" in o, timeout=60)
        self.assertEqual(pong, {"pong": 7})
        self.settle()
        typed = [c for t, c, v in self.srv.snapshot() if t == 1 and v == 1 and c != 42]  # one key down per character, shift aside
        self.assertLess(len(typed), len(s), "text kept running after release: all %d characters typed" % len(typed))
        self.assertEqual(self.srv.down_keys(), [])

    def test_text_after_release_still_types(self):
        a = self.start()
        a.send({"op": "release"})
        a.send({"op": "text", "s": "ab"})
        a.send({"op": "ping", "id": 1})
        a.wait_line(lambda o: "pong" in o)
        self.settle()
        codes = [c for t, c, v in self.srv.snapshot() if t == 1 and v == 1]
        self.assertEqual(codes, [30, 48])  # a, b

    def test_click_state_field_is_accepted_and_ignored(self):
        a = self.start()
        a.send({"op": "click", "b": "l", "n": 1, "s": 2})
        a.send({"op": "click", "b": "l", "n": 1})
        a.send({"op": "ping", "id": 1})
        a.wait_line(lambda o: "pong" in o)
        self.settle()
        self.assertEqual([o for o in a.seen if "error" in o], [])
        keys = [(c, v) for t, c, v in self.srv.snapshot() if t == 1]
        self.assertEqual(keys, [(0x110, 1), (0x110, 0)] * 2)

    def test_shifted_chars_still_map(self):
        a = self.start()
        a.send({"op": "text", "s": "A!"})
        a.send({"op": "ping", "id": 1})
        a.wait_line(lambda o: "pong" in o)
        self.settle()
        keys = [(c, v) for t, c, v in self.srv.snapshot() if t == 1]
        self.assertEqual(keys, [(42, 1), (30, 1), (30, 0), (42, 0),
                                (42, 1), (2, 1), (2, 0), (42, 0)])


class TestLinuxRightAlt(LinuxCase):
    """Right Alt is KEY_RIGHTALT (100), never KEY_LEFTALT (56). Held keys are released on every exit path."""

    def sync(self, a, n=1):
        a.send({"op": "ping", "id": n})
        self.assertIsNotNone(a.wait_line(lambda o: "pong" in o))
        self.settle()

    def keys(self):
        return [(c, v) for t, c, v in self.srv.snapshot() if t == 1]

    def test_right_alt_tap_sends_the_right_alt_code_only(self):
        a = self.start()
        a.send({"op": "key", "k": "ralt", "mods": []})
        self.sync(a)
        self.assertEqual(self.keys(), [(100, 1), (100, 0)])

    def test_left_alt_stays_a_different_code(self):
        a = self.start()
        a.send({"op": "key", "k": "tab", "mods": ["alt"]})
        self.sync(a)
        self.assertEqual(self.keys(), [(56, 1), (15, 1), (15, 0), (56, 0)])
        self.assertNotIn(100, [c for c, v in self.keys()])

    def test_hold_keeps_the_key_down_until_released(self):
        a = self.start()
        a.send({"op": "hold", "k": "ralt", "down": True})
        self.sync(a, 1)
        self.assertEqual(self.srv.down_keys(), [100])
        time.sleep(0.3)
        self.assertEqual(self.srv.down_keys(), [100])
        a.send({"op": "hold", "k": "ralt", "down": False})
        self.sync(a, 2)
        self.assertEqual(self.srv.down_keys(), [])
        self.assertEqual(self.keys(), [(100, 1), (100, 0)])

    def test_hold_down_twice_presses_once(self):
        a = self.start()
        a.send({"op": "hold", "k": "ralt", "down": True})
        a.send({"op": "hold", "k": "ralt", "down": True})
        a.send({"op": "hold", "k": "ralt", "down": False})
        self.sync(a)
        self.assertEqual(self.keys(), [(100, 1), (100, 0)])

    def test_other_keys_still_work_while_held(self):
        a = self.start()
        a.send({"op": "hold", "k": "ralt", "down": True})
        a.send({"op": "key", "k": "a", "mods": []})
        self.sync(a)
        self.assertEqual(self.keys(), [(100, 1), (30, 1), (30, 0)])
        self.assertEqual(self.srv.down_keys(), [100])

    def test_sigterm_releases_a_held_key(self):
        a = self.start()
        a.send({"op": "hold", "k": "ralt", "down": True})
        self.sync(a)
        self.assertEqual(self.srv.down_keys(), [100])
        a.p.send_signal(signal.SIGTERM)
        self.assertEqual(a.p.wait(5), 0)
        self.settle()
        self.assertEqual(self.srv.down_keys(), [])

    def test_sighup_stdin_eof_and_release_line_release_a_held_key(self):
        a = self.start()
        a.send({"op": "hold", "k": "ralt", "down": True})
        self.sync(a)
        a.p.send_signal(signal.SIGHUP)
        self.assertEqual(a.p.wait(5), 0)
        self.settle()
        self.assertEqual(self.srv.down_keys(), [])
        b = self.start()
        b.send({"op": "hold", "k": "ralt", "down": True})
        self.sync(b)
        self.assertEqual(self.srv.down_keys(), [100])
        self.assertEqual(b.finish(), 0)
        self.settle()
        self.assertEqual(self.srv.down_keys(), [])
        c = self.start()
        c.send({"op": "hold", "k": "ralt", "down": True})
        self.sync(c)
        self.assertEqual(self.srv.down_keys(), [100])
        c.send({"op": "release"})
        self.sync(c, 2)
        self.assertEqual(self.srv.down_keys(), [])

    def test_unknown_hold_key_is_an_error_and_presses_nothing(self):
        a = self.start()
        a.send({"op": "hold", "k": "nosuchkey", "down": True})
        self.assertIsNotNone(a.wait_line(lambda o: "error" in o))
        self.assertEqual(self.keys(), [])


class TestLinuxBrokenStdout(LinuxCase):
    def test_closed_stdout_still_releases(self):
        a = self.start()
        a.send({"op": "button", "b": "l", "down": True})
        time.sleep(0.15)
        self.assertEqual(self.srv.down_keys(), [0x110])
        a.drop_stdout()  # ssh dropped; agent's stdout now has no reader
        a.send({"op": "ping", "id": 1})
        a.send({"op": "ping", "id": 2})
        time.sleep(0.2)
        self.assertEqual(a.finish(), 0)
        self.settle()
        self.assertEqual(self.srv.down_keys(), [])
        self.assertNotIn(b"Traceback", a.p.stderr.read())


class TestLinuxReconnect(LinuxCase):
    def test_socket_recreated_after_ready(self):
        a = self.start()
        self.srv.close()
        self.srv.events.clear()
        self.srv.open()  # new daemon, new socket inode at the same path
        for i in range(3):
            a.send({"op": "move", "dx": 5, "dy": 0})
        a.send({"op": "ping", "id": 1})
        self.assertIsNotNone(a.wait_line(lambda o: "pong" in o))
        self.settle()
        self.assertEqual([o for o in a.seen if "error" in o], [])
        rel = [(t, c, v) for t, c, v in self.srv.snapshot() if t == 2]
        self.assertEqual(rel, [(2, 0, 5)] * 3)
        self.assertIsNone(a.p.poll())

    def test_socket_gone_is_fatal_exit_3(self):
        a = self.start()
        self.srv.close()  # ydotoold gone for good
        a.send({"op": "move", "dx": 5, "dy": 0})
        err = a.wait_line(lambda o: "error" in o)
        self.assertEqual(err, {"error": "ydotoold gone", "fatal": True})
        self.assertEqual(a.p.wait(5), 3)


# ------------------------------------------------------------------- fake Quartz

FAKE_QUARTZ = r'''
import json, os, sys, time, types

_fd = os.open(os.environ["PAD_FAKE_LOG"], os.O_WRONLY | os.O_APPEND | os.O_CREAT)
_pos = [500.0, 500.0]

class _P:
    def __init__(self, x, y):
        self.x, self.y = x, y
class _R:
    def __init__(self):
        self.origin = _P(0.0, 0.0)
        self.size = types.SimpleNamespace(width=1920.0, height=1080.0)

Q = types.ModuleType("Quartz")
for _n, _v in dict(
    kCGEventLeftMouseDown=1, kCGEventLeftMouseUp=2, kCGEventRightMouseDown=3,
    kCGEventRightMouseUp=4, kCGEventMouseMoved=5, kCGEventLeftMouseDragged=6,
    kCGEventRightMouseDragged=7, kCGEventOtherMouseDown=25, kCGEventOtherMouseUp=26,
    kCGEventOtherMouseDragged=27, kCGEventFlagMaskShift=1 << 17,
    kCGEventFlagMaskControl=1 << 18, kCGEventFlagMaskAlternate=1 << 19,
    kCGEventFlagMaskCommand=1 << 20, kCGMouseEventClickState=1,
    kCGScrollEventUnitPixel=0, kCGHIDEventTap=0).items():
    setattr(Q, _n, _v)

def CGGetActiveDisplayList(mx, a, b): return (0, [1], 1)
def CGDisplayBounds(i): return _R()
def CGMainDisplayID(): return 1
def CGEventCreate(src): return {"t": "loc"}
def CGEventGetLocation(e): return _P(_pos[0], _pos[1])
def CGEventCreateMouseEvent(src, kind, xy, b): return {"t": "mouse", "kind": kind, "xy": list(xy), "button": b, "state": 0}
def CGEventSetIntegerValueField(e, field, v): e["state"] = v
def CGEventCreateScrollWheelEvent(src, unit, n, dy, dx): return {"t": "scroll", "dy": dy, "dx": dx}
def CGEventCreateKeyboardEvent(src, code, down): return {"t": "key", "code": code, "down": bool(down), "flags": 0}
def CGEventSetFlags(e, f): e["flags"] = f
def CGEventKeyboardSetUnicodeString(e, n, s): e["uni_n"] = n; e["uni"] = s
def CGEventPost(tap, e):
    if e["t"] == "mouse":
        _pos[0], _pos[1] = e["xy"]
    os.write(_fd, (json.dumps(e) + "\n").encode())
    time.sleep(0.0005)
for _f in (CGGetActiveDisplayList, CGDisplayBounds, CGMainDisplayID, CGEventCreate,
           CGEventGetLocation, CGEventCreateMouseEvent, CGEventSetIntegerValueField,
           CGEventCreateScrollWheelEvent, CGEventCreateKeyboardEvent, CGEventSetFlags,
           CGEventKeyboardSetUnicodeString, CGEventPost):
    setattr(Q, _f.__name__, _f)

class _NSEvent:
    @staticmethod
    def otherEventWithType_location_modifierFlags_timestamp_windowNumber_context_subtype_data1_data2_(*a):
        return types.SimpleNamespace(CGEvent=lambda: {"t": "media", "data1": a[7]})
A = types.ModuleType("AppKit")
A.NSEvent = _NSEvent
sys.modules["Quartz"] = Q
sys.modules["AppKit"] = A
'''

BOOT = FAKE_QUARTZ + r'''
_p = sys.argv[1]
exec(compile(open(_p).read(), _p, "exec"), {"__name__": "__main__"})
'''

MOUSE_DOWN = {1: "l", 3: "r", 25: "m"}
MOUSE_UP = {2: "l", 4: "r", 26: "m"}
MODCODES = {55: "cmd", 59: "ctrl", 58: "alt", 56: "shift"}


class MacCase(unittest.TestCase):
    def setUp(self):
        self.dir = scratch()
        self.log = os.path.join(self.dir, "events.jsonl")
        open(self.log, "w").close()
        self.agents = []

    def tearDown(self):
        for a in self.agents:
            a.cleanup()

    def start(self):
        env = dict(os.environ, PAD_FAKE_LOG=self.log)
        a = Agent([sys.executable, "-u", "-c", BOOT, MAC], env)
        self.agents.append(a)
        hello = a.wait_line()
        self.assertEqual(hello.get("ready"), True)
        self.assertEqual(hello.get("os"), "macos")
        self.assertEqual(hello.get("screen"), [1920, 1080])
        return a

    def events(self):
        with open(self.log) as f:
            return [json.loads(x) for x in f if x.strip()]

    def stuck(self):
        keys, btns = set(), set()
        for e in self.events():
            if e["t"] == "key":
                (keys.add if e["down"] else keys.discard)(e["code"])
            elif e["t"] == "mouse":
                if e["kind"] in MOUSE_DOWN:
                    btns.add(MOUSE_DOWN[e["kind"]])
                elif e["kind"] in MOUSE_UP:
                    btns.discard(MOUSE_UP[e["kind"]])
        return sorted(keys), sorted(btns)

    def settle(self):
        time.sleep(0.15)


class TestMacStuckKeys(MacCase):
    def test_sigterm_mid_modified_keys_leaves_nothing_down(self):
        bad = []
        for i in range(RUNS):
            open(self.log, "w").close()
            a = self.start()
            a.send({"op": "button", "b": "l", "down": True})
            for _ in range(60):
                a.send({"op": "key", "k": "a", "mods": ["ctrl", "shift", "alt", "cmd"]})
            time.sleep(random.uniform(0.02, 0.15))
            a.p.send_signal(signal.SIGTERM)
            rc = a.p.wait(5)
            self.settle()
            st = self.stuck()
            if st != ([], []) or rc != 0:
                bad.append((i, st, rc))
        self.assertEqual(bad, [])

    def test_sigterm_mid_text_leaves_nothing_down(self):
        bad = []
        for i in range(RUNS):
            open(self.log, "w").close()
            a = self.start()
            a.send({"op": "text", "s": MIXED * 6})
            time.sleep(random.uniform(0.02, 0.2))
            a.p.send_signal(signal.SIGTERM)
            rc = a.p.wait(5)
            self.settle()
            st = self.stuck()
            if st != ([], []) or rc != 0:
                bad.append((i, st, rc))
        self.assertEqual(bad, [])

    def test_sighup_releases_and_exits_zero(self):
        a = self.start()
        a.send({"op": "button", "b": "r", "down": True})
        a.send({"op": "ping", "id": 1})
        a.wait_line(lambda o: "pong" in o)
        self.assertEqual(self.stuck(), ([], ["r"]))
        a.p.send_signal(signal.SIGHUP)
        self.assertEqual(a.p.wait(5), 0)
        self.settle()
        self.assertEqual(self.stuck(), ([], []))

    def test_release_op_releases_buttons_and_stops_text(self):
        a = self.start()
        s = MIXED * 300  # 72,000 chars: 3,600 chunks of 20, two posts each, over 3.6 s uninterrupted
        a.send({"op": "button", "b": "m", "down": True})
        a.send({"op": "text", "s": s})
        time.sleep(0.2)
        a.send({"op": "release"})
        a.send({"op": "ping", "id": 9})
        # the agent answers the ping only once text() returns: the pong comes back with the text cut short, or after all of it
        self.assertEqual(a.wait_line(lambda o: "pong" in o, timeout=60), {"pong": 9})
        self.settle()
        typed = sum(len(e.get("uni", "")) for e in self.events() if e["t"] == "key" and e["down"])
        self.assertLess(typed, len(s), "text kept running after release: all %d characters typed" % typed)
        self.assertEqual(self.stuck(), ([], []))

    def test_key_failure_between_press_and_release_still_releases_mods(self):
        a = self.start()
        a.send({"op": "key", "k": "nosuchkey", "mods": ["shift", "ctrl"]})
        a.send({"op": "ping", "id": 1})
        a.wait_line(lambda o: "pong" in o)
        self.settle()
        self.assertEqual(self.stuck(), ([], []))

    def test_key_sequence_unchanged(self):
        a = self.start()
        a.send({"op": "key", "k": "a", "mods": ["shift", "cmd"]})
        a.send({"op": "ping", "id": 1})
        a.wait_line(lambda o: "pong" in o)
        seq = [(e["code"], e["down"]) for e in self.events() if e["t"] == "key"]
        self.assertEqual(seq, [(56, True), (55, True), (0, True), (0, False), (55, False), (56, False)])


class TestMacRightAlt(MacCase):
    """Right Option is key code 61 carrying the Alternate flag; left Option stays 58."""
    ALT = 1 << 19

    def keyevents(self):
        return [(e["code"], e["down"], e["flags"]) for e in self.events() if e["t"] == "key"]

    def sync(self, a, n=1):
        a.send({"op": "ping", "id": n})
        self.assertIsNotNone(a.wait_line(lambda o: "pong" in o))
        self.settle()

    def test_tap_is_right_option_with_the_alternate_flag(self):
        a = self.start()
        a.send({"op": "key", "k": "ralt", "mods": []})
        self.sync(a)
        self.assertEqual(self.keyevents(), [(61, True, self.ALT), (61, False, 0)])

    def test_left_option_stays_58(self):
        a = self.start()
        a.send({"op": "key", "k": "tab", "mods": ["alt"]})
        self.sync(a)
        codes = [c for c, d, f in self.keyevents()]
        self.assertEqual(codes, [58, 48, 48, 58])
        self.assertNotIn(61, codes)

    def test_hold_keeps_it_down_until_released(self):
        a = self.start()
        a.send({"op": "hold", "k": "ralt", "down": True})
        self.sync(a, 1)
        self.assertEqual(self.stuck(), ([61], []))
        a.send({"op": "hold", "k": "ralt", "down": False})
        self.sync(a, 2)
        self.assertEqual(self.stuck(), ([], []))
        self.assertEqual(self.keyevents(), [(61, True, self.ALT), (61, False, 0)])

    def test_hold_down_twice_presses_once(self):
        a = self.start()
        a.send({"op": "hold", "k": "ralt", "down": True})
        a.send({"op": "hold", "k": "ralt", "down": True})
        a.send({"op": "hold", "k": "ralt", "down": False})
        self.sync(a)
        self.assertEqual(len(self.keyevents()), 2)

    def test_held_right_option_flags_every_other_key(self):
        """A held Right Option is a held Alternate: keys pressed meanwhile carry the flag, as on a real keyboard."""
        SHIFT = 1 << 17
        a = self.start()
        a.send({"op": "hold", "k": "ralt", "down": True})
        a.send({"op": "key", "k": "a", "mods": []})
        a.send({"op": "key", "k": "c", "mods": ["shift"]})
        a.send({"op": "key", "k": "tab", "mods": ["alt"]})
        a.send({"op": "hold", "k": "ralt", "down": False})
        a.send({"op": "key", "k": "a", "mods": []})
        self.sync(a)
        ev = self.keyevents()
        self.assertEqual(ev[0], (61, True, self.ALT))
        self.assertEqual(ev[1:3], [(0, True, self.ALT), (0, False, self.ALT)])  # plain key: Alternate rides along
        self.assertEqual(ev[3:7], [(56, True, self.ALT | SHIFT), (8, True, self.ALT | SHIFT), (8, False, self.ALT | SHIFT), (56, False, self.ALT)])
        # left Option while Right Option is down: its release must not drop the Alternate flag the held key still owns
        self.assertEqual(ev[7:11], [(58, True, self.ALT), (48, True, self.ALT), (48, False, self.ALT), (58, False, self.ALT)])
        self.assertEqual(ev[11], (61, False, 0))  # the key-up of Right Option carries no flag of its own
        self.assertEqual(ev[12:], [(0, True, 0), (0, False, 0)])  # and nothing leaks after the release
        self.assertEqual(self.stuck(), ([], []))

    def test_forced_release_clears_the_held_flag(self):
        a = self.start()
        a.send({"op": "hold", "k": "ralt", "down": True})
        a.send({"op": "release"})
        a.send({"op": "key", "k": "a", "mods": []})
        self.sync(a)
        ev = self.keyevents()
        self.assertEqual(ev[0], (61, True, self.ALT))
        self.assertEqual(ev[1], (61, False, 0))
        self.assertEqual(ev[2:], [(0, True, 0), (0, False, 0)])

    def test_sigterm_eof_and_release_let_go_of_a_held_key(self):
        a = self.start()
        a.send({"op": "hold", "k": "ralt", "down": True})
        self.sync(a)
        self.assertEqual(self.stuck(), ([61], []))
        a.p.send_signal(signal.SIGTERM)
        self.assertEqual(a.p.wait(5), 0)
        self.settle()
        self.assertEqual(self.stuck(), ([], []))
        open(self.log, "w").close()
        b = self.start()
        b.send({"op": "hold", "k": "ralt", "down": True})
        self.sync(b)
        self.assertEqual(b.finish(), 0)
        self.settle()
        self.assertEqual(self.stuck(), ([], []))
        open(self.log, "w").close()
        c = self.start()
        c.send({"op": "hold", "k": "ralt", "down": True})
        self.sync(c)
        c.send({"op": "release"})
        self.sync(c, 2)
        self.assertEqual(self.stuck(), ([], []))


class TestMacBrokenStdout(MacCase):
    def test_closed_stdout_still_releases(self):
        a = self.start()
        a.send({"op": "button", "b": "l", "down": True})
        time.sleep(0.15)
        self.assertEqual(self.stuck(), ([], ["l"]))
        a.drop_stdout()
        a.send({"op": "ping", "id": 1})
        a.send({"op": "ping", "id": 2})
        time.sleep(0.2)
        self.assertEqual(a.finish(), 0)
        self.settle()
        self.assertEqual(self.stuck(), ([], []))
        self.assertNotIn(b"Traceback", a.p.stderr.read())


def utf16_len(s):
    return len(s.encode("utf-16-le")) // 2


class TestMacTextChunks(MacCase):
    def chunks(self, text):
        a = self.start()
        a.send({"op": "text", "s": text})
        a.send({"op": "ping", "id": 1})
        a.wait_line(lambda o: "pong" in o, timeout=10)
        self.settle()
        evs = [e for e in self.events() if e["t"] == "key" and "uni" in e]
        downs = [e for e in evs if e["down"]]
        ups = [e for e in evs if not e["down"]]
        self.assertEqual([e["uni"] for e in downs], [e["uni"] for e in ups])
        return downs

    def check(self, text):
        downs = self.chunks(text)
        for e in downs:
            s = e["uni"]
            s.encode("utf-8")  # raises on a lone surrogate
            self.assertLessEqual(e["uni_n"], 20, repr(s))
            self.assertEqual(e["uni_n"], utf16_len(s), repr(s))
            self.assertGreater(len(s), 0)
        self.assertEqual("".join(e["uni"] for e in downs), text.replace("\r", "").replace("\n", ""))
        return downs

    def test_ascii_long(self):
        downs = self.check("x" * 45)
        self.assertTrue(all(e["uni_n"] <= 20 for e in downs))

    def test_emoji_run_never_exceeds_20_units(self):
        downs = self.check("\U0001F600" * 30)  # 60 units total
        self.assertGreaterEqual(len(downs), 3)

    def test_pair_straddling_the_limit_not_split(self):
        # 19 BMP chars then an astral char: the pair would occupy units 20-21.
        downs = self.check("a" * 19 + "\U0001F600" + "b" * 19 + "\U0001F600")
        self.assertEqual(downs[0]["uni"], "a" * 19)

    def test_mixed_with_newline(self):
        text = "h\u00e9llo \U0001F600 world " * 5 + "\n" + "\u00e9\U0001F601" * 15
        self.check(text)
        enters = [e for e in self.events() if e["t"] == "key" and e["code"] == 36 and e["down"]]
        self.assertEqual(len(enters), 1)


class TestMacClickState(MacCase):
    def click_events(self, op):
        a = self.start()
        a.send(op)
        a.send({"op": "ping", "id": 1})
        a.wait_line(lambda o: "pong" in o)
        self.settle()
        return [(e["kind"], e["state"]) for e in self.events() if e["t"] == "mouse"]

    def test_default_state_is_one(self):
        self.assertEqual(self.click_events({"op": "click", "b": "l", "n": 1}), [(1, 1), (2, 1)])

    def test_n2_without_s_counts_up_from_one(self):
        self.assertEqual(self.click_events({"op": "click", "b": "l", "n": 2}),
                         [(1, 1), (2, 1), (1, 2), (2, 2)])

    def test_s2_posts_click_state_2_on_down_and_up(self):
        self.assertEqual(self.click_events({"op": "click", "b": "l", "n": 1, "s": 2}), [(1, 2), (2, 2)])

    def test_s2_n2_counts_up_from_s(self):
        self.assertEqual(self.click_events({"op": "click", "b": "r", "n": 2, "s": 2}),
                         [(3, 2), (4, 2), (3, 3), (4, 3)])


if __name__ == "__main__":
    unittest.main()
