#!/usr/bin/env python3
"""Runs ON the target host (locally or piped over ssh). Fixed allowlist only.
Usage: helper.py <cmd> [arg]. Prints one JSON object. Args are validated here."""
import json
import os
import shutil
import subprocess
import sys
import glob
import re
import time

UID = os.getuid()
os.environ.setdefault("XDG_RUNTIME_DIR", f"/run/user/{UID}")
os.environ["PATH"] = "/usr/local/bin:/usr/bin:/bin:/usr/share/omarchy/bin:" + os.path.expanduser("~/.local/bin")
# Same discovery as keybinds.rs BINDS_SCRIPT: keep an inherited signature while its socket is live,
# else the newest hypr/* directory that holds a live .socket.sock (a crashed session leaves a dead one).
def live_sig(sig):
    return bool(sig) and os.path.exists(f"/run/user/{UID}/hypr/{sig}/.socket.sock")
if not live_sig(os.environ.get("HYPRLAND_INSTANCE_SIGNATURE", "")):
    d = [x for x in sorted(glob.glob(f"/run/user/{UID}/hypr/*/"), key=os.path.getmtime) if os.path.exists(x + ".socket.sock")]
    if d:
        os.environ["HYPRLAND_INSTANCE_SIGNATURE"] = os.path.basename(d[-1].rstrip("/"))

def run(argv, t=6):
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=t)
        return p.returncode, p.stdout.strip()
    except Exception as e:
        return 127, str(e)

def out(o): print(json.dumps(o)); sys.exit(0)

def players():
    rc, o = run(["busctl", "--user", "list", "--no-legend"])
    if rc != 0: raise RuntimeError("Media players unavailable.")
    return [line.split()[0] for line in o.splitlines() if line.startswith("org.mpris.MediaPlayer2.")]

def prop(bus, p):
    rc, o = run(["busctl", "--user", "--json=short", "get-property", bus,
                 "/org/mpris/MediaPlayer2", "org.mpris.MediaPlayer2.Player", p])
    if rc != 0: raise RuntimeError("Media state unavailable.")
    try: value = json.loads(o)["data"]
    except (ValueError, KeyError, TypeError):
        raise RuntimeError("Media state unavailable.") from None
    if ((p == "PlaybackStatus" and value not in ("Playing", "Paused", "Stopped"))
            or (p == "Metadata" and not isinstance(value, dict))):
        raise RuntimeError("Media state unavailable.")
    return value

def pick():
    best = None
    for b in players():
        st = prop(b, "PlaybackStatus")
        if st == "Playing": return b, st
        if best is None: best = (b, st)
    return best or (None, None)

def media(action=None):
    applied = False
    try:
        bus, st = pick()
        if not bus: return {"player": None, "status": "none"}
        if action:
            m = {"play-pause": "PlayPause", "next": "Next", "prev": "Previous"}[action]
            rc, _ = run(["busctl", "--user", "call", bus, "/org/mpris/MediaPlayer2",
                         "org.mpris.MediaPlayer2.Player", m])
            if rc != 0: return {"ok": False, "error": "Media command failed."}
            applied = True
        md = prop(bus, "Metadata")
        status = prop(bus, "PlaybackStatus")
    except RuntimeError as e:
        if applied:
            name = bus[len("org.mpris.MediaPlayer2."):].split(".")[0]
            return {"ok": True, "player": name, "status": None,
                    "title": None, "artist": None, "art": ""}
        return {"ok": False, "error": str(e)}
    def g(k):
        return (md.get(k) or {}).get("data")
    art = g("mpris:artUrl") or ""
    if not art.startswith("https://"): art = ""
    artist = g("xesam:artist")
    if isinstance(artist, list): artist = ", ".join(artist)
    name = bus[len("org.mpris.MediaPlayer2."):].split(".")[0]
    return {"player": name, "status": status,
            "title": g("xesam:title"), "artist": artist, "art": art}

def vol():
    rc, o = run(["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"])
    m = re.fullmatch(r"Volume:\s+(\d+(?:\.\d+)?)\s*(\[MUTED\])?", o)
    if rc != 0 or not m:
        return {"volume": None, "muted": None, "ok": False, "error": "Volume unavailable."}
    return {"volume": round(float(m.group(1)) * 100), "muted": bool(m.group(2)), "ok": True}

def vol_set(value):
    rc, _ = run(["wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", f"{value}%"])
    if rc != 0: return {"ok": False, "error": "Volume command failed."}
    state = vol()
    if not state["ok"]: return {"volume": None, "muted": None, "ok": True}
    return state

def mute():
    rc, _ = run(["wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "toggle"])
    if rc != 0: return {"ok": False, "error": "Mute command failed."}
    state = vol()
    # The toggle already applied. A failed read must not invite a reversing retry.
    if not state["ok"]: return {"volume": None, "muted": None, "ok": True}
    return state

def lock():
    try:
        child = subprocess.Popen(["omarchy-system-lock"], start_new_session=True,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try: rc = child.wait(timeout=1.5)
        except subprocess.TimeoutExpired: rc = child.poll()
    except OSError:
        return {"ok": False, "error": "Lock did not start."}
    if rc not in (None, 0): return {"ok": False, "error": "Lock command failed."}
    # This confirms startup, not the compositor's eventual locked state.
    return {"ok": True}

def stats():
    r = {}
    try:
        r["load"] = [float(x) for x in open("/proc/loadavg").read().split()[:3]]
        mi = {line.split(":")[0]: int(line.split()[1]) for line in open("/proc/meminfo")}
        r["ram_pct"] = round(100 * (1 - mi["MemAvailable"] / mi["MemTotal"]))
        r["ram_gb"] = round(mi["MemTotal"] / 1048576, 1)
        a = open("/proc/stat").readline().split()[1:]
        r["_cpu"] = [int(x) for x in a]
    except Exception: pass
    rc, o = run(["nvidia-smi", "--query-gpu=temperature.gpu,utilization.gpu,name", "--format=csv,noheader,nounits"], 4)
    if rc == 0 and o:
        p = [x.strip() for x in o.splitlines()[0].split(",")]
        r["gpu_temp"], r["gpu_util"], r["gpu_name"] = int(p[0]), int(p[1]), p[2]
    try:
        ts = []
        for z in glob.glob("/sys/class/thermal/thermal_zone*/"):
            if open(z + "type").read().strip() in ("x86_pkg_temp", "k10temp", "coretemp"):
                ts.append(int(open(z + "temp").read()) / 1000)
        if ts: r["cpu_temp"] = round(max(ts))
    except Exception: pass
    r["host"] = os.uname().nodename
    return r

def hypr(lua):
    rc, o = run(["hyprctl", "eval", lua])
    return {"ok": rc == 0 and "error" not in o.lower(), "out": o[:200]}

LAUNCH = {"terminal": "omarchy-launch-terminal", "browser": "omarchy-launch-browser",
          "hermes": "hermes-desktop", "files": "omarchy-launch-nautilus",
          "spotify": "omarchy-launch-or-focus spotify", "obsidian": "omarchy-launch-or-focus obsidian",
          "menu": "omarchy-menu", "nightlight": "omarchy-toggle-nightlight"}

# Commerce tab: read-only pages in the Omarchy web-app shell (no ordering, no account change). URLs are fixed here, never sent by the phone.
WEBAPP = {"amazon-orders": "https://www.amazon.com/your-orders/orders",
          "amazon-returns": "https://www.amazon.com/gp/css/returns/homepage.html",
          "commerce-ink": "https://www.commerceink.com/"}
# The local operator dashboard exists on pc-desktop only (webapp-open starts its user service and waits for the port).
DASHBOARD = os.path.expanduser("~/.local/bin/webapp-open")

def commerce(name):
    if name in WEBAPP:
        if not shutil.which("omarchy-launch-webapp"):
            return {"ok": False, "error": "The Omarchy web-app launcher is not installed on this computer."}
        return hypr(f'hl.dispatch(hl.dsp.exec_cmd("omarchy-launch-webapp {WEBAPP[name]}"))')
    if not os.access(DASHBOARD, os.X_OK):
        return {"ok": False, "error": "The Commerce Ink dashboard is only set up on pc-desktop."}
    return hypr(f'hl.dispatch(hl.dsp.exec_cmd("{DASHBOARD} 4102 webapp-commerce-ink-dashboard-local.service / 60"))')

# Shell plugins the Apps and Spaces keys open. A machine without the plugin falls back (Apps) or says so (Spaces); nothing is guessed.
APP_GRID = "matthewjaybarr.app-grid"
SPACEVIEW = "ecylmz.spaceview"

def shell_has(plugin):
    rc, o = run(["omarchy-shell", "shell", "listPlugins"])
    return rc == 0 and plugin in o

def apps():
    """The app grid (Super+Alt+Space here); the stock Apps menu where the plugin is not installed."""
    if shell_has(APP_GRID):
        return hypr(f'hl.dispatch(hl.dsp.exec_cmd("omarchy-shell shell toggle {APP_GRID} \'{{}}\'"))')
    return hypr('hl.dispatch(hl.dsp.exec_cmd("omarchy-menu toggle apps"))')

def spaces():
    """The workspace overview (Super+F4, Shift+Tab)."""
    if shell_has(SPACEVIEW):
        return hypr(f'hl.dispatch(hl.dsp.exec_cmd("omarchy-shell shell toggle {SPACEVIEW}"))')
    return {"ok": False, "error": "The workspace overview is not installed on this computer."}

# Window classes become short plain names. Only the class is read: a window title can hold a page or a message, so it never leaves the machine.
APP_ALIAS = {"gamescope": "Game", "fleet-mirror": "Mirror"}
WS_SHOWN = 5

def app_name(cls):
    c = (cls or "").strip()
    if not c: return None
    if c in APP_ALIAS: return APP_ALIAS[c]
    if re.match(r"^steam_app_", c, re.I): return "Game"
    c = c.split(".")[-1] if "." in c else c
    c = re.sub(r"[^A-Za-z0-9 _+-]", "", c).replace("_", " ").replace("-", " ").strip()[:20]
    return (c[:1].upper() + c[1:]) if c else None

def ws_list():
    """Workspaces 1-5 with the apps open on each, the active one, and what sits on any other workspace."""
    rc, o = run(["hyprctl", "workspaces", "-j"]); rc2, o2 = run(["hyprctl", "clients", "-j"]); o3 = run(["hyprctl", "activeworkspace", "-j"])[1]
    try:
        clients = json.loads(o2); active = json.loads(o3).get("id")
        json.loads(o)
    except Exception:
        return {"ok": False, "error": "Workspaces are not available."}
    if rc != 0 or rc2 != 0 or not isinstance(clients, list):
        return {"ok": False, "error": "Workspaces are not available."}
    by = {i: [] for i in range(1, WS_SHOWN + 1)}; other = []
    for c in clients:
        if not isinstance(c, dict) or c.get("mapped") is False or c.get("hidden"): continue
        n = app_name(c.get("class"))
        if not n: continue
        w = (c.get("workspace") or {}).get("id")
        (by[w] if w in by else other).append(n)
    def pack(names):
        u = list(dict.fromkeys(names))
        return {"n": len(names), "apps": u[:3], "more": max(0, len(u) - 3)}
    return {"ok": True, "active": active if active in by else None, "ws": [dict(pack(by[i]), id=i) for i in by], "other": pack(other)}

def screenshot():
    """Full-screen grim capture to ~/Pictures (omarchy-cmd-screenshot does not exist on this Omarchy)."""
    d = os.path.expanduser("~/Pictures"); os.makedirs(d, exist_ok=True)
    f = os.path.join(d, "deck-" + time.strftime("%Y%m%d-%H%M%S") + ".png")
    env = dict(os.environ)
    if "WAYLAND_DISPLAY" not in env:
        socks = sorted(glob.glob(f"/run/user/{UID}/wayland-[0-9]"))
        if socks: env["WAYLAND_DISPLAY"] = os.path.basename(socks[0])
    p = subprocess.run(["grim", f], capture_output=True, text=True, timeout=10, env=env)
    return {"ok": p.returncode == 0, "file": os.path.basename(f)}

def main():
    a = sys.argv[1:]
    c = a[0] if a else ""
    if c == "media": out(media())
    if c == "media-act" and a[1] in ("play-pause", "next", "prev"): out(media(a[1]))
    if c == "vol": out(vol())
    if c == "vol-set" and re.fullmatch(r"\d{1,3}", a[1]) and int(a[1]) <= 100:
        out(vol_set(int(a[1])))
    if c == "mute": out(mute())
    if c == "stats": out(stats())
    if c == "ws" and re.fullmatch(r"[1-5]", a[1]):
        out(hypr(f'hl.dispatch(hl.dsp.focus({{ workspace = "{a[1]}" }}))'))
    if c == "ws-now":
        rc, o = run(["hyprctl", "activeworkspace", "-j"])
        try: out({"ws": json.loads(o)["id"]})
        except Exception: out({"ws": None})
    if c == "ws-list": out(ws_list())
    if c == "launch" and a[1] == "apps": out(apps())
    if c == "launch" and a[1] == "spaces": out(spaces())
    if c == "launch" and a[1] in LAUNCH:
        out(hypr(f'hl.dispatch(hl.dsp.exec_cmd("{LAUNCH[a[1]]}"))'))
    if c == "launch" and (a[1] in WEBAPP or a[1] == "commerce-ink-dashboard"): out(commerce(a[1]))
    if c == "mvws" and re.fullmatch(r"[1-5]", a[1]):
        out(hypr(f'hl.dispatch(hl.dsp.window.move({{ workspace = "{a[1]}" }}))'))
    if c == "screenshot": out(screenshot())
    if c == "lock": out(lock())
    if c == "ping": out({"ok": True, "host": os.uname().nodename})
    out({"error": "bad command"})
if __name__ == "__main__": main()
