"""Census County Business Patterns: employment mix and wages by county. Backs up ZIP business data where the ZIP file withholds cells.
Source tag: cbpc. Level county; the core spreads the rates to ZIPs."""
import csv
import io
import re
import zipfile

from ctx import SourceUnavailable, num

SOURCE = {
    "id": "census_cbp_county",
    "name": "Census County Business Patterns, employment by use group",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/programs-surveys/cbp.html",
    "level": "county",
    "group": "commercial",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "cbpc_emp_total": {"label": "Jobs in county businesses", "unit": "count", "agg": "sum"},
        "cbpc_estabs_total": {"label": "Business establishments in county", "unit": "count", "agg": "sum"},
        "cbpc_pay_per_emp": {"label": "Average annual pay per job", "unit": "usd", "agg": "pop_weighted_mean", "xwalk": "mean"},
        "cbpc_emp_per_estab": {"label": "Jobs per establishment", "unit": "ratio", "agg": "pop_weighted_mean", "xwalk": "mean"},
        "cbpc_retail_job_share": {"label": "Retail share of jobs", "unit": "pct", "agg": "pop_weighted_mean", "xwalk": "mean"},
        "cbpc_office_job_share": {"label": "Office-using share of jobs", "unit": "pct", "agg": "pop_weighted_mean", "xwalk": "mean"},
        "cbpc_industrial_job_share": {"label": "Industrial and logistics share of jobs", "unit": "pct",
                                      "agg": "pop_weighted_mean", "xwalk": "mean"},
        "cbpc_hotel_food_job_share": {"label": "Hotel and restaurant share of jobs", "unit": "pct",
                                      "agg": "pop_weighted_mean", "xwalk": "mean"},
        "cbpc_health_job_share": {"label": "Health care share of jobs", "unit": "pct", "agg": "pop_weighted_mean", "xwalk": "mean"},
        "cbpc_office_pay_per_emp": {"label": "Average annual pay in office-using jobs", "unit": "usd",
                                    "agg": "pop_weighted_mean", "xwalk": "mean"},
    },
}
URL = "https://www2.census.gov/programs-surveys/cbp/datasets/%d/cbp%02dco.zip"

# NAICS as the file writes it (44 holds 44-45, 31 holds 31-33, 48 holds 48-49).
SHARES = {
    "cbpc_retail_job_share": ("44----",),
    "cbpc_office_job_share": ("51----", "52----", "53----", "54----", "55----", "56----"),
    "cbpc_industrial_job_share": ("31----", "42----", "48----"),
    "cbpc_hotel_food_job_share": ("721///", "722///"),
    "cbpc_health_job_share": ("62----",),
}
WANT = {"------"} | {c for codes in SHARES.values() for c in codes}
WITHHELD = ("D", "S", "N", "X")


def _open_text(path):
    if zipfile.is_zipfile(path):
        zf = zipfile.ZipFile(path)
        name = next((n for n in zf.namelist() if n.lower().endswith((".txt", ".csv"))), None)
        if not name:
            raise SourceUnavailable("CBP zip had no data file")
        return io.TextIOWrapper(zf.open(name), encoding="latin-1", newline="")
    return open(path, encoding="latin-1", newline="")


def _value(row, col):
    """A cell is a number unless its flag column says withheld."""
    if (row.get(col + "_nf") or "").strip() in WITHHELD:
        return None
    return num(row.get(col))


def parse(path):
    """-> (data, rows, as_of). data[county FIPS] holds employment mix and pay."""
    raw, rows = {}, 0
    with _open_text(path) as fh:
        reader = csv.DictReader(fh)
        if not {"fipstate", "fipscty", "naics", "emp", "ap", "est"} <= set(reader.fieldnames or ()):
            raise SourceUnavailable("CBP county header changed")
        for row in reader:
            rows += 1
            naics = row["naics"].strip()
            if naics not in WANT:
                continue
            fips = row["fipstate"].strip().zfill(2) + row["fipscty"].strip().zfill(3)
            if row["fipscty"].strip() == "999":  # statewide unallocated
                continue
            raw.setdefault(fips, {})[naics] = (_value(row, "emp"), _value(row, "ap"), num(row["est"]))
    data = {}
    for fips, by in raw.items():
        total = by.get("------")
        if not total:
            continue
        emp, ap, est = total
        out = {"cbpc_emp_total": int(emp) if emp is not None else None,
               "cbpc_estabs_total": int(est) if est is not None else None,
               "cbpc_pay_per_emp": round(ap * 1000.0 / emp) if emp and ap is not None else None,
               "cbpc_emp_per_estab": round(emp / est, 2) if emp is not None and est else None}
        for field, codes in SHARES.items():
            parts = [by.get(c, (0, 0, 0)) for c in codes]  # no row means the county has no such establishments
            if emp and all(p[0] is not None for p in parts):
                out[field] = round(100.0 * sum(p[0] for p in parts) / emp, 1)
            else:
                out[field] = None
        office = [by.get(c, (0, 0, 0)) for c in SHARES["cbpc_office_job_share"]]
        if all(p[0] is not None and p[1] is not None for p in office) and sum(p[0] for p in office):
            out["cbpc_office_pay_per_emp"] = round(sum(p[1] for p in office) * 1000.0 / sum(p[0] for p in office))
        else:
            out["cbpc_office_pay_per_emp"] = None
        data[fips] = out
    if not data:
        raise SourceUnavailable("CBP county file had no usable rows")
    match = re.search(r"cbp(\d\d)co", path.lower())
    return data, rows, ("20" + match.group(1)) if match else None


def load(ctx):
    years = [ctx.year - k for k in range(0, 4)]
    url, path, _ = ctx.first([URL % (y, y % 100) for y in years], "cbp_county.zip", timeout=300)
    data, rows, _ = parse(path)
    if len(data) < 3000:
        raise SourceUnavailable("CBP county file covered only %d counties" % len(data))
    return {"as_of": re.search(r"/(\d{4})/", url).group(1), "rows": rows, "data": data}
