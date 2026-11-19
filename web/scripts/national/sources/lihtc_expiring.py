"""HUD LIHTC database: tax credit apartments whose 15-year compliance period or extended use period ends within 5 years
per ZIP, a sale or conversion trigger. Source tag: lihx."""
import datetime
import os
import shutil
import zipfile

import _federal_layers as fed
import _hud
from ctx import SourceUnavailable, num, zfill_zip

URL = "https://www.huduser.gov/lihtc/lihtcpub.zip"
MEMBER = "LIHTCPUB.xlsx"
MIN_ROWS = 30000  # the 2026 release lists 55,345 projects
FIRST_EXTENDED_USE_ALLOCATION = 1990  # extended use (30 years) applies to credits allocated from 1990 on
NOTE = ("Compliance is taken to end 15 years after the placed-in-service year and extended use 30 years after it (or the "
        "longer period the state agency reported); counted when that year starts within the next 5 years. Projects the "
        "agency no longer monitors and projects with no placed-in-service year are left out. Units are low-income units.")

SOURCE = {
    "id": "lihtc_expiring",
    "name": "HUD LIHTC database, expiring affordability",
    "publisher": "US Department of Housing and Urban Development",
    "homepage": "https://www.huduser.gov/portal/datasets/lihtc.html",
    "level": "zip",
    "group": "commercial",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "lihx_units_expiring_5y": {"label": "Tax credit homes leaving the 15-year compliance period within 5 years",
                                   "unit": "count", "agg": "sum"},
        "lihx_units_year30_5y": {"label": "Tax credit homes reaching the end of extended use (30 years or longer) within 5 years",
                                 "unit": "count", "agg": "sum"},
        "lihx_projects_expiring_5y": {"label": "Tax credit projects leaving the 15-year compliance period within 5 years",
                                      "unit": "count", "agg": "sum"},
    },
}


def year_of(value, today):
    """Placed-in-service or allocation year, None for the file's 8888 and 9999 codes or anything out of range."""
    year = num(value)
    return int(year) if year is not None and 1987 <= year <= today.year else None


def in_window(end_year, today):
    """True when 1 January of end_year falls after today and no more than 5 years out."""
    return today < datetime.date(end_year, 1, 1) <= fed.add_years(today, 5)


def aggregate(rows, today=None, locate=None):
    """Project dicts (lower-case LIHTC columns) -> ({zip: fields}, projects used). Every ZIP with a usable project gets a
    record (0 when nothing expires there)."""
    today = today or datetime.date.today()
    blank = {name: 0 for name in SOURCE["fields"]}
    data, used = {}, 0
    for row in rows:
        z = zfill_zip(row.get("proj_zip"))
        if (not z or z == "00000") and locate:
            lat, lon = num(row.get("latitude")), num(row.get("longitude"))
            z = locate(lat, lon) if lat and lon else None
        units = next((u for u in (num(row.get(k)) for k in ("li_unitr", "li_units", "n_units")) if u is not None), None)
        if not z or z == "00000" or units is None or units <= 0:
            continue
        used += 1
        rec = data.setdefault(z, dict(blank))
        pis = year_of(row.get("yr_pis"), today)
        if pis is None or str(row.get("nonprog") or "").strip() == "1":
            continue
        if in_window(pis + 15, today):
            rec["lihx_units_expiring_5y"] += int(units)
            rec["lihx_projects_expiring_5y"] += 1
        alloc = year_of(row.get("yr_alloc"), today)
        if alloc is not None and alloc < FIRST_EXTENDED_USE_ALLOCATION:
            continue
        years = num(row.get("aff_yrs"))
        span = int(years) if str(row.get("aff_period") or "").strip() == "1" and years and years > 30 else 30
        if in_window(pis + span, today):
            rec["lihx_units_year30_5y"] += int(units)
    return data, used


def read_projects(path):
    """LIHTCPUB.xlsx -> list of dicts keyed by lower-case column name."""
    it = _hud.rows(path)
    head = [c.strip().lower() for c in next(it, [])]
    for col in ("proj_zip", "yr_pis", "li_units", "n_units"):
        if col not in head:
            raise SourceUnavailable("LIHTC workbook lacks the %s column" % col)
    return [dict(zip(head, r)) for r in it if any(r)]


def parse(path, today=None, locate=None):
    """LIHTCPUB.xlsx -> (data, rows read, as_of: newest placed-in-service year)."""
    today = today or datetime.date.today()
    projects = read_projects(path)
    if len(projects) < MIN_ROWS:
        raise SourceUnavailable("LIHTC workbook has %d projects, expected at least %d" % (len(projects), MIN_ROWS))
    data, _ = aggregate(projects, today, locate)
    years = [y for y in (year_of(p.get("yr_pis"), today) for p in projects) if y]
    if not data or not years:
        raise SourceUnavailable("LIHTC workbook had no projects with a ZIP and a placed-in-service year")
    return data, len(projects), str(max(years))


def member(ctx, zip_path):
    """The workbook inside the LIHTC zip, extracted once per new download next to it in the cache."""
    out = os.path.join(ctx.cache_dir, MEMBER)
    if os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(zip_path):
        return out
    try:
        with zipfile.ZipFile(zip_path) as zf, zf.open(MEMBER) as src, open(out + ".part", "wb") as dst:
            shutil.copyfileobj(src, dst, 1 << 20)
    except (zipfile.BadZipFile, KeyError) as exc:
        raise SourceUnavailable("LIHTC download is not the expected zip (%s)" % str(exc)[:60])
    os.replace(out + ".part", out)
    return out


def load(ctx):
    zip_path, _ = ctx.fetch(URL, "lihtcpub.zip", timeout=600, min_bytes=1000000)
    data, rows, as_of = parse(member(ctx, zip_path), locate=ctx.nearest_zip)
    return {"as_of": as_of, "rows": rows, "data": data,
            "note": NOTE + " HUD adds projects with a lag; the newest placed-in-service year in the file is %s." % as_of}
