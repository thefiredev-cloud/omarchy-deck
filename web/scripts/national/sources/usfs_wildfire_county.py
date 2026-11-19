"""USDA Forest Service Wildfire Risk to Communities: county wildfire likelihood and risk to homes (national percentiles)."""
import zipfile

import _xlsx
from ctx import SourceUnavailable, num

SOURCE = {
    "id": "usfs_wildfire_county",
    "name": "USDA Forest Service Wildfire Risk to Communities by county",
    "publisher": "USDA Forest Service",
    "homepage": "https://wildfirerisk.org/download/",
    "level": "county",
    "group": "risk",
    "cadence": "static",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "usfs_risk_to_homes": {"label": "Wildfire risk to homes (county percentile)", "unit": "score",
                               "agg": "pop_weighted_mean", "metric": "climate_risk", "xwalk": "mean",
                               "better": "lower"},
        "usfs_likelihood": {"label": "Wildfire likelihood (county percentile)", "unit": "score",
                            "agg": "pop_weighted_mean", "xwalk": "mean", "better": "lower"},
        "usfs_direct_exposure": {"label": "Homes with direct wildfire exposure (county)", "unit": "pct",
                                 "agg": "pop_weighted_mean", "xwalk": "mean", "better": "lower"},
    },
}
URL = "https://wildfirerisk.org/wp-content/uploads/2026/04/wrc_download_20260415.xlsx"
SHEET = "Counties"
AS_OF = "2026-04-15"
MIN_ROWS = 2500  # about 3,100 counties


def _pct(raw):
    val = num(raw)
    return None if val is None else round(val * 100.0, 1)  # the workbook stores 0 to 1 ranks and shares


def parse(path, min_rows=MIN_ROWS):
    """Workbook -> ({county fips: {field: value}}, rows, as_of), from the Counties sheet."""
    try:
        position = _xlsx.sheet_names(path).index(SHEET) + 1
    except ValueError:
        raise SourceUnavailable("wildfire workbook has no %s sheet" % SHEET)
    except (zipfile.BadZipFile, KeyError):
        raise SourceUnavailable("download is not an xlsx workbook")
    rows_iter = _xlsx.read_xlsx_rows(path, position)
    head = next(rows_iter, None)
    need = ("GEOID", "RISK_NATIONAL_RANK", "BP_NATIONAL_RANK", "BUILDINGS_FRACTION_DE")
    if not head or not all(col in head for col in need):
        raise SourceUnavailable("wildfire workbook Counties sheet has unexpected columns")
    idx = {name: head.index(name) for name in need}
    data, count = {}, 0
    for row in rows_iter:
        count += 1
        get = lambda name: row[idx[name]] if idx[name] < len(row) else None  # noqa: E731
        geoid = (get("GEOID") or "").strip()
        if not geoid.isdigit():
            continue
        rec = {"usfs_risk_to_homes": _pct(get("RISK_NATIONAL_RANK")), "usfs_likelihood": _pct(get("BP_NATIONAL_RANK")),
               "usfs_direct_exposure": _pct(get("BUILDINGS_FRACTION_DE"))}
        if any(v is not None for v in rec.values()):
            data[geoid.zfill(5)] = rec
    if count < min_rows:
        raise SourceUnavailable("wildfire workbook has %d counties, expected about 3,100" % count)
    return data, count, AS_OF


def load(ctx):
    path, _ = ctx.fetch(URL, "wrc_download_20260415.xlsx", timeout=180, min_bytes=100000, min_age=30 * 86400)
    data, rows, as_of = parse(path)
    return {"as_of": as_of, "rows": rows, "data": data,
            "note": "County percentiles compare each county with all US counties; the workbook is a single 2026-04-15 release."}
