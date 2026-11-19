"""Legacy national source ipeds_hd, wrapped as a plugin (DataArch section 3). Loader in _legacy.py."""
from _legacy import loader

SOURCE = {
    "id": "ipeds_hd",
    "name": "IPEDS college directory",
    "publisher": "National Center for Education Statistics",
    "homepage": "https://nces.ed.gov/ipeds/",
    "level": "zip",
    "group": "people",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "native": "point",
    "legacy": True,  # its ZIP fields come from the legacy builder, not the plugin merge
    "fields": {
        "colleges_5mi": {"label": "Colleges within 5 miles", "unit": "count", "agg": "none"},
        "colleges_10mi": {"label": "Colleges within 10 miles", "unit": "count", "agg": "none"},
    },
}

load = loader("ipeds_hd")
