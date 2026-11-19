"""Published ACS 1-year housing and income estimates for CBSAs.

Keep metropolitan and micropolitan areas with published 1-year estimates.
These are native area estimates, not averages of ZIP values. Rent burden
excludes households whose rent-to-income ratio could not be computed.
"""
import _acs

SOURCE = {
    "id": "acs1_metro",
    "name": "American Community Survey 1-year: metro housing and income",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/programs-surveys/acs/data/data-via-ftp.html",
    "level": "cbsa",
    "group": "commercial",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": _acs.annual_fields("a1m_"),
}
TABLES = _acs.ANNUAL_TABLES
MIN_METROS = 380


def parse(paths):
    raw, rows = _acs.parse_tables(paths, TABLES, "cbsa", MIN_METROS, sparse=True)
    return {geo: _acs.annual_row(rec, "a1m_") for geo, rec in raw.items()}, rows


def load(ctx):
    paths, year = _acs.fetch_tables(ctx, TABLES, 1)
    data, rows = parse(paths)
    vacancy_areas = sum(row["a1m_rental_vacancy"] is not None for row in data.values())
    return {"as_of": str(year), "rows": rows, "data": data,
            "note": "Published metropolitan and micropolitan areas only; ACS 1-year does not cover every CBSA. "
                    "Rental vacancy is for-rent units divided by renter-occupied, for-rent and rented-not-occupied units. "
                    "Rent burden excludes not-computed households. Unpublished table rows stay missing. "
                    "Rental vacancy covers %d of %d published areas. These are survey estimates, not asking rents." %
                    (vacancy_areas, len(data))}
