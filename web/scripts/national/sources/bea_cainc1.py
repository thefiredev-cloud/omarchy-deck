"""BEA Regional Accounts, table CAINC1: personal income, population and per-capita personal income by county.
Level "county". Reads the bulk `CAINC1.zip` (no API key) and its all-areas CSV. State and national rows (FIPS ending
000) are dropped; BEA's combined independent-city areas keep BEA's own 5-digit code."""
import _bea
from ctx import SourceUnavailable

SOURCE = {
    "id": "bea_cainc1",
    "name": "BEA personal income and per-capita income by county",
    "publisher": "US Bureau of Economic Analysis",
    "homepage": "https://www.bea.gov/data/income-saving/personal-income-county-metro-and-other-areas",
    "level": "county",
    "group": "people",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "bea_per_capita_income": {"label": "Per-capita personal income", "unit": "usd", "agg": "pop_weighted_mean",
                                  "better": "higher", "xwalk": "assign"},
        "bea_per_capita_income_yoy": {"label": "Per-capita income growth, last year", "unit": "pct", "agg": "pop_weighted_mean",
                                      "better": "higher", "xwalk": "assign", "metric": "income_trend"},
        "bea_per_capita_income_5y_cagr": {"label": "Per-capita income growth, yearly average over 5 years", "unit": "pct",
                                          "agg": "pop_weighted_mean", "better": "higher", "xwalk": "assign"},
        "bea_personal_income": {"label": "Total personal income", "unit": "usd", "agg": "sum"},
    },
}

URL = "https://apps.bea.gov/regional/zip/CAINC1.zip"
MIN_COUNTIES = 2500  # about 3,100 areas
HIST_POINTS = 20


def parse(path):
    """-> (data by county FIPS, area row count, latest year, hist of per-capita income)."""
    raw_rows, years = _bea.read_lines(path, ("1", "3"))
    latest = _bea.latest_year(raw_rows, "3", years)
    data, hist = {}, {}
    for fips, rec in raw_rows.items():
        pci, income = rec.get("3") or {}, rec.get("1") or {}
        now, before, five = pci.get(latest), pci.get(latest - 1), pci.get(latest - 5)
        total = income.get(latest)
        data[fips] = {
            "bea_per_capita_income": now,
            "bea_per_capita_income_yoy": round((now / before - 1) * 100, 2) if now and before else None,
            "bea_per_capita_income_5y_cagr": round(((now / five) ** (1 / 5) - 1) * 100, 2) if now and five else None,
            "bea_personal_income": int(total * 1000) if total is not None else None,
        }
        series = [[str(y), pci[y]] for y in sorted(pci) if pci[y] is not None and y <= latest][-HIST_POINTS:]
        if series:
            hist[fips] = {"bea_per_capita_income": series}
    if len(data) < MIN_COUNTIES:
        raise SourceUnavailable("BEA CAINC1 holds only %d county areas (expected about 3,100)" % len(data))
    return data, len(data), latest, hist


def load(ctx):
    path, _ = ctx.fetch(URL, "CAINC1.zip")
    data, rows, latest, hist = parse(path)
    return {"as_of": str(latest), "rows": rows, "data": data, "hist": hist}
