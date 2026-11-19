"""The legacy ZIP records (v1 fields) from the wrapped legacy plugins' results.

`build()` and `near_parts()` are the old collector's, unchanged; only the inputs moved from in-process loaders to the
plugin results (`result["legacy"]`, the exact parser output) and the v1 manifest rows (`result["legacy_row"]`).
The v1 commercial listing fields (com_listings, com_median_price, com_median_cap) come from the cre_listings_zip
plugin, which replaced the legacy realestate_feed_commercial join; the v1 manifest keeps that row id for its readers.
"""
import national_area as A
import national_build as B

# v1 manifest.sources order; crime_zip_level and fred_mortgage30 are rows the core adds itself.
ORDER = ["zillow_zhvi", "zillow_zori", "realtor_zip", "realtor_zip_history", "census_gazetteer", "census_zcta_county",
         "census_cbsa", "geonames_postal", "census_acs5", "hud_safmr", "fhfa_zip5", "census_zbp", "census_zbp_detail",
         "census_zbp_prior", "realestate_feed_commercial", "ipeds_hd", "ipeds_enroll", "nces_edge_schools",
         "chr_homicides", "crime_zip_level", "fred_mortgage30"]
# v1 source row filled from a plugin result instead of a wrapped legacy loader
LISTINGS_ROW, LISTINGS = "realestate_feed_commercial", "cre_listings_zip"
COM_FIELDS = ("com_listings", "com_median_price", "com_median_cap")  # v1 fields the listings plugin owns in v2
WRAPPED = [s for s in ORDER if s not in ("crime_zip_level", "fred_mortgage30", LISTINGS_ROW)]
KEY = {"zillow_zhvi": "zhvi", "zillow_zori": "zori", "realtor_zip": "rdc", "realtor_zip_history": "rdc_hist",
       "census_gazetteer": "gaz", "census_zcta_county": "county", "census_cbsa": "cbsa_map", "geonames_postal": "geo",
       "census_acs5": "acs", "hud_safmr": "safmr", "fhfa_zip5": "fhfa", "census_zbp": "zbp",
       "census_zbp_detail": "zbp_detail", "census_zbp_prior": "zbp_old",
       "ipeds_hd": "ipeds_hd", "ipeds_enroll": "ipeds_enroll", "nces_edge_schools": "schools"}
V1_ROWS = [s for s in ORDER if s not in ("crime_zip_level", "fred_mortgage30")]  # rows before crime and FRED
CRIME_ROW = {"id": "crime_zip_level", "name": "ZIP-level crime", "url": None, "as_of": None, "rows": None,
             "status": "unavailable",
             "reason": "not freely published nationally; the FBI CDE API needs an api.data.gov key and reports by "
                       "agency, so crime is the county homicide proxy above"}
FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=MORTGAGE30US"


def near_parts(P):
    """{zip: {colleges_5mi, college_enroll_5mi, colleges_10mi, college_enroll_10mi, schools_5mi}} around each ZIP's
    gazetteer centroid (GeoNames point where the gazetteer has none). A source that failed leaves its fields absent."""
    cent = {}
    for z, v in (P.get("geo") or {}).items():
        if v.get("lat") is not None and v.get("lon") is not None:
            cent[z] = (v["lat"], v["lon"])
    for z, v in (P.get("gaz") or {}).items():
        if v.get("lat") is not None and v.get("lon") is not None:
            cent[z] = (v["lat"], v["lon"])
    out = {z: {} for z in cent}
    if P.get("ipeds_hd"):
        enroll = P.get("ipeds_enroll")
        near = A.near_counts(cent, A.college_points(P["ipeds_hd"], enroll or {}))
        for z, res in near.items():
            out[z].update(colleges_5mi=res[5][0], colleges_10mi=res[10][0])
            if enroll:
                out[z].update(college_enroll_5mi=res[5][1], college_enroll_10mi=res[10][1])
    if P.get("schools"):
        near = A.near_counts(cent, [(lat, lon, None) for lat, lon in P["schools"]], radii=(5,))
        for z, res in near.items():
            out[z]["schools_5mi"] = res[5][0]
    return out


def build(P, src):
    """Every gazetteer ZCTA plus every ZIP a metrics publisher reports."""
    universe = set(P.get("gaz") or {})
    for key in ("zhvi", "zori", "rdc", "acs", "safmr", "fhfa", "zbp"):
        universe |= set(P.get(key) or {})
    P["near"] = near_parts(P)
    keys = ("gaz", "county", "geo", "zhvi", "zori", "rdc", "rdc_hist", "acs", "safmr", "fhfa", "zbp", "zbp_old",
            "zbp_detail", "com", "near")
    cbsa_map, crime_map = P.get("cbsa_map") or {}, P.get("crime_map") or {}
    records = {}
    for z in universe:
        part = {k: (P.get(k) or {}).get(z) for k in keys}
        part["cbsa_map"] = cbsa_map
        part["crime_map"] = crime_map
        records[z] = B.merge_zip(z, part, src)
    return records


def listings_part(res, rep):
    """(v1 manifest row, {zip: {com_listings, com_median_price, com_median_cap}} or None) from the cre_listings_zip
    result. Only ZIPs with for-sale rows carry the v1 fields, as the legacy join did (lease-only ZIPs stay out)."""
    src = rep.get("source") or {}
    row = {"id": LISTINGS_ROW, "name": src.get("name") or LISTINGS, "url": src.get("homepage"), "as_of": None,
           "rows": None, "status": rep.get("status") or "unavailable", "reason": rep.get("reason") or "not run"}
    if res is None:
        row["note"] = None
        return row, None
    com = {z: {k: v.get(k) for k in COM_FIELDS} for z, v in (res.get("data") or {}).items() if v.get("com_listings")}
    row.update(as_of=res.get("as_of"), rows=res.get("rows"), status="ok", reason=None, note=res.get("note"))
    return row, com


def inputs(results, reports):
    """(P, src, rows): the legacy parts by old key, the field_sources map and the v1 manifest rows.
    results: {id: plugin result or None}; reports: {id: runner report} (status and reason of the failures)."""
    P, rows = {}, {}
    for sid in WRAPPED:
        res = results.get(sid)
        rep = reports.get(sid) or {}
        if res is None:
            rows[sid] = {"id": sid, "name": (rep.get("source") or {}).get("name") or sid, "url": None, "as_of": None,
                         "rows": None, "status": rep.get("status") or "unavailable",
                         "reason": rep.get("reason") or "not run"}
            continue
        rows[sid] = dict(res["legacy_row"])
        if sid == "chr_homicides":
            P["crime_map"] = res["legacy"]["map"]
        else:
            P[KEY[sid]] = res["legacy"]
    rows[LISTINGS_ROW], com = listings_part(results.get(LISTINGS), reports.get(LISTINGS) or {})
    if com is not None:
        P["com"] = com
    if P.get("rdc") is None and P.get("rdc_hist"):  # current-month file failed: the history file has the same month
        P["rdc"] = {z: h["latest"] for z, h in P["rdc_hist"].items() if h.get("latest")}
    if not P.get("ipeds_hd"):
        P.pop("ipeds_enroll", None)

    def ok(sid):
        r = rows.get(sid) or {}
        return r if r.get("status") == "ok" else {}

    zbp_cur, zbp_old = ok("census_zbp").get("as_of"), ok("census_zbp_prior").get("as_of")
    chr_row = ok("chr_homicides")
    src = {
        "gaz": {"id": "census_gazetteer", "as_of": ok("census_gazetteer").get("as_of")},
        "county": {"id": "census_zcta_county", "as_of": "2020"},
        "cbsa": {"id": "census_cbsa", "as_of": ok("census_cbsa").get("as_of")},
        "geo": {"id": "geonames_postal", "as_of": ok("geonames_postal").get("as_of")},
        "zhvi": {"id": "zillow_zhvi", "as_of": ok("zillow_zhvi").get("as_of")},
        "zori": {"id": "zillow_zori", "as_of": ok("zillow_zori").get("as_of")},
        "rdc": {"id": "realtor_zip", "as_of": ok("realtor_zip").get("as_of") or ok("realtor_zip_history").get("as_of")},
        "acs": {"id": "census_acs5", "as_of": ok("census_acs5").get("as_of")},
        "safmr": {"id": "hud_safmr", "as_of": ok("hud_safmr").get("as_of")},
        "fhfa": {"id": "fhfa_zip5", "as_of": ok("fhfa_zip5").get("as_of")},
        "zbp": {"id": "census_zbp", "as_of": zbp_cur},
        "zbp_old": {"id": "census_zbp_prior", "as_of": zbp_old},
        "zbp_detail": {"id": "census_zbp_detail", "as_of": zbp_cur},
        "com": {"id": "realestate_feed_commercial", "as_of": ok("realestate_feed_commercial").get("as_of")},
        "ipeds": {"id": "ipeds_hd", "as_of": ok("ipeds_hd").get("as_of")},
        "ipeds_enroll": {"id": "ipeds_enroll", "as_of": ok("ipeds_enroll").get("as_of")},
        "edge": {"id": "nces_edge_schools", "as_of": ok("nces_edge_schools").get("as_of")},
        "chr": {"id": "chr_homicides", "as_of": chr_row.get("as_of"),
                "release": (results.get("chr_homicides") or {}).get("legacy", {}).get("release")},
    }
    return P, src, rows


def mortgage_block(context, fred_report):
    """The v1 `mortgage` block and the v1 `fred_mortgage30` row from the fred_mortgage_rates plugin (US level)."""
    us = (context.get("us") or {}).get("US") or {}
    rate = us.get("mortgage_30y")
    as_of = (fred_report or {}).get("as_of") if rate is not None else None
    ok = rate is not None
    row = {"id": "fred_mortgage30", "name": "FRED MORTGAGE30US, Freddie Mac 30-year fixed rate", "url": FRED_URL,
           "as_of": as_of, "rows": 1 if ok else None, "status": "ok" if ok else "unavailable",
           "reason": None if ok else ((fred_report or {}).get("reason") or "fred_mortgage_rates did not load")}
    block = {"rate_30y": rate, "as_of": as_of, "source": "FRED MORTGAGE30US (Freddie Mac Primary Mortgage Market Survey)"}
    return block, row
