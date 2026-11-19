"""Zillow Home Value Forecast (ZHVF) by ZIP: forecast change in the typical home value at 1, 3 and 12 months. Level "zip".

One small CSV (about 21,000 ZIPs). The columns after BaseDate are forecast months; their distance from BaseDate must be
1, 3 and 12 months or the file is refused (Zillow has changed horizons before).
"""
import csv
import re

from ctx import SourceUnavailable, num, zfill_zip

URL = "https://files.zillowstatic.com/research/public_csvs/zhvf_growth/Zip_zhvf_growth_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"
MIN_ZIPS = 10000
HORIZONS = {1: "zillow_zhvf_1m", 3: "zillow_zhvf_3m", 12: "zillow_zhvf_12m"}
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

SOURCE = {
    "id": "zillow_zhvf",
    "name": "Zillow Home Value Forecast by ZIP",
    "publisher": "Zillow Research",
    "homepage": "https://www.zillow.com/research/data/",
    "level": "zip",
    "group": "residential",
    "cadence": "monthly",
    "license": "Zillow Research data: free to use with attribution to Zillow Research",
    "key_env": None,
    "fields": {
        "zillow_zhvf_1m": {"label": "Forecast home value change, 1 month", "unit": "pct", "agg": "pop_weighted_mean"},
        "zillow_zhvf_3m": {"label": "Forecast home value change, 3 months", "unit": "pct", "agg": "pop_weighted_mean"},
        "zillow_zhvf_12m": {"label": "Forecast home value change, 12 months", "unit": "pct", "agg": "pop_weighted_mean"},
    },
}


def _months(a, b):
    """Whole months from date text a to date text b (YYYY-MM-DD)."""
    return (int(b[:4]) - int(a[:4])) * 12 + int(b[5:7]) - int(a[5:7])


def parse(path):
    """-> (data, rows, base month YYYY-MM). Values are percent changes from the base month, as Zillow publishes them."""
    data, rows = {}, 0
    with open(path, newline="", encoding="utf8") as fh:
        reader = csv.reader(fh)
        try:
            head = next(reader)
        except StopIteration:
            raise SourceUnavailable("Zillow forecast file is empty")
        if "RegionName" not in head or "BaseDate" not in head:
            raise SourceUnavailable("Zillow forecast header changed: RegionName or BaseDate missing")
        i_name, i_base = head.index("RegionName"), head.index("BaseDate")
        i_type = head.index("RegionType") if "RegionType" in head else None
        horizon_cols = [(i, h) for i, h in enumerate(head) if DATE.match(h)]
        base = ""
        pending = []
        for row in reader:
            if len(row) < len(head):
                continue
            rows += 1
            if i_type is not None and row[i_type].lower() != "zip":
                continue
            zip5 = zfill_zip(row[i_name])
            if not zip5 or not DATE.match(row[i_base]):
                continue
            pending.append((zip5, row))
            base = max(base, row[i_base])
    if not base:
        raise SourceUnavailable("Zillow forecast file has no BaseDate")
    fields = {}
    for i, label in horizon_cols:
        gap = _months(base, label)
        if gap in HORIZONS:
            fields[i] = HORIZONS[gap]
    if set(fields.values()) != set(HORIZONS.values()):
        raise SourceUnavailable("Zillow forecast horizons are not 1, 3 and 12 months after %s" % base[:7])
    for zip5, row in pending:
        if row[i_base] != base:
            continue  # a stale base month would mislabel the horizon
        vals = {f: num(row[i]) for i, f in fields.items()}
        vals = {f: round(v, 2) for f, v in vals.items() if v is not None}
        if vals:
            data[zip5] = vals
    if len(data) < MIN_ZIPS:
        raise SourceUnavailable("Zillow forecast parsed to %d ZIPs (expected about 21,000)" % len(data))
    return data, rows, base[:7]


def load(ctx):
    path, meta = ctx.fetch(URL, "zhvf.csv", timeout=120, min_bytes=1000)
    ctx.log("forecast file %s" % meta.get("status"))
    data, rows, base = parse(path)
    return {"as_of": base, "rows": rows, "data": data,
            "note": "Percent change in the typical home value from the base month to 1, 3 and 12 months later."}
