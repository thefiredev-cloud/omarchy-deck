"""Shared reader for the Zillow Research wide monthly files at metro and state level (a helper, not a source: the runner
skips files that start with _). Used by zillow_metro_market (level cbsa) and zillow_state_market (level state).

Every file is one row per region and one column per month, newest last. `parse_series` reads one file; `parse_forecast`
reads the ZHVF growth file; `collect` runs a whole table of series through `ctx.fetch` and merges them by geography.
"""
import csv
import re

from ctx import SourceUnavailable, num

BASE = "https://files.zillowstatic.com/research/public_csvs/"
HIST_MONTHS = 72
MIN_REGIONS = 250  # the thinnest metro file (new-owner affordability) carries about 390 metros
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def month_no(label):
    """'2026-10-31' -> a whole month count, so a year back is exactly 12 less."""
    return int(label[:4]) * 12 + int(label[5:7])


def cast(raw, kind):
    """Zillow cell -> published unit. d whole dollars, i count, p fraction shown as 0 to 100, f one-decimal index."""
    val = num(raw)
    if val is None:
        return None
    if kind == "p":
        return round(val * 100, 2)
    if kind == "f":
        return round(val, 1)
    return int(round(val))


def _head(reader, what):
    try:
        head = next(reader)
    except StopIteration:
        raise SourceUnavailable("Zillow %s file is empty" % what)
    if "RegionName" not in head or "RegionType" not in head:
        raise SourceUnavailable("Zillow %s header changed: RegionName or RegionType missing" % what)
    return head


def parse_series(path, region_type, kind, want_yoy=False, hist_months=0, min_regions=MIN_REGIONS, what="series"):
    """One wide file -> ({(RegionName, StateName): {"v": value, "yoy": percent or None, "hist": [[YYYY-MM, v], ...]}},
    rows read, newest YYYY-MM). Only rows of `region_type` ('msa' or 'state') count; the national row is skipped. The value
    is the newest month column; the year-over-year change is computed from the column twelve months earlier, same file."""
    out, rows = {}, 0
    with open(path, newline="", encoding="utf8") as fh:
        reader = csv.reader(fh)
        head = _head(reader, what)
        i_name, i_type = head.index("RegionName"), head.index("RegionType")
        i_state = head.index("StateName") if "StateName" in head else None
        dates = [(i, h) for i, h in enumerate(head) if DATE.match(h)]
        if len(dates) < 14:
            raise SourceUnavailable("Zillow %s file has %d month columns (expected 14 or more)" % (what, len(dates)))
        last_i, last = dates[-1]
        by_month = {month_no(h): i for i, h in dates}
        back_i = by_month.get(month_no(last) - 12)
        window = dates[-hist_months:] if hist_months else []
        for row in reader:
            if len(row) <= last_i:
                continue
            rows += 1
            if row[i_type].lower() != region_type:
                continue
            raw = num(row[last_i])
            val = cast(row[last_i], kind)
            if val is None:
                continue
            yoy = None
            if want_yoy and back_i is not None:
                old = num(row[back_i])
                if old is not None and old > 0:
                    yoy = round((raw / old - 1) * 100, 2)
            pts = []
            for i, label in window:
                v = cast(row[i], kind)
                if v is not None:
                    pts.append([label[:7], v])
            out[(row[i_name].strip(), (row[i_state].strip() if i_state is not None else ""))] = {
                "v": val, "yoy": yoy, "hist": pts if len(pts) >= 2 else []}
    if len(out) < min_regions:
        raise SourceUnavailable("Zillow %s parsed to %d regions with a value in %s" % (what, len(out), last[:7]))
    return out, rows, last[:7]


def _months(a, b):
    return month_no(b) - month_no(a)


def parse_forecast(path, region_type, horizon=12, min_regions=MIN_REGIONS, what="forecast"):
    """ZHVF growth file -> ({(RegionName, StateName): percent change at `horizon` months}, rows read, base YYYY-MM).
    The horizon column is found by its distance from BaseDate; a file without it is refused (Zillow has moved horizons)."""
    out, rows, pending, base = {}, 0, [], ""
    with open(path, newline="", encoding="utf8") as fh:
        reader = csv.reader(fh)
        head = _head(reader, what)
        if "BaseDate" not in head:
            raise SourceUnavailable("Zillow %s header changed: BaseDate missing" % what)
        i_name, i_type, i_base = head.index("RegionName"), head.index("RegionType"), head.index("BaseDate")
        i_state = head.index("StateName") if "StateName" in head else None
        cols = [(i, h) for i, h in enumerate(head) if DATE.match(h)]
        for row in reader:
            if len(row) < len(head):
                continue
            rows += 1
            if row[i_type].lower() != region_type or not DATE.match(row[i_base]):
                continue
            pending.append(row)
            base = max(base, row[i_base])
    if not base:
        raise SourceUnavailable("Zillow %s file has no BaseDate" % what)
    pick = [i for i, label in cols if _months(base, label) == horizon]
    if len(pick) != 1:
        raise SourceUnavailable("Zillow %s has no %d-month column after %s" % (what, horizon, base[:7]))
    for row in pending:
        if row[i_base] != base:
            continue  # a stale base month would mislabel the horizon
        val = num(row[pick[0]])
        if val is not None:
            out[(row[i_name].strip(), row[i_state].strip() if i_state is not None else "")] = round(val, 2)
    if len(out) < min_regions:
        raise SourceUnavailable("Zillow %s parsed to %d regions (expected about 900)" % (what, len(out)))
    return out, rows, base[:7]


def parse_one(path, region_type, s, resolve, min_regions=MIN_REGIONS):
    """One series file `s` (a dict, see collect) -> (data {geo: {field: v}}, hist {geo: {field: points}}, rows read,
    newest YYYY-MM, seen {(RegionName, StateName)} of every region read). resolve(RegionName, StateName) -> geography
    key or None; None drops the region (it is still in `seen`)."""
    if s.get("forecast"):
        values, rows, last = parse_forecast(path, region_type, min_regions=min_regions, what=s["key"])
        regions = {k: {"v": v, "yoy": None, "hist": []} for k, v in values.items()}
    else:
        regions, rows, last = parse_series(path, region_type, s["kind"], want_yoy=bool(s.get("yoy")),
                                           hist_months=HIST_MONTHS if s.get("hist") else 0,
                                           min_regions=min_regions, what=s["key"])
    data, hist = {}, {}
    for region, got in regions.items():
        geo = resolve(*region)
        if geo is None:
            continue
        data.setdefault(geo, {})[s["field"]] = got["v"]
        if s.get("yoy") and got["yoy"] is not None:
            data[geo][s["yoy"]] = got["yoy"]
        if s.get("hist") and got["hist"]:
            hist.setdefault(geo, {})[s["field"]] = got["hist"]
    return data, hist, rows, last, set(regions)


def collect(ctx, region_type, series, resolve, min_regions=MIN_REGIONS):
    """Fetch and merge a table of series.

    series: dicts with key, file (path under public_csvs), field, kind (d i p f), and optional yoy (field name), hist
    (True), forecast (True), required (True). Returns (data, hist, rows, newest {field: YYYY-MM}, missing [plain
    reasons], seen {(name, state)} of every region read). A required series that fails raises; any other that fails
    leaves its fields out and is named in `missing`.
    """
    data, hist, newest, missing, seen, rows = {}, {}, {}, [], set(), 0
    for s in series:
        try:
            path, meta = ctx.fetch(BASE + s["file"], s["key"] + ".csv", timeout=180, min_bytes=1000)
            got, series_hist, n, last, regions = parse_one(path, region_type, s, resolve, min_regions)
        except SourceUnavailable as exc:
            if s.get("required"):
                raise
            missing.append("%s (%s)" % (s["key"], str(exc)[:70]))
            continue
        ctx.log("%s: %d regions, newest month %s (%s)" % (s["key"], len(regions), last, meta.get("status")))
        rows += n
        newest[s["field"]] = last
        seen |= regions
        for geo, vals in got.items():
            data.setdefault(geo, {}).update(vals)
        for geo, vals in series_hist.items():
            hist.setdefault(geo, {}).update(vals)
    return data, hist, rows, newest, missing, seen


def lag_note(newest):
    """'' when every series ends in the same month, else a plain clause naming the ones that end earlier."""
    top = max(newest.values())
    late = sorted((f, m) for f, m in newest.items() if m != top)
    if not late:
        return ""
    return "Ends earlier than %s: %s." % (top, ", ".join("%s %s" % (f, m) for f, m in late))
