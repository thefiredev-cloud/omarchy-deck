"""Table-based ACS summary files for the multifamily and annual market sources.

Read public bulk files without an API key. Keep one vintage across every table
and never turn suppressed estimates or unpublished table rows into zero.
"""
import re
import time

from ctx import SourceUnavailable, num, zfill_zip

BASE = "https://www2.census.gov/programs-surveys/acs/summary_file/{year}/table-based-SF/data/{span}YRData/acsdt{span}y{year}-{table}.dat"
STATE_CODES = dict(pair.split(":") for pair in (
    "01:AL 02:AK 04:AZ 05:AR 06:CA 08:CO 09:CT 10:DE 11:DC 12:FL "
    "13:GA 15:HI 16:ID 17:IL 18:IN 19:IA 20:KS 21:KY 22:LA 23:ME "
    "24:MD 25:MA 26:MI 27:MN 28:MS 29:MO 30:MT 31:NE 32:NV 33:NH "
    "34:NJ 35:NM 36:NY 37:NC 38:ND 39:OH 40:OK 41:OR 42:PA 44:RI "
    "45:SC 46:SD 47:TN 48:TX 49:UT 50:VT 51:VA 53:WA 54:WV 55:WI 56:WY"
).split())


def estimate(value):
    """Negative Census sentinels and nonnumeric cells are missing."""
    value = num(value)
    return None if value is None or value < 0 else value


def total(values):
    return None if any(value is None for value in values) else sum(values)


def share(parts, whole):
    numerator = total(parts)
    if numerator is None or whole is None or whole <= 0 or numerator > whole:
        return None
    return round(100 * numerator / whole, 2)


def geography(geoid, level):
    if level == "zip" and geoid.startswith("860Z200US"):
        return zfill_zip(geoid[9:])
    if level == "state" and geoid.startswith("0400000US"):
        return STATE_CODES.get(geoid[9:])
    if level == "cbsa" and re.fullmatch(r"310M\d{3}US\d{5}", geoid):
        return geoid[-5:]
    return None


def parse_tables(paths, tables, level, minimum, sparse=False):
    """Read one level; annual CBSAs can have unpublished rows in individual tables."""
    records, expected = {}, None
    for table, columns in tables.items():
        if table not in paths:
            raise SourceUnavailable("ACS table %s was not supplied" % table)
        wanted = {table.upper() + "_" + cell: alias for cell, alias in columns.items()}
        seen = set()
        with open(paths[table], encoding="utf-8-sig") as fh:
            header = fh.readline().rstrip("\r\n").split("|")
            if not header or header[0] != "GEO_ID" or not wanted.keys() <= set(header):
                raise SourceUnavailable("ACS %s has missing GEO_ID or estimate columns" % table)
            indexes = {alias: header.index(cell) for cell, alias in wanted.items()}
            for line in fh:
                geoid = line.partition("|")[0]
                geo = geography(geoid, level)
                if geo is None:
                    continue
                if geo in seen:
                    raise SourceUnavailable("ACS %s repeats geography %s" % (table, geo))
                seen.add(geo)
                cells = line.rstrip("\r\n").split("|")
                if len(cells) != len(header):
                    raise SourceUnavailable("ACS %s has a truncated row for %s" % (table, geo))
                rec = records.setdefault(geo, {})
                rec.update({alias: estimate(cells[index]) for alias, index in indexes.items()})
        required = (len(expected) + 1) // 2 if sparse and expected is not None else minimum
        if len(seen) < required:
            raise SourceUnavailable("ACS %s has only %d %s areas; expected at least %d" %
                                    (table, len(seen), level, required))
        if expected is not None and not sparse and seen != expected:
            raise SourceUnavailable("ACS %s geography coverage differs from the first table" % table)
        if expected is None:
            expected = seen
    return records, len(records)


def fetch_tables(ctx, tables, span):
    """Find the latest published vintage, then fetch only that vintage's tables."""
    paths, year, last_request = {}, None, 0.0
    for table in tables:
        candidates = range(ctx.year - 1, ctx.year - 4, -1) if year is None else (year,)
        errors = []
        for candidate in candidates:
            time.sleep(max(0, 1 - (time.monotonic() - last_request)))
            last_request = time.monotonic()
            url = BASE.format(year=candidate, span=span, table=table)
            try:
                path, _ = ctx.fetch(url, "%d-%s.dat" % (candidate, table), timeout=600)
            except SourceUnavailable as exc:
                errors.append("%d: %s" % (candidate, exc))
                continue
            paths[table], year = path, candidate
            break
        else:
            raise SourceUnavailable("ACS %s unavailable (%s)" % (table, "; ".join(errors)))
    return paths, year


ANNUAL_TABLES = {
    "b25064": {"E001": "rent"},
    "b25003": {"E001": "occupied", "E003": "renters"},
    "b25024": {"E001": "units", "E006": "u59", "E007": "u1019", "E008": "u2049", "E009": "u50"},
    "b25004": {"E002": "for_rent", "E003": "rented_empty"},
    "b25070": {"E001": "rb_all", "E007": "rb30", "E008": "rb35", "E009": "rb40", "E010": "rb50", "E011": "rb_nc"},
    "b19013": {"E001": "income"},
}


def annual_fields(prefix):
    fields = {
        "median_gross_rent": ("Median gross rent (ACS 1-year)", "usd_month"),
        "renter_share": ("Renter-occupied share of occupied homes (ACS 1-year)", "pct"),
        "units_5plus_share": ("Homes in buildings with 5 or more units (ACS 1-year)", "pct"),
        "rental_vacancy": ("Rental vacancy rate (ACS 1-year)", "pct"),
        "rent_burden_30_share": ("Renters paying 30% or more of income on rent (ACS 1-year)", "pct"),
        "median_hh_income": ("Median household income (ACS 1-year)", "usd"),
    }
    return {prefix + name: {"label": label, "unit": unit, "agg": "none"}
            for name, (label, unit) in fields.items()}


def annual_row(rec, prefix):
    g = rec.get
    rent_base = None if g("rb_all") is None or g("rb_nc") is None else g("rb_all") - g("rb_nc")
    values = {
        "median_gross_rent": g("rent"),
        "renter_share": share([g("renters")], g("occupied")),
        "units_5plus_share": share([g("u59"), g("u1019"), g("u2049"), g("u50")], g("units")),
        "rental_vacancy": share([g("for_rent")], total([g("renters"), g("for_rent"), g("rented_empty")])),
        "rent_burden_30_share": share([g("rb30"), g("rb35"), g("rb40"), g("rb50")], rent_base),
        "median_hh_income": g("income"),
    }
    return {prefix + name: value for name, value in values.items()}
