"""Shared SM flat-file reader for state and metro CES sources.

The AllData file is streamed once per source, with only the last 72 months of
selected employment series retained. Both sources share a conditional cache.
"""
import csv
import os
import time
from collections import Counter
from contextlib import contextmanager

from ctx import Ctx, SourceUnavailable, num

BASE = "https://download.bls.gov/pub/time.series/sm/"
BLS_UA = {"User-Agent": "pixel-deck-feed (read-only; tanner@meshvault.ai)"}
# FIPS state codes, excluding territories. DC is included.
STATES = dict(zip(
    "01 02 04 05 06 08 09 10 11 12 13 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 44 45 46 47 48 49 50 51 53 54 55 56".split(),
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(),
))
NONFARM = "00000000"
CONSTRUCTION = "20000000"
MANUFACTURING = "30000000"
TTU = "40000000"
WHOLESALE = "41000000"
RETAIL = "42000000"
TRANSPORT = "43400089"
OFFICE = ("50000000", "55000000", "60000000")
INDUSTRIES = {NONFARM, CONSTRUCTION, MANUFACTURING, TTU, WHOLESALE, RETAIL, TRANSPORT, *OFFICE}


def fields(prefix):
    """Field declarations shared by both published geographies."""
    out = {}
    for suffix, label in (("nonfarm", "Nonfarm jobs"), ("retail_emp", "Retail jobs"),
                          ("office_emp", "Office-sector jobs"), ("industrial_emp", "Industrial-sector jobs")):
        out[prefix + suffix] = {"label": label, "unit": "count", "agg": "none"}
        out[prefix + suffix + "_yoy"] = {"label": label + ", 1-year change", "unit": "pct", "agg": "none"}
    out[prefix + "construction_emp_yoy"] = {"label": "Construction jobs, 1-year change", "unit": "pct", "agg": "none"}
    return out


@contextmanager
def table(path, required):
    """Read padded tab-separated BLS files without loading the whole file."""
    with open(path, encoding="utf-8-sig", newline="") as fh:
        reader = csv.reader(fh, delimiter="\t")
        header = next(reader, [])
        header = [v.strip() for v in header]
        if not set(required).issubset(header):
            raise SourceUnavailable("CES %s is missing required columns" % os.path.basename(path))
        indexes = [header.index(k) for k in required]
        yield ([row[i].strip() for i in indexes] for row in reader if len(row) > max(indexes))


def month(year, period):
    if len(period) != 3 or period[:1] != "M" or not period[1:].isdigit():
        return None
    m = int(period[1:])
    return int(year) * 12 + m - 1 if year.isdigit() and 1 <= m <= 12 else None


def period(value):
    year, m = divmod(value, 12)
    return "%04d-%02d" % (year, m + 1)


def geography(paths, level):
    """Return publisher metro codes only; never relabel divisions as CBSAs."""
    areas, skipped = {}, Counter()
    with table(paths["sm.area"], ("area_code", "area_name")) as rows:
        for code, name in rows:
            if len(code) != 5 or not code.isdigit() or code in ("00000", "99999"):
                continue
            if int(code) >= 70000:
                skipped["NECTAs or special areas without a verified CBSA crosswalk"] += 1
            elif "Metropolitan Division" in name or not code.endswith("0"):
                skipped["metro divisions"] += 1
            else:
                areas[code] = name
    if level == "cbsa" and not areas:
        raise SourceUnavailable("CES area file contains no CBSA metro codes")
    return areas, skipped


def parse(paths, level, prefix, minimum):
    """Return data, rows read, period, history and caveats from local SM files."""
    areas, skipped = geography(paths, level)
    selected, ends = {}, []
    columns = ("series_id", "state_code", "area_code", "industry_code", "data_type_code", "seasonal", "end_year", "end_period")
    with table(paths["sm.series"], columns) as rows:
        for sid, state, area, industry, dtype, seasonal, year, end in rows:
            if state not in STATES or industry not in INDUSTRIES or dtype != "01" or seasonal not in ("S", "U"):
                continue
            if level == "state":
                geo = STATES[state] if area == "00000" else None
            else:
                geo = area if area in areas else None
            if geo is None:
                continue
            selected[sid] = (geo, industry, seasonal)
            if industry == NONFARM:
                last = month(year, end)
                if last is not None:
                    ends.append(last)
    if not ends:
        raise SourceUnavailable("CES series file contains no selected nonfarm employment")
    newest = max(ends)
    cutoff = newest - 71
    values, read = {}, 0
    files = paths["data"]
    if isinstance(files, (str, os.PathLike)):
        files = [files]
    for path in dict.fromkeys(files):
        with table(path, ("series_id", "year", "period", "value")) as rows:
            for sid, year, p, raw in rows:
                read += 1
                key = selected.get(sid)
                if key is None:
                    continue
                m = month(year, p)
                if m is None or not cutoff <= m <= newest:
                    continue
                value = num(raw)
                if value is not None and value >= 0:
                    values.setdefault(key, {})[m] = int(round(value * 1000))
    geos = {geo for geo, industry, seasonal in values if industry == NONFARM}
    if len(geos) < minimum:
        raise SourceUnavailable("CES holds %d %s areas with nonfarm jobs; expected at least %d" % (len(geos), level, minimum))
    counts = Counter()
    for geo in geos:
        months = set()
        for seasonal in ("S", "U"):
            months.update(values.get((geo, NONFARM, seasonal), {}))
        counts.update(months)
    latest = max((m for m, n in counts.items() if n >= max(minimum, len(geos) * 0.8)), default=None)
    if latest is None:
        raise SourceUnavailable("no CES month is reported by enough selected areas")

    def chosen(geo, industry):
        # Use the same adjustment for current and prior-year values and history.
        for seasonal in ("S", "U"):
            series = values.get((geo, industry, seasonal), {})
            if latest in series:
                return series
        return {}

    def total(parts, m):
        cells = [series.get(m) for series, sign in parts]
        if any(v is None for v in cells):
            return None
        return sum(v * sign for v, (_, sign) in zip(cells, parts))

    data, hist, proxies = {}, {}, 0
    published = {(geo, industry) for geo, industry, seasonal in selected.values()}
    for geo in sorted(geos):
        nonfarm = chosen(geo, NONFARM)
        if latest not in nonfarm:
            continue
        industry = [(chosen(geo, code), 1) for code in (MANUFACTURING, TRANSPORT, WHOLESALE)]
        if (geo, TRANSPORT) not in published:
            # TTU minus retail already contains wholesale; do not add it twice.
            industry = [(chosen(geo, MANUFACTURING), 1), (chosen(geo, TTU), 1), (chosen(geo, RETAIL), -1)]
            proxies += 1
        groups = {
            "nonfarm": [(nonfarm, 1)],
            "retail_emp": [(chosen(geo, RETAIL), 1)],
            "office_emp": [(chosen(geo, code), 1) for code in OFFICE],
            "industrial_emp": industry,
            "construction_emp": [(chosen(geo, CONSTRUCTION), 1)],
        }
        out = {}
        for suffix, parts in groups.items():
            now, before = total(parts, latest), total(parts, latest - 12)
            if suffix != "construction_emp":
                out[prefix + suffix] = now
            out[prefix + suffix + "_yoy"] = round((now / before - 1) * 100, 4) if now is not None and before else None
        data[geo] = out
        hist[geo] = {prefix + "nonfarm": [[period(m), v] for m, v in sorted(nonfarm.items()) if latest - 71 <= m <= latest]}
    if len(data) < minimum:
        raise SourceUnavailable("CES latest month has only %d %s areas" % (len(data), level))
    notes = ["BLS CES all employees, thousands converted to persons; seasonally adjusted where the latest value is available, otherwise unadjusted; each component keeps the same adjustment for annual change.",
             "Office jobs sum information, financial activities, and professional and business services; sums and annual changes require every component."]
    if proxies:
        notes.append("Industrial jobs use manufacturing plus trade, transportation and utilities minus retail in %d areas without a published transportation and warehousing series; this proxy includes utilities." % proxies)
    if level == "cbsa":
        notes.extend("Skipped %d %s." % (n, kind) for kind, n in sorted(skipped.items()))
    return data, read, period(latest), hist, " ".join(notes)


def load(ctx, level, prefix, minimum):
    """Fetch one shared AllData file, not overlapping state and sector files."""
    shared = Ctx("bls_ces_sm", force=ctx.force, cache_root=os.path.dirname(ctx.cache_dir), quiet=ctx.quiet)
    paths = {}
    requests = shared.requests
    try:
        for name in ("sm.area", "sm.series", "sm.data.1.AllData"):
            time.sleep(1)  # BLS polite rate, including cold-cache requests.
            path, _ = shared.fetch(BASE + name, name, headers=BLS_UA, timeout=900)
            paths["data" if name.startswith("sm.data.") else name] = path
    finally:
        ctx.requests += shared.requests - requests
    data, rows, as_of, hist, note = parse(paths, level, prefix, minimum)
    return {"data": data, "rows": rows, "as_of": as_of, "hist": hist, "note": note}
