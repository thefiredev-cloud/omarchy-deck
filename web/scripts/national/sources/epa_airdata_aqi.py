"""EPA AirData annual Air Quality Index summary by county (monitored counties only)."""
import csv
import io
import zipfile

import _counties
from ctx import SourceUnavailable, num

SOURCE = {
    "id": "epa_airdata_aqi",
    "name": "EPA AirData annual air quality by county",
    "publisher": "US EPA",
    "homepage": "https://aqs.epa.gov/aqsweb/airdata/download_files.html",
    "level": "county",
    "group": "risk",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "aqi_median": {"label": "Median air quality index (county)", "unit": "index", "agg": "pop_weighted_mean",
                       "metric": "health", "xwalk": "assign", "better": "lower"},
        "aqi_p90": {"label": "Air quality index on the 90th worst day (county)", "unit": "index",
                    "agg": "pop_weighted_mean", "xwalk": "assign", "better": "lower"},
        "aqi_unhealthy_days": {"label": "Days air was unhealthy for sensitive groups or worse (county)",
                               "unit": "days", "agg": "pop_weighted_mean", "xwalk": "assign", "better": "lower"},
        "aqi_good_share": {"label": "Days with good air (county)", "unit": "pct", "agg": "pop_weighted_mean",
                           "xwalk": "assign", "better": "higher"},
    },
}
URL = "https://aqs.epa.gov/aqsweb/airdata/annual_aqi_by_county_%d.zip"
MIN_ROWS = 500  # about 990 monitored counties


def parse(path, counties, min_rows=MIN_ROWS):
    """AirData zip + county list -> ({county fips: {field: value}}, rows, as_of).
    EPA names counties; a name that matches no county (Mexican border sites, spelling) is dropped and counted in the note."""
    index = {}
    for fips, info in counties.items():
        index.setdefault((info["state"], info["key"]), []).append(fips)
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        raise SourceUnavailable("AirData download is not a zip file")
    data, rows, years = {}, 0, set()
    with zf:
        with zf.open(zf.namelist()[0]) as raw:
            reader = csv.DictReader(io.TextIOWrapper(raw, encoding="latin-1", newline=""))
            if not {"State", "County", "Year", "Days with AQI", "Median AQI"} <= set(reader.fieldnames or []):
                raise SourceUnavailable("AirData file has unexpected columns")
            for row in reader:
                rows += 1
                state = _counties.STATE_USPS.get((row.get("State") or "").strip())
                fips = index.get((state, _counties.norm(row.get("County"))), [])
                if len(fips) != 1:
                    continue  # no match, or two counties share a normalised name: never guess
                days = num(row.get("Days with AQI"))
                if not days:
                    continue
                unhealthy = sum(num(row.get(col)) or 0 for col in (
                    "Unhealthy for Sensitive Groups Days", "Unhealthy Days", "Very Unhealthy Days", "Hazardous Days"))
                good = num(row.get("Good Days"))
                data[fips[0]] = {
                    "aqi_median": num(row.get("Median AQI")),
                    "aqi_p90": num(row.get("90th Percentile AQI")),
                    "aqi_unhealthy_days": int(unhealthy),
                    "aqi_good_share": round(100.0 * good / days, 1) if good is not None else None,
                }
                if num(row.get("Year")):
                    years.add(str(int(num(row.get("Year")))))
    if rows < min_rows or len(data) < rows * 0.8:
        raise SourceUnavailable("AirData matched %d of %d rows to counties" % (len(data), rows))
    return data, rows, max(years) if years else None


def load(ctx):
    counties = _counties.counties(ctx)
    # the newest complete year: EPA also posts a partial file for the current year
    years = [ctx.year - 1, ctx.year - 2, ctx.year - 3]
    _, path, _ = ctx.first([URL % y for y in years], "annual_aqi_by_county.zip", min_bytes=1000, timeout=120)
    data, rows, as_of = parse(path, counties)
    return {"as_of": as_of, "rows": rows, "data": data,
            "note": "Only counties with an air monitor report; the others stay blank."}
