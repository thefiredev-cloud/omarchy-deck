"""Commercial real estate prices for the United States from FRED (series COMREPUSQ159N, quarterly, percent change from a
year ago). Level "us"."""
import _fred

SERIES = "COMREPUSQ159N"
HIST_POINTS = 72

SOURCE = {
    "id": "fred_cre_price",
    "name": "Commercial real estate prices, change from a year ago",
    "publisher": "International Monetary Fund, via FRED",
    "homepage": "https://fred.stlouisfed.org/series/COMREPUSQ159N",
    "level": "us",
    "native": "us",
    "group": "commercial",
    "cadence": "quarterly",
    "license": "FRED terms of use; IMF data via FRED, see the series page for the IMF terms",
    "key_env": None,
    "fields": {
        "fred_cre_price_yoy": {"label": "Commercial real estate price change, 1 year (US)", "unit": "pct", "agg": "none",
                               "metric": "cre_market"},
    },
}


def parse(path, hist_points=HIST_POINTS):
    """-> (date, value, history). The series is already a percent change from the same quarter a year earlier."""
    points = _fred.read_points(path, SERIES)
    return points[-1][0], points[-1][1], points[-hist_points:]


def load(ctx):
    path, _ = ctx.fetch(_fred.URL % SERIES, SERIES + ".csv", timeout=60)
    date, value, hist = parse(path)
    return {"as_of": date, "rows": len(hist), "data": {"US": {"fred_cre_price_yoy": value}},
            "hist": {"US": {"fred_cre_price_yoy": hist}}}
