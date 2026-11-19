"""Macro sources: FRED-hosted official series (one request per publisher group) and the public pages for container
rates, carrier fuel surcharges, USPS prices, Port of Los Angeles volumes and Federal Register trade notices.

Each `load_*(ctx, now)` returns {"as_of", "count", "data"} or raises ctx.SourceUnavailable. Parsers are pure."""
import csv
import datetime as dt
import io
import re
import urllib.parse
import zipfile

from .ctx import SourceUnavailable
from .registry import FRED_SOURCES
from .util import html_text, month_period, num, owner_date, parse_day, table_rows

FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=%s"


# ---------------------------------------------------------------- FRED
def parse_fredgraph(raw):
    """fredgraph bytes -> {series_id: [(YYYY-MM-DD, value), ...]} oldest first. One frequency answers a CSV; mixed
    frequencies answer a zip with one CSV per frequency (seen 2026-11-14). Blank and '.' cells are skipped."""
    texts = []
    if raw[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            texts = [zf.read(n).decode("utf8", "replace") for n in zf.namelist() if n.endswith(".csv")]
    else:
        texts = [raw.decode("utf8", "replace")]
    out = {}
    for text in texts:
        rows = list(csv.reader(io.StringIO(text)))
        if not rows or not rows[0] or not rows[0][0].lower().startswith(("observation_date", "date")):
            continue
        head = rows[0]
        for i, sid in enumerate(head[1:], 1):
            pts = []
            for r in rows[1:]:
                if len(r) > i and re.fullmatch(r"\d{4}-\d{2}-\d{2}", r[0] or ""):
                    v = num(r[i])
                    if v is not None:
                        pts.append((r[0], v))
            out[sid] = pts
    if not out:
        raise SourceUnavailable("FRED answered no series table")
    return out


def period_of(date, cadence):
    if cadence == "quarterly":
        return "%s-Q%d" % (date[:4], (int(date[5:7]) - 1) // 3 + 1)
    if cadence == "monthly":
        return date[:7]
    return date


def _year_ago(points, date, cadence):
    if cadence in ("monthly", "quarterly"):
        target = "%04d%s" % (int(date[:4]) - 1, date[4:])
        for d, v in points:
            if d == target:
                return v
        return None
    day = dt.date.fromisoformat(date) - dt.timedelta(days=364)
    best = min(points, key=lambda p: abs((dt.date.fromisoformat(p[0]) - day).days), default=None)
    if best and abs((dt.date.fromisoformat(best[0]) - day).days) <= 6:
        return best[1]
    return None


def change_of(unit, new, old):
    """(change, change_unit): percentage points for percent series, else percent change."""
    if new is None or old is None:
        return None, None
    if unit == "pct":
        return round(new - old, 2), "pct_pts"
    if old == 0:
        return None, None
    return round((new / old - 1) * 100, 2), "pct"


def series_row(key, label, group, unit, cadence, points, source, note=None):
    """One macro row from oldest-first (date, value) points."""
    if not points:
        return {"key": key, "label": label, "group": group, "unit": unit, "value": None, "period": None,
                "prior": None, "change": None, "change_unit": None, "yoy": None, "yoy_unit": None,
                "cadence": cadence, "hist": [], "source": source, "note": note}
    date, value = points[-1]
    prior = points[-2] if len(points) > 1 else None
    ch, ch_unit = change_of(unit, value, prior[1] if prior else None)
    yoy, yoy_unit = change_of(unit, value, _year_ago(points, date, cadence))
    return {"key": key, "label": label, "group": group, "unit": unit, "value": value,
            "period": period_of(date, cadence),
            "prior": {"value": prior[1], "period": period_of(prior[0], cadence)} if prior else None,
            "change": ch, "change_unit": ch_unit, "yoy": yoy, "yoy_unit": yoy_unit, "cadence": cadence,
            "hist": [[period_of(d, cadence), v] for d, v in points[-36:]], "source": source, "note": note}


def load_fred(source_id):
    spec = FRED_SOURCES[source_id]

    def load(ctx, now):
        ids = [s[3] for s in spec["series"]]
        path, _ = ctx.fetch(FRED_URL % ",".join(ids), source_id + ".fredgraph", min_age=6 * 3600, timeout=60)
        with open(path, "rb") as fh:
            got = parse_fredgraph(fh.read())
        missing = [i for i in ids if not got.get(i)]
        if len(missing) * 2 > len(ids):
            raise SourceUnavailable("FRED returned %d of %d series" % (len(ids) - len(missing), len(ids)))
        rows = {}
        for key, label, group, sid, unit, cadence, macro in spec["series"]:
            note = "Not seasonally adjusted: compare with a year ago." if sid.startswith(("MRTSSM", "CUUR")) else None
            rows[key] = dict(series_row(key, label, group, unit, cadence, got.get(sid) or [], source_id, note),
                             series=sid, macro=macro)
        periods = [r["period"] for r in rows.values() if r["period"]]
        return {"as_of": max(periods) if periods else None, "count": sum(len(got.get(i) or []) for i in ids),
                "data": rows, "note": ("missing series: " + ", ".join(missing)) if missing else None}
    return load


# ---------------------------------------------------------------- Drewry World Container Index
_MOVE = r"(decreased|increased|fell|rose|dropped|declined|climbed|jumped|remained stable|was stable|held steady)"


def _signed(verb, pct):
    if verb in ("remained stable", "was stable", "held steady"):
        return 0.0
    if pct is None:
        return None
    return -float(pct) if verb in ("decreased", "fell", "dropped", "declined") else float(pct)


def parse_drewry(page):
    """-> {"as_of": "2026-11-12", "wci": {value, change_pct}, "sha_la": {...}, "sha_ny": {...}}."""
    text = html_text(page)
    m = re.search(r"assessment for \w+,?\s+(\d{1,2} \w+ \d{4})", text)
    as_of = parse_day(m.group(1)) if m else None
    out = {"as_of": as_of}
    pats = {"wci": r"World Container Index \(WCI\)[^$]{0,160}?\b" + _MOVE,
            "sha_la": r"Shanghai to Los Angeles\b[^$]{0,40}?\b" + _MOVE,
            "sha_ny": r"Shanghai to New York\b[^$]{0,40}?\b" + _MOVE}
    for key, pat in pats.items():
        mm = re.search(pat + r"(?:\s+(?:by\s+)?(\d+(?:\.\d+)?)%)?\s+(?:to|at)\s+\$([\d,]+)\s+per 40ft", text)
        if mm:
            out[key] = {"value": num(mm.group(3)), "change_pct": _signed(mm.group(1), mm.group(2))}
    if "wci" not in out or not as_of:
        raise SourceUnavailable("Drewry page layout changed: no index value found")
    return out


def load_drewry(ctx, now):
    from .registry import LIVE_SOURCES
    page, _ = ctx.get_text(LIVE_SOURCES["drewry_wci"][4], "wci.html", min_age=12 * 3600)
    data = parse_drewry(page)
    return {"as_of": data["as_of"], "count": len([k for k in data if k != "as_of"]), "data": data}


# ---------------------------------------------------------------- FedEx fuel surcharge
def parse_fedex(page):
    """-> [{"week": "2026-11-16", "ground": 30.0, "express": 32.0}, ...] newest first, from the package table."""
    weeks = []
    for cells in table_rows(page):
        if len(cells) >= 4 and re.search(r"\d{4}\s*[–-]", cells[0]) and cells[1].endswith("%"):
            weeks.append({"week": parse_day(cells[0]), "ground": num(cells[1]),
                          "express": num(cells[3]) if cells[3].endswith("%") else None})
    weeks = [w for w in weeks if w["week"] and w["ground"] is not None]
    if not weeks:
        raise SourceUnavailable("FedEx page layout changed: no surcharge table found")
    return sorted(weeks, key=lambda w: w["week"], reverse=True)


def load_fedex(ctx, now):
    from .registry import LIVE_SOURCES
    page, _ = ctx.get_text(LIVE_SOURCES["fedex_fuel"][4], "fuel.html", min_age=12 * 3600)
    weeks = parse_fedex(page)
    return {"as_of": weeks[0]["week"], "count": len(weeks), "data": weeks}


# ---------------------------------------------------------------- USPS Notice 123
USPS_ITEMS = (("usps_priority_env", "Priority Mail flat rate envelope", "Flat Rate Envelope"),
              ("usps_small_box", "Priority Mail small flat rate box", "Small Flat Rate Box"),
              ("usps_medium_box", "Priority Mail medium flat rate box", "Medium Flat Rate Box"),
              ("usps_large_box", "Priority Mail large flat rate box", "Large Flat Rate Box"))


def parse_usps(page):
    """-> {"as_of": "2026-10-04", "prices": {key: dollars}} from the retail Priority Mail flat rate table."""
    text = html_text(page)
    m = re.search(r"Notice 123\s*•?\s*Effective\s+([A-Za-z]+ \d{1,2}, \d{4})", text)
    as_of = parse_day(m.group(1)) if m else None
    start = text.find("Priority Mail Size Price")
    if start < 0 or not as_of:
        raise SourceUnavailable("USPS price list layout changed")
    seg = text[start:start + 1500]
    prices = {}
    for key, _, label in USPS_ITEMS:
        i = seg.find(label)
        if i < 0:
            continue
        mm = re.search(r"(?<![\d/.-])\$?(\d{1,3}\.\d{2})(?![\d\"”])", seg[i + len(label):])
        if mm:
            prices[key] = float(mm.group(1))
    if len(prices) < 3:
        raise SourceUnavailable("USPS price list layout changed: %d of 4 prices found" % len(prices))
    return {"as_of": as_of, "prices": prices}


def load_usps(ctx, now):
    from .registry import LIVE_SOURCES
    page, _ = ctx.get_text(LIVE_SOURCES["usps_prices"][4], "notice123.html", min_age=3 * 86400, timeout=90)
    data = parse_usps(page)
    return {"as_of": data["as_of"], "count": len(data["prices"]), "data": data}


# ---------------------------------------------------------------- Port of Los Angeles
def parse_port_la(page):
    """-> {"as_of": "2026-10", "total": {value, year_ago, change_pct}, "imports": {...}}."""
    text = html_text(page)
    i = text.find("Latest Monthly Container Counts")
    if i < 0:
        raise SourceUnavailable("Port of LA page layout changed")
    seg = text[i:i + 1500]
    as_of = month_period(re.sub(r"^.*?released on or around[^.]*\.", "", seg))
    nums = r"([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+\(?[\d,]+\.\d+\)?\s+(-?[\d.]+)%"
    out = {"as_of": as_of}
    for key, pat in (("imports", r"Loaded Imports\s+"), ("total", r"\bTotal\s+(?=\d)")):
        m = re.search(pat + nums, seg)
        if m:
            out[key] = {"value": num(m.group(1)), "year_ago": num(m.group(2)), "change_pct": num(m.group(3))}
    if "total" not in out or not as_of:
        raise SourceUnavailable("Port of LA page layout changed: no monthly total found")
    return out


def load_port_la(ctx, now):
    from .registry import LIVE_SOURCES
    page, _ = ctx.get_text(LIVE_SOURCES["port_la"][4], "container-statistics.html", min_age=12 * 3600)
    data = parse_port_la(page)
    return {"as_of": data["as_of"], "count": len(data) - 1, "data": data}


# ---------------------------------------------------------------- Federal Register
FR_AGENCIES = ("trade-representative-office-of-united-states", "u-s-customs-and-border-protection")


def parse_fedreg(body):
    """-> {"count": n, "latest": {title, date, type} or None}."""
    if not isinstance(body, dict) or "count" not in body:
        raise SourceUnavailable("Federal Register answered no count")
    res = body.get("results") or []
    latest = res[0] if res else None
    return {"count": int(body["count"]),
            "latest": {"title": (latest.get("title") or "")[:200], "date": latest.get("publication_date"),
                       "type": latest.get("type")} if latest else None}


def load_fedreg(ctx, now):
    since = (owner_date(now) - dt.timedelta(days=30)).isoformat()
    q = [("per_page", "5"), ("order", "newest"), ("conditions[publication_date][gte]", since)]
    q += [("conditions[agencies][]", a) for a in FR_AGENCIES]
    q += [("fields[]", f) for f in ("title", "publication_date", "type")]
    url = "https://www.federalregister.gov/api/v1/documents.json?" + urllib.parse.urlencode(q)
    data = parse_fedreg(ctx.get_json(url, "trade-notices.json", min_age=6 * 3600))
    data["since"] = since
    data["until"] = owner_date(now).isoformat()
    return {"as_of": data["until"], "count": data["count"], "data": data}
