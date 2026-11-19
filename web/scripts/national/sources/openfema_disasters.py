"""FEMA disaster declarations by county (OpenFEMA v2): distinct declared disasters in the last 10 and 20 years, by hazard type."""
import csv

import _counties
import _openfema
from ctx import SourceUnavailable

SOURCE = {
    "id": "openfema_disasters",
    "name": "FEMA disaster declarations by county, last 10 and 20 years",
    "publisher": "FEMA (OpenFEMA)",
    "homepage": "https://www.fema.gov/openfema-data-page/disaster-declarations-summaries-v2",
    "level": "county",
    "group": "risk",
    "cadence": "daily",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "fema_disasters_10y": {"label": "Federal disaster declarations, last 10 years (county)", "unit": "count",
                               "agg": "pop_weighted_mean", "metric": "climate_risk", "xwalk": "assign",
                               "better": "lower"},
        "fema_disasters_20y": {"label": "Federal disaster declarations, last 20 years (county)", "unit": "count",
                               "agg": "pop_weighted_mean", "xwalk": "assign", "better": "lower"},
        "fema_fire_10y": {"label": "Fire declarations, last 10 years (county)", "unit": "count",
                          "agg": "pop_weighted_mean", "xwalk": "assign", "better": "lower"},
        "fema_flood_10y": {"label": "Flood declarations, last 10 years (county)", "unit": "count",
                           "agg": "pop_weighted_mean", "xwalk": "assign", "better": "lower"},
        "fema_hurricane_10y": {"label": "Hurricane and tropical storm declarations, last 10 years (county)",
                               "unit": "count", "agg": "pop_weighted_mean", "xwalk": "assign", "better": "lower"},
        "fema_storm_10y": {"label": "Severe storm, tornado and winter storm declarations, last 10 years (county)",
                           "unit": "count", "agg": "pop_weighted_mean", "xwalk": "assign", "better": "lower"},
        "fema_quake_10y": {"label": "Earthquake, tsunami and volcano declarations, last 10 years (county)",
                           "unit": "count", "agg": "pop_weighted_mean", "xwalk": "assign", "better": "lower"},
        "fema_last_declared": {"label": "Most recent declaration (county)", "unit": "date", "agg": "none",
                               "xwalk": "assign"},
    },
}
ENTITY = "v2/DisasterDeclarationsSummaries"
SELECT = "id,disasterNumber,declarationType,declarationDate,incidentType,fipsStateCode,fipsCountyCode,designatedArea"
TOP = 10000
MIN_ROWS = 20000  # about 45,000 county-level rows in 20 years
GROUPS = {
    "fema_fire_10y": {"Fire"},
    "fema_flood_10y": {"Flood", "Dam/Levee Break"},
    "fema_hurricane_10y": {"Hurricane", "Tropical Storm", "Typhoon", "Tropical Depression"},
    "fema_storm_10y": {"Severe Storm", "Tornado", "Straight-Line Winds", "Severe Ice Storm", "Winter Storm",
                       "Snowstorm", "Freezing", "Coastal Storm"},
    "fema_quake_10y": {"Earthquake", "Tsunami", "Volcanic Eruption"},
}
EXCLUDED = {"Biological", "Chemical", "Terrorist", "Toxic Substances"}  # not natural hazards (the 2020 pandemic covered every county)


def parse(paths, counties, since10, since20, min_rows=MIN_ROWS):
    """Declaration csv pages + county list -> ({county fips: {field: value}}, rows, as_of).
    Counts distinct disaster numbers per county. A county code of 000 is tribal land except the rare 'Statewide' row,
    which applies to every county of the state. `since10` and `since20` are ISO dates."""
    by_state = {}
    for fips, info in counties.items():
        by_state.setdefault(fips[:2], []).append(fips)
    seen = {}  # (county, disaster number) -> (date, incident type)
    rows, newest = 0, ""
    for path in paths:
        with open(path, newline="", encoding="utf8") as fh:
            reader = csv.DictReader(fh)
            if not {"disasterNumber", "declarationDate", "incidentType", "fipsStateCode", "fipsCountyCode",
                    "designatedArea"} <= set(reader.fieldnames or []):
                raise SourceUnavailable("FEMA declarations page has unexpected columns")
            for row in reader:
                rows += 1
                day = (row.get("declarationDate") or "")[:10]
                if not day or day < since20 or (row.get("incidentType") or "") in EXCLUDED:
                    continue
                state, county = (row.get("fipsStateCode") or "").zfill(2), (row.get("fipsCountyCode") or "").zfill(3)
                if county == "000":
                    targets = by_state.get(state, []) if (row.get("designatedArea") or "").strip() == "Statewide" else []
                else:
                    targets = [state + county]
                for fips in targets:
                    if fips in counties:
                        seen[(fips, row["disasterNumber"])] = (day, row.get("incidentType") or "")
                newest = max(newest, day)
    if rows < min_rows:
        raise SourceUnavailable("FEMA declarations window has %d rows, expected about 45,000" % rows)
    data = {fips: {"fema_disasters_10y": 0, "fema_disasters_20y": 0, **{k: 0 for k in GROUPS},
                   "fema_last_declared": None} for fips in counties}
    for (fips, _), (day, kind) in seen.items():
        rec = data[fips]
        rec["fema_disasters_20y"] += 1
        if rec["fema_last_declared"] is None or day > rec["fema_last_declared"]:
            rec["fema_last_declared"] = day
        if day >= since10:
            rec["fema_disasters_10y"] += 1
            for field, kinds in GROUPS.items():
                if kind in kinds:
                    rec[field] += 1
    return data, rows, newest or None


def load(ctx):
    counties = _counties.counties(ctx)
    since20 = "%04d-01-01" % (ctx.year - 20)
    since10 = "%04d-01-01" % (ctx.year - 10)
    flt = "declarationDate ge '%s'" % since20
    paths = list(_openfema.skip_pages(ctx, ENTITY, SELECT, flt, "id", "declarations", TOP, 20 * 3600))
    data, rows, as_of = parse(paths, counties, since10, since20)
    return {"as_of": as_of, "rows": rows, "data": data,
            "note": "Counts distinct declared disasters per county since %s; biological declarations such as the 2020 pandemic are left out. A zero is a county with no declaration." % since10}
