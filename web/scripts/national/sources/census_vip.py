"""Private US construction put in place, Census monthly SAAR workbook.

Read the keyless publisher workbook rather than the Census API, which requires
a key. Commercial includes retail, warehouses and farm construction; it is not
a retail-only series. All dollar levels are nominal, not inflation adjusted.
"""
import re
import zipfile
import xml.etree.ElementTree as ET

import _xlsx
from ctx import SourceUnavailable, num

URL = "https://www.census.gov/construction/c30/xlsx/privsatime.xlsx"
HIST_POINTS = 72
COLUMNS = {
    "vip_multifamily_yoy": "New multifamily",
    "vip_office_yoy": "Office",
    "vip_commercial_yoy": "Commercial (inc. Farm)",
    "vip_manufacturing_yoy": "Manufacturing",
}
SOURCE = {
    "id": "census_vip",
    "name": "Census private construction spending by property type",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/construction/c30/historical_data.html",
    "level": "us",
    "group": "commercial",
    "cadence": "monthly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "vip_multifamily_yoy": {
            "label": "Private multifamily construction spending, 1-year change (US)", "unit": "pct", "agg": "none",
            "note": "Census VIP New multifamily, private seasonally adjusted annual rate, compared with the same month last year."},
        "vip_office_yoy": {
            "label": "Private office construction spending, 1-year change (US)", "unit": "pct", "agg": "none",
            "note": "Census VIP Office total, including data centers, private seasonally adjusted annual rate, compared with the same month last year."},
        "vip_commercial_yoy": {
            "label": "Private commercial construction spending, 1-year change (US)", "unit": "pct", "agg": "none",
            "note": "Census VIP Commercial (inc. Farm), including retail and warehouses, private seasonally adjusted annual rate, compared with the same month last year."},
        "vip_manufacturing_yoy": {
            "label": "Private manufacturing construction spending, 1-year change (US)", "unit": "pct", "agg": "none",
            "note": "Census VIP Manufacturing, private seasonally adjusted annual rate, compared with the same month last year."},
        "vip_multifamily_saar": {
            "label": "Private multifamily construction spending, annual rate (US)", "unit": "usd", "agg": "none",
            "note": "Census VIP New multifamily, nominal private seasonally adjusted annual rate. Publisher millions of dollars converted to dollars, not actual monthly spending."},
    },
}
MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
NOTE = ("US private nominal construction spending at seasonally adjusted annual rates, not monthly outlays. "
        "Commercial includes retail, warehouses and farm construction. Office includes data centers. "
        "The latest month is preliminary; earlier months may be revised.")


def _period(value):
    match = re.fullmatch(r"([A-Za-z]{3})-(\d{2}|\d{4})[pr]*", str(value).strip())
    if not match or match[1].title() not in MONTHS:
        return None
    year = int(match[2])
    if len(match[2]) == 2:
        year += 1900 if year >= 90 else 2000  # Publisher history starts in 1993.
    return "%04d-%02d" % (year, MONTHS.index(match[1].title()) + 1)


def _month_number(period):
    return int(period[:4]) * 12 + int(period[5:7])


def parse(path):
    """Return a source result from the publisher workbook, with 72 monthly changes."""
    indices, points, title, units = None, {}, False, False
    try:
        for row in _xlsx.read_xlsx_rows(path):
            if not row:
                continue
            text = str(row[0] or "").strip()
            title = title or text == "Value of Private Construction Put in Place - Seasonally Adjusted Annual Rate"
            units = units or text.startswith("(Millions of dollars.")
            if text == "Date":
                if indices is not None or any(row.count(label) != 1 for label in COLUMNS.values()):
                    raise SourceUnavailable("Census VIP workbook has unexpected property columns")
                indices = {field: row.index(label) for field, label in COLUMNS.items()}
                continue
            period = _period(text)
            if period is None:
                continue
            if indices is None:
                raise SourceUnavailable("Census VIP workbook has observations before its header")
            if period in points:
                raise SourceUnavailable("Census VIP workbook repeats a month")
            points[period] = {}
            for field, index in indices.items():
                value = num(row[index]) if index < len(row) else None
                points[period][field] = value if value is not None and value >= 0 else None
    except (OSError, ValueError, KeyError, IndexError, zipfile.BadZipFile, ET.ParseError) as exc:
        raise SourceUnavailable("Census VIP file is not a readable construction workbook") from exc
    if not title or not units or indices is None:
        raise SourceUnavailable("Census VIP workbook is not private spending in millions at annual rates")
    periods = sorted(points)
    window = periods[-(HIST_POINTS + 12):]
    if len(window) != HIST_POINTS + 12 or _month_number(window[-1]) - _month_number(window[0]) != len(window) - 1:
        raise SourceUnavailable("Census VIP workbook lacks 84 consecutive monthly observations")
    history, data = {}, {}
    for field in COLUMNS:
        history[field] = []
        for period in window[12:]:
            previous = "%04d%s" % (int(period[:4]) - 1, period[4:])
            now, before = points[period][field], points[previous][field]
            value = round(100 * (now / before - 1), 4) if now is not None and before and before > 0 else None
            history[field].append([period, value])
        data[field] = history[field][-1][1]
    mf = points[periods[-1]]["vip_multifamily_yoy"]
    data["vip_multifamily_saar"] = round(mf * 1_000_000) if mf is not None else None
    if all(value is None for value in data.values()):
        raise SourceUnavailable("Census VIP latest month has no usable spending values")
    return {"as_of": periods[-1], "rows": len(points), "data": {"US": data}, "hist": {"US": history}, "note": NOTE}


def load(ctx):
    path, _ = ctx.fetch(URL, "privsatime.xlsx", timeout=120)
    return parse(path)
