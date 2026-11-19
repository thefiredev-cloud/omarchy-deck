"""Legacy national source census_zbp_detail, wrapped as a plugin (DataArch section 3). Loader in _legacy.py."""
from _legacy import loader

SOURCE = {
    "id": "census_zbp_detail",
    "name": "Census ZIP Code Business Patterns, establishments by sector",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/programs-surveys/cbp.html",
    "level": "zip",
    "group": "commercial",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "legacy": True,  # its ZIP fields come from the legacy builder, not the plugin merge
    "fields": {
        "retail_estabs": {"label": "Retail establishments (2-digit, legacy)", "unit": "count", "agg": "sum"},
        "office_estabs": {"label": "Office-using establishments (legacy)", "unit": "count", "agg": "sum"},
        "industrial_estabs": {"label": "Industrial establishments (legacy)", "unit": "count", "agg": "sum"},
    },
}

load = loader("census_zbp_detail")
