"""ACS 5-year multifamily stock and renter estimates for ZCTAs.

B25024 uses all housing units; B25032, B25036 and B25038 use renter-occupied
units. B25031 rents are bedroom medians, not asking rents. The recent-mover
field uses the newest published B25038 bin, whose dates are reported in note.
"""
import re
import time

import _acs
from ctx import SourceUnavailable

SOURCE = {
    "id": "acs5_multifamily_zcta",
    "name": "American Community Survey 5-year: multifamily housing and renters",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/programs-surveys/acs/data/data-via-ftp.html",
    "level": "zip",
    "group": "commercial",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "acsmf_units_5_9_share": {"label": "Homes in 5 to 9 unit buildings", "unit": "pct", "agg": "pop_weighted_mean"},
        "acsmf_units_10_19_share": {"label": "Homes in 10 to 19 unit buildings", "unit": "pct", "agg": "pop_weighted_mean"},
        "acsmf_units_20_49_share": {"label": "Homes in 20 to 49 unit buildings", "unit": "pct", "agg": "pop_weighted_mean"},
        "acsmf_units_50plus_share": {"label": "Homes in buildings with 50 or more units", "unit": "pct", "agg": "pop_weighted_mean"},
        "acsmf_renter_5plus_share": {"label": "Renters in buildings with 5 or more units", "unit": "pct", "agg": "pop_weighted_mean"},
        "acsmf_renter_hh": {"label": "Renter households", "unit": "count", "agg": "sum"},
        "acsmf_rent_0br": {"label": "Median gross rent, no bedrooms", "unit": "usd_month", "agg": "pop_weighted_median"},
        "acsmf_rent_1br": {"label": "Median gross rent, 1 bedroom", "unit": "usd_month", "agg": "pop_weighted_median"},
        "acsmf_rent_2br": {"label": "Median gross rent, 2 bedrooms", "unit": "usd_month", "agg": "pop_weighted_median"},
        "acsmf_rent_3br": {"label": "Median gross rent, 3 bedrooms", "unit": "usd_month", "agg": "pop_weighted_median"},
        "acsmf_renter_pre1980_share": {"label": "Renters in homes built before 1980", "unit": "pct", "agg": "pop_weighted_mean"},
        "acsmf_renter_recent_mover_share": {"label": "Renters who moved in 2023 or later", "unit": "pct", "agg": "pop_weighted_mean"},
    },
}
MIN_ZCTAS = 30000
TABLES = {
    "b25024": {"E001": "units", "E006": "u59", "E007": "u1019", "E008": "u2049", "E009": "u50"},
    "b25032": {"E013": "r_units", "E018": "r59", "E019": "r1019", "E020": "r2049", "E021": "r50"},
    "b25003": {"E003": "renters"},
    "b25031": {"E002": "rent0", "E003": "rent1", "E004": "rent2", "E005": "rent3"},
    "b25036": {"E013": "r_age", "E019": "r1970", "E020": "r1960", "E021": "r1950", "E022": "r1940", "E023": "r1939"},
    "b25038": {"E009": "r_movers", "E010": "r_recent"},
}


def derive(rec):
    g = rec.get
    return {
        "acsmf_units_5_9_share": _acs.share([g("u59")], g("units")),
        "acsmf_units_10_19_share": _acs.share([g("u1019")], g("units")),
        "acsmf_units_20_49_share": _acs.share([g("u2049")], g("units")),
        "acsmf_units_50plus_share": _acs.share([g("u50")], g("units")),
        "acsmf_renter_5plus_share": _acs.share([g("r59"), g("r1019"), g("r2049"), g("r50")], g("r_units")),
        "acsmf_renter_hh": None if g("renters") is None else int(g("renters")),
        "acsmf_rent_0br": g("rent0"),
        "acsmf_rent_1br": g("rent1"),
        "acsmf_rent_2br": g("rent2"),
        "acsmf_rent_3br": g("rent3"),
        "acsmf_renter_pre1980_share": _acs.share([g("r1970"), g("r1960"), g("r1950"), g("r1940"), g("r1939")], g("r_age")),
        "acsmf_renter_recent_mover_share": _acs.share([g("r_recent")], g("r_movers")),
    }


def parse(paths):
    raw, rows = _acs.parse_tables(paths, TABLES, "zip", MIN_ZCTAS)
    return {geo: derive(rec) for geo, rec in raw.items()}, rows


def mover_label(metadata):
    """Validate the estimate bins instead of assuming their dates never change."""
    variables = metadata.get("variables", {})
    denominator = variables.get("B25038_009E", {}).get("label", "")
    numerator = variables.get("B25038_010E", {}).get("label", "")
    if denominator != "Estimate!!Total:!!Renter occupied:":
        raise SourceUnavailable("ACS B25038 renter denominator label changed")
    match = re.fullmatch(r"Estimate!!Total:!!Renter occupied:!!Moved in (\d{4}) or later", numerator)
    if not match:
        raise SourceUnavailable("ACS B25038 recent-mover category label changed")
    return "Renters who moved in %s or later" % match.group(1)


def load(ctx):
    paths, year = _acs.fetch_tables(ctx, TABLES, 5)
    time.sleep(1)
    metadata = ctx.get_json("https://api.census.gov/data/%d/acs/acs5/groups/B25038.json" % year,
                            "%d-b25038-labels.json" % year)
    label = mover_label(metadata)
    data, rows = parse(paths)
    coverage = sum(row["acsmf_renter_5plus_share"] is not None for row in data.values())
    if coverage < MIN_ZCTAS:
        raise SourceUnavailable("ACS renter multifamily share covers only %d ZCTAs" % coverage)
    return {"as_of": "%d-%d" % (year - 4, year), "rows": rows, "data": data,
            "note": "Survey estimates for ZCTAs, not postal delivery ZIPs. " + label +
                    " is the published recent-mover bin; an exact 2021-or-later share is not available. "
                    "Small areas carry wide margins of error; suppressed values and empty denominators are missing."}
