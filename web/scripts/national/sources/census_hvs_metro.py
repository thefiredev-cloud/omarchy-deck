"""Census HVS vacancy and homeownership rates for the largest MSAs."""
import _hvs
from ctx import SourceUnavailable

TABLES = (
    ("hvsm_rental_vacancy", "https://www.census.gov/housing/hvs/data/rates/tab4_msa_26_rvr.xlsx"),
    ("hvsm_homeowner_vacancy", "https://www.census.gov/housing/hvs/data/rates/tab5_msa_26_hvr.xlsx"),
    ("hvsm_homeownership", "https://www.census.gov/housing/hvs/data/rates/tab6_msa_26_hmr.xlsx"),
)
SOURCE = {
    "id": "census_hvs_metro", "name": "Census HVS vacancy and homeownership rates for large metros",
    "publisher": "US Census Bureau", "homepage": "https://www.census.gov/housing/hvs/data/rates.html",
    "level": "cbsa", "group": "residential", "cadence": "quarterly",
    "license": "Public domain (US government work)", "key_env": None,
    "fields": {field: {"label": label, "unit": "pct", "agg": "pop_weighted_mean"} for field, label in (
        ("hvsm_rental_vacancy", "Metro rental vacancy rate"), ("hvsm_homeowner_vacancy", "Metro homeowner vacancy rate"),
        ("hvsm_homeownership", "Metro homeownership rate"))},
}


def parse(path, field, cbsa_names):
    by_name, hist, _ = _hvs.parse_table(path, field, "metro", field == "hvsm_rental_vacancy")
    data, unmatched = {}, []
    normalized = {_norm(name): code for name, code in cbsa_names.items()}
    for name, values in by_name.items():
        code = normalized.get(_norm(name))
        if code is None:
            unmatched.append(name)
            continue
        data[code] = values
    return data, unmatched, hist


def load(ctx):
    # Census publishes the current 75-MSA tables as a single latest-year observation.
    # Crosswalk MSA titles to the CBSA names from the Census delineation source passed in this run.
    names = _delineation_names(ctx)
    data, hist, unmatched, dates = {}, {}, [], []
    for field, url in TABLES:
        filename = url.rsplit("/", 1)[-1]
        path, _ = ctx.fetch(url, filename, timeout=60, min_bytes=1000)
        parsed, missing, history = parse(path, field, names)
        for cbsa, values in parsed.items():
            data.setdefault(cbsa, {}).update(values)
        unmatched.extend(missing)
        hist.update(history)
        dates.append(filename.split("_")[2])
    if len(data) < 70:
        raise SourceUnavailable("Census HVS metro tables matched only %d CBSAs; unmatched: %s" % (len(data), ", ".join(unmatched[:8])))
    return {"as_of": "2026", "rows": len(data), "data": data,
            "note": "Census MSA names matched to Census CBSA delineation; unmatched names: %s" % (", ".join(sorted(set(unmatched))) or "none")}


def _delineation_names(ctx):
    import _legacy
    import national_sources
    import sys
    latest = int(__import__("time").strftime("%Y"))
    _, path, _ = ctx.first(
        [_legacy.CBSA % (year, year) for year in range(latest, 2021, -1)],
        "cbsa_list1.xlsx", min_bytes=10000)
    if _legacy._LEGACY not in sys.path:
        sys.path.insert(0, _legacy._LEGACY)
    county_rows, _ = national_sources.parse_cbsa(path)
    names = {}
    for row in county_rows.values():
        if row.get("cbsa") and row.get("metro"):
            names[row["metro"]] = row["cbsa"]
    if not names:
        raise SourceUnavailable("Census CBSA delineation workbook has no MSA names")
    return names


def _norm(value):
    import re
    value = re.sub(r"\b(Metropolitan Statistical Area|Metro Area)\b", "", str(value), flags=re.I)
    return re.sub(r"[^a-z0-9]", "", value.lower())
