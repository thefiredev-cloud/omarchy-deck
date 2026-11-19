"""Output of the national dataset v2 (DataArch section 7).

`house-feeds/national-v2/` (new readers):
  manifest.json      schema 2: every v1 key plus sources[] (publisher, license, side, level, status, coverage ...),
                     fields{} (fields.json catalog with live coverage), metrics{}, scores{}, context, methods
                     (with rollup and area_fallback), segments (segments.json cut to the fields produced) and
                     segments_missing; state and metro rows name their rollup per field in `method` (v2_rollups)
  zips.json          schema 2, columnar: metrics.json `zips_json_cols` (the 48 v1 columns first, v1 order), then
                     area_from ("days_on_market:county,..." where a metric is the county or metro value, else null)
  zip/<3>.json       {schema, generated_at, cols, rows: {zip: [...]}, x: {zip: {m, score_parts, grade_parts,
                     grade_flags, sectors, fmr, acs, h_score_v1}}}; m[name] is {v: null, reason, from} for a metric,
                     source field or derived field the validity table nulled (blend.py)
  hist/<3>.json      {schema, generated_at, fields, zips: {zip: {field: [[period, value]]}}, county: {fips: {...}}}
  hist/{cbsa,state,us}.json   history of metro, state and US level sources
`house-feeds/national/` (compat, schema 1): the legacy records and manifest written by the legacy writer in the same
shape as before, so the old server, current web, cre_deals.py, MCP servers and the house briefing keep reading it. Its
housing score and rental grade are the v2 ones (compat_scores, compat_grades, score_method, the v2 grade_method), so a
ZIP has one score and one grade wherever it is read.

Every file is written atomically (temp file and rename), mode 0600; manifests last.
"""
import json
import os
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (HERE, os.path.join(HERE, "legacy")):
    if _p not in sys.path:
        sys.path.insert(0, _p)
import blend  # noqa: E402
import national_build as B  # noqa: E402

with open(os.path.join(HERE, "fields.json"), encoding="utf8") as _fh:
    FIELDS_DOC = json.load(_fh)
CATALOG = {f["name"]: f for f in FIELDS_DOC["fields"]}
ZIPS_COLS = list(blend.SPEC["zips_json_cols"])

# Which side a source counts toward. Default by group; the planner's sources.json puts these three on the other side.
SIDE_BY_GROUP = {"residential": "residential", "people": "residential", "risk": "residential", "geo": "residential",
                 "cost": "residential", "commercial": "commercial"}
SIDE_OVERRIDES = {"eia_861_county": "commercial", "openei_utility_rates_zip": "commercial", "epa_frs_zip": "commercial"}
# The dataset catalog (datasets.json): which plugins read one published dataset, geography helpers, canonical publishers.
with open(os.path.join(HERE, "datasets.json"), encoding="utf8") as _fh:
    DATASETS_DOC = json.load(_fh)
DATASET_OF = {p: did for did, d in DATASETS_DOC["datasets"].items() for p in d["plugins"]}
NOT_COUNTED = set(DATASETS_DOC["geo"]) | set(DATASETS_DOC["not_counted"])
STATUS_ORDER = ("ok", "stale", "needs_key", "unavailable", "invalid")

# Legacy record fields copied into the v2 store (scores and grades are recomputed in v2; h_score_v1 keeps the old;
# the three v1 listing fields come from the cre_listings_zip plugin merge instead).
LEGACY_SKIP = {"zip", "h_score", "area_score", "area_grade", "area_conf", "field_sources", "score_parts", "hist",
               "sectors", "fmr", "acs", "grade_parts", "grade_flags", "com_listings", "com_median_price",
               "com_median_cap"}
LEGACY_LEVEL = {"homicide_rate": "county", "colleges_5mi": "point", "colleges_10mi": "point",
                "college_enroll_5mi": "point", "college_enroll_10mi": "point", "schools_5mi": "point"}
LEGACY_HIST = ("zhvi", "rent", "list_price", "active")
# Both manifests' score_method describes the scores the ZIPs carry (SeeData D9, 2026-11-15): h is the v2 housing score.
# Compat used to keep the v1 formula, so one ZIP read two scores (92647: 49 on v2, 42.7 in compat). c stays v1.
SCORE_NOTE = ("Percentile rank 0 to 100 among ZIPs with population of at least %d (ACS 5-year). Lower-is-better "
              "components are inverted. Composite is the weighted mean of the available components, re-weighted over "
              "those present. The housing score (h) needs %s; the business score (c) needs at least 3 components. "
              "Null below the population floor. Scores do not depend on the budget.")


def side_of(sid, group, declared=None):
    return declared or SIDE_OVERRIDES.get(sid) or SIDE_BY_GROUP.get(group, "residential")


def dataset_of(sid, src):
    """(dataset id, dataset name, canonical publisher) of one source: its datasets.json entry, else the source itself."""
    did = DATASET_OF.get(sid)
    if did:
        d = DATASETS_DOC["datasets"][did]
        return did, d["name"], d["publisher"]
    pub = (src or {}).get("publisher")
    return sid, (src or {}).get("name"), DATASETS_DOC["publishers"].get(pub, pub)


def used_fields():
    """{residential|commercial: fields that side uses} (Main's counting rule 2026-11-14, datasets.json `used_rule`):
    a member of one of that side's metrics, an input of one of its scores or of the rental grade, or a catalog field
    shown on the ZIP sheet (`shown` has "zip") whose catalog group belongs to that side. A metric, derived field or
    normalizer a used key depends on is used too, down to the source fields (blend.METRIC_INPUTS, NORMALIZE_INPUTS,
    DERIVED)."""
    rule = DATASETS_DOC["used_rule"]
    out = {"residential": set(), "commercial": set()}

    def expand(key, side, seen):
        if key in seen:
            return
        seen.add(key)
        out[side].add(key)
        m = blend.BY_ID.get(key)
        if m:
            for mem in m.get("members") or []:
                for f in [mem["field"]] + list(mem.get("coverage") or []) + \
                        blend.NORMALIZE_INPUTS.get(mem.get("normalize") or "none", []):
                    expand(f, side, seen)
            for f in blend.METRIC_INPUTS.get(key, []):
                expand(f, side, seen)
        elif key in blend.DERIVED:
            for f in blend.DERIVED[key][0]:
                expand(f, side, seen)
        elif key in blend.AREA_RATES:
            for f in blend.AREA_RATES[key]:
                expand(f, side, seen)

    for side in out:
        seen = set()
        for m in blend.METRICS:
            if m["side"] == side:
                expand(m["id"], side, seen)
        for sid, spec in blend.SPEC["scores"].items():
            if rule["score_side"][sid] == side:
                for inp in spec["inputs"]:
                    for k in [inp["key"]] + list(inp.get("or") or []):
                        expand(k, side, seen)
        if rule["score_side"]["rental_grade"] == side:
            for f in blend.SPEC["rental_grade"]["factors"]:
                expand(f["key"], side, seen)
        for name, f in CATALOG.items():
            if "zip" in (f.get("shown") or []) and rule["sheet_side_by_group"].get(f.get("group")) == side:
                expand(name, side, seen)
    return out


def mark_used(rows):
    """Each source row gains `used_on`: the sides that use at least one of its fields."""
    used = used_fields()
    for r in rows:
        r["used_on"] = [s for s in ("residential", "commercial") if used[s] & set(r.get("fields") or [])]
    return rows


def source_counts(rows):
    """{residential|commercial|total: {status: {plugins, datasets, publishers}, used: {datasets, publishers},
    collected_not_used: [dataset]}} over the counted source rows. A plugin counts under its own status; a dataset
    under the best status of its plugins in that scope; a publisher under the best status of its datasets in that
    scope. A dataset with plugins on both sides counts on both. `used` counts datasets that loaded (ok or stale) and
    that the side uses (row `used_on`, see mark_used), whichever side their plugins sit on; `collected_not_used`
    lists loaded datasets with a plugin on that side that the side does not use. The owner number is used.datasets."""
    rank = {s: k for k, s in enumerate(STATUS_ORDER)}
    out = {}
    for scope in ("residential", "commercial", "total"):
        counted = [r for r in rows if r["counts"]]
        mine = [r for r in counted if scope == "total" or r["side"] == scope]
        best_ds, best_pub = {}, {}
        block = {s: {"plugins": 0, "datasets": 0, "publishers": 0} for s in STATUS_ORDER}
        for r in mine:
            st = r["status"] if r["status"] in rank else "unavailable"
            block[st]["plugins"] += 1
            best_ds[r["dataset"]] = min(best_ds.get(r["dataset"], 99), rank[st])
            best_pub[r["publisher_canon"]] = min(best_pub.get(r["publisher_canon"], 99), rank[st])
        for k in best_ds.values():
            block[STATUS_ORDER[k]]["datasets"] += 1
        for k in best_pub.values():
            block[STATUS_ORDER[k]]["publishers"] += 1
        loaded = [r for r in counted if r["status"] in ("ok", "stale")]
        used = [r for r in loaded if (r.get("used_on") if scope == "total" else scope in (r.get("used_on") or []))]
        used_ds = {r["dataset"] for r in used}
        block["used"] = {"datasets": len(used_ds), "publishers": len({r["publisher_canon"] for r in used})}
        block["collected_not_used"] = sorted({r["dataset"] for r in loaded if r in mine} - used_ds)
        out[scope] = block
    out["rule"] = DATASETS_DOC["rule"]
    out["used_rule"] = DATASETS_DOC["used_rule"]["text"]
    return out


def load_legacy(store, records, land, reports):
    """Copy the legacy records' scalar fields and the explicit parts (rent_zori, safmr_2br, acs_gross_rent,
    acs_housing_units, land_sqmi, h_score_v1) into the store, with meta from the wrapped legacy sources."""
    asof = {r["id"]: r.get("as_of") for r, _ in reports}
    src_of = {}
    for name, f in CATALOG.items():
        if f.get("legacy") and f.get("sources"):
            src_of[name] = f["sources"][0]
    for z, rec in records.items():
        i = store.ix[z]
        for k, v in rec.items():
            if k in LEGACY_SKIP or isinstance(v, (dict, list)):
                continue
            store.put(k, i, v)
        if rec.get("rent_src") == "zori":
            store.put("rent_zori", i, rec.get("rent"))
        store.put("safmr_2br", i, (rec.get("fmr") or {}).get("br2"))
        store.put("acs_gross_rent", i, (rec.get("acs") or {}).get("median_gross_rent"))
        store.put("acs_housing_units", i, (rec.get("acs") or {}).get("housing_units"))
        store.put("h_score_v1", i, rec.get("h_score"))
        store.put("land_sqmi", i, land.get(z))
    for f in store.fields():
        if f in store.meta:
            continue
        sid = src_of.get(f) or {"rent_zori": "zillow_zori", "safmr_2br": "hud_safmr", "acs_gross_rent": "census_acs5",
                                "acs_housing_units": "census_acs5", "land_sqmi": "census_gazetteer"}.get(f, "legacy")
        store.meta[f] = {"source": sid, "level": "county" if f in LEGACY_LEVEL and LEGACY_LEVEL[f] == "county" else "zip",
                         "native": LEGACY_LEVEL.get(f, "zip"), "unit": (CATALOG.get(f) or {}).get("unit"),
                         "agg": (CATALOG.get(f) or {}).get("agg", "none"), "as_of": asof.get(sid), "legacy": True}


def context_down(store, context):
    """Copy metro, state and US values to every ZIP (for the blend only; marked context, never a ZIP column)."""
    cb, st = store.obj.get("cbsa") or [None] * store.n, store.obj.get("state") or [None] * store.n
    for level, keys in (("us", None), ("state", st), ("cbsa", cb)):
        for geo, row in (context.get(level) or {}).items():
            for f, v in row.items():
                meta = store.meta.get(f)
                if meta is None:
                    continue
                meta["context"] = True
                if level == "us":
                    for i in range(store.n):
                        store.put(f, i, v)
                else:
                    for i, g in enumerate(keys):
                        if g == geo:
                            store.put(f, i, v)


# ---------------------------------------------------------------- manifest v2 parts

def source_rows(store, reports, owner):
    """manifest.sources: one row per source (wrapped legacy and plugins)."""
    fields_by = {}
    for f, meta in store.meta.items():
        if meta.get("source") not in ("derived", "blend", "score", "legacy"):
            fields_by.setdefault(meta["source"], []).append(f)
    rows = []
    for rep, _ in reports:
        src = rep.get("source") or {}
        sid, group = rep["id"], src.get("group")
        mine = sorted(set(fields_by.get(sid, [])) | {f for f, o in owner.items() if o == sid})
        legacy_row = rep.get("legacy_row") or {}
        cover = None
        if rep.get("status") in ("ok", "stale"):
            ix = set()
            for f in mine:
                if not (store.meta.get(f) or {}).get("context"):
                    ix.update(i for i, _ in store.values(f))
            cover = len(ix)
        did, dname, pub = dataset_of(sid, src)
        rows.append({"id": sid, "name": src.get("name"), "publisher": src.get("publisher"),
                     "homepage": src.get("homepage"), "url": legacy_row.get("url") or src.get("homepage"),
                     "license": src.get("license"), "level": src.get("level"), "native": src.get("native"),
                     "group": group, "side": side_of(sid, group, src.get("side")), "cadence": src.get("cadence"),
                     "kind": "legacy" if src.get("legacy") else "plugin", "counts": sid not in NOT_COUNTED,
                     "dataset": did, "dataset_name": dname, "publisher_canon": pub,
                     "status": rep.get("status"), "reason": rep.get("reason"), "key_env": rep.get("key_env"),
                     "as_of": rep.get("as_of"), "rows": rep.get("rows"), "geos": rep.get("geos"), "coverage": cover,
                     "fields": mine, "dropped_fields": rep.get("dropped_fields") or None, "xwalk": rep.get("xwalk"),
                     "seconds": rep.get("seconds"), "reused": rep.get("reused"), "note": rep.get("note")})
    return rows


def field_catalog(store, reports):
    """fields.json catalog with live coverage and as_of, plus fields a plugin emits that the catalog lacks."""
    asof = {r["id"]: r.get("as_of") for r, _ in reports}
    spec_of = {}
    for rep, _ in reports:
        for f, spec in ((rep.get("source") or {}).get("fields") or {}).items():
            spec_of.setdefault(f, (rep["id"], spec))
    out = {}
    for name, f in CATALOG.items():
        row = {k: f.get(k) for k in ("label", "unit", "group", "kind", "agg", "better", "shown", "rankable", "in_zips",
                                      "metric", "level", "native", "formula", "note")}
        row["sources"] = [{"id": s, "as_of": asof.get(s)} for s in f.get("sources") or []]
        meta = store.meta.get(name) or {}
        row["in_zips"] = name in ZIPS_COLS
        row["zips"] = None if meta.get("context") else (store.count(name) if store.has(name) else 0)
        out[name] = row
    for name, meta in store.meta.items():
        if name in out:
            continue
        sid, spec = spec_of.get(name, (meta.get("source"), {}))
        out[name] = {"label": spec.get("label") or name, "unit": spec.get("unit") or meta.get("unit"), "group": None,
                     "kind": "source" if sid in asof else meta.get("source"), "agg": spec.get("agg", "none"),
                     "better": spec.get("better"), "shown": ["data"], "rankable": False, "in_zips": name in ZIPS_COLS,
                     "metric": spec.get("metric"), "level": meta.get("level"), "native": meta.get("native"),
                     "sources": [{"id": sid, "as_of": asof.get(sid)}], "in_catalog": False,
                     "zips": None if meta.get("context") else store.count(name)}
    return out


def members_without_source(store):
    """Metric members no loaded source produces (DataArch: missing, never a failure)."""
    out = {}
    for m in blend.METRICS:
        miss = [mem["field"] for mem in m.get("members") or [] if not store.has(mem["field"])]
        if miss:
            out[m["id"]] = miss
    return out


SEGMENTS_PATH = os.path.join(HERE, "segments.json")


def segments_block(catalog, path=SEGMENTS_PATH):
    """(manifest.segments, manifest.segments_missing) from segments.json: the spec object with every segment's fields
    cut to the ids this build produced (a catalog field with ZIP values, or a metro, state or US field, zips None);
    `lead` stays when produced, else the segment's first remaining field. segments_missing is {segment id: [field ids
    dropped]}. (None, None) when the spec file is missing or unreadable."""
    try:
        with open(path, encoding="utf8") as fh:
            spec = json.load(fh)
    except (OSError, ValueError):
        return None, None
    made = {f for f, row in catalog.items() if row.get("zips") is None or row.get("zips")}
    segs, missing = [], {}
    for seg in spec.get("segments") or []:
        keep = [f for f in seg.get("fields") or [] if f in made]
        drop = [f for f in seg.get("fields") or [] if f not in made]
        if drop:
            missing[seg["id"]] = drop
        lead = seg.get("lead") if seg.get("lead") in made else (keep[0] if keep else None)
        segs.append(dict(seg, fields=keep, lead=lead))
    return dict(spec, segments=segs), missing


def _agg(store, idx, field, how, pop):
    vals = [(store.get(field, i), pop[i]) for i in idx]
    vals = [(v, w) for v, w in vals if isinstance(v, (int, float)) and not isinstance(v, bool)]
    if not vals:
        return None
    if how == "sum":
        return round(sum(v for v, _ in vals), 2)
    pairs = [(v, w) for v, w in vals if w]
    if not pairs:
        return None
    if how == "pop_weighted_median":
        v = B.weighted_median(pairs)
        return round(v, 2) if isinstance(v, float) else v
    if how == "pop_weighted_mean":
        tw = sum(w for _, w in pairs)
        return round(sum(v * w for v, w in pairs) / tw, 2)
    return None


def _agg_conf(store, idx, field, how, pop):
    """(conf, n) of a rolled-up metric or score (Main 2026-11-14): conf = median of the ZIP confidences of `field`
    over the ZIPs that entered the rollup (a value, and population for the weighted rollups), n = how many entered.
    conf is None when none of them has a confidence, never 1. A score's ZIP confidence is its conf_field column."""
    entered = [i for i in idx if isinstance(store.get(field, i), (int, float))
               and not isinstance(store.get(field, i), bool) and (how == "sum" or pop[i])]
    cf = SCORE_CONF.get(field) or field + "_conf"
    confs = [c for c in (store.get(cf, i) for i in entered) if c is not None]
    return (round(statistics.median(confs), 2) if confs else None), len(entered)


# Rollup of a field kept at its publisher's county or tract (run.merge keeps those values in store.areas): each county
# or tract counts once. A county value copied or averaged down to every ZIP of the county and then summed over ZIPs
# counted it once per ZIP (live 2026-11-16: California GDP read $729 trillion).
AREA_METHOD = {("county", "sum"): "sum_counties", ("tract", "sum"): "sum_tracts",
               ("county", "pop_weighted_mean"): "county_pop_weighted_mean",
               ("county", "pop_weighted_median"): "county_pop_weighted_median"}
SCORE_CONF = {k: v.get("conf_field") for k, v in blend.SPEC["scores"].items() if v.get("conf_field")}


def area_maps(store, pop):
    """({county: population}, {county: metro cbsa}) from the ZIP table: a county's population is the sum over the ZIPs
    whose county_fips it is; its metro is the population-weighted plurality of those ZIPs' metro (a CBSA is built from
    whole counties, so they agree outside crosswalk noise). A county's state is its FIPS prefix (area_state)."""
    fips = store.obj.get("county_fips") or [None] * store.n
    cb, kind = store.obj.get("cbsa") or [None] * store.n, store.obj.get("cbsa_kind") or [None] * store.n
    cpop, votes = {}, {}
    for i in range(store.n):
        c = fips[i]
        if not c:
            continue
        w = pop[i] or 0
        cpop[c] = cpop.get(c, 0) + w
        if cb[i] and kind[i] == "metro":
            v = votes.setdefault(c, {})
            v[cb[i]] = v.get(cb[i], 0) + w + 1e-9
    return cpop, {c: max(v.items(), key=lambda kv: (kv[1], kv[0]))[0] for c, v in votes.items()}


def area_state(geo):
    st = B.STATES.get(str(geo)[:2])
    return st[0] if st else None


def _area_rollup(field, area, how, cpop, metro_of):
    """{("us", "US") | ("state", st) | ("cbsa", cbsa): value} of one area field: the sum of distinct county (tract)
    values, or their mean or median weighted by county population. Values the validity table's range rules reject
    are left out (the same rules the ZIP values passed)."""
    rules = [c for c in blend.VALIDITY.get(field) or []
             if not set(c) & {"min_listings", "max_ratio_to", "if_pop_at_least", "if_pop_below"}]
    buckets = {}
    for geo, v in area["values"].items():
        if rules and blend.invalid(rules, v, None, None):
            continue
        county = str(geo)[:5]
        st = area_state(county)
        if st not in B.STATES_51:
            continue
        w = cpop.get(county, 0)
        keys = [("us", "US"), ("state", st)] + ([("cbsa", metro_of[county])] if county in metro_of else [])
        for k in keys:
            buckets.setdefault(k, []).append((v, w))
    out = {}
    for k, vals in buckets.items():
        if how == "sum":
            out[k] = round(sum(v for v, _ in vals), 2)
            continue
        pairs = [(v, w) for v, w in vals if w]
        if not pairs:
            continue
        if how == "pop_weighted_median":
            v = B.weighted_median(pairs)
            out[k] = round(v, 2) if isinstance(v, float) else v
        else:
            out[k] = round(sum(v * w for v, w in pairs) / sum(w for _, w in pairs), 2)
    return out


def v2_rollups(store, us, states, metros, context):
    """Add plugin fields, derived fields, metrics and v2 scores to the v1 rollups; metro, state and US publisher values
    (context) are written as published. metrics.json `rollup_rules`:
      * a field its source publishes by county (or by tract with agg sum, copied or averaged down) rolls up over the
        distinct counties (tracts) of the row: sum_counties, sum_tracts, county_pop_weighted_mean or _median;
      * a metric rolls up by its `rollup` (sum for counts such as inventory, population and jobs; else
        pop_weighted_median); a ZIP whose value is an area fallback (blend.area_fallback) never enters;
      * a score rolls up as the population-weighted median of its ZIPs;
      * every other field rolls up over ZIPs by its agg.
    Each rolled-up metric and score gets `<id>_conf` and `<id>_n` beside it (_agg_conf). The defaults per level and agg
    are listed once (metrics.json rollup_rules.default, manifest methods.rollup); a row's `method` map names only a
    field rolled up another way (an area field whose row had no reporting county and fell back to its ZIPs)."""
    pop = [store.get("pop", i) for i in range(store.n)]
    legacy_keys = set(us)
    fields = {f: meta.get("agg") for f, meta in store.meta.items()
              if not meta.get("context") and not meta.get("legacy") and f not in legacy_keys
              and meta.get("agg") in ("sum", "pop_weighted_mean", "pop_weighted_median")}
    for f in fields:
        if (store.meta.get(f) or {}).get("source") == "blend":
            fields[f] = "sum" if (blend.BY_ID.get(f) or {}).get("rollup") == "sum" else "pop_weighted_median"
    rated = {f for f in fields if (store.meta.get(f) or {}).get("source") in ("blend", "score")}
    skip = {f: set((store.meta.get(f) or {}).get("fallback") or ()) for f in rated}
    areas = getattr(store, "areas", None) or {}
    area_method = {f: AREA_METHOD[(areas[f]["level"], how)] for f, how in fields.items()
                   if f in areas and (areas[f]["level"], how) in AREA_METHOD}
    by_area = {}
    if area_method:
        cpop, metro_of = area_maps(store, pop)
        by_area = {f: _area_rollup(f, areas[f], fields[f], cpop, metro_of) for f in area_method}
    st_col, cb_col, kind_col = store.obj.get("state") or [], store.obj.get("cbsa") or [], store.obj.get("cbsa_kind") or []
    by_state, by_metro, allx = {}, {}, []
    for i in range(store.n):
        s = st_col[i] if st_col else None
        if s in B.STATES_51:
            allx.append(i)
            by_state.setdefault(s, []).append(i)
            if cb_col and cb_col[i] and kind_col and kind_col[i] == "metro":
                by_metro.setdefault(cb_col[i], []).append(i)

    def fill(row, idx, key):
        method = row.setdefault("method", {})
        for f, how in fields.items():
            if f in by_area:
                row[f] = by_area[f].get(key)
                if row[f] is not None:
                    continue
                # no county of the row reported (Connecticut's planning regions match no ZIP county): ZIPs serve
                # where their values are apportioned shares or a weighted mean, never a sum of copied values
                if how == "sum" and store.meta[f].get("xwalk") != "sum":
                    continue
            use = [i for i in idx if i not in skip[f]] if skip.get(f) else idx
            row[f] = _agg(store, use, f, how, pop)
            if f in rated:
                row[f + "_conf"], row[f + "_n"] = _agg_conf(store, use, f, how, pop)
            if row[f] is not None and f in by_area:
                method[f] = how
    fill(us, allx, ("us", "US"))
    for row in states:
        fill(row, by_state.get(row["state"], []), ("state", row["state"]))
        row.update(context.get("state", {}).get(row["state"], {}))
    for row in metros:
        fill(row, by_metro.get(row["cbsa"], []), ("cbsa", row["cbsa"]))
        row.update(context.get("cbsa", {}).get(row["cbsa"], {}))
    us.update(context.get("us", {}).get("US", {}))


# ---------------------------------------------------------------- files

def _cell(v):
    if isinstance(v, float) and v.is_integer() and abs(v) < 1e15:
        return int(v)
    return v


def shard_cols(store):
    """ZIP columns of the v2 shards: zips.json columns first, then every other non-context field in catalog order."""
    have = {f for f in store.fields() if not (store.meta.get(f) or {}).get("context")}
    cols = ["zip"] + [c for c in ZIPS_COLS if c != "zip" and c in have]
    rest = [f for f in CATALOG if f in have and f not in cols]
    extra = sorted(f for f in have if f not in cols and f not in rest)
    return cols + rest + extra


# zips.json's text column of area values: "days_on_market:county,price_cuts:metro" where blend.area_fallback filled a
# headline metric from the ZIP's county or metro (the shard's m[metric].from). /api/housing/rank turns it into a row's
# `from` marks, so a Best ZIPs cell says "county value" instead of passing as the ZIP's own figure.
AREA_FROM = "area_from"


def area_from(blender, i):
    """The area_from cell of ZIP index i, or None when every metric is the ZIP's own."""
    marks = ["%s:%s" % (mid, fb[i]["from"]) for mid, fb in sorted(blender.fallback.items())
             if i in fb and fb[i].get("from") in ("county", "metro")]
    return ",".join(marks) or None


def write_v2(out_dir, store, records, blender, scorer, manifest, hist, gen):
    """Shards, hist shards, zips.json, then manifest.json last. Returns {shards, hist_shards, bytes}."""
    os.makedirs(out_dir, mode=0o700, exist_ok=True)
    os.chmod(out_dir, 0o700)
    cols = shard_cols(store)
    metric_ids = [m["id"] for m in blend.METRICS if m["blend"] != "context"]
    groups = {}
    for i, z in enumerate(store.zips):
        groups.setdefault(z[:3], []).append(i)
    zip_hist = {f: h for f, h in hist.items() if h["level"] in ("zip", "tract")}
    county_hist = {f: h for f, h in hist.items() if h["level"] == "county"}
    nbytes = 0
    for prefix, idx in sorted(groups.items()):
        rows, x = {}, {}
        hz, hc = {}, {}
        for i in idx:
            z = store.zips[i]
            rows[z] = [_cell(store.get(c, i)) if c != "zip" else z for c in cols]
            rec = records.get(z) or {}
            m = {}
            for mid in metric_ids:
                got = blender.parts(mid, i) if store.get(mid, i) is not None else blender.nulled_at(mid, i)
                if got:
                    m[mid] = got
            for name in blender.why:  # nulled source and derived fields carry their reason in m too
                if name not in m:
                    got = blender.nulled_at(name, i)
                    if got:
                        m[name] = got
            sp = {"h": scorer.one("h_score", i)[2], "c": (rec.get("score_parts") or {}).get("c") or {}}
            for sid in ("retail_score", "office_score", "industrial_score", "multifamily_score"):
                sp[sid.replace("_score", "")] = scorer.one(sid, i)[2]
            _, _, _, gparts, gflags = scorer.grade_one(i)
            x[z] = {"m": m, "score_parts": sp, "grade_parts": gparts, "grade_flags": gflags,
                    "sectors": rec.get("sectors") or [], "fmr": rec.get("fmr"), "acs": rec.get("acs"),
                    "h_score_v1": rec.get("h_score")}
            zh = {k: v for k, v in (rec.get("hist") or {}).items() if k in LEGACY_HIST and v}
            for f, h in zip_hist.items():
                got = h["geo"].get(z)
                if got:
                    zh[f] = [[p, _cell(v)] for p, v in zip(got[0], got[1])]
            if zh:
                hz[z] = zh
            fips = store.get("county_fips", i)
            if fips and county_hist and fips not in hc:
                ch = {}
                for f, h in county_hist.items():
                    got = h["geo"].get(fips)
                    if got:
                        ch[f] = [[p, _cell(v)] for p, v in zip(got[0], got[1])]
                if ch:
                    hc[fips] = ch
        doc = {"schema": 2, "generated_at": gen, "cols": cols, "rows": rows, "x": x}
        p = os.path.join(out_dir, "zip", prefix + ".json")
        B._atomic_json(p, doc)
        nbytes += os.path.getsize(p)
        hdoc = {"schema": 2, "generated_at": gen, "fields": sorted({f for v in hz.values() for f in v}
                                                                     | {f for v in hc.values() for f in v}),
                "zips": hz, "county": hc}
        p = os.path.join(out_dir, "hist", prefix + ".json")
        B._atomic_json(p, hdoc)
        nbytes += os.path.getsize(p)
    for level in ("cbsa", "state", "us"):
        lv = {f: h for f, h in hist.items() if h["level"] == level}
        doc = {"schema": 2, "generated_at": gen, "fields": sorted(lv), level: {}}
        for f, h in lv.items():
            for geo, (per, vals) in h["geo"].items():
                doc[level].setdefault(geo, {})[f] = [[p, _cell(v)] for p, v in zip(per, vals)]
        p = os.path.join(out_dir, "hist", level + ".json")
        B._atomic_json(p, doc)
        nbytes += os.path.getsize(p)
    for d in ("zip", "hist"):
        os.chmod(os.path.join(out_dir, d), 0o700)
    zcols = ZIPS_COLS + [AREA_FROM]
    zrows = [[_cell(store.get(c, i)) if c != "zip" else z for c in ZIPS_COLS] + [area_from(blender, i)]
             for i, z in enumerate(store.zips)]
    p = os.path.join(out_dir, "zips.json")
    B._atomic_json(p, {"schema": 2, "generated_at": gen, "cols": zcols, "rows": zrows})
    nbytes += os.path.getsize(p)
    if "segments" not in manifest:
        segs, missing = segments_block(manifest.get("fields") or {})
        if segs is not None:
            manifest["segments"], manifest["segments_missing"] = segs, missing
    if isinstance(manifest.get("methods"), dict):
        manifest["methods"].setdefault("rollup", blend.SPEC["rollup_rules"])
        manifest["methods"].setdefault("area_fallback", blend.SPEC["blend"]["area_fallback"])
    p = os.path.join(out_dir, "manifest.json")
    B._atomic_json(p, manifest)
    nbytes += os.path.getsize(p)
    return {"shards": len(groups), "hist_shards": len(groups) + 3, "bytes": nbytes}


def write_compat(out_dir, records, manifest_v1):
    """house-feeds/national/ in the legacy collector's shape (records after compat_scores)."""
    return B.write_outputs(records, manifest_v1, out_dir)


def score_method(counts_v1, h_scored):
    """manifest score_method (both manifests) for the scores the ZIPs carry: h lists the v2 housing score's inputs and
    weights (metrics.json) and its scored count, c the v1 business score."""
    spec = blend.SPEC["scores"]["h_score"]
    h = [{"key": x["key"], "label": (blend.BY_ID.get(x["key"]) or {}).get("label", x["key"]), "weight": x["weight"],
          "direction": x["direction"]} for x in spec["inputs"]]
    return {"h": h, "c": B.SCORE_METHOD["c"], "min_pop": B.SCORE_MIN_POP,
            "note": SCORE_NOTE % (B.SCORE_MIN_POP, spec["min_inputs"]), "scored": dict(counts_v1, h=h_scored)}


def compat_scores(records, store, scorer):
    """Give the compat records the v2 housing score and its parts (h_score, score_parts.h). Run after write_v2, which
    keeps each record's old score as x.h_score_v1."""
    for i, z in enumerate(store.zips):
        rec = records.get(z)
        if rec is not None:
            v, _, parts = scorer.one("h_score", i)
            rec["h_score"] = v
            rec.setdefault("score_parts", {})["h"] = parts


def compat_grades(records, store, scorer):
    """Give the compat records the v2 rental grade (area_score, area_grade, area_conf, grade_parts, grade_flags), the
    twin of compat_scores: the compat tree used to keep the v1 grade, so 7,310 ZIPs read two grades. area_conf takes the
    v2 meaning, (coverage - 0.5) / 0.5, which the v2 grade_method note states."""
    for i, z in enumerate(store.zips):
        rec = records.get(z)
        if rec is not None:
            score, g, conf, parts, flags = scorer.grade_one(i)
            rec["area_score"], rec["area_grade"], rec["area_conf"] = score, g, conf
            rec["grade_parts"], rec["grade_flags"] = parts, flags


def compat_follows(records, store, blender):
    """Null in the compat records the legacy fields v2 nulled through validity `follows` (11930's rent_to_income read
    1,010.1% beside "seasonal rentals" in grade_parts). The reason stays in v2's m and in grade_parts. Returns
    {field: records nulled}."""
    out = {}
    for name in blend.FOLLOWS:
        n = 0
        for i in blender.why.get(name, {}):
            rec = records.get(store.zips[i])
            if rec is not None and rec.get(name) is not None:
                rec[name] = None
                n += 1
        out[name] = n
    return out


def median_or_none(vals):
    vals = [v for v in vals if v is not None]
    return round(statistics.median(vals), 2) if vals else None
