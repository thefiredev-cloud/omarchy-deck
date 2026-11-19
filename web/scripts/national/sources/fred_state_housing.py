"""FHFA all-transactions state house price index changes from keyless FRED CSVs."""
from time import sleep

import _fred
from ctx import SourceUnavailable

STATES = ("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC").split()
SOURCE = {
    "id": "fred_state_housing", "name": "FHFA all-transactions house price index by state",
    "publisher": "Federal Housing Finance Agency, via FRED", "homepage": "https://fred.stlouisfed.org/",
    "level": "state", "group": "residential", "cadence": "quarterly",
    "license": "FRED terms of use; FHFA public data", "key_env": None,
    "fields": {"fsh_hpi_yoy": {"label": "FHFA house price index change, 1 year", "unit": "pct", "agg": "pop_weighted_mean"},
               "fsh_hpi_5y": {"label": "FHFA house price index change, 5 years", "unit": "pct", "agg": "pop_weighted_mean"}},
}


def parse(path, series):
    points = _fred.read_points(path, series)
    # FRED state FHFA all-transactions indexes are quarterly. Compare exact year-ago and 5-year quarters.
    latest = points[-1]
    dated = {date[:7]: value for date, value in points}
    year, quarter = int(latest[0][:4]), (int(latest[0][5:7]) - 1) // 3 + 1
    values = {"fsh_hpi_yoy": None, "fsh_hpi_5y": None}
    for field, back in (("fsh_hpi_yoy", 4), ("fsh_hpi_5y", 20)):
        index = year * 4 + quarter - 1 - back
        y, q = index // 4, index % 4 + 1
        old = dated.get("%04d-%02d" % (y, (q - 1) * 3 + 1))
        if old:
            values[field] = round((latest[1] / old - 1) * 100, 2)
    return latest[0], values


def load(ctx):
    data, as_of = {}, None
    for state in STATES:
        series = state + "STHPI"
        try:
            path, _ = ctx.fetch(_fred.URL % series, series + ".csv", timeout=60)
            date, values = parse(path, series)
            if values["fsh_hpi_yoy"] is not None:
                data[state] = values
                as_of = max(as_of or date, date)
        except SourceUnavailable:
            continue
        sleep(0.26)
    if len(data) < 50:
        raise SourceUnavailable("FRED state FHFA HPI produced only %d state rows" % len(data))
    return {"as_of": as_of, "rows": len(data), "data": data}
