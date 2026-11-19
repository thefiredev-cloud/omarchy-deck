"""Census Nonemployer Statistics by county: solo businesses (no payroll) per 1,000 residents. Source tag: nes. Level county."""
import csv
import io
import re
import zipfile

from ctx import SourceUnavailable, num

SOURCE = {
    "id": "census_nes",
    "name": "Census Nonemployer Statistics, solo businesses by county",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/programs-surveys/nonemployer-statistics.html",
    "level": "county",
    "group": "commercial",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "nes_firms": {"label": "Solo businesses with no payroll", "unit": "count", "agg": "sum"},
        "nes_firms_per_1k": {"label": "Solo businesses per 1,000 residents", "unit": "per_1k", "agg": "pop_weighted_mean",
                             "xwalk": "mean"},
        "nes_receipts_per_firm": {"label": "Average yearly receipts per solo business", "unit": "usd",
                                  "agg": "pop_weighted_mean", "xwalk": "mean"},
        "nes_realestate_share": {"label": "Real estate share of solo businesses", "unit": "pct", "agg": "pop_weighted_mean",
                                 "xwalk": "mean"},
        "nes_retail_share": {"label": "Retail share of solo businesses", "unit": "pct", "agg": "pop_weighted_mean",
                             "xwalk": "mean"},
    },
}
URL = "https://www2.census.gov/programs-surveys/nonemployer-statistics/datasets/%d/historical-datasets/nonemp%02dco.zip"
POP_URL = "https://www2.census.gov/programs-surveys/popest/datasets/2020-%d/counties/totals/co-est%d-alldata.csv"


def _open_text(path):
    if zipfile.is_zipfile(path):
        zf = zipfile.ZipFile(path)
        name = next((n for n in zf.namelist() if n.lower().endswith((".txt", ".csv"))), None)
        if not name:
            raise SourceUnavailable("nonemployer zip had no data file")
        return io.TextIOWrapper(zf.open(name), encoding="latin-1", newline="")
    return open(path, encoding="latin-1", newline="")


def parse_population(path, year):
    """{county FIPS: residents} for `year` from the Census county population estimates (latest column when `year` is absent)."""
    with open(path, encoding="latin-1", newline="") as fh:
        reader = csv.DictReader(fh)
        cols = [c for c in (reader.fieldnames or ()) if re.fullmatch(r"POPESTIMATE\d{4}", c)]
        if not cols:
            raise SourceUnavailable("population file has no POPESTIMATE columns")
        col = "POPESTIMATE%d" % year if "POPESTIMATE%d" % year in cols else sorted(cols)[-1]
        out = {}
        for row in reader:
            if row.get("SUMLEV") != "050":
                continue
            pop = num(row.get(col))
            if pop:
                out[row["STATE"].zfill(2) + row["COUNTY"].zfill(3)] = pop
    return out


def parse(path, population=None):
    """-> (data, rows, as_of). `population` ({county FIPS: residents}) adds the per-1,000 rate."""
    raw, rows = {}, 0
    with _open_text(path) as fh:
        reader = csv.DictReader(fh)
        if not {"ST", "CTY", "NAICS", "ESTAB", "RCPTOT"} <= set(reader.fieldnames or ()):
            raise SourceUnavailable("nonemployer header changed")
        for row in reader:
            rows += 1
            naics = row["NAICS"].strip()
            if naics not in ("00", "53", "44-45") or row["CTY"].strip() == "999":
                continue
            fips = row["ST"].strip().zfill(2) + row["CTY"].strip().zfill(3)
            firms = None if row.get("ESTAB_F", "").strip() else num(row["ESTAB"])
            receipts = None if row.get("RCPTOT_F", "").strip() else num(row["RCPTOT"])
            raw.setdefault(fips, {})[naics] = (firms, receipts)
    data = {}
    for fips, by in raw.items():
        total = by.get("00")
        if not total or total[0] is None:
            continue
        firms, receipts = total
        out = {"nes_firms": int(firms),
               "nes_firms_per_1k": None,
               "nes_receipts_per_firm": round(receipts * 1000.0 / firms) if receipts is not None and firms else None}
        if population and population.get(fips):
            out["nes_firms_per_1k"] = round(firms * 1000.0 / population[fips], 1)
        for field, code in (("nes_realestate_share", "53"), ("nes_retail_share", "44-45")):
            part = by.get(code, (0, None))  # no row: the county has no solo businesses in that sector
            out[field] = round(100.0 * part[0] / firms, 1) if part[0] is not None and firms else None
        data[fips] = out
    if not data:
        raise SourceUnavailable("nonemployer file had no usable rows")
    match = re.search(r"nonemp(\d\d)co", path.lower())
    return data, rows, ("20" + match.group(1)) if match else None


def load(ctx):
    years = [ctx.year - k for k in range(0, 4)]
    url, path, _ = ctx.first([URL % (y, y % 100) for y in years], "nonemp_county.zip", timeout=300)
    year = int(re.search(r"/(\d{4})/", url).group(1))
    _, pop_path, _ = ctx.first([POP_URL % (y, y) for y in (ctx.year, ctx.year - 1, ctx.year - 2)], "co-est-alldata.csv")
    data, rows, _ = parse(path, parse_population(pop_path, year))
    if len(data) < 3000:
        raise SourceUnavailable("nonemployer file covered only %d counties" % len(data))
    return {"as_of": str(year), "rows": rows, "data": data}
