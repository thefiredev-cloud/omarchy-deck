"""Job taxonomy, metro and pay parsing, and market roll-ups for the deck feeds.

The Jobs collector (``~/ops/bin/deck-feed-jobs``) owns ``jobs.json`` and publishes its own
``taxonomy``, ``rules`` and ``market`` blocks. This module reads those blocks and validates
them. When a feed is older than the contract it falls back to the same agreed taxonomy held
in :mod:`deck_feeds_mcp.taxonomy`, which is generated from the collector's canonical
``deck_jobs_taxonomy.py``, so the fallback cannot invent different slugs than the feed.
Every answer says which source it used (``taxonomy_source``, ``market_source``).
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from statistics import median
from typing import Any

from . import taxonomy as contract

# Metro tiers ordered by distance from Dana Point. ``unknown`` means outside the four metros.
METRO_RANK = {"south_oc": 0, "oc": 1, "la": 2, "sd": 3, "remote": 4}

SOUTH_OC = contract.metros()["south_oc"]
OC = contract.metros()["oc"]
LA = contract.metros()["la"]
SD = contract.metros()["sd"]
TAXONOMY = contract.taxonomy()
RULES = contract.rules()

CITY_TIERS = (("south_oc", SOUTH_OC), ("oc", OC), ("la", LA), ("sd", SD))
MODES = ("in_person", "hybrid", "remote")

# A single weak body hit does not claim a category; the collector uses the same floor.
MIN_CLASSIFY_SCORE = 10

_REMOTE_LOCATION = re.compile(r"\bremote\b|\bwork from home\b|\banywhere\b", re.IGNORECASE)
_REMOTE_BODY = re.compile(r"\bfully remote\b|\bremote \(|\bremote\b", re.IGNORECASE)
_HYBRID = re.compile(r"\bhybrid\b", re.IGNORECASE)
_SEPARATOR = re.compile(r"\s+")

_HOURLY = re.compile(r"\$?\s*(?P<low>\d{1,3}(?:[.,]\d+)?)\s*(?:-|\u2013|to)\s*\$?\s*(?P<high>\d{1,3}(?:[.,]\d+)?)\s*(?:/|per\s+)?\s*(?:hr|hour|hourly)", re.IGNORECASE)
_HOURLY_SINGLE = re.compile(r"\$?\s*(?P<num>\d{1,3}(?:[.,]\d+)?)\s*(?:/|per\s+)?\s*(?:hr|hour|hourly)", re.IGNORECASE)
_AMOUNT = re.compile(r"\$?\s*(?P<num>\d[\d,\.]*)\s*(?P<k>k)?", re.IGNORECASE)

HOURS_PER_YEAR = 2080
ANNUAL_FLOOR = 20000


def _squash(value: Any, limit: int) -> str:
    return _SEPARATOR.sub(" ", str(value or "")).strip()[:limit]


def _text_of(listing: dict, keys: tuple[str, ...], limit: int = 4000) -> str:
    return _squash(" ".join(str(listing.get(key) or "") for key in keys), limit)


def classify(listing: dict) -> tuple[str | None, str | None]:
    """Best-effort category and subcategory from the listing text.

    Mirrors the collector's scoring: a title hit counts three times a body hit, a category
    context word is a weak tie-breaker, and one weak body hit alone claims nothing.
    """
    title = _squash(listing.get("title"), 200).lower()
    if not title or contract.title_drop().search(title):
        return None, None
    body = _text_of(listing, ("summary", "note", "salary", "pay_text")).lower()
    company = _squash(listing.get("company"), 200).lower()
    scores: dict[tuple[str, str], int] = {}
    for category, sub, weight, pattern in contract.keyword_rules():
        score = 0
        if pattern.search(title):
            score += weight * 3
        if body and pattern.search(body):
            score += weight
        if score:
            scores[(category, sub)] = scores.get((category, sub), 0) + score
    hay = " ".join((title, company, body[:1500]))
    subs = contract.subs()
    for category, weight, pattern in contract.context_rules():
        if pattern.search(hay):
            for sub in subs[category]:
                scores[(category, sub)] = scores.get((category, sub), 0) + weight
    if not scores:
        return None, None
    order = list(subs)
    best = max(scores.items(), key=lambda kv: (kv[1], -order.index(kv[0][0]), -subs[kv[0][0]].index(kv[0][1])))
    if best[1] < MIN_CLASSIFY_SCORE:
        return None, None
    return best[0]


def _metro_slug(location: str) -> str | None:
    """Tier order first (south OC beats OC), then the longest city name inside the tier."""
    text = location.lower()
    for metro, cities in CITY_TIERS:
        hits = [city for city in cities if city in text]
        if hits:
            return metro
    return None


def metro_of(listing: dict) -> str:
    """Metro bucket for one listing, or ``unknown`` when it is outside the four metros.

    Matches the collector: remote wins when the source says remote, the location says remote,
    or (only when no known city is named) the body says remote. A remote role restricted to
    another country is out of area, not remote-US.
    """
    location = _squash(listing.get("location"), 200)
    hay = location.lower()
    slug = _metro_slug(hay)
    remote_word = (listing.get("remote") is True or str(listing.get("mode") or "").lower() == "remote"
                   or bool(_REMOTE_LOCATION.search(hay)))
    if not remote_word and not slug:
        remote_word = bool(_REMOTE_BODY.search(_text_of(listing, ("summary", "note"), 600)))
    if remote_word:
        if contract.remote_foreign().search(hay) and not contract.remote_us_ok().search(hay):
            return "unknown"
        return "remote"
    return slug or "unknown"


def mode_of(listing: dict) -> str:
    """Work mode: the feed's value when valid, else derived from the remote flag and text."""
    mode = str(listing.get("mode") or "").strip().lower()
    if mode in MODES:
        return mode
    if listing.get("remote") is True or _REMOTE_LOCATION.search(_squash(listing.get("location"), 200)):
        return "remote"
    hay = _text_of(listing, ("location", "summary"))
    if _HYBRID.search(hay):
        return "hybrid"
    return "in_person"


def pay_range(listing: dict) -> tuple[int | None, int | None, str | None]:
    """Annual pay bounds in USD, hourly rates multiplied by 2080."""
    text = " ".join(str(listing.get(key) or "") for key in ("pay_text", "salary")).strip()
    if not text:
        return None, None, None
    hourly_range = _HOURLY.search(text)
    if hourly_range:
        low = float(hourly_range.group("low").replace(",", "."))
        high = float(hourly_range.group("high").replace(",", "."))
        return round(low * HOURS_PER_YEAR), round(high * HOURS_PER_YEAR), text
    hourly = _HOURLY_SINGLE.search(text)
    if hourly:
        rate = float(hourly.group("num").replace(",", "."))
        value = round(rate * HOURS_PER_YEAR)
        return value, value, text
    amounts: list[int] = []
    for match in _AMOUNT.finditer(text):
        raw = match.group("num").replace(",", "")
        try:
            amount = float(raw)
        except ValueError:
            continue
        if match.group("k"):
            amount *= 1000
        elif amount < 1000 and "," not in match.group("num"):
            # "$185" style without a k suffix inside a pay range: treat as thousands.
            amount *= 1000
        if amount >= ANNUAL_FLOOR:
            amounts.append(int(amount))
    if not amounts:
        return None, None, text
    return min(amounts), max(amounts), text


def _feed_value(listing: dict, key: str, fallback: Any) -> Any:
    """The feed's value when it reports one. An explicit null means unknown, not a value."""
    value = listing.get(key)
    return fallback if value is None else value


def _normalise(listing: dict, *, fallback_classify: bool = True) -> dict:
    out = dict(listing)
    category, subcategory = listing.get("category"), listing.get("subcategory")
    classified_by = "feed"
    if not category and fallback_classify:
        category, subcategory = classify(listing)
        classified_by = "server-keyword-fallback"
    out["category"] = category
    out["subcategory"] = subcategory
    out["classified_by"] = classified_by
    published_metro = str(listing.get("metro") or "").strip()
    out["metro"] = published_metro if published_metro in METRO_RANK else metro_of(listing)
    out["mode"] = mode_of(listing)
    pay_min, pay_max, pay_text = pay_range(listing)
    out["pay_min"] = _feed_value(listing, "pay_min", pay_min)
    out["pay_max"] = _feed_value(listing, "pay_max", pay_max)
    out["pay_text"] = listing.get("pay_text") or pay_text
    return out


def search(listings: Iterable[dict], *, category: str = "", subcategory: str = "", metro: str = "",
           min_pay: int = 0, query: str = "", limit: int = 20, apply_rules: bool = True,
           remote_min_pay: int | None = None, rules: dict | None = None,
           fallback_classify: bool = True) -> dict:
    """Filter listings by the agreed rules and return matches plus exclusion counts.

    ``rules`` is the feed's own rules block (validated by the caller); each person's feed carries
    its own remote pay floor and in-person metros. Without it the seed (Tanner's) rules apply.
    ``fallback_classify=False`` leaves an untagged row untagged: the keyword fallback knows only
    Tanner's taxonomy, so it must not file another person's rows under Tanner's slugs.
    """
    active = rules if rules is not None else RULES
    threshold = active["remote_min_pay"] if remote_min_pay is None else int(remote_min_pay)
    needle = query.strip().lower()
    allowed = set(active["in_person_metros"])
    rows: list[dict] = []
    excluded = {"area": 0, "remote_pay": 0, "min_pay": 0, "category_unknown": 0}
    for raw in listings:
        if not isinstance(raw, dict):
            continue
        item = _normalise(raw, fallback_classify=fallback_classify)
        if apply_rules:
            if item["metro"] == "remote":
                if item["pay_max"] is None or item["pay_max"] < threshold:
                    excluded["remote_pay"] += 1
                    continue
            elif item["metro"] not in allowed:
                excluded["area"] += 1
                continue
        if category and item["category"] != category:
            if item["category"] is None:
                excluded["category_unknown"] += 1
            continue
        if subcategory and item["subcategory"] != subcategory:
            continue
        if metro and item["metro"] != metro:
            continue
        if min_pay and (item["pay_max"] is None or item["pay_max"] < min_pay):
            excluded["min_pay"] += 1
            continue
        if needle and needle not in " ".join(
            str(item.get(key) or "") for key in ("title", "company", "location", "summary", "note")
        ).lower():
            continue
        rows.append(item)
    rows.sort(key=lambda row: (
        METRO_RANK.get(row["metro"], 9),
        -(row.get("score") or 0),
        -(row.get("pay_max") or 0),
    ))
    limit = max(1, min(int(limit or 20), 100))
    return {
        "matched": len(rows),
        "excluded": excluded,
        "rules": active if apply_rules else None,
        "listings": rows[:limit],
    }


def market(listings: Iterable[dict], *, fallback_classify: bool = True) -> dict:
    """Roll up counts, metro split and pay by category. Derived from listings."""
    by_category: dict[str, dict] = {}
    for raw in listings:
        if not isinstance(raw, dict):
            continue
        item = _normalise(raw, fallback_classify=fallback_classify)
        slug = item["category"] or "uncategorized"
        bucket = by_category.setdefault(slug, {
            "total": 0,
            "by_metro": {"south_oc": 0, "oc": 0, "la": 0, "sd": 0, "remote": 0, "other": 0},
            "pay_max": [],
            "employers": {},
            "remote_unknown_pay": 0,
        })
        bucket["total"] += 1
        metro = item["metro"] if item["metro"] in bucket["by_metro"] else "other"
        bucket["by_metro"][metro] += 1
        if item["pay_max"]:
            bucket["pay_max"].append(item["pay_max"])
        elif metro == "remote":
            bucket["remote_unknown_pay"] += 1
        company = str(item.get("company") or "").strip()
        if company:
            bucket["employers"][company] = bucket["employers"].get(company, 0) + 1
    out = {}
    for slug, bucket in by_category.items():
        pay = bucket.pop("pay_max")
        employers = bucket.pop("employers")
        bucket["median_pay_max"] = int(median(pay)) if pay else None
        bucket["top_employers"] = [
            {"name": name, "count": count}
            for name, count in sorted(employers.items(), key=lambda kv: (-kv[1], kv[0]))[:5]
        ]
        out[slug] = bucket
    return out


def taxonomy_block_problem(block: Any) -> str | None:
    """Why a feed's taxonomy block cannot be trusted, or None when it is well formed."""
    if not isinstance(block, list) or not block:
        return "taxonomy must be a non-empty list"
    seen: set[str] = set()
    for row in block:
        if not isinstance(row, dict):
            return "every category must be an object"
        slug = row.get("slug")
        if not isinstance(slug, str) or not slug:
            return "every category needs a slug"
        if slug in seen:
            return f"duplicate category slug {slug}"
        seen.add(slug)
        if not isinstance(row.get("name"), str) or not row.get("name"):
            return f"category {slug} has no name"
        subs = row.get("subs")
        if not isinstance(subs, list) or not subs:
            return f"category {slug} has no subcategories"
        sub_slugs: set[str] = set()
        for sub in subs:
            if not isinstance(sub, dict) or not isinstance(sub.get("slug"), str) or not sub.get("slug"):
                return f"category {slug} has a subcategory without a slug"
            if sub["slug"] in sub_slugs:
                return f"category {slug} repeats subcategory {sub['slug']}"
            sub_slugs.add(sub["slug"])
    return None


def rules_block_problem(block: Any) -> str | None:
    """Why a feed's rules block cannot be trusted, or None when it is well formed."""
    if not isinstance(block, dict):
        return "rules must be an object"
    metros_list = block.get("in_person_metros")
    if not isinstance(metros_list, list) or not metros_list:
        return "rules.in_person_metros must be a non-empty list"
    if any(metro not in METRO_RANK or metro == "remote" for metro in metros_list):
        return "rules.in_person_metros must name in-person metros only"
    threshold = block.get("remote_min_pay")
    if not isinstance(threshold, int) or isinstance(threshold, bool):
        return "rules.remote_min_pay must be an integer"
    return None


def taxonomy(data: dict, *, seed: bool = True) -> dict:
    """The taxonomy and rules to serve: the feed's own blocks when valid, else the seed copy.

    The seed is Tanner's taxonomy. ``seed=False`` (another person's feed) serves no taxonomy or
    rules instead of Tanner's when a block is missing, and says so (``taxonomy_source: "none"``).
    """
    published = data.get("taxonomy")
    problem = taxonomy_block_problem(published)
    rules_block = data.get("rules")
    rules_problem = rules_block_problem(rules_block)
    fallback = "server-seed" if seed else "none"
    out = {
        "taxonomy_source": "feed" if problem is None else fallback,
        "rules_source": "feed" if rules_problem is None else fallback,
        "taxonomy": published if problem is None else (TAXONOMY if seed else None),
        "rules": rules_block if rules_problem is None else (RULES if seed else None),
    }
    if problem:
        out["taxonomy_problem"] = problem
    if rules_problem:
        out["rules_problem"] = rules_problem
    return out


def market_or_derived(data: dict, *, fallback_classify: bool = True, feed: str = "jobs") -> dict:
    published = data.get("market")
    if isinstance(published, dict) and published.get("by_category"):
        return {"market_source": "feed", "market": published}
    listings = data.get("listings") or []
    return {
        "market_source": "derived-from-listings",
        "note": f"{feed}.json has no market block, so this roll-up is computed from its listings by deck-feeds-mcp.",
        "market": {
            "by_category": market(listings, fallback_classify=fallback_classify),
            "listings_total": len(listings),
            "generated_at": data.get("t"),
        },
    }
