"""HUD Section 8 income limits and area median family income, county. Level "county".
One workbook row per county or, in New England, per town (10-digit `fips`). Rows of one county are averaged."""
import _hud
from ctx import SourceUnavailable, num

SOURCE = {
    "id": "hud_income_limits",
    "name": "HUD income limits and area median family income by county",
    "publisher": "HUD Office of Policy Development and Research",
    "homepage": "https://www.huduser.gov/portal/datasets/il.html",
    "level": "county",
    "group": "people",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "hud_ami": {"label": "Area median family income", "unit": "usd", "agg": "pop_weighted_median", "better": "higher",
                    "xwalk": "mean", "metric": "income"},
        "hud_li_4p": {"label": "Low-income limit (80% of median), family of 4", "unit": "usd", "agg": "pop_weighted_median",
                      "xwalk": "mean"},
        "hud_vli_4p": {"label": "Very low-income limit (50% of median), family of 4", "unit": "usd", "agg": "pop_weighted_median",
                       "xwalk": "mean"},
    },
}

URL = "https://www.huduser.gov/portal/datasets/il/il%02d/Section8-FY%02d.xlsx"
MIN_COUNTIES = 2500
COLUMNS = {"hud_ami": "median", "hud_li_4p": "l80_4", "hud_vli_4p": "l50_4"}


def parse(path):
    """-> (data by county FIPS, row count, fiscal year of the median column)."""
    header, rows, acc, fy = None, 0, {}, None
    for row in _hud.rows(path):
        if header is None:
            if "fips" in row and "l50_4" in row and "l80_4" in row:
                header = {name.strip(): i for i, name in enumerate(row)}
                med = [n for n in header if n.startswith("median")]
                if not med:
                    raise SourceUnavailable("HUD income limits workbook has no median column")
                header["median"] = header[med[0]]
                fy = int(med[0][len("median"):])
            continue
        fips = row[header["fips"]].strip() if header["fips"] < len(row) else ""
        if len(fips) != 10 or not fips.isdigit():
            continue
        rows += 1
        rec = acc.setdefault(fips[:5], {})
        for field, col in COLUMNS.items():
            value = num(row[header[col]]) if header[col] < len(row) else None
            if value is not None and value > 0:
                total, n = rec.get(field, (0.0, 0))
                rec[field] = (total + value, n + 1)
    if header is None:
        raise SourceUnavailable("HUD income limits workbook has no fips and l50_4 columns")
    data = {c: {f: round(t / n) for f, (t, n) in rec.items()} for c, rec in acc.items()}
    for row in data.values():
        for field in COLUMNS:
            row.setdefault(field, None)
    if len(data) < MIN_COUNTIES:
        raise SourceUnavailable("HUD income limits workbook holds only %d counties (expected about 3,100)" % len(data))
    return data, rows, fy


def load(ctx):
    urls = [URL % (y % 100, y % 100) for y in (ctx.year + 1, ctx.year, ctx.year - 1)]
    _, path, _ = ctx.first(urls, "income_limits.xlsx")
    data, rows, fy = parse(path)
    return {"as_of": "FY%d" % fy, "rows": rows, "data": data}
