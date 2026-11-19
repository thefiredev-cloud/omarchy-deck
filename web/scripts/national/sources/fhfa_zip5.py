"""Legacy national source fhfa_zip5, wrapped as a plugin (DataArch section 3). Loader in _legacy.py."""
from _legacy import loader

SOURCE = {
    "id": "fhfa_zip5",
    "name": "FHFA House Price Index, five-digit ZIP, annual",
    "publisher": "Federal Housing Finance Agency",
    "homepage": "https://www.fhfa.gov/data/hpi/datasets",
    "level": "zip",
    "group": "residential",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "legacy": True,  # its ZIP fields come from the legacy builder, not the plugin merge
    "fields": {
        "fhfa_hpi_5y": {"label": "Repeat-sales price change, 5 years (ZIP)", "unit": "pct", "agg": "none"},
    },
}

load = loader("fhfa_zip5")
