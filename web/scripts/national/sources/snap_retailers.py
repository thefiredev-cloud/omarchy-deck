"""USDA SNAP authorized retailers: grocery and food retail locations per ZIP. Source tag: snaprt.
Every store authorized to accept SNAP benefits (about 248,000), from the keyless USDA Food and Nutrition Service ArcGIS
layer, paged 2,000 at a time. Each record carries its own ZIP and a store type. Retail tenancy and food-anchor signal;
stores that do not take SNAP (many restaurants, specialty shops, some warehouse clubs) are not in the file."""
import time

from ctx import SourceUnavailable, zfill_zip

LAYER = "https://services1.arcgis.com/RLQu0rK7h4kbsBq5/arcgis/rest/services/snap_retailer_location_data/FeatureServer/0"
FIELDS = "Record_ID,Zip_Code,Store_Type"
MIN_STORES = 100000  # about 248,000 stores

SOURCE = {
    "id": "snap_retailers",
    "name": "USDA SNAP authorized retailers by ZIP",
    "publisher": "USDA Food and Nutrition Service",
    "homepage": "https://www.fns.usda.gov/snap/retailer/data",
    "level": "zip",
    "native": "zip",
    "group": "commercial",
    "side": "commercial",
    "cadence": "monthly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "snaprt_stores": {"label": "Food stores that accept SNAP", "unit": "count", "agg": "sum"},
        "snaprt_supermarkets": {"label": "Supermarkets and super stores", "unit": "count", "agg": "sum"},
        "snaprt_grocery": {"label": "Grocery stores", "unit": "count", "agg": "sum"},
        "snaprt_convenience": {"label": "Convenience stores", "unit": "count", "agg": "sum"},
    },
}

# Store_Type values in the file, by the field they add to
KIND = {"Supermarket": "snaprt_supermarkets", "Super Store": "snaprt_supermarkets",
        "Grocery Store": "snaprt_grocery", "Convenience Store": "snaprt_convenience"}


def parse(rows):
    """ArcGIS attribute dicts (Record_ID, Zip_Code, Store_Type) -> (data {zip: fields}, stores read).
    Duplicate Record_ID values across pages are dropped, so a page boundary that shifts cannot double count."""
    data, seen = {}, set()
    for row in rows:
        rid = row.get("Record_ID")
        zipc = zfill_zip((row.get("Zip_Code") or "").strip()[:5])
        if rid is None or rid in seen or not zipc:
            continue
        seen.add(rid)
        rec = data.setdefault(zipc, {"snaprt_stores": 0, "snaprt_supermarkets": 0, "snaprt_grocery": 0, "snaprt_convenience": 0})
        rec["snaprt_stores"] += 1
        kind = KIND.get((row.get("Store_Type") or "").strip())
        if kind:
            rec[kind] += 1
    if len(seen) < MIN_STORES:
        raise SourceUnavailable("SNAP retailer layer had %d stores with a ZIP, expected over %d" % (len(seen), MIN_STORES))
    return data, len(seen)


def load(ctx):
    meta = ctx.get_json(LAYER + "?f=json", "layer_meta.json", min_age=3600)
    edited = (meta.get("editingInfo") or {}).get("dataLastEditDate")
    if not edited:
        raise SourceUnavailable("SNAP retailer layer does not say when its data last changed")
    as_of = time.strftime("%Y-%m-%d", time.gmtime(edited / 1000))
    rows = ctx.arcgis(LAYER, fields=FIELDS, order_by="ObjectId", page=2000, pause=0.25, min_age=3 * 86400)
    data, count = parse(rows)
    note = "Stores authorized to accept SNAP only; a store without SNAP authorization is not counted. Store types as USDA labels them."
    return {"as_of": as_of, "rows": count, "data": data, "note": note}
