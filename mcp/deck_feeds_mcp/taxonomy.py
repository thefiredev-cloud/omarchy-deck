"""The agreed job taxonomy, metro tiers and the collector's classifier rules.

The data in ``taxonomy_contract.json`` is generated from the Jobs collector's canonical
``~/ops/bin/deck_jobs_taxonomy.py``. Keeping it as checked-in data (rather than a second
hand-written taxonomy) is what stops this server's seed from disagreeing with the feed it
reads: the same category slugs, the same sub-category slugs, the same metro city lists and
the same keyword rules the collector scores with.

``tests/test_deck_feeds_mcp.py`` compares this contract against the live ``jobs.json``
taxonomy block when the live feed is present, so any future drift fails a test instead of
silently mis-filtering.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

CONTRACT_PATH = Path(__file__).with_name("taxonomy_contract.json")

METRO_KEYS = ("south_oc", "oc", "la", "sd")


class ContractError(ValueError):
    """The taxonomy contract file itself is malformed. Never silently ignored."""


def _fail(message: str) -> None:
    raise ContractError(f"taxonomy_contract.json: {message}")


@lru_cache(maxsize=1)
def load() -> dict[str, Any]:
    """Load, validate and compile the contract once per process."""
    try:
        doc = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    except OSError as exc:
        _fail(f"unreadable ({exc})")
    except ValueError as exc:
        _fail(f"bad JSON ({exc})")
    if not isinstance(doc, dict):
        _fail("top level must be an object")

    taxonomy = doc.get("taxonomy")
    if not isinstance(taxonomy, list) or not taxonomy:
        _fail("taxonomy must be a non-empty list")
    subs: dict[str, list[str]] = {}
    for row in taxonomy:
        if not isinstance(row, dict) or not row.get("slug") or not row.get("name"):
            _fail("every category needs slug and name")
        if not isinstance(row.get("definition"), str) or not row["definition"]:
            _fail(f"category {row['slug']} has no definition")
        if not isinstance(row.get("subs"), list) or not row["subs"]:
            _fail(f"category {row['slug']} has no subcategories")
        for sub in row["subs"]:
            if not isinstance(sub, dict) or not sub.get("slug") or not sub.get("name"):
                _fail(f"category {row['slug']} has a subcategory without slug and name")
            if not isinstance(sub.get("definition"), str) or not sub["definition"]:
                _fail(f"subcategory {sub['slug']} has no definition")
        subs[row["slug"]] = [sub["slug"] for sub in row["subs"]]

    metros = doc.get("metros")
    if not isinstance(metros, dict):
        _fail("metros must be an object")
    for key in METRO_KEYS:
        cities = metros.get(key)
        if not isinstance(cities, list) or not cities or not all(isinstance(c, str) for c in cities):
            _fail(f"metro {key} needs a non-empty list of city strings")

    rules = doc.get("rules")
    if not isinstance(rules, dict) or not isinstance(rules.get("in_person_metros"), list):
        _fail("rules.in_person_metros is required")
    if not isinstance(rules.get("remote_min_pay"), int) or isinstance(rules["remote_min_pay"], bool):
        _fail("rules.remote_min_pay must be an integer")

    default_sub = doc.get("default_sub") or {}
    for slug, subcategories in subs.items():
        if default_sub.get(slug) not in subcategories:
            _fail(f"default_sub[{slug}] must be one of its subcategories")

    title_drop = doc.get("title_drop")
    if not isinstance(title_drop, str) or not title_drop:
        _fail("title_drop pattern is required")

    keyword_rules = doc.get("keyword_rules")
    if not isinstance(keyword_rules, list) or not keyword_rules:
        _fail("keyword_rules must be a non-empty list")
    compiled: list[tuple[str, str, int, re.Pattern[str]]] = []
    for row in keyword_rules:
        if not isinstance(row, dict):
            _fail("keyword rule must be an object")
        category, sub = row.get("category"), row.get("subcategory")
        if category not in subs or sub not in subs[category]:
            _fail(f"keyword rule points at unknown subcategory {category}/{sub}")
        if not isinstance(row.get("weight"), int):
            _fail(f"keyword rule {category}/{sub} needs an integer weight")
        try:
            pattern = re.compile(row["pattern"])
        except (KeyError, re.error) as exc:
            _fail(f"keyword rule {category}/{sub} has a bad pattern ({exc})")
        compiled.append((category, sub, int(row["weight"]), pattern))

    compiled_remote: dict[str, re.Pattern[str]] = {}
    for key in ("remote_foreign_pattern", "remote_us_ok_pattern"):
        value = doc.get(key)
        if not isinstance(value, str) or not value:
            _fail(f"{key} is required")
        try:
            compiled_remote[key] = re.compile(value, re.IGNORECASE)
        except re.error as exc:
            _fail(f"{key} has a bad pattern ({exc})")

    context_rules = doc.get("context_rules") or []
    context: list[tuple[str, int, re.Pattern[str]]] = []
    for row in context_rules:
        if not isinstance(row, dict):
            _fail("context rule must be an object")
        if row.get("category") not in subs:
            _fail(f"context rule points at unknown category {row.get('category')}")
        try:
            context.append((row["category"], int(row.get("weight") or 0), re.compile(row["pattern"])))
        except (KeyError, re.error) as exc:
            _fail(f"context rule {row.get('category')} has a bad pattern ({exc})")

    return {
        "taxonomy": taxonomy,
        "subs": subs,
        "metros": {key: tuple(metros[key]) for key in METRO_KEYS},
        "rules": rules,
        "default_sub": default_sub,
        "title_drop": re.compile(title_drop),
        "keyword_rules": compiled,
        "context_rules": context,
        "remote_foreign": compiled_remote["remote_foreign_pattern"],
        "remote_us_ok": compiled_remote["remote_us_ok_pattern"],
    }


def taxonomy() -> list[dict[str, Any]]:
    return load()["taxonomy"]


def subs() -> dict[str, list[str]]:
    return load()["subs"]


def metros() -> dict[str, tuple[str, ...]]:
    return load()["metros"]


def rules() -> dict[str, Any]:
    return load()["rules"]


def default_sub() -> dict[str, str]:
    return load()["default_sub"]


def title_drop() -> re.Pattern[str]:
    return load()["title_drop"]


def keyword_rules() -> list[tuple[str, str, int, re.Pattern[str]]]:
    return load()["keyword_rules"]


def context_rules() -> list[tuple[str, int, re.Pattern[str]]]:
    return load()["context_rules"]


def remote_foreign() -> re.Pattern[str]:
    return load()["remote_foreign"]


def remote_us_ok() -> re.Pattern[str]:
    return load()["remote_us_ok"]
