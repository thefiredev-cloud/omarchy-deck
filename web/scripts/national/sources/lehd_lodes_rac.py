"""LEHD LODES8 residence area characteristics (RAC): employed residents by where they live, summed from census blocks
to ZIP through the publisher's own block-to-ZCTA crosswalk. Level "zip", native geography "block". Job type JT00 (all
jobs), segment S000 (all workers). Earnings bands are monthly: CE01 up to $1,250, CE02 $1,251 to $3,333, CE03 more
than $3,333. Age bands: CA01 up to 29, CA02 30 to 54, CA03 55 and over."""
import _lodes
from ctx import SourceUnavailable

SOURCE = {
    "id": "lehd_lodes_rac",
    "name": "LEHD LODES employed residents by home location",
    "publisher": "US Census Bureau, Longitudinal Employer-Household Dynamics",
    "homepage": "https://lehd.ces.census.gov/data/",
    "level": "zip",
    "native": "block",
    "group": "people",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "lodes_res_workers": {"label": "Employed residents", "unit": "count", "agg": "sum"},
        "lodes_res_high_wage_share": {"label": "Employed residents earning $3,333 a month or more", "unit": "pct",
                                      "agg": "pop_weighted_mean", "better": "higher"},
        "lodes_res_low_wage_share": {"label": "Employed residents earning $1,250 a month or less", "unit": "pct",
                                     "agg": "pop_weighted_mean"},
        "lodes_res_young_share": {"label": "Employed residents aged 29 or under", "unit": "pct", "agg": "pop_weighted_mean"},
        "lodes_res_older_share": {"label": "Employed residents aged 55 or over", "unit": "pct", "agg": "pop_weighted_mean"},
    },
}

YEARS_BACK = 3


def _share(part, whole):
    return round(part / whole * 100, 2) if whole else None


def derive(sums):
    """Fields of one ZIP from its summed LODES columns. A ZIP with no resident workers gets no row."""
    total = sums["C000"]
    if not total:
        return None
    return {
        "lodes_res_workers": total,
        "lodes_res_high_wage_share": _share(sums["CE03"], total),
        "lodes_res_low_wage_share": _share(sums["CE01"], total),
        "lodes_res_young_share": _share(sums["CA01"], total),
        "lodes_res_older_share": _share(sums["CA03"], total),
    }


def build(by_zip):
    data = {}
    for z, sums in by_zip.items():
        row = derive(sums)
        if row:
            data[z] = row
    return data


def load(ctx):
    years = [ctx.year - n for n in range(1, YEARS_BACK + 1)]
    by_zip, blocks, lost, used = _lodes.run(ctx, "rac", years)
    if blocks < 3_000_000:  # only blocks with residents are listed: about 5.4 million
        raise SourceUnavailable("LODES residence files hold only %d blocks (expected about 5.4 million)" % blocks)
    data = build(by_zip)
    note = "Residents are counted where they live, summed from census blocks to ZIP code areas."
    if lost:
        note += " %d residents sit in blocks with no ZIP code area and are left out." % lost
    return {"as_of": str(max(used)), "rows": blocks, "data": data, "note": note}
