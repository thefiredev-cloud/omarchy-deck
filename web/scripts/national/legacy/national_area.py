"""Rental-area factors and the A/B/C/D rental area grade for the national ZIP dataset (owner order 2026-11-11).

Parsers for three more public bulk files, a nearest-points counter and the grade:
  parse_ipeds_hd() / parse_ipeds_enroll()   IPEDS institution directory (lat/lon) and derived fall enrollment
  parse_edge_schools()                      NCES EDGE public school geocodes (lat/lon)
  parse_chr_homicides()                     County Health Rankings county homicide rate (NCHS mortality files)
  near_counts()                             points and their weights within each radius of every ZCTA centroid
  grade_all()                               area_score, area_grade, area_conf and grade_parts from GRADE_METHOD

National ZIP-level crime is not published for free. The crime factor is the county homicide death rate, labelled
everywhere as a county-level proxy with its data years. A missing factor never counts as zero: the score is the
weighted mean of the factors present and area_conf is the share of the total weight that was present.
"""
import csv
import io
import math
import re
import zipfile

# ---------------------------------------------------------------- grade config (the only place weights live)
#
# Each factor maps its value to 0..100 points on a straight line from `zero` (0 points) to `full` (100 points),
# clamped at both ends. When `zero` is larger than `full` lower values are better. The renter-share line stops at
# its `full` value, so a ZIP above it gains nothing more (the cap).
GRADE_METHOD = {
    "factors": [
        {"key": "renter_share", "label": "Renter share of occupied homes", "unit": "%", "weight": 0.20,
         "zero": 20.0, "full": 50.0},
        {"key": "rent_to_income", "label": "Annual rent / median household income", "unit": "%", "weight": 0.15,
         "zero": 40.0, "full": 25.0},
        {"key": "hh_income", "label": "Median household income", "unit": "$", "weight": 0.10,
         "zero": 35000, "full": 75000},
        {"key": "yield_gross", "label": "Gross rent yield", "unit": "%", "weight": 0.20, "zero": 4.0, "full": 10.0},
        {"key": "zhvi_yoy", "label": "Home value change, 1 year", "unit": "%", "weight": 0.075,
         "zero": -5.0, "full": 5.0},
        {"key": "zhvi_5y", "label": "Home value change, 5 years", "unit": "%", "weight": 0.075,
         "zero": 0.0, "full": 40.0},
        {"key": "homicide_rate", "label": "Homicides per 100,000, county proxy for crime", "unit": "/100k",
         "weight": 0.10, "zero": 15.0, "full": 3.0},
        {"key": "college_enroll_5mi", "label": "College enrollment within 5 miles", "unit": "students",
         "weight": 0.10, "zero": 0, "full": 10000},
    ],
    "grades": [["A", 70.0], ["B", 55.0], ["C", 40.0]],  # score at or above; anything lower is D
    "min_pop": 1000,          # ACS population floor, the same floor as the housing score
    # A grade is for buying a house, so a ZIP with no home price basis (no gross yield: military bases, campuses,
    # prisons, PO-box ZIPs) is ungraded with the flag "no_price_basis" however well its other factors score.
    "required": ["yield_gross"],
    # Clear rejects for a rental buy: a gross yield this low cannot carry a house however good the area is. The grade
    # is held at max_grade and the score clipped to the top of that band (flag names the rule).
    "caps": [
        {"key": "yield_gross", "below": 4.0, "max_grade": "D", "flag": "yield_below_4pct"},
        {"key": "yield_gross", "below": 5.5, "max_grade": "C", "flag": "yield_below_5_5pct"},
    ],
    "min_coverage": 0.6,      # share of total weight that must be present for any grade
    "a_min_coverage": 0.8,    # an A needs this much; a lower-coverage A is shown as B with the flag "capped"
    "low_conf_below": 0.8,    # flag "low_confidence" under this coverage
}
GRADE_NOTE = ("Each factor scores 0 to 100 on a straight line between its zero and full values (clamped). Area score "
              "is the weighted mean of the factors present; area_conf is the share of total weight present. Missing "
              "factors are skipped, never scored as zero. Grade A >= 70, B >= 55, C >= 40, else D. A gross yield under "
              "5.5% holds the grade at C and under 4% at D (score clipped to that band). No grade below population "
              "1,000, without a gross yield (no home price basis) or under coverage 0.6; an A needs coverage 0.8. "
              "Crime is the county homicide death rate (County Health Rankings, NCHS mortality files), a county-level "
              "proxy: ZIP-level crime is not published for free.")

RADII_MI = (5, 10)
EARTH_MI = 3958.8

# ---------------------------------------------------------------- IPEDS


def _csv_member(path, suffix=".csv"):
    zf = zipfile.ZipFile(path)
    name = next(n for n in zf.namelist() if n.lower().endswith(suffix))
    return io.TextIOWrapper(zf.open(name), encoding="utf-8-sig", errors="replace")


def _f(v):
    try:
        x = float(str(v).strip())
    except (TypeError, ValueError):
        return None
    return x if x == x else None


SECTORS = {"1", "2", "3", "4", "5", "6", "7", "8", "9"}


def parse_ipeds_hd(path):
    """IPEDS HD<year> directory -> ({unitid: {name, lat, lon}}, {rows}). Kept: active this year (CYACTIVE 1),
    active postsecondary (PSEFLAG 1), degree-granting (DEGGRANT 1), a real sector (1-9), and a valid lat/lon."""
    out = {}
    with _csv_member(path) as fh:
        for row in csv.DictReader(fh):
            if (row.get("CYACTIVE") or "").strip() != "1" or (row.get("PSEFLAG") or "").strip() != "1":
                continue
            if (row.get("DEGGRANT") or "").strip() != "1" or (row.get("SECTOR") or "").strip() not in SECTORS:
                continue
            lat, lon = _f(row.get("LATITUDE")), _f(row.get("LONGITUD"))
            if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
                continue
            out[row["UNITID"].strip()] = {"name": (row.get("INSTNM") or "").strip(), "lat": lat, "lon": lon}
    return out, {"rows": len(out)}


def parse_ipeds_enroll(path):
    """IPEDS DRVEF<year> derived fall enrollment -> ({unitid: total enrollment}, {rows}). Negative codes are null."""
    out = {}
    with _csv_member(path) as fh:
        for row in csv.DictReader(fh):
            n = _f(row.get("ENRTOT"))
            if n is not None and n >= 0:
                out[row["UNITID"].strip()] = int(n)
    return out, {"rows": len(out)}


# ---------------------------------------------------------------- NCES EDGE public school geocodes

# The pipe-delimited TXT member has no header row; its columns are those of the xlsx member, in this order. A name that
# holds a pipe is double-quoted, so rows are read with the csv module.
EDGE_COLS = ["NCESSCH", "LEAID", "NAME", "OPSTFIPS", "STREET", "CITY", "STATE", "ZIP", "STFIP", "CNTY", "NMCNTY",
             "LOCALE", "LAT", "LON", "CBSA", "NMCBSA", "CBSATYPE", "CSA", "NMCSA", "CD", "SLDL", "SLDU", "SCHOOLYEAR"]


def parse_edge_schools(path):
    """EDGE_GEOCODE_PUBLICSCH_<yy><yy>.zip -> ([(lat, lon)], {rows, as_of}). Refuses a file whose rows do not have
    the expected column count or school-year field, so a reordered file never yields wrong coordinates."""
    zf = zipfile.ZipFile(path)
    name = next(n for n in zf.namelist() if n.upper().endswith(".TXT"))
    ilat, ilon, iyr = EDGE_COLS.index("LAT"), EDGE_COLS.index("LON"), EDGE_COLS.index("SCHOOLYEAR")
    pts, years = [], set()
    with io.TextIOWrapper(zf.open(name), encoding="latin-1", newline="") as fh:
        for f in csv.reader(fh, delimiter="|", quotechar='"'):
            if not f or f[0] == "NCESSCH":
                continue
            if len(f) != len(EDGE_COLS) or not re.match(r"^\d{4}-\d{4}$", f[iyr]):
                raise ValueError("unexpected EDGE row layout (%d fields)" % len(f))
            lat, lon = _f(f[ilat]), _f(f[ilon])
            if lat is None or lon is None:
                continue
            years.add(f[iyr])
            pts.append((lat, lon))
    return pts, {"rows": len(pts), "as_of": sorted(years)[-1] if years else None}


# ---------------------------------------------------------------- County Health Rankings


def parse_chr_homicides(path):
    """County Health Rankings analytic_data<year>.csv -> ({county_fips: {homicide_rate, county, state}}, {rows,
    release}). Two header rows (labels, then codes). v015_rawvalue is homicide deaths per 100,000; CHR leaves it
    blank where NCHS suppresses small counts, and blank stays null."""
    out, release = {}, None
    with open(path, encoding="utf-8-sig", errors="replace") as fh:
        rd = csv.reader(fh)
        next(rd)
        codes = next(rd)
        ix = {c: i for i, c in enumerate(codes)}
        if "v015_rawvalue" not in ix or "fipscode" not in ix:
            raise ValueError("homicide column v015_rawvalue not found")
        for row in rd:
            if len(row) <= ix["v015_rawvalue"]:
                continue
            fips = row[ix["fipscode"]].strip().zfill(5)
            if fips.endswith("000"):
                continue  # state and national rows
            release = release or row[ix.get("year", 0)].strip() or None
            rate = _f(row[ix["v015_rawvalue"]])
            out[fips] = {"homicide_rate": round(rate, 1) if rate is not None and rate >= 0 else None,
                         "county": row[ix.get("county", 0)].strip(), "state": row[ix.get("state", 0)].strip()}
    return out, {"rows": len(out), "release": release}


# ---------------------------------------------------------------- distance counts


def haversine_mi(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_MI * math.asin(min(1.0, math.sqrt(a)))


CELL = 0.2  # degrees


def near_counts(centroids, points, radii=RADII_MI):
    """centroids {key: (lat, lon)}, points [(lat, lon, weight or None)] -> {key: {r: [count, weight_sum]}}.
    A point with weight None counts toward `count` only. Grid buckets of CELL degrees keep this linear-ish."""
    grid = {}
    for p in points:
        grid.setdefault((math.floor(p[0] / CELL), math.floor(p[1] / CELL)), []).append(p)
    rmax = max(radii)
    out = {}
    for key, (lat, lon) in centroids.items():
        res = {r: [0, 0] for r in radii}
        dlat = int(math.ceil(rmax / 69.0 / CELL))
        coslat = max(0.05, math.cos(math.radians(lat)))
        dlon = int(math.ceil(rmax / (69.17 * coslat) / CELL))
        ci, cj = math.floor(lat / CELL), math.floor(lon / CELL)
        for i in range(ci - dlat, ci + dlat + 1):
            for j in range(cj - dlon, cj + dlon + 1):
                for p in grid.get((i, j), ()):
                    d = haversine_mi(lat, lon, p[0], p[1])
                    for r in radii:
                        if d <= r:
                            res[r][0] += 1
                            if p[2] is not None:
                                res[r][1] += p[2]
        out[key] = res
    return out


def college_points(hd, enroll):
    """[(lat, lon, enrollment or None)] from parse_ipeds_hd and parse_ipeds_enroll."""
    return [(v["lat"], v["lon"], enroll.get(u)) for u, v in hd.items()]


# ---------------------------------------------------------------- grade


def factor_points(value, zero, full):
    """0..100 on the straight line zero -> full, clamped. Works for either direction."""
    if value is None or full == zero:
        return None
    t = (value - zero) / float(full - zero)
    return round(max(0.0, min(1.0, t)) * 100, 1)


def grade_of(score, grades):
    for g, cut in grades:
        if score >= cut:
            return g
    return "D"


def grade_one(rec, method=GRADE_METHOD):
    """-> (area_score, area_grade, area_conf, parts, flags). parts: {key: {value, points, weight}} for present
    factors and {key: {value: None, weight}} for missing ones."""
    parts, wsum, acc, flags = {}, 0.0, 0.0, []
    for f in method["factors"]:
        v = rec.get(f["key"])
        pts = factor_points(v, f["zero"], f["full"])
        if pts is None:
            parts[f["key"]] = {"value": None, "points": None, "weight": f["weight"]}
            continue
        parts[f["key"]] = {"value": v, "points": pts, "weight": f["weight"]}
        wsum += f["weight"]
        acc += f["weight"] * pts
    total = sum(f["weight"] for f in method["factors"])
    conf = round(wsum / total, 2) if total else 0.0
    if (rec.get("pop") or 0) < method["min_pop"]:
        return None, None, conf, parts, ["below_population_floor"]
    if any(rec.get(k) is None for k in method.get("required", ())):
        return None, None, conf, parts, ["no_price_basis"]
    if conf < method["min_coverage"]:
        return None, None, conf, parts, ["too_little_data"]
    score = round(acc / wsum, 1)
    g = grade_of(score, method["grades"])
    order = [x[0] for x in method["grades"]] + ["D"]

    def cap(to, flag):
        nonlocal g, score
        if order.index(g) < order.index(to):
            g = to
            # clip the score to the top of the capped band so sorting by score agrees with the grade
            above = order[order.index(to) - 1]
            score = min(score, round(dict(method["grades"])[above] - 0.1, 1))
            flags.append(flag)

    for c in method.get("caps", ()):
        v = rec.get(c["key"])
        if v is not None and v < c["below"]:
            cap(c["max_grade"], c["flag"])
    if conf < method["a_min_coverage"]:
        cap("B", "capped")
    if conf < method["low_conf_below"]:
        flags.append("low_confidence")
    return score, g, conf, parts, flags


def grade_all(records, method=GRADE_METHOD):
    """Fill area_score, area_grade, area_conf, grade_parts and grade_flags in place. -> {"A": n, ..., "ungraded": n}."""
    counts = {"A": 0, "B": 0, "C": 0, "D": 0, "ungraded": 0}
    for r in records.values():
        score, g, conf, parts, flags = grade_one(r, method)
        r["area_score"], r["area_grade"], r["area_conf"] = score, g, conf
        r["grade_parts"], r["grade_flags"] = parts, flags
        counts[g or "ungraded"] += 1
    return counts
