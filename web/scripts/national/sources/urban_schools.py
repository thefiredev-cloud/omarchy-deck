"""Urban Institute Education Data Portal: public schools by ZIP with enrollment, school poverty, district spending and proficiency.

Four national tables, paged through the portal's `next` links and cached page by page:
  CCD school directory 2022 (the ZIP, district and enrollment of every school),
  MEPS school poverty 2020 (modeled share of students in poverty),
  CCD district finance 2020 (current spending per pupil),
  EdFacts grade 3 district assessments 2020 (share proficient), and the same table for 2018 (2018-19 school year).
District values reach schools through the district id (leaid).

Years. The portal defines `year` for all four tables as "Year that the academic year begins (e.g., the 2013-14 academic
year is 2013)" (https://educationdata.urban.org/api/v1/api-endpoint-varlist/, variable `year`, checked 2026-11-15). So the
EdFacts table 2020 is the 2020-21 school year, the directory 2022 is 2022-23, finance and MEPS 2020 are 2020-21.
The EdFacts endpoint lists years_available "2009-2018, 2020" (https://educationdata.urban.org/api/v1/api-endpoints/).
Probed 2026-11-15T02:19Z for fips=6: 2018 = HTTP 200, 2019 = 500, 2020 = 200, 2021 = 500.

school_score is the state percentile of a ZIP's enrollment-weighted grade 3 proficiency (average of the district's read and
math midpoints) and nothing else; a ZIP without a proficiency value has no score. Each state sets its own tests, so the
percentile ranks a ZIP inside its own state and is not comparable across states. Poverty and spending stay separate facts.
"""
import json

from ctx import SourceUnavailable, num

SOURCE = {
    "id": "urban_schools",
    "name": "Urban Institute Education Data Portal: public schools by ZIP",
    "publisher": "Urban Institute Education Data Portal (NCES CCD, EdFacts, MEPS)",
    "homepage": "https://educationdata.urban.org/",
    "level": "zip",
    "group": "people",
    "cadence": "annual",
    "license": "Urban Institute Education Data Portal, ODC-By 1.0; underlying NCES data is public domain",
    "key_env": None,
    "fields": {
        "school_count": {"label": "Public schools", "unit": "count", "agg": "sum"},
        "school_enrollment": {"label": "Public school students", "unit": "count", "agg": "sum"},
        "school_score": {"label": "Grade 3 proficiency, state percentile, 2020-21", "unit": "score",
                         "agg": "pop_weighted_mean", "metric": "schools", "better": "higher"},
        "school_prof_pctile_2018": {"label": "Grade 3 proficiency, state percentile, 2018-19", "unit": "score",
                                    "agg": "pop_weighted_mean", "better": "higher"},
        "school_prof_pctile": {"label": "Proficiency, state percentile", "unit": "score", "agg": "pop_weighted_mean",
                               "better": "higher"},
        "school_poverty": {"label": "Students in poverty (MEPS)", "unit": "pct", "agg": "pop_weighted_mean",
                           "better": "lower"},
        "school_ppe": {"label": "Spending per pupil", "unit": "usd", "agg": "pop_weighted_mean"},
    },
}
BASE = "https://educationdata.urban.org/api/v1/"
TABLES = {
    "directory": BASE + "schools/ccd/directory/2022/",
    "meps": BASE + "schools/meps/2020/",
    "finance": BASE + "school-districts/ccd/finance/2020/",
    "edfacts": BASE + "school-districts/edfacts/assessments/2020/grade-3/",
    "edfacts2018": BASE + "school-districts/edfacts/assessments/2018/grade-3/",
}
AS_OF = "2020-21 school year (EdFacts, finance, poverty); directory 2022-23"
OPEN_STATUS = {1, 3, 4, 5, 8}  # open, new, added, changed boundary, reopened (CCD school_status codes)
MIN_SCHOOLS = 50000  # about 102,000 school rows
MIN_ZIPS_FOR_PERCENTILE = 5


def _valid(raw):
    """The portal marks missing data with -1, -2 (not applicable) and -3 (suppressed)."""
    val = num(raw)
    return None if val is None or val < 0 else val


def _results(path):
    with open(path, encoding="utf8") as fh:
        try:
            body = json.load(fh)
        except ValueError:
            raise SourceUnavailable("Education Data page is not JSON")
    if not isinstance(body, dict) or "results" not in body:
        raise SourceUnavailable("Education Data page has no results")
    return body["results"]


def _zip5(raw):
    text = str(raw or "").split("-")[0].strip()
    return text.zfill(5) if text.isdigit() and len(text) <= 5 else None


def percentile_ranks(values):
    """{key: 0 to 100 percentile} for a dict of numbers (ties share their average rank); None if too few."""
    if len(values) < MIN_ZIPS_FOR_PERCENTILE:
        return {}
    ordered = sorted(values.values())
    n = len(ordered)
    first, last = {}, {}
    for i, v in enumerate(ordered):
        first.setdefault(v, i)
        last[v] = i
    return {k: round(100.0 * (first[v] + last[v]) / 2.0 / (n - 1), 1) for k, v in values.items()}


def _prof_by_district(files):
    """{leaid: grade 3 proficiency} from EdFacts pages: all-student rows, mean of the valid read and math midpoints."""
    out = {}
    for path in files:
        for row in _results(path):
            if any(row.get(k) != 99 for k in ("race", "sex", "lep", "homeless", "migrant", "disability",
                                              "foster_care", "military_connected", "econ_disadvantaged")):
                continue  # all-student rows only
            parts = [v for v in (_valid(row.get("read_test_pct_prof_midpt")), _valid(row.get("math_test_pct_prof_midpt")))
                     if v is not None]
            if parts:
                out[str(row["leaid"])] = sum(parts) / len(parts)
    return out


def parse(paths, min_schools=MIN_SCHOOLS):
    """{'directory': [files], 'meps': [...], 'finance': [...], 'edfacts': [...]} -> ({zip: {field: value}}, rows, as_of)."""
    ppe, poverty = {}, {}
    for path in paths["finance"]:
        for row in _results(path):
            spend, pupils = _valid(row.get("exp_current_elsec_total")), _valid(row.get("enrollment_fall_responsible"))
            if spend and pupils:
                ppe[str(row["leaid"])] = spend / pupils
    prof = _prof_by_district(paths["edfacts"])
    prof18 = _prof_by_district(paths.get("edfacts2018", []))
    for path in paths["meps"]:
        for row in _results(path):
            val = _valid(row.get("meps_poverty_pct"))
            if val is not None:
                poverty[str(row["ncessch"])] = val
    zips, rows = {}, 0
    for path in paths["directory"]:
        for row in _results(path):
            rows += 1
            zip5 = _zip5(row.get("zip_location"))
            if not zip5 or row.get("school_status") not in OPEN_STATUS:
                continue
            z = zips.setdefault(zip5, {"fips": row.get("fips"), "schools": 0, "students": 0, "w": {"prof": 0.0, "prof18": 0.0, "pov": 0.0, "ppe": 0.0},
                                       "wsum": {"prof": 0.0, "prof18": 0.0, "pov": 0.0, "ppe": 0.0}})
            z["schools"] += 1
            students = _valid(row.get("enrollment")) or 0
            z["students"] += int(students)
            if students > 0:
                leaid, school = str(row.get("leaid")), str(row.get("ncessch"))
                for key, val in (("prof", prof.get(leaid)), ("prof18", prof18.get(leaid)), ("pov", poverty.get(school)), ("ppe", ppe.get(leaid))):
                    if val is not None:
                        z["w"][key] += students * val
                        z["wsum"][key] += students
    if rows < min_schools:
        raise SourceUnavailable("school directory has %d rows, expected about 102,000" % rows)
    base = {}
    for zip5, z in zips.items():
        mean = lambda k: z["w"][k] / z["wsum"][k] if z["wsum"][k] > 0 else None  # noqa: E731
        base[zip5] = {"school_count": z["schools"], "school_enrollment": z["students"],
                      "_prof": mean("prof"), "_prof18": mean("prof18"), "school_poverty": mean("pov"), "school_ppe": mean("ppe"), "_fips": z["fips"]}
    by_state = {}
    for zip5, rec in base.items():
        by_state.setdefault(rec["_fips"], []).append(zip5)
    data = {}
    for zip5, rec in base.items():
        data[zip5] = {"school_count": rec["school_count"], "school_enrollment": rec["school_enrollment"],
                      "school_prof_pctile": None, "school_prof_pctile_2018": None, "school_poverty": None if rec["school_poverty"] is None else round(rec["school_poverty"], 1),
                      "school_ppe": None if rec["school_ppe"] is None else int(round(rec["school_ppe"])), "school_score": None}
    for members in by_state.values():
        rank = percentile_ranks({z: base[z]["_prof"] for z in members if base[z]["_prof"] is not None})
        rank18 = percentile_ranks({z: base[z]["_prof18"] for z in members if base[z]["_prof18"] is not None})
        for zip5 in members:
            data[zip5]["school_prof_pctile_2018"] = rank18.get(zip5)  # same method on the 2018-19 table, kept apart
            data[zip5]["school_prof_pctile"] = rank.get(zip5)
            data[zip5]["school_score"] = rank.get(zip5)  # the same state percentile, nothing else goes into it
    return data, rows, AS_OF


def _pages(ctx, name, start_url):
    """Cached pages of one table, following the portal's `next` link. Returns the list of local paths."""
    paths, url, page = [], start_url, 1
    while url:
        path, _ = ctx.fetch(url, "%s_p%d.json" % (name, page), timeout=300, min_bytes=20, min_age=60 * 86400)
        paths.append(path)
        with open(path, encoding="utf8") as fh:
            try:
                url = json.load(fh).get("next")
            except ValueError:
                raise SourceUnavailable("Education Data page %s %d is not JSON" % (name, page))
        page += 1
    return paths


def load(ctx):
    paths = {name: _pages(ctx, name, url) for name, url in TABLES.items()}
    data, rows, as_of = parse(paths)
    return {"as_of": as_of, "rows": rows, "data": data,
            "note": "Score is the state percentile of grade 3 proficiency (EdFacts 2020-21); school_prof_pctile_2018 is the same method on the 2018-19 table (district results weighted by current school enrollment), kept as a separate field. State tests differ, so a percentile ranks a ZIP inside its own state and is not comparable across states; district results stand in for every school in the district."}
