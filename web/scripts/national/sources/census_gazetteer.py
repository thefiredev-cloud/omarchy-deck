"""Legacy national source census_gazetteer, wrapped as a plugin (DataArch section 3). Loader in _legacy.py."""
from _legacy import loader

SOURCE = {
    "id": "census_gazetteer",
    "name": "Census Gazetteer, ZIP Code Tabulation Areas",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html",
    "level": "zip",
    "group": "geo",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "legacy": True,  # its ZIP fields come from the legacy builder, not the plugin merge
    "fields": {
        "lat": {"label": "Latitude", "unit": "index", "agg": "none"},
        "lon": {"label": "Longitude", "unit": "index", "agg": "none"},
        "land_sqmi": {"label": "Land area, square miles", "unit": "index", "agg": "none"},
    },
}

load = loader("census_gazetteer")
