"""Read the local deck feed files. No network, no writes, no secrets.

Every feed is a JSON document written by a collector under
``~/.meshvault/status``. Tools return the payload plus a ``source`` block so a
caller can always see which file answered and how old it is.
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path

STATUS_ROOT = Path(os.environ.get("DECK_FEEDS_ROOT") or (Path.home() / ".meshvault" / "status")).expanduser()
DECK_DIR = STATUS_ROOT / "deck"
HOUSE_DIR = STATUS_ROOT / "house-feeds"

# Feed name -> search order. House feeds are the fresher copies of the public ones.
FEEDS: dict[str, tuple[Path, ...]] = {
    "jobs": (DECK_DIR,),
    # Per-person jobs feeds written by `deck-feed-jobs --person NAME` (same schema as jobs.json).
    "jobs-casey": (DECK_DIR,),
    "jobs-riley": (DECK_DIR,),
    "jobs-morgan": (DECK_DIR,),
    "jobs-insight": (DECK_DIR,),
    "interest-profile": (DECK_DIR,),
    # Freelance gigs, contracts and public RFPs from ~/ops/bin/deck-feed-gigs (registry ~/ops/gigs/sites.yaml).
    "gigs": (DECK_DIR,),
    "launch": (DECK_DIR,),
    "realestate": (HOUSE_DIR, DECK_DIR),
    # Markets > Commercial deal desk, written by cre_deals.build() at the end of each deck-feed-realestate run.
    "cre-deals": (DECK_DIR,),
    # National dataset v2 manifest (states, metros, field catalog, segments); weekly collector, see FILES below.
    "national-v2": (HOUSE_DIR,),
    "surf": (HOUSE_DIR, DECK_DIR),
    "hockey": (HOUSE_DIR, DECK_DIR),
    "markets": (HOUSE_DIR, DECK_DIR),
    # Shop tab deals and movers, written hourly by `python -m shoptrends feed`.
    "ecom": (HOUSE_DIR,),
    "markets-calendar": (HOUSE_DIR, DECK_DIR),
    "fleet": (DECK_DIR,),
    "cluster": (DECK_DIR,),
    "cluster-improve": (DECK_DIR,),
    "schedules": (DECK_DIR,),
    "stalls": (DECK_DIR,),
    "dev": (DECK_DIR,),
    "replyblock": (DECK_DIR,),
    "rankwatch": (DECK_DIR,),
    "products": (DECK_DIR,),
    "testflight": (DECK_DIR,),
    "tailscale": (DECK_DIR,),
    "deadlines": (DECK_DIR,),
    "onthisday": (DECK_DIR,),
    "photoyears": (DECK_DIR,),
    "gitsync": (DECK_DIR,),
    "perfloop": (DECK_DIR,),
    "watch": (DECK_DIR,),
    "device-models": (DECK_DIR,),
    "listings": (DECK_DIR,),
    "markets-filings": (DECK_DIR,),
    # Shared feed contract (2026-10-30): written straight under the status root, ISO `generated_at`, no `refresh`.
    "travel-deals": (STATUS_ROOT,),
    "outdoors": (STATUS_ROOT,),
    "life": (STATUS_ROOT,),
    "history-goodnews": (STATUS_ROOT,),
}

# A feed whose file is not `<name>.json` straight under its directory.
FILES: dict[str, str] = {
    "national-v2": "national-v2/manifest.json",
}

# Feeds whose `sources` key holds the collector's per-source rows, not the short source list the source block carries.
NO_FEED_SRC = frozenset({"national-v2"})

# Cadence in seconds for feeds whose file carries no `refresh` key, so a dead collector still shows as stale.
# Contract feeds use their collector timers; interest-profile is re-stamped hourly by its path watcher;
# jobs-insight is merged by each jobs run.
DEFAULT_REFRESH: dict[str, int] = {
    "travel-deals": 21600,
    "outdoors": 7200,
    "life": 86400,
    "history-goodnews": 86400,
    "interest-profile": 3600,
    "jobs-insight": 3600,
    "cre-deals": 3600,
    "national-v2": 604800,
}

# Every file this server may read, by name. Anything else is refused.
ALLOWED_NAMES = frozenset(FEEDS)


def _iso(ts: float | str | None) -> str | None:
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(float(ts), tz=UTC).isoformat(timespec="seconds")
    except (TypeError, ValueError, OSError):
        return None


def _stamp(data: dict) -> float | int | str | None:
    """When the collector wrote the feed: ``t`` (epoch), else ``checked_at`` (ISO, the testflight feed), else
    ``generated_at`` (ISO, the shared feed contract; an epoch number, the national dataset manifest)."""
    if data.get("t") is not None:
        return data["t"]
    for key in ("checked_at", "generated_at"):
        value = data.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return value
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value).timestamp()
            except ValueError:
                return None
    return None


def _refresh(data: dict, name: str = "") -> int | float | None:
    """Refresh period in seconds: ``refresh`` (most feeds), ``refresh_s`` (the testflight feed), else the registered
    default for a feed that carries none (contract feeds, interest-profile, jobs-insight)."""
    for key in ("refresh", "refresh_s"):
        value = data.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return value
    return DEFAULT_REFRESH.get(name)


def _age(ts: float | str | None, mtime: float) -> int:
    try:
        reference = float(ts) if ts is not None else mtime
    except (TypeError, ValueError):
        reference = mtime
    return max(0, int(datetime.now(tz=UTC).timestamp() - reference))


def load(name: str) -> dict:
    """Load one feed. Returns ``{"data": ..., "source": {...}}`` or an error envelope."""
    if name not in ALLOWED_NAMES:
        return {"error": f"unknown feed {name!r}", "allowed": sorted(ALLOWED_NAMES)}
    tried: list[str] = []
    for directory in FEEDS[name]:
        path = directory / FILES.get(name, f"{name}.json")
        tried.append(str(path))
        if not path.is_file():
            continue
        try:
            raw = path.read_text(encoding="utf-8")
            data = json.loads(raw)
        except (OSError, ValueError) as failure:
            return {"error": f"{type(failure).__name__}: {failure}", "source": {"file": str(path)}, "tried": tried}
        if not isinstance(data, dict):
            return {"error": "feed is not a JSON object", "source": {"file": str(path)}, "tried": tried}
        mtime = path.stat().st_mtime
        stamp = _stamp(data)
        age = _age(stamp, mtime)
        refresh = _refresh(data, name)
        stale_after = max(300, int(refresh * 3)) if refresh else None
        return {
            "data": data,
            "source": {
                "file": str(path),
                "read_at": datetime.now(tz=UTC).isoformat(timespec="seconds"),
                "generated_at": _iso(stamp),
                "age_s": age,
                "refresh_s": refresh,
                "stale": bool(stale_after and age > stale_after),
                "feed_errors": data.get("errors") or [],
                # deck v6 feeds name sources in `src` (strings); the shared contract uses `sources` ({name, url, fetched_at})
                "feed_src": None if name in NO_FEED_SRC else (data.get("src") if data.get("src") is not None else data.get("sources")),
            },
        }
    return {"error": "feed file not found", "source": {"tried": tried}}


def envelope(name: str, **payload) -> dict:
    """Standard tool result: source block first, then the payload."""
    loaded = load(name)
    if "error" in loaded:
        return {"ok": False, "feed": name, **loaded}
    out = {"ok": True, "feed": name, "source": loaded["source"]}
    out.update(payload)
    return out


def freshness() -> dict:
    """Age of every feed this server reads, plus the feed's own errors."""
    rows = []
    now = datetime.now(tz=UTC).timestamp()
    for name in sorted(ALLOWED_NAMES):
        found = None
        for directory in FEEDS[name]:
            path = directory / FILES.get(name, f"{name}.json")
            if path.is_file():
                found = path
                break
        if found is None:
            rows.append({"feed": name, "present": False, "file": None, "age_s": None, "stale": None, "errors": []})
            continue
        try:
            data = json.loads(found.read_text(encoding="utf-8"))
        except (OSError, ValueError) as failure:
            note = f"{type(failure).__name__}: {failure}"
            rows.append({"feed": name, "present": True, "file": str(found), "unreadable": note,
                         "age_s": None, "stale": None, "errors": []})
            continue
        if not isinstance(data, dict):
            rows.append({"feed": name, "present": True, "file": str(found), "unreadable": "feed is not a JSON object",
                         "age_s": None, "stale": None, "errors": []})
            continue
        mtime = found.stat().st_mtime
        stamp = _stamp(data)
        age = _age(stamp, mtime)
        refresh = _refresh(data, name)
        stale_after = max(300, int(refresh * 3)) if refresh else None
        rows.append({
            "feed": name,
            "present": True,
            "file": str(found),
            "generated_at": _iso(stamp),
            "age_s": age,
            "refresh_s": refresh,
            "stale": bool(stale_after and age > stale_after),
            "errors": data.get("errors") or [],
        })
    stale = [row["feed"] for row in rows if row.get("stale")]
    missing = [row["feed"] for row in rows if not row.get("present")]
    errored = [row["feed"] for row in rows if row.get("errors")]
    return {
        "ok": True,
        "checked_at": datetime.fromtimestamp(now, tz=UTC).isoformat(timespec="seconds"),
        "feeds": rows,
        "stale": stale,
        "missing": missing,
        "with_errors": errored,
    }
