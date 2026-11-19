"""Census Business Formation Statistics, annual county business applications. Source tag: bfs. Level county.
Reads the xlsx with the shared stdlib reader _xlsx."""
import re

import _xlsx
from ctx import SourceUnavailable, num

SOURCE = {
    "id": "census_bfs_county",
    "name": "Census Business Formation Statistics, business applications by county",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/econ/bfs/index.html",
    "level": "county",
    "group": "commercial",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "bfs_apps": {"label": "Business applications in the year", "unit": "count", "agg": "sum"},
        "bfs_apps_per_1k": {"label": "Business applications per 1,000 residents", "unit": "per_1k",
                            "agg": "pop_weighted_mean", "xwalk": "mean"},
        "bfs_apps_yoy": {"label": "Business applications, change from last year", "unit": "pct",
                         "agg": "pop_weighted_mean", "xwalk": "mean", "better": "higher"},
        "bfs_apps_5y": {"label": "Business applications, change over 5 years", "unit": "pct",
                        "agg": "pop_weighted_mean", "xwalk": "mean", "better": "higher"},
    },
}
URL = "https://www.census.gov/econ/bfs/xlsx/bfs_county_apps_annual.xlsx"
POP_URL = "https://www2.census.gov/programs-surveys/popest/datasets/2020-%d/counties/totals/co-est%d-alldata.csv"


def parse_population(path, year):
    """{county FIPS: residents} from the Census county population estimates, latest column when `year` is absent."""
    import csv
    with open(path, encoding="latin-1", newline="") as fh:
        reader = csv.DictReader(fh)
        cols = [c for c in (reader.fieldnames or ()) if re.fullmatch(r"POPESTIMATE\d{4}", c)]
        if not cols:
            raise SourceUnavailable("population file has no POPESTIMATE columns")
        col = "POPESTIMATE%d" % year if "POPESTIMATE%d" % year in cols else sorted(cols)[-1]
        out = {}
        for row in reader:
            pop = num(row.get(col)) if row.get("SUMLEV") == "050" else None
            if pop:
                out[row["STATE"].zfill(2) + row["COUNTY"].zfill(3)] = pop
    return out


def parse(path, population_for=None):
    """-> (data, rows, as_of, hist). `population_for(year)` returns {county FIPS: residents} and adds the per-1,000 rate."""
    head, years, data, hist, rows, population = None, [], {}, {}, 0, None
    for cells in _xlsx.read_xlsx_rows(path):
        if head is None:
            if cells and "county_fips" in cells:
                head = cells
                years = sorted((int(c[2:]), i) for i, c in enumerate(cells) if c and re.fullmatch(r"BA\d{4}", c))
                population = population_for(years[-1][0]) if population_for and years else None
            continue
        if len(cells) <= head.index("county_fips"):
            continue
        state, county = cells[head.index("state_fips")], cells[head.index("county_fips")]
        if not state or not county:
            continue
        rows += 1
        fips = state.strip().zfill(2) + county.strip().zfill(3)
        series = [(y, num(cells[i]) if i < len(cells) else None) for y, i in years]
        series = [(y, v) for y, v in series if v is not None]
        if not series:
            continue
        year, latest = series[-1]
        by_year = dict(series)
        out = {"bfs_apps": int(latest), "bfs_apps_per_1k": None, "bfs_apps_yoy": None, "bfs_apps_5y": None}
        if population and population.get(fips):
            out["bfs_apps_per_1k"] = round(latest * 1000.0 / population[fips], 2)
        prev = by_year.get(year - 1)
        if prev:
            out["bfs_apps_yoy"] = round(100.0 * (latest - prev) / prev, 1)
        old = by_year.get(year - 5)
        if old:
            out["bfs_apps_5y"] = round(100.0 * (latest - old) / old, 1)
        data[fips] = out
        hist[fips] = {"bfs_apps": [[str(y), int(v)] for y, v in series][-72:]}
    if head is None or not data:
        raise SourceUnavailable("BFS workbook had no county rows")
    return data, rows, str(years[-1][0]), hist


def load(ctx):
    path, _ = ctx.fetch(URL, "bfs_county_apps_annual.xlsx", timeout=120)

    def population_for(year):
        _, pop_path, _ = ctx.first([POP_URL % (y, y) for y in (ctx.year, ctx.year - 1, ctx.year - 2)], "co-est-alldata.csv")
        return parse_population(pop_path, year)

    data, rows, as_of, hist = parse(path, population_for)
    if len(data) < 3000:
        raise SourceUnavailable("BFS covered only %d counties" % len(data))
    return {"as_of": as_of, "rows": rows, "data": data, "hist": hist}
