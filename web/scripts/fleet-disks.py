#!/usr/bin/env python3
"""Fleet drive snapshot for the bar's storage panel.

Reads `df -P -k` on pc-desktop and, over SSH (BatchMode, read-only), on
mac-mini, spark, gx10 (Ascent) and mesh (Dell). Keeps one row per physical
volume and writes ~/.local/state/fleet-disks.json atomically. A host that
cannot be checked keeps its last good rows. reachable/ok are true after an
answered disk check and null with an error when it raised; false is reserved
for an answered reachability check, which this collector does not perform.
Exit 0 when every host answered, 2 when any host was not checked.
"""
import json
import os
import subprocess
import time

STATE = os.path.expanduser(os.environ.get("FLEET_DISKS_STATE", "~/.local/state/fleet-disks.json"))
HOSTS = [
    ("pc-desktop", None),
    ("Mac Mini", "mac-mini"),
    ("Spark", "spark"),
    ("Ascent", "gx10"),
    ("Dell", "mesh"),
]
MIN_KB = 10 * 1024 * 1024  # ignore volumes under 10 GB
MAC_KEEP = ("/System/Volumes/Data", "/Volumes/")
LABELS = {"/System/Volumes/Data": "Macintosh HD"}
# Local df must never stat network or FUSE mounts: a statfs on the rclone Google Drive mounts is an API call
# (about 2 s idle, far longer when Drive throttles) and pushed this host past its timeout, so the panel
# reported pc-desktop itself as unreachable. Only /dev/ rows are kept anyway, so nothing real is lost.
LOCAL_DF = ["df", "-P", "-k", "-l", "-x", "fuse.rclone", "-x", "fuse.sshfs", "-x", "fuse.gvfsd-fuse",
            "-x", "fuse.portal", "-x", "autofs", "-x", "overlay", "-x", "tmpfs", "-x", "devtmpfs"]
# Mounts that only hold a swapfile (btrfs /swap subvolume). df reports the whole parent filesystem there, so
# the row duplicated disk-m2 under the wrong name. Skip them; the data mount of the same device is kept.
SWAP_MOUNTS = ("/swap",)


def df(ssh_host):
    cmd = LOCAL_DF
    if ssh_host:
        # The Mini's default locale is C, which prints non-ASCII volume names (Backups of Tanner’s Mac mini)
        # as "?". Ask for UTF-8 on the remote side and decode the bytes ourselves, never the local locale.
        cmd = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", ssh_host, "LC_ALL=en_US.UTF-8 df -P -k -l"]
    out = subprocess.run(cmd, capture_output=True, timeout=20, check=True).stdout
    return out.decode("utf-8", errors="replace")


def parse(text, is_mac):
    rows, seen = [], set()
    for line in text.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 6 or not parts[0].startswith("/dev/"):
            continue
        dev = parts[0]
        mount = " ".join(parts[5:])
        try:
            total, used, avail = int(parts[1]), int(parts[2]), int(parts[3])
        except ValueError:
            continue
        if total < MIN_KB or dev in seen or mount in SWAP_MOUNTS:
            continue
        if is_mac and not mount.startswith(MAC_KEEP):
            continue
        if is_mac and mount == "/Volumes/Shared Support":
            continue
        if is_mac and mount == "/System/Volumes/Data":
            used = total - avail  # APFS: the container's real use, not one volume's
        seen.add(dev)
        label = LABELS.get(mount) or (mount.rsplit("/", 1)[-1] if mount.startswith("/Volumes/") else ("System" if mount == "/" else mount.rsplit("/", 1)[-1]))
        # Match df: reserved blocks count as neither used nor free.
        pct = round(100 * used / (used + avail)) if used + avail else 0
        rows.append({"mount": mount, "label": label, "total": total, "used": used,
                     "avail": avail, "pct": pct})
    return rows


def main():
    try:
        with open(STATE) as fh:
            old = {h["host"]: h for h in json.load(fh).get("hosts", [])}
    except Exception:
        old = {}
    hosts, stale = [], False
    for name, ssh_host in HOSTS:
        try:
            drives = parse(df(ssh_host), is_mac=ssh_host == "mac-mini")
            hosts.append({"host": name, "ok": True, "reachable": True,
                          "checked": int(time.time()), "drives": drives})
        except Exception as exc:
            stale = True
            prev = old.get(name, {})
            hosts.append({"host": name, "ok": None, "reachable": None, "error": type(exc).__name__,
                          "checked": prev.get("checked"), "drives": prev.get("drives", [])})
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    tmp = STATE + ".tmp"
    with open(tmp, "w") as fh:
        json.dump({"generated_at": int(time.time()), "hosts": hosts}, fh)
    os.replace(tmp, STATE)
    return 2 if stale else 0


if __name__ == "__main__":
    raise SystemExit(main())
