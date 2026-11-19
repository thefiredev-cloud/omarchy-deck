"""deck-feeds-mcp: read-only MCP over the local deck feed files.

No network, no writes. Every answer names the feed file it came from and how
old that file is, so a stale number is visible instead of implied.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime

from fastmcp import FastMCP

from . import contract as contract_lib
from . import feeds
from . import jobs as jobs_lib
from . import segments as segments_lib
from . import taxonomy as taxonomy_lib

mcp = FastMCP(
    "deck-feeds",
    instructions=(
        "Read-only view of the Kodros deck feeds written under ~/.meshvault/status. "
        "Every result carries a source block: file, generated_at, age_s, stale. Quote that "
        "age whenever you repeat a number. jobs_search, job_market and job_taxonomy take "
        "person=tanner|casey|riley|morgan (default tanner; tanner reads deck/jobs.json, the others "
        "deck/jobs-<person>.json, each with its own taxonomy slugs). jobs_search applies that "
        "feed's own rules block (home metro; in-person metros; remote only at or above the "
        "feed's remote_min_pay) and reports excluded counts. gigs reads "
        "deck/gigs.json (freelance gigs, contracts and public RFPs, best fit first); its pitch "
        "text is a draft that nothing here sends. housing_segments reads one state or metro row of "
        "house-feeds/national-v2/manifest.json by property segment (multifamily, retail, office, industrial, "
        "residential); realestate.json, cre-deals.json and national-v2 ages show in feed_freshness. "
        "No tool writes or reaches the network."
    ),
)


def _root() -> str:
    return str(feeds.STATUS_ROOT)


# ------------------------------------------------------------------------ jobs

# Whose jobs feed a jobs tool reads. Tanner's is deck/jobs.json; the others are written by
# `deck-feed-jobs --person NAME` to deck/jobs-NAME.json with their own taxonomy and rules.
JOB_PEOPLE = ("tanner", "casey", "riley", "morgan")


def _jobs_feed(person: str) -> tuple[str | None, dict | None]:
    """(feed name, None) for a known person, else (None, refusal envelope)."""
    picked = (person or "tanner").strip().lower()
    if picked not in JOB_PEOPLE:
        return None, {"ok": False, "error": f"unknown person {person!r}", "allowed": list(JOB_PEOPLE)}
    return ("jobs" if picked == "tanner" else f"jobs-{picked}"), None


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def jobs_search(category: str = "", subcategory: str = "", metro: str = "", min_pay: int = 0,
                query: str = "", limit: int = 20, apply_rules: bool = True, person: str = "tanner") -> dict:
    """Search one person's jobs feed by category, subcategory, metro, minimum pay or free text.

    person is tanner (default), casey, riley or morgan; category slugs differ per person (see
    job_taxonomy with the same person). metro is one of south_oc, oc, la, sd, remote. min_pay is
    annual USD and compares against pay_max. apply_rules=true keeps only listings inside that
    feed's in-person metros and drops remote roles under the feed's remote_min_pay ($100,000 for
    Tanner) or with unknown pay.
    """
    feed, refusal = _jobs_feed(person)
    if refusal:
        return refusal
    is_tanner = feed == "jobs"
    loaded = feeds.load(feed)
    if "error" in loaded:
        return {"ok": False, "feed": feed, **loaded}
    data = loaded["data"]
    listings = data.get("listings") or []
    found = jobs_lib.taxonomy(data, seed=is_tanner)
    if apply_rules and found["rules"] is None:
        return {"ok": False, "feed": feed, "source": loaded["source"],
                "error": "feed has no valid rules block, so the owner rules cannot be applied",
                "rules_problem": found.get("rules_problem")}
    result = jobs_lib.search(
        listings,
        category=category.strip(),
        subcategory=subcategory.strip(),
        metro=metro.strip(),
        min_pay=int(min_pay or 0),
        query=query,
        limit=limit,
        apply_rules=bool(apply_rules),
        rules=found["rules"],
        fallback_classify=is_tanner,
    )
    return {
        "ok": True,
        "feed": feed,
        "person": data.get("person") or (person or "tanner").strip().lower(),
        "source": loaded["source"],
        "total_listings": len(listings),
        "taxonomy_source": found["taxonomy_source"],
        "rules_source": found["rules_source"],
        "filters": {
            "category": category or None,
            "subcategory": subcategory or None,
            "metro": metro or None,
            "min_pay": int(min_pay or 0),
            "query": query or None,
            "apply_rules": bool(apply_rules),
        },
        **result,
    }


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def job_market(category: str = "", person: str = "tanner") -> dict:
    """Market roll-up by category for one person's jobs feed: totals, metro split, median pay_max, top employers.

    person is tanner (default), casey, riley or morgan. Returns the feed's own market block when it
    publishes one; otherwise the roll-up is computed from the listings here and labelled accordingly.
    """
    feed, refusal = _jobs_feed(person)
    if refusal:
        return refusal
    loaded = feeds.load(feed)
    if "error" in loaded:
        return {"ok": False, "feed": feed, **loaded}
    data = loaded["data"]
    rolled = jobs_lib.market_or_derived(data, fallback_classify=feed == "jobs", feed=feed)
    market = rolled["market"]
    payload = {k: v for k, v in rolled.items() if k != "market"}
    if category:
        slug = category.strip()
        subset = (market.get("by_category") or {}).get(slug)
        payload["category"] = slug
        payload["market"] = subset if subset is not None else {"error": f"no category {slug!r}",
                                                               "known": sorted(market.get("by_category") or {})}
    else:
        payload["market"] = market
    return {"ok": True, "feed": feed, "source": loaded["source"], **payload}


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def job_taxonomy(person: str = "tanner") -> dict:
    """The job taxonomy (categories and subcategories) and the filtering rules of one person's feed.

    person is tanner (default), casey, riley or morgan. Only Tanner's feed falls back to the server
    seed when its blocks are missing; another person's feed reports taxonomy_source "none" instead.
    """
    feed, refusal = _jobs_feed(person)
    if refusal:
        return refusal
    loaded = feeds.load(feed)
    if "error" in loaded:
        return {"ok": False, "feed": feed, **loaded}
    data = loaded["data"]
    found = jobs_lib.taxonomy(data, seed=feed == "jobs")
    return {
        "ok": True,
        "feed": feed,
        "source": loaded["source"],
        **found,
    }


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def interest_profile_summary(limit: int = 12) -> dict:
    """Aggregated interest tags and job targets from the profile lane. Tags and weights only."""
    loaded = feeds.load("interest-profile")
    if "error" in loaded:
        return {
            "ok": False,
            "feed": "interest-profile",
            "present": False,
            "note": "The profile lane has not published interest-profile.json yet.",
            **loaded,
        }
    data = loaded["data"]
    interests = data.get("interests") or []
    caps = max(1, min(int(limit or 12), 50))
    tags = [
        {
            "tag": item.get("tag"),
            "weight": item.get("weight"),
            "evidence_count": item.get("evidence_count"),
            "sources": sorted(item.get("sources") or {}) if isinstance(item.get("sources"), dict) else item.get("sources"),
        }
        for item in interests[:caps]
        if isinstance(item, dict)
    ]
    subs = taxonomy_lib.subs()
    targets = []
    unmapped = []
    for row in data.get("job_targets") or []:
        if not isinstance(row, dict):
            continue
        category, subcategory = row.get("category"), row.get("subcategory")
        mapped = isinstance(category, str) and subcategory in subs.get(category, [])
        entry = dict(row)
        entry["taxonomy_match"] = mapped
        targets.append(entry)
        if not mapped:
            unmapped.append({"category": category, "subcategory": subcategory,
                             "published": subs.get(category, []) if isinstance(category, str) else []})
    return {
        "ok": True,
        "feed": "interest-profile",
        "present": True,
        "source": loaded["source"],
        "updated": data.get("updated") or data.get("t"),
        "tags": tags,
        "tag_count": len(interests),
        "sources": data.get("sources"),
        "job_targets": targets,
        "job_targets_unmapped": unmapped,
        "pending_count": len(data.get("pending") or []),
        "note": "Aggregated tags only; raw evidence stays on disk.",
    }


# ---------------------------------------------------------------------- house

def _compact_market(market):
    """Market block without per-source raw records (realestate.json carries ~5.8 MB of them)."""
    if not isinstance(market, dict):
        return market
    feed_sources = market.get("feed_sources")
    if not isinstance(feed_sources, dict):
        return market
    sources = []
    for src in feed_sources.get("sources") or []:
        if not isinstance(src, dict):
            continue
        records = src.get("records")
        slim = {k: v for k, v in src.items() if k != "records"}
        # The feed itself carries counts (`records_n`) and keeps the rows in a sidecar file.
        slim["records_returned"] = len(records) if isinstance(records, list) else src.get("records_n")
        sources.append(slim)
    return {**market, "feed_sources": {**feed_sources, "sources": sources}}


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def housing_market(scope: str = "all", city: str = "", max_price: int = 0, min_beds: int = 0,
                   limit: int = 20) -> dict:
    """Housing feed: market summary, for-sale homes, or commercial listings near Dana Point.

    scope is market, homes, commercial or all. city filters by substring,
    max_price and min_beds filter homes.
    """
    loaded = feeds.load("realestate")
    if "error" in loaded:
        return {"ok": False, "feed": "realestate", **loaded}
    data = loaded["data"]
    picked = (scope or "all").strip().lower()
    if picked not in ("all", "market", "homes", "commercial"):
        return {"ok": False, "feed": "realestate", "error": f"unknown scope {scope!r}",
                "allowed": ["all", "market", "homes", "commercial"]}
    payload: dict = {"ok": True, "feed": "realestate", "source": loaded["source"], "scope": picked}

    homes = [h for h in (data.get("homes") or []) if isinstance(h, dict)]
    if city:
        needle = city.strip().lower()
        homes = [h for h in homes if needle in str(h.get("city") or "").lower()
                 or needle in str(h.get("addr") or "").lower()]
    if max_price:
        homes = [h for h in homes if isinstance(h.get("price"), (int, float)) and h["price"] <= int(max_price)]
    if min_beds:
        homes = [h for h in homes if isinstance(h.get("beds"), (int, float)) and h["beds"] >= int(min_beds)]
    prices = sorted(h["price"] for h in homes if isinstance(h.get("price"), (int, float)))
    cap = max(1, min(int(limit or 20), 100))

    if picked in ("all", "market"):
        payload["market"] = _compact_market(data.get("market"))
    if picked in ("all", "homes"):
        payload["homes"] = {
            "matched": len(homes),
            "median_price": int(prices[len(prices) // 2]) if prices else None,
            "min_price": prices[0] if prices else None,
            "max_price": prices[-1] if prices else None,
            "items": homes[:cap],
        }
    if picked in ("all", "commercial"):
        commercial = [c for c in (data.get("commercial") or []) if isinstance(c, dict)]
        payload["commercial"] = {"matched": len(commercial), "items": commercial[:cap]}
    payload["disabled_sources"] = data.get("disabled") or []
    return payload


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def housing_segments(geo: str, segment: str = "", level: str = "") -> dict:
    """One state's or metro's property segment fields from the national dataset v2 manifest.

    geo is a state code (CA), a 5-digit CBSA code (31080), US, or part of a state or metro name; level (state, metro or
    us) narrows a name that fits both. segment is residential, multifamily, retail, office, industrial or economy,
    empty for all six. Each segment lists its fields best first with label, unit, value, publisher and period, its lead
    field, and the fields the build has no value for under unavailable (never zero). Reads
    house-feeds/national-v2/manifest.json and the segment spec of pixel-deck scripts/national/segments.json.
    """
    loaded = feeds.load("national-v2")
    if "error" in loaded:
        return {"ok": False, "feed": "national-v2", **loaded}
    answer = segments_lib.build(loaded["data"], geo, segment, level)
    return {"ok": answer.pop("ok"), "feed": "national-v2", "source": loaded["source"], **answer}


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def surf_report(spot: str = "") -> dict:
    """Surf report for the local breaks. Empty spot returns every spot plus tide and buoys."""
    loaded = feeds.load("surf")
    if "error" in loaded:
        return {"ok": False, "feed": "surf", **loaded}
    data = loaded["data"]
    spots = [s for s in (data.get("spots") or []) if isinstance(s, dict)]
    if not spot:
        chosen = spots
    else:
        needle = spot.strip().lower()
        chosen = [s for s in spots if needle in str(s.get("name") or "").lower()]
        if not chosen:
            return {"ok": False, "feed": "surf", "source": loaded["source"],
                    "error": f"no spot matching {spot!r}",
                    "known_spots": [s.get("name") for s in spots]}
    return {
        "ok": True,
        "feed": "surf",
        "source": loaded["source"],
        "spots": chosen,
        "tide": data.get("tide"),
        "buoys": data.get("buoys"),
    }


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def hockey(team: str = "") -> dict:
    """NHL team snapshot: record, standing, last and next game. Empty team returns all tracked teams."""
    loaded = feeds.load("hockey")
    if "error" in loaded:
        return {"ok": False, "feed": "hockey", **loaded}
    data = loaded["data"]
    teams = [t for t in (data.get("teams") or []) if isinstance(t, dict)]
    if not team:
        chosen = teams
    else:
        needle = team.strip().lower()
        chosen = [t for t in teams
                  if needle in str(t.get("abbr") or "").lower() or needle in str(t.get("name") or "").lower()]
        if not chosen:
            return {"ok": False, "feed": "hockey", "source": loaded["source"],
                    "error": f"no team matching {team!r}",
                    "known_teams": [(t.get("abbr"), t.get("name")) for t in teams]}
    return {"ok": True, "feed": "hockey", "source": loaded["source"], "teams": chosen, "live": data.get("live") or []}


# --------------------------------------------------------------------- ops

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def crons_attention(limit: int = 25) -> dict:
    """Scheduled jobs that need a look: failed or erroring results, and unhealthy groups."""
    loaded = feeds.load("schedules")
    if "error" in loaded:
        return {"ok": False, "feed": "schedules", **loaded}
    data = loaded["data"]
    cap = max(1, min(int(limit or 25), 100))
    attention: list[dict] = []
    bad_results = {"failed", "error", "errored", "timeout"}
    for group in data.get("groups") or []:
        if not isinstance(group, dict):
            continue
        for job in group.get("jobs") or []:
            if not isinstance(job, dict):
                continue
            result = str(job.get("result") or "").lower()
            detail = str(job.get("detail") or "").lower()
            if result in bad_results or "error" in detail or "fail" in detail:
                attention.append({
                    "id": job.get("id"),
                    "name": job.get("name"),
                    "host": job.get("host"),
                    "kind": job.get("kind"),
                    "schedule": job.get("schedule"),
                    "result": job.get("result"),
                    "detail": job.get("detail"),
                    "last": job.get("last"),
                    "group": group.get("id"),
                })
    unhealthy_groups = [g.get("id") for g in (data.get("groups") or [])
                        if isinstance(g, dict) and g.get("ok") is False]
    return {
        "ok": True,
        "feed": "schedules",
        "source": loaded["source"],
        "counts": data.get("counts"),
        "attention": attention[:cap],
        "attention_total": len(attention),
        "unhealthy_groups": unhealthy_groups,
    }


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def fleet_status() -> dict:
    """pc-desktop user units: failed units and whether the collector saw a clean sweep."""
    loaded = feeds.load("fleet")
    if "error" in loaded:
        return {"ok": False, "feed": "fleet", **loaded}
    data = loaded["data"]
    return {
        "ok": True,
        "feed": "fleet",
        "source": loaded["source"],
        "healthy": data.get("ok"),
        "failed_units": data.get("failed_units") or [],
        "failed_count": len(data.get("failed_units") or []),
    }


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def cluster_status() -> dict:
    """Local DeepSeek cluster as the deck feed last saw it: engine, nodes, bench, proxy.

    If the collector reports an engine inspect error while the proxy answers,
    the engine status is suspect, and this field says so.
    """
    loaded = feeds.load("cluster")
    if "error" in loaded:
        return {"ok": False, "feed": "cluster", **loaded}
    data = loaded["data"]
    engine = data.get("engine") or {}
    proxy = data.get("proxy") or {}
    errors = data.get("errors") or []
    suspect = bool(
        (str(engine.get("status") or "").lower() in ("", "down", "unknown")
        and proxy.get("pc_desktop_8080_up") is True)
        or any("engine inspect" in str(e.get("reason") or "") for e in errors if isinstance(e, dict))
    )
    return {
        "ok": True,
        "feed": "cluster",
        "source": loaded["source"],
        "engine": engine,
        "nodes": data.get("nodes") or [],
        "proxy": proxy,
        "bench": data.get("bench"),
        "ratchet": data.get("ratchet"),
        "engine_status_suspect": suspect,
        "suspect_reason": (
            "collector reported an engine inspect error or an empty container name while the proxy is up; "
            "read proxy and node containers before trusting engine.status"
        ) if suspect else None,
        "errors": errors,
    }


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def reply_block(limit: int = 15) -> dict:
    """Overnight reply block: Gmail reply drafts prepared for the 09:00 send block.

    Counts (threads waiting on the owner, drafts made, daily cap, Gmail draft count before and after),
    whether the local model or plain templates wrote them, and the ranked threads with links into Gmail.
    Drafts only: nothing is sent. The feed carries no message text.
    """
    loaded = feeds.load("replyblock")
    if "error" in loaded:
        return {"ok": False, "feed": "replyblock", **loaded}
    data = loaded["data"]
    cap = max(1, min(int(limit or 15), 50))
    keep = ("rank", "name", "subject", "age_h", "score", "reason", "status", "drafted", "draft_mode",
            "note", "thread_url", "draft_url")
    items = [{k: row.get(k) for k in keep if k in row} for row in data.get("items") or [] if isinstance(row, dict)]
    return {
        "ok": True,
        "feed": "replyblock",
        "source": loaded["source"],
        "date": data.get("date"),
        "card_for": data.get("card_for"),
        "mode": data.get("mode"),
        "model": data.get("model"),
        "counts": data.get("counts"),
        "drafts_url": data.get("drafts_url"),
        "items": items[:cap],
        "items_total": len(items),
    }


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def rank_watch(limit: int = 3) -> dict:
    """App Store rank watch: chart fetch health, alert counts and the newest alerts, warnings first.

    The per-app and per-category tables stay in the feed file; read it directly when you need them.
    """
    loaded = feeds.load("rankwatch")
    if "error" in loaded:
        return {"ok": False, "feed": "rankwatch", **loaded}
    data = loaded["data"]
    cap = max(1, min(int(limit or 3), 25))
    rows = [(i, a) for i, a in enumerate(data.get("alerts") or []) if isinstance(a, dict)]
    rows.sort(key=lambda pair: (pair[1].get("severity") != "warn", pair[0]))
    return {
        "ok": True,
        "feed": "rankwatch",
        "source": loaded["source"],
        "day": data.get("day"),
        "run": data.get("run"),
        "counts": data.get("counts"),
        "collector_stale": data.get("stale"),
        "alerts": [a for _, a in rows[:cap]],
        "alerts_total": len(rows),
    }


# ----------------------------------------------------------- release, network, house

_BAD_STATE_WORDS = ("REJECTED", "UNRESOLVED", "INVALID", "EXCEPTION", "EXPIRED", "MISSING", "FAILED")
_RECENT_FEEDBACK_S = 7 * 86400


def _rows(value) -> list[dict]:
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


def _sort_number(value: object) -> float:
    """Sort key: numbers by value, anything else after every real number."""
    return value if isinstance(value, (int, float)) else 10**9


def _app_attention(app: dict) -> list[str]:
    """Why one TestFlight app needs a look. Empty means calm."""
    why: list[str] = []
    if app.get("error"):
        why.append("collector error")
    build = app.get("latest_build") if isinstance(app.get("latest_build"), dict) else {}
    if not build:
        why.append("no build")
    else:
        if build.get("expired"):
            why.append("build expired")
        processing = str(build.get("processing_state") or "").upper()
        if processing and processing not in ("VALID", "PROCESSING"):
            why.append(f"processing {processing.lower()}")
        for key in ("internal_state", "external_state"):
            state = str(build.get(key) or "").upper()
            if any(word in state for word in _BAD_STATE_WORDS):
                why.append(state.lower())
    for version in _rows(app.get("versions")):
        state = str(version.get("state") or "").upper()
        if any(word in state for word in _BAD_STATE_WORDS):
            why.append(f"version {state.lower()}")
        # App Review problems live on the review submission: the version itself still reads PREPARE_FOR_SUBMISSION.
        submission = version.get("submission") if isinstance(version.get("submission"), dict) else {}
        review = str(submission.get("state") or "").upper()
        if any(word in review for word in _BAD_STATE_WORDS):
            why.append(f"review {review.lower()}")
    raw_feedback = app.get("feedback")
    feedback = raw_feedback if isinstance(raw_feedback, dict) else {}
    received = feedback.get("last_received_at")
    crashes = feedback.get("crashes_count")
    if isinstance(crashes, int) and crashes > 0 and isinstance(received, str):
        try:
            when = datetime.fromisoformat(received).timestamp()
        except ValueError:
            when = None
        age = datetime.now(tz=UTC).timestamp() - when if when is not None else None
        if age is not None and 0 <= age <= _RECENT_FEEDBACK_S:
            why.append(f"{crashes} crash reports, latest within 7 d")
    return list(dict.fromkeys(why))


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def release_status(attention_only: bool = False) -> dict:
    """TestFlight and App Store state per app: latest build, processing, feedback counts, App Store version state.

    Each app carries an ``attention`` list (collector error, expired build, rejected or unresolved version);
    attention_only keeps just those apps. Bundle ids are dropped. Read-only.
    """
    loaded = feeds.load("testflight")
    if "error" in loaded:
        return {"ok": False, "feed": "testflight", **loaded}
    apps = []
    for app in _rows(loaded["data"].get("apps")):
        raw_build = app.get("latest_build")
        raw_feedback = app.get("feedback")
        build = raw_build if isinstance(raw_build, dict) else {}
        feedback = raw_feedback if isinstance(raw_feedback, dict) else {}
        apps.append({
            "id": app.get("id"),
            "name": app.get("name"),
            "checked_at": app.get("checked_at"),
            "error": app.get("error"),
            "latest_build": {k: build.get(k) for k in ("number", "version", "uploaded_at", "processing_state", "expired",
                                                       "internal_state", "external_state") if k in build},
            "feedback": {k: feedback.get(k) for k in ("screenshots_count", "crashes_count", "last_received_at")
                         if k in feedback},
            "versions": [{"version": v.get("version"), "state": v.get("state"),
                          "submission_state": (v.get("submission") or {}).get("state") if isinstance(v.get("submission"), dict) else None,
                          "submitted_build": (v.get("submitted_build") or {}).get("number") if isinstance(v.get("submitted_build"), dict) else None}
                         for v in _rows(app.get("versions"))],
            "attention": _app_attention(app),
        })
    flagged = [a for a in apps if a["attention"]]
    return {
        "ok": True,
        "feed": "testflight",
        "source": loaded["source"],
        "apps_total": len(apps),
        "attention_total": len(flagged),
        "apps": flagged if attention_only else apps,
    }


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def deadlines(limit: int = 25) -> dict:
    """Upcoming renewals and paperwork dates, soonest first. Days, dates and status only: no dollar amounts, no evidence.

    The feed lists one ``errors`` row per source that failed, so a quiet list is not proof of a clear calendar.
    """
    loaded = feeds.load("deadlines")
    if "error" in loaded:
        return {"ok": False, "feed": "deadlines", **loaded}
    data = loaded["data"]
    cap = max(1, min(int(limit or 25), 100))
    renewals = [{k: r.get(k) for k in ("vendor", "date", "days") if k in r} for r in _rows(data.get("renewals"))]
    paperwork = [{k: p.get(k) for k in ("id", "kind", "thing", "date", "days_left", "status") if k in p}
                 for p in _rows(data.get("paperwork"))]
    renewals.sort(key=lambda r: _sort_number(r.get("days")))
    paperwork.sort(key=lambda p: _sort_number(p.get("days_left")))
    return {
        "ok": True,
        "feed": "deadlines",
        "source": loaded["source"],
        "renewals": renewals[:cap],
        "renewals_total": len(renewals),
        "paperwork": paperwork[:cap],
        "paperwork_total": len(paperwork),
        "errors": _rows(data.get("errors")),
    }


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def network(limit: int = 25) -> dict:
    """Tailnet exposure and device state: counts, alerts, exposed paths (Funnel first) and nodes. No IPs, no traffic.

    ``counts.funnel_public`` is the number of paths open to the whole internet.
    """
    loaded = feeds.load("tailscale")
    if "error" in loaded:
        return {"ok": False, "feed": "tailscale", **loaded}
    data = loaded["data"]
    cap = max(1, min(int(limit or 25), 100))
    funnel = (1, True, "1", "true")
    exposures = [{k: e.get(k) for k in ("host", "port", "path", "proto", "funnel") if k in e}
                 for e in _rows(data.get("exposures"))]
    exposures.sort(key=lambda e: e.get("funnel") not in funnel)
    alerts = [{k: a.get(k) for k in ("host", "kind", "msg", "severity") if k in a} for a in _rows(data.get("alerts"))]
    alerts.sort(key=lambda a: {"crit": 0, "warn": 1}.get(str(a.get("severity")), 2))
    nodes = [{k: n.get(k) for k in ("name", "host", "online", "last_seen_h", "os", "kind") if k in n}
             for n in _rows(data.get("nodes"))]
    return {
        "ok": True,
        "feed": "tailscale",
        "source": loaded["source"],
        "counts": data.get("counts"),
        "alerts": alerts[:cap],
        "alerts_total": len(alerts),
        "exposures": exposures[:cap],
        "exposures_total": len(exposures),
        "nodes": nodes[:cap],
        "nodes_total": len(nodes),
    }


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def stalls(limit: int = 25, include_ok: bool = False) -> dict:
    """Agent sessions and background units that stopped, failed or hit a rate limit, with the reason and a hint.

    Healthy rows are left out unless include_ok is true. Alert delivery settings stay in the feed file.
    """
    loaded = feeds.load("stalls")
    if "error" in loaded:
        return {"ok": False, "feed": "stalls", **loaded}
    data = loaded["data"]
    cap = max(1, min(int(limit or 25), 100))
    keep = ("id", "kind", "name", "host", "state", "since", "last_output_at", "reason", "hint")
    rows = [{k: r.get(k) for k in keep if k in r} for r in _rows(data.get("items"))]
    shown = rows if include_ok else [r for r in rows if r.get("state") != "ok"]
    return {
        "ok": True,
        "feed": "stalls",
        "source": loaded["source"],
        "counts": data.get("counts"),
        "thresholds": data.get("thresholds"),
        "items": shown[:cap],
        "items_total": len(shown),
    }


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def deck_needs(limit: int = 25) -> dict:
    """What needs Tanner now on the Products page: ranked actions with the reason and where to act, plus site state."""
    loaded = feeds.load("products")
    if "error" in loaded:
        return {"ok": False, "feed": "products", **loaded}
    data = loaded["data"]
    cap = max(1, min(int(limit or 25), 100))
    needs = [{k: n.get(k) for k in ("sev", "text", "why", "source", "url") if k in n} for n in _rows(data.get("needs"))]
    sites = [{k: p.get(k) for k in ("id", "name", "url", "code", "ms", "state") if k in p}
             for p in _rows(data.get("products"))]
    return {
        "ok": True,
        "feed": "products",
        "source": loaded["source"],
        "needs": needs[:cap],
        "needs_total": len(needs),
        "sites": sites,
    }


# ------------------------------------------------------------------------ gigs

GIG_KINDS = ("gig", "rfp", "contract", "expert")
GIG_PAY_UNITS = ("hour", "fixed", "year")
GIG_KEYS = ("id", "title", "site", "url", "kind", "category", "pay", "pay_min", "pay_max", "pay_unit", "currency",
            "est_hourly", "usd_total", "floor_ok", "fit", "skills", "posted_at", "summary", "why", "pitch",
            "carried", "t")


def _fit(row: dict) -> float:
    value = row.get("fit")
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0.0


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def gigs(query: str = "", min_fit: int = 0, kind: str = "", site: str = "", pay_unit: str = "",
         floor_only: bool = False, limit: int = 20) -> dict:
    """Tanner's freelance gigs, contracts, expert calls and public RFPs, best fit first.

    kind is gig, rfp, contract or expert. site matches the source site name exactly (case-insensitive).
    pay_unit is hour, fixed or year. min_fit is 0-100. floor_only keeps only listings whose pay clears
    the rate floor (floor_ok true). query is free text over title, summary, site, category and why.
    Each row carries a draft pitch: draft only, never sent by anything here. limit caps at 100.
    """
    picked_kind = (kind or "").strip().lower()
    if picked_kind and picked_kind not in GIG_KINDS:
        return {"ok": False, "error": f"unknown kind {kind!r}", "allowed": list(GIG_KINDS)}
    picked_unit = (pay_unit or "").strip().lower()
    if picked_unit and picked_unit not in GIG_PAY_UNITS:
        return {"ok": False, "error": f"unknown pay_unit {pay_unit!r}", "allowed": list(GIG_PAY_UNITS)}
    loaded = feeds.load("gigs")
    if "error" in loaded:
        return {"ok": False, "feed": "gigs", **loaded}
    data = loaded["data"]
    cap = max(1, min(int(limit or 20), 100))
    words = [w for w in (query or "").lower().split() if w]
    picked_site = (site or "").strip().lower()
    rows = _rows(data.get("gigs"))
    matched = []
    for row in rows:
        if _fit(row) < (min_fit or 0):
            continue
        if picked_kind and str(row.get("kind") or "").lower() != picked_kind:
            continue
        if picked_site and str(row.get("site") or "").lower() != picked_site:
            continue
        if picked_unit and str(row.get("pay_unit") or "").lower() != picked_unit:
            continue
        if floor_only and row.get("floor_ok") is not True:
            continue
        if words:
            tags = [str(w) for k in ("why", "skills") if isinstance(row.get(k), list) for w in row[k]]
            fields = [str(row.get(k) or "") for k in ("title", "summary", "site", "category")]
            hay = " ".join(fields + tags).lower()
            if not all(w in hay for w in words):
                continue
        matched.append({k: row.get(k) for k in GIG_KEYS if k in row})
    matched.sort(key=_fit, reverse=True)
    return {
        "ok": True,
        "feed": "gigs",
        "source": loaded["source"],
        "sites_registry": data.get("sites_registry"),
        "sites_checked": data.get("sites_checked"),
        "sites_attempted": data.get("sites_attempted"),
        "sites_returned": data.get("sites_returned"),
        "coverage": data.get("coverage"),
        "by_site": data.get("by_site") or {},
        "gigs_total": len(rows),
        "matched": len(matched),
        "gigs": matched[:cap],
        "errors": _rows(data.get("errors")),
        "math": data.get("math"),
        "rotation": data.get("rotation"),
        "fx": data.get("fx"),
    }


# ---------------------------------------------------------------------- photos

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def photos_on_this_day() -> dict:
    """Photos taken on today's month and day in earlier years: the total and a count per year.

    Counts only. The feed's photo ids stay in the feed file; no file names, places or people reach this tool.
    """
    loaded = feeds.load("onthisday")
    if "error" in loaded:
        return {"ok": False, "feed": "onthisday", **loaded}
    data = loaded["data"]
    years = [{"year": y.get("year"), "count": y.get("count")} for y in _rows(data.get("years"))]
    return {
        "ok": True,
        "feed": "onthisday",
        "source": loaded["source"],
        "month_day": data.get("month_day"),
        "today": data.get("today"),
        "total": data.get("total"),
        "years": years,
        "catalog_rows": data.get("catalog_rows"),
        "basis": data.get("source"),
    }


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def photo_years() -> dict:
    """Photo and video counts per calendar year, zero-filled between the first and last dated year.

    Counts only. Undated items are counted once in ``undated`` and left out of the years.
    """
    loaded = feeds.load("photoyears")
    if "error" in loaded:
        return {"ok": False, "feed": "photoyears", **loaded}
    data = loaded["data"]
    years = [{"year": y.get("year"), "image": y.get("image"), "video": y.get("video")} for y in _rows(data.get("years"))]
    return {
        "ok": True,
        "feed": "photoyears",
        "source": loaded["source"],
        "years": years,
        "dated_total": data.get("dated_total"),
        "undated": data.get("undated"),
        "other_media": data.get("other_media"),
        "basis": data.get("source"),
    }

# ------------------------------------------------------- deals, travel, outdoors, life

def _items(data: dict, keep: tuple[str, ...], field: str = "", value: str = "") -> list[dict]:
    """Flat contract items, each trimmed to ``keep`` plus its own ``source_url`` and ``as_of``; an empty filter keeps all."""
    want = (value or "").strip().lower()
    rows = []
    for row in _rows(data.get("items")):
        if want and str(row.get(field) or "").lower() != want:
            continue
        rows.append({k: row.get(k) for k in (*keep, "source_url", "as_of") if k in row})
    return rows


def _contract_answer(name: str, keep: tuple[str, ...], field: str, value: str, limit: int,
                     top_keys: tuple[str, ...] = ()) -> dict:
    loaded = feeds.load(name)
    if "error" in loaded:
        return {"ok": False, "feed": name, "collected": False, **loaded}
    data = loaded["data"]
    rows = _items(data, keep, field, value)
    cap = max(1, min(int(limit or 20), 100))
    kinds = sorted({str(r.get(field)) for r in _rows(data.get("items")) if r.get(field) is not None})
    return {
        "ok": True,
        "feed": name,
        "collected": True,
        "source": loaded["source"],
        "filter": {field: value or None},
        f"{field}_values": kinds,
        "items": rows[:cap],
        "items_total": len(rows),
        **{k: data.get(k) for k in top_keys},
    }


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def shop_deals(limit: int = 10) -> dict:
    """Shop trends deals: listings priced under their product's median, plus the week's biggest price movers.

    Reads the house ecom feed (shoptrends). Every deal names its store, price, median and link; a store that blocks
    automated search shows in ``coverage``/errors, never as a zero price.
    """
    loaded = feeds.load("ecom")
    if "error" in loaded:
        return {"ok": False, "feed": "ecom", "collected": False, **loaded}
    data = loaded["data"]
    cap = max(1, min(int(limit or 10), 50))
    deals = [{k: d.get(k) for k in ("slug", "title", "site", "price", "median", "vs_median", "condition", "url") if k in d}
             for d in _rows(data.get("deals"))]
    movers = [{k: m.get(k) for k in ("slug", "query", "category", "median", "chg7", "chg30", "n", "sites_ok") if k in m}
              for m in _rows(data.get("movers"))]
    return {
        "ok": True,
        "feed": "ecom",
        "collected": True,
        "source": loaded["source"],
        "as_of": data.get("as_of"),
        "deals": deals[:cap],
        "deals_total": len(deals),
        "movers": movers[:cap],
        "coverage": data.get("coverage"),
    }


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def travel_deals(kind: str = "", limit: int = 20) -> dict:
    """Ranked flight, hotel and airline-sale deals from the travel-deals feed (every 6 h).

    kind is flight, hotel or sale; empty keeps all. Prices are USD; savings compare against the route's baseline.
    Separate-ticket itineraries carry ``protected: false`` and a ``risk`` line.
    """
    keep = ("id", "rank", "kind", "category", "title", "subtitle", "price", "currency", "baseline_price", "savings",
            "savings_pct", "location", "route", "origin", "dest", "depart_date", "cabin", "protected", "risk")
    return _contract_answer("travel-deals", keep, "kind", kind, limit, top_keys=("summary",))


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def outdoors(kind: str = "", limit: int = 20) -> dict:
    """Surf, cams, fishing, snow, Ikon pass and WSL items from the outdoors feed (every 2 h).

    kind is surf, cam, fishing, snow, ikon or wsl; empty keeps all.
    """
    keep = ("kind", "title", "summary", "location", "price", "currency")
    return _contract_answer("outdoors", keep, "kind", kind, limit)


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def life(kind: str = "", limit: int = 20) -> dict:
    """Gas prices, local jobs, homes and trends from the life feed (daily).

    kind is gas, job, home, pooled or trend; empty keeps all. Unknown values are null, never 0.
    """
    keep = ("kind", "category", "title", "subtitle", "detail", "price", "currency", "place", "org", "pay_min", "pay_max",
            "posted_at", "value", "delta_7d_pct", "delta_1y_pct")
    return _contract_answer("life", keep, "kind", kind, limit)


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def history_goodnews(section: str = "", limit: int = 20) -> dict:
    """On this day in history, good news, world events and long trends from the history-goodnews feed (daily).

    section is trend, on_this_day, good_news or world_event; empty keeps all. Each item names its outlet in ``source``.
    """
    keep = ("section", "title", "summary", "kind", "source", "year", "published", "latest_value", "unit", "hopeful_pair")
    return _contract_answer("history-goodnews", keep, "section", section, limit)


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def feed_freshness() -> dict:
    """Age of every feed this server can read, with the feeds' own collector errors."""
    report = feeds.freshness()
    report["root"] = _root()
    return report


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def deck_feeds_status() -> dict:
    """Server identity and feed root. Use this first when a result looks empty."""
    return {
        "ok": True,
        "server": "deck-feeds-mcp",
        "status_root": _root(),
        "deck_dir": str(feeds.DECK_DIR),
        "house_dir": str(feeds.HOUSE_DIR),
        "feeds": sorted(feeds.ALLOWED_NAMES),
        "pid": os.getpid(),
        "mode": "read-only, no network",
    }


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def feed_contract(feed: str = "") -> dict:
    """Validate a live feed against its published contract.

    feed is jobs, interest-profile, launch, or empty for all three. Returns measured counts
    (categories, metros, rows), every rule violation it found, and one pass/fail per check.
    """
    picked = (feed or "").strip().lower()
    checks = {"jobs": contract_lib.validate_jobs,
              "interest-profile": contract_lib.validate_interest_profile,
              "launch": contract_lib.validate_launch}
    if not picked:
        return contract_lib.validate_all()
    if picked not in checks:
        return {"ok": False, "error": f"unknown feed {feed!r}", "allowed": sorted(checks)}
    return checks[picked]()


if __name__ == "__main__":  # pragma: no cover
    mcp.run()
