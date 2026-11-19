"""Redfin Data Center, supply signals by ZIP: price drops, contract cancellations, delistings and relistings. Level "zip".

Three monthly all_zips.csv files (rolling 3 months, newest period first; 0.8 GB, 0.6 GB, 0.7 GB). Streams each one, keeps
the newest period per ZIP and up to 60 monthly points of one chart field per file. The property_types file (4.1 GB) is
left out on purpose: its ZIP rows repeat the market file by property type.
"""
import csv
import gzip
import time

from ctx import SourceUnavailable, num, zfill_zip

BASE = "https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_data_center/%s/monthly/all_zips.csv"
HIST_MONTHS = 60
MIN_ZIPS = 5000  # each file carries about 29,000 ZIPs per period; these signals are sparser than the market file

SOURCE = {
    "id": "redfin_zip_supply_signals",
    "name": "Redfin price drops, contract cancellations and delistings by ZIP",
    "publisher": "Redfin",
    "homepage": "https://www.redfin.com/news/data-center/",
    "level": "zip",
    "group": "residential",
    "cadence": "monthly",
    "license": "Redfin Data Center: free to use with citation to Redfin",
    "key_env": None,
    "fields": {
        "redfin_price_drops": {"label": "Price drops, 3 months", "unit": "count", "agg": "sum"},
        "redfin_price_drop_size": {"label": "Average size of a price drop", "unit": "pct", "agg": "pop_weighted_mean"},
        "redfin_active_price_drop_share": {"label": "Active listings with a price drop", "unit": "pct",
                                           "agg": "pop_weighted_mean"},
        "redfin_sold_price_drop": {"label": "Homes sold after a price drop", "unit": "count", "agg": "sum"},
        "redfin_sold_price_drop_share": {"label": "Share of sales that had a price drop", "unit": "pct",
                                         "agg": "pop_weighted_mean"},
        "redfin_cancellations": {"label": "Home purchase cancellations, 3 months", "unit": "count", "agg": "sum"},
        "redfin_cancel_rate": {"label": "Cancellations as a share of pending sales", "unit": "pct",
                               "agg": "pop_weighted_mean", "better": "lower"},
        "redfin_delistings": {"label": "Listings taken off the market, 3 months", "unit": "count", "agg": "sum"},
        "redfin_relistings": {"label": "Listings put back on the market, 3 months", "unit": "count", "agg": "sum"},
        "redfin_delisted_share": {"label": "Share of listings delisted", "unit": "pct", "agg": "pop_weighted_mean"},
        "redfin_relisted_share": {"label": "Share of listings relisted", "unit": "pct", "agg": "pop_weighted_mean"},
    },
}

# file key -> (folder under redfin_data_center, {field: (Redfin column, kind)}, chart fields). kind: i count, f decimal.
FILES = {
    "price_drops": ("price_drops", {
        "redfin_price_drops": ("PRICE DROPS", "i"),
        "redfin_price_drop_size": ("AVERAGE SIZE OF PRICE DROP (%)", "f"),
        "redfin_active_price_drop_share": ("PERCENT ACTIVE WITH PRICE DROPS (%)", "f"),
        "redfin_sold_price_drop": ("HOMES SOLD WITH PRICE DROPS", "i"),
        "redfin_sold_price_drop_share": ("PERCENT HOMES SOLD WITH PRICE DROPS (%)", "f"),
    }, ("redfin_active_price_drop_share",)),
    "contract_cancellations": ("contract_cancellations", {
        "redfin_cancellations": ("HOME PURCHASE CANCELLATIONS", "i"),
        "redfin_cancel_rate": ("PERCENT OF PENDING SALES (%)", "f"),
    }, ("redfin_cancel_rate",)),
    "delistings_relistings": ("delistings_relistings", {
        "redfin_delistings": ("TOTAL DELISTINGS", "i"),
        "redfin_relistings": ("TOTAL RELISTINGS", "i"),
        "redfin_delisted_share": ("SHARE OF LISTINGS DELISTED (%)", "f"),
        "redfin_relisted_share": ("SHARE OF LISTINGS RELISTED (%)", "f"),
    }, ("redfin_delisted_share",)),
}


def _open(path):
    with open(path, "rb") as fh:
        magic = fh.read(2)
    if magic == b"\x1f\x8b":
        return gzip.open(path, "rt", newline="", encoding="utf8")
    return open(path, newline="", encoding="utf8")


def parse(path, kind, hist_months=HIST_MONTHS):
    """One Redfin supply file (`kind` is a key of FILES) -> (data, hist, rows, as_of). ZIPs with no row in the newest
    period are left out. hist[zip][field] = [[YYYY-MM, value], ...] oldest first."""
    _, columns, hist_fields = FILES[kind]
    with _open(path) as fh:
        reader = csv.reader(fh)
        try:
            head = [h.strip().upper() for h in next(reader)]
        except StopIteration:
            raise SourceUnavailable("Redfin %s file is empty" % kind)
        need = ("PERIOD END", "REGION TYPE", "REGION NAME")
        if any(n not in head for n in need):
            raise SourceUnavailable("Redfin %s header changed: %s missing" % (kind, ", ".join(n for n in need if n not in head)))
        i_end, i_type, i_name = (head.index(n) for n in need)
        i_adj = head.index("IS SEASONALLY ADJUSTED") if "IS SEASONALLY ADJUSTED" in head else None
        cols = {f: (head.index(c), k) for f, (c, k) in columns.items() if c in head}
        if len(cols) < len(columns):
            raise SourceUnavailable("Redfin %s file lost columns: %s" % (
                kind, ", ".join(c for f, (c, k) in columns.items() if f not in cols)))
        hist_cols = [(f,) + cols[f] for f in hist_fields]
        latest, lidx, rows = "", 0, 0
        newest, series = {}, {}
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
                newest[zip5] = (end, {f: _cast(row[i], k) for f, (i, k) in cols.items()})
            if eidx > lidx - hist_months:
                per = series.setdefault(zip5, {})
                for field, i, k in hist_cols:
                    val = _cast(row[i], k)
                    if val is not None:
                        per.setdefault(field, {})[end] = val
    data = {z: {f: v for f, v in vals.items() if v is not None} for z, (end, vals) in newest.items() if end == latest}
    data = {z: v for z, v in data.items() if v}
    if len(data) < MIN_ZIPS:
        raise SourceUnavailable("Redfin %s parsed to %d ZIPs for %s (expected about 29,000)" % (kind, len(data), latest or "no period"))
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


def _cast(raw, kind):
    val = num(raw)
    if val is None:
        return None
    return int(round(val)) if kind == "i" else round(val, 2)


def load(ctx):
    data, hist, rows, periods = {}, {}, 0, {}
    for kind, (folder, _, _) in FILES.items():
        path, meta = ctx.fetch(BASE % folder, kind + ".csv", timeout=180, min_bytes=1 << 20)
        ctx.log("parsing %s, %.0f MB (%s)" % (kind, meta.get("bytes", 0) / 1e6, meta.get("status")))
        t0 = time.time()
        part, part_hist, part_rows, period = parse(path, kind)
        ctx.log("%d rows, %d ZIPs in %.0fs" % (part_rows, len(part), time.time() - t0))
        for zip5, vals in part.items():
            data.setdefault(zip5, {}).update(vals)
        for zip5, series in part_hist.items():
            hist.setdefault(zip5, {}).update(series)
        rows += part_rows
        periods[kind] = period
    as_of = max(periods.values())
    note = "Redfin reports rolling 3-month windows, so each value covers the three months ending in the stated month."
    if len(set(periods.values())) > 1:
        note += " The three files ended in different months: " + ", ".join("%s %s" % (k, v) for k, v in sorted(periods.items())) + "."
    return {"as_of": as_of, "rows": rows, "data": data, "hist": hist, "note": note}
