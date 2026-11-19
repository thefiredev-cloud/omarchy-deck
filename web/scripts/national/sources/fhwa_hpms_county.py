"""FHWA Highway Performance Monitoring System: traffic counts (AADT) on arterial roads, county statistics. Source tag: hpms.
One grouped-statistics query per state layer (HPMS_FULL_<ST>_<YEAR>), newest year that answers; no road segments are downloaded."""
import json
import urllib.parse

from ctx import SourceUnavailable, num

SOURCE = {
    "id": "fhwa_hpms_county",
    "name": "FHWA HPMS road traffic counts, county statistics",
    "publisher": "US DOT Federal Highway Administration",
    "homepage": "https://www.fhwa.dot.gov/policyinformation/hpms.cfm",
    "level": "county",
    "native": "county",
    "group": "commercial",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "hpms_aadt_max": {"label": "Busiest road, cars per day (county)", "unit": "count", "agg": "pop_weighted_mean",
                          "metric": "traffic", "xwalk": "assign", "better": "higher"},
        "hpms_aadt_arterial_avg": {"label": "Average arterial traffic, cars per day (county)", "unit": "count",
                                   "agg": "pop_weighted_mean", "metric": "traffic", "xwalk": "assign", "better": "higher"},
        "hpms_truck_aadt_max": {"label": "Busiest truck route, trucks per day (county)", "unit": "count",
                                "agg": "pop_weighted_mean", "xwalk": "assign", "better": "higher"},
    },
}
BASE = "https://geo.dot.gov/server/rest/services/Hosted/HPMS_FULL_%s_%d/FeatureServer/0"
STATES = {"AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08", "CT": "09", "DE": "10", "DC": "11", "FL": "12",
          "GA": "13", "HI": "15", "ID": "16", "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21", "LA": "22", "ME": "23",
          "MD": "24", "MA": "25", "MI": "26", "MN": "27", "MS": "28", "MO": "29", "MT": "30", "NE": "31", "NV": "32", "NH": "33",
          "NJ": "34", "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39", "OK": "40", "OR": "41", "PA": "42", "RI": "44",
          "SC": "45", "SD": "46", "TN": "47", "TX": "48", "UT": "49", "VT": "50", "VA": "51", "WA": "53", "WV": "54", "WI": "55",
          "WY": "56"}
STATS = json.dumps([
    {"statisticType": "max", "onStatisticField": "aadt", "outStatisticFieldName": "aadt_max"},
    {"statisticType": "avg", "onStatisticField": "aadt", "outStatisticFieldName": "aadt_avg"},
    {"statisticType": "max", "onStatisticField": "aadt_combination", "outStatisticFieldName": "truck_max"},
    {"statisticType": "count", "onStatisticField": "objectid", "outStatisticFieldName": "n"},
])


def _url(state, year):
    params = {"where": "f_system<=4", "groupByFieldsForStatistics": "state_id,county_id", "outStatistics": STATS, "f": "json"}
    return (BASE % (state, year)) + "/query?" + urllib.parse.urlencode(params)


def parse(path):
    """Saved statistics response of one state layer -> (data, rows, as_of). Road classes 1 to 4: interstates, freeways, arterials."""
    with open(path, encoding="utf8") as fh:
        try:
            body = json.load(fh)
        except ValueError as exc:
            raise SourceUnavailable("not JSON (%s)" % str(exc)[:60])
    if body.get("error"):
        raise SourceUnavailable("ArcGIS error %s" % str(body["error"].get("message") or body["error"])[:80])
    if "features" not in body:
        raise SourceUnavailable("HPMS answer has no features")
    data, rows = {}, 0
    for feat in body["features"]:
        row = feat.get("attributes") or {}
        state, county = num(row.get("state_id")), num(row.get("county_id"))
        rows += 1
        if state is None or county is None or county <= 0:
            continue
        aadt_max, aadt_avg, truck = num(row.get("aadt_max")), num(row.get("aadt_avg")), num(row.get("truck_max"))
        data["%02d%03d" % (state, county)] = {
            "hpms_aadt_max": int(aadt_max) if aadt_max else None,
            "hpms_aadt_arterial_avg": int(round(aadt_avg)) if aadt_avg else None,
            "hpms_truck_aadt_max": int(truck) if truck else None,
        }
    if not data:
        raise SourceUnavailable("HPMS answer had no counties")
    return data, rows, None


def load(ctx):
    import os
    data, rows, years, missing = {}, 0, {}, []
    for state in STATES:
        for year in (ctx.year - 1, ctx.year - 2):
            try:
                path, _ = ctx.fetch(_url(state, year), "hpms_%s_%d.json" % (state, year), timeout=600, min_bytes=40)
                got, n, _ = parse(path)
            except SourceUnavailable as exc:
                ctx.log("%s %d: %s" % (state, year, exc))
                try:  # never keep an unusable answer as a good copy
                    os.unlink(os.path.join(ctx.cache_dir, "hpms_%s_%d.json" % (state, year)))
                except OSError:
                    pass
                continue
            data.update(got)
            rows += n
            years[state] = year
            break
        else:
            missing.append(state)
    if len(years) < 45 or len(data) < 2800:
        raise SourceUnavailable("HPMS answered for only %d states and %d counties" % (len(years), len(data)))
    newest = max(years.values())
    older = sorted(s for s, y in years.items() if y < newest)
    note = "Newest year each state has published."
    if older:
        note += " %d states are still on %d: %s." % (len(older), newest - 1, ", ".join(older))
    if missing:
        note += " No data for %s." % ", ".join(sorted(missing))
    return {"as_of": str(newest), "rows": rows, "data": data, "note": note}
