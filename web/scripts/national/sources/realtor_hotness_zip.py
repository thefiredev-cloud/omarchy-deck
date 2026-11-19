"""Realtor.com Market Hotness by ZIP, monthly history since 2017-08. Level "zip".

One 377 MB CSV with a row per ZIP per month in no particular order (about 1.4 million rows, 14,000 to 14,500 ZIPs per month).
Keeps the newest month per ZIP and up to 60 monthly points of the hotness score. The "current month only" file
(RDC_Inventory_Hotness_Metrics_Zip.csv) answers 403 to scripts; the history file does not.
"""
import csv
import time

from ctx import SourceUnavailable, num, zfill_zip

URL = "https://econdata.s3-us-west-2.amazonaws.com/Reports/Hotness/RDC_Inventory_Hotness_Metrics_Zip_History.csv"
HIST_MONTHS = 60
MIN_ZIPS = 5000  # about 14,400 ZIPs in the newest month

SOURCE = {
    "id": "realtor_hotness_zip",
    "name": "Realtor.com Market Hotness by ZIP",
    "publisher": "Realtor.com Economic Research",
    "homepage": "https://www.realtor.com/research/data/",
    "level": "zip",
    "native": "zip",
    "group": "residential",
    "cadence": "monthly",
    "license": "Realtor.com research data: free to use with attribution to Realtor.com Economic Research",
    "key_env": None,
    "fields": {
        "rdc_hotness": {"label": "Market hotness score", "unit": "score", "agg": "pop_weighted_mean",
                        "metric": "market_heat", "better": "higher"},
        "rdc_hotness_rank": {"label": "Market hotness rank in the US", "unit": "count", "agg": "none", "better": "lower"},
        "rdc_supply_score": {"label": "Supply score", "unit": "score", "agg": "pop_weighted_mean"},
        "rdc_demand_score": {"label": "Demand score", "unit": "score", "agg": "pop_weighted_mean", "better": "higher"},
        "rdc_views_vs_us": {"label": "Listing page views versus US", "unit": "ratio", "agg": "pop_weighted_mean"},
        "rdc_dom": {"label": "Median days listed", "unit": "days", "agg": "pop_weighted_median", "better": "lower"},
        "rdc_dom_vs_us": {"label": "Days listed compared with the US median", "unit": "days", "agg": "pop_weighted_mean"},
        "rdc_low_quality": {"label": "Realtor.com flags this ZIP's data as thin", "unit": "flag", "agg": "none"},
    },
}

# field -> (column, decimals or None for whole numbers)
COLUMNS = {
    "rdc_hotness": ("hotness_score", 1),
    "rdc_hotness_rank": ("hotness_rank", None),
    "rdc_supply_score": ("supply_score", 1),
    "rdc_demand_score": ("demand_score", 1),
    "rdc_views_vs_us": ("page_view_count_per_property_vs_us", 2),
    "rdc_dom": ("median_days_on_market", None),
    "rdc_dom_vs_us": ("median_dom_vs_us", 2),
    "rdc_low_quality": ("quality_flag", None),
}


def _month(yyyymm):
    return "%s-%s" % (yyyymm[:4], yyyymm[4:6])


def parse(path, hist_months=HIST_MONTHS):
    """-> (data, hist, rows, as_of). data[zip] holds the newest month; ZIPs with no row in it are left out."""
    with open(path, newline="", encoding="utf8") as fh:
        reader = csv.reader(fh)
        try:
            head = [h.strip() for h in next(reader)]
        except StopIteration:
            raise SourceUnavailable("Realtor hotness file is empty")
        wanted = ["month_date_yyyymm", "postal_code", "hotness_score"] + [c for c, _ in COLUMNS.values()]
        missing = [c for c in wanted if c not in head]
        if missing:
            raise SourceUnavailable("Realtor hotness header changed: %s missing" % ", ".join(missing))
        i_month, i_zip, i_score = head.index("month_date_yyyymm"), head.index("postal_code"), head.index("hotness_score")
        cols = {f: (head.index(c), nd) for f, (c, nd) in COLUMNS.items()}
        rows, latest = 0, ""
        newest, scores = {}, {}
        width = len(head)
        for row in reader:
            if len(row) < width:
                continue
            rows += 1
            month = row[i_month]
            if len(month) != 6 or not month.isdigit():
                continue
            zip5 = zfill_zip(row[i_zip])
            if not zip5:
                continue
            if month > latest:
                latest = month
            cur = newest.get(zip5)
            if cur is None or month > cur[0]:
                newest[zip5] = (month, row)
            score = num(row[i_score])
            if score is not None:
                scores.setdefault(zip5, {})[month] = round(score, 1)
    data = {}
    for zip5, (month, row) in newest.items():
        if month != latest:
            continue
        vals = {}
        for field, (i, nd) in cols.items():
            val = num(row[i])
            if val is not None:
                vals[field] = int(round(val)) if nd is None else round(val, nd)
        if vals:
            data[zip5] = vals
    if len(data) < MIN_ZIPS:
        raise SourceUnavailable("Realtor hotness parsed to %d ZIPs for %s (expected about 14,400)" % (len(data), latest or "no month"))
    hist = {}
    for zip5 in data:
        pts = [[_month(m), v] for m, v in sorted(scores.get(zip5, {}).items())][-hist_months:]
        if len(pts) >= 2:
            hist[zip5] = {"rdc_hotness": pts}
    return data, hist, rows, _month(latest)


def load(ctx):
    path, meta = ctx.fetch(URL, "zip_history.csv", timeout=180, min_bytes=1 << 20)
    ctx.log("parsing %.0f MB (%s)" % (meta.get("bytes", 0) / 1e6, meta.get("status")))
    t0 = time.time()
    data, hist, rows, as_of = parse(path)
    ctx.log("%d rows, %d ZIPs in %.0fs" % (rows, len(data), time.time() - t0))
    return {"as_of": as_of, "rows": rows, "data": data, "hist": hist,
            "note": "Scores run 0 to 100. A flag of 1 marks ZIPs where Realtor.com says the data is thin."}
