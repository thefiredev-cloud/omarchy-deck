"""Census experimental Monthly State Retail Sales year-over-year changes."""
import csv
import re

from ctx import SourceUnavailable, num

URL = "https://www.census.gov/retail/mrts/www/statedata/state_retail_yy.csv"

SOURCE = {
    "id": "census_msrs_state",
    "name": "Census Monthly State Retail Sales (experimental)",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/retail/state_retail_sales.html",
    "level": "state",
    "group": "commercial",
    "cadence": "monthly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "msrs_retail_sales_yoy": {"label": "Retail sales change excluding nonstore retailers", "unit": "pct", "agg": "none"},
        "msrs_general_merch_yoy": {"label": "General merchandise sales change", "unit": "pct", "agg": "none"},
    },
}

STATE_FIPS = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT",
    "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL",
    "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD",
    "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE",
    "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
    "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
    "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV",
    "55": "WI", "56": "WY",
}
MONTH_RE = re.compile(r"^yy(\d{4})(\d{2})$")


def parse(path):
    """Return latest total retail changes and their 36-month state histories."""
    with open(path, encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        if not reader.fieldnames or not {"fips", "naics"}.issubset(reader.fieldnames):
            raise SourceUnavailable("MSRS CSV header changed")
        periods = sorted((m.group(1) + "-" + m.group(2), name)
                         for name in reader.fieldnames if (m := MONTH_RE.fullmatch(name)))
        if not periods:
            raise SourceUnavailable("MSRS CSV has no monthly columns")
        periods = periods[-36:]
        current_period = periods[-1][0]
        values = {}
        rows = 0
        for row in reader:
            rows += 1
            fips = (row.get("fips") or "").zfill(2)
            state = STATE_FIPS.get(fips)
            if state is None or row.get("naics") not in ("TOTAL", "452"):
                continue
            field = "msrs_retail_sales_yoy" if row["naics"] == "TOTAL" else "msrs_general_merch_yoy"
            history = []
            for period, column in periods:
                value = num(row.get(column))
                if value is not None:
                    history.append([period, value])
            record = values.setdefault(state, {})
            record[field] = history[-1][1] if history and history[-1][0] == current_period else None
            if field == "msrs_retail_sales_yoy":
                record.setdefault("_history", {})[field] = history
    if not values:
        raise SourceUnavailable("MSRS CSV contained no state observations")
    hist = {}
    for state, record in values.items():
        history = record.pop("_history", {}).get("msrs_retail_sales_yoy")
        if history:
            hist[state] = {"msrs_retail_sales_yoy": history}
    return values, rows, current_period, hist


def load(ctx):
    path, _ = ctx.fetch(URL, "state_retail_yy.csv", min_age=20 * 3600)
    data, rows, as_of, hist = parse(path)
    return {
        "as_of": as_of,
        "rows": rows,
        "data": data,
        "hist": hist,
        "note": "Experimental year-over-year changes exclude nonstore retailers. The publisher does not publish nonstore or food-services series in this file.",
    }
