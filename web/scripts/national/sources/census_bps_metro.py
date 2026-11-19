"""Census Building Permits Survey by metropolitan area, trailing 12 months of monthly files. Level "cbsa".

From January 2024 the Census publishes one CBSA file per month (cbsa{YY}{MM}c.txt, about 90 KB) on the July 2023 OMB
delineation (Bulletin 23-01, 387 metropolitan areas). Micropolitan areas sit in the same file and are left out here.
Months before 2024 come from the older metro-only files (ma{YY}{MM}c.txt), which use the earlier delineation; they feed
only the monthly history, for areas whose CBSA code exists in both.
Value is stated in thousands of dollars by the Census and converted to dollars here.
"""
import _bps

MIN_METROS = 300  # 387 metropolitan areas in the 2023 delineation

SOURCE = {
    "id": "census_bps_metro",
    "name": "Census Building Permits Survey by metro area",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/construction/bps/msamonthly.html",
    "level": "cbsa",
    "group": "residential",
    "cadence": "monthly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "bpm_units_12m": {"label": "Metro housing units permitted, last 12 months", "unit": "count", "agg": "sum"},
        "bpm_units_1_12m": {"label": "Metro units in 1-unit buildings permitted, last 12 months", "unit": "count", "agg": "sum"},
        "bpm_units_2_4_12m": {"label": "Metro units in 2 to 4 unit buildings permitted, last 12 months", "unit": "count",
                              "agg": "sum"},
        "bpm_units_5plus_12m": {"label": "Metro units in 5+ unit buildings permitted, last 12 months", "unit": "count",
                                "agg": "sum"},
        "bpm_units_5plus_yoy": {"label": "Metro 5+ unit permits, change vs the 12 months before", "unit": "pct", "agg": "none"},
        "bpm_buildings_5plus_12m": {"label": "Metro 5+ unit buildings permitted, last 12 months", "unit": "count", "agg": "sum"},
        "bpm_value_5plus_12m": {"label": "Metro value of permitted 5+ unit buildings, last 12 months", "unit": "usd",
                                "agg": "sum"},
        "bpm_units_5plus_month": {"label": "Metro units in 5+ unit buildings permitted, newest month", "unit": "count",
                                  "agg": "sum"},
    },
}


def parse(path):
    """One monthly CBSA or metro file -> ({CBSA code: {u1, u24, u5, b5, v5}}, 'YYYY-MM'); metropolitan areas only."""
    return _bps.parse(path, "cbsa")


def load(ctx):
    return _bps.run(ctx, "cbsa", "bpm_", MIN_METROS, "metro areas",
                    " Metropolitan areas only, on the 2023 OMB delineation; history before 2024-01 comes from the Census "
                    "files that used the earlier delineation, so a few areas shift in level there.")
