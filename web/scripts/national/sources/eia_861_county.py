"""EIA-861 annual electric power industry survey: electricity price by county. Level "county".

The EIA-861 zip holds one workbook of sales by utility and state (Sales_Ult_Cust: revenue in thousand dollars and sales in MWh for
residential, commercial and industrial customers) and one of service territories (Service_Territory: utility, state and county NAME,
no FIPS). The price of a utility in a state is revenue / sales on its Bundled rows. A county's price is the mean over the utilities
that serve it, weighted by each utility's sales to that customer class in the state. That is a proxy: EIA publishes no sales per
utility per county. County names are matched to FIPS with the Census county gazetteer.
"""
import io
import re
import unicodedata
import zipfile

import _xlsx
from ctx import SourceUnavailable, num

URL = "https://www.eia.gov/electricity/data/eia861/zip/f861%d.zip"
GAZ_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/%d_Gazetteer/%d_Gaz_counties_national.zip"
MIN_COUNTIES = 1500  # utilities cover about 3,100 counties
MIN_MATCH = 0.9  # share of territory rows that must match a gazetteer county
MIN_GAZETTEER = 3000  # the Census county gazetteer lists about 3,200 counties

SOURCE = {
    "id": "eia_861_county",
    "name": "EIA-861 electricity prices by county",
    "publisher": "US Energy Information Administration",
    "homepage": "https://www.eia.gov/electricity/data/eia861/",
    "level": "county",
    "native": "county",
    "group": "cost",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "eia_com_cents": {"label": "Commercial electricity price (bundled-service customers only)", "unit": "kwh_cents",
                          "agg": "pop_weighted_mean", "metric": "power_cost", "xwalk": "mean", "better": "lower"},
        "eia_ind_cents": {"label": "Industrial electricity price (bundled-service customers only)", "unit": "kwh_cents",
                          "agg": "pop_weighted_mean", "xwalk": "mean", "better": "lower"},
        "eia_res_cents": {"label": "Residential electricity price (bundled-service customers only)", "unit": "kwh_cents",
                          "agg": "pop_weighted_mean", "xwalk": "mean", "better": "lower"},
        "eia_state_com_cents": {"label": "Commercial electricity price, whole state (all service types)", "unit": "kwh_cents",
                                "agg": "pop_weighted_mean", "xwalk": "assign", "better": "lower"},
        "eia_state_ind_cents": {"label": "Industrial electricity price, whole state (all service types)", "unit": "kwh_cents",
                                "agg": "pop_weighted_mean", "xwalk": "assign", "better": "lower"},
        "eia_state_res_cents": {"label": "Residential electricity price, whole state (all service types)", "unit": "kwh_cents",
                                "agg": "pop_weighted_mean", "xwalk": "assign", "better": "lower"},
        "eia_utilities": {"label": "Electric utilities serving the county", "unit": "count", "agg": "none", "xwalk": "assign"},
        "eia_priced_utilities": {"label": "Serving utilities with a bundled price", "unit": "count", "agg": "none",
                                 "xwalk": "assign"},
    },
}
# class -> (field, revenue column index, sales column index) in Sales_Ult_Cust (revenue in thousand dollars, sales in MWh)
CLASSES = {"eia_res_cents": (9, 10), "eia_com_cents": (12, 13), "eia_ind_cents": (15, 16)}
SUFFIX = re.compile(r"\s(city and borough|census area|county|parish|borough|municipality)$")


def norm(name):
    """County name -> comparison key: no accents, punctuation or spaces, 'saint' as 'st', county-type words dropped."""
    text = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    text = re.sub(r"\(.*?\)", "", text).replace("saint ", "st ").replace("st. ", "st ").replace("ste. ", "ste ")
    text = re.sub(r"[^a-z ]", "", text).strip()
    text = SUFFIX.sub("", text).strip()
    return re.sub(r"\s+", "", text)


def read_gazetteer(path):
    """Census county gazetteer zip -> {(USPS, normalized name): FIPS}. A name used twice in a state (a county and an independent
    city of the same name in Virginia) keeps its 'city' tag so the two stay apart."""
    out = {}
    with zipfile.ZipFile(path) as zf:
        with zf.open(zf.namelist()[0]) as raw:
            lines = io.TextIOWrapper(raw, encoding="utf-8", errors="replace")
            first = next(lines).rstrip("\n")
            sep = "|" if "|" in first else "\t"
            head = [h.strip() for h in first.split(sep)]
            i_usps, i_geoid, i_name = head.index("USPS"), head.index("GEOID"), head.index("NAME")
            for line in lines:
                parts = line.rstrip("\n").split(sep)
                if len(parts) <= i_name:
                    continue
                name = parts[i_name].strip()
                key = norm(name)  # an independent city keeps its 'city' word, so Richmond city and Richmond County differ
                out[(parts[i_usps].strip(), key)] = parts[i_geoid].strip().zfill(5)
    if len(out) < MIN_GAZETTEER:
        raise SourceUnavailable("Census county gazetteer had %d counties (expected about 3,200)" % len(out))
    return out


def _find(names, prefix):
    for name in names:
        base = name.rsplit("/", 1)[-1]
        if base.startswith(prefix) and base.lower().endswith(".xlsx"):
            return name
    raise SourceUnavailable("EIA-861 zip has no %s workbook" % prefix)


def parse(path, gazetteer):
    """-> (data, rows, matched share of territory rows). `path` is the EIA-861 zip."""
    try:
        with zipfile.ZipFile(path) as zf:
            names = [n for n in zf.namelist() if "_CS_" not in n]
            sales_rows = list(_xlsx.read_xlsx_rows(io.BytesIO(zf.read(_find(names, "Sales_Ult_Cust_")))))
            terr_rows = list(_xlsx.read_xlsx_rows(io.BytesIO(zf.read(_find(names, "Service_Territory_")))))
    except (zipfile.BadZipFile, KeyError) as exc:
        raise SourceUnavailable("EIA-861 zip could not be read (%s)" % exc)
    # utility price and weight by (utility id, state)
    sums = {}
    for row in sales_rows:
        if len(row) < 17 or (row[4] or "").strip() != "Bundled" or not (row[1] or "").strip().isdigit():
            continue
        key = (row[1].strip(), (row[6] or "").strip())
        acc = sums.setdefault(key, {f: [0.0, 0.0] for f in CLASSES})
        for field, (ir, im) in CLASSES.items():
            rev, mwh = num(row[ir]), num(row[im])
            if rev is not None and mwh:
                acc[field][0] += rev
                acc[field][1] += mwh
    # EIA's own rule for a whole state: revenue over parts A to D divided by sales over parts A, B and D (part C delivery sales
    # repeat the energy sales of part B). Only a state can be priced this way: energy-only and delivery-only rows carry no county.
    state_tot = {}
    for row in sales_rows:
        if len(row) < 17 or not (row[1] or "").strip().isdigit():
            continue
        part = (row[3] or "").strip()
        acc = state_tot.setdefault((row[6] or "").strip(), {f: [0.0, 0.0] for f in CLASSES})
        for field, (ir, im) in CLASSES.items():
            rev, mwh = num(row[ir]), num(row[im])
            if rev is not None:
                acc[field][0] += rev
            if mwh is not None and part in ("A", "B", "D"):
                acc[field][1] += mwh
    if not sums:
        raise SourceUnavailable("EIA-861 sales workbook had no bundled utility rows")
    header = [(c or "").strip() for c in (terr_rows[0] if terr_rows else [])]
    if header[:6] != ["Data Year", "Utility Number", "Utility Name", "Short Form", "State", "County"]:
        raise SourceUnavailable("EIA-861 service territory header changed")
    served = {}  # fips -> set of (utility, state)
    total = matched = 0
    for row in terr_rows[1:]:
        if len(row) < 6 or not (row[1] or "").strip().isdigit():
            continue
        total += 1
        state, county = (row[4] or "").strip(), (row[5] or "").strip()
        fips = gazetteer.get((state, norm(county))) or gazetteer.get((state, norm(county) + "city"))
        if fips:
            matched += 1
            served.setdefault(fips, set()).add((row[1].strip(), state))
    if not total or matched / total < MIN_MATCH:
        raise SourceUnavailable("only %d of %d EIA-861 territory rows matched a county name" % (matched, total))
    data = {}
    for fips, utilities in served.items():
        priced = sum(1 for u in utilities if u in sums and any(v[1] > 0 for v in sums[u].values()))
        out = {"eia_utilities": len(utilities), "eia_priced_utilities": priced}
        for field in CLASSES:
            num_sum = den = 0.0
            for util in utilities:
                rev, mwh = sums.get(util, {}).get(field, (0.0, 0.0))
                if mwh > 0 and rev > 0:
                    num_sum += (rev * 100 / mwh) * mwh  # cents per kWh weighted by MWh
                    den += mwh
            if den:
                out[field] = round(num_sum / den, 2)
        state = next(iter(utilities))[1]
        for field in CLASSES:
            rev, mwh = state_tot.get(state, {}).get(field, (0.0, 0.0))
            if mwh > 0 and rev > 0:
                out[field.replace("eia_", "eia_state_")] = round(rev * 100 / mwh, 2)
        data[fips] = out
    if len(data) < MIN_COUNTIES:
        raise SourceUnavailable("EIA-861 parsed to %d counties (expected about 3,100)" % len(data))
    return data, len(sales_rows) + len(terr_rows), matched / total


def load(ctx):
    years = [ctx.year, ctx.year - 1, ctx.year - 2]  # the newest survey year posted; 2025 data lands in autumn 2026
    path, year = None, None
    for y in years:
        try:
            candidate, _ = ctx.fetch(URL % y, "f861_%d.zip" % y, timeout=180, min_bytes=100000)
        except SourceUnavailable:
            continue
        if zipfile.is_zipfile(candidate):  # a missing year redirects to an HTML page, not a 404
            path, year = candidate, str(y)
            break
    if path is None:
        raise SourceUnavailable("no EIA-861 zip for %s" % ", ".join(str(y) for y in years))
    _, gaz, _ = ctx.first([GAZ_URL % (y, y) for y in years], "gaz_counties.zip", timeout=60, min_bytes=10000)
    data, rows, share = parse(path, read_gazetteer(gaz))
    ctx.log("EIA-861 %s: %d counties, %.1f%% of territory rows matched a county" % (year, len(data), share * 100))
    return {"as_of": year, "rows": rows, "data": data,
            "note": "County price is a sales-weighted mean of the serving utilities' state-level prices, and delivery-only utilities "
                    "(deregulated markets such as Texas) have no bundled price so they are left out of it."}
