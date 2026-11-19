"""HUD Fair Market Rents (the 40th percentile gross rent HUD uses for vouchers), county. Level "county".
The workbook has one row per county or, in New England, per town (10-digit `fips`: state, county, subdivision). Rows of
one county are averaged, weighted by the 2024 population column when the file has it."""
import _hud
from ctx import SourceUnavailable, num

SOURCE = {
    "id": "hud_fmr_county",
    "name": "HUD Fair Market Rents by county",
    "publisher": "HUD Office of Policy Development and Research",
    "homepage": "https://www.huduser.gov/portal/datasets/fmr.html",
    "level": "county",
    "group": "residential",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "hud_fmr_county_0br": {"label": "Fair market rent, studio (county)", "unit": "usd_month", "agg": "pop_weighted_median",
                               "xwalk": "mean"},
        "hud_fmr_county_1br": {"label": "Fair market rent, 1 bedroom (county)", "unit": "usd_month", "agg": "pop_weighted_median",
                               "xwalk": "mean"},
        "hud_fmr_county_2br": {"label": "Fair market rent, 2 bedrooms (county)", "unit": "usd_month", "agg": "pop_weighted_median",
                               "xwalk": "mean", "metric": "typical_rent"},
        "hud_fmr_county_3br": {"label": "Fair market rent, 3 bedrooms (county)", "unit": "usd_month", "agg": "pop_weighted_median",
                               "xwalk": "mean"},
        "hud_fmr_county_4br": {"label": "Fair market rent, 4 bedrooms (county)", "unit": "usd_month", "agg": "pop_weighted_median",
                               "xwalk": "mean"},
    },
}

URL = "https://www.huduser.gov/portal/datasets/fmr/fmr%d/FY%02d_FMRs.xlsx"
MIN_COUNTIES = 2500  # about 3,100 counties
BEDROOMS = {"fmr_%d" % n: "hud_fmr_county_%dbr" % n for n in range(5)}


def parse(path):
    """-> (data by county FIPS, workbook row count)."""
    header, rows, acc = None, 0, {}
    for row in _hud.rows(path):
        if header is None:
            if "fips" in row and "fmr_2" in row:
                header = {name.strip(): i for i, name in enumerate(row)}
            continue
        idx = header["fips"]
        fips = row[idx].strip() if idx < len(row) else ""
        if len(fips) != 10 or not fips.isdigit():
            continue
        rows += 1
        pop_i = header.get("pop2024")
        weight = num(row[pop_i]) if pop_i is not None and pop_i < len(row) else None
        weight = weight if weight and weight > 0 else 1.0
        rec = acc.setdefault(fips[:5], {})
        for col, field in BEDROOMS.items():
            value = num(row[header[col]]) if col in header and header[col] < len(row) else None
            if value is not None and value > 0:
                total, w = rec.get(field, (0.0, 0.0))
                rec[field] = (total + value * weight, w + weight)
    if header is None:
        raise SourceUnavailable("HUD FMR workbook has no fips and fmr_2 columns")
    data = {county: {f: round(t / w) for f, (t, w) in rec.items()} for county, rec in acc.items()}
    for row in data.values():
        for field in BEDROOMS.values():
            row.setdefault(field, None)
    if len(data) < MIN_COUNTIES:
        raise SourceUnavailable("HUD FMR workbook holds only %d counties (expected about 3,100)" % len(data))
    return data, rows


def load(ctx):
    # fiscal year FY27 is published in August 2026, so the next calendar year comes first
    urls = [URL % (y, y % 100) for y in (ctx.year + 1, ctx.year, ctx.year - 1)]
    url, path, _ = ctx.first(urls, "fmrs.xlsx")
    fy = int(url.split("/fmr/fmr")[1][:4])
    data, rows = parse(path)
    return {"as_of": "FY%d" % fy, "rows": rows, "data": data}
