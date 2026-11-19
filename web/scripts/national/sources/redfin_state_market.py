"""Redfin monthly all-residential and 2-4 unit multifamily markets by state.

State REGION ID is Redfin's internal ID, not FIPS. Resolve publisher names to
USPS codes, including its Columbia label for DC, and exclude territories.
"""
from _redfin_segments import MARKET, MF, fields, load_area, parse_table

MIN_STATES = 51
SOURCE = {
    "id": "redfin_state_market",
    "name": "Redfin residential and multifamily market by state",
    "publisher": "Redfin",
    "homepage": "https://www.redfin.com/news/data-center/",
    "level": "state",
    "group": "residential",
    "cadence": "monthly",
    "license": "Redfin Data Center: free to use with citation to Redfin",
    "key_env": None,
    "fields": {**fields("rfs_", MARKET + ("price_drop_share",), level="State"),
               **fields("rfs_mf_", MF, multifamily=True, level="State")},
}


def parse(path, kind="housing_market", cbsas=None):
    suffixes = {"housing_market": MARKET, "property_types": MF, "price_drops": ("price_drop_share",)}[kind]
    prefix = "rfs_mf_" if kind == "property_types" else "rfs_"
    return parse_table(path, "state", prefix, suffixes, multifamily=kind == "property_types")


def load(ctx):
    return load_area(ctx, parse, "state", "rfs_", MIN_STATES)
