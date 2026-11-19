"""Legacy national source zillow_zhvi, wrapped as a plugin (DataArch section 3). Loader in _legacy.py."""
from _legacy import loader

SOURCE = {
    "id": "zillow_zhvi",
    "name": "Zillow Home Value Index, ZIP",
    "publisher": "Zillow Research",
    "homepage": "https://www.zillow.com/research/data/",
    "level": "zip",
    "group": "residential",
    "cadence": "monthly",
    "license": "Zillow Research data: free to use with attribution to Zillow",
    "key_env": None,
    "legacy": True,  # its ZIP fields come from the legacy builder, not the plugin merge
    "fields": {
        "zhvi": {"label": "Zillow home value index", "unit": "usd", "agg": "none"},
        "zhvi_yoy": {"label": "Zillow home value change, 1 year", "unit": "pct", "agg": "none"},
        "zhvi_5y": {"label": "Zillow home value change, 5 years", "unit": "pct", "agg": "none"},
    },
}

load = loader("zillow_zhvi")
