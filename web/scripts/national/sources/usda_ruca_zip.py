"""USDA ERS Rural-Urban Commuting Area codes 2020, by ZIP code."""
import csv

from ctx import SourceUnavailable, num, zfill_zip

SOURCE = {
    "id": "usda_ruca_zip",
    "name": "USDA Rural-Urban Commuting Area codes by ZIP",
    "publisher": "USDA Economic Research Service",
    "homepage": "https://www.ers.usda.gov/data-products/rural-urban-commuting-area-codes",
    "level": "zip",
    "group": "geo",
    "cadence": "every 10 years",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "ruca_primary": {"label": "Rural-urban commuting code (1 metro core to 10 rural)", "unit": "index",
                         "agg": "none"},
        "ruca_secondary": {"label": "Rural-urban commuting sub-code", "unit": "index", "agg": "none"},
        "ruca_class": {"label": "Rural-urban class", "unit": "text", "agg": "none"},
    },
}
URL = "https://www.ers.usda.gov/media/5444/2020-rural-urban-commuting-area-codes-zip-codes.csv"
AS_OF = "2020"
MIN_ROWS = 20000


def ruca_class(code):
    """USDA's own four-way grouping of the primary code."""
    if code is None:
        return None
    if code <= 3:
        return "Metropolitan"
    if code <= 6:
        return "Micropolitan"
    if code <= 9:
        return "Small town"
    return "Rural"


def parse(path, min_rows=MIN_ROWS):
    """RUCA zip csv -> ({zip: {field: value}}, rows, as_of)."""
    data, rows = {}, 0
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if "ZIPCode" not in (reader.fieldnames or []) or "PrimaryRUCA" not in reader.fieldnames:
            raise SourceUnavailable("RUCA file has no ZIPCode / PrimaryRUCA columns")
        for row in reader:
            rows += 1
            zip5 = zfill_zip(row.get("ZIPCode"))
            primary = num(row.get("PrimaryRUCA"))
            if not zip5 or primary is None:
                continue
            data[zip5] = {"ruca_primary": primary, "ruca_secondary": num(row.get("SecondaryRUCA")),
                          "ruca_class": ruca_class(primary)}
    if rows < min_rows:
        raise SourceUnavailable("RUCA file has %d rows, expected about 41,000" % rows)
    return data, rows, AS_OF


def load(ctx):
    path, _ = ctx.fetch(URL, "ruca_zip_2020.csv", timeout=120, min_bytes=100000)
    data, rows, as_of = parse(path)
    return {"as_of": as_of, "rows": rows, "data": data,
            "note": "Codes cover every ZIP including post office and large-volume ZIPs."}
