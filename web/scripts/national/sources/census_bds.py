"""Census Business Dynamics Statistics by county: how fast establishments open, close and add jobs. Source tag: bds. Level county."""
import csv

from ctx import SourceUnavailable, num

SOURCE = {
    "id": "census_bds",
    "name": "Census Business Dynamics Statistics, county churn",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/programs-surveys/bds.html",
    "level": "county",
    "group": "commercial",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "bds_estab_entry_rate": {"label": "Establishments opened in the year", "unit": "pct", "agg": "pop_weighted_mean",
                                 "xwalk": "mean"},
        "bds_estab_exit_rate": {"label": "Establishments closed in the year", "unit": "pct", "agg": "pop_weighted_mean",
                                "xwalk": "mean"},
        "bds_net_entry_pts": {"label": "Openings minus closings", "unit": "pct_pts", "agg": "pop_weighted_mean",
                              "xwalk": "mean", "better": "higher"},
        "bds_job_creation_rate": {"label": "Job creation rate", "unit": "pct", "agg": "pop_weighted_mean", "xwalk": "mean"},
        "bds_job_destruction_rate": {"label": "Job destruction rate", "unit": "pct", "agg": "pop_weighted_mean",
                                     "xwalk": "mean"},
        "bds_estabs": {"label": "Establishments in county", "unit": "count", "agg": "sum"},
    },
}
URL = "https://www2.census.gov/programs-surveys/bds/tables/time-series/%d/bds%d_st_cty.csv"
HIST_YEARS = 15


def parse(path):
    """-> (data, rows, as_of, hist). Latest year per county plus entry and exit rate history."""
    latest, series, rows, newest = {}, {}, 0, 0
    with open(path, newline="", encoding="latin-1") as fh:
        reader = csv.DictReader(fh)
        need = {"year", "st", "cty", "estabs", "estabs_entry_rate", "estabs_exit_rate", "job_creation_rate",
                "job_destruction_rate"}
        if not need <= set(reader.fieldnames or ()):
            raise SourceUnavailable("BDS county header changed")
        for row in reader:
            rows += 1
            year = int(num(row["year"]) or 0)
            if not year:
                continue
            fips = row["st"].strip().zfill(2) + row["cty"].strip().zfill(3)
            entry, exit_ = num(row["estabs_entry_rate"]), num(row["estabs_exit_rate"])
            if year >= latest.get(fips, (0,))[0]:
                latest[fips] = (year, row)
            newest = max(newest, year)
            hist = series.setdefault(fips, {"bds_estab_entry_rate": [], "bds_estab_exit_rate": []})
            if entry is not None:
                hist["bds_estab_entry_rate"].append((year, entry))
            if exit_ is not None:
                hist["bds_estab_exit_rate"].append((year, exit_))
    data, hist_out = {}, {}
    for fips, (year, row) in latest.items():
        if year < newest - 1:  # the county stopped reporting; do not present a stale year as current
            continue
        entry, exit_ = num(row["estabs_entry_rate"]), num(row["estabs_exit_rate"])
        data[fips] = {
            "bds_estab_entry_rate": entry,
            "bds_estab_exit_rate": exit_,
            "bds_net_entry_pts": round(entry - exit_, 3) if entry is not None and exit_ is not None else None,
            "bds_job_creation_rate": num(row["job_creation_rate"]),
            "bds_job_destruction_rate": num(row["job_destruction_rate"]),
            "bds_estabs": int(num(row["estabs"])) if num(row["estabs"]) is not None else None,
        }
        hist_out[fips] = {field: [[str(y), v] for y, v in sorted(points)[-HIST_YEARS:]]
                          for field, points in series[fips].items() if points}
    if not data:
        raise SourceUnavailable("BDS county file had no usable rows")
    return data, rows, str(newest), hist_out


def load(ctx):
    years = [ctx.year - k for k in range(0, 4)]
    _, path, _ = ctx.first([URL % (y, y) for y in years], "bds_st_cty.csv", timeout=300)
    data, rows, as_of, hist = parse(path)
    if len(data) < 3000:
        raise SourceUnavailable("BDS covered only %d counties" % len(data))
    return {"as_of": as_of, "rows": rows, "data": data, "hist": hist}
