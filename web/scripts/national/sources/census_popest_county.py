"""Census Bureau Population Estimates Program, county totals (co-est<vintage>-alldata.csv). Level "county".
Population, one-year and since-2020 growth, natural change and domestic and international migration for the latest
estimate year. Rates are per 1,000 residents of the previous July 1."""
import csv
import re

from ctx import SourceUnavailable, num

SOURCE = {
    "id": "census_popest_county",
    "name": "Census population estimates by county: growth and migration",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/programs-surveys/popest.html",
    "level": "county",
    "group": "people",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "pep_pop": {"label": "Estimated population", "unit": "count", "agg": "sum"},
        "pep_pop_change_1y": {"label": "Population change, last year", "unit": "pct", "agg": "pop_weighted_mean",
                              "better": "higher", "xwalk": "assign", "metric": "pop_trend"},
        "pep_pop_change_since2020": {"label": "Population change since the 2020 census", "unit": "pct",
                                     "agg": "pop_weighted_mean", "better": "higher", "xwalk": "assign"},
        "pep_natural_per_1k": {"label": "Births minus deaths, per 1,000 residents", "unit": "per_1k", "agg": "pop_weighted_mean",
                               "xwalk": "assign"},
        "pep_domestic_mig": {"label": "Net moves from elsewhere in the US", "unit": "count", "agg": "sum"},
        "pep_domestic_mig_per_1k": {"label": "Net domestic migration, per 1,000 residents", "unit": "per_1k",
                                    "agg": "pop_weighted_mean", "better": "higher", "xwalk": "assign", "metric": "migration"},
        "pep_international_mig_per_1k": {"label": "Net international migration, per 1,000 residents", "unit": "per_1k",
                                         "agg": "pop_weighted_mean", "xwalk": "assign"},
    },
}

URLS = [
    "https://www2.census.gov/programs-surveys/popest/datasets/2020-2026/counties/totals/co-est2026-alldata.csv",
    "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/counties/totals/co-est2025-alldata.csv",
    "https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/counties/totals/co-est2024-alldata.csv",
]
MIN_COUNTIES = 2500  # about 3,144


def _per_1k(value, base):
    return None if value is None or not base else round(value / base * 1000, 2)


def parse(path):
    """-> (data by county FIPS, row count, latest estimate year, hist of population by year)."""
    data, hist, rows = {}, {}, 0
    with open(path, newline="", encoding="latin-1") as fh:
        reader = csv.DictReader(fh)
        names = reader.fieldnames or []
        years = sorted(int(m.group(1)) for m in (re.fullmatch(r"POPESTIMATE(\d{4})", n) for n in names) if m)
        need = ["SUMLEV", "STATE", "COUNTY", "ESTIMATESBASE%d" % (years[0] if years else 0)]
        if len(years) < 2 or any(n not in names for n in need):
            raise SourceUnavailable("population estimates file has no POPESTIMATE columns")
        last = years[-1]
        for tail in ("NATURALCHG", "DOMESTICMIG", "INTERNATIONALMIG"):
            if "%s%d" % (tail, last) not in names:
                raise SourceUnavailable("population estimates file lacks %s%d" % (tail, last))
        for row in reader:
            if row["SUMLEV"] != "050":
                continue
            fips = row["STATE"].strip().zfill(2) + row["COUNTY"].strip().zfill(3)
            rows += 1
            pop = num(row["POPESTIMATE%d" % last])
            prev = num(row["POPESTIMATE%d" % (last - 1)])
            base = num(row["ESTIMATESBASE%d" % years[0]])
            dom = num(row["DOMESTICMIG%d" % last])
            data[fips] = {
                "pep_pop": int(pop) if pop is not None else None,
                "pep_pop_change_1y": round((pop / prev - 1) * 100, 2) if pop is not None and prev else None,
                "pep_pop_change_since2020": round((pop / base - 1) * 100, 2) if pop is not None and base else None,
                "pep_natural_per_1k": _per_1k(num(row["NATURALCHG%d" % last]), prev),
                "pep_domestic_mig": int(dom) if dom is not None else None,
                "pep_domestic_mig_per_1k": _per_1k(dom, prev),
                "pep_international_mig_per_1k": _per_1k(num(row["INTERNATIONALMIG%d" % last]), prev),
            }
            series = [[str(y), int(v)] for y in years for v in [num(row["POPESTIMATE%d" % y])] if v is not None]
            if series:
                hist[fips] = {"pep_pop": series}
    if rows < MIN_COUNTIES:
        raise SourceUnavailable("population estimates file holds only %d counties (expected about 3,144)" % rows)
    return data, rows, last, hist


def load(ctx):
    _, path, _ = ctx.first(URLS, "co-est-alldata.csv")
    data, rows, last, hist = parse(path)
    return {"as_of": "%d-07-01" % last, "rows": rows, "data": data, "hist": hist}
