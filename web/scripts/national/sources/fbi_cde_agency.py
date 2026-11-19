"""FBI Crime Data Explorer: violent and property crime rate per agency, assigned to ZIPs by distance (needs DATA_GOV_API_KEY).

The api.data.gov limit is about 1,000 calls an hour and there are about 18,000 agencies with two calls each, so a run makes at
most MAX_CALLS network calls (city and county agencies first), keeps every answer for a year, and builds the dataset from
everything cached so far. Coverage therefore grows run by run. The key travels in the X-Api-Key header, never in a URL.
A ZIP takes the rate of the nearest reporting agency within MAX_KM of its centre: a proxy, since crime is reported by
agency and not by ZIP.
"""
import json
import math
import os
import time

from ctx import SourceUnavailable

SOURCE = {
    "id": "fbi_cde_agency",
    "name": "FBI Crime Data Explorer: crime rates by reporting agency",
    "publisher": "FBI Criminal Justice Information Services (api.usa.gov)",
    "homepage": "https://cde.ucr.cjis.gov/",
    "level": "zip",
    "native": "point",
    "group": "risk",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": "DATA_GOV_API_KEY",
    "fields": {
        "fbi_violent_rate": {"label": "Violent crimes per 100,000 (nearest agency)", "unit": "per_100k",
                             "agg": "pop_weighted_mean", "metric": "safety", "better": "lower"},
        "fbi_property_rate": {"label": "Property crimes per 100,000 (nearest agency)", "unit": "per_100k",
                              "agg": "pop_weighted_mean", "metric": "safety", "better": "lower"},
    },
}
ENV = "DATA_GOV_API_KEY"
API = "https://api.usa.gov/crime/fbi/cde/"
STATES = ("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK "
          "OR PA RI SC SD TN TX UT VT VA WA WV WI WY").split()
KINDS = (("violent-crime", "fbi_violent_rate"), ("property-crime", "fbi_property_rate"))
MAX_CALLS = 600          # network calls per run (about 10 minutes at one a second, under the hourly limit)
PAUSE_S = 1.0
DEADLINE_S = 780
MAX_KM = 15.0
KEEP_AGE = 365 * 86400
LIST_AGE = 90 * 86400
SKIP_AGE = 90 * 86400
PRIORITY = {"City": 0, "County": 1}


def agencies(body):
    """Flatten the byStateAbbr answer ({county: [agency, ...]}) to a list of agency dicts that have a point."""
    out = []
    for group in (body or {}).values():
        for agency in group or []:
            if agency.get("ori") and agency.get("agency_name") and agency.get("latitude") is not None \
                    and agency.get("longitude") is not None:
                out.append(agency)
    return out


def annual_rate(body, agency_name, year):
    """Offenses per 100,000 for one agency and year: the twelve monthly rates added up, or None unless all twelve exist."""
    series = ((body or {}).get("offenses") or {}).get("rates", {}).get(agency_name + " Offenses") or {}
    months = ["%02d-%d" % (m, year) for m in range(1, 13)]
    if any(m not in series or series[m] is None for m in months):
        return None
    return round(sum(float(series[m]) for m in months), 1)


def assign(zip_points, rated, max_km=MAX_KM):
    """{zip: {field: rate}} from {ori: {"lat", "lon", field: rate}}: each ZIP takes the nearest agency that has the field."""
    out = {}
    for field in ("fbi_violent_rate", "fbi_property_rate"):
        grid = {}
        for rec in rated.values():
            if rec.get(field) is not None:
                grid.setdefault((int(math.floor(rec["lat"] * 2)), int(math.floor(rec["lon"] * 2))), []).append(rec)
        for zip5, (lat, lon) in zip_points.items():
            gi, gj = int(math.floor(lat * 2)), int(math.floor(lon * 2))
            coslat, best, best_d = math.cos(math.radians(lat)), None, max_km
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    for rec in grid.get((gi + di, gj + dj), ()):
                        d = 111.2 * math.hypot(rec["lat"] - lat, (rec["lon"] - lon) * coslat)
                        if d < best_d:
                            best, best_d = rec, d
            if best is not None:
                out.setdefault(zip5, {"fbi_violent_rate": None, "fbi_property_rate": None})[field] = best[field]
    return out


def _load_json(path):
    with open(path, encoding="utf8") as fh:
        try:
            return json.load(fh)
        except ValueError:
            return None


def load(ctx):
    key = ctx.need_key(ENV)
    headers = {"X-Api-Key": key}
    year = ctx.year - 2  # the FBI publishes a year and a half late
    t0, calls = time.time(), 0
    skip_path = os.path.join(ctx.cache_dir, "skip.json")
    skip = _load_json(skip_path) if os.path.exists(skip_path) else {}
    skip = {k: ts for k, ts in (skip or {}).items() if time.time() - ts < SKIP_AGE}
    roster = []
    for state in STATES:
        path, meta = ctx.fetch(API + "agency/byStateAbbr/" + state, "agencies_%s.json" % state, min_age=LIST_AGE,
                               timeout=60, min_bytes=20, headers=headers)
        if meta.get("status") == "fetched":
            calls += 1
            time.sleep(PAUSE_S)
        roster += agencies(_load_json(path))
    roster.sort(key=lambda a: (PRIORITY.get(a.get("agency_type_name"), 2), a["state_abbr"], a["ori"]))
    stop = None
    for agency in roster:
        for kind, _ in KINDS:
            name = "%s_%s_%d.json" % (agency["ori"], kind.split("-")[0], year)
            if name in skip or stop:
                continue
            if calls >= MAX_CALLS or time.time() - t0 > DEADLINE_S:
                stop = "call budget used"
                continue
            url = "%ssummarized/agency/%s/%s?from=01-%d&to=12-%d" % (API, agency["ori"], kind, year, year)
            try:
                _, meta = ctx.fetch(url, name, min_age=KEEP_AGE, timeout=60, min_bytes=20, headers=headers)
            except SourceUnavailable as exc:
                text = str(exc)
                if "429" in text:
                    stop = "api.data.gov rate limit reached"
                elif "401" in text or "403" in text:
                    raise SourceUnavailable("api.data.gov rejected the %s key" % ENV)
                else:
                    skip[name] = time.time()  # no data for this agency or year: do not ask again for 90 days
                continue
            if meta.get("status") == "fetched":
                calls += 1
                time.sleep(PAUSE_S)
    with open(skip_path, "w", encoding="utf8") as fh:
        json.dump(skip, fh)
    rated = {}
    for agency in roster:
        rec = {"lat": float(agency["latitude"]), "lon": float(agency["longitude"])}
        for kind, field in KINDS:
            path = os.path.join(ctx.cache_dir, "%s_%s_%d.json" % (agency["ori"], kind.split("-")[0], year))
            if os.path.exists(path):
                rec[field] = annual_rate(_load_json(path), agency["agency_name"], year)
        if rec.get("fbi_violent_rate") is not None or rec.get("fbi_property_rate") is not None:
            rated[agency["ori"]] = rec
    if not rated:
        raise SourceUnavailable("no agency crime rates cached yet (%d calls this run); the next runs add more" % calls)
    data = assign(ctx.zip_points(), rated)
    return {"as_of": str(year), "rows": len(rated), "data": data,
            "note": "%d of %d agencies loaded so far (%s); a ZIP takes the rate of the nearest agency within %d km." % (
                len(rated), len(roster), stop or "all reachable agencies read", int(MAX_KM))}
