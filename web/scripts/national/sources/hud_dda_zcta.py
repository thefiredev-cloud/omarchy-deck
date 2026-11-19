"""HUD Difficult Development Areas, metropolitan ZCTAs (LIHTC basis boost). Source tag: dda.
Only metro ZIP codes are listed; non-metro DDAs are whole counties and are not in this workbook."""
import re

import _xlsx
from ctx import SourceUnavailable, zfill_zip

SOURCE = {
    "id": "hud_dda_zcta",
    "name": "HUD Difficult Development Areas (metro ZIP areas)",
    "publisher": "HUD Office of Policy Development and Research",
    "homepage": "https://www.huduser.gov/portal/datasets/qct.html",
    "level": "zip",
    "group": "commercial",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "dda_flag": {"label": "Difficult Development Area (tax credit boost)", "unit": "flag", "agg": "none",
                     "metric": "incentives"},
    },
}
URL = "https://www.huduser.gov/portal/datasets/qct/%d-DDAs-Data-Used-to-Designate.xlsx"


def parse(path):
    """Workbook -> (data, rows, as_of). First sheet: one row per metro ZCTA with the SDDA flag (1 or 0)."""
    data, rows, zcol, fcol, year = {}, 0, None, None, None
    for row in _xlsx.read_xlsx_rows(path, sheet=1):
        if zcol is None:
            z_at = next((i for i, c in enumerate(row) if c and "ZCTA" in c and "Population" not in c), None)
            f_at = next((i for i, c in enumerate(row) if c and re.search(r"SDDA.*1=SDDA", c)), None)
            if z_at is not None and f_at is not None:
                zcol, fcol = z_at, f_at
                match = re.match(r"(\d{4})", row[f_at].strip())
                year = match.group(1) if match else None
            continue
        if len(row) <= max(zcol, fcol) or not row[zcol]:
            continue
        z = zfill_zip(row[zcol])
        flag = row[fcol]
        if not z or flag not in ("0", "1", "0.0", "1.0"):
            continue
        rows += 1
        data[z] = {"dda_flag": max(int(float(flag)), data.get(z, {}).get("dda_flag", 0))}  # a ZCTA can sit in two metro areas
    if not data or fcol is None:
        raise SourceUnavailable("DDA workbook has no ZCTA flag table")
    return data, rows, year


def load(ctx):
    url, path, _ = ctx.first([URL % y for y in (ctx.year + 1, ctx.year, ctx.year - 1)], "dda.xlsx", timeout=180)
    data, rows, year = parse(path)
    if rows < 1000:
        raise SourceUnavailable("DDA workbook listed only %d ZCTAs" % rows)
    return {"as_of": year or re.search(r"/(\d{4})-DDAs", url).group(1), "rows": rows, "data": data,
            "note": "Metro ZIP areas only. A ZIP not listed here may still sit in a non-metro county DDA."}
