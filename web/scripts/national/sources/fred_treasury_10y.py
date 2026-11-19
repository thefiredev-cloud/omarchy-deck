"""10-year Treasury constant maturity yield from FRED (series DGS10, daily). Level "us"; feeds the cap-rate spread."""
import _fred

SERIES = "DGS10"
HIST_MONTHS = 60

SOURCE = {
    "id": "fred_treasury_10y",
    "name": "10-year Treasury constant maturity yield",
    "publisher": "Board of Governors of the Federal Reserve System, via FRED",
    "homepage": "https://fred.stlouisfed.org/series/DGS10",
    "level": "us",
    "native": "us",
    "group": "cost",
    "cadence": "daily",
    "license": "FRED terms of use; Federal Reserve H.15 release, public",
    "key_env": None,
    "fields": {
        "fred_treasury_10y": {"label": "10-year Treasury yield", "unit": "pct", "agg": "none", "metric": "cap_spread"},
    },
}


def parse(path, hist_months=HIST_MONTHS):
    """-> (date, value, monthly history). Value is the last day with an observation; history is month-end values."""
    points = _fred.read_points(path, SERIES)
    return points[-1][0], points[-1][1], _fred.monthly_last(points)[-hist_months:]


def load(ctx):
    path, _ = ctx.fetch(_fred.URL % SERIES, SERIES + ".csv", timeout=60)
    date, value, hist = parse(path)
    return {"as_of": date, "rows": len(hist), "data": {"US": {"fred_treasury_10y": value}},
            "hist": {"US": {"fred_treasury_10y": hist}}}
