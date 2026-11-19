"""BLS Local Area Unemployment Statistics (LAUS), county, not seasonally adjusted. Level "county".
Reads the keyless "latest 14 months" workbook (`laucntycur14.zip`, one xlsx inside) instead of the rate-limited API, so
no BLS_API_KEY is needed and the daily API cap is never touched. Months the BLS could not publish show a dash and are
missing here. The newest month is the one most counties report."""
import io
import re
import zipfile

import _xlsx
from ctx import SourceUnavailable, num

SOURCE = {
    "id": "bls_laus_county",
    "name": "BLS local area unemployment by county",
    "publisher": "US Bureau of Labor Statistics",
    "homepage": "https://www.bls.gov/lau/",
    "level": "county",
    "group": "commercial",
    "cadence": "monthly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "laus_unemployment": {"label": "Unemployment rate (county)", "unit": "pct", "agg": "pop_weighted_mean", "better": "lower",
                              "xwalk": "mean", "metric": "unemployment"},
        "laus_unemployment_yoy_pts": {"label": "Unemployment rate change from a year earlier (county)", "unit": "pct_pts",
                                      "agg": "pop_weighted_mean", "better": "lower", "xwalk": "mean"},
        "laus_labor_force": {"label": "Labor force (county share)", "unit": "count", "agg": "sum", "xwalk": "sum"},
    },
}

URL = "https://www.bls.gov/web/metro/laucntycur14.zip"
BLS_UA = {"User-Agent": "pixel-deck-feed (read-only; tanner@meshvault.ai)"}  # BLS asks automated callers to identify themselves
MIN_COUNTIES = 2500
MONTHS = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


def _period(text):
    """'Sep-26' or 'Sep-26 p' (preliminary) -> (2026, 9), or None."""
    m = re.fullmatch(r"([A-Z][a-z]{2})-(\d{2})(?: p)?", (text or "").strip())
    return (2000 + int(m.group(2)), MONTHS[m.group(1)]) if m and m.group(1) in MONTHS else None


def parse(path):
    """-> (data by county FIPS, row count, (year, month) of the newest month, hist of the unemployment rate)."""
    try:
        with zipfile.ZipFile(path) as zf:
            names = [n for n in zf.namelist() if n.lower().endswith(".xlsx")]
            if not names:
                raise SourceUnavailable("the LAUS zip holds no workbook")
            book = io.BytesIO(zf.read(names[0]))
    except zipfile.BadZipFile:
        raise SourceUnavailable("the LAUS download is not a zip file")
    header, rows, series = None, 0, {}
    for row in (["" if c is None else c for c in r] for r in _xlsx.read_xlsx_rows(book)):
        if header is None:
            if "Period" in row and "Labor Force" in row:
                header = {name.strip(): i for i, name in enumerate(row)}
                rate_col = next((i for n, i in header.items() if n.replace("-", "").startswith("Unemployment Rate")), None)
                if rate_col is None:
                    raise SourceUnavailable("the LAUS workbook has no unemployment rate column")
            continue
        if len(row) <= max(header["County FIPS Code"], header["Period"], header["Labor Force"], rate_col):
            continue
        state, county = row[header["State FIPS Code"]].strip(), row[header["County FIPS Code"]].strip()
        period = _period(row[header["Period"]])
        if not (state.isdigit() and county.isdigit() and period):
            continue
        rows += 1
        series.setdefault(state.zfill(2) + county.zfill(3), {})[period] = (num(row[header["Labor Force"]]), num(row[rate_col]))
    if header is None or len(series) < MIN_COUNTIES:
        raise SourceUnavailable("the LAUS workbook holds %d counties (expected about 3,140)" % len(series))
    counts = {}
    for periods in series.values():
        for p, (_, rate) in periods.items():
            if rate is not None:
                counts[p] = counts.get(p, 0) + 1
    newest = max((p for p, n in counts.items() if n > 0.8 * len(series)), default=None)
    if newest is None:
        raise SourceUnavailable("no LAUS month is reported by most counties")
    earlier = (newest[0] - 1, newest[1])
    data, hist = {}, {}
    for fips, periods in series.items():
        lf, rate = periods.get(newest, (None, None))
        before = periods.get(earlier, (None, None))[1]
        data[fips] = {
            "laus_unemployment": None if rate is None else round(rate, 1),
            "laus_unemployment_yoy_pts": round(rate - before, 1) if rate is not None and before is not None else None,
            "laus_labor_force": None if lf is None else int(lf),
        }
        points = [["%d-%02d" % p, round(v[1], 1)] for p, v in sorted(periods.items()) if v[1] is not None]
        if points:
            hist[fips] = {"laus_unemployment": points}
    return data, rows, newest, hist


def load(ctx):
    path, _ = ctx.fetch(URL, "laucntycur14.zip", headers=BLS_UA)
    data, rows, newest, hist = parse(path)
    return {"as_of": "%d-%02d" % newest, "rows": rows, "data": data, "hist": hist,
            "note": "Not seasonally adjusted and preliminary for the newest months; counties the BLS could not publish are missing."}
