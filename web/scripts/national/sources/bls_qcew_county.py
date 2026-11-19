"""BLS Quarterly Census of Employment and Wages (QCEW), county. Level "county".
Reads the QCEW open-data API in its "industry slice" form (one CSV per industry code with every area for one quarter):
total covered employment (industry 10) and the ten private supersectors. The files already carry the over-the-year
changes, so no second quarter is needed. Employment is the third month of the quarter."""
import csv

from ctx import SourceUnavailable, num

# supersector code -> (short name, label)
SECTORS = {
    "1011": ("natural", "natural resources and mining"),
    "1012": ("construction", "construction"),
    "1013": ("manufacturing", "manufacturing"),
    "1021": ("trade", "trade, transportation and utilities"),
    "1022": ("information", "information"),
    "1023": ("financial", "finance, insurance and real estate"),
    "1024": ("professional", "professional and business services"),
    "1025": ("edu_health", "education and health services"),
    "1026": ("leisure", "leisure and hospitality"),
    "1027": ("other", "other services"),
}

_FIELDS = {
    "qcew_emp": {"label": "Jobs at employers in the county", "unit": "count", "agg": "sum"},
    "qcew_estabs": {"label": "Business establishments", "unit": "count", "agg": "sum"},
    "qcew_avg_wkly_wage": {"label": "Average weekly wage", "unit": "usd", "agg": "pop_weighted_mean", "better": "higher",
                           "xwalk": "assign", "metric": "wages"},
    "qcew_emp_yoy": {"label": "Job growth, year over year", "unit": "pct", "agg": "pop_weighted_mean", "better": "higher",
                     "xwalk": "assign", "metric": "jobs_trend"},
    "qcew_wage_yoy": {"label": "Weekly wage growth, year over year", "unit": "pct", "agg": "pop_weighted_mean",
                      "better": "higher", "xwalk": "assign"},
    "qcew_estabs_yoy": {"label": "Establishment growth, year over year", "unit": "pct", "agg": "pop_weighted_mean",
                        "better": "higher", "xwalk": "assign"},
    "qcew_office_using_share": {"label": "Jobs in office-using sectors (information, finance, professional services)",
                                "unit": "pct", "agg": "pop_weighted_mean", "xwalk": "assign"},
    "qcew_office_emp_yoy": {"label": "Office-sector job change, 1 year (information, finance, professional services)", "unit": "pct",
                            "agg": "pop_weighted_mean", "xwalk": "mean", "better": "higher"},
    "qcew_office_wage_yoy": {"label": "Office-sector weekly wage change, 1 year", "unit": "pct", "agg": "pop_weighted_mean",
                             "xwalk": "mean", "better": "higher"},
    "qcew_industrial_emp_yoy": {"label": "Industrial job change, 1 year (manufacturing, wholesale, transportation)", "unit": "pct",
                                "agg": "pop_weighted_mean", "xwalk": "mean", "better": "higher"},
    "qcew_retail_emp_yoy": {"label": "Retail job change, 1 year", "unit": "pct", "agg": "pop_weighted_mean", "xwalk": "mean",
                            "better": "higher"},
}
for _code, (_short, _label) in SECTORS.items():
    _FIELDS["qcew_%s_share" % _short] = {"label": "Private jobs in %s, share of all jobs" % _label, "unit": "pct",
                                         "agg": "pop_weighted_mean", "xwalk": "assign"}
    _FIELDS["qcew_%s_wage" % _short] = {"label": "Average weekly wage in %s" % _label, "unit": "usd",
                                        "agg": "pop_weighted_mean", "xwalk": "assign"}

SOURCE = {
    "id": "bls_qcew_county",
    "name": "BLS Quarterly Census of Employment and Wages by county",
    "publisher": "US Bureau of Labor Statistics",
    "homepage": "https://www.bls.gov/cew/",
    "level": "county",
    "group": "people",
    "cadence": "quarterly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": _FIELDS,
}

URL = "https://data.bls.gov/cew/data/api/%d/%d/industry/%s.csv"
MIN_COUNTIES = 2500  # about 3,100 counties report total covered employment
NEEDED = ("area_fips", "own_code", "industry_code", "agglvl_code", "year", "qtr", "disclosure_code", "qtrly_estabs",
          "month3_emplvl", "avg_wkly_wage", "oty_qtrly_estabs_pct_chg", "oty_month3_emplvl_pct_chg", "oty_month3_emplvl_chg",
          "oty_avg_wkly_wage_pct_chg")
BLS_UA = {"User-Agent": "pixel-deck-feed (read-only; tanner@meshvault.ai)"}  # BLS asks automated callers to identify themselves
NAICS_SECTORS = {"42": "wholesale trade", "44_45": "retail trade", "48_49": "transportation and warehousing"}


def read_slice(path, agglvl, own):
    """Rows of one industry slice at one aggregation level and ownership, for counties only.
    -> ({fips: {estabs, emp, wage, estabs_yoy, emp_yoy, wage_yoy}}, (year, quarter)). Undisclosed cells are None."""
    out, period = {}, None
    with open(path, newline="", encoding="latin-1") as fh:
        reader = csv.DictReader(fh)
        missing = [c for c in NEEDED if c not in (reader.fieldnames or [])]
        if missing:
            raise SourceUnavailable("QCEW file is missing columns %s" % ", ".join(missing[:4]))
        for row in reader:
            fips = row["area_fips"].strip()
            if row["agglvl_code"] != agglvl or row["own_code"] != own:
                continue
            if len(fips) != 5 or not fips.isdigit() or fips.endswith(("000", "999")):  # states, MSAs ("C1018"), unknown areas
                continue
            period = (int(row["year"]), int(row["qtr"]))
            hidden = row["disclosure_code"].strip() == "N"
            out[fips] = {
                "estabs": None if hidden else num(row["qtrly_estabs"]),
                "emp": None if hidden else num(row["month3_emplvl"]),
                "wage": None if hidden else num(row["avg_wkly_wage"]),
                "estabs_yoy": None if hidden else num(row["oty_qtrly_estabs_pct_chg"]),
                "emp_yoy": None if hidden else num(row["oty_month3_emplvl_pct_chg"]),
                "wage_yoy": None if hidden else num(row["oty_avg_wkly_wage_pct_chg"]),
                "emp_chg": None if hidden else num(row["oty_month3_emplvl_chg"]),
            }
    return out, period


def _int(value):
    return None if value is None else int(value)


def combine(parts):
    """Job and weekly-wage growth over the year for a group of sectors in one county. Needs every sector to be
    disclosed. Wages are weighted by each sector's jobs (third-month employment).
    -> (job change %, wage change %) or (None, None)."""
    if not parts or any(p is None or p["emp"] is None or p["emp_chg"] is None or p["wage"] is None for p in parts):
        return None, None
    emp = sum(p["emp"] for p in parts)
    before = sum(p["emp"] - p["emp_chg"] for p in parts)
    emp_yoy = round((emp / before - 1) * 100, 1) if before > 0 else None
    wage_yoy = None
    if all(p["wage_yoy"] is not None and p["wage_yoy"] > -100 for p in parts) and emp and before > 0:
        now = sum(p["emp"] * p["wage"] for p in parts) / emp
        was = sum((p["emp"] - p["emp_chg"]) * p["wage"] / (1 + p["wage_yoy"] / 100) for p in parts) / before
        wage_yoy = round((now / was - 1) * 100, 1) if was else None
    return emp_yoy, wage_yoy


def parse(paths):
    """{industry code: file path} (needs "10" and the supersector codes) -> (data, rows, (year, quarter))."""
    if "10" not in paths:
        raise SourceUnavailable("QCEW total employment slice was not supplied")
    total, period = read_slice(paths["10"], "70", "0")
    if len(total) < MIN_COUNTIES:
        raise SourceUnavailable("QCEW total slice holds only %d counties (expected about 3,100)" % len(total))
    sectors = {}
    for code in SECTORS:
        if code in paths:
            sectors[code] = read_slice(paths[code], "73", "5")[0]
    naics = {}
    for code in NAICS_SECTORS:
        if code in paths:
            naics[code] = read_slice(paths[code], "74", "5")[0]
    data = {}
    for fips, t in total.items():
        row = dict.fromkeys(SOURCE["fields"])
        row.update(qcew_emp=_int(t["emp"]), qcew_estabs=_int(t["estabs"]), qcew_avg_wkly_wage=t["wage"],
                   qcew_emp_yoy=t["emp_yoy"], qcew_wage_yoy=t["wage_yoy"], qcew_estabs_yoy=t["estabs_yoy"])
        office = []
        for code, (short, _) in SECTORS.items():
            s = (sectors.get(code) or {}).get(fips)
            if not s:
                continue
            if s["emp"] is not None and t["emp"]:
                row["qcew_%s_share" % short] = round(s["emp"] / t["emp"] * 100, 2)
            row["qcew_%s_wage" % short] = s["wage"]
            if short in ("information", "financial", "professional"):
                office.append(row.get("qcew_%s_share" % short))
        if len(office) == 3 and all(v is not None for v in office):
            row["qcew_office_using_share"] = round(sum(office), 2)
        parts = {
            "office": [(sectors.get(c) or {}).get(fips) for c in ("1022", "1023", "1024")],
            "industrial": [(sectors.get(c) or {}).get(fips) for c in ("1013",)] + [(naics.get(c) or {}).get(fips) for c in ("42", "48_49")],
            "retail": [(naics.get(c) or {}).get(fips) for c in ("44_45",)],
        }
        for name, group in parts.items():
            emp_yoy, wage_yoy = combine(group)
            row["qcew_%s_emp_yoy" % name] = emp_yoy
            if name == "office":
                row["qcew_office_wage_yoy"] = wage_yoy
        data[fips] = row
    return data, len(total), period


def load(ctx):
    candidates = [(y, q) for y in (ctx.year, ctx.year - 1) for q in (4, 3, 2, 1)]
    urls = [URL % (y, q, "10") for y, q in candidates]
    url, path10, _ = ctx.first(urls, "ind10.csv", headers=BLS_UA)
    year, qtr = [int(p) for p in url.split("/api/")[1].split("/")[:2]]
    paths = {"10": path10}
    for code in list(SECTORS) + list(NAICS_SECTORS):
        paths[code], _ = ctx.fetch(URL % (year, qtr, code), "%d_%d_ind%s.csv" % (year, qtr, code), headers=BLS_UA)
    data, rows, period = parse(paths)
    return {"as_of": "%d-Q%d" % period, "rows": rows, "data": data,
            "note": "Counties where the BLS withholds a figure to protect employers show it as missing."}
