"""Legacy national source census_cbsa, wrapped as a plugin (DataArch section 3). Loader in _legacy.py."""
from _legacy import loader

SOURCE = {
    "id": "census_cbsa",
    "name": "OMB core based statistical area delineation",
    "publisher": "US Census Bureau (OMB delineation)",
    "homepage": "https://www.census.gov/geographies/reference-files/time-series/demo/metro-micro/delineation-files.html",
    "level": "county",
    "group": "geo",
    "cadence": "every few years",
    "license": "Public domain (US government work)",
    "key_env": None,
    "legacy": True,  # its ZIP fields come from the legacy builder, not the plugin merge
    "fields": {
        "metro": {"label": "Metro area", "unit": "text", "agg": "none"},
        "cbsa": {"label": "CBSA code", "unit": "text", "agg": "none"},
        "cbsa_kind": {"label": "Metro or micro area", "unit": "text", "agg": "none"},
    },
}

load = loader("census_cbsa")
