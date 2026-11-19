"""Census Economic Census 2022, retail trade (NAICS 44-45) by county: sales, establishments, jobs. Source tag: econ. Level county."""
import csv
import io
import re
import zipfile

from ctx import SourceUnavailable, num

SOURCE = {
    "id": "census_econ_retail",
    "name": "Census Economic Census, retail sales by county",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/programs-surveys/economic-census.html",
    "level": "county",
    "group": "commercial",
    "cadence": "5-yearly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "econ_retail_sales": {"label": "Retail sales 2022 (county share)", "unit": "usd", "agg": "sum", "xwalk": "sum",
                              "better": "higher"},
        "econ_retail_estabs": {"label": "Retail establishments (county share)", "unit": "count", "agg": "sum", "xwalk": "sum"},
        "econ_retail_sales_per_estab": {"label": "Retail sales per establishment", "unit": "usd", "agg": "pop_weighted_mean",
                                        "xwalk": "mean", "better": "higher"},
    },
}
URL = "https://www2.census.gov/programs-surveys/economic-census/data/%d/sector44/EC%02d44BASIC.zip"


def parse(path):
    """Economic Census zip -> (data, rows, as_of). County rows (GEO_ID 0500000US<fips>) for NAICS 44-45; sales are in $1,000."""
    data, rows, year = {}, 0, None
    with zipfile.ZipFile(path) as zf:
        name = next((n for n in zf.namelist() if n.upper().endswith(".DAT") or (n.upper().endswith(".CSV") and "FIELDS" not in n.upper())), None)
        if not name:
            raise SourceUnavailable("Economic Census zip has no data member")
        with zf.open(name) as fh:
            reader = csv.reader(io.TextIOWrapper(fh, encoding="latin-1", newline=""), delimiter="|")
            head = [h.lstrip("#").strip() for h in next(reader)]
            need = ("GEO_ID", "NAICS2022", "ESTAB", "ESTAB_F", "RCPTOT", "RCPTOT_F", "YEAR")
            if not all(c in head for c in need):
                raise SourceUnavailable("Economic Census header changed")
            ix = {c: head.index(c) for c in need}
            for row in reader:
                rows += 1
                if len(row) <= max(ix.values()) or row[ix["NAICS2022"]] != "44-45":
                    continue
                match = re.fullmatch(r"0500000US(\d{5})", row[ix["GEO_ID"]])
                if not match:
                    continue
                year = row[ix["YEAR"]]
                estabs = None if row[ix["ESTAB_F"]].strip() else num(row[ix["ESTAB"]])
                sales = None if row[ix["RCPTOT_F"]].strip() else num(row[ix["RCPTOT"]])
                sales = sales * 1000 if sales is not None else None
                data[match.group(1)] = {
                    "econ_retail_sales": int(sales) if sales is not None else None,
                    "econ_retail_estabs": int(estabs) if estabs is not None else None,
                    "econ_retail_sales_per_estab": round(sales / estabs) if sales is not None and estabs else None,
                }
    if not data:
        raise SourceUnavailable("Economic Census file had no county retail rows")
    return data, rows, year


def load(ctx):
    years = [2022, 2017]  # the survey runs every five years
    _, path, _ = ctx.first([URL % (y, y % 100) for y in years if y <= ctx.year], "ec_retail.zip", timeout=300)
    data, rows, year = parse(path)
    if len(data) < 2500:
        raise SourceUnavailable("Economic Census covered only %d counties" % len(data))
    return {"as_of": year, "rows": rows, "data": data,
            "note": "Sales are for the survey year and blank where the Census withholds the cell."}
