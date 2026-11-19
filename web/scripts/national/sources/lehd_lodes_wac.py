"""LEHD LODES8 workplace area characteristics (WAC): jobs by where the job is located, summed from census blocks to ZIP
through the publisher's own block-to-ZCTA crosswalk. Level "zip", native geography "block". Job type JT00 (all jobs),
segment S000 (all workers). Sector groups: office-using = information, finance, real estate, professional, management,
administrative (CNS09 to CNS14); retail CNS07; industrial = manufacturing, wholesale, transportation (CNS05, CNS06,
CNS08); hotel and food CNS18; health care CNS16. Jobs paying more than $3,333 a month are CE03."""
import _lodes
from ctx import SourceUnavailable

SOURCE = {
    "id": "lehd_lodes_wac",
    "name": "LEHD LODES jobs by workplace location and sector",
    "publisher": "US Census Bureau, Longitudinal Employer-Household Dynamics",
    "homepage": "https://lehd.ces.census.gov/data/",
    "level": "zip",
    "native": "block",
    "group": "commercial",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "lodes_jobs_total": {"label": "Jobs located here", "unit": "count", "agg": "sum", "better": "higher", "metric": "jobs_total"},
        "lodes_jobs_office": {"label": "Office-using jobs located here", "unit": "count", "agg": "sum", "better": "higher",
                              "metric": "jobs_office"},
        "lodes_jobs_retail": {"label": "Retail jobs located here", "unit": "count", "agg": "sum", "better": "higher",
                              "metric": "jobs_retail"},
        "lodes_jobs_industrial": {"label": "Industrial jobs located here", "unit": "count", "agg": "sum", "better": "higher",
                                  "metric": "jobs_industrial"},
        "lodes_jobs_hotel_food": {"label": "Hotel and food jobs located here", "unit": "count", "agg": "sum"},
        "lodes_jobs_health": {"label": "Health care jobs located here", "unit": "count", "agg": "sum"},
        "lodes_jobs_high_wage_share": {"label": "Jobs paying $3,333 a month or more", "unit": "pct", "agg": "pop_weighted_mean",
                                       "better": "higher"},
        "lodes_jobs_low_wage_share": {"label": "Jobs paying $1,250 a month or less", "unit": "pct", "agg": "pop_weighted_mean"},
        "lodes_jobs_office_share": {"label": "Office-using share of jobs", "unit": "pct", "agg": "pop_weighted_mean"},
    },
}

YEARS_BACK = 3  # newest file year to try is the current year minus one


def _share(part, whole):
    return round(part / whole * 100, 2) if whole else None


def derive(sums):
    """Fields of one ZIP from its summed LODES columns. A ZIP with no jobs gets no row."""
    total = sums["C000"]
    if not total:
        return None
    s = lambda *codes: sum(sums["CNS%02d" % c] for c in codes)  # noqa: E731
    office = s(9, 10, 11, 12, 13, 14)
    return {
        "lodes_jobs_total": total,
        "lodes_jobs_office": office,
        "lodes_jobs_retail": s(7),
        "lodes_jobs_industrial": s(5, 6, 8),
        "lodes_jobs_hotel_food": s(18),
        "lodes_jobs_health": s(16),
        "lodes_jobs_high_wage_share": _share(sums["CE03"], total),
        "lodes_jobs_low_wage_share": _share(sums["CE01"], total),
        "lodes_jobs_office_share": _share(office, total),
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
    by_zip, blocks, lost, used = _lodes.run(ctx, "wac", years)
    if blocks < 1_500_000:  # only blocks with jobs are listed: about 2.3 million
        raise SourceUnavailable("LODES workplace files hold only %d blocks (expected about 2.3 million)" % blocks)
    data = build(by_zip)
    note = "Jobs are counted where the workplace is, summed from census blocks to ZIP code areas."
    if lost:
        note += " %d jobs sit in blocks with no ZIP code area and are left out." % lost
    return {"as_of": str(max(used)), "rows": blocks, "data": data, "note": note}
