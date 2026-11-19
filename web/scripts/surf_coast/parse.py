"""Parsers for the raw public sources. Each takes the response body and returns plain dicts.

Missing values (NDBC `MM`, ERDDAP `NaN`, JSON null) become None, never 0.
"""
import datetime as dt
import json
import math
import re

from .geo import MS_TO_KT, compass_to_deg, tz

UTC = dt.timezone.utc


class ParseError(ValueError):
    """A body did not have the expected shape. The message is safe to publish."""


def _num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return None if (isinstance(v, float) and math.isnan(v)) else float(v)
    s = str(v).strip()
    if s in ("", "MM", "NaN", "nan", "N/A", "99.0", "999", "999.0", "9999.0"):
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return None if math.isnan(f) else f


def iso_epoch(s):
    """ISO 8601 text (with Z, an offset, or naive UTC) to epoch seconds. None when absent."""
    if not s:
        return None
    try:
        d = dt.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=UTC)
    return int(d.timestamp())


def ndbc_latest(text):
    """NDBC `latest_obs.txt`: one row per station, newest observation. Keys are upper-case station ids."""
    lines = text.splitlines()
    header = next((ln for ln in lines if ln.startswith("#STN")), None)
    if header is None:
        raise ParseError("latest_obs has no #STN header")
    cols = header.lstrip("#").split()
    out = {}
    for ln in lines:
        if not ln.strip() or ln.startswith("#"):
            continue
        parts = ln.split()
        if len(parts) != len(cols):
            continue
        rec = dict(zip(cols, parts))
        try:
            at = int(dt.datetime(int(rec["YYYY"]), int(rec["MM"]), int(rec["DD"]), int(rec["hh"]), int(rec["mm"]),
                                 tzinfo=UTC).timestamp())
            lat, lon = float(rec["LAT"]), float(rec["LON"])
        except (KeyError, ValueError):
            continue
        wspd, gst = _num(rec.get("WSPD")), _num(rec.get("GST"))
        out[rec["STN"].upper()] = {
            "id": rec["STN"].upper(), "lat": lat, "lon": lon, "at": at,
            "wdir": _num(rec.get("WDIR")),
            "wspd_kt": None if wspd is None else wspd * MS_TO_KT,
            "gst_kt": None if gst is None else gst * MS_TO_KT,
            "wvht_m": _num(rec.get("WVHT")),
            "dpd_s": _num(rec.get("DPD")),
            "apd_s": _num(rec.get("APD")),
            "mwd": _num(rec.get("MWD")),
            "wtmp_c": _num(rec.get("WTMP")),
            "atmp_c": _num(rec.get("ATMP")),
        }
    if not out:
        raise ParseError("latest_obs has no station rows")
    return out


def ndbc_spec(text):
    """NDBC realtime2 `<id>.spec`: the newest row with swell and wind-wave parts."""
    lines = [ln for ln in text.splitlines() if ln.strip()]
    header = next((ln for ln in lines if ln.startswith("#YY")), None)
    if header is None:
        raise ParseError("spec has no #YY header")
    cols = header.lstrip("#").split()
    for ln in lines:
        if ln.startswith("#"):
            continue
        parts = ln.split()
        if len(parts) != len(cols):
            continue
        rec = dict(zip(cols, parts))
        try:
            at = int(dt.datetime(int(rec["YY"]), int(rec["MM"]), int(rec["DD"]), int(rec["hh"]), int(rec["mm"]),
                                 tzinfo=UTC).timestamp())
        except (KeyError, ValueError):
            continue
        return {
            "at": at,
            "wvht_m": _num(rec.get("WVHT")),
            "swh_m": _num(rec.get("SwH")), "swp_s": _num(rec.get("SwP")), "swd": compass_to_deg(rec.get("SwD")),
            "wwh_m": _num(rec.get("WWH")), "wwp_s": _num(rec.get("WWP")), "wwd": compass_to_deg(rec.get("WWD")),
            "steepness": (rec.get("STEEPNESS") or "").lower() or None,
            "apd_s": _num(rec.get("APD")), "mwd": _num(rec.get("MWD")),
        }
    raise ParseError("spec has no data rows")


def coops_hilo(doc):
    """CO-OPS predictions with interval=hilo, time_zone=gmt: [{type: H|L, at, ft}] sorted by time."""
    if isinstance(doc, (str, bytes)):
        doc = json.loads(doc)
    if "error" in doc:
        raise ParseError("CO-OPS: %s" % str(doc["error"].get("message", "error"))[:120])
    out = []
    for p in doc.get("predictions") or []:
        try:
            at = int(dt.datetime.strptime(p["t"], "%Y-%m-%d %H:%M").replace(tzinfo=UTC).timestamp())
            out.append({"type": "H" if p["type"].upper().startswith("H") else "L", "at": at, "ft": round(float(p["v"]), 2)})
        except (KeyError, ValueError, TypeError):
            continue
    if not out:
        raise ParseError("CO-OPS returned no predictions")
    out.sort(key=lambda x: x["at"])
    return out


def open_meteo(doc):
    """Open-Meteo marine or forecast body (one location or a list): [{lat, lon, times, hourly{var: [..]}}].

    Times are epoch seconds: the request uses timezone=GMT and `utc_offset_seconds` is applied anyway.
    """
    if isinstance(doc, (str, bytes)):
        doc = json.loads(doc)
    if isinstance(doc, dict) and doc.get("error"):
        raise ParseError("Open-Meteo: %s" % str(doc.get("reason", "error"))[:120])
    docs = doc if isinstance(doc, list) else [doc]
    out = []
    for d in docs:
        h = d.get("hourly") or {}
        off = int(d.get("utc_offset_seconds") or 0)
        times = []
        for ts in h.get("time") or []:
            e = iso_epoch(ts)
            times.append(None if e is None else e - off)
        hourly = {k: [_num(x) for x in v] for k, v in h.items() if k != "time" and isinstance(v, list)}
        out.append({"lat": d.get("latitude"), "lon": d.get("longitude"), "times": times, "hourly": hourly})
    return out


_SECTION = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]\s*$")


def mop_ascii(text):
    """CDIP THREDDS OPeNDAP `.ascii` for a MOP point: {times, hs_m, tp_s, dp}."""
    if "---" not in text:
        raise ParseError("MOP body has no data section")
    data = text.split("---", 1)[1]
    blocks, name, buf = {}, None, []
    for ln in data.splitlines() + [""]:
        m = _SECTION.match(ln.strip())
        if m:
            if name:
                blocks[name] = buf
            name, buf = m.group(1), []
            continue
        if name and ln.strip():
            buf.extend(x.strip() for x in ln.split(",") if x.strip())
    if name:
        blocks[name] = buf
    times = [int(float(x)) for x in blocks.get("waveTime", [])]
    if not times:
        raise ParseError("MOP body has no waveTime")

    def col(key, top):
        vals = [_num(x) for x in blocks.get(key, [])]
        vals = [None if (v is not None and (v < 0 or v > top)) else v for v in vals]
        return vals if len(vals) == len(times) else [None] * len(times)

    # fill values (-999.99) and nonsense are None; a direction runs to 360, not to the 99 cap of heights and periods
    return {"times": times, "hs_m": col("waveHs", 99), "tp_s": col("waveTp", 99), "dp": col("waveDp", 360)}


def nws_alerts(doc):
    """api.weather.gov `/alerts/active`: [{id, event, severity, headline, what, ugc[], start, end}]."""
    if isinstance(doc, (str, bytes)):
        doc = json.loads(doc)
    feats = doc.get("features")
    if feats is None:
        raise ParseError("NWS alerts body has no features")
    out = []
    for f in feats:
        p = f.get("properties") or {}
        desc = p.get("description") or ""
        what = None
        m = re.search(r"\*\s*WHAT\.\.\.(.+?)(?:\n\s*\n|\n\*|$)", desc, re.S)
        if m:
            what = re.sub(r"\s+", " ", m.group(1)).strip()
        elif desc:
            what = re.sub(r"\s+", " ", desc).strip()
        out.append({
            "id": p.get("id") or f.get("id"),
            "event": p.get("event") or "",
            "severity": p.get("severity"),
            "status": p.get("status"),
            "headline": p.get("headline"),
            "what": what,
            "ugc": list((p.get("geocode") or {}).get("UGC") or []),
            "start": iso_epoch(p.get("onset") or p.get("effective")),
            "end": iso_epoch(p.get("ends") or p.get("expires")),
        })
    return out


def erddap_csv(text):
    """ERDDAP `.csv` (header row, units row, data rows) -> list of dicts. NaN -> None; time stays text."""
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if len(lines) < 2:
        raise ParseError("ERDDAP body has no header")
    cols = [c.strip() for c in lines[0].split(",")]
    rows = []
    for ln in lines[2:]:
        parts = [x.strip() for x in ln.split(",")]
        if len(parts) != len(cols):
            continue
        rec = {}
        for c, v in zip(cols, parts):
            rec[c] = v if c == "time" else _num(v)
        rows.append(rec)
    return rows


_UGC = re.compile(r"^([A-Z]{2}Z\d{3}(?:[->]\d{3})*)-(\d{6})-\s*$")
_PERIOD = re.compile(r"^\.([A-Z][A-Z0-9 ]+?)\.\.\.\s*$")
_FIELD = re.compile(r"^([A-Za-z][A-Za-z /]*?)\*?\.{3,}(.*)$")
_FACING = re.compile(r"^(.*?)\s+facing beaches\s*-\s*(.*)$", re.I)
_FACING_DEG = {"north": 0, "northeast": 45, "east": 90, "southeast": 135, "south": 180, "southwest": 225,
               "west": 270, "northwest": 315}
# Forecast period words. NWS day periods run 6 am to 6 pm local, night periods 6 pm to 6 am.
_DAYWORD = re.compile(r"(rest of today|rest of tonight|this morning|this afternoon|this evening|late tonight|overnight|"
                      r"today|tonight|(?:sun|mon|tues|wednes|thurs|fri|satur)day(?:\s+night)?)", re.I)
_WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
_NIGHT = ("rest of tonight", "this evening", "late tonight", "overnight", "tonight")
_DAYTAIL = re.compile(r"\b(" + _DAYWORD.pattern + r")$", re.I)


def period_end(words, issued, tzname="America/Los_Angeles", which="last"):
    """Epoch end of an NWS forecast period named by `words` ('Today', 'Monday night', 'This afternoon through Sunday'),
    counted from the issue time in the office's own zone. `which` picks the first or last day word of a span.
    None when the words name no period or the issue time is unknown: an unknown end is never guessed."""
    found = _DAYWORD.findall(words or "")
    if not found or not issued:
        return None
    w = re.sub(r"\s+", " ", (found[0] if which == "first" else found[-1]).lower())
    zone = tz(tzname)
    loc = dt.datetime.fromtimestamp(issued, zone)
    day = loc.date()

    def at(d, hour):
        return int(dt.datetime.combine(d, dt.time(hour), zone).timestamp())

    if w == "this morning":
        return at(day, 12)
    if w in ("today", "rest of today", "this afternoon"):
        return at(day, 18)
    if w in _NIGHT:
        return at(day if loc.hour < 6 else day + dt.timedelta(days=1), 6)
    name, night = w.split(" ")[0], w.endswith("night")
    ahead = (_WEEKDAYS.index(name) - day.weekday()) % 7 or 7  # a weekday name is never the issue day itself
    d = day + dt.timedelta(days=ahead)
    return at(d + dt.timedelta(days=1), 6) if night else at(d, 18)


def _ugc_list(spec):
    """'CAZ362-364' -> ['CAZ362', 'CAZ364']; 'ORZ001>003' -> ['ORZ001', 'ORZ002', 'ORZ003']."""
    out, prefix = [], spec[:3]
    for tok in re.split(r"(?=[->])", spec):
        sep, num = (tok[0], tok[1:]) if tok[0] in "->" else ("", tok[3:])
        n = int(num)
        if sep == ">" and out:
            last = int(out[-1][3:])
            out.extend("%s%03d" % (prefix, k) for k in range(last + 1, n + 1))
        else:
            out.append("%s%03d" % (prefix, n))
    return out


def surf_ft(text):
    """(lo, hi, sets) feet from forecaster words: '4 to 7 feet with sets to 8 feet', '24 FT', 'around 3 feet'."""
    t = text.lower()
    m = re.search(r"(\d+)\s*(?:to|-)\s*(\d+)\s*(?:feet|foot|ft)\b", t)
    if m:
        lo, hi = int(m.group(1)), int(m.group(2))
    elif re.search(r"(?:less than 1 foot|1 foot or less|flat)", t):
        lo, hi = 0, 1
    else:
        m = re.search(r"(\d+)\s*(?:feet|foot|ft)\b", t)
        if not m:
            return None
        lo = hi = int(m.group(1))
    s = re.search(r"sets\s+(?:up\s+)?to\s+(\d+)", t)
    return lo, hi, (int(s.group(1)) if s else None)


def _surf_statements(lines):
    """Surf Height lines -> [(facing or None, text)]. A statement starts on the first line, on a facing line or on a
    line that opens with a number ('3 to 6 feet Sunday.'); other lines continue the statement before them."""
    out = []
    for idx, ln in enumerate(lines):
        fm = _FACING.match(ln)
        if idx == 0 or fm or re.match(r"\d", ln):
            out.append((fm.group(1).strip(), fm.group(2)) if fm else (None, ln))
        else:
            facing, text = out[-1]
            out[-1] = (facing, text.rstrip() + " " + ln)
    return out


def _surf_parts(lines):
    """[(day word or None, [part])]: the parts of one forecast period. A statement that ends with a day word
    ('3 to 6 feet Sunday.') is its own sub-period; a later statement with neither a facing nor a day word is left out."""
    subs = []
    for idx, (facing, text) in enumerate(_surf_statements(lines)):
        ft = surf_ft(text)
        if not ft:
            continue
        part = {"ft": [ft[0], ft[1]]}
        if ft[2]:
            part["sets_ft"] = ft[2]
        if facing:
            part["facing"] = facing.capitalize()
            part["facing_deg"] = _FACING_DEG.get(facing.lower().replace(" ", "").replace("-", ""))
        tail = _DAYTAIL.search(text.rstrip(" .,"))
        day = tail.group(1) if tail else None
        if day:
            subs.append([day, [part]])
        elif facing or idx == 0:
            if not subs:
                subs.append([None, []])
            subs[-1][1].append(part)
    return subs


def nws_srf(text, issued=None, tzname="America/Los_Angeles"):
    """NWS Surf Zone Forecast text -> {zone: {zone, name, until, periods[]}}.

    `until` is the product's own expiry (UGC line). `periods` run in order, each {period, end, surf[], rip}: `end` is
    when that period is over (None when the words name no known period); `surf` holds one part per beach facing
    ({facing, facing_deg, ft:[lo,hi], sets_ft}); a single part has no facing. A period whose surf line splits by day
    ('4 to 7 feet today. 3 to 6 feet Sunday.') becomes one period per day. Missing pieces are left out, never guessed.
    """
    out = {}
    for block in text.split("$$"):
        lines = block.splitlines()
        i = next((k for k, ln in enumerate(lines) if _UGC.match(ln.strip())), None)
        if i is None:
            continue
        m = _UGC.match(lines[i].strip())
        zones = _ugc_list(m.group(1))
        until = None
        if issued:
            ref = dt.datetime.fromtimestamp(issued, UTC)
            day, hh, mm = int(m.group(2)[:2]), int(m.group(2)[2:4]), int(m.group(2)[4:])
            year, month = ref.year, ref.month
            if day < ref.day:
                year, month = (year + 1, 1) if month == 12 else (year, month + 1)
            try:
                until = int(dt.datetime(year, month, day, hh, mm, tzinfo=UTC).timestamp())
            except ValueError:
                until = None
        names, j = [], i + 1
        while j < len(lines) and lines[j].strip().endswith("-"):
            names.append(lines[j].strip().rstrip("-").strip())
            j += 1
        heads = [x for x in range(j, len(lines)) if _PERIOD.match(lines[x].strip())]
        periods = []
        for k in heads:
            label = _PERIOD.match(lines[k].strip()).group(1).strip().capitalize()
            fields, cur = {}, None
            for ln in lines[k + 1:]:
                s = ln.strip()
                if _PERIOD.match(s) or s == "&&":
                    break
                fm = _FIELD.match(s)
                if fm and not ln.startswith(" "):
                    cur = fm.group(1).strip()
                    fields[cur] = [fm.group(2).strip()]
                elif cur and s and ln.startswith(" "):
                    fields[cur].append(s)
                elif not s:
                    cur = None
            rip = None
            rv = " ".join(fields.get("Rip Current Risk") or []).lower()
            for word in ("high", "moderate", "low"):
                if rv.startswith(word):
                    rip = word
                    break
            subs = _surf_parts(fields.get("Surf Height") or [])
            if not subs:
                periods.append({"period": label, "end": period_end(label, issued, tzname), "surf": [], "rip": rip})
            elif len(subs) == 1 and subs[0][0] is None:
                periods.append({"period": label, "end": period_end(label, issued, tzname), "surf": subs[0][1], "rip": rip})
            else:
                for word, parts in subs:
                    if word is None:  # the undated lead of a split period runs to the end of its first day
                        lead = _DAYWORD.findall(label)
                        end = period_end(label, issued, tzname, which="first")
                        name = re.sub(r"\s+", " ", lead[0]).capitalize() if lead else label
                    else:
                        end, name = period_end(word, issued, tzname), re.sub(r"\s+", " ", word).capitalize()
                    periods.append({"period": name, "end": end, "surf": parts, "rip": rip})
        if not periods:
            continue
        for n, z in enumerate(zones):
            name = names[n] if len(names) == len(zones) else (names[0] if names else z)
            out[z] = {"zone": z, "name": name, "until": until, "periods": periods}
    return out
