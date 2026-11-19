"""Census HVS annual state vacancy and homeownership measures."""
import _hvs
from ctx import SourceUnavailable

TABLES = (
    ("hvs_rental_vacancy", "https://www.census.gov/housing/hvs/data/rates/tab1_state05_2026_rvr.xlsx"),
    ("hvs_homeowner_vacancy", "https://www.census.gov/housing/hvs/data/rates/tab2_state05_2026_hvr.xlsx"),
    ("hvs_homeownership", "https://www.census.gov/housing/hvs/data/rates/tab3_state05_2026_hmr.xlsx"),
)

SOURCE = {
    "id": "census_hvs_state", "name": "Census Housing Vacancies and Homeownership by state",
    "publisher": "US Census Bureau", "homepage": "https://www.census.gov/housing/hvs/data/rates.html",
    "level": "state", "group": "residential", "cadence": "quarterly",
    "license": "Public domain (US government work)", "key_env": None,
    "fields": {field: {"label": label, "unit": "pct", "agg": "pop_weighted_mean"} for field, label in (
        ("hvs_rental_vacancy", "Rental vacancy rate"), ("hvs_homeowner_vacancy", "Homeowner vacancy rate"),
        ("hvs_homeownership", "Homeownership rate"))},
}


def parse(path, field, history=False):
    return _hvs.parse_table(path, field, "state", history)


def load(ctx):
    data, hist, dates, row_count = {}, {}, [], 0
    notes = []
    for field, url in TABLES:
        filename = url.rsplit("/", 1)[-1]
        try:
            path, _ = ctx.fetch(url, filename, timeout=60, min_bytes=1000)
            parsed, history, date = parse(path, field, field == "hvs_rental_vacancy")
            data = _merge(data, parsed)
            hist.update(history)
            dates.append(str(date or ""))
            row_count += len(parsed)
        except Exception as exc:
            if field != "hvs_rental_vacancy":
                raise SourceUnavailable("Census HVS state table %s failed: %s" % (field, exc))
            notes.append("HVS rental vacancy table unavailable; FRED fallback used: %s" % exc)
            fallback = _fred_rental_vacancy(ctx)
            for state, values in fallback.items():
                data.setdefault(state, {}).update(values)
            dates.append("FRED")
    if len(data) < 50:
        raise SourceUnavailable("Census HVS state tables produced only %d state rows" % len(data))
    result = {"as_of": max(dates), "rows": row_count, "data": data}
    if hist:
        result["hist"] = hist
    if notes:
        result["note"] = notes[0]
    return result


def _merge(target, incoming):
    for key, values in incoming.items():
        target.setdefault(key, {}).update(values)
    return target


def _fred_rental_vacancy(ctx):
    import _fred
    from time import sleep
    out = {}
    for state in _state_codes():
        series = state + "RVAC"
        try:
            path, _ = ctx.fetch(_fred.URL % series, series + ".csv", timeout=60)
            points = _fred.read_points(path, series)
            out[state] = {"hvs_rental_vacancy": points[-1][1]}
            sleep(0.26)
        except SourceUnavailable:
            continue
    if len(out) < 50:
        raise SourceUnavailable("FRED state rental-vacancy fallback returned only %d states" % len(out))
    return out


def _state_codes():
    return ("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC").split()
