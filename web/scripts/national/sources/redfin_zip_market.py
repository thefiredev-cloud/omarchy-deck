"""Redfin Data Center, housing market by ZIP (rolling 3 months, monthly steps). Level "zip".

Streams the 2 GB all_zips.csv (about 5 million rows, 176 periods, newest period first), keeps the newest period per ZIP
and up to 60 monthly points of three chart fields. The old redfin_market_tracker/*.tsv000.gz path answers 403; the files
moved to redfin_data_center/ (index.json lists them).
"""
import csv
import gzip
import time

from ctx import SourceUnavailable, num, zfill_zip

URL = "https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_data_center/housing_market/monthly/all_zips.csv"
HIST_MONTHS = 60
MIN_ZIPS = 8000  # Redfin carries about 29,700 ZIPs per period; far fewer means a truncated or reshaped file

SOURCE = {
    "id": "redfin_zip_market",
    "name": "Redfin Data Center housing market by ZIP",
    "publisher": "Redfin",
    "homepage": "https://www.redfin.com/news/data-center/",
    "level": "zip",
    "group": "residential",
    "cadence": "monthly",
    "license": "Redfin Data Center: free to use with citation to Redfin",
    "key_env": None,
    "fields": {
        "redfin_median_sale": {"label": "Median sale price, 3 months", "unit": "usd", "agg": "pop_weighted_median"},
        "redfin_median_sale_yoy": {"label": "Median sale price, change from a year ago", "unit": "pct", "agg": "pop_weighted_mean"},
        "redfin_sale_ppsf": {"label": "Median sale price per square foot", "unit": "usd_sqft", "agg": "pop_weighted_median"},
        "redfin_homes_sold": {"label": "Homes sold, 3 months", "unit": "count", "agg": "sum"},
        "redfin_homes_sold_yoy": {"label": "Homes sold, change from a year ago", "unit": "pct", "agg": "pop_weighted_mean"},
        "redfin_dom": {"label": "Median days on market", "unit": "days", "agg": "pop_weighted_median", "better": "lower"},
        "redfin_dom_yoy": {"label": "Days on market, change from a year ago", "unit": "days", "agg": "pop_weighted_mean"},
        "redfin_sale_to_list": {"label": "Sale price as a share of list price", "unit": "pct", "agg": "pop_weighted_mean"},
        "redfin_sale_to_orig_list": {"label": "Sale price as a share of original list price", "unit": "pct", "agg": "pop_weighted_mean"},
        "redfin_sold_above_list": {"label": "Homes sold above list price", "unit": "pct", "agg": "pop_weighted_mean"},
        "redfin_sold_below_list": {"label": "Homes sold below list price", "unit": "pct", "agg": "pop_weighted_mean"},
        "redfin_new_listings": {"label": "New listings, 3 months", "unit": "count", "agg": "sum"},
        "redfin_new_list_price": {"label": "Median new listing price", "unit": "usd", "agg": "pop_weighted_median"},
        "redfin_active_listings": {"label": "Active listings", "unit": "count", "agg": "sum"},
        "redfin_inventory": {"label": "Homes for sale", "unit": "count", "agg": "sum"},
        "redfin_inventory_yoy": {"label": "Homes for sale, change from a year ago", "unit": "pct", "agg": "pop_weighted_mean"},
        "redfin_inventory_age": {"label": "Average age of inventory", "unit": "days", "agg": "pop_weighted_mean"},
        "redfin_inventory_over_60": {"label": "Inventory listed more than 60 days", "unit": "pct", "agg": "pop_weighted_mean"},
        "redfin_pending": {"label": "Pending sales", "unit": "count", "agg": "sum"},
        "redfin_months_supply": {"label": "Months of supply", "unit": "ratio", "agg": "pop_weighted_mean", "better": "lower"},
        "redfin_off_market_2w": {"label": "Homes off market within two weeks", "unit": "pct", "agg": "pop_weighted_mean"},
    },
}

# field -> (Redfin column, kind). kind: i integer count, d whole dollars, f decimal.
COLUMNS = {
    "redfin_median_sale": ("MEDIAN SALE PRICE NSA ($)", "d"),
    "redfin_median_sale_yoy": ("MEDIAN SALE PRICE NSA YOY (%)", "f"),
    "redfin_sale_ppsf": ("MEDIAN SALE PRICE PER SQ.FT. ($)", "d"),
    "redfin_homes_sold": ("HOMES SOLD", "i"),
    "redfin_homes_sold_yoy": ("HOMES SOLD YOY (%)", "f"),
    "redfin_dom": ("MEDIAN DAYS ON MARKET (DAYS)", "i"),
    "redfin_dom_yoy": ("MEDIAN DAYS ON MARKET YOY (DAYS)", "i"),
    "redfin_sale_to_list": ("AVERAGE SALE TO LIST RATIO (%)", "f"),
    "redfin_sale_to_orig_list": ("AVERAGE SALE TO ORIGINAL LIST RATIO (%)", "f"),
    "redfin_sold_above_list": ("SHARE SOLD ABOVE LIST (%)", "f"),
    "redfin_sold_below_list": ("SHARE SOLD BELOW LIST (%)", "f"),
    "redfin_new_listings": ("NEW LISTINGS", "i"),
    "redfin_new_list_price": ("MEDIAN NEW LISTING PRICE ($)", "d"),
    "redfin_active_listings": ("ACTIVE LISTINGS", "i"),
    "redfin_inventory": ("INVENTORY", "i"),
    "redfin_inventory_yoy": ("INVENTORY YOY (%)", "f"),
    "redfin_inventory_age": ("AGE OF INVENTORY (DAYS)", "f"),
    "redfin_inventory_over_60": ("PERCENT INVENTORY OVER 60 DAYS (%)", "f"),
    "redfin_pending": ("PENDING SALES", "i"),
    "redfin_months_supply": ("MONTHS OF SUPPLY", "f"),
    "redfin_off_market_2w": ("PERCENT OFF MARKET IN TWO WEEKS (%)", "f"),
}
HIST_FIELDS = ("redfin_median_sale", "redfin_inventory", "redfin_dom")


def _open(path):
    with open(path, "rb") as fh:
        magic = fh.read(2)
    if magic == b"\x1f\x8b":
        return gzip.open(path, "rt", newline="", encoding="utf8")
    return open(path, newline="", encoding="utf8")


def _cast(raw, kind):
    val = num(raw)
    if val is None:
        return None
    if kind == "i":
        return int(round(val))
    if kind == "d":
        return int(round(val))
    return round(val, 2)


def parse(path, hist_months=HIST_MONTHS):
    """Redfin ZIP file -> (data, hist, rows, as_of). data[zip] holds the newest period; ZIPs with no row in the newest
    period are left out. hist[zip][field] = [[YYYY-MM, value], ...] oldest first, `hist_months` points at most."""
    with _open(path) as fh:
        reader = csv.reader(fh)
        try:
            head = [h.strip().upper() for h in next(reader)]
        except StopIteration:
            raise SourceUnavailable("Redfin file is empty")
        need = ("PERIOD END", "REGION TYPE", "REGION NAME")
        if any(n not in head for n in need):
            raise SourceUnavailable("Redfin file header changed: %s missing" % ", ".join(n for n in need if n not in head))
        i_end, i_type, i_name = (head.index(n) for n in need)
        i_adj = head.index("IS SEASONALLY ADJUSTED") if "IS SEASONALLY ADJUSTED" in head else None
        cols = {f: (head.index(c), kind) for f, (c, kind) in COLUMNS.items() if c in head}
        if "redfin_median_sale" not in cols:
            raise SourceUnavailable("Redfin file has no median sale price column")
        hist_cols = [(f,) + cols[f] for f in HIST_FIELDS if f in cols]
        latest, rows, lidx = "", 0, 0
        newest, series = {}, {}  # newest[zip] = (period_end, row values); series[zip][field] = {period: value}
        width = len(head)
        for row in reader:
            if len(row) < width:
                continue
            rows += 1
            if row[i_type] != "Zip" or (i_adj is not None and row[i_adj].lower() == "true"):
                continue
            zip5 = zfill_zip(row[i_name])
            if not zip5:
                continue
            end = row[i_end][:7]
            try:
                eidx = int(end[:4]) * 12 + int(end[5:7])
            except ValueError:
                continue
            if eidx > lidx:
                latest, lidx = end, eidx
            cur = newest.get(zip5)
            if cur is None or end > cur[0]:
                newest[zip5] = (end, {f: _cast(row[i], kind) for f, (i, kind) in cols.items()})
            if eidx > lidx - hist_months:  # outside the window cannot be a chart point (rows arrive newest first)
                per = series.setdefault(zip5, {})
                for field, i, kind in hist_cols:
                    val = _cast(row[i], kind)
                    if val is not None:
                        per.setdefault(field, {})[end] = val
    data = {z: {k: v for k, v in vals.items() if v is not None} for z, (end, vals) in newest.items() if end == latest}
    data = {z: v for z, v in data.items() if v}
    if len(data) < MIN_ZIPS:
        raise SourceUnavailable("Redfin file parsed to %d ZIPs for %s (expected about 29,000)" % (len(data), latest or "no period"))
    hist = {}
    for zip5 in data:
        out = {}
        for field, points in series.get(zip5, {}).items():
            pts = [[p, points[p]] for p in sorted(points)][-hist_months:]
            if len(pts) >= 2:
                out[field] = pts
        if out:
            hist[zip5] = out
    return data, hist, rows, latest


def load(ctx):
    path, meta = ctx.fetch(URL, "all_zips.csv", timeout=180, min_bytes=1 << 20)
    ctx.log("parsing %.0f MB (%s)" % (meta.get("bytes", 0) / 1e6, meta.get("status")))
    t0 = time.time()
    data, hist, rows, as_of = parse(path)
    ctx.log("%d rows, %d ZIPs in %.0fs" % (rows, len(data), time.time() - t0))
    return {"as_of": as_of, "rows": rows, "data": data, "hist": hist,
            "note": "Redfin reports rolling 3-month windows, so each value covers the three months ending in the stated month."}
