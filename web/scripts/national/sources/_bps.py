"""Shared reader for the Census Building Permits Survey CBSA and state text files (helper, not a source).

Both families list, per geography, permitted buildings, units and value (in thousands of dollars) for 1-unit, 2-unit,
3-4 unit and 5+ unit structures, as estimates with imputation followed by reported-only columns. The files come in three
kinds: current month (c), year to date with late reports and corrections (y) and calendar-year annual (a).

`run()` walks back from the current month to the newest published month, sums the 12 monthly files ending there and the 12
before them (for the change), and keeps up to 72 monthly points of 5+ unit permits. If a monthly file in the window is
missing it falls back to year-to-date arithmetic: this year's YTD file plus last year's annual file minus last year's YTD
file for the same month.
"""
import time

from ctx import SourceUnavailable, num

STATE_BASE = "https://www2.census.gov/econ/bps/State/"
CBSA_BASE = "https://www2.census.gov/econ/bps/CBSA%20(beginning%20Jan%202024)/"
METRO_BASE = "https://www2.census.gov/econ/bps/Metro%20(ending%202023)/"  # metro-only files up to December 2023
FIRST_CBSA_YEAR = 2024

WINDOW = 12
HIST_MONTHS = 72
LATEST_TRIES = 5  # the newest month usually lands 4 to 7 weeks after it ends

STATE_USPS = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
    "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
    "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
    "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
    "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
    "56": "WY",
}

KEYS = ("u1", "u24", "u5", "b5", "v5")


def parse(path, kind):
    """One BPS file -> ({geo: {u1, u24, u5, b5, v5}}, 'YYYY-MM').

    kind "cbsa": geo is the 5-digit CBSA code, metropolitan areas only (header code 2 or 4; 5 is micropolitan).
    kind "state": geo is the USPS code of a state or DC (national, region and division rows are skipped).
    v5 is dollars (the files state thousands). u24 is 2-unit plus 3-4 unit structures."""
    out, label = {}, None
    with open(path, encoding="latin-1") as fh:
        for line in fh:
            parts = line.rstrip("\r\n").split(",")
            date = parts[0].strip()
            if len(parts) < 29 or len(date) != 6 or not date.isdigit():
                continue
            if kind == "cbsa":
                geo = parts[2].strip()
                if len(geo) != 5 or not geo.isdigit() or parts[3].strip() == "5":
                    continue
            else:
                geo = STATE_USPS.get(parts[1].strip())
                if geo is None:
                    continue
            # 24 numeric columns end every row (buildings, units, value for 4 size classes, then the reported-only copy);
            # counting from the right keeps a name that contains a comma from shifting the columns
            nums = [num(p) for p in parts[-24:-12]]
            if any(v is None for v in nums):
                continue
            (_, u1, _, _, u2, _, _, u34, _, b5, u5, v5) = nums
            label = label or "%s-%s" % (date[:4], date[4:])
            out[geo] = {"u1": int(u1), "u24": int(u2 + u34), "u5": int(u5), "b5": int(b5), "v5": int(round(v5 * 1000))}
    if not out:
        raise SourceUnavailable("Building permits file had no %s rows" % ("metro" if kind == "cbsa" else "state"))
    return out, label


def months_back(year, month, n):
    total = year * 12 + month - 1 - n
    return total // 12, total % 12 + 1


def url_for(kind, flavor, year, month=None):
    """(url, cache name) of a monthly (c), year-to-date (y) or annual (a) file; None when the publisher has no such file."""
    yy = year % 100
    if flavor == "a":
        if kind == "state":
            name = "st%04da.txt" % year
            return STATE_BASE + name, name
        if year < FIRST_CBSA_YEAR:
            return None
        name = "cbsa%04da.txt" % year
        return CBSA_BASE + name, name
    if kind == "state":
        name = "st%02d%02d%s.txt" % (yy, month, flavor)
        return STATE_BASE + name, name
    if year >= FIRST_CBSA_YEAR:
        name = "cbsa%02d%02d%s.txt" % (yy, month, flavor)
        return CBSA_BASE + name, name
    name = "ma%02d%02d%s.txt" % (yy, month, flavor)
    return METRO_BASE + name, name


class Files:
    """Fetch and parse files through ctx once each; a failure is remembered so a walk back never asks twice."""

    def __init__(self, ctx, kind):
        self.ctx, self.kind, self.cache, self.rows = ctx, kind, {}, 0

    def get(self, flavor, year, month=None):
        key = (flavor, year, month)
        if key in self.cache:
            if isinstance(self.cache[key], SourceUnavailable):
                raise self.cache[key]
            return self.cache[key]
        try:
            where = url_for(self.kind, flavor, year, month)
            if where is None:
                raise SourceUnavailable("no %s file for %d" % (flavor, year))
            path, meta = self.ctx.fetch(where[0], where[1], timeout=60, min_bytes=1000)
            data, label = parse(path, self.kind)
            expect = "%04d-%02d" % (year, month) if month else "%04d-99" % year
            if label != expect:
                raise SourceUnavailable("Building permits file %s is dated %s" % (where[1], label))
            if meta.get("status") == "fetched":
                time.sleep(0.3)  # at most about 3 requests a second to www2.census.gov
        except SourceUnavailable as exc:
            self.cache[key] = exc
            raise
        self.rows += len(data)
        self.cache[key] = data
        return data


def sum_months(monthly):
    """Parsed months -> {geo: summed fields} for geographies present in every month."""
    geos = set(monthly[0])
    for part in monthly[1:]:
        geos &= set(part)
    return {g: {k: sum(part[g][k] for part in monthly) for k in KEYS} for g in geos}


def sum_ytd(current, annual, prior):
    """12 months ending at the YTD month: this year's YTD + last year's annual - last year's YTD of the same month."""
    out = {}
    for g in set(current) & set(annual) & set(prior):
        row = {k: current[g][k] + annual[g][k] - prior[g][k] for k in KEYS}
        if min(row.values()) >= 0:  # a negative would mean the annual file revised below its own YTD; leave the area out
            out[g] = row
    return out


def trailing(files, year, month):
    """12 months ending at (year, month) -> (data, via) with via "monthly" or "year-to-date"."""
    try:
        return sum_months([files.get("c", *months_back(year, month, k)) for k in range(WINDOW)]), "monthly"
    except SourceUnavailable:
        pass
    data = sum_ytd(files.get("y", year, month), files.get("a", year - 1), files.get("y", year - 1, month))
    if not data:
        raise SourceUnavailable("Building permits year-to-date arithmetic left no areas")
    return data, "year-to-date"


def latest_month(files, now):
    for back in range(LATEST_TRIES):
        year, month = months_back(now.tm_year, now.tm_mon, back)
        try:
            files.get("c", year, month)
        except SourceUnavailable:
            continue
        return year, month
    raise SourceUnavailable("no Building Permits file for the last %d months" % LATEST_TRIES)


def yoy(now_units, before_units):
    if before_units in (None, 0):
        return None
    return round((now_units / before_units - 1) * 100, 1)


def run(ctx, kind, prefix, min_geos, what, note_extra=""):
    """Build the load() result for one family. prefix is "bpm_" or "bpst_"."""
    files = Files(ctx, kind)
    year, month = latest_month(files, time.gmtime())
    current, via = trailing(files, year, month)
    if len(current) < min_geos:
        raise SourceUnavailable("Building permits parsed to %d %s present in every month (expected at least %d)"
                                % (len(current), what, min_geos))
    try:
        prior, prior_via = trailing(files, *months_back(year, month, WINDOW))
    except SourceUnavailable:
        prior, prior_via = {}, None
    newest = files.get("c", year, month)
    data = {}
    for geo, c in current.items():
        units = c["u1"] + c["u24"] + c["u5"]
        before = prior.get(geo)
        data[geo] = {
            prefix + "units_12m": units, prefix + "units_1_12m": c["u1"], prefix + "units_2_4_12m": c["u24"],
            prefix + "units_5plus_12m": c["u5"], prefix + "units_5plus_yoy": yoy(c["u5"], before["u5"]) if before else None,
            prefix + "buildings_5plus_12m": c["b5"], prefix + "value_5plus_12m": c["v5"],
            prefix + "units_5plus_month": newest[geo]["u5"] if geo in newest else None,
        }
    # up to 72 monthly points of 5+ unit units, oldest first; a month the publisher or the area lacks is skipped, never zero
    hist, field = {geo: [] for geo in data}, prefix + "units_5plus_month"
    for back in range(HIST_MONTHS - 1, -1, -1):
        y, m = months_back(year, month, back)
        try:
            part = files.get("c", y, m)
        except SourceUnavailable as exc:
            ctx.log("skipped %04d-%02d: %s" % (y, m, exc))
            continue
        for geo, points in hist.items():
            if geo in part:
                points.append(["%04d-%02d" % (y, m), part[geo]["u5"]])
    hist = {geo: {field: points} for geo, points in hist.items() if points}
    ys, ms = months_back(year, month, WINDOW - 1)
    if via == "year-to-date":
        note = ("The monthly files were not all available, so the 12 months are this year's year-to-date file plus last "
                "year's annual file minus last year's year-to-date file (revised estimates with imputation for permit "
                "offices that did not report).")
    else:
        note = ("Sum of the Census monthly files, which are first estimates with imputation for permit offices that did "
                "not report; they can differ by a few percent from the revised year-to-date and annual files.")
    if prior_via is None:
        note += " The change vs the prior 12 months is blank because the earlier files were not available."
    note += note_extra
    return {"as_of": "%04d-%02d to %04d-%02d" % (ys, ms, year, month), "rows": files.rows, "data": data, "hist": hist, "note": note}
