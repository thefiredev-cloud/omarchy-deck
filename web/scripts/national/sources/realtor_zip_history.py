"""Legacy national source realtor_zip_history, wrapped as a plugin (DataArch section 3). Loader in _legacy.py."""
from _legacy import loader

SOURCE = {
    "id": "realtor_zip_history",
    "name": "Realtor.com listings core metrics, ZIP, monthly history",
    "publisher": "Realtor.com",
    "homepage": "https://www.realtor.com/research/data/",
    "level": "zip",
    "group": "residential",
    "cadence": "monthly",
    "license": "Realtor.com research data: free to use with attribution",
    "key_env": None,
    "legacy": True,  # its ZIP fields come from the legacy builder, not the plugin merge
    "fields": {
        "list_price": {"label": "Median list price, monthly history", "unit": "usd", "agg": "pop_weighted_median"},
        "active": {"label": "Active listings, monthly history", "unit": "count", "agg": "sum"},
    },
}

load = loader("realtor_zip_history")
