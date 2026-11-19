"""FHFA House Price Index by census tract, annual (developmental index). Level "tract".

One 90 MB CSV (about 2.2 million rows, 63,900 tracts, 1975 to the latest year). The tract ids are 2020 census tracts: 98.9% of
them are 2020 ids and none exists only as a 2010 id (checked against Census tab20_tract20_tract10_natl.txt), so the SOURCE
carries tract_vintage 2020. Keeps the newest year per tract: the published one-year change, the index level and the five-year
change computed from the index.
"""
import csv
import time

from ctx import SourceUnavailable, num

URL = "https://www.fhfa.gov/hpi/download/annually/hpi_at_tract.csv"
MIN_TRACTS = 20000  # about 63,900 tracts

SOURCE = {
    "id": "fhfa_hpi_tract",
    "name": "FHFA House Price Index by census tract",
    "publisher": "Federal Housing Finance Agency",
    "homepage": "https://www.fhfa.gov/data/hpi/datasets",
    "level": "tract",
    "native": "tract",
    "tract_vintage": 2020,
    "group": "residential",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "fhfa_tract_hpi_1y": {"label": "Repeat-sales price change, 1 year (tract)", "unit": "pct",
                              "agg": "pop_weighted_mean", "metric": "value_trend_1y", "xwalk": "mean"},
        "fhfa_tract_hpi_5y": {"label": "Repeat-sales price change, 5 years (tract)", "unit": "pct",
                              "agg": "pop_weighted_mean", "metric": "value_trend_5y", "xwalk": "mean"},
        "fhfa_tract_hpi": {"label": "Price index level (tract)", "unit": "index",
                           "agg": "pop_weighted_mean", "xwalk": "mean"},
    },
}


def parse(path):
    """-> (data, rows, as_of). data[tract GEOID] for the newest year in the file; tracts with no row that year are left out."""
    with open(path, newline="", encoding="utf8") as fh:
        reader = csv.reader(fh)
        try:
            head = [h.strip().lower() for h in next(reader)]
        except StopIteration:
            raise SourceUnavailable("FHFA tract file is empty")
        missing = [c for c in ("tract", "year", "annual_change", "hpi") if c not in head]
        if missing:
            raise SourceUnavailable("FHFA tract header changed: %s missing" % ", ".join(missing))
        i_tract, i_year, i_chg, i_hpi = (head.index(c) for c in ("tract", "year", "annual_change", "hpi"))
        rows, latest = 0, 0
        by_tract = {}  # tract -> {year: (annual change, hpi)}
        for row in reader:
            if len(row) <= max(i_tract, i_year, i_chg, i_hpi):
                continue
            rows += 1
            tract = row[i_tract].strip()
            if len(tract) != 11 or not tract.isdigit() or not row[i_year].isdigit():
                continue
            year = int(row[i_year])
            latest = max(latest, year)
            by_tract.setdefault(tract, {})[year] = (num(row[i_chg]), num(row[i_hpi]))
    data = {}
    for tract, years in by_tract.items():
        if latest not in years:
            continue
        change, hpi = years[latest]
        out = {}
        if change is not None:
            out["fhfa_tract_hpi_1y"] = round(change, 2)
        if hpi is not None:
            out["fhfa_tract_hpi"] = round(hpi, 2)
            old = years.get(latest - 5, (None, None))[1]
            if old:
                out["fhfa_tract_hpi_5y"] = round((hpi / old - 1) * 100, 2)
        if out:
            data[tract] = out
    if len(data) < MIN_TRACTS:
        raise SourceUnavailable("FHFA tract file parsed to %d tracts for %s (expected about 63,900)" % (len(data), latest or "no year"))
    return data, rows, str(latest)


def load(ctx):
    path, meta = ctx.fetch(URL, "hpi_at_tract.csv", timeout=180, min_bytes=1 << 20)
    ctx.log("parsing %.0f MB (%s)" % (meta.get("bytes", 0) / 1e6, meta.get("status")))
    t0 = time.time()
    data, rows, as_of = parse(path)
    ctx.log("%d rows, %d tracts in %.0fs" % (rows, len(data), time.time() - t0))
    return {"as_of": as_of, "rows": rows, "data": data,
            "note": "FHFA calls this a developmental index. Tracts use 2020 boundaries and tracts with too few repeat sales are absent."}
