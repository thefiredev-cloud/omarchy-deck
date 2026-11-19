"""FAA National Airspace System Resources: operational airports and heliports per ZIP. Source tag: faa.
The 56-day NASR airport file as published by the Bureau of Transportation Statistics on its keyless ArcGIS service (about
19,400 sites). The file has a city and county but no ZIP, so each US site goes to the nearest ZIP centroid within 15 km;
counts are approximate for large rural ZIPs. Air access signal for logistics, hotel and office property."""
from ctx import SourceUnavailable

LAYER = "https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/NTAD_Aviation_Facilities/FeatureServer/0"
FIELDS = "EFF_DATE,SITE_TYPE_CODE,FACILITY_USE_CODE,ARPT_STATUS,COUNTRY_CODE,FAR_139_TYPE_CODE,TWR_TYPE_CODE,LAT_DECIMAL,LONG_DECIMAL"
MIN_SITES = 10000  # about 19,400 sites, 19,100 operational
MAX_KM = 15.0

SOURCE = {
    "id": "faa_airports",
    "name": "FAA airports and heliports by ZIP",
    "publisher": "Federal Aviation Administration (via BTS NTAD)",
    "homepage": "https://www.faa.gov/airports/airport_safety/airportdata_5010",
    "level": "zip",
    "native": "point",
    "group": "commercial",
    "side": "commercial",
    "cadence": "every 56 days",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "faa_public_airports": {"label": "Public-use airports", "unit": "count", "agg": "sum"},
        "faa_airline_airports": {"label": "Airports certified for scheduled airline service", "unit": "count", "agg": "sum"},
        "faa_towered_airports": {"label": "Airports with an air traffic control tower", "unit": "count", "agg": "sum"},
        "faa_heliports": {"label": "Heliports", "unit": "count", "agg": "sum"},
    },
}


def _date(text):
    """'2026/10/29' -> '2026-10-29'."""
    parts = (text or "").split("/")
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        return None
    return "%04d-%02d-%02d" % tuple(int(p) for p in parts)


def parse(rows, nearest):
    """ArcGIS attribute dicts and nearest(lat, lon) -> ZIP or None -> (data {zip: fields}, sites read, sites left out, effective date)."""
    if len(rows) < MIN_SITES:
        raise SourceUnavailable("FAA airport layer had %d sites, expected over %d" % (len(rows), MIN_SITES))
    data, dropped, dates = {}, 0, set()
    for row in rows:
        when = _date(row.get("EFF_DATE"))
        if when:
            dates.add(when)
        if (row.get("COUNTRY_CODE") or "") != "US" or (row.get("ARPT_STATUS") or "") != "O":
            continue
        kind, use = row.get("SITE_TYPE_CODE"), row.get("FACILITY_USE_CODE")
        flags = {
            "faa_public_airports": kind == "A" and use == "PU",
            "faa_airline_airports": bool((row.get("FAR_139_TYPE_CODE") or "").strip()),
            "faa_towered_airports": (row.get("TWR_TYPE_CODE") or "").startswith("ATCT"),
            "faa_heliports": kind == "H",
        }
        if not any(flags.values()):
            continue  # a private airstrip: no field to add to, so its ZIP stays missing rather than zero
        zipc = nearest(row.get("LAT_DECIMAL"), row.get("LONG_DECIMAL"))
        if not zipc:
            dropped += 1
            continue
        rec = data.setdefault(zipc, {"faa_public_airports": 0, "faa_airline_airports": 0, "faa_towered_airports": 0, "faa_heliports": 0})
        for name, hit in flags.items():
            if hit:
                rec[name] += 1
    if not dates:
        raise SourceUnavailable("FAA airport layer carries no effective date")
    return data, len(rows), dropped, max(dates)


def load(ctx):
    rows = list(ctx.arcgis(LAYER, fields=FIELDS, order_by="OBJECTID", min_age=3 * 86400))
    data, count, dropped, as_of = parse(rows, lambda lat, lon: ctx.nearest_zip(lat, lon, MAX_KM))
    note = ("Operational US sites only. The file has no ZIP, so each site sits on the nearest ZIP centroid within %d km%s."
            % (MAX_KM, "; %d sites had none that close and are left out" % dropped if dropped else ""))
    return {"as_of": as_of, "rows": count, "data": data, "note": note}
