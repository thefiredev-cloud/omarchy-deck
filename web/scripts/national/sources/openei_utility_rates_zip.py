"""NREL / OpenEI US electric utility companies and rates by ZIP (2023, built on EIA-861). Level "zip".

Two small CSVs: investor-owned utilities and everyone else (cooperatives, municipal, federal, political subdivisions). One row per
ZIP per utility per service type. Only Bundled rows (generation plus delivery, the full retail price) are averaged; Delivery and
Energy rows are components of a price and would pull the mean down. A rate of 0 means the utility has no customers of that class
in the ZIP, so it counts as missing. A ZIP served by several utilities gets the plain mean over them.
"""
import csv
import time

from ctx import SourceUnavailable, num, zfill_zip

BASE = "https://data.openei.org/files/6225/"
FILES = ("iou_zipcodes_2023.csv", "non_iou_zipcodes_2023.csv")
MIN_ZIPS = 20000  # about 39,000 ZIPs

SOURCE = {
    "id": "openei_utility_rates_zip",
    "name": "NREL OpenEI utility electricity rates by ZIP",
    "publisher": "National Renewable Energy Laboratory, OpenEI",
    "homepage": "https://data.openei.org/submissions/6225",
    "level": "zip",
    "native": "zip",
    "group": "cost",
    "cadence": "annual",
    "license": "CC BY 4.0 (OpenEI data submission); built on public EIA-861 data",
    "key_env": None,
    "fields": {
        "openei_res_cents": {"label": "Residential electricity rate", "unit": "kwh_cents", "agg": "pop_weighted_mean",
                             "better": "lower"},
        "openei_com_cents": {"label": "Commercial electricity rate", "unit": "kwh_cents", "agg": "pop_weighted_mean",
                             "metric": "power_cost", "better": "lower"},
        "openei_ind_cents": {"label": "Industrial electricity rate", "unit": "kwh_cents", "agg": "pop_weighted_mean",
                             "better": "lower"},
        "openei_utilities": {"label": "Electric utilities serving the ZIP", "unit": "count", "agg": "none"},
    },
}
RATES = {"openei_res_cents": "res_rate", "openei_com_cents": "comm_rate", "openei_ind_cents": "ind_rate"}


def parse(paths):
    """List of CSV paths -> (data, rows, as_of). as_of is the data year in the file name."""
    seen = {}  # zip -> {eiaid: {field: cents}}
    rows = 0
    for path in paths:
        with open(path, newline="", encoding="utf8", errors="replace") as fh:
            reader = csv.reader(fh)
            head = [h.strip().lower() for h in next(reader, [])]
            need = ["zip", "eiaid", "service_type"] + list(RATES.values())
            missing = [c for c in need if c not in head]
            if missing:
                raise SourceUnavailable("OpenEI utility rates header changed: %s missing" % ", ".join(missing))
            i = {c: head.index(c) for c in need}
            for row in reader:
                if len(row) <= max(i.values()):
                    continue
                rows += 1
                if row[i["service_type"]].strip() != "Bundled":
                    continue
                zip5 = zfill_zip(row[i["zip"]])
                if not zip5:
                    continue
                rec = {}
                for field, col in RATES.items():
                    val = num(row[i[col]])
                    if val:  # 0 and blank both mean the utility has no such customers here
                        rec[field] = val * 100
                seen.setdefault(zip5, {})[row[i["eiaid"]]] = rec
    data = {}
    for zip5, utilities in seen.items():
        out = {"openei_utilities": len(utilities)}
        for field in RATES:
            vals = [u[field] for u in utilities.values() if field in u]
            if vals:
                out[field] = round(sum(vals) / len(vals), 2)
        data[zip5] = out
    if len(data) < MIN_ZIPS:
        raise SourceUnavailable("OpenEI utility rates parsed to %d ZIPs (expected about 39,000)" % len(data))
    return data, rows, "2023"


def load(ctx):
    paths = []
    for name in FILES:
        path, meta = ctx.fetch(BASE + name, name, timeout=120, min_bytes=100000)
        paths.append(path)
        ctx.log("%s %s" % (name, meta.get("status")))
    t0 = time.time()
    data, rows, as_of = parse(paths)
    ctx.log("%d rows, %d ZIPs in %.0fs" % (rows, len(data), time.time() - t0))
    return {"as_of": as_of, "rows": rows, "data": data,
            "note": "Mean of the bundled rates of every utility listed for the ZIP; utilities with no customers of a class are skipped."}
