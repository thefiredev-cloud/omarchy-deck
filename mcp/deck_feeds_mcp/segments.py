"""Segment tables over the national dataset v2 manifest (house-feeds/national-v2/manifest.json).

Owner order 2026-11-17: compare states and metros by property segment (residential, multifamily, retail, office,
industrial, people and jobs). The spec is pixel-deck ``scripts/national/segments.json``: per segment a label, a lead
field and field ids, best first. This module reads the spec from, in order, ``manifest["segments"]`` (the build copies it
there), the file named by ``DECK_SEGMENTS_FILE``, or the copy that ships beside this module (``segments.json``, refresh it
with ``cp ~/projects/pixel-deck/scripts/national/segments.json deck_feeds_mcp/``).

A field the build does not produce, or that has no value for this geography, is listed under ``unavailable`` and never
shown as zero. Labels, units, publisher and period come from the manifest field catalog.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

SEGMENTS_FILE = Path(os.environ.get("DECK_SEGMENTS_FILE") or Path(__file__).with_name("segments.json"))
LEVELS = ("state", "metro", "us")
US_WORDS = frozenset({"us", "usa", "u.s.", "united states", "national", "nation"})


def _spec(manifest: dict) -> tuple[list[dict], str]:
    """(segment list, where it came from), or ([], reason) when no valid spec is readable."""
    block = manifest.get("segments")
    if isinstance(block, dict):
        block = block.get("segments")
    if isinstance(block, list) and block:
        return [s for s in block if isinstance(s, dict)], "manifest"
    try:
        document = json.loads(SEGMENTS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError) as failure:
        return [], f"{SEGMENTS_FILE}: {type(failure).__name__}"
    listed = document.get("segments") if isinstance(document, dict) else None
    if not isinstance(listed, list) or not listed:
        return [], f"{SEGMENTS_FILE}: no segments list"
    return [s for s in listed if isinstance(s, dict)], str(SEGMENTS_FILE)


def _rows(manifest: dict, level: str) -> list[dict]:
    if level == "us":
        row = manifest.get("us")
        return [dict(row, name="United States")] if isinstance(row, dict) else []
    key = "states" if level == "state" else "metros"
    return [r for r in (manifest.get(key) or []) if isinstance(r, dict)]


def _code(row: dict, level: str) -> str:
    return "US" if level == "us" else str(row.get("state" if level == "state" else "cbsa") or "")


def find_row(manifest: dict, geo: str, level: str = "") -> tuple[dict | None, str, dict | None]:
    """(row, level, problem). geo is a USPS state code, a 5-digit CBSA code, ``US``, or part of a state or metro name."""
    needle = (geo or "").strip()
    picked = (level or "").strip().lower()
    if picked and picked not in LEVELS:
        return None, "", {"error": f"unknown level {level!r}", "allowed": list(LEVELS)}
    if not needle:
        return None, "", {"error": "geo is empty: give a state code (CA), a CBSA code (31080), US, or a name"}
    levels = [picked] if picked else list(LEVELS)
    lowered = needle.lower()
    if "us" in levels and lowered in US_WORDS:
        rows = _rows(manifest, "us")
        return (rows[0], "us", None) if rows else (None, "", {"error": "the manifest has no national row"})
    for lv in levels:
        if lv == "us":
            continue
        for row in _rows(manifest, lv):
            if _code(row, lv).lower() == lowered:
                return row, lv, None
    exact, partial = [], []
    for lv in levels:
        if lv == "us":
            continue
        for row in _rows(manifest, lv):
            name = str(row.get("name") or "").lower()
            if name == lowered:
                exact.append((row, lv))
            elif lowered in name:
                partial.append((row, lv))
    found = exact or partial
    if len(found) == 1:
        return found[0][0], found[0][1], None
    if not found:
        return None, "", {"error": f"no state or metro matches {geo!r}"}
    return None, "", {
        "error": f"{geo!r} matches {len(found)} geographies; repeat with a code, an exact name or a level",
        "candidates": [{"level": lv, "code": _code(row, lv), "name": row.get("name")} for row, lv in found[:12]],
    }


def _value(row: dict, field: str):
    value = row.get(field)
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, float) and value != value:  # NaN is a missing value, not a number
        return None
    return value


def build(manifest: dict, geo: str, segment: str = "", level: str = "") -> dict:
    """The segment fields of one state, metro or the US row. ``{"ok": False, "error": ...}`` when it cannot answer."""
    row, found_level, problem = find_row(manifest, geo, level)
    if problem:
        return {"ok": False, **problem}
    segments, spec_from = _spec(manifest)
    if not segments:
        return {"ok": False, "error": f"no segment spec: {spec_from}"}
    ids = [str(s.get("id")) for s in segments]
    wanted = (segment or "").strip().lower()
    if wanted:
        picked = [s for s in segments if wanted in (str(s.get("id")).lower(), str(s.get("label") or "").lower())]
        if not picked:
            return {"ok": False, "error": f"unknown segment {segment!r}", "allowed": ids}
    else:
        picked = segments
    catalog = manifest.get("fields") if isinstance(manifest.get("fields"), dict) else {}
    out = []
    for spec in picked:
        shown, unavailable = [], []
        for field in spec.get("fields") or []:
            value = _value(row, field)
            if value is None:
                unavailable.append(field)
                continue
            meta = catalog.get(field) if isinstance(catalog.get(field), dict) else {}
            entry = {"field": field, "label": meta.get("label"), "unit": meta.get("unit"), "value": value}
            sources = [s for s in (meta.get("sources") or []) if isinstance(s, dict)]
            if sources:
                entry["sources"] = [{"id": s.get("id"), "as_of": s.get("as_of")} for s in sources]
            shown.append(entry)
        out.append({
            "id": spec.get("id"),
            "label": spec.get("label"),
            "lead": spec.get("lead"),
            "lead_value": _value(row, str(spec.get("lead"))),
            "fields": shown,
            "unavailable": unavailable,
        })
    return {
        "ok": True,
        "level": found_level,
        "code": _code(row, found_level),
        "name": row.get("name"),
        "zips": row.get("zips"),
        "segments": out,
        "spec_from": spec_from,
        "manifest_schema": manifest.get("schema"),
    }
