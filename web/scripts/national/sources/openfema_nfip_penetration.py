"""FEMA NFIP residential penetration rates by county (OpenFEMA v1): share of homes that carry flood insurance."""
import csv

from ctx import SourceUnavailable, num

SOURCE = {
    "id": "openfema_nfip_penetration",
    "name": "FEMA flood insurance penetration by county",
    "publisher": "FEMA, National Flood Insurance Program (OpenFEMA)",
    "homepage": "https://www.fema.gov/openfema-data-page/nfip-residential-penetration-rates-v1",
    "level": "county",
    "group": "risk",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "nfip_penetration": {"label": "Homes with flood insurance (county)", "unit": "pct", "agg": "pop_weighted_mean",
                             "xwalk": "mean"},
        "nfip_penetration_sfha": {"label": "High-risk-zone homes with flood insurance (county)", "unit": "pct",
                                  "agg": "pop_weighted_mean", "xwalk": "mean"},
    },
}
URL = "https://www.fema.gov/api/open/v1/NfipResidentialPenetrationRates.csv"
MIN_ROWS = 1500  # 3,159 county rows


def _pct(raw):
    val = num(raw)
    return None if val is None else round(val * 100.0, 2)  # the file stores fractions


def parse(path, min_rows=MIN_ROWS):
    """Penetration csv -> ({county fips: {field: value}}, rows, as_of). Rates are fractions in the file, percent here."""
    data, rows, as_of = {}, 0, ""
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if not {"fipsCode", "resPenetrationRate", "resPenetrationRateSfha"} <= set(reader.fieldnames or []):
            raise SourceUnavailable("penetration file has unexpected columns")
        for row in reader:
            rows += 1
            fips = (row.get("fipsCode") or "").strip()
            if len(fips) != 5 or not fips.isdigit():
                continue  # "Unknown Counties" rows carry no code
            as_of = max(as_of, (row.get("asOfDate") or "")[:10])
            rec = {"nfip_penetration": _pct(row.get("resPenetrationRate")),
                   "nfip_penetration_sfha": _pct(row.get("resPenetrationRateSfha"))}
            if any(v is not None for v in rec.values()):
                data[fips] = rec
    if rows < min_rows:
        raise SourceUnavailable("penetration file has %d rows, expected about 3,150" % rows)
    return data, rows, as_of or None


def load(ctx):
    path, _ = ctx.fetch(URL, "penetration.csv", timeout=120, min_bytes=1000)
    data, rows, as_of = parse(path)
    return {"as_of": as_of, "rows": rows, "data": data,
            "note": "Counties where FEMA could not count structures are blank."}
