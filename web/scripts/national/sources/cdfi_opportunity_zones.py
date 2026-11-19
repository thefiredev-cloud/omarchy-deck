"""Treasury CDFI Fund designated Qualified Opportunity Zones (2010 tracts). Level tract: 100 for a designated tract, 0 for every other
tract, so the core's tract to ZIP mean is the share of the ZIP inside a zone. Source tag: oz."""
import re

import _tract_universe
import _xlsx
from ctx import SourceUnavailable

SOURCE = {
    "id": "cdfi_opportunity_zones",
    "name": "Qualified Opportunity Zones",
    "publisher": "US Treasury CDFI Fund",
    "homepage": "https://www.cdfifund.gov/opportunity-zones",
    "level": "tract",
    "tract_vintage": 2010,
    "group": "commercial",
    "cadence": "static",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "oz_share": {"label": "Share of the ZIP in an Opportunity Zone", "unit": "pct", "agg": "pop_weighted_mean",
                     "metric": "incentives", "xwalk": "mean"},
    },
}
URL = "https://www.cdfifund.gov/sites/cdfi/files/documents/designated-qozs.12.14.18.xlsx"


def parse(path, universe=None):
    """Designation workbook -> (data, rows, as_of). `universe` (every 2010 tract GEOID) adds a 0 for each tract that is not a zone."""
    zones, head, as_of = set(), None, None
    for row in _xlsx.read_xlsx_rows(path):
        text = " ".join(c for c in row if c)
        if head is None:
            match = re.search(r"updated ([A-Z][a-z]+ \d{1,2}, \d{4})", text)
            if match:
                as_of = match.group(1)
            if any(c and "Census Tract Number" in c for c in row):
                head = next(i for i, c in enumerate(row) if c and "Census Tract Number" in c)
            continue
        if len(row) > head and row[head] and re.fullmatch(r"\d{11}", row[head].strip()):
            zones.add(row[head].strip())
    if not zones:
        raise SourceUnavailable("Opportunity Zone workbook had no tracts")
    data = {g: {"oz_share": 0} for g in (universe or ())}
    for g in zones:
        data[g] = {"oz_share": 100}
    return data, len(zones), _iso(as_of)


def _iso(text):
    import datetime
    try:
        return datetime.datetime.strptime(text, "%B %d, %Y").date().isoformat()
    except (TypeError, ValueError):
        return text


def load(ctx):
    path, _ = ctx.fetch(URL, "designated-qozs.xlsx", timeout=120)
    universe = _tract_universe.fetch_universe(ctx, 2010)
    data, rows, as_of = parse(path, universe)
    if rows < 8000:
        raise SourceUnavailable("only %d Opportunity Zone tracts" % rows)
    return {"as_of": as_of or "2018-12-14", "rows": rows, "data": data,
            "note": "Designations were set in 2018 on 2010 census tracts and do not change. Value is 100 inside a zone, 0 elsewhere."}
