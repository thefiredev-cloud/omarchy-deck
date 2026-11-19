"""Delinquency rate on commercial real estate loans (excluding farmland), all U.S. commercial banks, from FRED
(series DRCRELEXFACBS, quarterly, seasonally adjusted). Level "us"."""
import _fred

SERIES = "DRCRELEXFACBS"
HIST_POINTS = 72

SOURCE = {
    "id": "fred_cre_delinquency",
    "name": "Commercial real estate loan delinquency rate, US banks",
    "publisher": "Board of Governors of the Federal Reserve System, via FRED",
    "homepage": "https://fred.stlouisfed.org/series/DRCRELEXFACBS",
    "level": "us",
    "native": "us",
    "group": "commercial",
    "cadence": "quarterly",
    "license": "FRED terms of use; Federal Reserve charge-off and delinquency rates, public",
    "key_env": None,
    "fields": {
        "fred_cre_delinquency": {"label": "Commercial real estate loan delinquency rate (US banks)", "unit": "pct",
                                 "agg": "none", "metric": "cre_market", "better": "lower"},
    },
}


def parse(path, hist_points=HIST_POINTS):
    """-> (date, value, history)."""
    points = _fred.read_points(path, SERIES)
    return points[-1][0], points[-1][1], points[-hist_points:]


def load(ctx):
    path, _ = ctx.fetch(_fred.URL % SERIES, SERIES + ".csv", timeout=60)
    date, value, hist = parse(path)
    return {"as_of": date, "rows": len(hist), "data": {"US": {"fred_cre_delinquency": value}},
            "hist": {"US": {"fred_cre_delinquency": hist}}}
