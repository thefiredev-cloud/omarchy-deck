"""FEMA/ORNL USA Structures: building count and footprint area by use, per county. Source tag: bldg.
Asks the ArcGIS server for grouped statistics only (never downloads buildings): 4 queries per state, 52 states, about 200 requests.
SQFEET is the footprint of the building, not floor area, and the fields say so."""
import json
import urllib.parse

from ctx import SourceUnavailable, num

SOURCE = {
    "id": "usa_structures_county",
    "name": "FEMA USA Structures, buildings by use per county",
    "publisher": "FEMA / Oak Ridge National Laboratory",
    "homepage": "https://gis-fema.hub.arcgis.com/pages/usa-structures",
    "level": "county",
    "native": "county",
    "group": "commercial",
    "cadence": "static",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "bldg_commercial_sqft": {"label": "Commercial building footprint (county share)", "unit": "sqft", "agg": "sum",
                                 "metric": "stock_commercial_sqft", "xwalk": "sum"},
        "bldg_industrial_sqft": {"label": "Industrial building footprint (county share)", "unit": "sqft", "agg": "sum",
                                 "metric": "stock_industrial_sqft", "xwalk": "sum"},
        "bldg_commercial_count": {"label": "Commercial buildings (county share)", "unit": "count", "agg": "sum", "xwalk": "sum"},
        "bldg_industrial_count": {"label": "Industrial buildings (county share)", "unit": "count", "agg": "sum", "xwalk": "sum"},
        "bldg_retail_sqft": {"label": "Retail building footprint (county share)", "unit": "sqft", "agg": "sum", "xwalk": "sum"},
        "bldg_retail_count": {"label": "Retail buildings (county share)", "unit": "count", "agg": "sum", "xwalk": "sum"},
        "bldg_office_sqft": {"label": "Office building footprint (county share)", "unit": "sqft", "agg": "sum", "xwalk": "sum"},
        "bldg_office_count": {"label": "Office buildings (county share)", "unit": "count", "agg": "sum", "xwalk": "sum"},
        "bldg_warehouse_sqft": {"label": "Wholesale and warehouse building footprint (county share)", "unit": "sqft", "agg": "sum",
                                "xwalk": "sum"},
        "bldg_warehouse_count": {"label": "Wholesale and warehouse buildings (county share)", "unit": "count", "agg": "sum",
                                 "xwalk": "sum"},
        "bldg_multifamily_sqft": {"label": "Apartment building footprint (county share)", "unit": "sqft", "agg": "sum",
                                  "xwalk": "sum"},
        "bldg_multifamily_count": {"label": "Apartment buildings (county share)", "unit": "count", "agg": "sum", "xwalk": "sum"},
        "bldg_hotel_sqft": {"label": "Hotel and lodging building footprint (county share)", "unit": "sqft", "agg": "sum",
                            "xwalk": "sum"},
        "bldg_hotel_count": {"label": "Hotel and lodging buildings (county share)", "unit": "count", "agg": "sum", "xwalk": "sum"},
    },
}
LAYER = "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0"
STATES = ("01", "02", "04", "05", "06", "08", "09", "10", "11", "12", "13", "15", "16", "17", "18", "19", "20", "21", "22", "23",
          "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "41", "42", "44",
          "45", "46", "47", "48", "49", "50", "51", "53", "54", "55", "56", "72")
STATS = json.dumps([{"statisticType": "count", "onStatisticField": "OBJECTID", "outStatisticFieldName": "n"},
                    {"statisticType": "sum", "onStatisticField": "SQFEET", "outStatisticFieldName": "sqft"}])
# one grouped query each: where clause, group-by fields
QUERIES = {
    "commercial": ("OCC_CLS='Commercial'", "FIPS,PRIM_OCC"),
    "industrial": ("OCC_CLS='Industrial'", "FIPS"),
    "multifamily": ("OCC_CLS='Residential' AND PRIM_OCC LIKE 'Multi%'", "FIPS"),
    "lodging": ("OCC_CLS='Residential' AND PRIM_OCC='Temporary Lodging'", "FIPS"),
}
OFFICE = ("Professional/Technical Services",)
RETAIL = ("Retail Trade",)
WAREHOUSE = ("Wholesale Trade",)


def _url(state, name, offset=0):
    where, group = QUERIES[name]
    params = {"where": "FIPS LIKE '%s%%' AND %s" % (state, where), "groupByFieldsForStatistics": group, "outStatistics": STATS,
              "f": "json"}
    if offset:
        params["resultOffset"] = offset
    return LAYER + "/query?" + urllib.parse.urlencode(params)


def _rows(body, name):
    if body.get("error"):
        raise SourceUnavailable("ArcGIS error %s for %s" % (str(body["error"].get("details") or body["error"])[:80], name))
    if "features" not in body:
        raise SourceUnavailable("USA Structures %s answer has no features" % name)
    return [f.get("attributes") or {} for f in body["features"]]


def aggregate(answers):
    """{query name: attribute rows} -> data[county FIPS]. A county that shows up in any answer but not in one has none of that use."""
    acc = {}

    def cell(fips):
        return acc.setdefault(fips, {k: 0 for k in SOURCE["fields"]})

    for row in answers.get("commercial", []):
        fips, prim = str(row.get("FIPS") or ""), (row.get("PRIM_OCC") or "").strip()
        n, sqft = num(row.get("n")), num(row.get("sqft"))
        if len(fips) != 5 or n is None:
            continue
        rec = cell(fips)
        rec["bldg_commercial_count"] += int(n)
        rec["bldg_commercial_sqft"] += int(round(sqft or 0))
        for use, names in (("retail", RETAIL), ("office", OFFICE), ("warehouse", WAREHOUSE)):
            if prim in names:
                rec["bldg_%s_count" % use] += int(n)
                rec["bldg_%s_sqft" % use] += int(round(sqft or 0))
    for name, use in (("industrial", "industrial"), ("multifamily", "multifamily"), ("lodging", "hotel")):
        for row in answers.get(name, []):
            fips, n, sqft = str(row.get("FIPS") or ""), num(row.get("n")), num(row.get("sqft"))
            if len(fips) != 5 or n is None:
                continue
            rec = cell(fips)
            rec["bldg_%s_count" % use] += int(n)
            rec["bldg_%s_sqft" % use] += int(round(sqft or 0))
    return acc


def parse(path):
    """A saved bundle {query name: ArcGIS statistics response} -> (data, rows, as_of)."""
    with open(path, encoding="utf8") as fh:
        try:
            bundle = json.load(fh)
        except ValueError as exc:
            raise SourceUnavailable("not JSON (%s)" % str(exc)[:60])
    answers = {name: _rows(body, name) for name, body in bundle.items()}
    data = aggregate(answers)
    if not data:
        raise SourceUnavailable("USA Structures answers had no counties")
    return data, sum(len(v) for v in answers.values()), None


def load(ctx):
    answers = {name: [] for name in QUERIES}
    for state in STATES:
        for name in QUERIES:
            offset = 0
            while True:
                body = ctx.get_json(_url(state, name, offset), "structures_%s_%s_%d.json" % (state, name, offset), timeout=600)
                rows = _rows(body, name)
                answers[name].extend(rows)
                if not (body.get("exceededTransferLimit") and rows):
                    break
                offset += len(rows)
    data = aggregate(answers)
    if len(data) < 3000:
        raise SourceUnavailable("USA Structures covered only %d counties" % len(data))
    info = ctx.get_json(LAYER + "?f=json", "layer_info.json", timeout=60)
    import datetime
    edited = ((info.get("editingInfo") or {}).get("lastEditDate"))
    as_of = datetime.datetime.fromtimestamp(edited / 1000.0, datetime.timezone.utc).date().isoformat() if edited else str(ctx.year)
    return {"as_of": as_of, "rows": sum(len(v) for v in answers.values()), "data": data,
            "note": "Footprint area of buildings classed by use, not floor area. Retail, office and warehouse come from the primary occupancy label."}
