"""Legacy national source census_zbp_prior, wrapped as a plugin (DataArch section 3). Loader in _legacy.py."""
from _legacy import loader

SOURCE = {
    "id": "census_zbp_prior",
    "name": "Census ZIP Code Business Patterns, totals five years earlier",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/programs-surveys/cbp.html",
    "level": "zip",
    "group": "commercial",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "legacy": True,  # its ZIP fields come from the legacy builder, not the plugin merge
    "fields": {
        "biz_estabs_prior": {"label": "Business establishments five years earlier", "unit": "count", "agg": "none"},
    },
}

load = loader("census_zbp_prior")
