"""Census ZIP Code Business Patterns, detail file: establishments by commercial property use group and size class per ZIP.

The totals and 2-digit sector counts already come from the legacy pipeline (biz_estabs, biz_emp, ...). This source adds the
use groups a property investor reads (hotel, storage, restaurants, health, office-using, industrial) and the share of
small establishments. Source tag: zbpd.
"""
import csv
import io
import re
import zipfile

from ctx import SourceUnavailable, num, zfill_zip

SOURCE = {
    "id": "zbp_detail",
    "name": "Census ZIP Code Business Patterns, establishments by use group",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/programs-surveys/cbp.html",
    "level": "zip",
    "group": "commercial",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "zbpd_estabs_retail": {"label": "Retail establishments", "unit": "count", "agg": "sum"},
        "zbpd_estabs_office": {"label": "Office-using establishments", "unit": "count", "agg": "sum"},
        "zbpd_estabs_industrial": {"label": "Industrial and logistics establishments", "unit": "count", "agg": "sum"},
        "zbpd_estabs_hotel": {"label": "Hotel and lodging establishments", "unit": "count", "agg": "sum"},
        "zbpd_estabs_storage": {"label": "Self-storage establishments", "unit": "count", "agg": "sum"},
        "zbpd_estabs_restaurant": {"label": "Restaurant and bar establishments", "unit": "count", "agg": "sum"},
        "zbpd_estabs_health": {"label": "Health care establishments", "unit": "count", "agg": "sum"},
        "zbpd_small_share": {"label": "Establishments with under 10 employees", "unit": "pct", "agg": "pop_weighted_mean"},
    },
}
URL = "https://www2.census.gov/programs-surveys/cbp/datasets/%d/zbp%02ddetail.zip"

# NAICS codes as the file writes them. The Census folds 44-45 into 44, 31-33 into 31 and 48-49 into 48.
GROUPS = {
    "zbpd_estabs_retail": ("44----",),
    "zbpd_estabs_office": ("51----", "52----", "53----", "54----", "55----", "56----"),
    "zbpd_estabs_industrial": ("31----", "42----", "48----"),
    "zbpd_estabs_hotel": ("721///",),
    "zbpd_estabs_storage": ("531130",),
    "zbpd_estabs_restaurant": ("722///",),
    "zbpd_estabs_health": ("62----",),
}
CODE_TO_FIELD = {code: field for field, codes in GROUPS.items() for code in codes}
SMALL = ("n<5", "n5_9")
LARGE = ("n10_19", "n20_49", "n50_99", "n100_249", "n250_499", "n500_999", "n1000")


def _open_text(path):
    if zipfile.is_zipfile(path):
        zf = zipfile.ZipFile(path)
        name = next((n for n in zf.namelist() if n.lower().endswith((".txt", ".csv"))), None)
        if not name:
            raise SourceUnavailable("ZBP zip had no data file")
        return io.TextIOWrapper(zf.open(name), encoding="latin-1", newline="")
    return open(path, encoding="latin-1", newline="")


def _small_share(row):
    """Share of establishments with under 10 employees from the total row, or None when suppressed cells hide it.
    A size cell of N is withheld. It is a known zero only when the numeric cells already add up to the establishment count."""
    est = num(row.get("est"))
    if not est:
        return None
    cells = {k: num(row.get(k)) for k in SMALL + LARGE}
    known = sum(v for v in cells.values() if v is not None)
    hidden_small = [k for k in SMALL if cells[k] is None]
    if hidden_small and known < est:
        return None
    return round(100.0 * sum(cells[k] or 0 for k in SMALL) / est, 1)


def parse(path):
    """-> (data, rows, as_of). data[zip] holds the use-group counts and the small-establishment share."""
    data, rows = {}, 0
    with _open_text(path) as fh:
        reader = csv.DictReader(fh)
        need = {"zip", "naics", "est"}
        if not need <= set(reader.fieldnames or ()):
            raise SourceUnavailable("ZBP detail header changed (needs zip, naics, est)")
        for row in reader:
            rows += 1
            z = zfill_zip(row["zip"])
            if not z:
                continue
            naics = row["naics"].strip()
            if naics == "------":
                rec = data.setdefault(z, {f: 0 for f in GROUPS})
                rec["zbpd_small_share"] = _small_share(row)
                continue
            field = CODE_TO_FIELD.get(naics)
            if field:
                rec = data.setdefault(z, {f: 0 for f in GROUPS})
                rec[field] += int(num(row["est"]) or 0)
    if not data:
        raise SourceUnavailable("ZBP detail had no usable rows")
    for rec in data.values():
        rec.setdefault("zbpd_small_share", None)
    match = re.search(r"zbp(\d\d)detail", path.lower())
    as_of = "20" + match.group(1) if match else None
    return data, rows, as_of


def load(ctx):
    years = [ctx.year - k for k in range(0, 4)]
    url, path, _ = ctx.first([URL % (y, y % 100) for y in years], "zbp_detail.zip", timeout=300)
    data, rows, _ = parse(path)
    if len(data) < 20000:
        raise SourceUnavailable("ZBP detail covered only %d ZIPs" % len(data))
    as_of = re.search(r"/(\d{4})/", url).group(1)
    return {"as_of": as_of, "rows": rows, "data": data,
            "note": "Counts of establishments by use group. A share of small establishments is blank where the Census withholds size cells."}
