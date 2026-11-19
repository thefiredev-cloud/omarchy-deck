#!/usr/bin/env python3
"""Pixel Deck website traffic producer (manual, read-only).

Reads Search Console organic-search stats for the properties visible to Tanner's already
authorized google-apis MCP server, and writes one normalized cache file that the deck's
`GET /api/traffic` route serves. Run by hand or by any scheduler the owner adds later; this
script installs nothing and schedules nothing.

Truth rules:
  * Search Console clicks are organic search clicks, NOT total visits. Every site row carries
    `metric: "organic_search_clicks"` so the two are never confused. `visits` is reserved for a
    future analytics provider that really counts visits.
  * A missing, failed or empty answer is `value: null`, never 0.
  * The list call failing leaves the previous cache untouched (stale is computed from its age).

Safety: only the read tools `list_search_console_sites` and `query_search_analytics` are called.
The MCP server is spawned over stdio with a minimal environment. This script never opens the
Search Console OAuth token or client files and adds no grants.

Vercel block (2026-11-04): a domain with no Search Console property still gets a real number from
Vercel Web Analytics (GET /v1/query/web-analytics/visits/count, page views and visitors, production
only), read with the Vercel token the deck's dev feed already uses (VERCEL_TOKEN or the freshest
unexpired Hermes OAuth store, read in place and never written). The count is per project: one row
per project, naming every domain it serves. It lands in the cache as `vercel`, beside `sites`.

Daily view: the cache also carries a `daily` block, one row per TRACKED site for the newest day
Search Console has data for within the 7 days ending at the window end (today minus --lag). That
day is shared by every row, and `lag_days` is today minus that day (Search Console often trails
by 3 days, not 2). Rows reuse the 28-day row shape with a one-day window, so a site with no
property, an unverified property or a failed query is
`unavailable` (never 0). The 28-day `sites` rows stay as they were.

Usage:
  python3 scripts/deck_traffic.py [--days 28] [--lag 2] [--dry-run] [--out PATH]
Exit: 0 wrote cache (all 28-day sites ok), 1 hard failure (cache untouched), 2 wrote cache but
some 28-day sites unavailable. Tracked-site availability is printed on the summary line.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import select
import subprocess
import sys
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

SCHEMA = 1
PROVIDER = "google_search_console"
METRIC = "organic_search_clicks"
MAX_SITES = 32
# The owner monitoring scope (2026-10-29): the sites behind the goal of 2,000 daily clicks. Each one always gets a
# daily row, even when Search Console has no property for it. JudgeFinder stays in the 28-day `sites` rows when
# Search Console lists it, but leaves the daily goal rows.
TRACKED = ("meshvault.ai", "protocol-guide.com", "pepgo.org")
DAILY_GOAL = 2000
# Trailing days queried per tracked site to find the newest day Search Console has data for.
DAILY_SPAN = 7
UNVERIFIED = "siteUnverifiedUser"
# Why an unavailable row has no number (C3). `no_access`: the owner cannot read it until he adds or verifies the
# property (HTTP 403, siteUnverifiedUser, no property). `failed`: any other error, which the next run retries.
REASON_NO_ACCESS = "no_access"
REASON_FAILED = "failed"
DEFAULT_OUT = os.path.join(os.path.expanduser("~"), ".kodros/status/traffic/traffic.json")
DEFAULT_MCP_DIR = os.path.join(os.path.expanduser("~"), "projects/google-apis-mcp")
SRC_LABEL = "google-apis MCP > Search Console (read-only)"

_DOMAIN_RE = re.compile(r"^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$")


def now_epoch() -> int:
    return int(time.time())


def clean_text(value: Any, limit: int = 160) -> str:
    text = "".join(c for c in str(value) if c.isprintable())
    return text[:limit]


def normalize_domain(site_url: Any) -> str | None:
    """`sc-domain:x.com` and `https://x.com/` both become `x.com`; anything odd is rejected."""
    if not isinstance(site_url, str):
        return None
    s = site_url.strip().lower()
    if s.startswith("sc-domain:"):
        s = s[len("sc-domain:"):]
    else:
        m = re.match(r"^https?://([^/:?#]+)(?::\d+)?/?$", s)
        if not m:
            return None
        s = m.group(1)
    return s if _DOMAIN_RE.match(s) and "." in s else None


def window(today: date, days: int, lag: int) -> tuple[str, str]:
    """Inclusive date window ending `lag` days ago (Search Console data trails by about 2 days)."""
    if days < 1 or days > 480 or lag < 0 or lag > 30:
        raise ValueError("days must be 1..480 and lag 0..30")
    end = today - timedelta(days=lag)
    start = end - timedelta(days=days - 1)
    return start.isoformat(), end.isoformat()


def number_or_none(v: Any) -> float | int | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if v < 0:
        return None
    return int(v) if float(v).is_integer() else float(v)


def reason_for(error: str) -> str:
    low = error.lower()
    if "403" in low or UNVERIFIED.lower() in low or "not verified" in low or "no search console property" in low:
        return REASON_NO_ACCESS
    return REASON_FAILED


def site_row(
    domain: str, start: str, end: str, t: int, result: dict[str, Any] | None, error: str | None
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "domain": domain,
        "tracked": domain in TRACKED,
        "provider": PROVIDER,
        "metric": METRIC,
        "value": None,
        "impressions": None,
        "start_date": start,
        "end_date": end,
        "t": None,
        "status": "unavailable",
    }
    if error is not None or result is None:
        row["error"] = clean_text(error or "no result")
        row["reason"] = reason_for(row["error"])
        return row
    rows = result.get("rows")
    if not isinstance(rows, list):
        row["error"] = "malformed response"
        row["reason"] = REASON_FAILED
        return row
    if not rows:
        # Search Console omits rows when it has nothing to report. That is "no data", not a
        # measured zero, so the value stays null.
        row["status"] = "no_data"
        row["t"] = t
        row["error"] = "no rows returned for window"
        return row
    clicks = number_or_none(rows[0].get("clicks")) if isinstance(rows[0], dict) else None
    imps = number_or_none(rows[0].get("impressions")) if isinstance(rows[0], dict) else None
    if clicks is None:
        row["error"] = "malformed response"
        row["reason"] = REASON_FAILED
        return row
    row.update(value=clicks, impressions=imps, t=t, status="ok")
    return row


class McpError(RuntimeError):
    pass


_HTTP_RE = re.compile(r"HTTP (\d{3})")


def short_error(msg: str) -> str:
    """Compact, credential-free reason for a row: `HTTP 403` beats a wrapped tool traceback."""
    m = _HTTP_RE.search(msg)
    if m:
        return f"Search Console HTTP {m.group(1)}"
    if UNVERIFIED in msg:
        return "property not verified"
    if "timed out" in msg:
        return "timed out"
    return "query failed"


class McpStdio:
    """Minimal MCP stdio client: initialize, then tools/call, each bounded by a deadline."""

    def __init__(self, argv: list[str], env: dict[str, str], call_timeout: float):
        self.call_timeout = call_timeout
        self._id = 0
        self.proc = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            env=env,
        )
        self._request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "pixel-deck-traffic", "version": "1"},
            },
            timeout=max(self.call_timeout, 30.0),
        )
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def _send(self, obj: dict[str, Any]) -> None:
        try:
            assert self.proc.stdin is not None
            self.proc.stdin.write(json.dumps(obj) + "\n")
            self.proc.stdin.flush()
        except (BrokenPipeError, OSError):
            raise McpError("mcp server exited") from None

    def _read(self, deadline: float) -> dict[str, Any]:
        assert self.proc.stdout is not None
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                raise McpError("mcp call timed out")
            ready, _, _ = select.select([self.proc.stdout], [], [], left)
            if not ready:
                raise McpError("mcp call timed out")
            line = self.proc.stdout.readline()
            if not line:
                raise McpError("mcp server exited")
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if isinstance(msg, dict) and "id" in msg:
                return msg

    def _request(self, method: str, params: dict[str, Any], timeout: float) -> Any:
        self._id += 1
        rid = self._id
        self._send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
        deadline = time.monotonic() + timeout
        while True:
            msg = self._read(deadline)
            if msg.get("id") == rid:
                if "error" in msg:
                    raise McpError(clean_text((msg["error"] or {}).get("message", "mcp error")))
                return msg.get("result")

    def call(self, tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
        res = self._request("tools/call", {"name": tool, "arguments": arguments}, self.call_timeout)
        if not isinstance(res, dict):
            raise McpError("malformed mcp result")
        if res.get("isError"):
            texts = [c.get("text", "") for c in res.get("content", []) if isinstance(c, dict)]
            raise McpError(clean_text(" ".join(texts)) or "tool error")
        sc = res.get("structuredContent")
        if isinstance(sc, dict):
            return sc
        for c in res.get("content", []):
            if isinstance(c, dict) and c.get("type") == "text":
                try:
                    data = json.loads(c.get("text", ""))
                except ValueError:
                    break
                if isinstance(data, dict):
                    return data
        raise McpError("malformed mcp result")

    def close(self) -> None:
        try:
            if self.proc.stdin:
                self.proc.stdin.close()
        except OSError:
            pass
        try:
            self.proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait()
        finally:
            if self.proc.stdout:
                self.proc.stdout.close()


def minimal_env() -> dict[str, str]:
    """Only what the MCP server needs to find its own config. No PYTHONPATH, no other secrets."""
    keep = ("PATH", "HOME", "XDG_CONFIG_HOME", "LANG", "LC_ALL")
    return {k: os.environ[k] for k in keep if k in os.environ}


def list_properties(
    call: Callable[[str, dict[str, Any]], dict[str, Any]],
) -> dict[str, tuple[str, str]]:
    """Visible Search Console properties as `domain -> (site_url, permission_level)`.
    Raises McpError if the list call fails or is malformed. The first property per domain wins."""
    listing = call("list_search_console_sites", {})
    entries = listing.get("sites")
    if not isinstance(entries, list):
        raise McpError("malformed site list")
    seen: dict[str, tuple[str, str]] = {}
    for e in entries:
        if not isinstance(e, dict):
            continue
        domain = normalize_domain(e.get("site_url"))
        if domain and domain not in seen and len(seen) < MAX_SITES:
            seen[domain] = (e["site_url"], clean_text(e.get("permission_level") or "", 40))
    return seen


def collect(
    call: Callable[[str, dict[str, Any]], dict[str, Any]],
    start: str,
    end: str,
    clock: Callable[[], int] = now_epoch,
    budget: float = 120.0,
    props: dict[str, tuple[str, str]] | None = None,
) -> list[dict[str, Any]]:
    """Query totals per property over start..end. Raises McpError only if the list fails."""
    if props is None:
        props = list_properties(call)
    rows: list[dict[str, Any]] = []
    t0 = time.monotonic()
    for domain, (site_url, _permission) in props.items():
        if time.monotonic() - t0 > budget:
            rows.append(site_row(domain, start, end, clock(), None, "run budget exhausted"))
            continue
        try:
            res = call(
                "query_search_analytics",
                {"site_url": site_url, "start_date": start, "end_date": end, "search_type": "web", "row_limit": 1},
            )
            rows.append(site_row(domain, start, end, clock(), res, None))
        except McpError as e:
            rows.append(site_row(domain, start, end, clock(), None, short_error(str(e))))
    return rows


def collect_daily(
    call: Callable[[str, dict[str, Any]], dict[str, Any]],
    props: dict[str, tuple[str, str]],
    end: str,
    tracked: tuple[str, ...] = TRACKED,
    clock: Callable[[], int] = now_epoch,
    budget: float = 60.0,
    span: int = DAILY_SPAN,
) -> tuple[str, list[dict[str, Any]]]:
    """One-day organic clicks per tracked site, in tracked order, as `(day, rows)`.

    Search Console publishes a day late for some properties, so the newest requested day (`end`)
    can be empty everywhere. Each site is queried for the `span` days ending at `end`, and `day`
    is the newest date any tracked site has data for (`end` when none does). Every row is for that
    one shared day, so the aggregate adds up the same day for every site. A tracked site with no
    property, an unverified property, a failed query or no row for `day` is `unavailable` or
    `no_data` with a null value, never 0."""
    first = (date.fromisoformat(end) - timedelta(days=span - 1)).isoformat()
    plan: dict[str, tuple[str, dict[str, dict[str, Any]] | str]] = {}
    t0 = time.monotonic()
    for domain in tracked:
        prop = props.get(domain)
        if prop is None:
            plan[domain] = ("gap", "no Search Console property")
            continue
        site_url, permission = prop
        if permission == UNVERIFIED:
            plan[domain] = ("gap", "property not verified")
            continue
        if time.monotonic() - t0 > budget:
            plan[domain] = ("gap", "run budget exhausted")
            continue
        try:
            res = call(
                "query_search_analytics",
                {
                    "site_url": site_url,
                    "start_date": first,
                    "end_date": end,
                    "dimensions": ["date"],
                    "search_type": "web",
                    "row_limit": span,
                },
            )
        except McpError as e:
            plan[domain] = ("gap", short_error(str(e)))
            continue
        got = res.get("rows")
        if not isinstance(got, list):
            plan[domain] = ("gap", "malformed response")
            continue
        by_day: dict[str, dict[str, Any]] = {}
        for r in got:
            keys = r.get("keys") if isinstance(r, dict) else None
            if isinstance(keys, list) and len(keys) == 1 and isinstance(keys[0], str):
                by_day.setdefault(keys[0], r)
        plan[domain] = ("rows", by_day)
    seen = [
        d
        for kind, v in plan.values()
        if kind == "rows" and isinstance(v, dict)
        for d, r in v.items()
        if first <= d <= end and number_or_none(r.get("clicks")) is not None
    ]
    day = max(seen) if seen else end
    rows: list[dict[str, Any]] = []
    for domain, (kind, v) in plan.items():
        if kind == "gap":
            rows.append(site_row(domain, day, day, clock(), None, str(v)))
        else:
            hit = v.get(day) if isinstance(v, dict) else None
            rows.append(site_row(domain, day, day, clock(), {"rows": [hit] if hit else []}, None))
    for row in rows:
        row["tracked"] = True  # every daily row is a tracked site by construction
    return day, rows


def build_daily(rows: list[dict[str, Any]], day: str, lag: int) -> dict[str, Any]:
    """The latest-day block. `day` is the newest date with data, `lag` is today minus `day`."""
    return {"date": day, "lag_days": lag, "goal": DAILY_GOAL, "sites": rows}


# ---------------------------------------------------------------- Vercel Web Analytics
# Search Console only knows a site the owner added as a property. Vercel already counts page views for every project that
# has Web Analytics enabled, so a domain with no Search Console access still gets a real number. Read-only: the project list,
# each project's domains and the documented page-view count (GET /v1/query/web-analytics/visits/count). Production traffic only.
# The count is per PROJECT: Vercel gives no per-hostname split, so a project that serves several domains reports one number
# for all of them and the row says which domains it covers.
VERCEL_API = "https://api.vercel.com"
VERCEL_PROVIDER = "vercel_web_analytics"
VERCEL_SRC = "Vercel Web Analytics (read-only)"
HERMES_HOME = os.path.join(os.path.expanduser("~"), ".hermes")
FOREIGN_PROFILES = frozenset({"quill", "quill-morgan"})  # another tenant: its token stores are never read
MAX_VERCEL = 24


def _env_value(name: str) -> str | None:
    v = os.environ.get(name)
    if v:
        return v
    try:
        with open(os.path.join(HERMES_HOME, ".env")) as f:
            for line in f:
                if line.startswith(name + "="):
                    return line.split("=", 1)[1].strip().strip("'\"") or None
    except OSError:
        pass
    return None


def _store_token(path: str, now: float) -> tuple[str | None, float]:
    try:
        with open(path) as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None, -1.0
    tok = d.get("access_token")
    exp = d.get("expires_at")
    if not tok or (isinstance(exp, (int, float)) and exp < now):
        return None, -1.0
    return tok, float(exp) if isinstance(exp, (int, float)) else 0.0


def vercel_token(now: float | None = None) -> str:
    """A bearer token for the Vercel API: VERCEL_TOKEN, else the freshest unexpired Hermes OAuth store of the owner's profiles.
    Read in place, never copied or written (the grant rotates on use). Raises McpError with a credential-free reason."""
    now = time.time() if now is None else now
    v = _env_value("VERCEL_TOKEN")
    if v:
        return v
    stores = [os.path.join(HERMES_HOME, "mcp-tokens", "vercel.json")]
    try:
        for name in sorted(os.listdir(os.path.join(HERMES_HOME, "profiles"))):
            if name not in FOREIGN_PROFILES:
                stores.append(os.path.join(HERMES_HOME, "profiles", name, "mcp-tokens", "vercel.json"))
    except OSError:
        pass
    best, best_exp = None, -1.0
    for p in stores:
        tok, exp = _store_token(p, now)
        if tok and exp > best_exp:
            best, best_exp = tok, exp
    if best:
        return best
    raise McpError("no usable Vercel token (owner must re-link vercel in Hermes)")


def _vercel_get(token: str, path: str, query: dict[str, Any], timeout: float) -> dict[str, Any]:
    import urllib.error
    import urllib.parse
    import urllib.request

    url = VERCEL_API + path + "?" + urllib.parse.urlencode(query)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 - fixed https origin
            data = json.load(r)
    except urllib.error.HTTPError as e:
        raise McpError(f"Vercel HTTP {e.code}") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise McpError("Vercel unreachable") from None
    except ValueError:
        raise McpError("Vercel returned non-JSON") from None
    if not isinstance(data, dict):
        raise McpError("Vercel returned an unexpected shape")
    return data


def own_domains(names: list[Any]) -> list[str]:
    """A project's own custom domains: no www copy of another listed domain and no *.vercel.app preview name."""
    out: list[str] = []
    for n in names:
        d = str(n or "").strip().lower()
        if not _DOMAIN_RE.match(d) or "." not in d or d.endswith(".vercel.app"):
            continue
        out.append(d)
    keep = [d for d in out if not (d.startswith("www.") and d[4:] in out)]
    return sorted(dict.fromkeys(keep))


# which domain names a project in the deck when it serves several (a tracked domain first, else this table, else the first)
PRIMARY_HINT = {"fire-dev-site": "thefiredev.com"}


def primary_domain(name: str, domains: list[str]) -> str:
    for d in domains:
        if d in TRACKED:
            return d
    hint = PRIMARY_HINT.get(name)
    return hint if hint in domains else domains[0]


def vercel_error(msg: str) -> str:
    """Credential-free reason for a Vercel row: the status code or a fixed phrase, never the answer body."""
    m = _HTTP_RE.search(msg)
    if m:
        return f"Vercel HTTP {m.group(1)}"
    for fixed in ("no usable Vercel token", "Vercel unreachable", "Vercel returned non-JSON", "Vercel returned an unexpected shape", "run budget exhausted"):
        if fixed in msg:
            return fixed
    return "Vercel query failed"


def vercel_rows(
    token: str,
    start: str,
    now_ms: int,
    t: int,
    timeout: float = 20.0,
    budget: float = 90.0,
) -> list[dict[str, Any]]:
    """One row per Vercel project that has Web Analytics data: pageviews and visitors since `start`, with the domains it serves."""
    listing = _vercel_get(token, "/v9/projects", {"limit": 100}, timeout)
    since = int(datetime.fromisoformat(start).replace(tzinfo=timezone.utc).timestamp() * 1000)
    rows: list[dict[str, Any]] = []
    t0 = time.monotonic()
    for p in (listing.get("projects") or [])[:MAX_VERCEL]:
        if not isinstance(p, dict):
            continue
        wa = p.get("webAnalytics") or {}
        if not wa.get("enabledAt") or not wa.get("hasData"):
            continue
        name = clean_text(p.get("name"), 60)
        team = p.get("accountId")
        scope = {"teamId": team} if isinstance(team, str) and team.startswith("team_") else {}
        try:
            if time.monotonic() - t0 > budget:
                raise McpError("run budget exhausted")
            dom = _vercel_get(token, f"/v9/projects/{p['id']}/domains", {"limit": 50, **scope}, timeout)
            domains = own_domains([d.get("name") for d in (dom.get("domains") or []) if isinstance(d, dict)])
        except McpError:
            continue  # without its domains a project has no row to put a number on
        if not domains:
            continue
        row: dict[str, Any] = {
            "project": name, "domain": primary_domain(name, domains), "domains": domains, "t": t,
            "tracked": any(d in TRACKED for d in domains),
        }
        try:
            cnt = _vercel_get(
                token,
                "/v1/query/web-analytics/visits/count",
                {"projectId": p["id"], "since": since, "until": now_ms, **scope},
                timeout,
            )
            data = cnt.get("data") if isinstance(cnt.get("data"), dict) else {}
            pv, vis = number_or_none(data.get("pageviews")), number_or_none(data.get("visitors"))
            if pv is None:
                row.update(status="unavailable", pageviews=None, visitors=None, error="no page view count in answer")
            else:
                row.update(status="ok", pageviews=pv, visitors=vis)
        except McpError as e:
            row.update(status="unavailable", pageviews=None, visitors=None, error=vercel_error(str(e)))
        rows.append(row)
    return rows


def collect_vercel(start: str, today: date, t: int, tok: Callable[[], str] = vercel_token) -> dict[str, Any]:
    """The `vercel` block of the cache. A failure is a block with `status: unavailable` and the reason, never zeros."""
    block: dict[str, Any] = {
        "provider": VERCEL_PROVIDER,
        "metric": "pageviews",
        "src": VERCEL_SRC,
        "start_date": start,
        "end_date": today.isoformat(),
        "t": t,
    }
    try:
        rows = vercel_rows(tok(), start, t * 1000, t)
    except McpError as e:
        block.update(status="unavailable", error=vercel_error(str(e)), projects=[])
        return block
    block.update(status="ok" if any(r.get("status") == "ok" for r in rows) else "unavailable", projects=rows)
    return block


def build_cache(
    rows: list[dict[str, Any]],
    start: str,
    end: str,
    t: int,
    daily: dict[str, Any] | None = None,
    vercel: dict[str, Any] | None = None,
) -> dict[str, Any]:
    cache: dict[str, Any] = {
        "schema": SCHEMA,
        "generated_at": t,
        "provider": PROVIDER,
        "src": SRC_LABEL,
        "window": {"start_date": start, "end_date": end},
        "note": "organic_search_clicks are Google Search clicks, not total visits",
        "sites": rows,
    }
    if daily is not None:
        cache["daily"] = daily
    if vercel is not None:
        cache["vercel"] = vercel
    return cache


def write_atomic(path: str, data: dict[str, Any]) -> None:
    d = os.path.dirname(path)
    os.makedirs(d, mode=0o700, exist_ok=True)
    tmp = f"{path}.tmp.{os.getpid()}"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=1, sort_keys=True)
            f.write("\n")
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def pacific_today() -> date:
    try:
        from zoneinfo import ZoneInfo

        return datetime.now(ZoneInfo("America/Los_Angeles")).date()
    except Exception:
        return datetime.now(timezone.utc).date()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Pixel Deck read-only website traffic producer")
    ap.add_argument("--days", type=int, default=28)
    ap.add_argument("--lag", type=int, default=2)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--mcp-dir", default=DEFAULT_MCP_DIR)
    ap.add_argument("--call-timeout", type=float, default=25.0)
    ap.add_argument("--budget", type=float, default=120.0)
    ap.add_argument("--dry-run", action="store_true", help="print the cache, write nothing")
    args = ap.parse_args(argv)
    try:
        today = pacific_today()
        start, end = window(today, args.days, args.lag)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    py = os.path.join(args.mcp_dir, ".venv/bin/python")
    server = os.path.join(args.mcp_dir, "server.py")
    if not (os.path.isfile(py) and os.path.isfile(server)):
        print("error: google-apis MCP checkout not found", file=sys.stderr)
        return 1
    client: McpStdio | None = None
    try:
        client = McpStdio([py, server], minimal_env(), args.call_timeout)
        props = list_properties(client.call)
        rows = collect(client.call, start, end, budget=args.budget, props=props)
        day, daily_rows = collect_daily(client.call, props, end)
    except McpError as e:
        print(f"error: {e}; cache untouched", file=sys.stderr)
        return 1
    finally:
        if client:
            client.close()
    daily_lag = max(0, (today - date.fromisoformat(day)).days)
    vercel = collect_vercel(start, today, now_epoch())
    cache = build_cache(rows, start, end, now_epoch(), daily=build_daily(daily_rows, day, daily_lag), vercel=vercel)
    if args.dry_run:
        print(json.dumps(cache, indent=1, sort_keys=True))
    else:
        write_atomic(args.out, cache)
    ok = sum(1 for r in rows if r["status"] == "ok")
    daily_ok = sum(1 for r in daily_rows if r["status"] == "ok")
    vz = cache.get("vercel", {})
    vz_ok = sum(1 for r in vz.get("projects", []) if r.get("status") == "ok")
    print(
        f"{ok}/{len(rows)} sites ok, window {start}..{end}, daily {day} (lag {daily_lag}d) {daily_ok}/{len(daily_rows)} tracked ok, "
        f"vercel {vz.get('status')} {vz_ok}/{len(vz.get('projects', []))} projects"
        + (f" ({vz.get('error')})" if vz.get("error") else "")
        + (" (dry run)" if args.dry_run else f", wrote {args.out}")
    )
    # the exit code follows the 28-day rows only: a tracked site with no property is expected
    return 0 if ok == len(rows) else 2


if __name__ == "__main__":
    sys.exit(main())
