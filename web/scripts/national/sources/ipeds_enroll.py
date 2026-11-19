"""Legacy national source ipeds_enroll, wrapped as a plugin (DataArch section 3). Loader in _legacy.py."""
from _legacy import loader

SOURCE = {
    "id": "ipeds_enroll",
    "name": "IPEDS fall enrollment",
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
        "college_enroll_5mi": {"label": "College students within 5 miles", "unit": "count", "agg": "none"},
        "college_enroll_10mi": {"label": "College students within 10 miles", "unit": "count", "agg": "none"},
    },
}

load = loader("ipeds_enroll")
