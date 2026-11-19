"""Zillow Home Value Index (ZHVI) by ZIP for segments beyond the middle tier: bottom tier, top tier, single family only,
condo only, and 1 to 5 bedrooms. Level "zip".

Nine wide monthly CSVs (about 0.7 GB together, one row per ZIP, one column per month since 2000). The value is the newest
column; the year-over-year change is computed from the column twelve months earlier, same file.
"""
import csv
import re

from ctx import SourceUnavailable, num, zfill_zip

BASE = "https://files.zillowstatic.com/research/public_csvs/zhvi/"
MIN_ZIPS = 2000  # the sparsest segment (1 bedroom) carries about 4,500 ZIPs
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# key -> (file name, field stem, plain label). Tier files cover all homes; sfr and condo files are the middle tier.
SEGMENTS = {
    "bottom": ("Zip_zhvi_uc_sfrcondo_tier_0.0_0.33_sm_sa_month.csv", "zillow_zhvi_bottom", "Bottom tier home value"),
    "top": ("Zip_zhvi_uc_sfrcondo_tier_0.67_1.0_sm_sa_month.csv", "zillow_zhvi_top", "Top tier home value"),
    "sfr": ("Zip_zhvi_uc_sfr_tier_0.33_0.67_sm_sa_month.csv", "zillow_zhvi_sfr", "Single-family home value"),
    "condo": ("Zip_zhvi_uc_condo_tier_0.33_0.67_sm_sa_month.csv", "zillow_zhvi_condo", "Condo value"),
    "br1": ("Zip_zhvi_bdrmcnt_1_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv", "zillow_zhvi_1br", "1-bedroom home value"),
    "br2": ("Zip_zhvi_bdrmcnt_2_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv", "zillow_zhvi_2br", "2-bedroom home value"),
    "br3": ("Zip_zhvi_bdrmcnt_3_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv", "zillow_zhvi_3br", "3-bedroom home value"),
    "br4": ("Zip_zhvi_bdrmcnt_4_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv", "zillow_zhvi_4br", "4-bedroom home value"),
    "br5": ("Zip_zhvi_bdrmcnt_5_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv", "zillow_zhvi_5br", "5-bedroom home value"),
}

SOURCE = {
    "id": "zillow_zhvi_variants",
    "name": "Zillow Home Value Index by tier, home type and bedrooms",
    "publisher": "Zillow Research",
    "homepage": "https://www.zillow.com/research/data/",
    "level": "zip",
    "group": "residential",
    "cadence": "monthly",
    "license": "Zillow Research data: free to use with attribution to Zillow Research",
    "key_env": None,
    "fields": {},
}
for _key, (_file, _stem, _label) in SEGMENTS.items():
    SOURCE["fields"][_stem] = {"label": _label, "unit": "usd", "agg": "pop_weighted_median"}
    SOURCE["fields"][_stem + "_yoy"] = {"label": _label + ", change from a year ago", "unit": "pct",
                                        "agg": "pop_weighted_mean"}


def parse(path, stem):
    """One ZHVI wide file -> (data, rows, newest YYYY-MM). data[zip] = {stem: whole dollars, stem_yoy: percent}."""
    data, rows = {}, 0
    with open(path, newline="", encoding="utf8") as fh:
        reader = csv.reader(fh)
        try:
            head = next(reader)
        except StopIteration:
            raise SourceUnavailable("Zillow %s file is empty" % stem)
        if "RegionName" not in head:
            raise SourceUnavailable("Zillow %s header changed: no RegionName column" % stem)
        i_name = head.index("RegionName")
        i_type = head.index("RegionType") if "RegionType" in head else None
        dates = [(i, h[:7]) for i, h in enumerate(head) if DATE.match(h)]
        if len(dates) < 24:
            raise SourceUnavailable("Zillow %s file has %d month columns (expected 300 or more)" % (stem, len(dates)))
        last_i, last = dates[-1]
        year_ago = "%04d%s" % (int(last[:4]) - 1, last[4:])
        prev = [i for i, label in dates if label == year_ago]
        prev_i = prev[0] if prev else None
        for row in reader:
            if len(row) <= last_i:
                continue
            rows += 1
            if i_type is not None and row[i_type].lower() != "zip":
                continue
            zip5 = zfill_zip(row[i_name])
            val = num(row[last_i])
            if not zip5 or val is None:
                continue
            out = {stem: int(round(val))}
            old = num(row[prev_i]) if prev_i is not None else None
            if old:
                out[stem + "_yoy"] = round((val / old - 1) * 100, 2)
            data[zip5] = out
    if len(data) < MIN_ZIPS:
        raise SourceUnavailable("Zillow %s parsed to %d ZIPs with a value in %s" % (stem, len(data), last))
    return data, rows, last


def load(ctx):
    data, rows, newest = {}, 0, {}
    for key, (name, stem, _) in SEGMENTS.items():
        path, meta = ctx.fetch(BASE + name, key + ".csv", timeout=180, min_bytes=1 << 16)
        part, n, last = parse(path, stem)
        ctx.log("%s: %d ZIPs, newest month %s (%s)" % (key, len(part), last, meta.get("status")))
        for zip5, vals in part.items():
            data.setdefault(zip5, {}).update(vals)
        rows += n
        newest[key] = last
    as_of = max(newest.values())
    note = "Middle tier unless the label says bottom or top; single-family, condo and bedroom segments are middle-tier values."
    if len(set(newest.values())) > 1:
        note += " Files ended in different months: " + ", ".join("%s %s" % kv for kv in sorted(newest.items())) + "."
    return {"as_of": as_of, "rows": rows, "data": data, "note": note}
