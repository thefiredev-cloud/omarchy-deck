"""FHFA House Price Index by three-digit ZIP, quarterly (developmental index, not seasonally adjusted). Level "zip".

The workbook (3 MB xlsx, about 111,000 rows, 1995 Q1 to the latest quarter) has one series per three-digit ZIP. Where a
three-digit area has too few repeat sales FHFA reports the index of its metro area or the state balance instead; the
`fhfa_zip3_native` flag says which. Each ZIP3 value is copied to every ZIP that starts with those three digits (native
geography zip3), using the ZCTA list the context already holds.
"""
import time
import zipfile

import _xlsx
from ctx import SourceUnavailable, num

URL = "https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_at_3zip.xlsx"
MIN_ZIP3 = 400  # about 880 three-digit areas
HIST_QUARTERS = 40
BASE = (2022, 3)  # the roll-forward base the planner named for ACS and appraisal levels

SOURCE = {
    "id": "fhfa_hpi_zip3",
    "name": "FHFA House Price Index by three-digit ZIP",
    "publisher": "Federal Housing Finance Agency",
    "homepage": "https://www.fhfa.gov/data/hpi/datasets",
    "level": "zip",
    "native": "zip3",
    "group": "residential",
    "cadence": "quarterly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "fhfa_zip3_hpi_1y": {"label": "Price index change, 1 year (3-digit ZIP)", "unit": "pct", "agg": "pop_weighted_mean",
                             "metric": "value_trend_1y"},
        "fhfa_zip3_hpi_5y": {"label": "Price index change, 5 years (3-digit ZIP)", "unit": "pct", "agg": "pop_weighted_mean",
                             "metric": "value_trend_5y"},
        "fhfa_zip3_index": {"label": "Price index level (3-digit ZIP)", "unit": "index", "agg": "none"},
        "fhfa_zip3_index_ratio": {"label": "Price index now versus mid-2022", "unit": "ratio", "agg": "none"},
        "fhfa_zip3_native": {"label": "Index is for this 3-digit ZIP, not its metro or state", "unit": "flag", "agg": "none"},
    },
}


def _quarter_end(year, quarter):
    return "%04d-%02d" % (year, quarter * 3)


def parse(path, hist_quarters=HIST_QUARTERS):
    """-> (data, hist, rows, as_of) keyed by 3-digit ZIP. as_of is the latest quarter, as YYYYQn."""
    series, kinds, rows, header = {}, {}, 0, None
    try:
        for raw in _xlsx.read_xlsx_rows(path):
            row = [c or "" for c in raw]  # the shared reader gives None for blank cells
            if header is None:
                if row and row[0].strip() == "Three-Digit ZIP Code":
                    header = [c.strip() for c in row]
                continue
            if len(row) < 4 or not row[0].strip().isdigit():
                continue
            rows += 1
            z3 = row[0].strip().zfill(3)
            try:
                year, quarter = int(float(row[1])), int(float(row[2]))
            except ValueError:
                continue
            idx = num(row[3])
            if idx is None or not 1 <= quarter <= 4:
                continue
            series.setdefault(z3, {})[(year, quarter)] = idx
            kinds[z3] = row[4].strip() if len(row) > 4 else ""
    except (KeyError, ValueError, zipfile.BadZipFile) as exc:
        raise SourceUnavailable("FHFA ZIP3 workbook could not be read (%s)" % exc)
    if header is None or header[:4] != ["Three-Digit ZIP Code", "Year", "Quarter", "Index (NSA)"]:
        raise SourceUnavailable("FHFA ZIP3 workbook header changed")
    latest = max((max(s) for s in series.values()), default=None)
    data, hist = {}, {}
    for z3, points in series.items():
        if latest not in points:
            continue
        now = points[latest]
        vals = {"fhfa_zip3_index": round(now, 2), "fhfa_zip3_native": 1 if kinds[z3].startswith("Native") else 0}
        for field, back in (("fhfa_zip3_hpi_1y", 4), ("fhfa_zip3_hpi_5y", 20)):
            y, q = latest[0], latest[1] - back
            while q < 1:
                y, q = y - 1, q + 4
            old = points.get((y, q))
            if old:
                vals[field] = round((now / old - 1) * 100, 2)
        if BASE in points:
            vals["fhfa_zip3_index_ratio"] = round(now / points[BASE], 3)
        data[z3] = vals
        ordered = sorted(points)[-hist_quarters:]
        hist[z3] = {"fhfa_zip3_index": [[_quarter_end(*k), round(points[k], 2)] for k in ordered]}
    if len(data) < MIN_ZIP3:
        raise SourceUnavailable("FHFA ZIP3 workbook parsed to %d three-digit areas (expected about 880)" % len(data))
    return data, hist, rows, "%dQ%d" % latest


def broadcast(zips, data, hist):
    """Copy each ZIP3 record to every ZIP in `zips` that starts with it."""
    out, out_hist = {}, {}
    for z in zips:
        rec = data.get(z[:3])
        if rec is not None:
            out[z] = dict(rec)
            if z[:3] in hist:
                out_hist[z] = hist[z[:3]]
    return out, out_hist


def load(ctx):
    path, meta = ctx.fetch(URL, "hpi_at_3zip.xlsx", timeout=120, min_bytes=10000)
    t0 = time.time()
    data, hist, rows, as_of = parse(path)
    ctx.log("%d rows, %d three-digit ZIPs in %.0fs (%s)" % (rows, len(data), time.time() - t0, meta.get("status")))
    zips = sorted(ctx.zip_points())
    out, out_hist = broadcast(zips, data, hist)
    if len(out) < 0.8 * len(zips):
        raise SourceUnavailable("only %d of %d ZIPs fall under a three-digit area with an index" % (len(out), len(zips)))
    return {"as_of": as_of, "rows": rows, "data": out, "hist": out_hist,
            "note": "Developmental index by three-digit ZIP; where sales are thin FHFA substitutes the metro or state index."}
