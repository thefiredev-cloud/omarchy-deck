#!/usr/bin/env python3
"""Pixel Deck read-only audit CLI (also the engine behind the Hermes plugin candidate).

Reads the LIVE deck on loopback 127.0.0.1:8796 with fixed, allowlisted GET requests and
prints a sanitized summary: counts, status, source and time only. It never prints mail
addresses, subjects or bodies, finance or health values, camera images or camera keys.

Safety rules (enforced in code, covered by tests/test_deck_audit.py):
  * GET only. No POST, no arbitrary URL, no host or port override. Host is 127.0.0.1, port 8796.
  * Only paths in ALLOWED_GET can be requested. Query strings are never sent.
  * The deck cookie is read from ~/.config/pixel-deck/token at request time, sent only as the
    `Cookie` header to loopback, and never printed, logged, put in a URL, or written anywhere.
    Any output that would contain the token text is replaced by an error.
  * 401/403 is reported as `auth_failed`, connection failure as `unavailable`, a 404/405 as
    `route_missing` (the running binary predates the route). None of these is ever a zero.
  * Response bodies are rebuilt from a field allowlist. Unknown fields are dropped.

Usage:
  python3 scripts/deck_audit.py today|traffic|cams|sites|audit [--timeout 5] [--pretty]
Exit: 0 ok, 1 failed or alert (auth_failed, route_missing, unavailable, bad_reply, audit fail),
      2 partial or soft (some data missing or stale).
"""
from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, NamedTuple

HOST = "127.0.0.1"
PORT = 8796
BASE_LABEL = f"http://{HOST}:{PORT}"
MAX_BODY = 3 * 1024 * 1024
DEFAULT_TIMEOUT = 5.0
TOKEN_REL = ".config/pixel-deck/token"
REPO_ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = REPO_ROOT / "static"

# Deck v6 feed routes (contract 2026-10-01): GET /api/<name> serves ~/.meshvault/status/deck/<name>.json.
# v8 read-only routes: the route answers with a JSON object and no top-level error. /api/run and /api/run-last take
# an id or depend on a launch, so the audit never requests them.
V8_READS = ("crons", "fleet-board")
ACTION_PROBES = ("/api/cron-act", "/api/run-send", "/api/cam-diag")
UNIT_PROBE = "/api/unit?name=bogus"
# Mirrors rust/src/sources.rs FEEDS. markets/portfolio left the deck when headlines moved to /api/today, so a
# stale deck/markets.json is not a failure; the house markets feed writes house-feeds/markets.json instead.
FEEDS = ("cluster", "launch", "dev", "accounts", "jobs", "surf", "hockey", "realestate", "products", "perfloop",
         "markets", "portfolio")
# Fixed GET allowlist. Nothing else can be requested, with or without a cookie.
ALLOWED_GET = frozenset(
    {"/healthz", "/api/today", "/api/cams", "/api/traffic", "/api/sites", "/", "/app.js", "/deck.js", "/pad.js",
     "/sw.js", UNIT_PROBE} | set(ACTION_PROBES) | {f"/api/{f}" for f in FEEDS} | {f"/api/{f}" for f in V8_READS}
)
# Public static routes need no cookie on the deck; "/" needs one.
PUBLIC_GET = frozenset({"/healthz", "/app.js", "/deck.js", "/pad.js", "/sw.js"})
EMBEDDED = {"/": "index.html", "/app.js": "app.js", "/deck.js": "deck.js", "/pad.js": "pad.js", "/sw.js": "sw.js"}
# The deck stamps the cache name in sw.js from the bytes it caches (rust/src/shell.rs). The served worker matches the
# checkout once its stamp is turned back into the token; a served worker with no stamp, or still the token, was not stamped.
SHELL_TOKEN = b"__SHELL_HASH__"
_STAMP_RE = re.compile(rb"V='pdeck-shell-[0-9a-f]{16}'")


def unstamp(body: bytes) -> bytes | None:
    """The served sw.js with its 16 hex stamp put back to the token; None when it carries no stamp."""
    if SHELL_TOKEN in body:
        return None
    out, n = _STAMP_RE.subn(b"V='pdeck-shell-" + SHELL_TOKEN + b"'", body, count=1)
    return out if n == 1 else None


_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{8,256}$")
_SAFE_TEXT = re.compile(r"[^A-Za-z0-9 _.:/~>()+-]")
_DOMAIN_RE = re.compile(r"^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ROLE_RE = re.compile(r"^[a-z0-9_-]{1,24}$")
_CAM_RE = re.compile(r"^[a-z0-9_]{1,24}$")

STALE_AFTER_S = {"today": 1800, "traffic": 7200, "sites": 900}


class Reply(NamedTuple):
    """One transport answer. `error` is a short fixed word when no HTTP reply came back."""

    status: int
    body: bytes
    error: str | None = None
    ms: int = 0


Transport = Callable[[str, bool], Reply]


# ── transport ────────────────────────────────────────────────────────────────────────────
class LoopbackTransport:
    """GET-only client for the local deck. Host and port are constants, not parameters."""

    def __init__(self, timeout: float = DEFAULT_TIMEOUT, token_path: Path | None = None):
        self.timeout = max(0.5, min(float(timeout), 10.0))
        # token_path is a test seam only. The CLI and plugin never pass it.
        self._token_path = token_path or (Path.home() / TOKEN_REL)
        self._token: str | None = None

    def token(self) -> str | None:
        if self._token is None:
            try:
                raw = self._token_path.read_text(encoding="utf-8").strip()
            except OSError:
                return None
            if not _TOKEN_RE.match(raw):  # also blocks header injection
                return None
            self._token = raw
        return self._token

    def __call__(self, path: str, auth: bool = True) -> Reply:
        if path not in ALLOWED_GET:
            raise ValueError("path not allowlisted")
        headers = {"Accept": "*/*", "User-Agent": "deck-audit/1"}
        if auth:
            tok = self.token()
            if tok is None:
                return Reply(0, b"", "token_unreadable")
            headers["Cookie"] = f"pdeck={tok}"
        t0 = time.monotonic()
        conn = http.client.HTTPConnection(HOST, PORT, timeout=self.timeout)
        try:
            conn.request("GET", path, headers=headers)
            r = conn.getresponse()
            body = r.read(MAX_BODY + 1)
            ms = int((time.monotonic() - t0) * 1000)
            if len(body) > MAX_BODY:
                return Reply(r.status, b"", "body_too_large", ms)
            return Reply(r.status, body, None, ms)
        except TimeoutError:
            return Reply(0, b"", "timeout", int((time.monotonic() - t0) * 1000))
        except (OSError, http.client.HTTPException):
            return Reply(0, b"", "connection_failed", int((time.monotonic() - t0) * 1000))
        finally:
            conn.close()


# ── sanitizers ───────────────────────────────────────────────────────────────────────────
def safe_text(v: Any, n: int = 80) -> str | None:
    if not isinstance(v, str):
        return None
    return _SAFE_TEXT.sub("", v)[:n] or None


def as_int(v: Any) -> int | None:
    return v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else None


def as_bool(v: Any) -> bool | None:
    return v if isinstance(v, bool) else None


def as_epoch(v: Any) -> int | None:
    n = as_int(v)
    return n if n is not None and 946684800 <= n <= 4102444800 else None


def _iso(t: int | None) -> str | None:
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if t else None


def _section_meta(d: dict, now: int) -> dict:
    t = as_epoch(d.get("t"))
    return {"src": safe_text(d.get("src"), 96), "t": t, "at": _iso(t), "age_s": max(0, now - t) if t else None}


def _err(d: dict) -> str | None:
    return (safe_text(d.get("error"), 60) or "error") if "error" in d else None


# ── per-endpoint summaries (allowlist rebuild) ───────────────────────────────────────────
def sum_gateway(d: Any, now: int) -> dict:
    if not isinstance(d, dict):
        return {"status": "unavailable", "reason": "missing"}
    m = _section_meta(d, now)
    if (e := _err(d)) is not None:
        return {"status": "unavailable", "reason": e, **m}
    return {"status": "ok" if d.get("ok") is True else "degraded", "gateway_status": safe_text(d.get("status"), 16),
            "version": safe_text(d.get("version"), 24), **m}


def sum_mail(d: Any, now: int) -> dict:
    if not isinstance(d, dict):
        return {"status": "unavailable", "reason": "missing"}
    m = _section_meta(d, now)
    if (e := _err(d)) is not None:
        return {"status": "unavailable", "reason": e, **m}
    boxes = []
    for b in (d.get("mailboxes") or [])[:16]:
        if not isinstance(b, dict):
            continue
        role = b.get("role") if isinstance(b.get("role"), str) and _ROLE_RE.match(b["role"]) else "mailbox"
        boxes.append({"role": role, "unread": as_int(b.get("unread")), "ok": as_bool(b.get("ok"))})
    known = [b["unread"] for b in boxes if b["ok"] is True and b["unread"] is not None]
    return {"status": safe_text(d.get("status"), 16) or "unavailable", "stale": as_bool(d.get("stale")),
            "mailbox_count": len(boxes), "mailboxes_ok": sum(1 for b in boxes if b["ok"]),
            "unread_total": sum(known) if known else None, "mailboxes": boxes, "at_reading": m["at"],
            "src": m["src"], "t": m["t"], "age_s": m["age_s"]}


def sum_cron(d: Any, now: int) -> dict:
    if not isinstance(d, dict):
        return {"status": "unavailable", "reason": "missing"}
    m = _section_meta(d, now)
    if (e := _err(d)) is not None:
        return {"status": "unavailable", "reason": e, **m}
    nxt = [as_epoch(x.get("at")) for x in (d.get("next") or []) if isinstance(x, dict)]
    nxt = [x for x in nxt if x]
    failing = d.get("failing") if isinstance(d.get("failing"), list) else None
    return {"status": "ok" if failing == [] else "attention", "enabled": as_int(d.get("enabled")),
            "paused": as_int(d.get("paused")), "failing_count": len(failing) if isinstance(failing, list) else None,
            "next_count": len(nxt), "next_at": _iso(min(nxt)) if nxt else None, **m}


def sum_markets(d: Any, now: int) -> dict:
    if not isinstance(d, dict):
        return {"status": "unavailable", "reason": "missing"}
    m = _section_meta(d, now)
    if (e := _err(d)) is not None:
        return {"status": "unavailable", "reason": e, **m}
    items = [x for x in (d.get("items") or []) if isinstance(x, dict)]
    ats = [a for a in (as_epoch(x.get("at")) for x in items) if a]
    srcs = {x.get("source") for x in items if isinstance(x.get("source"), str)}
    return {"status": "ok" if items else "unavailable", "headline_count": len(items), "source_count": len(srcs),
            "newest_headline_at": _iso(max(ats)) if ats else None,
            "newest_headline_age_s": max(0, now - max(ats)) if ats else None, **m}


def sum_watch(d: Any, now: int) -> dict:
    if not isinstance(d, dict):
        return {"status": "unavailable", "reason": "missing"}
    m = _section_meta(d, now)
    if (e := _err(d)) is not None:
        return {"status": "unavailable", "reason": e, **m}
    fields = ["hr", "hrv", "sleep_h", "resting_hr", "battery", "move_kcal", "exercise_min", "stand_h"]
    have = [f for f in fields if isinstance(d.get(f), (int, float)) and not isinstance(d.get(f), bool)]
    connected = as_bool(d.get("connected"))
    return {"status": "ok" if connected and have else ("partial" if connected else "disconnected"),
            "connected": connected, "metrics_present": have,
            "metrics_missing": [f for f in fields if f not in have], **m}  # names only, never values


def summarize_today(d: Any, now: int) -> tuple[str, dict]:
    if not isinstance(d, dict):
        return "bad_reply", {}
    secs = {"gateway": sum_gateway(d.get("gateway"), now), "mail": sum_mail(d.get("mail"), now),
            "cron": sum_cron(d.get("cron"), now), "markets": sum_markets(d.get("markets"), now),
            "watch": sum_watch(d.get("watch"), now)}
    bad = [k for k, v in secs.items() if v["status"] not in ("ok",)]
    t = as_epoch(d.get("t"))
    unav = d.get("unavailable") if isinstance(d.get("unavailable"), list) else []
    data = {"generated_at": _iso(t), "age_s": max(0, now - t) if t else None, "sections": secs,
            "not_ok_sections": bad, "declared_unavailable_count": len(unav)}
    if len(bad) == len(secs):
        return "unavailable", data
    return ("ok" if not bad else "partial"), data


def summarize_cams(d: Any, now: int) -> tuple[str, dict]:
    if not isinstance(d, dict) or not isinstance(d.get("cams"), list):
        return "bad_reply", {}
    if (e := _err(d)) is not None:
        return "unavailable", {"reason": e, "cams": [], "total": None, "ready_count": None}
    cams = []
    for c in d["cams"][:16]:
        if not isinstance(c, dict):
            continue
        name = c.get("name") if isinstance(c.get("name"), str) and _CAM_RE.match(c["name"]) else "cam"
        cams.append({"name": name, "ready": as_bool(c.get("ready")), "readers": as_int(c.get("readers")),
                     "bytes": as_int(c.get("bytes"))})  # counts only: no frames, no keys, no URLs
    ready = sum(1 for c in cams if c["ready"])
    if not cams:
        return "unavailable", {"reason": "no camera list", "cams": [], "total": 0, "ready_count": None}
    return ("ok" if ready == len(cams) else "partial"), {"total": len(cams), "ready_count": ready,
                                                        "all_ready": ready == len(cams), "cams": cams}


def summarize_traffic(d: Any, now: int) -> tuple[str, dict]:
    if not isinstance(d, dict):
        return "bad_reply", {}
    if (e := _err(d)) is not None:
        return "unavailable", {"reason": e}
    if not isinstance(d.get("sites"), list):
        return "bad_reply", {}
    t = as_epoch(d.get("t"))
    w = d.get("window") if isinstance(d.get("window"), dict) else {}
    window = {k: (w.get(k) if isinstance(w.get(k), str) and _DATE_RE.match(w[k]) else None)
              for k in ("start_date", "end_date")}
    sites = []
    for s in d["sites"][:32]:
        if not isinstance(s, dict):
            continue
        dom = s.get("domain") if isinstance(s.get("domain"), str) and _DOMAIN_RE.match(s["domain"]) else None
        st = s.get("status") if s.get("status") in ("ok", "no_data", "unavailable") else "unavailable"
        v = as_int(s.get("value")) if st == "ok" else None  # null stays null, never 0
        st_t = as_epoch(s.get("t"))
        sites.append({"domain": dom, "provider": safe_text(s.get("provider"), 40),
                      "metric": safe_text(s.get("metric"), 32), "value": v,
                      "impressions": as_int(s.get("impressions")) if st == "ok" else None, "status": st,
                      "t": st_t, "at": _iso(st_t),
                      "start_date": s.get("start_date") if isinstance(s.get("start_date"), str) and _DATE_RE.match(s["start_date"]) else window["start_date"],
                      "end_date": s.get("end_date") if isinstance(s.get("end_date"), str) and _DATE_RE.match(s["end_date"]) else window["end_date"]})  # row error text is dropped
    if not sites:
        return "unavailable", {"reason": "no sites", "window": window, "sites": [], "generated_at": _iso(t)}
    n_ok = sum(1 for s in sites if s["status"] == "ok")
    vals = [s["value"] for s in sites if s["value"] is not None]
    units = {(s["metric"], s["start_date"], s["end_date"]) for s in sites if s["value"] is not None}
    comparable = len(units) == 1 and all(all(unit) for unit in units)
    data = {"src": safe_text(d.get("src"), 96), "origin": safe_text(d.get("origin"), 96), "window": window,
            "t": t, "generated_at": _iso(t), "age_s": max(0, now - t) if t else None,
            "stale": as_bool(d.get("stale")), "deck_status": safe_text(d.get("status"), 16),
            "metric_note": "organic_search_clicks are search clicks, not total visits",
            "site_count": len(sites), "ok_count": n_ok,
            "no_data_count": sum(1 for s in sites if s["status"] == "no_data"),
            "unavailable_count": sum(1 for s in sites if s["status"] == "unavailable"),
            "total_value": sum(vals) if vals and comparable else None,
            "total_metric": next(iter(units))[0] if comparable else None,
            "total_scope": "available sites only" if comparable else "incomparable or missing metrics/windows", "sites": sites}
    stale = data["stale"] is True or (data["age_s"] is not None and data["age_s"] > STALE_AFTER_S["traffic"])
    if n_ok == 0:
        return "unavailable", data
    return ("ok" if n_ok == len(sites) and not stale else "partial"), data


def summarize_sites(d: Any, now: int) -> tuple[str, dict]:
    if not isinstance(d, dict):
        return "bad_reply", {}
    if (e := _err(d)) is not None:
        return "unavailable", {"reason": e}
    items = d.get("items")
    if not isinstance(items, list):
        return "bad_reply", {}
    t = as_epoch(d.get("t"))
    rows = [{"name": safe_text(i.get("name"), 28), "ok": as_bool(i.get("ok")), "ms": as_int(i.get("ms"))}
            for i in items[:32] if isinstance(i, dict)]
    up = sum(1 for r in rows if r["ok"])
    data = {"src": safe_text(d.get("src"), 96), "t": t, "generated_at": _iso(t),
            "age_s": max(0, now - t) if t else None, "stale": as_bool(d.get("stale")),
            "total": len(rows), "up_count": up, "sites": rows}
    if not rows:
        return "unavailable", data
    return ("ok" if up == len(rows) and d.get("stale") is not True else "partial"), data


SUMMARIZERS = {"today": ("/api/today", summarize_today), "cams": ("/api/cams", summarize_cams),
               "traffic": ("/api/traffic", summarize_traffic), "sites": ("/api/sites", summarize_sites)}


# ── envelope ─────────────────────────────────────────────────────────────────────────────
def classify_http(r: Reply) -> str | None:
    """Failure class for a transport answer, or None when it is a usable 200."""
    if r.error == "token_unreadable":
        return "auth_failed"
    if r.error:
        return "unavailable"
    if r.status in (401, 403):
        return "auth_failed"
    if r.status in (404, 405):
        return "route_missing"
    if r.status != 200:
        return "unavailable"
    return None


def _envelope(tool: str, path: str, now: int, r: Reply, status: str, data: dict | None = None,
              reason: str | None = None) -> dict:
    out = {"tool": tool, "status": status, "source": f"live GET {BASE_LABEL}{path}", "t": now, "at": _iso(now),
           "http": r.status or None, "latency_ms": r.ms if r.status else None}
    if reason:
        out["reason"] = reason
    if data is not None:
        out["data"] = data
    return out


_REASONS = {"auth_failed": "deck rejected or could not read the local cookie; this is not zero data",
            "route_missing": "running binary has no such route; needs cargo rebuild plus approved restart",
            "unavailable": "deck did not answer with usable data; this is not zero data",
            "bad_reply": "deck answered with an unexpected shape"}


def read_tool(tool: str, transport: Transport, clock: Callable[[], float] = time.time) -> dict:
    path, summarize = SUMMARIZERS[tool]
    now = int(clock())
    r = transport(path, True)
    fail = classify_http(r)
    if fail:
        return _envelope(tool, path, now, r, fail, reason=r.error or _REASONS[fail])
    try:
        parsed = json.loads(r.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return _envelope(tool, path, now, r, "bad_reply", reason=_REASONS["bad_reply"])
    try:
        status, data = summarize(parsed, now)
    except (TypeError, ValueError, AttributeError, KeyError, OverflowError):
        return _envelope(tool, path, now, r, "bad_reply", reason=_REASONS["bad_reply"])
    return _envelope(tool, path, now, r, status, data, None if status in ("ok", "partial") else
                     (data.get("reason") if isinstance(data, dict) else None) or _REASONS.get(status))


# ── endpoint audit ───────────────────────────────────────────────────────────────────────
def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()[:12]


def audit(transport: Transport, clock: Callable[[], float] = time.time, static_dir: Path | None = None) -> dict:
    static = static_dir or STATIC_DIR
    now = int(clock())
    checks: list[dict] = []

    def add(name: str, path: str, ok: bool | None, detail: str, r: Reply | None = None) -> None:
        checks.append({"check": name, "path": path, "result": "pass" if ok else ("skip" if ok is None else "fail"),
                       "detail": detail, "http": (r.status or None) if r else None,
                       "latency_ms": r.ms if r and r.status else None})

    r = transport("/healthz", False)
    add("liveness", "/healthz", r.status == 200 and r.body.strip() == b"ok",
        "answers ok" if r.status == 200 else (r.error or f"http {r.status}"), r)
    live = r.status == 200
    if not live:
        return {"tool": "deck_endpoint_audit", "status": "unavailable", "source": f"live GET {BASE_LABEL}",
                "t": now, "at": _iso(now), "checks": checks, "summary": {"pass": 0, "fail": 1, "skip": 0},
                "reason": "deck not answering on loopback 8796; this is not zero data"}

    r = transport("/api/today", False)
    add("auth_enforced_without_cookie", "/api/today", r.status == 401,
        "401 without cookie" if r.status == 401 else f"http {r.status}, expected 401", r)

    tools_status: dict[str, str] = {}
    for tool, (path, _) in SUMMARIZERS.items():
        env = read_tool(tool, transport, clock)
        tools_status[tool] = env["status"]
        if env["status"] in ("ok", "partial"):
            add(f"read_{tool}", path, True, env["status"])
        elif env["status"] == "route_missing":
            add(f"read_{tool}", path, False, "route_missing: needs cargo rebuild plus approved restart")
        else:
            add(f"read_{tool}", path, False, env["status"])
        if tool == "today" and env["status"] in ("ok", "partial"):
            for sec, v in (env.get("data") or {}).get("sections", {}).items():
                age = v.get("age_s")
                limit = STALE_AFTER_S["today"]
                if v["status"] == "unavailable":
                    add(f"today_{sec}_fresh", "/api/today", False, "section unavailable")
                elif age is None:
                    add(f"today_{sec}_fresh", "/api/today", None, "no timestamp")
                else:
                    add(f"today_{sec}_fresh", "/api/today", age <= limit, f"age {age}s (limit {limit}s)")

    # Deck v6 feeds: route answers, file present, fresh within 2x the collector's own refresh.
    # A missing or stale feed is a named failure, never zero data.
    for name in FEEDS:
        path = f"/api/{name}"
        r = transport(path, True)
        fail = classify_http(r)
        if fail:
            add(f"feed_{name}", path, False, fail if fail != "route_missing" else
                "route_missing: needs cargo rebuild plus approved restart", r)
            continue
        try:
            d = json.loads(r.body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            add(f"feed_{name}", path, False, "bad_reply", r)
            continue
        if not isinstance(d, dict):
            add(f"feed_{name}", path, False, "bad_reply", r)
            continue
        file = f"~/.meshvault/status/deck/{name}.json"
        if d.get("error"):
            add(f"feed_{name}", path, False, f"{safe_text(d.get('error'), 40) or 'error'}: {file}", r)
            continue
        age, refresh = d.get("age"), d.get("refresh")
        errs = d.get("errors") if isinstance(d.get("errors"), list) else []
        parts = f", {len(errs)} part(s) failed" if errs else ""
        if d.get("stale") is True:
            add(f"feed_{name}", path, False, f"stale: age {age}s, refresh {refresh}s{parts}", r)
        else:
            add(f"feed_{name}", path, True, f"age {age}s, refresh {refresh}s{parts}", r)

    # Deck v8 reads (Crons, Fleet board): reachable and not reporting a top-level error. Board parts that are
    # unavailable are named by the page itself; here a missing route means "needs rebuild plus approved restart".
    for name in V8_READS:
        path = f"/api/{name}"
        r = transport(path, True)
        fail = classify_http(r)
        if fail:
            add(f"v8_{name}", path, False, fail if fail != "route_missing" else
                "route_missing: needs cargo rebuild plus approved restart", r)
            continue
        try:
            d = json.loads(r.body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            d = None
        if not isinstance(d, dict):
            add(f"v8_{name}", path, False, "bad_reply", r)
        elif d.get("error"):
            add(f"v8_{name}", path, False, safe_text(d.get("error"), 40) or "error", r)
        else:
            add(f"v8_{name}", path, True, "answers", r)

    for path in ACTION_PROBES:
        r = transport(path, True)
        add(f"route_{path.rsplit('/', 1)[-1]}", path, r.status == 405,
            "GET rejected (POST route present)" if r.status == 405 else f"http {r.status}, expected 405", r)
    r = transport(UNIT_PROBE, True)
    add("route_unit", UNIT_PROBE, r.status in (400, 404),
        "invalid unit refused (route present)" if r.status in (400, 404) else f"http {r.status}, expected 400 or 404", r)

    # Embedded assets: the binary serves include_bytes!(static/*). A mismatch means the disk edit
    # is not live until cargo rebuild plus an approved restart.
    for path, fname in EMBEDDED.items():
        r = transport(path, path not in PUBLIC_GET)
        fail = classify_http(r)
        f = static / fname
        if fail:
            add(f"embedded_{fname}", path, False, fail, r)
            continue
        try:
            disk = f.read_bytes()
        except OSError:
            add(f"embedded_{fname}", path, None, "disk file unreadable", r)
            continue
        served = r.body
        if path == "/sw.js":
            served = unstamp(r.body)
            if served is None:
                add(f"embedded_{fname}", path, False, "served sw.js carries no shell stamp; stale until cargo rebuild"
                    " plus approved restart", r)
                continue
        same = _sha(served) == _sha(disk)
        add(f"embedded_{fname}", path, same,
            f"served {_sha(served)} ({len(served)}B) {'==' if same else '!='} disk {_sha(disk)} ({len(disk)}B)"
            + ("" if same else "; stale until cargo rebuild plus approved restart"), r)

    counts = {k: sum(1 for c in checks if c["result"] == k) for k in ("pass", "fail", "skip")}
    status = "ok" if counts["fail"] == 0 else ("failed" if not any(
        c["check"].startswith("read_") and c["result"] == "pass" for c in checks) else "partial")
    return {"tool": "deck_endpoint_audit", "status": status, "source": f"live GET {BASE_LABEL} (fixed allowlist)",
            "t": now, "at": _iso(now), "summary": counts, "tool_status": tools_status, "checks": checks}


# ── output guard ─────────────────────────────────────────────────────────────────────────
def render(obj: dict, transport: Any = None, pretty: bool = False) -> str:
    """Serialize, refusing to emit the deck token if it ever slipped into the output."""
    text = json.dumps(obj, indent=2 if pretty else None, sort_keys=True)
    tok = getattr(transport, "_token", None)
    if tok and tok in text:
        return json.dumps({"tool": obj.get("tool"), "status": "unavailable", "reason": "output withheld: credential detected"})
    if "pdeck=" in text or "@" in text:
        return json.dumps({"tool": obj.get("tool"), "status": "unavailable", "reason": "output withheld: unsafe text detected"})
    return text


def exit_code(status: str) -> int:
    return 0 if status == "ok" else (2 if status == "partial" else 1)


def run_tool(name: str, transport: Transport, clock: Callable[[], float] = time.time) -> dict:
    if name == "audit":
        return audit(transport, clock)
    if name in SUMMARIZERS:
        return read_tool(name, transport, clock)
    raise ValueError("unknown tool")


def main(argv: list[str] | None = None, transport: Transport | None = None, out=None) -> int:
    ap = argparse.ArgumentParser(prog="deck_audit", description="Read-only Pixel Deck audit (loopback 8796, GET only).")
    ap.add_argument("tool", choices=["today", "traffic", "cams", "sites", "audit"])
    ap.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT, help="seconds, clamped to 0.5-10")
    ap.add_argument("--pretty", action="store_true")
    args = ap.parse_args(argv)
    tr = transport or LoopbackTransport(timeout=args.timeout)
    res = run_tool(args.tool, tr)
    print(render(res, tr, args.pretty), file=out or sys.stdout)
    return exit_code(res["status"])


if __name__ == "__main__":
    sys.exit(main())
