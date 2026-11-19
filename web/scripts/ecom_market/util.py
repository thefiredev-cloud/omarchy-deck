"""Small pure helpers shared by the e-commerce market sources and builders."""
import datetime as dt
import html
import math
import os
import re
from zoneinfo import ZoneInfo

# The collector's day never follows the host. The owner's zone is named once, here: a host in UTC (or anywhere else) rolls
# the day at midnight Pacific, as the deck shows it, and the history's day keys stay put when the host moves. Override with
# ECOM_OWNER_TZ only to run the collector for another owner.
OWNER_TZ = os.environ.get("ECOM_OWNER_TZ") or "America/Los_Angeles"
_ZONE = ZoneInfo(OWNER_TZ)

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def num(value):
    """Parse a publisher number ('1,234', '$5.2', '12%', '(8,783.50)', '', 'NA') to float, or None."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return None if isinstance(value, float) and (math.isnan(value) or math.isinf(value)) else float(value)
    text = str(value).strip().replace(",", "").replace("$", "").replace("%", "")
    neg = text.startswith("(") and text.endswith(")")
    text = text.strip("()")
    if text in ("", "NA", "N/A", "null", "None", "-", "--", ".", "(D)", "(S)", "(X)"):
        return None
    try:
        out = float(text)
    except ValueError:
        return None
    if math.isnan(out) or math.isinf(out):
        return None
    return -out if neg else out


def r2(v):
    return None if v is None else round(v, 2)


def quantile(vals, q):
    """Linear-interpolated quantile of an unsorted list; None when empty."""
    vals = sorted(v for v in vals if v is not None)
    if not vals:
        return None
    pos = (len(vals) - 1) * q
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(vals) - 1)
    return vals[lo] + (vals[hi] - vals[lo]) * (pos - lo)


def median(vals):
    return quantile(vals, 0.5)


def pct_change(new, old):
    """Percent change new vs old, or None when either is missing or old is 0."""
    if new is None or old in (None, 0):
        return None
    return (new / old - 1.0) * 100.0


def html_text(page):
    """Visible text of an HTML page on one line (scripts and styles dropped, entities decoded)."""
    page = re.sub(r"(?is)<(script|style|noscript)\b.*?</\1>", " ", page)
    page = re.sub(r"(?s)<[^>]+>", " ", page)
    return re.sub(r"\s+", " ", html.unescape(page)).strip()


def table_rows(page):
    """[[cell text, ...], ...] for every <tr> of an HTML fragment."""
    rows = []
    for tr in re.findall(r"(?is)<tr\b.*?</tr>", page):
        cells = [html_text(c) for c in re.findall(r"(?is)<t[dh]\b.*?</t[dh]>", tr)]
        if cells:
            rows.append(cells)
    return rows


def parse_day(text):
    """'Nov. 16 2026', 'Nov. 9, 2026', '12 Nov 2026', 'Thursday, 12 Nov 2026', '2026-11-12' -> '2026-11-12' or None."""
    if not text:
        return None
    text = text.strip()
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", text)
    if m:
        return m.group(0)
    m = re.search(r"([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})", text)
    if m and m.group(1).lower() in MONTHS:
        return "%s-%02d-%02d" % (m.group(3), MONTHS[m.group(1).lower()], int(m.group(2)))
    m = re.search(r"(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})", text)
    if m and m.group(2).lower() in MONTHS:
        return "%s-%02d-%02d" % (m.group(3), MONTHS[m.group(2).lower()], int(m.group(1)))
    return None


def month_period(text):
    """'October 2026' -> '2026-10' or None."""
    m = re.search(r"([A-Za-z]{3})[a-z]*\s+(\d{4})", text or "")
    if m and m.group(1).lower() in MONTHS:
        return "%s-%02d" % (m.group(2), MONTHS[m.group(1).lower()])
    return None


def owner_date(now=None):
    """The owner's calendar day for `now` (epoch seconds, default the current time)."""
    return dt.datetime.fromtimestamp(dt.datetime.now().timestamp() if now is None else now, tz=_ZONE).date()


def today(now=None):
    return owner_date(now).isoformat()


def days_between(a, b):
    """Whole days from ISO date a to ISO date b."""
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days


def shift_day(day, n):
    return (dt.date.fromisoformat(day) + dt.timedelta(days=n)).isoformat()


_NOISE = frozenset("a an and the for of in on to with by new from".split())


def norm_tokens(text):
    """Lower-case word tokens without punctuation and filler words."""
    words = re.findall(r"[a-z0-9]+(?:\.[0-9]+)?", (text or "").lower().replace("'", ""))
    return [w for w in words if w not in _NOISE]


def nearest(series, day, max_gap):
    """Value of a {day: value} map at `day`, or at the nearest day within max_gap days; None otherwise."""
    if day in series:
        return series[day]
    best, best_gap = None, max_gap + 1
    for d, v in series.items():
        gap = abs(days_between(d, day))
        if gap < best_gap:
            best, best_gap = v, gap
    return best if best_gap <= max_gap else None


# sizes a title states: volume in ml, weight in g, pack count. Plain "oz" is weight; "fl oz" is volume.
_SIZE_UNITS = (
    (r"fl\.?\s*oz|fluid\s+ounces?", "ml", 29.5735),
    (r"ml|millilit(?:er|re)s?", "ml", 1.0),
    (r"l|ltr|lit(?:er|re)s?", "ml", 1000.0),
    (r"gal(?:lon)?s?", "ml", 3785.41),
    (r"kg|kilo(?:gram)?s?", "g", 1000.0),
    (r"g|grams?", "g", 1.0),
    (r"lbs?|pounds?", "g", 453.592),
    (r"oz|ounces?", "g", 28.3495),
)
_SIZE_RE = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)\s*-?\s*(%s)(?![a-z])" % "|".join("(?:%s)" % u for u, _, _ in _SIZE_UNITS))
_PACK_RE = re.compile(r"(?<![\w.])(\d+)\s*-?\s*(?:pack|pk|ct|count)\b|\bpack\s+of\s+(\d+)\b")
SIZE_TOLERANCE = 0.05


def sizes(text):
    """{"ml": [..], "g": [..], "pack": [..]} of the sizes a title or query states; empty dict when it states none."""
    t = (text or "").lower()
    out = {}
    for m in _SIZE_RE.finditer(t):
        unit = m.group(2)
        for pat, dim, factor in _SIZE_UNITS:
            if re.fullmatch(pat, unit):
                out.setdefault(dim, []).append(float(m.group(1)) * factor)
                break
    for m in _PACK_RE.finditer(t):
        out.setdefault("pack", []).append(float(m.group(1) or m.group(2)))
    return out


def size_differs(want, have):
    """True only when a size the watch names is stated by the listing in the same measure and none of the listing's
    values sits within 5 % of it. A listing that states no size in that measure is kept (unknown is not different)."""
    for dim, wanted in want.items():
        got = have.get(dim)
        if not got:
            continue
        if not any(abs(g - w) <= SIZE_TOLERANCE * w for w in wanted for g in got):
            return True
    return False
