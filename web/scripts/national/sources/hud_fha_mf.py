"""HUD FHA-insured multifamily properties: insured apartment homes per ZIP. Source tag: fha."""
import _federal_layers as fed
from ctx import SourceUnavailable, num

SOURCE = {
    "id": "hud_fha_mf",
    "name": "HUD FHA-insured multifamily properties",
    "publisher": "US Department of Housing and Urban Development",
    "homepage": "https://hudgis-hud.opendata.arcgis.com/datasets/HUD::hud-insured-multifamily-properties",
    "level": "zip",
    "group": "commercial",
    "cadence": "monthly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "fha_mf_units": {"label": "FHA-insured apartment homes", "unit": "count", "agg": "sum"},
        "fha_mf_properties": {"label": "FHA-insured apartment properties", "unit": "count", "agg": "sum"},
    },
}
LAYER = "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/HUD_Insured_Multifamily_Properties/FeatureServer/0"
FIELDS = "PROPERTY_NAME_TEXT,STD_ZIP5,TOTAL_UNIT_COUNT,LAT,LON"


def aggregate(rows, locate=None):
    acc, used = {}, 0
    for row in rows:
        z, _ = fed.zip_of(row, ("STD_ZIP5",), locate)
        units = num(row.get("TOTAL_UNIT_COUNT"))
        if not z or units is None or units <= 0:
            continue
        used += 1
        rec = acc.setdefault(z, {"fha_mf_units": 0, "fha_mf_properties": 0})
        rec["fha_mf_units"] += int(units)
        rec["fha_mf_properties"] += 1
    return acc, used


def parse(path):
    rows = fed.read_features(path)
    data, _ = aggregate(rows)
    if not data:
        raise SourceUnavailable("FHA multifamily response had no usable properties")
    return data, len(rows), None


def load(ctx):
    rows = list(ctx.arcgis(LAYER, fields=FIELDS, page=2000, order_by=None))
    data, used = aggregate(rows, locate=ctx.nearest_zip)
    if len(rows) < 10000 or used < 0.8 * len(rows):
        raise SourceUnavailable("FHA multifamily layer gave %d rows, %d usable" % (len(rows), used))
    import datetime
    as_of = fed.layer_as_of(ctx, LAYER, datetime.date.today().isoformat())
    return {"as_of": as_of, "rows": len(rows), "data": data}
