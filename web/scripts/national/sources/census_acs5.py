"""Legacy national source census_acs5, wrapped as a plugin (DataArch section 3). Loader in _legacy.py."""
from _legacy import loader

SOURCE = {
    "id": "census_acs5",
    "name": "Census ACS 5-year, ZCTA (population, income, rent, housing units)",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/programs-surveys/acs",
    "level": "zip",
    "group": "people",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "legacy": True,  # its ZIP fields come from the legacy builder, not the plugin merge
    "fields": {
        "pop": {"label": "Population", "unit": "count", "agg": "none"},
        "hh_income": {"label": "Median household income", "unit": "usd", "agg": "none"},
        "vacancy": {"label": "Vacant homes (all reasons)", "unit": "pct", "agg": "none"},
        "owner_share": {"label": "Owner-occupied homes", "unit": "pct", "agg": "none"},
        "renter_share": {"label": "Renter-occupied homes", "unit": "pct", "agg": "none"},
        "median_age": {"label": "Median age", "unit": "years", "agg": "none"},
        "acs_gross_rent": {"label": "Median gross rent (survey)", "unit": "usd_month", "agg": "none"},
    },
}

load = loader("census_acs5")
