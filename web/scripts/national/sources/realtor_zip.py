"""Legacy national source realtor_zip, wrapped as a plugin (DataArch section 3). Loader in _legacy.py."""
from _legacy import loader

SOURCE = {
    "id": "realtor_zip",
    "name": "Realtor.com listings core metrics, ZIP, latest month",
    "publisher": "Realtor.com",
    "homepage": "https://www.realtor.com/research/data/",
    "level": "zip",
    "group": "residential",
    "cadence": "monthly",
    "license": "Realtor.com research data: free to use with attribution",
    "key_env": None,
    "legacy": True,  # its ZIP fields come from the legacy builder, not the plugin merge
    "fields": {
        "list_price": {"label": "Median list price (Realtor.com)", "unit": "usd", "agg": "none"},
        "active": {"label": "Active listings (Realtor.com)", "unit": "count", "agg": "none"},
        "dom": {"label": "Median days listed (Realtor.com)", "unit": "days", "agg": "none"},
        "price_cut_share": {"label": "Listings with a price cut (Realtor.com)", "unit": "pct", "agg": "none"},
        "realtor_quality_flag": {"label": "Realtor.com data quality flag", "unit": "flag", "agg": "none"},
    },
}

load = loader("realtor_zip")
