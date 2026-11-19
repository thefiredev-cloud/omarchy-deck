"""CDC/ATSDR Social Vulnerability Index 2022, census tract level (national tract file)."""
import csv

from ctx import SourceUnavailable, num

SOURCE = {
    "id": "cdc_svi",
    "name": "CDC Social Vulnerability Index by census tract",
    "publisher": "CDC / ATSDR",
    "homepage": "https://www.atsdr.cdc.gov/place-health/php/svi/index.html",
    "level": "tract",
    "tract_vintage": 2020,
    "group": "risk",
    "cadence": "every 2 to 4 years",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "svi_overall": {"label": "Social vulnerability, overall (0 to 100 national rank)", "unit": "score",
                        "agg": "pop_weighted_mean", "better": "lower"},
        "svi_theme_income": {"label": "Social vulnerability: income, jobs and education", "unit": "score",
                             "agg": "pop_weighted_mean", "better": "lower"},
        "svi_theme_household": {"label": "Social vulnerability: age, disability and household", "unit": "score",
                                "agg": "pop_weighted_mean", "better": "lower"},
        "svi_theme_minority": {"label": "Social vulnerability: minority status and language", "unit": "score",
                               "agg": "pop_weighted_mean"},
        "svi_theme_housing": {"label": "Social vulnerability: housing type and transport", "unit": "score",
                              "agg": "pop_weighted_mean", "better": "lower"},
        "svi_poverty150": {"label": "People under 150 percent of the poverty line", "unit": "pct",
                           "agg": "pop_weighted_mean", "better": "lower"},
        "svi_unemployed": {"label": "Civilians 16 and over unemployed", "unit": "pct", "agg": "pop_weighted_mean",
                           "better": "lower"},
        "svi_cost_burden": {"label": "Low-income households paying 30 percent or more of income on housing",
                            "unit": "pct", "agg": "pop_weighted_mean", "better": "lower"},
        "svi_no_diploma": {"label": "Adults 25 and over without a high school diploma", "unit": "pct",
                           "agg": "pop_weighted_mean", "better": "lower"},
        "svi_uninsured": {"label": "People without health insurance", "unit": "pct", "agg": "pop_weighted_mean",
                          "better": "lower"},
        "svi_age65": {"label": "People 65 and over", "unit": "pct", "agg": "pop_weighted_mean"},
        "svi_age17": {"label": "People 17 and under", "unit": "pct", "agg": "pop_weighted_mean"},
        "svi_disability": {"label": "Civilians with a disability", "unit": "pct", "agg": "pop_weighted_mean",
                           "better": "lower"},
        "svi_single_parent": {"label": "Single-parent households with children", "unit": "pct",
                              "agg": "pop_weighted_mean"},
        "svi_limited_english": {"label": "People who speak English less than well", "unit": "pct",
                                "agg": "pop_weighted_mean"},
        "svi_minority": {"label": "People who are racial or ethnic minorities", "unit": "pct",
                         "agg": "pop_weighted_mean"},
        "svi_multi_unit": {"label": "Housing in structures with 10 or more units", "unit": "pct",
                           "agg": "pop_weighted_mean"},
        "svi_mobile_homes": {"label": "Mobile homes", "unit": "pct", "agg": "pop_weighted_mean"},
        "svi_crowding": {"label": "Occupied homes with more people than rooms", "unit": "pct",
                         "agg": "pop_weighted_mean", "better": "lower"},
        "svi_no_vehicle": {"label": "Households without a vehicle", "unit": "pct", "agg": "pop_weighted_mean"},
        "svi_group_quarters": {"label": "People in group quarters", "unit": "pct", "agg": "pop_weighted_mean"},
        "svi_no_internet": {"label": "Households without internet", "unit": "pct", "agg": "pop_weighted_mean",
                            "better": "lower"},
    },
}
URL = "https://svi.cdc.gov/Documents/Data/2022/csv/states/SVI_2022_US.csv"
AS_OF = "2022"
MIN_ROWS = 40000
# CDC column -> (field, factor). Percentile ranks run 0 to 1 in the file; the Deck stores 0 to 100.
COLUMNS = {
    "RPL_THEMES": ("svi_overall", 100.0), "RPL_THEME1": ("svi_theme_income", 100.0),
    "RPL_THEME2": ("svi_theme_household", 100.0), "RPL_THEME3": ("svi_theme_minority", 100.0),
    "RPL_THEME4": ("svi_theme_housing", 100.0),
    "EP_POV150": ("svi_poverty150", 1.0), "EP_UNEMP": ("svi_unemployed", 1.0), "EP_HBURD": ("svi_cost_burden", 1.0),
    "EP_NOHSDP": ("svi_no_diploma", 1.0), "EP_UNINSUR": ("svi_uninsured", 1.0), "EP_AGE65": ("svi_age65", 1.0),
    "EP_AGE17": ("svi_age17", 1.0), "EP_DISABL": ("svi_disability", 1.0), "EP_SNGPNT": ("svi_single_parent", 1.0),
    "EP_LIMENG": ("svi_limited_english", 1.0), "EP_MINRTY": ("svi_minority", 1.0), "EP_MUNIT": ("svi_multi_unit", 1.0),
    "EP_MOBILE": ("svi_mobile_homes", 1.0), "EP_CROWD": ("svi_crowding", 1.0), "EP_NOVEH": ("svi_no_vehicle", 1.0),
    "EP_GROUPQ": ("svi_group_quarters", 1.0), "EP_NOINT": ("svi_no_internet", 1.0),
}


def _value(raw, factor):
    val = num(raw)
    if val is None or val < 0:  # CDC marks "not available" as -999
        return None
    return round(val * factor, 2)


def parse(path, min_rows=MIN_ROWS):
    """SVI tract csv -> ({tract geoid: {field: value}}, rows, as_of). -999 becomes None."""
    data, rows = {}, 0
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if "FIPS" not in (reader.fieldnames or []) or "RPL_THEMES" not in reader.fieldnames:
            raise SourceUnavailable("SVI file has no FIPS / RPL_THEMES columns")
        for row in reader:
            rows += 1
            geoid = (row.get("FIPS") or "").strip()
            if len(geoid) != 11 or not geoid.isdigit():
                continue
            rec = {field: _value(row.get(col), factor) for col, (field, factor) in COLUMNS.items()}
            if any(v is not None for v in rec.values()):
                data[geoid] = rec
    if rows < min_rows:
        raise SourceUnavailable("SVI file has %d rows, expected about 84,000" % rows)
    return data, rows, AS_OF


def load(ctx):
    path, _ = ctx.fetch(URL, "SVI_2022_US.csv", timeout=300, min_bytes=1000000)
    data, rows, as_of = parse(path)
    return {"as_of": as_of, "rows": rows, "data": data,
            "note": "Tracts with no population are left blank. Ranks compare each tract with all US tracts."}
