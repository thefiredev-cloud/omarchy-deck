"""GSA Inventory of Owned and Leased Properties, leased buildings: federal tenancy and lease expiry per ZIP. Source tag: gsa."""
import datetime

import _federal_layers as fed
from ctx import SourceUnavailable

SOURCE = {
    "id": "gsa_iolp",
    "name": "GSA federal leased space, vacancy and lease expiry",
    "publisher": "US General Services Administration",
    "homepage": "https://www.gsa.gov/real-estate/real-estate-services/real-property-management/inventory-of-owned-and-leased-properties",
    "level": "zip",
    "group": "commercial",
    "cadence": "monthly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "gsa_leased_rsf": {"label": "Federal leased space", "unit": "sqft", "agg": "sum"},
        "gsa_leases": {"label": "Federal leases", "unit": "count", "agg": "sum"},
        "gsa_vacant_rsf": {"label": "Vacant space in federally leased buildings", "unit": "sqft", "agg": "sum"},
        "gsa_expiring_24m_share": {"label": "Federal leased space expiring within 2 years", "unit": "pct",
                                   "agg": "pop_weighted_mean", "metric": "commercial_risk", "better": "lower"},
    },
}
LAYER = "https://services1.arcgis.com/eBupDfPlEJK3mdAm/arcgis/rest/services/IOLP_NEW/FeatureServer/1"
FIELDS = "LEASE_NUM,ZIPCODE5,BUILDING_RSF,BLD_VACANT_RSF,LEASE_EXPIRATION_DATE,Latitude,Longitude"


def aggregate(rows, today=None, locate=None):
    """Lease rows -> (data, rows used). A lease already past its end date is still in the inventory (holdover), so it counts as expiring."""
    today = today or datetime.date.today()
    horizon = fed.add_years(today, 2)
    acc, used = {}, 0
    for row in rows:
        z, _ = fed.zip_of(row, ("ZIPCODE5",), locate, lat="Latitude", lon="Longitude")
        rsf = row.get("BUILDING_RSF")
        if not z or not rsf or rsf <= 0:
            continue
        used += 1
        rec = acc.setdefault(z, {"rsf": 0.0, "leases": set(), "n": 0, "vacant": 0.0, "expiring": 0.0, "dated": 0.0})
        rec["rsf"] += rsf
        rec["n"] += 1
        rec["leases"].add(row.get("LEASE_NUM") or id(row))
        rec["vacant"] += row.get("BLD_VACANT_RSF") or 0
        end = fed.parse_day(row.get("LEASE_EXPIRATION_DATE"))
        if end:
            rec["dated"] += rsf
            if end <= horizon:
                rec["expiring"] += rsf
    data = {}
    for z, rec in acc.items():
        data[z] = {
            "gsa_leased_rsf": int(round(rec["rsf"])),
            "gsa_leases": len(rec["leases"]),
            "gsa_vacant_rsf": int(round(rec["vacant"])),
            "gsa_expiring_24m_share": round(100.0 * rec["expiring"] / rec["dated"], 1) if rec["dated"] else None,
        }
    return data, used


def parse(path):
    """Saved ArcGIS response of the lease layer -> (data, rows, as_of)."""
    rows = fed.read_features(path)
    data, used = aggregate(rows)
    if not data:
        raise SourceUnavailable("GSA lease response had no usable leases")
    return data, len(rows), None


def load(ctx):
    rows = list(ctx.arcgis(LAYER, fields=FIELDS, page=2000, order_by="OBJECTID"))
    data, used = aggregate(rows, locate=ctx.nearest_zip)
    if len(rows) < 3000 or used < 0.9 * len(rows):
        raise SourceUnavailable("GSA lease layer gave %d rows, %d usable" % (len(rows), used))
    as_of = fed.layer_as_of(ctx, LAYER, datetime.date.today().isoformat())
    return {"as_of": as_of, "rows": len(rows), "data": data,
            "note": "Leases past their end date are still in the inventory and count as expiring. Rent is not published."}
