"""Geometry, units and time helpers for the coast surf feed. Stdlib only."""
import bisect
import datetime as dt
import math
from zoneinfo import ZoneInfo

M_TO_FT = 3.28084
MS_TO_KT = 1.943844
EARTH_KM = 6371.0
COMPASS16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
             "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
COMPASS8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def km(lat1, lon1, lat2, lon2):
    """Great-circle distance in km."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_KM * math.asin(min(1.0, math.sqrt(a)))


def compass(deg, points=8):
    if deg is None:
        return None
    names = COMPASS8 if points == 8 else COMPASS16
    step = 360.0 / len(names)
    return names[int(((deg % 360) + step / 2) // step) % len(names)]


def compass_to_deg(word):
    """'WSW' -> 247.5. None for anything that is not a 16-point compass word."""
    if not word:
        return None
    word = word.strip().upper()
    if word in COMPASS16:
        return COMPASS16.index(word) * 22.5
    return None


def angle_diff(a, b):
    """Smallest signed difference a - b in degrees, in (-180, 180]."""
    d = (a - b) % 360.0
    return d - 360.0 if d > 180.0 else d


def circ_mean(pairs):
    """Weighted circular mean of (deg, weight) pairs. None when nothing usable."""
    x = y = 0.0
    for deg, w in pairs:
        if deg is None or not w:
            continue
        x += w * math.cos(math.radians(deg))
        y += w * math.sin(math.radians(deg))
    if abs(x) < 1e-9 and abs(y) < 1e-9:
        return None
    return round(math.degrees(math.atan2(y, x)) % 360.0, 0)


def c_to_f(c):
    return None if c is None else c * 9.0 / 5.0 + 32.0


def r1(v):
    return None if v is None else round(v, 1)


def median(values):
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    n = len(vals)
    mid = n // 2
    return vals[mid] if n % 2 else (vals[mid - 1] + vals[mid]) / 2.0


def percentile(values, q):
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    if len(vals) == 1:
        return vals[0]
    pos = (len(vals) - 1) * q
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(vals) - 1)
    return vals[lo] + (vals[hi] - vals[lo]) * (pos - lo)


def _bracket(times, at):
    """(lo, hi) indexes with times[lo] <= at <= times[hi], or None outside the series."""
    if not times or at < times[0] or at > times[-1]:
        return None
    hi = bisect.bisect_left(times, at)
    if times[hi] == at:
        return hi, hi
    return hi - 1, hi


def interp_series(times, values, at):
    """Linear interpolation of a sorted (times, values) series at `at`. None outside or across a gap."""
    b = _bracket(times, at)
    if b is None or len(values) != len(times):
        return None
    lo, hi = b
    v0, v1 = values[lo], values[hi]
    if lo == hi:
        return v0
    if v0 is None or v1 is None:
        return None
    return v0 + (v1 - v0) * (at - times[lo]) / float(times[hi] - times[lo])


def interp_angle(times, values, at):
    """Angle interpolation that respects the 360 wrap."""
    b = _bracket(times, at)
    if b is None or len(values) != len(times):
        return None
    lo, hi = b
    a, c = values[lo], values[hi]
    if lo == hi:
        return a
    if a is None or c is None:
        return None
    f = (at - times[lo]) / float(times[hi] - times[lo])
    return (a + angle_diff(c, a) * f) % 360.0


_TZ = {}


def tz(name):
    if name not in _TZ:
        _TZ[name] = ZoneInfo(name)
    return _TZ[name]


def local(at, tzname):
    return dt.datetime.fromtimestamp(at, tz(tzname))


def clock(at, tzname, with_day=False):
    """'2:10 pm' or 'Sat 2:10 pm' in the spot's own time zone."""
    d = local(at, tzname)
    hour = d.hour % 12 or 12
    text = "%d:%02d %s" % (hour, d.minute, "am" if d.hour < 12 else "pm")
    if d.minute == 0:
        text = "%d %s" % (hour, "am" if d.hour < 12 else "pm")
    return ("%s %s" % (d.strftime("%a"), text)) if with_day else text


def window_label(start, end, tzname):
    """'7-9 am', '11 am-1 pm'."""
    a, b = local(start, tzname), local(end, tzname)
    ha, hb = a.hour % 12 or 12, b.hour % 12 or 12
    pa, pb = ("am" if a.hour < 12 else "pm"), ("am" if b.hour < 12 else "pm")
    fa = ("%d" % ha) if a.minute == 0 else ("%d:%02d" % (ha, a.minute))
    fb = ("%d" % hb) if b.minute == 0 else ("%d:%02d" % (hb, b.minute))
    if pa == pb:
        return "%s-%s %s" % (fa, fb, pb)
    return "%s %s-%s %s" % (fa, pa, fb, pb)


def _sun_event(day, lat, lon, zenith, rising):
    """NOAA sunrise equation. Returns epoch seconds or None (polar day/night)."""
    n = day.timetuple().tm_yday
    lng_hour = lon / 15.0
    t = n + ((6 if rising else 18) - lng_hour) / 24.0
    m = (0.9856 * t) - 3.289
    sun_l = (m + 1.916 * math.sin(math.radians(m)) + 0.020 * math.sin(math.radians(2 * m)) + 282.634) % 360
    ra = math.degrees(math.atan(0.91764 * math.tan(math.radians(sun_l)))) % 360
    ra += (math.floor(sun_l / 90) * 90) - (math.floor(ra / 90) * 90)
    ra /= 15.0
    sin_dec = 0.39782 * math.sin(math.radians(sun_l))
    cos_dec = math.cos(math.asin(sin_dec))
    cos_h = (math.cos(math.radians(zenith)) - sin_dec * math.sin(math.radians(lat))) / (cos_dec * math.cos(math.radians(lat)))
    if cos_h > 1 or cos_h < -1:
        return None
    h = (360 - math.degrees(math.acos(cos_h))) if rising else math.degrees(math.acos(cos_h))
    h /= 15.0
    local_t = h + ra - (0.06571 * t) - 6.622
    ut = (local_t - lng_hour) % 24
    base = dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc)
    return int((base + dt.timedelta(hours=ut)).timestamp())


def sun_times(local_date, lat, lon, tzname):
    """First light (civil dawn), sunrise, sunset and last light for a local calendar date, as epochs.

    The equation works in UTC days; an event that lands on the neighbouring local date is moved by a day.
    """
    out = {}
    for key, zen, rising in (("first_light", 96.0, True), ("sunrise", 90.833, True),
                             ("sunset", 90.833, False), ("last_light", 96.0, False)):
        at = None
        for shift in (0, -1, 1):
            cand = _sun_event(local_date + dt.timedelta(days=shift), lat, lon, zen, rising)
            if cand is not None and local(cand, tzname).date() == local_date:
                at = cand
                break
        out[key] = at
    return out
