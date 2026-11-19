"""BEA Regional Accounts, table CAGDP2: gross domestic product by county, all industries (line 1), current dollars.
Level "county". Reads the bulk `CAGDP2.zip` (no API key). Growth is nominal (current dollars)."""
import _bea
from ctx import SourceUnavailable

SOURCE = {
    "id": "bea_cagdp2",
    "name": "BEA gross domestic product by county",
    "publisher": "US Bureau of Economic Analysis",
    "homepage": "https://www.bea.gov/data/gdp/gdp-county-metro-and-other-areas",
    "level": "county",
    "group": "commercial",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "bea_gdp": {"label": "County economic output (GDP)", "unit": "usd", "agg": "sum"},
        "bea_gdp_yoy": {"label": "County output growth, last year (current dollars)", "unit": "pct", "agg": "pop_weighted_mean",
                        "better": "higher", "xwalk": "assign"},
        "bea_gdp_5y": {"label": "County output growth, 5 years (current dollars)", "unit": "pct", "agg": "pop_weighted_mean",
                       "better": "higher", "xwalk": "assign", "metric": "business_growth"},
    },
}

URL = "https://apps.bea.gov/regional/zip/CAGDP2.zip"
MIN_COUNTIES = 2500  # about 3,100 areas


def parse(path):
    """-> (data by county FIPS, area count, latest year)."""
    rows, years = _bea.read_lines(path, ("1",))
    latest = _bea.latest_year(rows, "1", years)
    data = {}
    for fips, rec in rows.items():
        gdp = rec.get("1") or {}
        now, before, five = gdp.get(latest), gdp.get(latest - 1), gdp.get(latest - 5)
        data[fips] = {
            "bea_gdp": int(now * 1000) if now is not None else None,  # the file is in thousands of dollars
            "bea_gdp_yoy": round((now / before - 1) * 100, 2) if now and before else None,
            "bea_gdp_5y": round((now / five - 1) * 100, 2) if now and five else None,
        }
    if len(data) < MIN_COUNTIES:
        raise SourceUnavailable("BEA CAGDP2 holds only %d county areas (expected about 3,100)" % len(data))
    return data, len(data), latest


def load(ctx):
    path, _ = ctx.fetch(URL, "CAGDP2.zip", timeout=600)
    data, rows, latest = parse(path)
    return {"as_of": str(latest), "rows": rows, "data": data}
