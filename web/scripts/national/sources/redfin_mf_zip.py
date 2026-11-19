"""Redfin 2-4 unit multifamily ZIP sales, rolling three-month periods.

Uses the current property_types CSV listed in Redfin's Data Center index.
No all-residential ZIP fields or 5+ unit apartment proxies are emitted.
"""
from _redfin_segments import MF_ZIP, NOTE, fetch_table, fields, parse_table, require_coverage

MIN_ZIPS = 3000
SOURCE = {
    "id": "redfin_mf_zip",
    "name": "Redfin multifamily 2-4 unit market by ZIP",
    "publisher": "Redfin",
    "homepage": "https://www.redfin.com/news/data-center/",
    "level": "zip",
    "group": "residential",
    "cadence": "monthly",
    "license": "Redfin Data Center: free to use with citation to Redfin",
    "key_env": None,
    "fields": fields("rfmf_", MF_ZIP, multifamily=True),
}


def parse(path):
    return parse_table(path, "zip", "rfmf_", MF_ZIP, multifamily=True)


def load(ctx):
    data, rows, as_of = parse(fetch_table(ctx, "property_types", "zip"))
    require_coverage(data, "rfmf_median_sale", MIN_ZIPS)
    return {"data": data, "rows": rows, "as_of": as_of,
            "note": NOTE + " ZIP values cover the three months ending in the stated month."}
