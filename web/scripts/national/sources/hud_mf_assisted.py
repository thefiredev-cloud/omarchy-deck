"""HUD assisted multifamily properties (Section 8 and similar): assisted apartment homes and contract expiry per ZIP. Source tag: hud."""
import datetime

import _federal_layers as fed
from ctx import SourceUnavailable, num

SOURCE = {
    "id": "hud_mf_assisted",
    "name": "HUD assisted multifamily properties",
    "publisher": "US Department of Housing and Urban Development",
    "homepage": "https://hudgis-hud.opendata.arcgis.com/datasets/HUD::multifamily-properties-assisted",
    "level": "zip",
    "group": "commercial",
    "cadence": "monthly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "hud_assisted_units": {"label": "HUD-assisted apartment homes", "unit": "count", "agg": "sum"},
        "hud_assisted_properties": {"label": "HUD-assisted apartment properties", "unit": "count", "agg": "sum"},
        "hud_contracts_expiring_5y": {"label": "Assistance contracts expiring within 5 years", "unit": "count", "agg": "sum"},
    },
}
LAYER = "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/MULTIFAMILY_PROPERTIES_ASSISTED/FeatureServer/0"
FIELDS = "PROPERTY_ID,STD_ZIP5,TOTAL_ASSISTED_UNIT_COUNT,EXPIRATION_DATE1,EXPIRATION_DATE2,LAT,LON"


def aggregate(rows, today=None, locate=None):
    """A property counts once toward expiring contracts per contract date that falls between today and five years out."""
    today = today or datetime.date.today()
    horizon = fed.add_years(today, 5)
    acc, used = {}, 0
    for row in rows:
        z, _ = fed.zip_of(row, ("STD_ZIP5",), locate)
        units = num(row.get("TOTAL_ASSISTED_UNIT_COUNT"))
        if not z or units is None or units <= 0:
            continue
        used += 1
        rec = acc.setdefault(z, {"hud_assisted_units": 0, "hud_assisted_properties": 0, "hud_contracts_expiring_5y": 0})
        rec["hud_assisted_units"] += int(units)
        rec["hud_assisted_properties"] += 1
        for field in ("EXPIRATION_DATE1", "EXPIRATION_DATE2"):
            end = fed.parse_day(row.get(field))
            if end and today <= end <= horizon:
                rec["hud_contracts_expiring_5y"] += 1
    return acc, used


def parse(path):
    rows = fed.read_features(path)
    data, _ = aggregate(rows)
    if not data:
        raise SourceUnavailable("HUD assisted response had no usable properties")
    return data, len(rows), None


def load(ctx):
    rows = list(ctx.arcgis(LAYER, fields=FIELDS, page=2000, order_by="OBJECTID"))
    data, used = aggregate(rows, locate=ctx.nearest_zip)
    if len(rows) < 15000 or used < 0.8 * len(rows):
        raise SourceUnavailable("HUD assisted layer gave %d rows, %d usable" % (len(rows), used))
    as_of = fed.layer_as_of(ctx, LAYER, datetime.date.today().isoformat())
    return {"as_of": as_of, "rows": len(rows), "data": data,
            "note": "Contracts already past their end date are not counted as expiring."}
