"""HUD Low-Income Housing Tax Credit properties: affordable apartment supply per ZIP. Source tag: lihtc."""
import datetime

import _federal_layers as fed
from ctx import SourceUnavailable, num

SOURCE = {
    "id": "hud_lihtc",
    "name": "HUD Low-Income Housing Tax Credit properties",
    "publisher": "US Department of Housing and Urban Development",
    "homepage": "https://www.huduser.gov/portal/datasets/lihtc.html",
    "level": "zip",
    "group": "commercial",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "lihtc_units": {"label": "Tax credit affordable homes", "unit": "count", "agg": "sum"},
        "lihtc_projects": {"label": "Tax credit projects", "unit": "count", "agg": "sum"},
        "lihtc_units_5y": {"label": "Tax credit homes placed in service, last 5 years", "unit": "count", "agg": "sum",
                           "metric": "new_supply"},
    },
}
LAYER = "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC/FeatureServer/0"
FIELDS = "HUD_ID,STD_ZIP5,PROJ_ZIP,LI_UNITS,N_UNITS,YR_PIS,LAT,LON"


def aggregate(rows, year=None, locate=None):
    """Project rows -> (data, rows used). Units are the low-income units; a project with none listed counts its total units."""
    year = year or datetime.date.today().year
    acc, used = {}, 0
    for row in rows:
        z, _ = fed.zip_of(row, ("STD_ZIP5", "PROJ_ZIP"), locate)
        units = num(row.get("LI_UNITS"))
        if units is None:
            units = num(row.get("N_UNITS"))
        if not z or units is None or units <= 0:
            continue
        used += 1
        rec = acc.setdefault(z, {"units": 0, "projects": 0, "recent": 0})
        rec["units"] += int(units)
        rec["projects"] += 1
        pis = num(row.get("YR_PIS"))  # the file uses 8888 and 9999 for unknown years
        if pis is not None and year - 5 <= pis <= year:
            rec["recent"] += int(units)
    data = {z: {"lihtc_units": r["units"], "lihtc_projects": r["projects"], "lihtc_units_5y": r["recent"]} for z, r in acc.items()}
    return data, used


def parse(path):
    rows = fed.read_features(path)
    data, _ = aggregate(rows)
    if not data:
        raise SourceUnavailable("LIHTC response had no usable projects")
    return data, len(rows), None


def load(ctx):
    rows = list(ctx.arcgis(LAYER, fields=FIELDS, page=2000, order_by="OBJECTID"))
    data, used = aggregate(rows, locate=ctx.nearest_zip)
    if len(rows) < 30000 or used < 0.9 * len(rows):
        raise SourceUnavailable("LIHTC layer gave %d rows, %d usable" % (len(rows), used))
    years = [int(y) for y in (num(r.get("YR_PIS")) for r in rows) if y and 1986 <= y <= ctx.year]
    as_of = fed.layer_as_of(ctx, LAYER, str(max(years)))
    return {"as_of": as_of, "rows": len(rows), "data": data,
            "note": "HUD adds projects with a lag; the newest placed-in-service year in the file is %d." % max(years)}
