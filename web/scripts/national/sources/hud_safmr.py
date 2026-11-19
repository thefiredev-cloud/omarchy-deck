"""Legacy national source hud_safmr, wrapped as a plugin (DataArch section 3). Loader in _legacy.py."""
from _legacy import loader

SOURCE = {
    "id": "hud_safmr",
    "name": "HUD Small Area Fair Market Rents by ZIP",
    "publisher": "US Department of Housing and Urban Development",
    "homepage": "https://www.huduser.gov/portal/datasets/fmr/smallarea/index.html",
    "level": "zip",
    "group": "residential",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "legacy": True,  # its ZIP fields come from the legacy builder, not the plugin merge
    "fields": {
        "safmr_2br": {"label": "Small area fair market rent, 2 bedrooms", "unit": "usd_month", "agg": "none"},
    },
}

load = loader("hud_safmr")
