"""Census Building Permits Survey by county, trailing 12 months of monthly files. Level "county".

Each monthly file (co{YY}{MM}c.txt, about 0.4 MB, about 3,000 counties) lists permitted buildings, units and value for
1-unit, 2-unit, 3-4 unit and 5+ unit structures (estimates that include imputation for non-reporting permit offices).
The source walks back from the current month to the newest published month, then adds that month and the eleven before it.
A county missing from any of the twelve files is left out rather than summed over fewer months.
"""
import time

from ctx import SourceUnavailable, num

URL = "https://www2.census.gov/econ/bps/County/co%02d%02dc.txt"
MONTHS = 12
MIN_COUNTIES = 1500  # about 3,000 counties per month

SOURCE = {
    "id": "census_bps_county",
    "name": "Census Building Permits Survey by county",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/construction/bps/",
    "level": "county",
    "native": "county",
    "group": "residential",
    "cadence": "monthly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "bps_units_12m": {"label": "Housing units permitted, last 12 months", "unit": "count", "agg": "sum",
                          "xwalk": "sum"},
        "bps_units_1_12m": {"label": "Units in 1-unit buildings permitted, last 12 months", "unit": "count", "agg": "sum",
                            "xwalk": "sum"},
        "bps_units_2_4_12m": {"label": "Units in 2 to 4 unit buildings permitted, last 12 months", "unit": "count",
                              "agg": "sum", "xwalk": "sum"},
        "bps_units_5plus_12m": {"label": "Units in 5+ unit buildings permitted, last 12 months", "unit": "count",
                                "agg": "sum", "xwalk": "sum"},
        "bps_value_12m": {"label": "Value of permitted housing, last 12 months", "unit": "usd", "agg": "sum",
                          "xwalk": "sum"},
    },
}


def parse_month(path):
    """One monthly county file -> ({FIPS: {units_1, units_2_4, units_5plus, value}}, 'YYYY-MM')."""
    out, month = {}, None
    with open(path, encoding="latin-1") as fh:
        for line in fh:
            parts = line.rstrip("\r\n").split(",")
            if len(parts) < 30 or not parts[0].strip().isdigit() or len(parts[0].strip()) != 6:
                continue
            state, county = parts[1].strip(), parts[2].strip()
            if len(state) != 2 or len(county) != 3:
                continue
            # 24 numeric columns end every row (buildings, units, value for 4 size classes, then the same for reported-only);
            # counting from the right keeps a county name that contains a comma from shifting the columns
            nums = [num(p) for p in parts[-24:-12]]
            if any(v is None for v in nums):
                continue
            (_, u1, v1, _, u2, v2, _, u34, v34, _, u5, v5) = nums
            ym = parts[0].strip()
            month = month or "%s-%s" % (ym[:4], ym[4:])
            out[state + county] = {"units_1": int(u1), "units_2_4": int(u2 + u34), "units_5plus": int(u5),
                                   "value": int(v1 + v2 + v34 + v5)}
    if not out:
        raise SourceUnavailable("Building permits file had no county rows")
    return out, month


def _months_back(year, month, n):
    total = year * 12 + month - 1 - n
    return total // 12, total % 12 + 1


def combine(monthly):
    """List of parse_month results (newest first) -> (data, dropped county count)."""
    counties = set(monthly[0])
    for m in monthly[1:]:
        counties &= set(m)
    dropped = len(set().union(*monthly)) - len(counties)
    data = {}
    for fips in counties:
        u1 = sum(m[fips]["units_1"] for m in monthly)
        u24 = sum(m[fips]["units_2_4"] for m in monthly)
        u5 = sum(m[fips]["units_5plus"] for m in monthly)
        data[fips] = {"bps_units_12m": u1 + u24 + u5, "bps_units_1_12m": u1, "bps_units_2_4_12m": u24,
                      "bps_units_5plus_12m": u5, "bps_value_12m": sum(m[fips]["value"] for m in monthly)}
    return data, dropped


def load(ctx):
    now = time.gmtime()
    latest = None
    for back in range(0, 5):  # the newest month usually lands 4 to 7 weeks after it ends
        y, m = _months_back(now.tm_year, now.tm_mon, back)
        try:
            path, _ = ctx.fetch(URL % (y % 100, m), "co%02d%02dc.txt" % (y % 100, m), timeout=60, min_bytes=1000)
        except SourceUnavailable:
            continue
        latest = (y, m, path)
        break
    if latest is None:
        raise SourceUnavailable("no Building Permits county file for the last five months")
    y0, m0, first = latest
    monthly, rows = [], 0
    parsed, first_month = parse_month(first)
    monthly.append(parsed)
    for back in range(1, MONTHS):
        y, m = _months_back(y0, m0, back)
        path, _ = ctx.fetch(URL % (y % 100, m), "co%02d%02dc.txt" % (y % 100, m), timeout=60, min_bytes=1000)
        part, label = parse_month(path)
        if label != "%04d-%02d" % (y, m):
            raise SourceUnavailable("Building permits file for %04d-%02d is dated %s" % (y, m, label))
        monthly.append(part)
    rows = sum(len(p) for p in monthly)
    data, dropped = combine(monthly)
    if len(data) < MIN_COUNTIES:
        raise SourceUnavailable("Building permits parsed to %d counties present in all %d months" % (len(data), MONTHS))
    ys, ms = _months_back(y0, m0, MONTHS - 1)
    note = "Estimates that include imputation for permit offices that did not report."
    if dropped:
        note += " %d counties missing from at least one monthly file are left out." % dropped
    return {"as_of": "%04d-%02d to %s" % (ys, ms, first_month), "rows": rows, "data": data, "note": note}
