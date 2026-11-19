"""Synthesis rules for the coast surf feed: blends, wind quality, rating, confidence, tide, water temperature.

Every function here is pure (numbers in, numbers out) so the rules are tested with synthetic inputs.
The rules are written down in docs/surf-coast.md; keep both in step.
"""
import math

from . import geo

# ---- wave height blend -------------------------------------------------------------------------

BUOY_RADIUS_KM = 150.0
BUOY_DECAY_KM = 40.0
BUOY_FRESH_MIN = 60.0
BUOY_DEAD_MIN = 180.0
# Offshore buoys in the lee of the Channel Islands or on outer banks read a different sea than the beach.
SHADOW = {"46025": 0.5, "46219": 0.5, "46251": 0.5, "46069": 0.5, "46047": 0.5}
BIAS_MIN, BIAS_MAX = 0.7, 1.4
BIAS_MIN_PAIRS = 3
OM_PERIOD_TO_PEAK = 0.85  # Open-Meteo swell period reads about 0.85 of a buoy peak period


def age_factor(age_min):
    """1.0 up to 60 min old, then linear to 0 at 180 min."""
    if age_min is None:
        return 0.0
    if age_min <= BUOY_FRESH_MIN:
        return 1.0
    if age_min >= BUOY_DEAD_MIN:
        return 0.0
    return 1.0 - (age_min - BUOY_FRESH_MIN) / (BUOY_DEAD_MIN - BUOY_FRESH_MIN)


def buoy_weight(dist_km, age_min, buoy_id=""):
    """exp(-d/40) x age factor x shadow factor (0.5 behind islands and on outer banks)."""
    if dist_km is None or dist_km > BUOY_RADIUS_KM:
        return 0.0
    return math.exp(-dist_km / BUOY_DECAY_KM) * age_factor(age_min) * SHADOW.get(str(buoy_id), 1.0)


def model_weights(nearest_buoy_km, has_mop):
    """(MOP weight, Open-Meteo weight) beside the buoy group.

    Fresh buoy under 30 km: MOP 0.3, OM 0.3. Buoy 30 to 100 km: MOP 0.35, OM 0.4.
    No buoy within 100 km: models only, MOP 0.6 and OM 0.4 (OM 1.0 alone).
    """
    if nearest_buoy_km is not None and nearest_buoy_km < 30:
        mop, om = 0.3, 0.3
    elif nearest_buoy_km is not None and nearest_buoy_km <= 100:
        mop, om = 0.35, 0.4
    else:
        mop, om = 0.6, 0.4
    if not has_mop:
        mop = 0.0
        if nearest_buoy_km is None or nearest_buoy_km > 100:
            om = 1.0
    return mop, om


def bias_ratio(pairs):
    """Open-Meteo bias factor from (observed m, model m) pairs: sum(obs)/sum(model), clamped 0.7 to 1.4.

    None when there are fewer than 3 usable pairs: the caller then keeps the model raw and says so.
    """
    good = [(o, m) for o, m in pairs if o is not None and m is not None and m > 0.05 and o >= 0]
    if len(good) < BIAS_MIN_PAIRS:
        return None
    ratio = sum(o for o, _ in good) / sum(m for _, m in good)
    return round(min(BIAS_MAX, max(BIAS_MIN, ratio)), 3)


def blend_waves(buoys, mop, om, bias):
    """Blend the nearest reporting buoys with the nearshore model (MOP) and the corrected global model.

    buoys: [{id, km, age_min, hs_m, period_s, dir}] (any order; up to 3 strongest are used)
    mop:   {hs_m, tp_s, dp, id} or None
    om:    {hs_m, swell_period_s, swell_dir} or None (raw model)
    bias:  Open-Meteo factor or None (None keeps the raw model)
    Returns {hs_m, period_s, dir, parts[], model_only, nearest_buoy_km, n} or None when nothing reports.
    """
    usable = []
    for b in buoys:
        if b.get("hs_m") is None:
            continue
        w = buoy_weight(b.get("km"), b.get("age_min"), b.get("id"))
        if w > 0:
            usable.append(dict(b, weight=w))
    usable.sort(key=lambda x: -x["weight"])
    usable = usable[:3]
    nearest = min((b["km"] for b in usable), default=None)
    has_mop = bool(mop and mop.get("hs_m") is not None)
    w_mop, w_om = model_weights(nearest, has_mop)
    parts = []
    for b in usable:
        parts.append({"kind": "buoy", "id": b["id"], "km": round(b["km"], 1), "age_min": b.get("age_min"),
                      "hs_m": b["hs_m"], "period_s": b.get("period_s"), "dir": b.get("dir"),
                      "weight": round(b["weight"], 3)})
    if has_mop:
        parts.append({"kind": "nearshore model", "id": mop.get("id"), "hs_m": mop["hs_m"], "age_min": mop.get("age_min"),
                      "period_s": mop.get("tp_s"), "dir": mop.get("dp"), "weight": w_mop})
    if om and om.get("hs_m") is not None and om["hs_m"] > 0:
        # A zero next to the coast is a land-masked cell, not flat water.
        factor = bias if bias is not None else 1.0
        per = om.get("swell_period_s")
        parts.append({"kind": "global model", "hs_m": om["hs_m"] * factor, "raw_m": om["hs_m"],
                      "bias": bias, "period_s": None if per is None else per / OM_PERIOD_TO_PEAK,
                      "dir": om.get("swell_dir"), "weight": w_om})
    parts = [p for p in parts if p["weight"] > 0]
    if not parts:
        return None
    tw = sum(p["weight"] for p in parts)
    hs = sum(p["hs_m"] * p["weight"] for p in parts) / tw
    per_parts = [(p["period_s"], p["weight"]) for p in parts if p.get("period_s")]
    period = (sum(v * w for v, w in per_parts) / sum(w for _, w in per_parts)) if per_parts else None
    direction = geo.circ_mean([(p.get("dir"), p["weight"]) for p in parts])
    return {"hs_m": hs, "period_s": period, "dir": direction, "parts": parts,
            "model_only": not usable, "nearest_buoy_km": nearest, "n": len(parts)}


# Per-spot height: the nearshore model (CDIP MOP, 10 m depth, one point per break) sets each break's share, the region's
# buoy blend sets the level. Factor = median of the blended heights / median of the MOP heights over the region's spots
# that have both. Scaling keeps the order, so the median of the scaled spots is exactly the median blend: the region's
# printed level (a median of its spots) stays where the buoys put it, and the spread between spots comes from MOP.
MOP_SCALE_MIN_SPOTS = 3
MOP_SCALE_MIN, MOP_SCALE_MAX = 0.5, 4.0


def mop_scale(pairs):
    """Region factor from (blended m, MOP m) per spot. None with fewer than 3 spots, or when the factor falls outside
    0.5 to 4: the model and the buoys then disagree too much for the model's spot shape to be trusted."""
    good = [(b, m) for b, m in pairs if b is not None and m is not None and m >= 0]
    if len(good) < MOP_SCALE_MIN_SPOTS:
        return None
    mid = geo.median([m for _, m in good])
    if mid <= 0:
        return None
    k = geo.median([b for b, _ in good]) / mid
    return k if MOP_SCALE_MIN <= k <= MOP_SCALE_MAX else None


def spot_height(blend_m, mop_m, factor):
    """(height m, basis): factor x the spot's MOP height ('spot'), else the blended height ('region')."""
    if blend_m is None:
        return None, None
    if factor is None or mop_m is None:
        return blend_m, "region"
    return factor * mop_m, "spot"


# Checks on a scaled height (rule 1b). A wave sensor counts when it reports within 3 h, stands within 3 km of the shore
# (a pier gauge or a nearshore buoy) and within 2 km of the break; "at the break" is within 1 km. Further out a sensor
# reads another stretch of coast (Black's Beach and the Scripps sensors sit on opposite sides of the Scripps canyon,
# 2.5 km apart). Scaled and sensor heights disagree when they differ by more than 1 ft and by more than 20% of the
# sensor: on 2026-11-15 the 8 pairs within 2 km differed by 11% or less except Del Mar (27%) and Scripps Pier (37%).
SENSOR_NEAR_KM, SENSOR_AT_BREAK_KM, SENSOR_SHORE_KM, SENSOR_MAX_AGE_MIN = 2.0, 1.0, 3.0, 180
SENSOR_BOUND_FT, SENSOR_BOUND_FRAC = 1.0, 0.2
# The forecaster's band: the NWS surf height is a breaking height and runs at or above the significant height the feed
# prints, so a scaled height over 1.5 x the top of the forecaster's range (sets included) or under a fifth of its low
# end is not believed. Sheltered breaks inside a zone do read far below it: on 2026-11-15 Fort Point (inside the Golden
# Gate) read 0.25 of its zone's low end, Moss Landing 0.35, Newport Pier 0.45.
BAND_TOP, BAND_FLOOR = 1.5, 0.2


def sensor_disagrees(scaled_ft, sensor_ft):
    """True when a scaled height and a near sensor's height differ by over 1 ft and over 20% of the sensor."""
    d = abs(scaled_ft - sensor_ft)
    return d > SENSOR_BOUND_FT and d > SENSOR_BOUND_FRAC * sensor_ft


def outside_band(hs_ft, fc_ft, sets_ft=None):
    """'above' or 'below' when a height sits outside the forecaster's band, else None. fc_ft: [lo, hi] feet."""
    if hs_ft is None or not fc_ft:
        return None
    top = max(fc_ft[1], sets_ft or 0)
    if hs_ft > BAND_TOP * top:
        return "above"
    if hs_ft < BAND_FLOOR * fc_ft[0]:
        return "below"
    return None


def checked_height(blend_m, scaled_m, sensor, fc):
    """Final (height m, basis, why) for a break with a scaled height.

    sensor: {hs_m, km} of the nearest qualifying sensor or None; fc: the forecaster {ft, sets_ft} or None.
    A disagreeing sensor at the break gives its own reading ('sensor'); one further off sends the break to the area's
    blend ('region'). A scaled height outside the forecaster's band also goes to the blend. why: None,
    'sensor_disagrees' or 'outside_forecaster_band'."""
    ft = scaled_m * geo.M_TO_FT
    if sensor and sensor_disagrees(ft, sensor["hs_m"] * geo.M_TO_FT):
        if sensor["km"] <= SENSOR_AT_BREAK_KM:
            return sensor["hs_m"], "sensor", "sensor_disagrees"
        return blend_m, "region", "sensor_disagrees"
    if fc and outside_band(ft, fc.get("ft"), fc.get("sets_ft")):
        return blend_m, "region", "outside_forecaster_band"
    return scaled_m, "spot", None


def confidence(blend):
    """Score 0 to 1 from the sources and how far they agree. Levels: high >= 0.75, medium >= 0.5, low."""
    if not blend:
        return {"level": None, "score": 0.0, "sources": 0, "model_only": True}
    vals = [p["hs_m"] for p in blend["parts"]]
    mean = sum(vals) / len(vals)
    agree = 1.0 if len(vals) < 2 or mean <= 0 else max(0.0, 1.0 - (max(vals) - min(vals)) / mean)
    if blend["model_only"]:
        score = 0.3 if len(vals) < 2 else 0.3 + 0.15 * agree
    else:
        top = max(p["weight"] for p in blend["parts"] if p["kind"] == "buoy")
        score = 0.5 + 0.3 * min(1.0, top) + 0.2 * (agree if len(vals) > 1 else 0.5)
    score = round(min(1.0, score), 2)
    level = "high" if score >= 0.75 else "medium" if score >= 0.5 else "low"
    return {"level": level, "score": score, "sources": len(vals), "model_only": blend["model_only"]}


def surf_range_ft(hs_m, period_s):
    """Whole-feet range: blended significant height (low) to a long-period shoaling allowance (high).

    High = Hs x (1 + 0.03 per second of peak period above 8 s), at most x1.35.
    """
    if hs_m is None:
        return None
    ft = hs_m * geo.M_TO_FT
    grow = 1.0 if not period_s else min(1.35, 1.0 + 0.03 * max(0.0, period_s - 8.0))
    lo = int(math.floor(ft + 0.25))
    hi = int(math.floor(ft * grow + 0.75))
    return [lo, max(lo, hi)] if ft >= 0.75 else [0, max(1, hi)]


# ---- wind ------------------------------------------------------------------------------------------

def wind_quality(wind_from, facing):
    """'offshore', 'cross-shore' or 'onshore' for wind blowing FROM `wind_from` at a break facing `facing`.

    A break facing 250 deg looks out to the WSW; wind from the WSW blows straight onshore. With
    c = cos(wind_from - facing): onshore when c > 0.5, offshore when c < -0.5, else cross-shore.
    """
    if wind_from is None or facing is None:
        return None
    c = math.cos(math.radians(geo.angle_diff(wind_from, facing)))
    if c > 0.5:
        return "onshore"
    if c < -0.5:
        return "offshore"
    return "cross-shore"


def wind_word(kt, quality):
    if kt is None:
        return None
    if kt <= 4:
        return "calm"
    if quality is None:
        return "light" if kt <= 10 else "strong" if kt > 15 else "moderate"
    if kt <= 10:
        return "light " + quality
    if kt > 15:
        return "strong " + quality
    return quality


def blend_wind(model, obs):
    """Model wind beside one observed station within 15 km (half weight each, vector mean for direction).

    model, obs: {kt, dir, gust_kt} or None. Returns the same shape plus n.
    """
    pts = [p for p in (model, obs) if p and p.get("kt") is not None]
    if not pts:
        return None
    kt = sum(p["kt"] for p in pts) / len(pts)
    d = geo.circ_mean([(p.get("dir"), max(p["kt"], 0.1)) for p in pts])
    gusts = [p.get("gust_kt") for p in pts if p.get("gust_kt") is not None]
    return {"kt": kt, "dir": d, "gust_kt": max(gusts) if gusts else None, "n": len(pts)}


# ---- rating ----------------------------------------------------------------------------------------

def _lin(x, x0, y0, x1, y1):
    if x <= x0:
        return y0
    if x >= x1:
        return y1
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0)


def size_points(hs_ft):
    """0 to 4: 0 at 1 ft rising to 4 at 5 ft; 4 to 10 ft; then down to 3 at 15 ft and 2 at 20 ft (closeouts)."""
    if hs_ft <= 5:
        return _lin(hs_ft, 1, 0, 5, 4)
    if hs_ft <= 10:
        return 4.0
    if hs_ft <= 15:
        return _lin(hs_ft, 10, 4, 15, 3)
    return _lin(hs_ft, 15, 3, 20, 2)


def period_points(period_s):
    """0 to 2: 0 at 8 s rising to 2 at 16 s."""
    return 0.75 if period_s is None else _lin(period_s, 8, 0, 16, 2)


def wind_points(kt, quality):
    """0 to 3: calm (4 kt or less) or offshore up to 15 kt score 3; onshore over 15 kt scores 0."""
    if kt is None:
        return 1.5
    if kt <= 4:
        return 3.0
    if quality == "offshore":
        return 3.0 if kt <= 15 else 2.0 if kt <= 25 else 1.0
    if quality == "cross-shore":
        return 1.5 if kt <= 10 else 1.0 if kt <= 15 else 0.5
    if quality == "onshore":
        return 1.0 if kt <= 8 else 0.5 if kt <= 15 else 0.0
    return 1.5


def tide_points(state):
    return 1.0 if state == "rising" else 0.5


# Score to word, fitted against the old 7-spot feed (the owner's daily reference) on the 42 comparison points both
# feeds share (the 7 home spots now and the 35 outlook days): docs/surf-coast.md rule 9. The old scale tops out at
# "good", so old "good" is the new Good and Great sits above the old scale. Great needs a solid 5 ft swell, a 16 s
# period, calm or offshore wind and a good tide at once, so the top word stays rare.
WORD_CUTS = (5.0, 7.5, 9.75)
WORDS = ("Flat", "Poor", "Fair", "Good", "Great")


def rating_word(score, hs_ft):
    """0 to 10 score -> Flat, Poor, Fair, Good or Great. Flat under 1 ft, then the fitted cut points."""
    if score is None:
        return None
    if hs_ft is not None and hs_ft < 1.0:
        return "Flat"
    poor, fair, good = WORD_CUTS
    if score < poor:
        return "Poor"
    if score < fair:
        return "Fair"
    if score < good:
        return "Good"
    return "Great"


def rate(hs_ft, period_s, wind_kt, quality, tide_state):
    """0 to 10 rating: size 0-4 + period 0-2 + wind 0-3 + tide 0-1.

    Capped at 4 in onshore wind over 15 kt and at 1 under 1 ft. Returns (score float, rating int, word) or
    (None, None, None) without a wave height.
    """
    if hs_ft is None:
        return None, None, None
    score = size_points(hs_ft) + period_points(period_s) + wind_points(wind_kt, quality) + tide_points(tide_state)
    if quality == "onshore" and wind_kt is not None and wind_kt > 15:
        score = min(score, 4.0)
    if hs_ft < 1.0:
        score = min(score, 1.0)
    score = round(min(10.0, max(0.0, score)), 2)
    return score, int(math.floor(score + 0.5)), rating_word(score, hs_ft)


def reason(hs_ft, period_s, direction, wind_kt, quality, tide_state):
    """'5 ft at 14 s from SW, light offshore wind, rising tide'."""
    if hs_ft is None:
        return "No wave reading here right now."
    first = "%d ft" % int(math.floor(hs_ft + 0.5)) if hs_ft >= 1 else "Under 1 ft"
    if period_s:
        first += " at %d s" % int(round(period_s))
    if direction is not None:
        first += " from %s" % geo.compass(direction)
    parts = [first]
    w = wind_word(wind_kt, quality)
    if w:
        parts.append("calm wind" if w == "calm" else w + " wind")
    if tide_state:
        parts.append("%s tide" % tide_state)
    return ", ".join(parts)


# ---- tide ------------------------------------------------------------------------------------------

SLACK_S = 30 * 60


def tide_state(events, at):
    """'rising', 'falling', 'high' or 'low' (within 30 min of a turn); None outside the predictions."""
    prev = next_ = None
    for e in events:
        if e["at"] <= at:
            prev = e
        elif next_ is None:
            next_ = e
    if prev is None or next_ is None:
        return None
    if at - prev["at"] <= SLACK_S:
        return "high" if prev["type"] == "H" else "low"
    if next_["at"] - at <= SLACK_S:
        return "high" if next_["type"] == "H" else "low"
    return "rising" if next_["type"] == "H" else "falling"


def tide_height(events, at):
    """Height between two predicted turns by the cosine rule. None outside the predictions."""
    prev = next_ = None
    for e in events:
        if e["at"] <= at:
            prev = e
        elif next_ is None:
            next_ = e
    if prev is None or next_ is None:
        return None
    span = next_["at"] - prev["at"]
    if span <= 0:
        return prev["ft"]
    f = (at - prev["at"]) / float(span)
    return prev["ft"] + (next_["ft"] - prev["ft"]) * (1 - math.cos(math.pi * f)) / 2.0


def extrema_from_series(times, values, min_range_ft=0.3, min_gap_s=4 * 3600):
    """Highs and lows of an hourly sea-level series (model tide), refined with a parabola through 3 points.

    Wiggles smaller than `min_range_ft` are dropped and the list alternates high, low, high.
    """
    out = []
    for i in range(1, len(values) - 1):
        a, b, c = values[i - 1], values[i], values[i + 1]
        if a is None or b is None or c is None:
            continue
        if (b > a and b >= c) or (b < a and b <= c):
            denom = a - 2 * b + c
            off = 0.0 if denom == 0 else max(-0.5, min(0.5, 0.5 * (a - c) / denom))
            step = times[i + 1] - times[i]
            ft = b - 0.25 * (a - c) * off
            out.append({"type": "H" if b > a else "L", "at": int(times[i] + off * step), "ft": round(ft, 2)})
    out = _alternate(out)
    while True:
        # a wiggle is a pair of turns that is both small and close together; mixed tides keep their small real pair
        small = next((i for i in range(len(out) - 1) if abs(out[i]["ft"] - out[i + 1]["ft"]) < min_range_ft
                      and (out[i + 1]["at"] - out[i]["at"] < min_gap_s or abs(out[i]["ft"] - out[i + 1]["ft"]) < 0.1)), None)
        if small is None:
            return out
        del out[small:small + 2]
        out = _alternate(out)


def _alternate(events):
    """Merge runs of the same turn type, keeping the most extreme one."""
    out = []
    for e in events:
        if out and out[-1]["type"] == e["type"]:
            higher = e["ft"] > out[-1]["ft"]
            if (e["type"] == "H") == higher:
                out[-1] = e
        else:
            out.append(e)
    return out


# ---- water temperature -----------------------------------------------------------------------------

def water_blend(votes):
    """Median of the votes with the spread (max - min). votes: [{kind, f, ...}]."""
    vals = [v["f"] for v in votes if v.get("f") is not None]
    if not vals:
        return None
    return {"value": round(geo.median(vals), 1), "spread": round(max(vals) - min(vals), 1), "n": len(vals)}


UPWELLING_SPREAD_F = 3.6  # 2 degrees C
OBSERVED_KINDS = ("buoy", "shore station", "tide station", "pier")


def _level(score):
    return "high" if score >= 0.75 else "medium" if score >= 0.5 else "low"


def water_confidence(votes):
    """{level, score} for a water temperature: observed readings (buoy, shore, tide station, pier) and agreement.

    No observed reading: 0.25 (model alone) or 0.4 (satellite and model within 2 F). With observed readings:
    0.5 + 0.15 per observed reading (at most 2) + 0.2 x agreement, agreement = 1 - spread / 4 F.
    """
    vals = [v for v in votes if v.get("f") is not None]
    if not vals:
        return None
    spread = max(v["f"] for v in vals) - min(v["f"] for v in vals)
    obs = sum(1 for v in vals if v["kind"] in OBSERVED_KINDS)
    if not obs:
        score = 0.4 if len(vals) > 1 and spread <= 2.0 else 0.25
    else:
        score = 0.5 + 0.15 * min(obs, 2) + 0.2 * max(0.0, 1.0 - spread / 4.0)
    score = round(min(1.0, score), 2)
    return {"level": _level(score), "score": score}


def upwelling(values):
    """True when water readings sit more than 2 C (3.6 F) apart: cold upwelled water next to warmer water."""
    vals = [v for v in values if v is not None]
    return len(vals) >= 2 and max(vals) - min(vals) > UPWELLING_SPREAD_F


def day_confidence(day_index, now_confidence):
    """{level, score} for an outlook day: forecast lead (days 0-1 0.8, 2-4 0.6, 5-6 0.4) capped by the spot's own
    sources now (a model-only spot never rises above its now score)."""
    lead = 0.8 if day_index <= 1 else 0.6 if day_index <= 4 else 0.4
    cap = (now_confidence or {}).get("score")
    score = round(lead if cap is None else min(lead, cap), 2)
    return {"level": _level(score), "score": score}


# ---- best window and day parts ---------------------------------------------------------------------

def best_window(hours, daylight):
    """Best 2 consecutive daylight hours. hours: [{at, score}] hourly; daylight: [(sunrise, sunset)].

    Returns (start, end, mean score) or None.
    """
    def lit(at):
        return any(rise <= at and at + 7200 <= sset for rise, sset in daylight)

    best = None
    for a, b in zip(hours, hours[1:]):
        if b["at"] - a["at"] != 3600 or a.get("score") is None or b.get("score") is None or not lit(a["at"]):
            continue
        s = (a["score"] + b["score"]) / 2.0
        if best is None or s > best[2] + 1e-9:
            best = (a["at"], a["at"] + 7200, s)
    return best
