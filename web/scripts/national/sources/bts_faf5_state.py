"""BTS FAF5 freight flows summarized to domestic state zones."""
import csv
import io
import zipfile

from ctx import SourceUnavailable, num

URL = "https://faf.ornl.gov/faf5/Data/Download_Files/FAF5.7.1.zip"
MEMBER = "FAF5.7.1.csv"
BASE_YEAR = "2017"
FORECAST_YEAR = "2050"

SOURCE = {
    "id": "bts_faf5_state",
    "name": "BTS Freight Analysis Framework 5.7.1 by state",
    "publisher": "Bureau of Transportation Statistics and Federal Highway Administration",
    "homepage": "https://www.bts.gov/faf/faf5",
    "level": "state",
    "group": "commercial",
    "side": "commercial",
    "cadence": "periodic",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "faf_tons": {"label": "Freight tons originating or terminating here", "unit": "count", "agg": "sum"},
        "faf_value": {"label": "Freight value originating or terminating here", "unit": "usd", "agg": "sum"},
        "faf_value_growth": {"label": "Freight value growth to 2050", "unit": "pct", "agg": "none"},
        "faf_truck_share": {"label": "Truck share of freight tons", "unit": "pct", "agg": "none"},
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
STATE_ZONES = {fips + "0": state for fips, state in STATE_FIPS.items()}
YEARS = ("2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2030", "2035", "2040", "2045", "2050")


def parse(path):
    """Stream the zipped FAF CSV and return state aggregates, rows, and base year."""
    totals = {state: {"tons": 0.0, "value": 0.0, "forecast": 0.0, "truck_tons": 0.0}
              for state in STATE_ZONES.values()}
    matched = set()
    rows = 0
    try:
        with zipfile.ZipFile(path) as archive:
            try:
                member = archive.open(MEMBER)
            except KeyError as exc:
                raise SourceUnavailable("FAF5 archive has no FAF5.7.1.csv member") from exc
            with member, io.TextIOWrapper(member, encoding="utf-8-sig", newline="") as text:
                reader = csv.DictReader(text)
                required = {"dms_orig", "dms_dest", "dms_mode", "tons_2017", "tons_2050", "value_2017", "value_2050"}
                if not reader.fieldnames or not required.issubset(reader.fieldnames):
                    raise SourceUnavailable("FAF5 CSV header changed")
                for row in reader:
                    rows += 1
                    origin, destination = row["dms_orig"].zfill(3), row["dms_dest"].zfill(3)
                    states = {STATE_FIPS[zone[:2]] for zone in (origin, destination) if zone[:2] in STATE_FIPS}
                    if not states:
                        continue
                    tons = num(row.get("tons_2017"))
                    value = num(row.get("value_2017"))
                    forecast = num(row.get("value_2050"))
                    truck = row.get("dms_mode") == "1"
                    for state in states:
                        matched.add(state)
                        entry = totals[state]
                        if tons is not None:
                            entry["tons"] += tons
                            if truck:
                                entry["truck_tons"] += tons
                        if value is not None:
                            entry["value"] += value
                        if forecast is not None:
                            entry["forecast"] += forecast
    except (OSError, zipfile.BadZipFile) as exc:
        raise SourceUnavailable("FAF5 archive could not be read: %s" % exc) from exc
    if not matched:
        raise SourceUnavailable("FAF5 CSV had no domestic state-zone flows")
    data = {}
    for state in sorted(matched):
        item = totals[state]
        base_value = item["value"]
        far_value = item["forecast"]
        data[state] = {
            "faf_tons": round(item["tons"] * 1000) if item["tons"] else None,
            "faf_value": round(base_value * 1_000_000) if base_value else None,
            "faf_value_growth": round(((far_value / base_value) ** (1 / (int(FORECAST_YEAR) - int(BASE_YEAR))) - 1) * 100, 4)
            if base_value > 0 and far_value > 0 else None,
            "faf_truck_share": round(item["truck_tons"] / item["tons"] * 100, 4) if item["tons"] > 0 else None,
        }
    return data, rows, BASE_YEAR


def load(ctx):
    path, _ = ctx.fetch(URL, "FAF5.7.1.zip", min_age=7 * 86400, timeout=600)
    data, rows, as_of = parse(path)
    if len(data) < 45:
        raise SourceUnavailable("FAF5 covered only %d domestic state zones" % len(data))
    return {
        "as_of": as_of,
        "rows": rows,
        "data": data,
        "note": "2017 tons and value are FAF estimates; value is in constant 2017 dollars. Growth compares 2017 with the 2050 baseline forecast. State totals include FAF domestic zones with the state's two-digit FIPS prefix.",
    }
