"""Legacy national source geonames_postal, wrapped as a plugin (DataArch section 3). Loader in _legacy.py."""
from _legacy import loader

SOURCE = {
    "id": "geonames_postal",
    "name": "GeoNames US postal codes",
    "publisher": "GeoNames",
    "homepage": "https://www.geonames.org/",
    "level": "zip",
    "group": "geo",
    "cadence": "monthly",
    "license": "CC BY 4.0",
    "key_env": None,
    "legacy": True,  # its ZIP fields come from the legacy builder, not the plugin merge
    "fields": {
        "city": {"label": "City", "unit": "text", "agg": "none"},
    },
}

load = loader("geonames_postal")
