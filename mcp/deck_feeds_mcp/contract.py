"""Validate the live deck feeds against the contract the collectors publish.

Each check answers with counts that were measured from the file, not assumed: how many rows
sit in each category, how many metros are covered, and which rows break the owner rules.
Nothing here writes, and a missing feed is reported as missing rather than as an empty pass.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from . import feeds, jobs
from . import taxonomy as taxonomy_contract

# A feed is fresh while it is younger than this many refresh intervals.
STALE_AFTER_REFRESHES = 3
LAUNCH_KINDS = ("skill", "mcp", "tool", "plugin", "automation", "command")


def _now() -> float:
    return datetime.now(tz=UTC).timestamp()


def _age(data: dict, source: dict) -> int:
    stamp = data.get("t")
    if isinstance(stamp, (int, float)):
        return max(0, int(_now() - float(stamp)))
    return int(source.get("age_s") or 0)


def _check(name: str, ok: bool, detail: str, **fields: Any) -> dict:
    return {"check": name, "ok": bool(ok), "detail": detail, **fields}


def validate_jobs() -> dict:
    """jobs.json against the contract in README.md and deck_feeds_mcp/jobs.py."""
    loaded = feeds.load("jobs")
    if "error" in loaded:
        return {"feed": "jobs", "ok": False, "error": loaded["error"], "source": loaded.get("source")}
    data, source = loaded["data"], loaded["source"]
    listings = [row for row in (data.get("listings") or []) if isinstance(row, dict)]
    checks: list[dict] = []

    found = jobs.taxonomy(data)
    categories = [row["slug"] for row in found["taxonomy"]]
    subs = {row["slug"]: [sub["slug"] for sub in row["subs"]] for row in found["taxonomy"]}
    checks.append(_check(
        "taxonomy sources", found["taxonomy_source"] == "feed" and found["rules_source"] == "feed",
        f"taxonomy={found['taxonomy_source']} rules={found['rules_source']}",
        categories=len(found["taxonomy"]), subcategories=sum(len(v) for v in subs.values()),
        problems={k: found[k] for k in ("taxonomy_problem", "rules_problem") if k in found},
    ))

    counts: dict[str, int] = {}
    bad_category: list[dict] = []
    bad_subcategory: list[dict] = []
    missing_fields: dict[str, int] = {}
    for row in listings:
        category, sub = row.get("category"), row.get("subcategory")
        if category is None:
            bad_category.append({"title": row.get("title"), "url": row.get("url")})
            continue
        counts[category] = counts.get(category, 0) + 1
        if category not in subs:
            bad_category.append({"title": row.get("title"), "category": category})
        elif sub not in subs[category]:
            bad_subcategory.append({"title": row.get("title"), "category": category, "subcategory": sub})
        for key in ("metro", "mode", "pay_min", "pay_max", "cluster_take"):
            if key not in row:
                missing_fields[key] = missing_fields.get(key, 0) + 1
    unknown_categories = sorted(set(counts) - set(categories))
    empty_categories = sorted(slug for slug in categories if counts.get(slug, 0) == 0)
    checks.append(_check(
        "every row carries a published category",
        not bad_category and not unknown_categories,
        f"{len(listings)} rows, {len(counts)} categories used, {len(empty_categories)} quiet this run",
        counts=counts, unknown=unknown_categories, uncategorized=len(bad_category),
        empty_categories=empty_categories,
    ))
    checks.append(_check(
        "every subcategory is published in its category",
        not bad_subcategory,
        f"{len(bad_subcategory)} rows use a subcategory outside the published taxonomy",
        violations=bad_subcategory[:10],
    ))
    checks.append(_check(
        "every listing carries the published fields",
        not missing_fields,
        "metro, mode, pay_min, pay_max and cluster_take are required on every row",
        missing=missing_fields,
    ))

    metros: dict[str, int] = {}
    metro_violations: list[dict] = []
    for row in listings:
        metro = row.get("metro")
        metro = metro if metro in jobs.METRO_RANK else "unknown"
        metros[metro] = metros.get(metro, 0) + 1
        if metro == "unknown":
            metro_violations.append({"title": row.get("title"), "location": row.get("location")})
    checks.append(_check(
        "metro coverage",
        not metro_violations,
        f"{len([m for m in metros if m != 'unknown'])} of 5 metros used",
        metros=metros, outside=len(metro_violations), examples=metro_violations[:5],
    ))

    threshold = int(found["rules"].get("remote_min_pay", 100000))
    in_person = set(found["rules"].get("in_person_metros") or ())
    remote_bad: list[dict] = []
    area_bad: list[dict] = []
    for row in listings:
        pay_max = row.get("pay_max")
        if row.get("metro") == "remote":
            if not isinstance(pay_max, (int, float)) or pay_max < threshold:
                remote_bad.append({"title": row.get("title"), "pay_max": pay_max,
                                   "pay_text": row.get("pay_text")})
        elif row.get("metro") not in in_person:
            area_bad.append({"title": row.get("title"), "metro": row.get("metro")})
    checks.append(_check(
        "remote pay rule",
        not remote_bad,
        f"remote rows need pay_max >= ${threshold:,}; {len(remote_bad)} violate it",
        threshold=threshold, violations=len(remote_bad), examples=remote_bad[:5],
    ))
    checks.append(_check(
        "in-person area rule",
        not area_bad,
        f"in-person rows must sit in {', '.join(sorted(in_person))}; {len(area_bad)} do not",
        violations=len(area_bad), examples=area_bad[:5],
    ))

    market = jobs.market_or_derived(data)
    published_market = market["market"].get("by_category") or {}
    market_gap = sorted(set(counts) - set(published_market))
    checks.append(_check(
        "market block covers every category in use",
        market["market_source"] == "feed" and not market_gap,
        f"market_source={market['market_source']}",
        market_source=market["market_source"], missing=market_gap,
    ))

    refresh = int(data.get("refresh") or 0) or 3600
    age = _age(data, source)
    checks.append(_check(
        "freshness", age <= refresh * STALE_AFTER_REFRESHES,
        f"age {age}s against refresh {refresh}s",
        age_s=age, refresh_s=refresh,
    ))

    return {
        "feed": "jobs",
        "ok": all(check["ok"] for check in checks),
        "source": source,
        "rows": len(listings),
        "categories": counts,
        "metros": metros,
        "remote_pay_violations": len(remote_bad),
        "checks": checks,
        "errors": data.get("errors") or [],
    }


def validate_interest_profile() -> dict:
    """interest-profile.json: shape, freshness and whether the collector completed a pass."""
    loaded = feeds.load("interest-profile")
    if "error" in loaded:
        return {"feed": "interest-profile", "ok": False, "error": loaded["error"], "source": loaded.get("source")}
    data, source = loaded["data"], loaded["source"]
    checks: list[dict] = []
    interests = [row for row in (data.get("interests") or []) if isinstance(row, dict)]
    targets = [row for row in (data.get("job_targets") or []) if isinstance(row, dict)]
    pending = [row for row in (data.get("pending") or []) if isinstance(row, dict)]
    subs = taxonomy_contract.subs()

    checks.append(_check(
        "top-level keys",
        all(key in data for key in ("t", "sources", "interests", "job_targets", "pending")),
        "t, sources, interests, job_targets and pending are required",
        keys=sorted(data.keys()),
    ))
    bad_interest = [row for row in interests
                    if not isinstance(row.get("tag"), str) or not row.get("tag")
                    or not isinstance(row.get("weight"), (int, float))]
    checks.append(_check(
        "interest rows", not bad_interest, f"{len(interests)} interests, {len(bad_interest)} malformed",
        tags=len(interests), malformed=len(bad_interest),
    ))
    bad_target = [row for row in targets
                  if row.get("category") not in subs or row.get("subcategory") not in subs.get(str(row.get("category")), [])]
    checks.append(_check(
        "job targets use the published taxonomy", not bad_target,
        f"{len(targets)} targets, {len(bad_target)} outside the taxonomy",
        targets=len(targets), violations=[row.get("category") for row in bad_target][:5],
    ))
    partial = bool(data.get("partial"))
    checks.append(_check(
        "collector pass completed", not partial,
        "partial=true means the collector stopped before reading every source",
        partial=partial, pending=len(pending), errors=len(data.get("errors") or []),
    ))
    refresh = int(data.get("refresh") or 0) or 86400
    age = _age(data, source)
    checks.append(_check(
        "freshness", age <= refresh * STALE_AFTER_REFRESHES,
        f"age {age}s against refresh {refresh}s", age_s=age, refresh_s=refresh,
    ))
    return {
        "feed": "interest-profile",
        "ok": all(check["ok"] for check in checks),
        "source": source,
        "keys": sorted(data.keys()),
        "interests": len(interests),
        "job_targets": len(targets),
        "pending": len(pending),
        "checks": checks,
    }


def validate_launch() -> dict:
    """launch.json: shape, id contract and the per-item targets the Deck needs."""
    loaded = feeds.load("launch")
    if "error" in loaded:
        return {"feed": "launch", "ok": False, "error": loaded["error"], "source": loaded.get("source")}
    data, source = loaded["data"], loaded["source"]
    checks: list[dict] = []
    raw_items = data.get("items")
    items = [row for row in raw_items if isinstance(row, dict)] if isinstance(raw_items, list) else []
    malformed_items = len(raw_items) - len(items) if isinstance(raw_items, list) else 0
    ids = [row.get("id") for row in items]
    bad_id = [row.get("id") for row in items
              if not isinstance(row.get("id"), str)
              or row["id"].split(":", 1)[0] not in LAUNCH_KINDS
              or not row["id"].split(":", 1)[1]]
    duplicate = sorted({value for value in ids if isinstance(value, str) and ids.count(value) > 1})
    bad_targets = [row.get("id") for row in items
                   if not isinstance(row.get("targets"), list)
                   or any(target not in ("hermes", "omp") for target in row["targets"])]
    view_only = [row.get("id") for row in items if row.get("targets") == []]
    no_arg = [row.get("id") for row in items
              if "hermes" in (row.get("targets") or []) and not isinstance(row.get("arg"), str)]
    empty_arg = [row.get("id") for row in items
                 if "hermes" in (row.get("targets") or []) and row.get("arg") == ""]
    kinds: dict[str, int] = {}
    for row in items:
        kind = str(row.get("id") or "").split(":", 1)[0]
        kinds[kind] = kinds.get(kind, 0) + 1

    checks.append(_check(
        "top-level keys", isinstance(raw_items, list) and malformed_items == 0,
        "items must be a list of objects", keys=sorted(data.keys()), items=len(items),
        malformed=malformed_items,
    ))
    checks.append(_check(
        "ids follow the launch contract", not bad_id,
        f"ids must be <kind>:<slug> with kind in {', '.join(LAUNCH_KINDS)}",
        malformed=len(bad_id), examples=bad_id[:5],
    ))
    checks.append(_check("ids are unique", not duplicate, f"{len(duplicate)} duplicate ids",
                         duplicates=duplicate[:5]))
    checks.append(_check(
        "targets are recognised", not bad_targets,
        "targets must be a list drawn from hermes, omp; an empty list is the Deck's view-only state",
        malformed=len(bad_targets), examples=bad_targets[:5], view_only=len(view_only),
    ))
    checks.append(_check(
        "hermes-targeted items carry an arg", not (no_arg or empty_arg),
        "the Deck runs deck-launch <target> <id> and needs arg for the skill or command",
        missing=len(no_arg), empty=len(empty_arg), examples=(no_arg + empty_arg)[:5],
    ))
    refresh = int(data.get("refresh") or 0) or 900
    age = _age(data, source)
    checks.append(_check("freshness", age <= refresh * STALE_AFTER_REFRESHES,
                         f"age {age}s against refresh {refresh}s", age_s=age, refresh_s=refresh))
    return {
        "feed": "launch",
        "ok": all(check["ok"] for check in checks),
        "source": source,
        "keys": sorted(data.keys()),
        "items": len(items),
        "counts": data.get("counts"),
        "kinds": kinds,
        "checks": checks,
    }


def validate_all() -> dict:
    reports = [validate_jobs(), validate_interest_profile(), validate_launch()]
    return {
        "ok": all(report.get("ok") for report in reports),
        "feeds": {report["feed"]: report for report in reports},
    }
