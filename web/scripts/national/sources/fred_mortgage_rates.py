"""Example source: national mortgage rates from FRED (keyless graph CSV). Shows the plugin shape; level "us"."""
import csv

from ctx import SourceUnavailable, num

SOURCE = {
    "id": "fred_mortgage_rates",
    "name": "Freddie Mac Primary Mortgage Market Survey, 30-year and 15-year fixed",
    "publisher": "Federal Reserve Bank of St. Louis (FRED), Freddie Mac",
    "homepage": "https://fred.stlouisfed.org/series/MORTGAGE30US",
    "level": "us",
    "group": "cost",
    "cadence": "weekly",
    "license": "FRED terms of use; Freddie Mac PMMS, public release",
    "key_env": None,
    "fields": {
        "mortgage_30y": {"label": "30-year fixed mortgage rate", "unit": "pct", "agg": "none", "metric": "mortgage_rate"},
        "mortgage_15y": {"label": "15-year fixed mortgage rate", "unit": "pct", "agg": "none"},
    },
}
URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=%s"


def parse(path):
    """Last non-empty observation of a fredgraph CSV. -> (date, value, last 72 points)."""
    points = []
    with open(path, newline="", encoding="utf8") as fh:
        for row in csv.reader(fh):
            if len(row) >= 2 and num(row[1]) is not None and row[0][:4].isdigit():
                points.append([row[0], num(row[1])])
    if not points:
        raise SourceUnavailable("FRED CSV had no observations")
    return points[-1][0], points[-1][1], points[-72:]


def load(ctx):
    out, hist, as_of = {}, {}, None
    for field, series in (("mortgage_30y", "MORTGAGE30US"), ("mortgage_15y", "MORTGAGE15US")):
        path, _ = ctx.fetch(URL % series, series + ".csv", timeout=60)
        date, value, points = parse(path)
        out[field], hist[field], as_of = value, points, max(as_of or date, date)
    return {"as_of": as_of, "rows": 2, "data": {"US": out}, "hist": {"US": hist}}
