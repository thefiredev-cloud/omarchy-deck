"""Coast surf feed collector: Cabo San Lucas to the Columbia River.

fetch_all() talks to the public sources through the cached Fetcher; assemble() is pure and turns parsed
inputs into the overview and the 14 region files; write_outputs() writes them atomically with mode 600.
"""
import argparse
import collections
import concurrent.futures as cf
import datetime as dt
import json
import math
import os
import sys
import time
import urllib.parse

from . import geo, parse, synth
from .fetch import Fetcher, Result

HERE = os.path.dirname(os.path.abspath(__file__))
REFRESH = 1800
VERSION = 1
MIN = 60
HOUR = 3600

# Tiered cadence: observations each 30-minute run, forecasts every 3 h, tides daily, satellite daily.
TTL = {
    "ndbc": 25 * MIN, "nws": 25 * MIN, "cencoos": 25 * MIN,
    "spec": 3 * HOUR, "om-marine": 3 * HOUR, "om-wind": 3 * HOUR, "om-buoys": 6 * HOUR, "om-sealevel": 24 * HOUR,
    "mop": 6 * HOUR, "coops": 24 * HOUR, "mur": 20 * HOUR, "srf": 3 * HOUR,
}
# Per-run caps for the staggered tiers (cold keys are always fetched).
CAP = {"spec": 12, "mop": 14, "coops": 16}
MOP_MAX_AGE_S = 2 * TTL["mop"]
MUR_TIMEOUT_S = 180  # the satellite server answered a single point in 120 s on 2026-11-14
OM_BATCH = 50
WIND_GRID = 0.1

# Sample pins: edit for the breaks you surf.
PINNED = ["huntington-beach-pier", "huntington-state-beach", "bolsa-chica", "salt-creek", "trestles-lowers",
          "san-onofre-old-mans"]
SRF_OFFICES = ["SGX", "LOX", "MTR", "EKA", "MFR", "PQR"]
# A cached Surf Zone Forecast past its own expiry is asked for again after an hour, not after the usual 3 h.
SRF_EXPIRED_TTL = HOUR
# Cold upwelled water shows as readings far apart; the flag is only meaningful where upwelling happens.
UPWELLING_REGIONS = {"san-luis-obispo", "monterey-santa-cruz", "san-francisco-marin", "sonoma-del-norte",
                     "oregon-south", "oregon-central", "oregon-north"}

PIERS = [
    {"id": "scripps-pier-automated-shore-sta-1", "name": "Scripps Pier", "lat": 32.867, "lon": -117.257,
     "vars": ["sea_water_temperature_ctd", "sea_water_temperature_seaphox"]},
    {"id": "newport-pier-automated-shore-sta", "name": "Newport Pier", "lat": 33.6073, "lon": -117.9289,
     "vars": ["sea_water_temperature_ctd", "sea_water_temperature"]},
    {"id": "santa-monica-pier-automated-shor", "name": "Santa Monica Pier", "lat": 34.0086, "lon": -118.4986,
     "vars": ["sea_water_temperature"]},
    {"id": "stearns-wharf-automated-shore-st-1", "name": "Stearns Wharf", "lat": 34.4107, "lon": -119.6874,
     "vars": ["sea_water_temperature_ctd", "sea_water_temperature_seaphox"]},
]

SOURCES = {
    "ndbc-latest": ("Buoy and shore station readings", "NOAA NDBC", "All stations in one request."),
    "ndbc-spec": ("Buoy swell and wind-wave split", "NOAA NDBC", "Spectral summary for buoys that publish one."),
    "cdip-mop": ("California nearshore wave model", "Scripps CDIP MOP", "Forecast at 10 m depth for California breaks."),
    "open-meteo-marine": ("Global wave model", "Open-Meteo (ECMWF, Meteo-France, NOAA)",
                          "Covers every spot. Corrected against buoys by region, never shown raw. CC BY 4.0."),
    "open-meteo-wind": ("Wind model", "Open-Meteo (NOAA HRRR, GFS, ICON)", "Hourly wind and gusts. CC BY 4.0."),
    "open-meteo-sealevel": ("Model sea level for Baja", "Open-Meteo marine",
                            "Tide times where no tide station is within 60 km."),
    "coops-tides": ("Tide predictions", "NOAA CO-OPS", "Highs and lows, California, Oregon and the Mexican stations NOAA predicts."),
    "nws-alerts": ("Surf and marine alerts", "NOAA National Weather Service", "California and Oregon coast and coastal waters."),
    "nws-srf": ("Forecaster surf height and rip current risk", "NOAA National Weather Service",
                "Surf Zone Forecasts from San Diego, Los Angeles, San Francisco, Eureka, Medford and Portland."),
    "cencoos-piers": ("Pier water temperature", "SCCOOS via CeNCOOS ERDDAP", "Scripps, Newport, Santa Monica, Stearns Wharf."),
    "coastwatch-mur": ("Satellite water temperature", "NASA JPL MUR via NOAA CoastWatch", "Daily, about 1.5 days behind."),
}

SURF_EVENTS = {
    "High Surf Warning", "High Surf Advisory", "Beach Hazards Statement", "Rip Current Statement",
    "Coastal Flood Warning", "Coastal Flood Advisory", "Coastal Flood Statement", "Coastal Flood Watch",
    "Small Craft Advisory", "Gale Warning", "Gale Watch", "Storm Warning", "Storm Watch",
    "Hurricane Force Wind Warning", "Hazardous Seas Warning", "Hazardous Seas Watch", "Special Marine Warning",
    "Tsunami Warning", "Tsunami Advisory", "Tsunami Watch", "Brisk Wind Advisory",
}


def load_json(name):
    with open(os.path.join(HERE, name)) as f:
        return json.load(f)


def inventories():
    return {
        "spots": load_json("spots.json")["spots"],
        "regions": load_json("regions.json")["regions"],
        "ndbc": load_json("stations-ndbc.json")["stations"],
        "coops": {s["id"]: s for s in load_json("stations-coops.json")["stations"]},
    }


def srf_expired(body, now):
    """True when a cached Surf Zone Forecast response is past its own expiry (any zone's UGC time)."""
    try:
        doc = json.loads(body)
        zones = parse.nws_srf(doc.get("productText") or "", parse.iso_epoch(doc.get("issuanceTime")))
    except (ValueError, AttributeError):
        return False
    ends = [z["until"] for z in zones.values() if z.get("until")]
    return bool(ends) and min(ends) <= now


def cell_key(lat, lon):
    return "%.3f,%.3f" % (lat, lon)


def wind_cell(spot):
    return (round(round(spot["lat"] / WIND_GRID) * WIND_GRID, 2), round(round(spot["lon"] / WIND_GRID) * WIND_GRID, 2))


def tide_plan(spot):
    """('station', id) when a prediction station is within 60 km, else ('model', cell)."""
    t = spot.get("tide") or []
    if t and t[0]["km"] <= 60:
        return "station", t[0]["id"]
    return "model", cell_key(*spot["om"])


# ---- fetching ------------------------------------------------------------------------------------

# Feed source id -> cache tier, so a cached answer older than twice its tier's TTL counts as stale.
SOURCE_TIER = {
    "ndbc-latest": "ndbc", "ndbc-spec": "spec", "cdip-mop": "mop", "open-meteo-marine": "om-marine",
    "open-meteo-wind": "om-wind", "open-meteo-sealevel": "om-sealevel", "coops-tides": "coops",
    "nws-alerts": "nws", "nws-srf": "srf", "cencoos-piers": "cencoos", "coastwatch-mur": "mur",
}


class Ledger:
    """Per-source fetch outcome for `sources[]` and `errors[]`."""

    def __init__(self, now):
        self.now = now
        self.rows = collections.defaultdict(lambda: {"ok": 0, "stale": 0, "missing": 0, "as_of": [], "errors": []})

    def note(self, source, res, label=""):
        row = self.rows[source]
        ttl = TTL[SOURCE_TIER[source]]
        if res is None or res.body is None:
            row["missing"] += 1
        elif res.fresh and res.at is not None and self.now - res.at <= 2 * ttl:
            row["ok"] += 1
        else:
            row["stale"] += 1
        if res is not None and res.body is not None and res.at:
            row["as_of"].append(res.at)
        if res is not None and res.error:
            row["errors"].append(("%s: %s" % (label, res.error)) if label else res.error)

    def fail(self, source, text):
        self.rows[source]["errors"].append(text)


def _om_url(base, cells, params):
    q = dict(params)
    q["latitude"] = ",".join("%.4f" % c[0] for c in cells)
    q["longitude"] = ",".join("%.4f" % c[1] for c in cells)
    return base + "?" + urllib.parse.urlencode(q, safe=",")


def _batches(seq, n):
    return [seq[i:i + n] for i in range(0, len(seq), n)]


def fetch_all(F, inv, now, sat=False, log=print):
    """Fetch every source. Returns (raw dict, Ledger). Never raises for a source failure.

    The satellite server can take two minutes per box, so the 30-minute run reads its boxes from the cache
    and a separate daily run (`sat=True`, `--tier sat`) refreshes them.
    """
    L = Ledger(now)
    raw = {"spec": {}, "mop": {}, "marine": {}, "sealevel": {}, "wind": {}, "tides": {}, "piers": [], "mur": {},
           "alerts": [], "latest": {}, "om_buoys": {}, "srf": {}}
    spots = inv["spots"]

    def ndbc_latest():
        r = F.get("ndbc", "latest_obs", "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt", TTL["ndbc"])
        L.note("ndbc-latest", r)
        if r.body:
            try:
                raw["latest"] = parse.ndbc_latest(r.body)
            except parse.ParseError as e:
                L.fail("ndbc-latest", str(e))

    def nws_srf():
        for wfo in SRF_OFFICES:
            key = "srf-" + wfo
            ttl = TTL["srf"]
            body, _ = F.cached("nws", key)
            if body and srf_expired(body, now):
                ttl = SRF_EXPIRED_TTL  # the office has likely issued the next one: look again sooner
            r = F.get("nws", key, "https://api.weather.gov/products/types/SRF/locations/%s/latest" % wfo,
                      ttl, headers={"Accept": "application/ld+json"})
            L.note("nws-srf", r, wfo)
            if not r.body:
                continue
            try:
                doc = json.loads(r.body)
                raw["srf"].update(parse.nws_srf(doc.get("productText") or "", parse.iso_epoch(doc.get("issuanceTime"))))
            except (ValueError, AttributeError) as e:
                L.fail("nws-srf", "%s: %s" % (wfo, str(e)[:100]))

    def nws():
        out = []
        for key, area in (("alerts-ca-or", "CA,OR"), ("alerts-pz", "PZ")):
            r = F.get("nws", key, "https://api.weather.gov/alerts/active?area=" + area, TTL["nws"],
                      headers={"Accept": "application/geo+json"})
            L.note("nws-alerts", r, area)
            if r.body:
                try:
                    out.extend(parse.nws_alerts(r.body))
                except (parse.ParseError, ValueError) as e:
                    L.fail("nws-alerts", "%s: %s" % (area, str(e)[:100]))
        raw["alerts"] = out

    def piers():
        since = dt.datetime.fromtimestamp(now - 6 * HOUR, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        for p in PIERS:
            url = ("https://erddap.cencoos.org/erddap/tabledap/%s.csv?time,%s&time%%3E=%s"
                   % (p["id"], ",".join(p["vars"]), since))
            r = F.get("cencoos", p["id"], url, TTL["cencoos"], timeout=30)
            L.note("cencoos-piers", r, p["name"])
            if not r.body:
                continue
            try:
                rows = parse.erddap_csv(r.body)
            except parse.ParseError as e:
                L.fail("cencoos-piers", "%s: %s" % (p["name"], e))
                continue
            best = pier_latest(rows, p["vars"])
            if best:
                raw["piers"].append({"id": p["id"], "name": p["name"], "lat": p["lat"], "lon": p["lon"],
                                     "at": best[0], "c": best[1]})

    def coops():
        ids = sorted({tide_plan(s)[1] for s in spots if tide_plan(s)[0] == "station"})
        due = set(F.due("coops", ids, TTL["coops"], CAP["coops"]))
        begin = dt.datetime.fromtimestamp(now - 86400, dt.timezone.utc).strftime("%Y%m%d")
        for sid in ids:
            url = ("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&station=%s"
                   "&begin_date=%s&range=168&datum=MLLW&time_zone=gmt&interval=hilo&units=english&format=json"
                   "&application=pixel-deck" % (sid, begin))
            r = F.get("coops", sid, url, 0 if sid in due else 10 ** 9)
            L.note("coops-tides", r, sid)
            if r.body:
                try:
                    raw["tides"][sid] = parse.coops_hilo(r.body)
                except (parse.ParseError, ValueError) as e:
                    L.fail("coops-tides", "%s: %s" % (sid, str(e)[:100]))

    def mop():
        labels = sorted({s["mop"] for s in spots if s.get("mop")})
        due = set(F.due("mop", labels, TTL["mop"], CAP["mop"]))
        for lab in labels:
            url = ("https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/model/MOP_alongshore/%s_forecast.nc.ascii"
                   "?waveTime,waveHs,waveTp,waveDp" % lab)
            r = F.get("mop", lab, url, 0 if lab in due else 10 ** 9, timeout=30)
            L.note("cdip-mop", r, lab)
            if r.body:
                try:
                    raw["mop"][lab] = dict(parse.mop_ascii(r.body), at=r.at)  # `at`: when this forecast was fetched
                except parse.ParseError as e:
                    L.fail("cdip-mop", "%s: %s" % (lab, e))

    def om_marine():
        cells = sorted({tuple(s["om"]) for s in spots})
        hourly = ("wave_height,swell_wave_height,swell_wave_period,swell_wave_direction,secondary_swell_wave_height,"
                  "secondary_swell_wave_period,secondary_swell_wave_direction,wind_wave_height,wind_wave_direction,"
                  "sea_surface_temperature")
        for i, batch in enumerate(_batches(cells, OM_BATCH)):
            url = _om_url("https://marine-api.open-meteo.com/v1/marine", batch,
                          {"hourly": hourly, "timezone": "GMT", "past_days": "1", "forecast_days": "7"})
            r = F.get("om-marine", "marine-%d-%d" % (i, len(batch)), url, TTL["om-marine"], timeout=60)
            L.note("open-meteo-marine", r, "batch %d" % (i + 1))
            if r.body:
                try:
                    docs = parse.open_meteo(r.body)
                except (parse.ParseError, ValueError) as e:
                    L.fail("open-meteo-marine", str(e)[:120])
                    continue
                for c, d in zip(batch, docs):
                    raw["marine"][cell_key(*c)] = d

    def om_sealevel():
        cells = sorted({tuple(s["om"]) for s in spots if tide_plan(s)[0] == "model"})
        if not cells:
            return
        url = _om_url("https://marine-api.open-meteo.com/v1/marine", cells,
                      {"hourly": "sea_level_height_msl", "timezone": "GMT", "past_days": "1", "forecast_days": "7"})
        r = F.get("om-sealevel", "sealevel-%d" % len(cells), url, TTL["om-sealevel"], timeout=60)
        L.note("open-meteo-sealevel", r)
        if r.body:
            try:
                for c, d in zip(cells, parse.open_meteo(r.body)):
                    raw["sealevel"][cell_key(*c)] = d
            except (parse.ParseError, ValueError) as e:
                L.fail("open-meteo-sealevel", str(e)[:120])

    def om_buoys():
        pts = bias_buoys(inv)
        url = _om_url("https://marine-api.open-meteo.com/v1/marine", [(s["lat"], s["lon"]) for s in pts],
                      {"hourly": "wave_height", "timezone": "GMT", "past_days": "1", "forecast_days": "2"})
        r = F.get("om-buoys", "buoys-%d" % len(pts), url, TTL["om-buoys"], timeout=60)
        L.note("open-meteo-marine", r, "at buoys")
        if r.body:
            try:
                for s, d in zip(pts, parse.open_meteo(r.body)):
                    raw["om_buoys"][s["id"]] = d
            except (parse.ParseError, ValueError) as e:
                L.fail("open-meteo-marine", "at buoys: %s" % str(e)[:100])

    def om_wind():
        cells = sorted({wind_cell(s) for s in spots})
        for i, batch in enumerate(_batches(cells, OM_BATCH)):
            url = _om_url("https://api.open-meteo.com/v1/forecast", batch,
                          {"hourly": "wind_speed_10m,wind_direction_10m,wind_gusts_10m", "wind_speed_unit": "kn",
                           "timezone": "GMT", "past_days": "1", "forecast_days": "7"})
            r = F.get("om-wind", "wind-%d-%d" % (i, len(batch)), url, TTL["om-wind"], timeout=60)
            L.note("open-meteo-wind", r, "batch %d" % (i + 1))
            if r.body:
                try:
                    for c, d in zip(batch, parse.open_meteo(r.body)):
                        raw["wind"][cell_key(*c)] = d
                except (parse.ParseError, ValueError) as e:
                    L.fail("open-meteo-wind", str(e)[:120])

    def mur():
        boxes = mur_boxes(spots, inv["regions"])
        due = set(F.due("mur", list(boxes), TTL["mur"], len(boxes))) if sat else set()
        for rid, box in boxes.items():
            if rid in due:
                url = ("https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.csv?analysed_sst[(last)]"
                       "[(%.2f):%d:(%.2f)][(%.2f):%d:(%.2f)]" % (box["lat0"], box["stride"], box["lat1"],
                                                                   box["lon0"], box["stride"], box["lon1"]))
                r = F.get("mur", rid, url, 0, timeout=MUR_TIMEOUT_S)
            else:
                body, meta = F.cached("mur", rid)
                r = Result(body, None if not meta else int(meta["at"]), body is not None,
                           None if body is not None else "waiting for the daily satellite run")
            L.note("coastwatch-mur", r, rid)
            if r.body:
                try:
                    raw["mur"][rid] = parse.erddap_csv(r.body)
                except parse.ParseError as e:
                    L.fail("coastwatch-mur", "%s: %s" % (rid, e))

    def spec_after_latest():
        ndbc_latest()
        latest = raw["latest"]
        ids = [s["id"] for s in inv["ndbc"] if s.get("spec") and latest.get(s["id"], {}).get("wvht_m") is not None
               and now - latest[s["id"]]["at"] <= 3 * HOUR]
        due = set(F.due("spec", ids, TTL["spec"], CAP["spec"]))
        for sid in ids:
            r = F.get("spec", sid, "https://www.ndbc.noaa.gov/data/realtime2/%s.spec" % sid,
                      0 if sid in due else 10 ** 9, timeout=30)
            L.note("ndbc-spec", r, sid)
            if r.body:
                try:
                    raw["spec"][sid] = parse.ndbc_spec(r.body)
                except parse.ParseError as e:
                    L.fail("ndbc-spec", "%s: %s" % (sid, e))

    if sat:
        jobs = [("coastwatch-mur", mur)]
    else:
        jobs = [("ndbc-latest", spec_after_latest), ("nws-alerts", nws), ("cencoos-piers", piers), ("coops-tides", coops),
                ("cdip-mop", mop), ("open-meteo-marine", om_marine), ("open-meteo-sealevel", om_sealevel),
                ("open-meteo-marine", om_buoys), ("open-meteo-wind", om_wind), ("coastwatch-mur", mur),
                ("nws-srf", nws_srf)]
    with cf.ThreadPoolExecutor(max_workers=len(jobs)) as ex:
        futs = {ex.submit(fn): sid for sid, fn in jobs}
        for fut in cf.as_completed(futs):
            try:
                fut.result()
            except Exception as e:  # a bug in one source must not sink the feed; it is reported
                L.fail(futs[fut], "collector error: %s" % str(e)[:120])
                log("surf-coast: %s failed: %r" % (futs[fut], e), file=sys.stderr)
    return raw, L


def mur_boxes(spots, regions):
    """One satellite box per region around its spots' SST points, at most about 12,000 cells."""
    out = {}
    for reg in regions:
        pts = [s["sst"] for s in spots if s["region"] == reg["id"] and s.get("sst")]
        if not pts:
            continue
        lat0, lat1 = min(p[0] for p in pts) - 0.05, max(p[0] for p in pts) + 0.05
        lon0, lon1 = min(p[1] for p in pts) - 0.05, max(p[1] for p in pts) + 0.05
        cells = ((lat1 - lat0) / 0.01) * ((lon1 - lon0) / 0.01)
        stride = max(1, int(math.ceil(math.sqrt(cells / 12000.0))))
        out[reg["id"]] = {"lat0": lat0, "lat1": lat1, "lon0": lon0, "lon1": lon1, "stride": stride}
    return out


def pier_latest(rows, variables):
    """Newest plausible reading (epoch, celsius) from ERDDAP rows; each row takes its first non-missing variable."""
    best = None
    for row in rows:
        at = parse.iso_epoch(row.get("time"))
        val = next((row.get(v) for v in variables if row.get(v) is not None), None)
        if at and val is not None and -2 < val < 35 and (best is None or at > best[0]):
            best = (at, val)
    return best


def mur_at(rows, lat, lon, max_deg=0.12):
    """Nearest valid (not land-masked) satellite cell to a point: (celsius, epoch) or None."""
    best = None
    for r in rows:
        v = r.get("analysed_sst")
        if v is None or r.get("latitude") is None:
            continue
        d = (r["latitude"] - lat) ** 2 + ((r["longitude"] - lon) * math.cos(math.radians(lat))) ** 2
        if d <= max_deg ** 2 and (best is None or d < best[0]):
            best = (d, v, parse.iso_epoch(r.get("time")))
    return None if best is None else (best[1], best[2])


# ---- assembly ------------------------------------------------------------------------------------

def _series_at(doc, var, at):
    if not doc:
        return None
    return geo.interp_series(doc["times"], doc["hourly"].get(var) or [], at)


def _angle_at(doc, var, at):
    if not doc:
        return None
    return geo.interp_angle(doc["times"], doc["hourly"].get(var) or [], at)


def _mop_at(series, at):
    if not series:
        return None
    hs = geo.interp_series(series["times"], series["hs_m"], at)
    if hs is None:
        return None
    return {"hs_m": hs, "tp_s": geo.interp_series(series["times"], series["tp_s"], at),
            "dp": geo.interp_angle(series["times"], series["dp"], at)}


def usable_mop(series, now):
    """The MOP series when its fetch is recent enough to stand for now: at most twice its 6 h tier old (the age at
    which the source reads stale). An older or undated fetch is refused, so an old forecast never sits under "now"."""
    if not series or series.get("at") is None or now - series["at"] > MOP_MAX_AGE_S:
        return None
    return series


def near_sensor(s, wave_obs, stations):
    """The nearest wave sensor that can check a break's scaled height (synth rule 1b): reporting within 3 h, within
    3 km of the shore, within 2 km of the break. {id, kind, km, hs_m, age_min} or None."""
    best = None
    for o in wave_obs:
        st = stations.get(o["id"]) or {}
        if o["age_min"] > synth.SENSOR_MAX_AGE_MIN or (st.get("coast_km") is None or st["coast_km"] > synth.SENSOR_SHORE_KM):
            continue
        d = geo.km(s["lat"], s["lon"], o["lat"], o["lon"])
        if d <= synth.SENSOR_NEAR_KM and (best is None or d < best["km"]):
            best = {"id": o["id"], "kind": o["kind"], "km": d, "hs_m": o["wvht_m"], "age_min": o["age_min"]}
    return best


def station_kind(st):
    if st.get("type") == "buoy":
        return "buoy"
    if "NOS" in (st.get("owner") or ""):
        return "tide station"
    return "shore station"


def bias_buoys(inv):
    """Wave buoys within 60 km of the coast that the global model is checked against (a fixed list, so the request
    is cached across runs)."""
    return [s for s in inv["ndbc"] if s["type"] == "buoy" and (s.get("coast_km") or 0) <= 60
            and (s.get("spec") or s.get("owner") in ("SCRIPPS", "NDBC"))]


def bias_pairs(inv, latest, om_buoys, spot_region, now):
    """(observed, model) wave height pairs: each reporting buoy's reading against the global model at the buoy."""
    out = []
    for st in bias_buoys(inv):
        ob = latest.get(st["id"])
        doc = om_buoys.get(st["id"])
        if not ob or not doc or ob.get("wvht_m") is None or now - ob["at"] > 90 * MIN:
            continue
        model = _series_at(doc, "wave_height", ob["at"])
        if model is None or model <= 0:
            continue
        out.append({"t": ob["at"], "buoy": st["id"], "region": spot_region(st["lat"], st["lon"]),
                    "obs": ob["wvht_m"], "model": round(model, 3)})
    return out


def region_bias(history, regions):
    """{region: (factor or None, basis, pairs)}.

    Own region first, then the neighbour with the most pairs, then (US regions only) the whole US coast. Baja Sur
    has no buoy within 1,000 km, so with no neighbour ratio its model stays raw and the gap says so.
    """
    by = collections.defaultdict(list)
    for p in history:
        by[p["region"]].append((p["obs"], p["model"]))
    own = {r["id"]: synth.bias_ratio(by.get(r["id"], [])) for r in regions}
    coast_pairs = [x for r in regions if r.get("country") == "US" for x in by.get(r["id"], [])]
    coast = synth.bias_ratio(coast_pairs) if len(coast_pairs) >= 2 * synth.BIAS_MIN_PAIRS else None
    order = [r["id"] for r in regions]
    out = {}
    for i, reg in enumerate(regions):
        rid = reg["id"]
        if own[rid] is not None:
            out[rid] = (own[rid], rid, len(by[rid]))
            continue
        cands = [order[j] for j in (i - 1, i + 1) if 0 <= j < len(order) and own[order[j]] is not None]
        cands.sort(key=lambda r: -len(by[r]))
        if cands:
            out[rid] = (own[cands[0]], cands[0], len(by[cands[0]]))
        elif coast is not None and reg.get("country") == "US":
            out[rid] = (coast, "coast", len(coast_pairs))
        else:
            out[rid] = (None, None, 0)
    return out


def assemble(inv, raw, ledger_rows, now, state, spot_height=True):
    """Build (overview, {region_id: region_file}, new state). Pure: no network, no clock.

    `state` carries what runs remember: `pairs` (model vs buoy, 7 days) and `buoys` (wave heights, 26 h).
    """
    state = state or {}
    bias_history = state.get("pairs") or []
    spots, regions = inv["spots"], inv["regions"]
    reg_by = {r["id"]: r for r in regions}
    latest = raw.get("latest") or {}
    stations = {s["id"]: s for s in inv["ndbc"]}

    def nearest_spot(lat, lon):
        return min(spots, key=lambda s: geo.km(lat, lon, s["lat"], s["lon"]))

    def spot_region(lat, lon):
        return nearest_spot(lat, lon)["region"]

    new_pairs = bias_pairs(inv, latest, raw.get("om_buoys") or {}, spot_region, now)
    seen = {(p["buoy"], p["t"]) for p in bias_history}
    history = [p for p in bias_history if now - p["t"] <= 7 * 86400] + [p for p in new_pairs if (p["buoy"], p["t"]) not in seen]
    bias = region_bias(history, regions)
    buoy_history = buoy_heights(state.get("buoys") or {}, latest, now)

    # observation pools
    obs = []
    for sid, ob in latest.items():
        st = stations.get(sid)
        if not st:
            continue
        obs.append(dict(ob, name=st["name"], kind=station_kind(st), owner=st.get("owner"), age_min=(now - ob["at"]) // 60,
                        lat=st["lat"], lon=st["lon"]))
    wave_obs = [o for o in obs if o.get("wvht_m") is not None and o["age_min"] <= 180]
    wind_obs = [o for o in obs if o.get("wspd_kt") is not None and o["age_min"] <= 90]
    wtmp_obs = [o for o in obs if o.get("wtmp_c") is not None and o["age_min"] <= 360 and -2 < o["wtmp_c"] < 35]
    piers = [p for p in raw.get("piers") or [] if now - p["at"] <= 6 * HOUR]
    spec = raw.get("spec") or {}

    # satellite per spot
    mur_spot = {}
    for s in spots:
        rows = (raw.get("mur") or {}).get(s["region"])
        if rows and s.get("sst"):
            hit = mur_at(rows, s["sst"][0], s["sst"][1])
            if hit and hit[1] and now - hit[1] <= 4 * 86400:
                mur_spot[s["id"]] = hit

    # tide event lists
    tide_events = dict(raw.get("tides") or {})
    for key, doc in (raw.get("sealevel") or {}).items():
        sl = doc["hourly"].get("sea_level_height_msl") or []
        ev = synth.extrema_from_series(doc["times"], [None if v is None else v * geo.M_TO_FT for v in sl])
        if ev:
            tide_events["model:" + key] = ev

    # waves now: blend every spot first, then scale each region's MOP points to its buoy level (synth.mop_scale)
    waves = {}
    for s in spots:
        cands = []
        for o in wave_obs:
            d = geo.km(s["lat"], s["lon"], o["lat"], o["lon"])
            if d <= synth.BUOY_RADIUS_KM:
                cands.append({"id": o["id"], "name": o["name"], "km": d, "age_min": o["age_min"], "hs_m": o["wvht_m"],
                              "period_s": o.get("dpd_s"), "dir": o.get("mwd")})
        mop_series = usable_mop((raw.get("mop") or {}).get(s.get("mop")), now)
        mop_now = _mop_at(mop_series, now)
        if mop_now:
            mop_now.update(id=s.get("mop"), age_min=(now - mop_series["at"]) // 60)
        marine = (raw.get("marine") or {}).get(cell_key(*s["om"]))
        om_now = None
        if marine:
            om_now = {"hs_m": _series_at(marine, "wave_height", now),
                      "swell_period_s": _series_at(marine, "swell_wave_period", now),
                      "swell_dir": _angle_at(marine, "swell_wave_direction", now)}
        blend = synth.blend_waves(cands, mop_now, om_now, bias[s["region"]][0])
        waves[s["id"]] = (blend, None if not (blend and mop_now) else mop_now["hs_m"])
    mop_scale = {}
    for reg in regions:
        pairs = [(b["hs_m"], m) for b, m in (waves[s["id"]] for s in spots if s["region"] == reg["id"]) if b and m is not None]
        mop_scale[reg["id"]] = (synth.mop_scale(pairs), len(pairs))

    out_spots = []
    detail = {}
    for s in spots:
        reg = reg_by[s["region"]]
        tzname = reg["tz"]
        cell = cell_key(*s["om"])
        marine = (raw.get("marine") or {}).get(cell)
        wind_doc = (raw.get("wind") or {}).get(cell_key(*wind_cell(s)))
        mop_series = usable_mop((raw.get("mop") or {}).get(s.get("mop")), now)
        factor, basis, npairs = bias[s["region"]]
        blend, mop_hs = waves[s["id"]]
        scale, scale_n = mop_scale[s["region"]]
        fc, rip = spot_forecast(s, raw.get("srf") or {}, tzname, now)
        blend_m = blend and blend["hs_m"]
        scaled_m = sensor = check = None
        if spot_height:
            hs_m, height_basis = synth.spot_height(blend_m, mop_hs, scale)
            if height_basis == "spot":
                scaled_m = hs_m
                sensor = near_sensor(s, wave_obs, stations)
                hs_m, height_basis, check = synth.checked_height(blend_m, scaled_m, sensor, fc)
        else:
            hs_m, height_basis = (blend_m, "region") if blend else (None, None)
        height_why = check or (None if height_basis != "region" else "off" if not spot_height else
                             "no_mop" if not s.get("mop") else "no_mop_now" if mop_hs is None else "no_factor")
        conf = synth.confidence(blend)
        hs_ft = None if hs_m is None else hs_m * geo.M_TO_FT

        # wind now
        model_w = None
        if wind_doc:
            kt = _series_at(wind_doc, "wind_speed_10m", now)
            if kt is not None:
                model_w = {"kt": kt, "dir": _angle_at(wind_doc, "wind_direction_10m", now),
                           "gust_kt": _series_at(wind_doc, "wind_gusts_10m", now)}
        near_w = min(((geo.km(s["lat"], s["lon"], o["lat"], o["lon"]), o) for o in wind_obs), key=lambda x: x[0], default=None)
        obs_w = None
        if near_w and near_w[0] <= 15:
            o = near_w[1]
            obs_w = {"kt": o["wspd_kt"], "dir": o.get("wdir"), "gust_kt": o.get("gst_kt"), "id": o["id"], "km": near_w[0]}
        wind = synth.blend_wind(model_w, obs_w)
        quality = synth.wind_quality(wind["dir"], s["facing_deg"]) if wind else None

        # tide now
        plan_kind, plan_id = tide_plan(s)
        tkey = plan_id if plan_kind == "station" else "model:" + plan_id
        events = tide_events.get(tkey) or []
        if not events and plan_kind == "station":
            tkey = "model:" + cell
            events = tide_events.get(tkey) or []
        t_state = synth.tide_state(events, now) if events else None
        t_ft = synth.tide_height(events, now) if events else None
        t_next = next((e for e in events if e["at"] > now), None)

        # water now
        votes = []
        for o in sorted(wtmp_obs, key=lambda o: geo.km(s["lat"], s["lon"], o["lat"], o["lon"])):
            d = geo.km(s["lat"], s["lon"], o["lat"], o["lon"])
            limit = 60 if o["kind"] == "buoy" else 40
            if d <= limit and len([v for v in votes if v["kind"] != "pier"]) < 3:
                votes.append({"kind": o["kind"], "id": o["id"], "km": round(d, 1), "f": geo.r1(geo.c_to_f(o["wtmp_c"])),
                              "age_min": o["age_min"]})
        for p in piers:
            d = geo.km(s["lat"], s["lon"], p["lat"], p["lon"])
            if d <= 40:
                votes.append({"kind": "pier", "id": p["name"], "km": round(d, 1), "f": geo.r1(geo.c_to_f(p["c"])),
                              "age_min": (now - p["at"]) // 60})
        if s["id"] in mur_spot:
            c, at = mur_spot[s["id"]]
            votes.append({"kind": "satellite", "f": geo.r1(geo.c_to_f(c)), "age_min": (now - at) // 60})
        om_sst = _series_at(marine, "sea_surface_temperature", now)
        if om_sst is not None:
            votes.append({"kind": "model", "f": geo.r1(geo.c_to_f(om_sst))})
        water = synth.water_blend(votes)
        if water:
            water["confidence"] = synth.water_confidence(votes)
            if s["region"] in UPWELLING_REGIONS:
                water["upwelling"] = synth.upwelling([v["f"] for v in votes])

        # swell parts
        swell = swell_parts(s, blend, spec, stations, latest, marine, factor, now)

        score, rating, word = synth.rate(hs_ft, blend and blend["period_s"], wind and wind["kt"], quality, t_state)
        why = synth.reason(hs_ft, blend and blend["period_s"], blend and blend["dir"], wind and wind["kt"], quality, t_state)

        # hourly series: local midnight today through 7 days
        today = geo.local(now, tzname).date()
        midnight = int(dt.datetime.combine(today, dt.time(0), geo.tz(tzname)).timestamp())
        hour0 = now - now % HOUR
        hours = []
        model_now = _model_hs(marine, mop_series, factor, now)
        anchor = None
        if hs_m is not None and model_now:
            anchor = min(2.0, max(0.5, hs_m / model_now))
        for at in range(midnight, midnight + 8 * 86400, HOUR):
            mh = _model_hs(marine, mop_series, factor, at)
            if mh is not None and anchor is not None:
                mh *= 1 + (anchor - 1) * math.exp(-abs(at - now) / (12.0 * HOUR))
            per_parts = []
            mp = _mop_at(mop_series, at)
            if mp and mp.get("tp_s"):
                per_parts.append((mp["tp_s"], 0.6))
            omp = _series_at(marine, "swell_wave_period", at)
            if omp:
                per_parts.append((omp / synth.OM_PERIOD_TO_PEAK, 0.4))
            per = (sum(v * w for v, w in per_parts) / sum(w for _, w in per_parts)) if per_parts else None
            direc = geo.circ_mean([((mp or {}).get("dp"), 0.6), (_angle_at(marine, "swell_wave_direction", at), 0.4)])
            wk = _series_at(wind_doc, "wind_speed_10m", at)
            wd = _angle_at(wind_doc, "wind_direction_10m", at)
            wq = synth.wind_quality(wd, s["facing_deg"])
            ts = synth.tide_state(events, at) if events else None
            hft = None if mh is None else mh * geo.M_TO_FT
            sc, rt, _ = synth.rate(hft, per, wk, wq, ts)
            lt = geo.local(at, tzname)
            hours.append({"at": at, "ld": lt.date(), "lh": lt.hour, "hs_ft": hft, "period_s": per, "dir": direc,
                          "wind_kt": wk, "wind_dir": wd, "wind_q": wq,
                          "tide_ft": synth.tide_height(events, at) if events else None, "score": sc, "rating": rt})

        days = day_parts(hours, today)
        for i, d in enumerate(days):
            d["confidence"] = synth.day_confidence(i, conf) if (blend and (d["am"] or d["pm"])) else None
        best = best_for(hours, s, tzname, now, events)

        near_b = min(((geo.km(s["lat"], s["lon"], o["lat"], o["lon"]), o) for o in wave_obs), key=lambda x: x[0], default=None)
        near_b = near_b if near_b and near_b[0] <= synth.BUOY_RADIUS_KM else None
        gaps = spot_gaps(s, blend, votes, plan_kind, tkey, factor, basis, height_basis, height_why)

        spot_out = {
            "id": s["id"], "name": s["name"], "region": s["region"], "sub": s.get("sub"),
            "lat": s["lat"], "lon": s["lon"], "facing_deg": s["facing_deg"], "facing": geo.compass(s["facing_deg"], 16),
            "pinned": (PINNED.index(s["id"]) + 1) if s["id"] in PINNED else None, "tz": tzname,
            "now": {
                "at": now,
                "wave_ft": None if hs_m is None else synth.surf_range_ft(hs_m, blend["period_s"]),
                "hs_ft": geo.r1(hs_ft), "height_basis": height_basis,
                "period_s": None if not blend or blend["period_s"] is None else int(round(blend["period_s"])),
                "dir_deg": None if not blend else blend["dir"],
                "dir": None if not blend else geo.compass(blend["dir"]),
                "swell": swell,
                "wind": None if not wind else {
                    "kt": int(round(wind["kt"])), "gust_kt": None if wind["gust_kt"] is None else int(round(wind["gust_kt"])),
                    "dir_deg": wind["dir"], "dir": geo.compass(wind["dir"]), "quality": quality,
                    "word": synth.wind_word(wind["kt"], quality)},
                "water_f": water,
                "tide": None if not events else {
                    "state": t_state, "ft": None if t_ft is None else round(t_ft, 1),
                    "next": None if not t_next else {"type": t_next["type"], "at": t_next["at"], "ft": round(t_next["ft"], 1),
                                                     "label": geo.clock(t_next["at"], tzname)}},
                "rating": rating, "word": word, "reason": why, "score": score,
                "confidence": conf,
            },
            "days": days,
            "best": best,
            "buoy": None if not near_b else {"id": near_b[1]["id"], "name": clean_name(near_b[1]["name"]), "km": round(near_b[0], 1)},
            "tide_station": tkey if events else None,
            "gaps": gaps,
        }
        if fc:
            spot_out["forecaster"] = fc
        if rip:
            spot_out["rip"] = rip
        out_spots.append(spot_out)
        h0 = next((i for i, h in enumerate(hours) if h["at"] >= hour0), 0)
        h72 = hours[h0:h0 + 72]
        detail[s["id"]] = {
            "parts": {
                "hs": [] if not blend else [_part_out(p) for p in blend["parts"]],
                "wind": [x for x in (
                    None if not model_w else {"kind": "model", "kt": geo.r1(model_w["kt"]), "dir": model_w["dir"]},
                    None if not obs_w else {"kind": station_kind(stations[obs_w["id"]]), "id": obs_w["id"],
                                            "km": round(obs_w["km"], 1), "kt": geo.r1(obs_w["kt"]), "dir": obs_w["dir"]}) if x],
                "water": votes,
                "bias": {"factor": factor, "basis": basis, "pairs": npairs},
                "scale": None if scaled_m is None else {
                    "factor": round(scale, 3), "mop_id": s.get("mop"), "mop_ft": geo.r1(mop_hs * geo.M_TO_FT),
                    "mop_age_min": (now - mop_series["at"]) // 60, "blend_ft": geo.r1(blend_m * geo.M_TO_FT),
                    "scaled_ft": geo.r1(scaled_m * geo.M_TO_FT), "spots": scale_n, "used": height_basis == "spot", "why": check,
                    "sensor": None if not sensor else {"id": sensor["id"], "kind": sensor["kind"], "km": round(sensor["km"], 1),
                                                       "ft": geo.r1(sensor["hs_m"] * geo.M_TO_FT), "age_min": sensor["age_min"]}},
            },
            "hours": {
                "start": h72[0]["at"] if h72 else hour0, "step": HOUR,
                "hs_ft": [geo.r1(h["hs_ft"]) for h in h72],
                "period_s": [None if h["period_s"] is None else round(h["period_s"], 1) for h in h72],
                "dir_deg": [h["dir"] for h in h72],
                "wind_kt": [geo.r1(h["wind_kt"]) for h in h72],
                "wind_dir_deg": [None if h["wind_dir"] is None else round(h["wind_dir"]) for h in h72],
                "wind_quality": [h["wind_q"] for h in h72],
                "tide_ft": [None if h["tide_ft"] is None else round(h["tide_ft"], 2) for h in h72],
                "rating": [h["rating"] for h in h72],
            },
            "sun": sun_block(s, tzname, today),
        }

    alerts = build_alerts(raw.get("alerts") or [], spots, reg_by, now)
    buoys = build_buoys(inv, obs, spec, spots, now, buoy_history)
    water = build_water(obs, piers, mur_spot, raw.get("marine") or {}, spots, out_spots, nearest_spot, now)
    tides = build_tides(tide_events, out_spots, spots, reg_by, inv["coops"], now)
    out_regions = [build_region(reg, [x for x in out_spots if x["region"] == reg["id"]], alerts, tides, water) for reg in regions]

    order = {r["id"]: r["order"] for r in regions}
    out_spots.sort(key=lambda x: (x["pinned"] is None, x["pinned"] or 0, order[x["region"]], x["lat"]))
    counts = {
        "ndbc-latest": sum(1 for o in obs if o["age_min"] <= 180), "ndbc-spec": len(spec),
        "cdip-mop": len(raw.get("mop") or {}), "open-meteo-marine": len(raw.get("marine") or {}),
        "open-meteo-wind": len(raw.get("wind") or {}), "open-meteo-sealevel": len(raw.get("sealevel") or {}),
        "coops-tides": len(raw.get("tides") or {}), "nws-alerts": len(alerts), "cencoos-piers": len(piers),
        "coastwatch-mur": len(raw.get("mur") or {}), "nws-srf": len(raw.get("srf") or {}),
    }
    sources = build_sources(ledger_rows, counts, now)
    coverage = {
        "spots": len(out_spots),
        "spots_with_data": sum(1 for x in out_spots if x["now"]["hs_ft"] is not None),
        "spots_buoy_50km": sum(1 for x in out_spots if x["buoy"] and x["buoy"]["km"] <= 50),
        "spots_model_only": sum(1 for x in out_spots if x["now"]["confidence"]["model_only"]),
        "stations_reporting": len(buoys),
        "buoys_waves": sum(1 for b in buoys if b["wave_ft"] is not None),
        "water_rows": len(water["rows"]),
        "alerts": len(alerts),
        "tide_stations": sum(1 for t in tides if t["kind"] == "prediction"),
    }
    for b in ("spot", "sensor", "region"):
        coverage["spots_height_" + b] = sum(1 for x in out_spots if x["now"]["height_basis"] == b)
    gaps = ["Baja has no public wave buoys. Baja heights come from models and carry a low mark.",
            "No official surf or marine alerts are published for Mexico here."]
    if coverage["spots_with_data"] < coverage["spots"]:
        gaps.append("%d spots have no wave reading right now." % (coverage["spots"] - coverage["spots_with_data"]))
    src_names = sorted({row["name"] for row in sources if row["status"] != "unavailable"})
    errors = []
    for row in sources:
        if row["status"] != "ok" and row.get("note"):
            errors.append({"source": row["id"], "reason": row["note"][:160]})
    overview = {
        "v": VERSION, "t": now, "generated_at": now, "refresh": REFRESH, "src": src_names, "errors": errors[:24],
        "regions": out_regions, "spots": out_spots, "buoys": buoys, "water": water,
        "tides": [{k: v for k, v in t.items() if k != "curve"} for t in tides],
        "alerts": alerts, "sources": sources, "coverage": coverage, "gaps": gaps,
        "method": {"doc": "docs/surf-coast.md", "bias": {r: {"factor": b[0], "basis": b[1], "pairs": b[2]} for r, b in bias.items()},
                   "mop_scale": {r: {"factor": None if k is None else round(k, 3), "spots": n} for r, (k, n) in mop_scale.items()},
                   "spot_height": "on" if spot_height else "off"},
    }
    region_files = {}
    for reg, rout in zip(regions, out_regions):
        rs = [dict(x, **detail[x["id"]]) for x in out_spots if x["region"] == reg["id"]]
        region_files[reg["id"]] = {
            "v": VERSION, "t": now, "refresh": REFRESH, "region": rout, "spots": rs,
            "tides": [t for t in tides if reg["id"] in t["regions"]],
            "buoys": [b for b in buoys if b["region"] == reg["id"]],
            "alerts": [a for a in alerts if reg["id"] in a["regions"]],
            "water": [w for w in water["rows"] if w["region"] == reg["id"]],
            "sources": sources,
        }
    return overview, region_files, {"pairs": history, "buoys": buoy_history}


def _part_out(p):
    o = {"kind": p["kind"], "ft": geo.r1(p["hs_m"] * geo.M_TO_FT), "weight": round(p["weight"], 3)}
    for k in ("id", "km", "age_min"):
        if p.get(k) is not None:
            o[k] = p[k]
    if p["kind"] == "global model":
        o["raw_ft"] = geo.r1(p["raw_m"] * geo.M_TO_FT)
        o["bias"] = p["bias"]
    if p.get("period_s"):
        o["period_s"] = round(p["period_s"], 1)
    return o


def _model_hs(marine, mop_series, factor, at):
    """Nearshore model (0.6) and corrected global model (0.4) at one time; either alone when the other is absent."""
    om = _series_at(marine, "wave_height", at)
    om = None if om is None or om <= 0 else om * (factor if factor is not None else 1.0)
    mp = _mop_at(mop_series, at)
    mh = None if not mp else mp["hs_m"]
    if om is not None and mh is not None:
        return 0.6 * mh + 0.4 * om
    return mh if mh is not None else om


def clean_name(name):
    """'Capistrano Beach Nearshore, CA (284)' -> 'Capistrano Beach Nearshore'; NDBC upper-case names title-cased."""
    n = name.split(",")[0].split(" - ")[0].strip()
    if n.isupper():
        n = n.title()
    return n


def swell_parts(s, blend, spec, stations, latest, marine, factor, now):
    parts = []
    near = None
    for sid, sp in spec.items():
        st = stations.get(sid)
        if not st or now - sp["at"] > 4 * HOUR:
            continue
        d = geo.km(s["lat"], s["lon"], st["lat"], st["lon"])
        if d <= 50 and (near is None or d < near[0]):
            near = (d, sid, sp)
    f = factor if factor is not None else 1.0

    def part(name, m, per, deg, src):
        if m is None:
            return None
        return {"part": name, "ft": geo.r1(m * geo.M_TO_FT), "period_s": None if per is None else round(per),
                "dir_deg": None if deg is None else round(deg), "dir": geo.compass(deg), "src": src}

    if near:
        _, sid, sp = near
        parts.append(part("primary", sp["swh_m"], sp["swp_s"], sp["swd"], "buoy"))
    elif marine:
        parts.append(part("primary", _scaled(_series_at(marine, "swell_wave_height", now), f),
                          _series_at(marine, "swell_wave_period", now), _angle_at(marine, "swell_wave_direction", now), "model"))
    if marine:
        parts.append(part("secondary", _scaled(_series_at(marine, "secondary_swell_wave_height", now), f),
                          _series_at(marine, "secondary_swell_wave_period", now),
                          _angle_at(marine, "secondary_swell_wave_direction", now), "model"))
    if near:
        parts.append(part("wind", near[2]["wwh_m"], near[2]["wwp_s"], near[2]["wwd"], "buoy"))
    elif marine:
        parts.append(part("wind", _scaled(_series_at(marine, "wind_wave_height", now), f), None,
                          _angle_at(marine, "wind_wave_direction", now), "model"))
    return [p for p in parts if p and p["ft"] is not None and p["ft"] > 0]


def _scaled(v, f):
    return None if v is None else v * f


def day_parts(hours, today):
    days = []
    for i in range(7):
        date = today + dt.timedelta(days=i)
        row = {"date": date.isoformat(), "label": "Today" if i == 0 else date.strftime("%a")}
        for name, h0, h1 in (("am", 6, 12), ("pm", 12, 18)):
            hs = [h for h in hours if h["ld"] == date and h0 <= h["lh"] < h1 and h["hs_ft"] is not None]
            if not hs:
                row[name] = None
                continue
            lo = min(h["hs_ft"] for h in hs)
            hi_rng = [synth.surf_range_ft(h["hs_ft"] / geo.M_TO_FT, h["period_s"]) for h in hs]
            pers = [h["period_s"] for h in hs if h["period_s"]]
            winds = [h["wind_kt"] for h in hs if h["wind_kt"] is not None]
            qs = collections.Counter(h["wind_q"] for h in hs if h["wind_q"])
            scores = [h["score"] for h in hs if h["score"] is not None]
            score = sum(scores) / len(scores) if scores else None
            r = None if score is None else int(math.floor(score + 0.5))
            row[name] = {
                "wave_ft": [int(math.floor(lo + 0.25)), max(x[1] for x in hi_rng if x)],
                "period_s": None if not pers else int(round(sum(pers) / len(pers))),
                "wind_kt": None if not winds else int(round(sum(winds) / len(winds))),
                "wind": qs.most_common(1)[0][0] if qs else None,
                "rating": r, "word": synth.rating_word(score, sum(h["hs_ft"] for h in hs) / len(hs)),
            }
        days.append(row)
    return days


def best_for(hours, s, tzname, now, events):
    today = geo.local(now, tzname).date()
    hour0 = now - now % HOUR
    for day, label in ((today, "today"), (today + dt.timedelta(days=1), "tomorrow")):
        sun = geo.sun_times(day, s["lat"], s["lon"], tzname)
        if not sun["sunrise"] or not sun["sunset"]:
            continue
        hs = [h for h in hours if h["at"] >= hour0 and h["ld"] == day]
        win = synth.best_window(hs, [(sun["sunrise"] - 1800, sun["sunset"] + 1800)])
        if not win:
            continue
        start, end, sc = win
        h = next(x for x in hours if x["at"] == start)
        r = int(math.floor(sc + 0.5))
        return {"start": start, "end": end, "label": geo.window_label(start, end, tzname), "day": label,
                "rating": r, "word": synth.rating_word(sc, h["hs_ft"]),
                "reason": synth.reason(h["hs_ft"], h["period_s"], h["dir"], h["wind_kt"], h["wind_q"],
                                       synth.tide_state(events, start) if events else None)}
    return None


def sun_block(s, tzname, today):
    sun = geo.sun_times(today, s["lat"], s["lon"], tzname)
    return {k: (None if v is None else {"at": v, "label": geo.clock(v, tzname)}) for k, v in sun.items()}


HEIGHT_GAPS = {
    "no_mop": "No nearshore model point for this break, so the height is the area's, not the break's own.",
    "no_mop_now": "The nearshore model is too old or has no value for now, so the height is the area's, not the break's own.",
    "no_factor": "Too few nearshore model points agree with the buoys here, so the height is the area's, not the break's own.",
    "outside_forecaster_band": "The nearshore model is far from the forecaster's range here, so the height is the area's, not the break's own.",
}


def spot_gaps(s, blend, votes, plan_kind, tkey, factor, basis, height_basis, height_why):
    gaps = []
    if not blend:
        gaps.append("No wave reading here right now.")
    elif blend["model_only"]:
        gaps.append("No wave buoy within 150 km. Height is from models.")
    if height_basis == "sensor":
        gaps.append("A wave sensor at this break disagrees with the nearshore model, so the height is the sensor's reading.")
    elif height_basis == "region" and height_why == "sensor_disagrees":
        gaps.append("A wave sensor near this break disagrees with the nearshore model, so the height is the area's, not the break's own.")
    elif height_basis == "region" and height_why in HEIGHT_GAPS:
        gaps.append(HEIGHT_GAPS[height_why])
    if blend and factor is None and any(p["kind"] == "global model" for p in blend["parts"]):
        gaps.append("No nearby buoys to correct the global model, so it is used as is.")
    elif factor is not None and basis == "coast":
        gaps.append("Too few buoys in this region yet, so the global model is corrected with buoys along the whole coast.")
    elif factor is not None and basis != s["region"]:
        gaps.append("The global model is corrected with buoys from a neighbouring region.")
    kinds = {v["kind"] for v in votes}
    if not votes:
        gaps.append("No water temperature reading nearby.")
    elif not kinds & {"buoy", "pier", "tide station", "shore station"}:
        gaps.append("Water temperature is from satellite and model only.")
    if tkey.startswith("model:"):
        gaps.append("No tide station within 60 km. Tide times are from a model.")
    if s.get("facing_src") != "mop":
        gaps.append("Break facing is estimated, so wind direction words may be off.")
    if s.get("country") == "MX":
        gaps.append("No official surf alerts cover Mexico.")
    return gaps


def build_alerts(items, spots, reg_by, now):
    zone_regions = collections.defaultdict(set)
    for s in spots:
        # an inventory zone group like 'CAZ349-350' must match an alert's single zone ids
        for z in spot_zones(s) + spot_zones(s, "coastal_zone"):
            zone_regions[z].add(s["region"])
    merged = {}
    seen = set()
    for a in items:
        if a["event"] not in SURF_EVENTS or a.get("status") not in (None, "Actual") or a["id"] in seen:
            continue
        if a.get("end") and a["end"] < now:
            continue
        zones = [z for z in a["ugc"] if z in zone_regions]
        regs = set()
        for z in zones:
            regs |= zone_regions[z]
        if not regs:
            continue
        seen.add(a["id"])
        what = alert_what(a["event"], a.get("what"))
        # one row per statement: offices issue the same event and words per zone group
        key = (a["event"], a.get("end"), what)
        row = merged.setdefault(key, {"id": a["id"], "event": a["event"], "severity": a.get("severity"), "what": what,
                                      "regions": set(), "zones": set(), "start": a.get("start"), "end": a.get("end")})
        row["regions"] |= regs
        row["zones"] |= set(zones)
        if a.get("start") and (row["start"] is None or a["start"] < row["start"]):
            row["start"] = a["start"]
    out = []
    for row in merged.values():
        ordered = sorted(row["regions"], key=lambda r: reg_by[r]["order"])
        until = None if not row["end"] else geo.clock(row["end"], reg_by[ordered[0]]["tz"], with_day=True)
        event = row["event"][0] + row["event"][1:].lower()
        text = event + (" until %s." % until if until else ".")
        if row["what"]:
            text += " " + row["what"]
        out.append({"id": row["id"], "event": row["event"], "severity": row["severity"], "text": text,
                    "regions": ordered, "zones": sorted(row["zones"]), "start": row["start"], "end": row["end"],
                    "until_label": until})
    out.sort(key=lambda x: (reg_by[x["regions"][0]]["order"], x["event"]))
    return out


def alert_what(event, what):
    """The WHAT line for this event. Combined statements ('For the High Surf Warning, ... For the Coastal Flood
    Advisory, ...') keep only the part that names this event."""
    if not what:
        return None
    text = what
    low = text.lower()
    mark = "for the %s," % event.lower()
    i = low.find(mark)
    if i < 0:
        mark = "for the first %s," % event.lower()
        i = low.find(mark)
    if i >= 0:
        rest = text[i + len(mark):].strip()
        j = rest.lower().find(" for the ")
        text = rest if j < 0 else rest[:j]
        text = text[:1].upper() + text[1:]
    text = text.strip().rstrip(".")
    if len(text) > 220:
        text = text[:220].rsplit(" ", 1)[0]
    return text + "."


def buoy_heights(history, latest, now):
    """Rolling 26 h of wave readings per station, {id: [[epoch, metres], ...]}, from each run's latest_obs."""
    out = {}
    for sid, rows in history.items():
        keep = [r for r in rows if now - r[0] <= 26 * HOUR]
        if keep:
            out[sid] = keep
    for sid, ob in latest.items():
        if ob.get("wvht_m") is None or now - ob["at"] > 3 * HOUR:
            continue
        rows = out.setdefault(sid, [])
        if not rows or rows[-1][0] < ob["at"]:
            rows.append([ob["at"], ob["wvht_m"]])
    return out


def hours_ft(rows, now):
    """24 hourly wave heights in feet ending with the current hour; each slot holds its newest reading, else null."""
    hour0 = now - now % HOUR
    start = hour0 - 23 * HOUR
    ft = [None] * 24
    for at, m in rows:
        i = (at - start) // HOUR
        if 0 <= i < 24:
            ft[i] = geo.r1(m * geo.M_TO_FT)
    return {"start": start, "step": HOUR, "ft": ft}


def spot_zones(s, key="surf_zone"):
    """A spot's NWS zone ids, groups expanded ('CAZ340-346' -> both). A zone the inventory marks uncertain ('?') is
    not used: a wrong zone would show another coast's forecast."""
    z = s.get(key) or ""
    if "?" in z:
        return []
    try:
        return parse._ugc_list(z) if z else []
    except (ValueError, IndexError):
        return []


def _zone_name(name):
    return name.title().replace(" And ", " and ").replace(" Of ", " of ") if name.isupper() else name


def current_period(entry, now):
    """The first forecast period that is not over at `now`. A period with no known end counts only while the
    product itself is in force. None when every period has ended."""
    for p in entry.get("periods") or []:
        end = p.get("end")
        if (end is not None and end > now) or (end is None and (entry.get("until") or 0) > now):
            return p
    return None


def spot_forecast(s, srf, tzname, now):
    """The NWS forecaster's surf height for this spot's zone (the beach facing part closest to the break) in the first
    period that is not over, and that period's rip current risk. (None, None) outside NWS surf zones (Baja), when the
    text has no number, or when every period has ended."""
    entry = next((srf[z] for z in spot_zones(s) if z in srf), None)
    if not entry:
        return None, None
    per = current_period(entry, now)
    if not per:
        return None, None
    fc = None
    parts = per["surf"]
    if parts:
        faced = [p for p in parts if p.get("facing_deg") is not None]
        part = (min(faced, key=lambda p: abs(geo.angle_diff(s["facing_deg"], p["facing_deg"]))) if faced and s.get("facing_deg") is not None
                else parts[0])
        fc = {"ft": part["ft"], "zone": entry["zone"], "name": _zone_name(entry["name"]), "period": per["period"]}
        for k in ("sets_ft", "facing"):
            if part.get(k):
                fc[k] = part[k]
        if entry.get("until"):
            fc["until"] = entry["until"]
            fc["until_label"] = geo.clock(entry["until"], tzname, with_day=True)
        if per.get("end"):
            fc["end"] = per["end"]
            fc["end_label"] = geo.clock(per["end"], tzname, with_day=True)
    rip = None if not per.get("rip") else {"risk": per["rip"], "zone": entry["zone"], "name": _zone_name(entry["name"])}
    return fc, rip


def build_buoys(inv, obs, spec, spots, now, history=None):
    by_id = {o["id"]: o for o in obs}
    out = []
    for st in inv["ndbc"]:
        o = by_id.get(st["id"])
        if not o or o["age_min"] > 180:
            continue
        if o.get("wvht_m") is None and o.get("wtmp_c") is None and o.get("wspd_kt") is None:
            continue
        near = min(spots, key=lambda s: geo.km(st["lat"], st["lon"], s["lat"], s["lon"]))
        sp = spec.get(st["id"])
        sp = sp if sp and now - sp["at"] <= 4 * HOUR else None
        out.append({
            "id": st["id"], "name": clean_name(st["name"]), "owner": "CDIP" if st.get("owner") == "SCRIPPS" else st.get("owner"),
            "kind": station_kind(st), "region": near["region"], "lat": st["lat"], "lon": st["lon"],
            "at": o["at"], "age_min": o["age_min"],
            "wave_ft": None if o.get("wvht_m") is None else geo.r1(o["wvht_m"] * geo.M_TO_FT),
            "dpd_s": o.get("dpd_s"), "apd_s": o.get("apd_s"), "mwd_deg": o.get("mwd"), "mwd": geo.compass(o.get("mwd")),
            "water_f": geo.r1(geo.c_to_f(o.get("wtmp_c"))),
            "wind": None if o.get("wspd_kt") is None else {
                "kt": int(round(o["wspd_kt"])), "gust_kt": None if o.get("gst_kt") is None else int(round(o["gst_kt"])),
                "dir_deg": o.get("wdir"), "dir": geo.compass(o.get("wdir"))},
            "swell": None if not sp or sp["swh_m"] is None else {"ft": geo.r1(sp["swh_m"] * geo.M_TO_FT), "period_s": sp["swp_s"],
                                                                  "dir": geo.compass(sp["swd"])},
            "wind_wave": None if not sp or sp["wwh_m"] is None else {"ft": geo.r1(sp["wwh_m"] * geo.M_TO_FT), "period_s": sp["wwp_s"],
                                                                      "dir": geo.compass(sp["wwd"])},
            "nearest_spot": {"id": near["id"], "name": near["name"], "km": round(geo.km(st["lat"], st["lon"], near["lat"], near["lon"]), 1)},
            "hours_ft": None if o.get("wvht_m") is None else hours_ft((history or {}).get(st["id"]) or [], now),
        })
    out.sort(key=lambda b: b["lat"])
    return out


def build_water(obs, piers, mur_spot, marine, spots, out_spots, nearest_spot, now):
    rows = []
    for o in obs:
        if o.get("wtmp_c") is None or o["age_min"] > 360 or not -2 < o["wtmp_c"] < 35:
            continue
        rows.append({"lat": o["lat"], "lon": o["lon"], "f": geo.r1(geo.c_to_f(o["wtmp_c"])), "kind": o["kind"], "id": o["id"],
                     "name": clean_name(o["name"]), "age_min": o["age_min"], "region": nearest_spot(o["lat"], o["lon"])["region"]})
    for p in piers:
        rows.append({"lat": p["lat"], "lon": p["lon"], "f": geo.r1(geo.c_to_f(p["c"])), "kind": "pier", "id": p["id"], "name": p["name"],
                     "age_min": (now - p["at"]) // 60, "region": nearest_spot(p["lat"], p["lon"])["region"]})
    seen = set()
    for s in spots:
        if s["id"] in mur_spot:
            c, at = mur_spot[s["id"]]
            key = (round(s["sst"][0], 2), round(s["sst"][1], 2))
            if key in seen:
                continue
            seen.add(key)
            rows.append({"lat": s["sst"][0], "lon": s["sst"][1], "f": geo.r1(geo.c_to_f(c)), "kind": "satellite", "id": None,
                         "name": s["name"], "age_min": (now - at) // 60, "region": s["region"]})
    for s in spots:
        key = cell_key(*s["om"])
        if key in seen:
            continue
        seen.add(key)
        v = _series_at(marine.get(key), "sea_surface_temperature", now)
        if v is not None:
            rows.append({"lat": s["om"][0], "lon": s["om"][1], "f": geo.r1(geo.c_to_f(v)), "kind": "model", "id": None,
                         "name": s["name"], "age_min": 0, "region": s["region"]})
    rows.sort(key=lambda r: r["lat"])
    regions = []
    by = collections.defaultdict(list)
    for x in out_spots:
        if x["now"]["water_f"]:
            by[x["region"]].append(x["now"]["water_f"]["value"])
    reg_rows = collections.defaultdict(list)
    for r in rows:
        reg_rows[r["region"]].append(r["f"])
    for rid in [s["region"] for s in spots]:
        if rid in [r["region"] for r in regions] or not by.get(rid):
            continue
        vals = by[rid]
        regions.append({"region": rid, "f": geo.r1(geo.median(vals)), "min": min(vals), "max": max(vals),
                        "spread": geo.r1(max(vals) - min(vals)), "n": len(reg_rows.get(rid, []))})
    bins = collections.defaultdict(list)
    for r in rows:
        bins[math.floor(r["lat"] * 2) / 2.0 + 0.25].append(r["f"])
    return {"rows": rows, "regions": regions,
            "bins": [{"lat": k, "f": geo.r1(geo.median(v)), "min": min(v), "max": max(v), "n": len(v)} for k, v in sorted(bins.items())]}


def build_tides(tide_events, out_spots, spots, reg_by, coops, now):
    used = collections.defaultdict(list)
    for x, s in zip(sorted(out_spots, key=lambda x: x["id"]), sorted(spots, key=lambda s: s["id"])):
        if x["tide_station"]:
            used[x["tide_station"]].append((x, s))
    out = []
    for key, members in used.items():
        events = tide_events.get(key) or []
        first = members[0][1]
        tzname = reg_by[first["region"]]["tz"]
        if key.startswith("model:"):
            la, lo = key[6:].split(",")
            meta = {"id": key, "name": "%s (model)" % first["name"], "lat": float(la), "lon": float(lo), "kind": "model",
                    "datum": "MSL"}
        else:
            st = coops.get(key, {})
            meta = {"id": key, "name": st.get("name", key), "lat": st.get("lat"), "lon": st.get("lon"), "kind": "prediction",
                    "datum": "MLLW"}
        hour0 = now - now % HOUR
        curve = [synth.tide_height(events, at) for at in range(hour0, hour0 + 48 * HOUR, HOUR)]
        meta.update({
            "state": synth.tide_state(events, now),
            "regions": sorted({s["region"] for _, s in members}, key=lambda r: reg_by[r]["order"]),
            "spots": len(members),
            "next": [{"type": e["type"], "at": e["at"], "ft": round(e["ft"], 1), "label": geo.clock(e["at"], tzname, with_day=True)}
                     for e in events if e["at"] > now][:4],
            "curve": {"start": hour0, "step": HOUR, "ft": [None if v is None else round(v, 2) for v in curve]},
        })
        out.append(meta)
    out.sort(key=lambda t: (t["lat"] is None, t["lat"] or 0))
    return out



def build_region(reg, rs, alerts, tides, water):
    rated = [x for x in rs if x["now"]["rating"] is not None]
    counts = collections.Counter((x["now"]["word"] or "").lower() for x in rated)
    rscore = None if not rated else geo.median([x["now"]["score"] for x in rated])
    rating = None if rscore is None else int(math.floor(rscore + 0.5))
    hs_med = geo.median([x["now"]["hs_ft"] for x in rated])
    # median low and median high: a percentile spread across a region read "7-17 ft" and helped nobody
    lo = geo.median([x["now"]["wave_ft"][0] for x in rated if x["now"]["wave_ft"]])
    hi = geo.median([x["now"]["wave_ft"][1] for x in rated if x["now"]["wave_ft"]])
    prim = [p for x in rated for p in x["now"]["swell"] if p["part"] == "primary"]
    swell = None
    if prim:
        swell = {"ft": geo.r1(geo.median([p["ft"] for p in prim])),
                 "period_s": None if not [p for p in prim if p["period_s"]] else int(round(geo.median([p["period_s"] for p in prim if p["period_s"]]))),
                 "dir_deg": geo.circ_mean([(p["dir_deg"], p["ft"]) for p in prim])}
        swell["dir"] = geo.compass(swell["dir_deg"])
    winds = [x["now"]["wind"] for x in rs if x["now"]["wind"]]
    wind = None
    if winds:
        kt = geo.median([w["kt"] for w in winds])
        q = collections.Counter(w["quality"] for w in winds if w["quality"]).most_common(1)
        quality = q[0][0] if q else None
        d = geo.circ_mean([(w["dir_deg"], max(w["kt"], 1)) for w in winds])
        wind = {"kt": int(round(kt)), "dir_deg": d, "dir": geo.compass(d), "quality": quality, "word": synth.wind_word(kt, quality)}
    wrow = next((w for w in water["regions"] if w["region"] == reg["id"]), None)
    water_f = None if not wrow else {"value": int(round(wrow["f"])), "min": int(round(wrow["min"])), "max": int(round(wrow["max"])), "n": wrow["n"]}
    if water_f:
        wscores = [x["now"]["water_f"]["confidence"]["score"] for x in rs if x["now"]["water_f"] and x["now"]["water_f"].get("confidence")]
        if wscores:
            ws = round(sum(wscores) / len(wscores), 2)
            water_f["confidence"] = {"level": "high" if ws >= 0.75 else "medium" if ws >= 0.5 else "low", "score": ws}
        if reg["id"] in UPWELLING_REGIONS:
            water_f["upwelling"] = synth.upwelling([w["f"] for w in water["rows"] if w["region"] == reg["id"]])
    rtides = [t for t in tides if reg["id"] in t["regions"]]
    main_t = max(rtides, key=lambda t: (t["kind"] == "prediction", t["spots"]), default=None)
    tide = None if not main_t else {"station": main_t["id"], "state": main_t["state"],
                                    "next": None if not main_t["next"] else dict(main_t["next"][0], label=main_t["next"][0]["label"].split(" ", 1)[-1])}
    bests = [(x["best"], x) for x in rs if x["best"]]
    best = None
    if bests:
        b, x = max(bests, key=lambda bx: (bx[0]["day"] == "today", bx[0]["rating"] or 0, -(bx[0]["start"])))
        best = {"spot": x["id"], "name": x["name"], "start": b["start"], "end": b["end"], "label": b["label"], "day": b["day"],
                "rating": b["rating"]}
    scores = [x["now"]["confidence"]["score"] for x in rs if x["now"]["confidence"]["level"]]
    cscore = None if not scores else round(sum(scores) / len(scores), 2)
    clevel = None if cscore is None else ("high" if cscore >= 0.75 else "medium" if cscore >= 0.5 else "low")
    model_only = sum(1 for x in rs if x["now"]["confidence"]["model_only"])
    gaps = []
    if model_only == len(rs):
        gaps.append("No wave buoys here. Heights are from models.")
    elif model_only:
        gaps.append("%d of %d spots have no buoy within 150 km." % (model_only, len(rs)))
    if reg.get("country") == "MX":
        gaps.append("No official surf alerts cover Mexico.")
    if not rated:
        gaps.append("No wave reading here right now.")
    n_alerts = sum(1 for a in alerts if reg["id"] in a["regions"])
    line = region_line(lo, hi, swell, wind, water_f, best)
    out = {
        "id": reg["id"], "name": reg["name"], "order": reg["order"], "lat_min": reg["lat_min"], "lat_max": reg["lat_max"],
        "tz": reg["tz"], "rating": rating, "word": synth.rating_word(rscore, hs_med),
        "wave_ft": None if lo is None else [int(math.floor(lo + 0.5)), max(int(math.floor(lo + 0.5)), int(math.floor(hi + 0.5)))],
        "hs_ft": geo.r1(hs_med), "swell": swell, "wind": wind, "water_f": water_f, "tide": tide, "best": best, "line": line,
        "spots": len(rs), "counts": {k: counts.get(k, 0) for k in ("great", "good", "fair", "poor", "flat")},
        "alerts": n_alerts, "confidence": {"level": clevel, "score": cscore}, "gaps": gaps,
    }
    fcs = collections.Counter(x["forecaster"]["zone"] for x in rs if x.get("forecaster"))
    if fcs:
        zone = fcs.most_common(1)[0][0]
        # the zone most of the region's spots sit in; its most exposed beach facing when the office splits by facing
        parts = [x["forecaster"] for x in rs if x.get("forecaster") and x["forecaster"]["zone"] == zone]
        out["forecaster"] = max(parts, key=lambda f: f["ft"][1])
    rips = [x["rip"] for x in rs if x.get("rip")]
    if rips:
        out["rip"] = max(rips, key=lambda r: ("low", "moderate", "high").index(r["risk"]))
    return out


def region_line(lo, hi, swell, wind, water_f, best):
    if lo is None:
        return "No wave reading here right now."
    a, b = int(math.floor(lo + 0.5)), int(math.floor(hi + 0.5))
    first = ("%d-%d ft" % (a, b)) if b > a else ("%d ft" % a)
    if swell and swell.get("dir"):
        first += " %s" % swell["dir"]
    if swell and swell.get("period_s"):
        first += " %d s" % swell["period_s"]
    parts = [first]
    if wind and wind.get("word"):
        parts.append(wind["word"] + " wind" if wind["word"] in ("calm", "light", "moderate", "strong") else wind["word"])
    if water_f:
        parts.append("%d°F" % water_f["value"])
    text = ", ".join(parts) + "."
    if best:
        text += " Best: %s %s %s." % (best["name"], best["day"], best["label"])
    return text


def build_sources(rows, counts, now):
    out = []
    for sid, (name, publisher, note) in SOURCES.items():
        r = rows.get(sid)
        if not r:
            out.append({"id": sid, "name": name, "publisher": publisher, "status": "unavailable", "as_of": None, "count": 0,
                        "note": "Not fetched this run."})
            continue
        total = r["ok"] + r["stale"] + r["missing"]
        if r["ok"] == total and total:
            status = "ok"
        elif r["ok"] + r["stale"] > 0:
            status = "stale"
        else:
            status = "unavailable"
        text = note
        if status != "ok":
            text = "%d of %d parts are old or missing. %s" % (r["stale"] + r["missing"], total, note)
        if r["errors"]:
            text += " Last problem: %s" % r["errors"][0]
        out.append({"id": sid, "name": name, "publisher": publisher, "status": status,
                    "as_of": min(r["as_of"]) if r["as_of"] else None, "count": counts.get(sid, 0), "note": text[:300]})
    return out


# ---- output --------------------------------------------------------------------------------------

def out_dir():
    return os.environ.get("DECK_FEED_DIR") or os.path.expanduser("~/.meshvault/status/house-feeds")


def spot_height_on():
    """Each break's own height (docs/surf-coast.md rule 1a) is on unless DECK_SURF_SPOT_HEIGHT is off, 0, false or no
    (a systemd drop-in turns it off without a code change; the feed then prints the area's heights, basis 'region')."""
    return (os.environ.get("DECK_SURF_SPOT_HEIGHT") or "on").strip().lower() not in ("off", "0", "false", "no")


def _atomic(path, obj):
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def write_outputs(base, overview, region_files):
    for rid, doc in region_files.items():
        _atomic(os.path.join(base, "surf-coast", rid + ".json"), doc)
    _atomic(os.path.join(base, "surf-coast.json"), overview)
    return os.path.join(base, "surf-coast.json")


def history_path(F):
    return os.path.join(F._dir("state"), "bias.json")


def read_history(F):
    """What runs remember: model-vs-buoy pairs (7 days) and buoy wave heights (26 h)."""
    try:
        with open(history_path(F)) as f:
            doc = json.load(f)
        return {"pairs": doc.get("pairs") or [], "buoys": doc.get("buoys") or {}}
    except (OSError, ValueError, AttributeError):
        return {"pairs": [], "buoys": {}}


def write_history(F, state):
    path = history_path(F)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"pairs": state["pairs"][-5000:], "buoys": state["buoys"]}, f)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def log_requests(F, now, tier):
    """One line per run with the HTTP requests per host, for the daily request budget."""
    path = os.path.join(F._dir("state"), "requests.jsonl")
    with open(path, "a") as f:
        f.write(json.dumps({"t": now, "tier": tier, "hosts": dict(F.requests)}) + "\n")
    os.chmod(path, 0o600)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Coast surf feed: Cabo San Lucas to the Columbia River.")
    ap.add_argument("--offline", action="store_true", help="use cached responses only, no network")
    ap.add_argument("--tier", choices=["main", "sat"], default="main",
                    help="main: the 30-minute run that writes the feed; sat: the daily satellite refresh (cache only)")
    ap.add_argument("--out", help="output directory (default $DECK_FEED_DIR or ~/.meshvault/status/house-feeds)")
    args = ap.parse_args(argv)
    t0 = time.monotonic()
    target = os.path.abspath(args.out or out_dir())
    cache = os.environ.get("DECK_DATA_CACHE") or os.path.expanduser("~/.cache/deck-data")
    print("surf-coast: output %s, cache %s" % (target if args.tier == "main" else "(none, satellite cache only)", cache),
          flush=True)
    now = int(time.time())
    inv = inventories()
    F = Fetcher(cache, now=now, offline=args.offline)
    raw, ledger = fetch_all(F, inv, now, sat=args.tier == "sat")
    log_requests(F, now, args.tier)
    reqs = ", ".join("%s %d" % (h, n) for h, n in sorted(F.requests.items())) or "none"
    if args.tier == "sat":
        row = ledger.rows.get("coastwatch-mur") or {}
        print("surf-coast sat: %d boxes cached, %d errors, %.0f s; requests: %s"
              % (len(raw["mur"]), len(row.get("errors", [])), time.monotonic() - t0, reqs))
        return 0
    overview, regions, state = assemble(inv, raw, ledger.rows, now, read_history(F), spot_height=spot_height_on())
    write_history(F, state)
    path = write_outputs(target, overview, regions)
    cov = overview["coverage"]
    print("surf-coast: %d spots (%d with data, %d model only), %d stations, %d alerts, %d water rows, %d KB, %.0f s; requests: %s -> %s"
          % (cov["spots"], cov["spots_with_data"], cov["spots_model_only"], cov["stations_reporting"], cov["alerts"],
             cov["water_rows"], os.path.getsize(path) // 1024, time.monotonic() - t0, reqs, path))
    return 0
