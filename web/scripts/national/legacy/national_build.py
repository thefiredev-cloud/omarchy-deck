"""Build the national ZIP housing and commercial dataset from parsed sources (see deck-feed-housing-national).

Pure functions over plain dicts so the unit tests can feed synthetic numbers:
  merge_zip()        one ZIP record from every source part, with field_sources
  score_all()        h_score / c_score percentile composites (weights in SCORE_METHOD)
  aggregate()        us / state / metro rollups with a per-metric method
  write_outputs()    manifest.json, zips.json, zip/<first three digits>.json, each written atomically, mode 0600
  ensure_invest_profile()  creates ~/.config/pixel-deck/invest-profile.json once, never overwrites
"""
import bisect
import json
import os
import re
import subprocess
import tempfile
import time

from national_sources import NAICS2, STATES, STATES_51, sector_groups

OUT_DIR = os.path.expanduser(os.environ.get("DECK_NATIONAL_OUT") or "~/.kodros/status/house-feeds/national")
PROFILE = os.path.expanduser("~/.config/pixel-deck/invest-profile.json")

COLS = ["zip", "city", "state", "county", "metro", "lat", "lon", "pop", "hh_income", "zhvi", "zhvi_yoy", "zhvi_5y",
        "rent", "rent_src", "rent_yoy", "list_price", "active", "dom", "price_cut_share", "yield_gross",
        "price_to_income", "vacancy", "owner_share", "biz_estabs", "biz_estabs_5y", "biz_emp", "biz_pay_per_emp",
        "estabs_per_1k", "retail_estabs", "office_estabs", "industrial_estabs", "com_listings", "com_median_price",
        "com_median_cap", "h_score", "c_score", "renter_share", "median_age", "rent_to_income", "homicide_rate",
        "colleges_5mi", "college_enroll_5mi", "colleges_10mi", "college_enroll_10mi", "schools_5mi", "area_score",
        "area_grade", "area_conf"]

SCORE_MIN_POP = 1000
THIN_MARKET_MIN_ACTIVE = 10  # list price is a price basis only with at least this many active listings
SCORE_METHOD = {
    "h": [
        {"key": "yield_gross", "label": "Gross rent yield", "weight": 0.25, "direction": "higher"},
        {"key": "zhvi_yoy", "label": "Home value change, 1 year", "weight": 0.10, "direction": "higher"},
        {"key": "zhvi_5y", "label": "Home value change, 5 years", "weight": 0.15, "direction": "higher"},
        {"key": "dom", "label": "Median days on market", "weight": 0.10, "direction": "lower"},
        {"key": "price_to_income", "label": "Price to household income", "weight": 0.15, "direction": "lower"},
        {"key": "vacancy", "label": "Housing vacancy rate", "weight": 0.10, "direction": "lower"},
        {"key": "pop", "label": "Population", "weight": 0.15, "direction": "higher"},
    ],
    "c": [
        {"key": "biz_estabs_5y", "label": "Establishment change, 5 years", "weight": 0.25, "direction": "higher"},
        {"key": "biz_emp", "label": "Employment", "weight": 0.15, "direction": "higher"},
        {"key": "biz_pay_per_emp", "label": "Annual payroll per employee", "weight": 0.15, "direction": "higher"},
        {"key": "estabs_per_1k", "label": "Establishments per 1,000 residents", "weight": 0.15, "direction": "higher"},
        {"key": "hh_income", "label": "Median household income", "weight": 0.15, "direction": "higher"},
        {"key": "pop", "label": "Population", "weight": 0.15, "direction": "higher"},
    ],
}
SCORE_NOTE = ("Percentile rank 0 to 100 among ZIPs with population of at least %d (ACS 5-year). Lower-is-better "
              "components are inverted. Composite is the weighted mean of the available components, re-weighted over "
              "those present; null when fewer than 3 components exist or the ZIP is below the population floor. "
              "Scores do not depend on the budget." % SCORE_MIN_POP)

AGG_METHOD = {
    "pop": "sum", "active": "sum", "biz_estabs": "sum", "biz_emp": "sum", "retail_estabs": "sum",
    "office_estabs": "sum", "industrial_estabs": "sum", "com_listings": "sum",
    "hh_income": "pop_weighted_median", "zhvi": "pop_weighted_median", "rent": "pop_weighted_median",
    "list_price": "pop_weighted_median", "dom": "pop_weighted_median", "yield_gross": "pop_weighted_median",
    "price_to_income": "pop_weighted_median", "biz_pay_per_emp": "pop_weighted_median",
    "zhvi_yoy": "pop_weighted_mean", "zhvi_5y": "pop_weighted_mean", "rent_yoy": "pop_weighted_mean",
    "price_cut_share": "pop_weighted_mean", "vacancy": "pop_weighted_mean", "owner_share": "pop_weighted_mean",
    "estabs_per_1k": "ratio_of_sums", "biz_estabs_5y": "ratio_of_sums",
}
AGG_NOTE = ("sum: total over member ZIPs that report the field. pop_weighted_median / pop_weighted_mean: weighted by "
            "ACS population over member ZIPs that report both the field and population. ratio_of_sums: "
            "estabs_per_1k = sum of establishments / sum of population x 1000; biz_estabs_5y = sum of current "
            "establishments / sum of establishments five years earlier, over ZIPs present in both vintages.")


def _r(v, nd=2):
    """Round; nd=0 gives an int so counts and dollars serialize without '.0'."""
    if v is None:
        return None
    return int(round(v)) if nd == 0 else round(v, nd)


# ---------------------------------------------------------------- one ZIP

def merge_zip(z, p, src):
    """One ZIP from source parts. `p` holds the per-source dict for this ZIP (or None) under keys: gaz, county,
    cbsa, geo, zhvi, zori, rdc, rdc_hist, acs, safmr, fhfa, zbp, zbp_old, zbp_detail, com, near (college and school
    counts from national_area.near_counts); crime_map and cbsa_map are whole maps keyed by county FIPS. `src` maps
    source keys to {"id", "as_of"} for field_sources. Returns the full shard record (all COLS plus shard-only fields)."""
    g = lambda k: p.get(k) or {}  # noqa: E731
    fs = {}

    def put(rec, field, value, source):
        rec[field] = value
        if value is not None and source:
            fs[field] = {"source": src[source]["id"], "as_of": (p.get(source) or {}).get("as_of") or src[source]["as_of"]}

    rec = {"zip": z}
    gaz, cty, geo, zh, zo, rdc, acs = g("gaz"), g("county"), g("geo"), g("zhvi"), g("zori"), g("rdc"), g("acs")
    county_fips = cty.get("county_fips") or geo.get("county_fips")
    cbsa = (p.get("cbsa_map") or {}).get(county_fips) or {} if county_fips else {}
    state = STATES.get((county_fips or "")[:2], (None,))[0] if county_fips else None
    state_src = "county" if state else None
    for key in ("zhvi", "rdc", "zbp", "geo"):
        if not state and g(key).get("state"):
            state, state_src = g(key)["state"], key
    city, city_src = None, None
    for key in ("zhvi", "rdc", "zbp", "geo"):
        if g(key).get("city"):
            city, city_src = g(key)["city"], key
            break
    county = cty.get("county") or zh.get("county") or geo.get("county")
    county_src = "county" if cty.get("county") else ("zhvi" if zh.get("county") else ("geo" if geo.get("county") else None))
    put(rec, "city", city, city_src)
    put(rec, "state", state, state_src)
    put(rec, "county", county, county_src)
    put(rec, "metro", cbsa.get("metro"), "cbsa" if cbsa else None)
    latlon_src = "gaz" if gaz.get("lat") is not None else ("geo" if geo.get("lat") is not None else None)
    put(rec, "lat", g(latlon_src).get("lat") if latlon_src else None, latlon_src)
    put(rec, "lon", g(latlon_src).get("lon") if latlon_src else None, latlon_src)

    put(rec, "pop", _r(acs.get("pop"), 0), "acs")
    put(rec, "hh_income", _r(acs.get("hh_income"), 0), "acs")
    put(rec, "zhvi", zh.get("value"), "zhvi")
    put(rec, "zhvi_yoy", zh.get("yoy"), "zhvi")
    put(rec, "zhvi_5y", zh.get("chg_5y"), "zhvi")

    sf = g("safmr")
    if zo.get("value") is not None:
        rent, rent_src, rsrc = zo["value"], "zori", "zori"
    elif sf.get("br2") is not None:
        rent, rent_src, rsrc = sf["br2"], "hud_safmr_2br", "safmr"
    elif acs.get("median_gross_rent") is not None:
        rent, rent_src, rsrc = _r(acs["median_gross_rent"], 0), "acs_median_gross_rent", "acs"
    else:
        rent, rent_src, rsrc = None, None, None
    put(rec, "rent", rent, rsrc)
    rec["rent_src"] = rent_src
    put(rec, "rent_yoy", zo.get("yoy"), "zori")

    put(rec, "list_price", rdc.get("list_price"), "rdc")
    put(rec, "active", rdc.get("active"), "rdc")
    put(rec, "dom", rdc.get("dom"), "rdc")
    put(rec, "price_cut_share", rdc.get("price_cut_share"), "rdc")

    # Price basis for yield and price-to-income: ZHVI, else the Realtor.com median list price only when the ZIP has at
    # least THIN_MARKET_MIN_ACTIVE active listings (a handful of listings gives a median that is not a market price),
    # else null. Publisher values themselves are never altered.
    if rec["zhvi"] is not None:
        price = rec["zhvi"]
        basis = {"field": "zhvi", "source": src["zhvi"]["id"], "as_of": zh.get("as_of") or src["zhvi"]["as_of"]}
    elif rec["list_price"] is not None and (rec["active"] or 0) >= THIN_MARKET_MIN_ACTIVE:
        price = rec["list_price"]
        basis = {"field": "list_price", "source": src["rdc"]["id"], "as_of": rdc.get("as_of") or src["rdc"]["as_of"]}
    else:
        price, basis = None, None
    rec["yield_gross"] = round(rent * 12 / price * 100, 2) if rent is not None and price else None
    if rec["yield_gross"] is not None:
        fs["yield_gross"] = {"source": "derived", "as_of": basis["as_of"], "price_basis": basis,
                             "rent_basis": dict(fs["rent"], field="rent", rent_src=rent_src)}
    inc = rec["hh_income"]
    rec["price_to_income"] = round(price / inc, 2) if price and inc else None
    if rec["price_to_income"] is not None:
        fs["price_to_income"] = {"source": "derived", "as_of": basis["as_of"], "price_basis": basis,
                                 "income_basis": dict(fs["hh_income"], field="hh_income")}
    put(rec, "vacancy", acs.get("vacancy"), "acs")
    put(rec, "owner_share", acs.get("owner_share"), "acs")
    put(rec, "renter_share", acs.get("renter_share"), "acs")
    put(rec, "median_age", acs.get("median_age"), "acs")
    rent_v, inc_v = rec["rent"], rec["hh_income"]
    rec["rent_to_income"] = round(rent_v * 12 / inc_v * 100, 1) if rent_v is not None and inc_v else None
    if rec["rent_to_income"] is not None:
        fs["rent_to_income"] = {"source": "derived", "as_of": fs["rent"]["as_of"],
                                "rent_basis": dict(fs["rent"], field="rent", rent_src=rent_src),
                                "income_basis": dict(fs["hh_income"], field="hh_income")}

    # county homicide rate: a county-level proxy for crime, looked up by the ZIP's largest-share county
    crime = (p.get("crime_map") or {}).get(county_fips) if county_fips else None
    rec["homicide_rate"] = (crime or {}).get("homicide_rate")
    if rec["homicide_rate"] is not None:
        fs["homicide_rate"] = {"source": src["chr"]["id"], "as_of": src["chr"]["as_of"], "level": "county",
                               "county_fips": county_fips, "release": src["chr"].get("release")}
    near = g("near")
    for field, source in (("colleges_5mi", "ipeds"), ("colleges_10mi", "ipeds"), ("college_enroll_5mi", "ipeds_enroll"),
                          ("college_enroll_10mi", "ipeds_enroll"), ("schools_5mi", "edge")):
        put(rec, field, near.get(field), source if near.get(field) is not None else None)
    rec["area_score"] = rec["area_grade"] = rec["area_conf"] = None

    zb, zbo = g("zbp"), g("zbp_old")
    est, est_old = zb.get("estabs"), zbo.get("estabs")
    put(rec, "biz_estabs", _r(est, 0), "zbp")
    rec["biz_estabs_5y"] = round((est - est_old) / est_old * 100, 2) if est is not None and est_old else None
    if rec["biz_estabs_5y"] is not None:
        fs["biz_estabs_5y"] = {"source": "derived", "as_of": None, "inputs": [src["zbp"]["id"], src["zbp_old"]["id"]]}
    put(rec, "biz_emp", _r(zb.get("emp"), 0), "zbp")
    emp, pay = zb.get("emp"), zb.get("payroll_k")
    rec["biz_pay_per_emp"] = round(pay * 1000 / emp) if emp and pay is not None else None
    if rec["biz_pay_per_emp"] is not None:
        fs["biz_pay_per_emp"] = {"source": src["zbp"]["id"], "as_of": src["zbp"]["as_of"], "inputs": ["payroll", "emp"]}
    pop = rec["pop"]
    rec["estabs_per_1k"] = round(est / pop * 1000, 2) if est is not None and pop else None
    if rec["estabs_per_1k"] is not None:
        fs["estabs_per_1k"] = {"source": "derived", "as_of": None, "inputs": ["biz_estabs", "pop"]}
    sectors = p.get("zbp_detail") or {}
    retail, office, industrial = sector_groups(sectors)
    put(rec, "retail_estabs", retail, "zbp_detail" if sectors else None)
    put(rec, "office_estabs", office, "zbp_detail" if sectors else None)
    put(rec, "industrial_estabs", industrial, "zbp_detail" if sectors else None)

    com = g("com")
    put(rec, "com_listings", com.get("com_listings"), "com" if com else None)
    put(rec, "com_median_price", com.get("com_median_price"), "com" if com else None)
    put(rec, "com_median_cap", com.get("com_median_cap"), "com" if com else None)
    rec["h_score"] = None
    rec["c_score"] = None

    # shard-only fields
    rec["county_fips"] = county_fips
    rec["cbsa"] = cbsa.get("cbsa")
    rec["cbsa_kind"] = cbsa.get("kind")
    rec["fmr"] = ({"br0": sf.get("br0"), "br1": sf.get("br1"), "br2": sf.get("br2"), "br3": sf.get("br3"),
                   "br4": sf.get("br4"), "year": src["safmr"]["as_of"], "area": sf.get("area")} if sf else None)
    rec["acs"] = ({"median_gross_rent": _r(acs.get("median_gross_rent"), 0),
                   "median_year_built": _r(acs.get("median_year_built"), 0),
                   "housing_units": _r(acs.get("housing_units"), 0), "renter_share": acs.get("renter_share"),
                   "as_of": src["acs"]["as_of"]} if acs else None)
    fh = g("fhfa")
    rec["fhfa_hpi_5y"] = fh.get("hpi_5y")
    if rec["fhfa_hpi_5y"] is not None:
        fs["fhfa_hpi_5y"] = {"source": src["fhfa"]["id"], "as_of": str(fh.get("year"))}
    rec["biz_estabs_prior"] = _r(est_old, 0)
    rec["sectors"] = [{"naics": code, "label": NAICS2.get(code, code), "estabs": n, "emp": None}
                      for code, n in sorted(sectors.items())]
    rec["realtor_quality_flag"] = rdc.get("quality_flag")
    hist = {"zhvi": zh.get("hist") or [], "rent": zo.get("hist") or [],
            "list_price": (p.get("rdc_hist") or {}).get("list_price") or [],
            "active": (p.get("rdc_hist") or {}).get("active") or []}
    rec["hist"] = hist
    rec["field_sources"] = fs
    rec["score_parts"] = {"h": {}, "c": {}}
    return rec


# ---------------------------------------------------------------- scores

def percentile_ranks(values):
    """{key: value} -> {key: percentile 0-100} using the mid-rank for ties."""
    ordered = sorted(values.values())
    n = len(ordered)
    out = {}
    for k, v in values.items():
        lo, hi = bisect.bisect_left(ordered, v), bisect.bisect_right(ordered, v)
        out[k] = round((lo + 0.5 * (hi - lo)) / n * 100, 1)
    return out


def score_all(records, min_pop=SCORE_MIN_POP, method=SCORE_METHOD):
    """Fill h_score, c_score and score_parts in place. Returns {"h": n_scored, "c": n_scored, "universe": n}."""
    universe = [z for z, r in records.items() if (r.get("pop") or 0) >= min_pop]
    counts = {"universe": len(universe)}
    for kind, comps in method.items():
        parts = {z: {} for z in universe}
        for c in comps:
            vals = {z: records[z][c["key"]] for z in universe if records[z].get(c["key"]) is not None}
            if not vals:
                continue
            for z, pct in percentile_ranks(vals).items():
                parts[z][c["key"]] = pct if c["direction"] == "higher" else round(100 - pct, 1)
        weights = {c["key"]: c["weight"] for c in comps}
        scored = 0
        for z in universe:
            got = parts[z]
            records[z]["score_parts"][kind] = got
            if len(got) < 3:
                continue
            w = sum(weights[k] for k in got)
            records[z]["%s_score" % kind] = round(sum(weights[k] * v for k, v in got.items()) / w, 1)
            scored += 1
        counts[kind] = scored
    return counts


# ---------------------------------------------------------------- aggregates

def weighted_median(pairs):
    """[(value, weight)] -> weighted median, None when empty."""
    pairs = sorted((v, w) for v, w in pairs if v is not None and w)
    if not pairs:
        return None
    half = sum(w for _, w in pairs) / 2.0
    acc = 0.0
    for v, w in pairs:
        acc += w
        if acc >= half:
            return v
    return pairs[-1][0]


def aggregate(rows):
    """Rollup of a list of ZIP records -> dict of AGG_METHOD metrics plus zips and method."""
    out = {"zips": len(rows)}
    for key, how in AGG_METHOD.items():
        if how == "sum":
            vals = [r[key] for r in rows if r.get(key) is not None]
            out[key] = round(sum(vals)) if vals else None
        elif how == "pop_weighted_median":
            v = weighted_median([(r.get(key), r.get("pop")) for r in rows])
            out[key] = None if v is None else (round(v, 2) if isinstance(v, float) and abs(v) < 100 else round(v))
        elif how == "pop_weighted_mean":
            pairs = [(r[key], r["pop"]) for r in rows if r.get(key) is not None and r.get("pop")]
            tw = sum(w for _, w in pairs)
            out[key] = round(sum(v * w for v, w in pairs) / tw, 2) if tw else None
    both = [r for r in rows if r.get("biz_estabs") is not None and r.get("pop")]
    sp = sum(r["pop"] for r in both)
    out["estabs_per_1k"] = round(sum(r["biz_estabs"] for r in both) / sp * 1000, 2) if sp else None
    pair = [r for r in rows if r.get("biz_estabs") is not None and r.get("biz_estabs_prior")]
    old = sum(r["biz_estabs_prior"] for r in pair)
    out["biz_estabs_5y"] = round((sum(r["biz_estabs"] for r in pair) - old) / old * 100, 2) if old else None
    out["method"] = dict(AGG_METHOD)
    return out


def rollups(records):
    """-> (us, states, metros). us and states cover the 50 states plus DC; metros are Metropolitan Statistical Areas."""
    by_state, by_metro = {}, {}
    for r in records.values():
        if r.get("state") in STATES_51:
            by_state.setdefault(r["state"], []).append(r)
            if r.get("cbsa") and r.get("cbsa_kind") == "metro":
                by_metro.setdefault(r["cbsa"], []).append(r)
    us = aggregate([r for rows in by_state.values() for r in rows])
    us["scope"] = "50 states and DC"
    names = {abbr: name for abbr, name in (v for v in STATES.values())}
    states = []
    for st in sorted(by_state):
        a = aggregate(by_state[st])
        states.append(dict({"state": st, "name": names.get(st)}, **a))
    metros = []
    for cbsa, rows in by_metro.items():
        a = aggregate(rows)
        metros.append(dict({"cbsa": cbsa, "name": rows[0].get("metro")}, **a))
    metros.sort(key=lambda m: -(m.get("pop") or 0))
    return us, states, metros


# ---------------------------------------------------------------- output

def _atomic_json(path, obj):
    d = os.path.dirname(path)
    os.makedirs(d, mode=0o700, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".%s." % os.path.basename(path), suffix=".tmp", dir=d)
    try:
        with os.fdopen(fd, "w", encoding="utf8") as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def write_outputs(records, manifest, out_dir=OUT_DIR):
    """Shards first, then zips.json, then manifest.json last so a reader that sees the new manifest finds new data."""
    os.makedirs(out_dir, mode=0o700, exist_ok=True)
    os.chmod(out_dir, 0o700)
    gen = manifest["generated_at"]
    shards = {}
    for z in sorted(records):
        shards.setdefault(z[:3], {})[z] = records[z]
    for prefix, zips in shards.items():
        _atomic_json(os.path.join(out_dir, "zip", prefix + ".json"), {"schema": 1, "generated_at": gen, "zips": zips})
    os.chmod(os.path.join(out_dir, "zip"), 0o700)
    rows = [[records[z].get(c) for c in COLS] for z in sorted(records)]
    _atomic_json(os.path.join(out_dir, "zips.json"), {"schema": 1, "generated_at": gen, "cols": COLS, "rows": rows})
    _atomic_json(os.path.join(out_dir, "manifest.json"), manifest)
    return len(shards)


def coverage(records):
    r = list(records.values())
    has = lambda k: sum(1 for x in r if x.get(k) is not None)  # noqa: E731
    return {"zips_total": len(r), "with_zhvi": has("zhvi"), "with_rent": has("rent"),
            "with_listings_stats": sum(1 for x in r if x.get("list_price") is not None or x.get("active") is not None),
            "with_acs": has("pop"), "with_fmr": sum(1 for x in r if x.get("fmr")), "with_biz": has("biz_estabs"),
            "with_renter_share": has("renter_share"), "with_crime_proxy": has("homicide_rate"),
            "with_colleges": has("colleges_5mi"), "with_schools": has("schools_5mi"), "graded": has("area_grade")}


# ---------------------------------------------------------------- investor profile

LA_LISTING_URL = "https://file.lacounty.gov/SDSInter/lac/1043266_alpha.pdf"
LA_FAQ_URL = "https://fire.lacounty.gov/wp-content/uploads/2026/10/2026-FFT-P-Emergency-FAQs_Rebulletin.pdf"
PARAMEDIC_BONUS = 0.179  # LACoFD FAQ: 17.9% paramedic bonus on monthly base for Fire Fighters in paramedic posts
MONTHS = {m: i + 1 for i, m in enumerate(["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST",
                                          "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"])}


def parse_la_listing(text):
    """LA County 'Class and Salary Listing' text (pdftotext -layout) -> (top_monthly_step, listing_date, item, effective)
    for FIRE FIGHTER(56 HOURS), or None. top_monthly_step is the published monthly range maximum."""
    m = re.search(r"AS OF ([A-Z]+) (\d{1,2}), (\d{4})", text)
    as_of = "%s-%02d-%02d" % (m.group(3), MONTHS[m.group(1)], int(m.group(2))) if m and m.group(1) in MONTHS else None
    for line in text.splitlines():
        row = re.match(r"^\s*(\d{4})\s+FIRE FIGHTER\(56 HOURS\)\s+(\d{2}-[A-Z]{3}-\d{2})\s+(.*)$", line)
        if not row:
            continue
        money = re.findall(r"\d{1,3}(?:,\d{3})*\.\d{2}", row.group(3))
        if len(money) < 2:
            return None
        return float(money[-1].replace(",", "")), as_of, row.group(1), row.group(2)
    return None


def la_county_income(fetch_pdf):
    """-> (income_annual or None, income_src, income_asof). `fetch_pdf()` returns a local path to the listing PDF."""
    try:
        path = fetch_pdf()
        text = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True, timeout=120,
                              check=True).stdout
        got = parse_la_listing(text)
    except Exception as exc:  # noqa: BLE001
        return None, "Not confirmed: LA County Class and Salary Listing could not be read (%s). %s" % (
            str(exc)[:80], LA_LISTING_URL), None
    if not got:
        return None, "Not confirmed: FIRE FIGHTER(56 HOURS) row not found in %s" % LA_LISTING_URL, None
    top, as_of, item, eff = got
    return paramedic_annual(top), paramedic_src(item), as_of


def paramedic_annual(top_monthly):
    """Firefighter-paramedic default income: top monthly step x 12 plus the 17.9% paramedic bonus, whole dollars."""
    return round(top_monthly * 12 * (1 + PARAMEDIC_BONUS))


def paramedic_src(item):
    return ("Class %s FIRE FIGHTER(56 HOURS) top step x 12 (%s) plus 17.9%% paramedic bonus (%s)"
            % (item, LA_LISTING_URL, LA_FAQ_URL))


def default_profile(income):
    annual, src, asof = income
    return {"schema": 1, "income_annual": annual, "income_src": src, "income_asof": asof, "co_income_annual": 0,
            "monthly_debt": 0, "cash_mode": "auto", "cash_manual": None, "down_pct": 0.25, "closing_pct": 0.03,
            "dti_max": 0.43, "tax_ins_rate": 0.015, "rate_adj": 0, "updated_at": int(time.time())}


def ensure_invest_profile(income_lookup, path=PROFILE):
    """Create the profile only when absent (O_EXCL, mode 0600). Returns "created" or "exists"."""
    if os.path.exists(path):
        return "exists"
    doc = default_profile(income_lookup())
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return "exists"
    with os.fdopen(fd, "w", encoding="utf8") as fh:
        json.dump(doc, fh, indent=1)
    return "created"
