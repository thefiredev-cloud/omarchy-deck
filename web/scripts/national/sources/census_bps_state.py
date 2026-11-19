"""Census Building Permits Survey by state, trailing 12 months of monthly files. Level "state".

Each monthly file (st{YY}{MM}c.txt, about 8 KB) lists permitted buildings, units and value (stated in thousands of dollars,
converted to dollars here) for 1-unit, 2-unit, 3-4 unit and 5+ unit structures: 50 states and DC, plus national, region and
division rows that are skipped. Estimates include imputation for permit offices that did not report.
"""
import _bps

MIN_STATES = 45  # 50 states and DC

SOURCE = {
    "id": "census_bps_state",
    "name": "Census Building Permits Survey by state",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/construction/bps/statemonthly.html",
    "level": "state",
    "group": "residential",
    "cadence": "monthly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "bpst_units_12m": {"label": "State housing units permitted, last 12 months", "unit": "count", "agg": "sum"},
        "bpst_units_1_12m": {"label": "State units in 1-unit buildings permitted, last 12 months", "unit": "count", "agg": "sum"},
        "bpst_units_2_4_12m": {"label": "State units in 2 to 4 unit buildings permitted, last 12 months", "unit": "count",
                               "agg": "sum"},
        "bpst_units_5plus_12m": {"label": "State units in 5+ unit buildings permitted, last 12 months", "unit": "count",
                                 "agg": "sum"},
        "bpst_units_5plus_yoy": {"label": "State 5+ unit permits, change vs the 12 months before", "unit": "pct", "agg": "none"},
        "bpst_buildings_5plus_12m": {"label": "State 5+ unit buildings permitted, last 12 months", "unit": "count", "agg": "sum"},
        "bpst_value_5plus_12m": {"label": "State value of permitted 5+ unit buildings, last 12 months", "unit": "usd",
                                 "agg": "sum"},
        "bpst_units_5plus_month": {"label": "State units in 5+ unit buildings permitted, newest month", "unit": "count",
                                   "agg": "sum"},
    },
}


def parse(path):
    """One monthly state file -> ({USPS code: {u1, u24, u5, b5, v5}}, 'YYYY-MM'); states and DC only."""
    return _bps.parse(path, "state")


def load(ctx):
    return _bps.run(ctx, "state", "bpst_", MIN_STATES, "states")
