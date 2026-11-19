"""HUD Picture of Subsidized Households, ZIP level (2020 Census geography). Level "zip".
One workbook row per ZIP and program. This source keeps the "Summary of All HUD Programs" row of each ZIP (program 1,
sub-program N/A). HUD prints -1 and similar negatives for withheld cells; those become missing. The sheet is about
330 MB of XML: it streams row by row."""
import _hud
from ctx import SourceUnavailable, num, zfill_zip

SOURCE = {
    "id": "hud_picture_zip",
    "name": "HUD subsidized households by ZIP code",
    "publisher": "HUD Office of Policy Development and Research",
    "homepage": "https://www.huduser.gov/portal/datasets/assthsg.html",
    "level": "zip",
    "group": "residential",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "hud_subsidized_units": {"label": "Subsidized homes (all HUD programs)", "unit": "count", "agg": "sum"},
        "hud_subsidized_occupied_share": {"label": "Subsidized homes that are occupied", "unit": "pct", "agg": "pop_weighted_mean"},
        "hud_subsidized_wait_months": {"label": "Average months on the waiting list", "unit": "ratio", "agg": "pop_weighted_mean"},
        "hud_subsidized_hh_income": {"label": "Average household income in subsidized homes", "unit": "usd", "agg": "pop_weighted_mean"},
    },
}

URL = "https://www.huduser.gov/portal/datasets/pictures/files/Zipcode_%d_2020census.xlsx"
MIN_ZIPS = 10000  # about 25,000 ZIPs have subsidized homes
COLUMNS = {"hud_subsidized_units": "total_units", "hud_subsidized_occupied_share": "pct_occupied",
           "hud_subsidized_wait_months": "months_waiting", "hud_subsidized_hh_income": "hh_income"}


def _value(row, header, name):
    i = header.get(name)
    if i is None or i >= len(row):
        return None
    out = num(row[i])
    return None if out is None or out < 0 else out  # HUD prints -1 and other negatives for withheld cells


def parse(path):
    """-> (data by ZIP, workbook row count, quarter text such as '31DEC2025')."""
    header, rows, quarter, data = None, 0, None, {}
    for row in _hud.rows(path):
        if header is None:
            if "gsl" in row and "program_label" in row and "total_units" in row:
                header = {name.strip(): i for i, name in enumerate(row)}
            continue
        rows += 1
        if row[header["gsl"]] != "ZIPCODE" or not row[header["program_label"]].startswith("Summary of All"):
            continue
        z = zfill_zip(row[header["code"]])
        if not z:
            continue
        quarter = quarter or row[header["Quarter"]]
        values = {field: _value(row, header, col) for field, col in COLUMNS.items()}
        units = values["hud_subsidized_units"]
        data[z] = {"hud_subsidized_units": None if units is None else int(units),
                   "hud_subsidized_occupied_share": values["hud_subsidized_occupied_share"],
                   "hud_subsidized_wait_months": values["hud_subsidized_wait_months"],
                   "hud_subsidized_hh_income": values["hud_subsidized_hh_income"]}
    if header is None:
        raise SourceUnavailable("the HUD Picture workbook has no gsl, program_label and total_units columns")
    if len(data) < MIN_ZIPS:
        raise SourceUnavailable("the HUD Picture workbook holds only %d ZIPs (expected about 25,000)" % len(data))
    return data, rows, quarter


def _as_of(quarter):
    """'31DEC2025' -> '2025-12-31'."""
    months = {m: i for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(), 1)}
    try:
        return "%s-%02d-%s" % (quarter[5:9], months[quarter[2:5].upper()], quarter[:2])
    except (KeyError, TypeError, IndexError):
        return str(quarter)


def load(ctx):
    urls = [URL % y for y in (ctx.year, ctx.year - 1, ctx.year - 2)]
    _, path, _ = ctx.first(urls, "picture_zip.xlsx", timeout=900)
    data, rows, quarter = parse(path)
    return {"as_of": _as_of(quarter), "rows": rows, "data": data}
