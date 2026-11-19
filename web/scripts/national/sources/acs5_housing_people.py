"""ACS 5-year table-based summary files at ZCTA: property tax, home value, stock mix, age of stock, rent burden,
vacancy by reason, education, poverty, employment, commute, mortgage, internet and mobility. Level "zip".

Reads the same `acsdt5y<year>-<table>.dat` files as the legacy loader (pipe-delimited, every summary level, ZCTA rows
start with 860Z200US) and keeps only the ZCTA rows. Every field is a plain count, median or a share derived from the
published counts; nothing is estimated."""
from ctx import SourceUnavailable, num, zfill_zip

SOURCE = {
    "id": "acs5_housing_people",
    "name": "American Community Survey 5-year: housing costs, housing stock and residents",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/programs-surveys/acs/data/data-via-ftp.html",
    "level": "zip",
    "group": "people",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "acs_value_median": {"label": "Median home value (survey)", "unit": "usd", "agg": "pop_weighted_median", "better": "higher",
                             "metric": "home_value"},
        "acs_re_tax_median": {"label": "Median real estate taxes paid", "unit": "usd", "agg": "pop_weighted_median"},
        "acs_tax_rate_eff": {"label": "Effective property tax rate", "unit": "pct", "agg": "pop_weighted_mean", "better": "lower",
                             "metric": "property_tax_rate"},
        "acs_units_sfr_share": {"label": "Homes in single-family structures", "unit": "pct", "agg": "pop_weighted_mean"},
        "acs_units_2_4_share": {"label": "Homes in 2 to 4 unit buildings", "unit": "pct", "agg": "pop_weighted_mean"},
        "acs_units_5plus_share": {"label": "Homes in buildings with 5 or more units", "unit": "pct", "agg": "pop_weighted_mean"},
        "acs_units_mobile_share": {"label": "Mobile homes", "unit": "pct", "agg": "pop_weighted_mean"},
        "acs_built_pre1980_share": {"label": "Homes built before 1980", "unit": "pct", "agg": "pop_weighted_mean"},
        "acs_built_since2010_share": {"label": "Homes built since 2010", "unit": "pct", "agg": "pop_weighted_mean"},
        "acs_rent_burden_30_share": {"label": "Renters paying 30% or more of income on rent", "unit": "pct",
                                     "agg": "pop_weighted_mean", "better": "lower"},
        "acs_rent_burden_50_share": {"label": "Renters paying 50% or more of income on rent", "unit": "pct",
                                     "agg": "pop_weighted_mean", "better": "lower"},
        "acs_rent_pct_income": {"label": "Median rent as share of income", "unit": "pct", "agg": "pop_weighted_median", "better": "lower"},
        "acs_owner_cost_pct_income": {"label": "Median owner costs as share of income", "unit": "pct",
                                      "agg": "pop_weighted_median", "better": "lower"},
        "acs_mortgage_share": {"label": "Owners with a mortgage", "unit": "pct", "agg": "pop_weighted_mean"},
        "acs_vacancy_ex_seasonal": {"label": "Vacant homes, excluding seasonal", "unit": "pct", "agg": "pop_weighted_mean",
                                    "better": "lower"},
        "acs_seasonal_share": {"label": "Homes held for seasonal or occasional use", "unit": "pct", "agg": "pop_weighted_mean"},
        "acs_vacant_for_rent_share": {"label": "Homes vacant and for rent", "unit": "pct", "agg": "pop_weighted_mean"},
        "acs_bachelor_plus": {"label": "Adults 25 and over with a bachelor's degree or more", "unit": "pct",
                              "agg": "pop_weighted_mean", "better": "higher"},
        "acs_poverty_rate": {"label": "People below the poverty line", "unit": "pct", "agg": "pop_weighted_mean", "better": "lower"},
        "acs_unemployment_rate": {"label": "Unemployment rate (survey)", "unit": "pct", "agg": "pop_weighted_mean", "better": "lower",
                                  "metric": "unemployment"},
        "acs_wfh_share": {"label": "Workers who work from home", "unit": "pct", "agg": "pop_weighted_mean"},
        "acs_transit_share": {"label": "Workers who commute by public transit", "unit": "pct", "agg": "pop_weighted_mean"},
        "acs_commute_45plus_share": {"label": "Commuters with 45 minutes or more each way", "unit": "pct",
                                     "agg": "pop_weighted_mean", "better": "lower"},
        "acs_broadband_share": {"label": "Households with broadband", "unit": "pct", "agg": "pop_weighted_mean", "better": "higher",
                                "metric": "broadband"},
        "acs_moved_1y_share": {"label": "Residents who moved in during the last year", "unit": "pct", "agg": "pop_weighted_mean"},
        "acs_moved_from_state_share": {"label": "Residents who moved from another state in the last year", "unit": "pct",
                                      "agg": "pop_weighted_mean"},
    },
}

BASE = "https://www2.census.gov/programs-surveys/acs/summary_file/%d/table-based-SF/data/5YRData/acsdt5y%d-%s.dat"
ZCTA_PREFIX = "860Z200US"
MIN_ZCTAS = 20000  # the national file has about 33,800; far fewer means a broken download

# table -> estimate columns needed (E-number -> short name)
TABLES = {
    "b25077": {"E001": "value"},
    "b25103": {"E001": "tax"},
    "b25024": {"E001": "u_all", "E002": "u_1d", "E003": "u_1a", "E004": "u_2", "E005": "u_34", "E006": "u_59",
               "E007": "u_1019", "E008": "u_2049", "E009": "u_50", "E010": "u_mobile"},
    "b25034": {"E001": "y_all", "E002": "y_2020", "E003": "y_2010", "E007": "y_1970", "E008": "y_1960", "E009": "y_1950",
               "E010": "y_1940", "E011": "y_1939"},
    "b25070": {"E001": "rb_all", "E007": "rb_30", "E008": "rb_35", "E009": "rb_40", "E010": "rb_50", "E011": "rb_nc"},
    "b25071": {"E001": "rent_pct"},
    "b25092": {"E001": "own_pct"},
    "b25081": {"E001": "mt_all", "E002": "mt_with"},
    "b25004": {"E001": "v_all", "E002": "v_rent", "E006": "v_season"},
    "b15003": {"E001": "ed_all", "E022": "ed_ba", "E023": "ed_ma", "E024": "ed_prof", "E025": "ed_phd"},
    "b17001": {"E001": "pv_all", "E002": "pv_below"},
    "b23025": {"E003": "lf_civ", "E005": "lf_unemp"},
    "b08301": {"E001": "cm_all", "E010": "cm_transit", "E021": "cm_home"},
    "b08303": {"E001": "ct_all", "E011": "ct_45", "E012": "ct_60", "E013": "ct_90"},
    "b28002": {"E001": "net_all", "E004": "net_bb"},
    "b07003": {"E001": "mv_all", "E004": "mv_same", "E013": "mv_state"},
}
# ACS publishes -333333333, -666666666 and similar for "not available": any negative value is missing.


def acs_num(value):
    out = num(value)
    return None if out is None or out < 0 else out


def parse_table(path, table, into):
    """Merge the ZCTA rows of one ACS table file into `into` ({zip: {short_name: value}}). Returns the ZCTA row count."""
    cols = TABLES[table]
    want = {"%s_%s" % (table.upper(), e): name for e, name in cols.items()}
    rows = 0
    with open(path, encoding="utf-8-sig", errors="replace") as fh:
        head = fh.readline().rstrip("\n").split("|")
        if not head or head[0] != "GEO_ID":
            raise SourceUnavailable("ACS %s file has no GEO_ID header" % table)
        idx = {want[n]: i for i, n in enumerate(head) if n in want}
        if len(idx) != len(want):
            raise SourceUnavailable("ACS %s file is missing columns %s" % (table, ", ".join(sorted(set(want.values()) - set(idx)))))
        for line in fh:
            if not line.startswith(ZCTA_PREFIX):
                continue
            parts = line.rstrip("\n").split("|")
            z = zfill_zip(parts[0][len(ZCTA_PREFIX):])
            if not z:
                continue
            rows += 1
            rec = into.setdefault(z, {})
            for name, i in idx.items():
                rec[name] = acs_num(parts[i]) if i < len(parts) else None
    return rows


def _share(parts, whole):
    """Sum of `parts` over `whole`, as a percent with 2 decimals; None when anything is missing or the whole is empty."""
    if whole is None or whole <= 0 or any(p is None for p in parts):
        return None
    return round(sum(parts) / whole * 100, 2)


def _get(rec, *names):
    return [rec.get(n) for n in names]


def derive(rec):
    """Clean fields from the raw counts of one ZCTA."""
    g = rec.get
    rb_base = None if g("rb_all") is None or g("rb_nc") is None else g("rb_all") - g("rb_nc")
    vac_ex = None
    if g("v_all") is not None and g("v_season") is not None and g("u_all"):
        vac_ex = _share([g("v_all") - g("v_season")], g("u_all"))
    tax_rate = None
    if g("tax") is not None and g("value"):
        tax_rate = round(g("tax") / g("value") * 100, 3)
    out = {
        "acs_value_median": g("value"),
        "acs_re_tax_median": g("tax"),
        "acs_tax_rate_eff": tax_rate,
        "acs_units_sfr_share": _share(_get(rec, "u_1d", "u_1a"), g("u_all")),
        "acs_units_2_4_share": _share(_get(rec, "u_2", "u_34"), g("u_all")),
        "acs_units_5plus_share": _share(_get(rec, "u_59", "u_1019", "u_2049", "u_50"), g("u_all")),
        "acs_units_mobile_share": _share(_get(rec, "u_mobile"), g("u_all")),
        "acs_built_pre1980_share": _share(_get(rec, "y_1970", "y_1960", "y_1950", "y_1940", "y_1939"), g("y_all")),
        "acs_built_since2010_share": _share(_get(rec, "y_2020", "y_2010"), g("y_all")),
        "acs_rent_burden_30_share": _share(_get(rec, "rb_30", "rb_35", "rb_40", "rb_50"), rb_base),
        "acs_rent_burden_50_share": _share(_get(rec, "rb_50"), rb_base),
        "acs_rent_pct_income": g("rent_pct"),
        "acs_owner_cost_pct_income": g("own_pct"),
        "acs_mortgage_share": _share(_get(rec, "mt_with"), g("mt_all")),
        "acs_vacancy_ex_seasonal": vac_ex,
        "acs_seasonal_share": _share(_get(rec, "v_season"), g("u_all")),
        "acs_vacant_for_rent_share": _share(_get(rec, "v_rent"), g("u_all")),
        "acs_bachelor_plus": _share(_get(rec, "ed_ba", "ed_ma", "ed_prof", "ed_phd"), g("ed_all")),
        "acs_poverty_rate": _share(_get(rec, "pv_below"), g("pv_all")),
        "acs_unemployment_rate": _share(_get(rec, "lf_unemp"), g("lf_civ")),
        "acs_wfh_share": _share(_get(rec, "cm_home"), g("cm_all")),
        "acs_transit_share": _share(_get(rec, "cm_transit"), g("cm_all")),
        "acs_commute_45plus_share": _share(_get(rec, "ct_45", "ct_60", "ct_90"), g("ct_all")),
        "acs_broadband_share": _share(_get(rec, "net_bb"), g("net_all")),
        "acs_moved_1y_share": None if g("mv_all") is None or g("mv_same") is None else _share([g("mv_all") - g("mv_same")], g("mv_all")),
        "acs_moved_from_state_share": _share(_get(rec, "mv_state"), g("mv_all")),
    }
    return out


def parse(paths):
    """{table: file path} -> (data, rows, as_of_hint). `rows` is the ZCTA row count of the first table."""
    raw, rows = {}, 0
    for table in TABLES:
        if table not in paths:
            raise SourceUnavailable("ACS table %s was not supplied" % table)
        count = parse_table(paths[table], table, raw)
        rows = rows or count
    if len(raw) < MIN_ZCTAS:
        raise SourceUnavailable("ACS files hold only %d ZCTAs (expected about 33,800)" % len(raw))
    data = {}
    for z, rec in raw.items():
        row = derive(rec)
        if any(v is not None for v in row.values()):
            data[z] = row
    return data, rows


def load(ctx):
    year, paths = None, {}
    for table in TABLES:
        if year is None:
            urls = [BASE % (y, y, table) for y in (ctx.year, ctx.year - 1, ctx.year - 2)]
            url, path, _ = ctx.first(urls, "%s.dat" % table, timeout=600)
            year = int(url.split("/summary_file/")[1][:4])
        else:
            path, _ = ctx.fetch(BASE % (year, year, table), "%s.dat" % table, timeout=600)
        paths[table] = path
        ctx.log("%s ok" % table)
    data, rows = parse(paths)
    return {"as_of": "%d-%d" % (year - 4, year), "rows": rows, "data": data,
            "note": "Survey estimates for ZIP code tabulation areas; small areas carry wide margins of error."}
