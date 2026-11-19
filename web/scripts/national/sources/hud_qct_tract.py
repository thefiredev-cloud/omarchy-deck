"""HUD Qualified Census Tracts (LIHTC basis boost areas). Level tract: 100 for a QCT, 0 for every other tract, so the core's tract to
ZIP mean is the share of the ZIP inside a QCT. Source tag: qct."""
import csv
import io
import re
import zipfile

import _tract_universe
from ctx import SourceUnavailable

SOURCE = {
    "id": "hud_qct_tract",
    "name": "HUD Qualified Census Tracts",
    "publisher": "HUD Office of Policy Development and Research",
    "homepage": "https://www.huduser.gov/portal/datasets/qct.html",
    "level": "tract",
    "tract_vintage": 2020,
    "group": "commercial",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "qct_share": {"label": "Share of the ZIP in a Qualified Census Tract", "unit": "pct", "agg": "pop_weighted_mean",
                      "metric": "incentives", "xwalk": "mean"},
    },
}
URL = "https://www.huduser.gov/portal/datasets/qct/QCT%dCSV.zip"


def parse(path, universe=None):
    """QCT zip -> (data, rows, as_of). `universe` (every tract GEOID) adds a 0 for each tract that is not a QCT."""
    with zipfile.ZipFile(path) as zf:
        name = next((n for n in zf.namelist() if n.lower().endswith(".csv")), None)
        if not name:
            raise SourceUnavailable("QCT zip has no CSV")
        with zf.open(name) as fh:
            reader = csv.DictReader(io.TextIOWrapper(fh, encoding="latin-1", newline=""))
            if "fips" not in (reader.fieldnames or ()):
                raise SourceUnavailable("QCT file has no fips column")
            qct = {row["fips"].strip().zfill(11) for row in reader if row["fips"].strip()}
    qct = {g for g in qct if re.fullmatch(r"\d{11}", g)}
    if not qct:
        raise SourceUnavailable("QCT file had no tracts")
    data = {g: {"qct_share": 0} for g in (universe or ())}
    for g in qct:
        data[g] = {"qct_share": 100}
    match = re.search(r"QCT(\d{4})", path)
    return data, len(qct), match.group(1) if match else None


def load(ctx):
    url, path, _ = ctx.first([URL % y for y in (ctx.year + 1, ctx.year, ctx.year - 1)], "qct.zip", timeout=120)
    universe = _tract_universe.fetch_universe(ctx, 2020)
    data, rows, _ = parse(path, universe)
    if rows < 5000:
        raise SourceUnavailable("only %d QCT tracts" % rows)
    return {"as_of": re.search(r"QCT(\d{4})", url).group(1), "rows": rows, "data": data,
            "note": "Value is 100 for a Qualified Census Tract and 0 for every other tract."}
