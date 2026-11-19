"""Zillow Research for-sale listing metrics by ZIP: inventory, new listings, median list price, share with a price cut,
days to pending, sale-to-list, median sale price and new pending sales. Level "zip".

Eight wide monthly CSVs (one row per ZIP, one column per month, newest last). Values come from the newest column of each
file; three chart fields keep up to 60 monthly points. Sale-based files lag the listing files by a month.
"""
import csv
import re

from ctx import SourceUnavailable, num, zfill_zip

BASE = "https://files.zillowstatic.com/research/public_csvs/"
HIST_MONTHS = 60
MIN_ZIPS = 2000  # the sparsest file (days to pending) carries about 4,000 ZIPs

SOURCE = {
    "id": "zillow_listing_metrics_zip",
    "name": "Zillow for-sale listing metrics by ZIP",
    "publisher": "Zillow Research",
    "homepage": "https://www.zillow.com/research/data/",
    "level": "zip",
    "group": "residential",
    "cadence": "monthly",
    "license": "Zillow Research data: free to use with attribution to Zillow Research",
    "key_env": None,
    "fields": {
        "zillow_inventory": {"label": "Homes for sale", "unit": "count", "agg": "sum"},
        "zillow_new_listings": {"label": "New listings in the month", "unit": "count", "agg": "sum"},
        "zillow_median_list_price": {"label": "Median list price", "unit": "usd", "agg": "pop_weighted_median"},
        "zillow_price_cut_share": {"label": "Listings with a price cut", "unit": "pct", "agg": "pop_weighted_mean"},
        "zillow_days_to_pending": {"label": "Median days to pending", "unit": "days", "agg": "pop_weighted_median",
                                   "better": "lower"},
        "zillow_new_pending": {"label": "New pending sales in the month", "unit": "count", "agg": "sum"},
        "zillow_sale_to_list": {"label": "Sale price as a share of list price", "unit": "pct", "agg": "pop_weighted_mean"},
        "zillow_median_sale": {"label": "Median sale price", "unit": "usd", "agg": "pop_weighted_median"},
    },
}

# key -> (path under public_csvs, field, kind). kind: i count, d whole dollars, p fraction shown as 0 to 100.
FILES = {
    "invt_fs": ("invt_fs/Zip_invt_fs_uc_sfrcondo_sm_month.csv", "zillow_inventory", "i"),
    "new_listings": ("new_listings/Zip_new_listings_uc_sfrcondo_sm_month.csv", "zillow_new_listings", "i"),
    "mlp": ("mlp/Zip_mlp_uc_sfrcondo_sm_month.csv", "zillow_median_list_price", "d"),
    "price_cut": ("perc_listings_price_cut/Zip_perc_listings_price_cut_uc_sfrcondo_sm_month.csv", "zillow_price_cut_share", "p"),
    "doz_pending": ("med_doz_pending/Zip_med_doz_pending_uc_sfrcondo_sm_month.csv", "zillow_days_to_pending", "i"),
    "new_pending": ("new_pending/Zip_new_pending_uc_sfrcondo_sm_month.csv", "zillow_new_pending", "i"),
    "sale_to_list": ("mean_sale_to_list/Zip_mean_sale_to_list_uc_sfrcondo_sm_month.csv", "zillow_sale_to_list", "p"),
    "median_sale": ("median_sale_price/Zip_median_sale_price_uc_sfrcondo_sm_month.csv", "zillow_median_sale", "d"),
}
HIST_FIELDS = ("zillow_inventory", "zillow_median_list_price", "zillow_price_cut_share")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _cast(raw, kind):
    val = num(raw)
    if val is None:
        return None
    if kind == "p":
        return round(val * 100, 2)
    return int(round(val))


def parse(path, kind, keep_hist=False, hist_months=HIST_MONTHS):
    """One Zillow wide file -> ({zip: value in the newest month}, {zip: [[YYYY-MM, value], ...]}, rows, newest YYYY-MM)."""
    value_kind = FILES[kind][2]
    values, hist, rows = {}, {}, 0
    with open(path, newline="", encoding="utf8") as fh:
        reader = csv.reader(fh)
        try:
            head = next(reader)
        except StopIteration:
            raise SourceUnavailable("Zillow %s file is empty" % kind)
        if "RegionName" not in head:
            raise SourceUnavailable("Zillow %s header changed: no RegionName column" % kind)
        i_name = head.index("RegionName")
        i_type = head.index("RegionType") if "RegionType" in head else None
        dates = [(i, h) for i, h in enumerate(head) if DATE.match(h)]
        if len(dates) < 12:
            raise SourceUnavailable("Zillow %s file has %d month columns (expected 60 or more)" % (kind, len(dates)))
        last_i, last = dates[-1]
        window = dates[-hist_months:]
        for row in reader:
            if len(row) <= last_i:
                continue
            rows += 1
            if i_type is not None and row[i_type].lower() != "zip":
                continue
            zip5 = zfill_zip(row[i_name])
            if not zip5:
                continue
            val = _cast(row[last_i], value_kind)
            if val is not None:
                values[zip5] = val
            if keep_hist and val is not None:
                pts = []
                for i, label in window:
                    v = _cast(row[i], value_kind)
                    if v is not None:
                        pts.append([label[:7], v])
                if len(pts) >= 2:
                    hist[zip5] = pts
    if len(values) < MIN_ZIPS:
        raise SourceUnavailable("Zillow %s parsed to %d ZIPs with a value in %s" % (kind, len(values), last[:7]))
    return values, hist, rows, last[:7]


def load(ctx):
    data, hist, rows, newest = {}, {}, 0, {}
    for kind, (rel, field, _) in FILES.items():
        path, meta = ctx.fetch(BASE + rel, kind + ".csv", timeout=120, min_bytes=1000)
        values, series, n, last = parse(path, kind, keep_hist=field in HIST_FIELDS)
        ctx.log("%s: %d ZIPs, newest month %s (%s)" % (kind, len(values), last, meta.get("status")))
        for zip5, val in values.items():
            data.setdefault(zip5, {})[field] = val
        for zip5, pts in series.items():
            hist.setdefault(zip5, {})[field] = pts
        rows += n
        newest[field] = last
    as_of = max(newest.values())
    note = "One month per field."
    lagging = sorted(f for f, m in newest.items() if m != as_of)
    if lagging:
        note = "Sale-based fields end a month earlier than the listing fields (%s)." % ", ".join(
            "%s %s" % (f.replace("zillow_", ""), newest[f]) for f in lagging)
    return {"as_of": as_of, "rows": rows, "data": data, "hist": hist, "note": note}
