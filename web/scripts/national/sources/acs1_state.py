"""Published ACS 1-year housing and income estimates for states and DC.

Puerto Rico and other territories are excluded. State medians and percentages
are published estimates, never averages of the metro or ZCTA estimates.
"""
import _acs

SOURCE = {
    "id": "acs1_state",
    "name": "American Community Survey 1-year: state housing and income",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/programs-surveys/acs/data/data-via-ftp.html",
    "level": "state",
    "group": "commercial",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": _acs.annual_fields("a1s_"),
}
TABLES = _acs.ANNUAL_TABLES
MIN_STATES = 51


def parse(paths):
    raw, rows = _acs.parse_tables(paths, TABLES, "state", MIN_STATES)
    return {geo: _acs.annual_row(rec, "a1s_") for geo, rec in raw.items()}, rows


def load(ctx):
    paths, year = _acs.fetch_tables(ctx, TABLES, 1)
    data, rows = parse(paths)
    return {"as_of": str(year), "rows": rows, "data": data,
            "note": "Published estimates for the 50 states and District of Columbia, excluding territories. "
                    "Rental vacancy is for-rent units divided by renter-occupied, for-rent and rented-not-occupied units. "
                    "Rent burden excludes not-computed households. These are survey estimates, not asking rents."}
