"""Legacy national source census_zcta_county, wrapped as a plugin (DataArch section 3). Loader in _legacy.py."""
from _legacy import loader

SOURCE = {
    "id": "census_zcta_county",
    "name": "Census 2020 ZCTA to county relationship file",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/geographies/reference-files/time-series/geo/relationship-files.html",
    "level": "zip",
    "group": "geo",
    "cadence": "every 10 years",
    "license": "Public domain (US government work)",
    "key_env": None,
    "legacy": True,  # its ZIP fields come from the legacy builder, not the plugin merge
    "fields": {
        "county": {"label": "County", "unit": "text", "agg": "none"},
        "county_fips": {"label": "County FIPS", "unit": "text", "agg": "none"},
        "state": {"label": "State", "unit": "text", "agg": "none"},
    },
}

load = loader("census_zcta_county")
