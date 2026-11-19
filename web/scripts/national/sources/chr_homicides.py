"""Legacy national source chr_homicides, wrapped as a plugin (DataArch section 3). Loader in _legacy.py."""
from _legacy import loader

SOURCE = {
    "id": "chr_homicides",
    "name": "County Health Rankings homicide rate (county crime proxy)",
    "publisher": "University of Wisconsin Population Health Institute",
    "homepage": "https://www.countyhealthrankings.org/",
    "level": "county",
    "group": "risk",
    "cadence": "annual",
    "license": "County Health Rankings: free to use with attribution",
    "key_env": None,
    "legacy": True,  # its ZIP fields come from the legacy builder, not the plugin merge
    "fields": {
        "homicide_rate": {"label": "Homicides per 100,000 (county proxy)", "unit": "per_100k", "agg": "none"},
    },
}

load = loader("chr_homicides")
