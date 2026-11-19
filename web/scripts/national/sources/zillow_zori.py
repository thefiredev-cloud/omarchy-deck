"""Legacy national source zillow_zori, wrapped as a plugin (DataArch section 3). Loader in _legacy.py."""
from _legacy import loader

SOURCE = {
    "id": "zillow_zori",
    "name": "Zillow Observed Rent Index, ZIP",
    "publisher": "Zillow Research",
    "homepage": "https://www.zillow.com/research/data/",
    "level": "zip",
    "group": "residential",
    "cadence": "monthly",
    "license": "Zillow Research data: free to use with attribution to Zillow",
    "key_env": None,
    "legacy": True,  # its ZIP fields come from the legacy builder, not the plugin merge
    "fields": {
        "rent_zori": {"label": "Zillow observed rent", "unit": "usd_month", "agg": "none"},
        "rent_yoy": {"label": "Zillow rent change, 1 year", "unit": "pct", "agg": "none"},
    },
}

load = loader("zillow_zori")
