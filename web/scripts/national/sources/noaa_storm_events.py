"""NOAA NCEI Storm Events Database: damaging county-level storm events, damage and casualties over the last 10 full years."""
import csv
import gzip
import io
import os
import re
from collections import defaultdict

from ctx import SourceUnavailable, num

SOURCE = {
    "id": "noaa_storm_events",
    "name": "NOAA Storm Events by county, last 10 years",
    "publisher": "NOAA National Centers for Environmental Information",
    "homepage": "https://www.ncdc.noaa.gov/stormevents/",
    "level": "county",
    "group": "risk",
    "cadence": "monthly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "storm_events_10y": {"label": "Damaging storm events, last 10 years (county)", "unit": "count",
                             "agg": "pop_weighted_mean", "metric": "climate_risk", "xwalk": "assign",
                             "better": "lower"},
        "storm_damage_10y": {"label": "Storm property and crop damage, last 10 years (county)", "unit": "usd",
                             "agg": "sum", "xwalk": "sum", "better": "lower"},
        "storm_casualties_10y": {"label": "Storm deaths and injuries, last 10 years (county)", "unit": "count",
                                 "agg": "sum", "xwalk": "sum", "better": "lower"},
    },
}
INDEX = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
FILE_RE = re.compile(r'href="(StormEvents_details-ftp_v1\.0_d(\d{4})_c(\d{8})\.csv\.gz)"')
WINDOW_YEARS = 10
MIN_ROWS = 100000  # about 60,000 to 75,000 events a year
_MULT = {"": 1.0, "K": 1e3, "M": 1e6, "B": 1e9, "T": 1e12}


def damage_dollars(raw):
    """NCEI writes damage as '10.00K', '1.50M', '2.00B' or blank/'0'. Returns whole dollars."""
    text = (raw or "").strip().upper()
    if not text:
        return 0
    suffix = text[-1] if text[-1] in _MULT else ""
    val = num(text[:-1] if suffix else text)
    return int(round(val * _MULT[suffix])) if val is not None else 0


def newest_files(index_html, first_year, last_year):
    """{year: (file name, c-date)} choosing the newest c-date for every year in the window."""
    best = {}
    for name, year, cdate in FILE_RE.findall(index_html):
        year = int(year)
        if first_year <= year <= last_year and (year not in best or cdate > best[year][1]):
            best[year] = (name, cdate)
    return best


def parse(paths, min_rows=MIN_ROWS):
    """Details csv.gz files -> ({county fips: {field: value}}, rows, as_of).
    Only county-based rows (CZ_TYPE C) carry a county; forecast-zone rows (winter, heat, fire) are skipped."""
    events, damage, casualties = defaultdict(int), defaultdict(int), defaultdict(int)
    rows, years = 0, set()
    for path in paths:
        try:
            raw = gzip.open(path, "rt", encoding="latin-1", newline="")
            reader = csv.DictReader(raw)
            need = {"STATE_FIPS", "CZ_TYPE", "CZ_FIPS", "DAMAGE_PROPERTY", "DAMAGE_CROPS", "DEATHS_DIRECT", "YEAR"}
            if not need <= set(reader.fieldnames or []):
                raise SourceUnavailable("storm events file has unexpected columns")
            for row in reader:
                rows += 1
                if row.get("CZ_TYPE") != "C":
                    continue
                state, county = (row.get("STATE_FIPS") or "").strip(), (row.get("CZ_FIPS") or "").strip()
                if not (state.isdigit() and county.isdigit()):
                    continue
                fips = state.zfill(2) + county.zfill(3)
                loss = damage_dollars(row.get("DAMAGE_PROPERTY")) + damage_dollars(row.get("DAMAGE_CROPS"))
                hurt = sum(int(num(row.get(col)) or 0) for col in (
                    "INJURIES_DIRECT", "INJURIES_INDIRECT", "DEATHS_DIRECT", "DEATHS_INDIRECT"))
                events.setdefault(fips, 0)  # a county with county-based rows but no damaging event is a true zero
                if loss > 0 or hurt > 0:
                    events[fips] += 1
                damage[fips] += loss
                casualties[fips] += hurt
                year = num(row.get("YEAR"))
                if year:
                    years.add(int(year))
        except (OSError, EOFError, gzip.BadGzipFile):
            raise SourceUnavailable("storm events file is not a readable gzip")
    if rows < min_rows:
        raise SourceUnavailable("storm events window has %d rows, expected about 700,000" % rows)
    data = {fips: {"storm_events_10y": n, "storm_damage_10y": damage[fips], "storm_casualties_10y": casualties[fips]}
            for fips, n in events.items()}
    return data, rows, "%d-%d" % (min(years), max(years)) if years else None


def load(ctx):
    last_year = ctx.year - 1
    first_year = last_year - WINDOW_YEARS + 1
    listing, _ = ctx.fetch(INDEX, "index.html", timeout=60, min_bytes=1000)
    with open(listing, encoding="utf8", errors="replace") as fh:
        files = newest_files(fh.read(), first_year, last_year)
    missing = [y for y in range(first_year, last_year + 1) if y not in files]
    if missing:
        raise SourceUnavailable("NCEI listing has no details file for %s" % ", ".join(map(str, missing)))
    paths = []
    for year in sorted(files):
        name, cdate = files[year]
        local = "details_%d_c%s.csv.gz" % (year, cdate)
        path, _ = ctx.fetch(INDEX + name, local, timeout=300, min_bytes=10000, min_age=30 * 86400)
        paths.append(path)
        for old in os.listdir(ctx.cache_dir):  # a newer c-date replaces the older copy of the same year
            if old.startswith("details_%d_c" % year) and not old.startswith(local):
                os.unlink(os.path.join(ctx.cache_dir, old))
    data, rows, as_of = parse(paths)
    return {"as_of": as_of, "rows": rows, "data": data,
            "note": "County-based events only; storms logged by forecast zone (many winter, heat and fire events) have no county and are left out."}
