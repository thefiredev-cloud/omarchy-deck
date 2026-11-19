"""BTS National Transportation Atlas Database: intermodal freight facilities per ZIP. Source tag: ntad.
Three keyless ArcGIS layers from the Bureau of Transportation Statistics: rail intermodal terminals (TOFC/COFC, 241, with a
ZIP), pipeline terminals (1,401, point only) and air-to-truck cargo transfer sites at airports (404, point only). Points without
a ZIP go to the nearest ZIP centroid within 15 km, so those two counts are approximate for large rural ZIPs."""
from ctx import SourceUnavailable, zfill_zip

BASE = "https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/NTAD_Intermodal_Freight_Facilities_%s/FeatureServer/0"
LAYERS = (
    # (layer, ArcGIS fields, field it adds to)
    ("Rail_TOFC_COFC", "TERMINAL,ZIP_CODE", "ntad_rail_terminals"),
    ("Pipeline_Terminals", "TERM_ID", "ntad_pipeline_terminals"),
    ("Air_to_Truck", "LOCID", "ntad_air_cargo_sites"),
)
MIN_ROWS = {"ntad_rail_terminals": 150, "ntad_pipeline_terminals": 800, "ntad_air_cargo_sites": 250}  # 241, 1,401, 404 today
MAX_KM = 15.0

SOURCE = {
    "id": "ntad_freight",
    "name": "BTS intermodal freight facilities by ZIP",
    "publisher": "Bureau of Transportation Statistics (US DOT)",
    "homepage": "https://www.bts.gov/ntad",
    "level": "zip",
    "native": "point",
    "group": "commercial",
    "side": "commercial",
    "cadence": "every few years",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "ntad_freight_facilities": {"label": "Freight transfer facilities (rail, pipeline, air cargo)", "unit": "count", "agg": "sum"},
        "ntad_rail_terminals": {"label": "Rail intermodal terminals", "unit": "count", "agg": "sum"},
        "ntad_pipeline_terminals": {"label": "Pipeline terminals", "unit": "count", "agg": "sum"},
        "ntad_air_cargo_sites": {"label": "Air cargo transfer sites at airports", "unit": "count", "agg": "sum"},
    },
}


def parse(layers, nearest):
    """{field: [ArcGIS attribute dicts with _lat/_lon]} and nearest(lat, lon) -> ZIP or None
    -> (data {zip: fields}, rows read, facilities left out for want of a ZIP)."""
    data, rows, dropped = {}, 0, 0
    for field, feats in layers.items():
        if len(feats) < MIN_ROWS[field]:
            raise SourceUnavailable("NTAD layer for %s had %d facilities, expected over %d" % (field, len(feats), MIN_ROWS[field]))
        for feat in feats:
            rows += 1
            zipc = zfill_zip((feat.get("ZIP_CODE") or "")[:5]) if feat.get("ZIP_CODE") else None
            if not zipc:
                zipc = nearest(feat.get("_lat"), feat.get("_lon"))
            if not zipc:
                dropped += 1
                continue
            rec = data.setdefault(zipc, {"ntad_freight_facilities": 0})
            rec["ntad_freight_facilities"] += 1
            rec[field] = rec.get(field, 0) + 1
    return data, rows, dropped


def load(ctx):
    layers = {}
    for layer, fields, field in LAYERS:
        feats = list(ctx.arcgis(BASE % layer, fields=fields, geometry=True, order_by="OBJECTID", min_age=7 * 86400))
        layers[field] = feats
    data, rows, dropped = parse(layers, lambda lat, lon: ctx.nearest_zip(lat, lon, MAX_KM))
    note = ("Layers were compiled by BTS in 2020 to 2022. Pipeline terminals and air cargo sites have no ZIP in the file, so they sit on the "
            "nearest ZIP centroid within %d km%s." % (MAX_KM, "; %d of %d facilities had none that close and are left out" % (dropped, rows) if dropped else ""))
    return {"as_of": "2020-2022", "rows": rows, "data": data, "note": note}
