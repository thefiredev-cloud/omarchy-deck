"""EPA Toxics Release Inventory: reporting industrial facilities and pounds released per ZIP. Source tag: tri.
One keyless CSV per reporting year (about 60 MB, one row per facility and chemical, about 78,000 rows). Facilities are
counted once per TRI facility id. Release totals add the form's TOTAL RELEASES (on-site plus off-site) over every chemical;
dioxin-class chemicals are reported in grams and are converted to pounds."""
import csv
import time

from ctx import SourceUnavailable, num, zfill_zip

URL = "https://data.epa.gov/efservice/downloads/tri/mv_tri_basic_download/%d_US/csv"
MIN_FACILITIES = 10000  # about 22,000 facilities report each year
GRAMS_PER_POUND = 453.592
MANUFACTURING_NAICS = ("31", "32", "33")

SOURCE = {
    "id": "epa_tri_zip",
    "name": "EPA Toxics Release Inventory: industrial facilities and releases by ZIP",
    "publisher": "US Environmental Protection Agency",
    "homepage": "https://www.epa.gov/toxics-release-inventory-tri-program",
    "level": "zip",
    "native": "zip",
    "group": "commercial",
    "side": "commercial",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "tri_facilities": {"label": "Industrial facilities reporting toxic releases", "unit": "count", "agg": "sum"},
        "tri_manufacturing_facilities": {"label": "Of those, manufacturing plants", "unit": "count", "agg": "sum"},
        "tri_releases_lb": {"label": "Pounds of toxic chemicals released", "unit": "count", "agg": "sum", "better": "lower"},
    },
}


def parse(path):
    """TRI basic download CSV -> (data {zip: fields}, chemical rows read, reporting year)."""
    data, seen, rows, years = {}, {}, 0, set()
    with open(path, encoding="utf-8-sig", newline="") as fh:
        reader = csv.reader(fh)
        head = next(reader, None)
        if not head:
            raise SourceUnavailable("TRI file is empty")
        col = {name.split(". ", 1)[-1].strip(): i for i, name in enumerate(head)}
        try:
            i_year, i_id, i_zip = col["YEAR"], col["TRIFD"], col["ZIP"]
            i_naics, i_unit, i_rel = col["PRIMARY NAICS"], col["UNIT OF MEASURE"], col["TOTAL RELEASES"]
        except KeyError as exc:
            raise SourceUnavailable("TRI file lacks column %s" % exc)
        for row in reader:
            if len(row) <= max(i_year, i_id, i_zip, i_naics, i_unit, i_rel):
                continue
            rows += 1
            zipc = zfill_zip(row[i_zip].strip()[:5])
            fid = row[i_id].strip()
            if not zipc or not fid:
                continue
            years.add(row[i_year].strip())
            rec = data.setdefault(zipc, {"tri_facilities": 0, "tri_manufacturing_facilities": 0, "tri_releases_lb": 0.0})
            if fid not in seen:
                seen[fid] = zipc
                rec["tri_facilities"] += 1
                if row[i_naics].strip().startswith(MANUFACTURING_NAICS):
                    rec["tri_manufacturing_facilities"] += 1
            released = num(row[i_rel])
            if released is not None:
                unit = row[i_unit].strip().lower()
                if unit == "grams":
                    released /= GRAMS_PER_POUND
                elif unit != "pounds":
                    raise SourceUnavailable("TRI unit of measure %r is not pounds or grams" % row[i_unit])
                rec["tri_releases_lb"] += released
    if len(seen) < MIN_FACILITIES:
        raise SourceUnavailable("TRI file had %d facilities, expected over %d" % (len(seen), MIN_FACILITIES))
    if len(years) != 1:
        raise SourceUnavailable("TRI file mixes reporting years: %s" % sorted(years)[:4])
    for rec in data.values():
        rec["tri_releases_lb"] = int(round(rec["tri_releases_lb"]))
    return data, rows, years.pop()


def load(ctx):
    reasons = []
    for year in range(ctx.year - 1, ctx.year - 5, -1):  # the year after a reporting year publishes in the autumn
        try:
            path, _ = ctx.fetch(URL % year, "tri_basic_%d_US.csv" % year, timeout=600)
        except SourceUnavailable as exc:
            reasons.append("%d: %s" % (year, exc))
            continue
        try:
            data, rows, as_of = parse(path)
        except SourceUnavailable as exc:
            reasons.append("%d: %s" % (year, exc))
            continue
        note = "Facilities that report to the Toxics Release Inventory only (industries and size limits set by law); pounds are releases, not waste managed."
        return {"as_of": as_of, "rows": rows, "data": data, "note": note}
    raise SourceUnavailable("no TRI reporting year parsed: " + "; ".join(reasons)[:200])
