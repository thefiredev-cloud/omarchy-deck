"""Shared reader for FRED graph CSVs (family helper; the runner skips files that start with an underscore).

https://fred.stlouisfed.org/graph/fredgraph.csv?id=<SERIES> is keyless; ctx sends the curl User-Agent FRED answers.
The file is `observation_date,<SERIES>` with an empty value for days without an observation.
"""
import csv

from ctx import SourceUnavailable, num

URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=%s"


def read_points(path, series):
    """All observations with a value, oldest first: [[date, value], ...]. Raises SourceUnavailable when none."""
    points = []
    with open(path, newline="", encoding="utf8") as fh:
        reader = csv.reader(fh)
        head = next(reader, None)
        if not head or len(head) < 2 or head[1].strip() != series:
            raise SourceUnavailable("FRED CSV for %s has an unexpected header" % series)
        for row in reader:
            if len(row) >= 2 and row[0][:4].isdigit() and num(row[1]) is not None:
                points.append([row[0], num(row[1])])
    if not points:
        raise SourceUnavailable("FRED CSV for %s had no observations" % series)
    return points


def monthly_last(points):
    """Daily or weekly points -> the last observation of each month, as [[YYYY-MM, value], ...]."""
    out = {}
    for date, value in points:
        out[date[:7]] = value
    return [[m, out[m]] for m in sorted(out)]
