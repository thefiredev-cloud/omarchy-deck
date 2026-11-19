"""Legacy national source nces_edge_schools, wrapped as a plugin (DataArch section 3). Loader in _legacy.py."""
from _legacy import loader

SOURCE = {
    "id": "nces_edge_schools",
    "name": "NCES EDGE public school locations",
    "publisher": "National Center for Education Statistics",
    "homepage": "https://nces.ed.gov/programs/edge/",
    "level": "zip",
    "group": "people",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "native": "point",
    "legacy": True,  # its ZIP fields come from the legacy builder, not the plugin merge
    "fields": {
        "schools_5mi": {"label": "Public schools within 5 miles", "unit": "count", "agg": "none"},
    },
}

load = loader("nces_edge_schools")
