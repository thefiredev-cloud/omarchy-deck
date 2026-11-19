"""Shared helpers for the federal ArcGIS layer sources (GSA leases, HUD LIHTC, HUD insured and assisted multifamily).
Not a source: the leading underscore tells the runner to skip it (SPEC rule 12)."""
import datetime
import json
import re

from ctx import SourceUnavailable, zfill_zip

MONTHS = {m: i for i, m in enumerate(("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"), 1)}


def parse_day(value):
    """ArcGIS epoch milliseconds, '31-MAY-41', '2026-11-12' or '11/30/2030' -> datetime.date, else None."""
    if value in (None, ""):
        return None
    try:
        if isinstance(value, (int, float)):
            return datetime.datetime.fromtimestamp(value / 1000.0, datetime.timezone.utc).date()
        text = str(value).strip()
        match = re.fullmatch(r"(\d{1,2})-([A-Za-z]{3})-(\d{2,4})", text)
        if match:
            year = int(match.group(3))
            year += 2000 if year < 100 else 0  # HUD writes two-digit years, all in this century
            return datetime.date(year, MONTHS[match.group(2).upper()], int(match.group(1)))
        match = re.fullmatch(r"(\d{4})-(\d\d)-(\d\d)", text[:10])
        if match:
            return datetime.date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
        match = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", text)
        if match:
            return datetime.date(int(match.group(3)), int(match.group(1)), int(match.group(2)))
    except (ValueError, KeyError, OverflowError, OSError):
        return None
    return None


def add_years(day, years):
    try:
        return day.replace(year=day.year + years)
    except ValueError:  # Feb 29
        return day.replace(year=day.year + years, day=28)


def zip_of(row, zip_fields, locate=None, lat="LAT", lon="LON"):
    """The record's own ZIP (first usable of zip_fields), else the nearest ZIP centroid to its point. -> (zip or None, how)."""
    for field in zip_fields:
        z = zfill_zip(row.get(field))
        if z and z != "00000":
            return z, "zip"
    if locate and row.get(lat) not in (None, 0) and row.get(lon) not in (None, 0):
        z = locate(row.get(lat), row.get(lon))
        if z:
            return z, "point"
    return None, None


def read_features(path):
    """A saved ArcGIS query response (JSON with features[].attributes) -> list of attribute dicts."""
    with open(path, encoding="utf8") as fh:
        try:
            body = json.load(fh)
        except ValueError as exc:
            raise SourceUnavailable("not an ArcGIS response (%s)" % str(exc)[:60])
    if body.get("error"):
        raise SourceUnavailable("ArcGIS error %s" % str(body["error"])[:80])
    feats = body.get("features")
    if feats is None:
        raise SourceUnavailable("ArcGIS response has no features")
    return [f.get("attributes") or {} for f in feats]


def layer_as_of(ctx, layer_url, fallback=None):
    """Date the publisher last edited the layer (ISO), else `fallback`."""
    try:
        info = ctx.get_json(layer_url.rstrip("/") + "?f=json", "layer_info.json", timeout=60)
    except SourceUnavailable:
        return fallback
    day = parse_day(((info.get("editingInfo") or {}).get("lastEditDate")))
    return day.isoformat() if day else fallback
