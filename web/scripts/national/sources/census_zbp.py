"""Legacy national source census_zbp, wrapped as a plugin (DataArch section 3). Loader in _legacy.py."""
from _legacy import loader

SOURCE = {
    "id": "census_zbp",
    "name": "Census ZIP Code Business Patterns, totals",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/programs-surveys/cbp.html",
    "level": "zip",
    "group": "commercial",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "legacy": True,  # its ZIP fields come from the legacy builder, not the plugin merge
    "fields": {
        "biz_estabs": {"label": "Business establishments", "unit": "count", "agg": "none"},
        "biz_emp": {"label": "Employees at local businesses", "unit": "count", "agg": "none"},
        "biz_pay_per_emp": {"label": "Annual payroll per employee", "unit": "usd", "agg": "none"},
        "biz_estabs_5y": {"label": "Establishment change, 5 years", "unit": "pct", "agg": "none"},
        "estabs_per_1k": {"label": "Establishments per 1,000 residents", "unit": "per_1k", "agg": "none"},
    },
}

load = loader("census_zbp")
