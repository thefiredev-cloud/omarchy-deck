"""USDA ERS Food Access Research Atlas, SNAP-authorized Retailer Access Map (SRAM, 2025 release, 2020 census tracts)."""
import csv
import io
import zipfile

from ctx import SourceUnavailable, num

SOURCE = {
    "id": "usda_food_access",
    "name": "USDA Food Access Research Atlas: distance to SNAP-authorized food stores",
    "publisher": "USDA Economic Research Service",
    "homepage": "https://www.ers.usda.gov/data-products/food-access-research-atlas",
    "level": "tract",
    "tract_vintage": 2020,
    "group": "risk",
    "cadence": "every few years",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "sram_lila_flag": {"label": "Low-income and low-access tract (1 mile urban, 10 miles rural)", "unit": "flag",
                           "agg": "none", "xwalk": "mean", "better": "lower"},
        "sram_low_vehicle_flag": {"label": "Tract with many households lacking a car and far from a store",
                                  "unit": "flag", "agg": "none", "xwalk": "mean", "better": "lower"},
        "sram_lowaccess_pop": {"label": "People far from a food store (1 mile urban, 10 miles rural)",
                               "unit": "count", "agg": "sum", "xwalk": "sum", "better": "lower"},
        "sram_lowaccess_half_share": {"label": "People more than half a mile from a food store by road",
                                      "unit": "pct", "agg": "pop_weighted_mean", "xwalk": "mean"},
        "sram_lowaccess_lowinc_half_share": {"label": "Low-income people more than half a mile from a food store",
                                             "unit": "pct", "agg": "pop_weighted_mean", "xwalk": "mean",
                                             "better": "lower"},
        "sram_low_income_tract": {"label": "Low-income tract", "unit": "flag", "agg": "none", "xwalk": "mean"},
        "sram_urban_tract": {"label": "Urban tract", "unit": "flag", "agg": "none", "xwalk": "mean"},
        "sram_snap_households": {"label": "Households receiving SNAP", "unit": "count", "agg": "sum", "xwalk": "sum"},
        "sram_no_vehicle_far_households": {"label": "Households without a car and far from a food store",
                                           "unit": "count", "agg": "sum", "xwalk": "sum"},
    },
}
URL = "https://www.ers.usda.gov/media/29395/2025-snap-authorized-retailer-access-map-sram-data.zip"
AS_OF = "2025"
DRIVING = "SRAM Driving Distance Data.csv"
GENERAL = "SRAM General Tract Characteristics Data.csv"
MIN_ROWS = 40000

DRIVING_COLS = {
    "DD_SRAM_LILATracts_1And10": "sram_lila_flag",
    "DD_SRAM_HUNVFlag": "sram_low_vehicle_flag",
    "DD_SRAM_LAPOP1_10": "sram_lowaccess_pop",
    "DD_SRAM_lapophalfshare": "sram_lowaccess_half_share",
    "DD_SRAM_lalowihalfshare": "sram_lowaccess_lowinc_half_share",
}
GENERAL_COLS = {
    "LowIncomeTracts": "sram_low_income_tract",
    "Urban": "sram_urban_tract",
    "TractSNAP": "sram_snap_households",
    "TractHUNV": "sram_no_vehicle_far_households",
}
COUNT_FIELDS = {"sram_lowaccess_pop", "sram_snap_households", "sram_no_vehicle_far_households"}


def _tract(raw):
    text = (raw or "").strip()
    return text.zfill(11) if text.isdigit() and len(text) in (10, 11) else None


def _read(zf, member, cols, out):
    rows = 0
    with zf.open(member) as raw:
        reader = csv.DictReader(io.TextIOWrapper(raw, encoding="latin-1", newline=""))
        if "CensusTract20" not in (reader.fieldnames or []) or not set(cols) <= set(reader.fieldnames):
            raise SourceUnavailable("SRAM member %s lacks the expected columns" % member)
        for row in reader:
            rows += 1
            geoid = _tract(row.get("CensusTract20"))
            if not geoid:
                continue
            rec = out.setdefault(geoid, {})
            for col, field in cols.items():
                val = num(row.get(col))
                rec[field] = int(val) if val is not None and field in COUNT_FIELDS else val
    return rows


def parse(path, min_rows=MIN_ROWS):
    """SRAM zip -> ({tract geoid: {field: value}}, rows, as_of). Driving-distance table plus tract characteristics."""
    data = {}
    try:
        with zipfile.ZipFile(path) as zf:
            names = set(zf.namelist())
            if not {DRIVING, GENERAL} <= names:
                raise SourceUnavailable("SRAM zip is missing its data tables")
            rows = _read(zf, DRIVING, DRIVING_COLS, data)
            _read(zf, GENERAL, GENERAL_COLS, data)
    except zipfile.BadZipFile:
        raise SourceUnavailable("SRAM download is not a zip file")
    if rows < min_rows:
        raise SourceUnavailable("SRAM file has %d rows, expected about 84,000" % rows)
    return data, rows, AS_OF


def load(ctx):
    path, _ = ctx.fetch(URL, "sram_2025.zip", timeout=300, min_bytes=1000000)
    data, rows, as_of = parse(path)
    return {"as_of": as_of, "rows": rows, "data": data,
            "note": "Road-distance access to SNAP-authorized stores, 2020 tracts; blank where USDA leaves cells empty."}
