"""FEMA National Risk Index v1.20 by census tract, read from the public ArcGIS feature layer (the county zip on fema.gov is walled)."""
import json

from ctx import SourceUnavailable, num

SOURCE = {
    "id": "fema_nri_tract",
    "name": "FEMA National Risk Index by census tract",
    "publisher": "FEMA",
    "homepage": "https://hazards.fema.gov/nri/",
    "level": "tract",
    "tract_vintage": 2020,
    "group": "risk",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "nri_risk_score": {"label": "Overall natural hazard risk", "unit": "score", "agg": "pop_weighted_mean",
                           "metric": "climate_risk", "xwalk": "mean", "better": "lower"},
        "nri_eal_rate_bldg": {"label": "Expected yearly building loss per $100 of value", "unit": "pct",
                              "agg": "pop_weighted_mean", "metric": "insurance_cost", "xwalk": "mean",
                              "better": "lower"},
        "nri_eal_total": {"label": "Expected yearly loss from natural hazards", "unit": "usd", "agg": "sum",
                          "xwalk": "sum", "better": "lower"},
        "nri_flood_score": {"label": "Flood risk (coastal or river, higher of the two)", "unit": "score",
                            "agg": "pop_weighted_mean", "metric": "flood_risk", "xwalk": "mean", "better": "lower"},
        "nri_wildfire_score": {"label": "Wildfire risk", "unit": "score", "agg": "pop_weighted_mean",
                               "metric": "climate_risk", "xwalk": "mean", "better": "lower"},
        "nri_heat_score": {"label": "Heat wave risk", "unit": "score", "agg": "pop_weighted_mean", "xwalk": "mean",
                           "better": "lower"},
        "nri_quake_score": {"label": "Earthquake risk", "unit": "score", "agg": "pop_weighted_mean", "xwalk": "mean",
                            "better": "lower"},
        "nri_wind_score": {"label": "Hurricane or tornado risk, higher of the two", "unit": "score",
                           "agg": "pop_weighted_mean", "xwalk": "mean", "better": "lower"},
        "nri_social_vuln": {"label": "Social vulnerability (NRI)", "unit": "score", "agg": "pop_weighted_mean",
                            "xwalk": "mean", "better": "lower"},
        "nri_resilience": {"label": "Community resilience (NRI)", "unit": "score", "agg": "pop_weighted_mean",
                           "xwalk": "mean", "better": "higher"},
        "nri_top_hazard": {"label": "Highest-scoring natural hazard", "unit": "text", "agg": "none", "xwalk": "assign"},
    },
}
LAYER = "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Census_Tracts/FeatureServer/0"
HAZARDS = {  # NRI hazard code -> plain name
    "AVLN": "Avalanche", "CFLD": "Coastal flooding", "CWAV": "Cold wave", "DRGT": "Drought", "ERQK": "Earthquake",
    "HAIL": "Hail", "HWAV": "Heat wave", "HRCN": "Hurricane", "ISTM": "Ice storm", "LNDS": "Landslide",
    "LTNG": "Lightning", "IFLD": "River flooding", "SWND": "Strong wind", "TRND": "Tornado", "TSUN": "Tsunami",
    "VLCN": "Volcanic activity", "WFIR": "Wildfire", "WNTW": "Winter weather",
}
OUT_FIELDS = ",".join(["TRACTFIPS", "POPULATION", "BUILDVALUE", "RISK_SCORE", "EAL_VALB", "EAL_VALT", "SOVI_SCORE",
                       "RESL_SCORE"] + [code + "_RISKS" for code in HAZARDS])
AS_OF = "v1.20 (December 2025)"
MIN_ROWS = 40000  # 85,154 tracts
CACHE_AGE = 30 * 86400  # the index is published once a year


def _best(*values):
    present = [v for v in values if v is not None]
    return round(max(present), 2) if present else None


def _round(val, places=2):
    return None if val is None else round(val, places)


def parse_rows(rows, min_rows=MIN_ROWS):
    """ArcGIS attribute dicts -> ({tract geoid: {field: value}}, rows, as_of)."""
    data, count = {}, 0
    for row in rows:
        count += 1
        geoid = str(row.get("TRACTFIPS") or "").strip()
        if len(geoid) != 11 or not geoid.isdigit():
            continue
        scores = {code: num(row.get(code + "_RISKS")) for code in HAZARDS}
        ranked = [(v, code) for code, v in scores.items() if v is not None and v > 0]
        top = HAZARDS[max(ranked, key=lambda pair: pair[0])[1]] if ranked else None
        value, eal = num(row.get("BUILDVALUE")), num(row.get("EAL_VALB"))
        total = num(row.get("EAL_VALT"))
        data[geoid] = {
            "nri_risk_score": _round(num(row.get("RISK_SCORE"))),
            "nri_eal_rate_bldg": round(100.0 * eal / value, 4) if value and value > 0 and eal is not None else None,
            "nri_eal_total": int(round(total)) if total is not None else None,
            "nri_flood_score": _best(scores["CFLD"], scores["IFLD"]),
            "nri_wildfire_score": _round(scores["WFIR"]),
            "nri_heat_score": _round(scores["HWAV"]),
            "nri_quake_score": _round(scores["ERQK"]),
            "nri_wind_score": _best(scores["HRCN"], scores["TRND"]),
            "nri_social_vuln": _round(num(row.get("SOVI_SCORE"))),
            "nri_resilience": _round(num(row.get("RESL_SCORE"))),
            "nri_top_hazard": top,
        }
    if count < min_rows:
        raise SourceUnavailable("NRI layer returned %d tracts, expected about 85,000" % count)
    return data, count, AS_OF


def parse(path, min_rows=MIN_ROWS):
    """A saved ArcGIS query result ({"features": [{"attributes": ...}]}) -> the same as parse_rows."""
    with open(path, encoding="utf8") as fh:
        try:
            body = json.load(fh)
        except ValueError:
            raise SourceUnavailable("NRI page is not JSON")
    return parse_rows((f.get("attributes") or {} for f in body.get("features") or []), min_rows)


def load(ctx):
    rows = ctx.arcgis(LAYER, fields=OUT_FIELDS, page=2000, order_by="OBJECTID", min_age=CACHE_AGE)
    data, count, as_of = parse_rows(rows)
    return {"as_of": as_of, "rows": count, "data": data,
            "note": "Scores run 0 to 100 and compare each tract with all US tracts; no-population tracts are included."}
