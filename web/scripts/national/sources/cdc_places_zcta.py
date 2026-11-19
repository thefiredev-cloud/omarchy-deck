"""CDC PLACES, ZCTA level: 40 model-based adult health measures per ZIP code tabulation area (crude prevalence, %)."""
import csv

from ctx import SourceUnavailable, num, zfill_zip

# measure id in the CDC file -> (plain label, better direction or None)
MEASURES = {
    "access2": ("Adults 18 to 64 without health insurance", "lower"),
    "arthritis": ("Adults with arthritis", "lower"),
    "binge": ("Adults who binge drink", "lower"),
    "bphigh": ("Adults with high blood pressure", "lower"),
    "bpmed": ("Adults with high blood pressure taking medicine", "higher"),
    "cancer": ("Adults with cancer (not skin)", "lower"),
    "casthma": ("Adults with current asthma", "lower"),
    "chd": ("Adults with coronary heart disease", "lower"),
    "checkup": ("Adults with a routine checkup in the past year", "higher"),
    "cholscreen": ("Adults screened for high cholesterol", "higher"),
    "colon_screen": ("Adults up to date on colorectal screening", "higher"),
    "copd": ("Adults with COPD", "lower"),
    "csmoking": ("Adults who currently smoke", "lower"),
    "dental": ("Adults with a dental visit in the past year", "higher"),
    "depression": ("Adults with depression", "lower"),
    "diabetes": ("Adults with diagnosed diabetes", "lower"),
    "ghlth": ("Adults in fair or poor health", "lower"),
    "highchol": ("Adults with high cholesterol", "lower"),
    "lpa": ("Adults with no leisure-time physical activity", "lower"),
    "mammouse": ("Women 50 to 74 with a mammogram in the past 2 years", "higher"),
    "mhlth": ("Adults with 14 or more poor mental health days", "lower"),
    "obesity": ("Adults with obesity", "lower"),
    "phlth": ("Adults with 14 or more poor physical health days", "lower"),
    "sleep": ("Adults sleeping under 7 hours a night", "lower"),
    "stroke": ("Adults who had a stroke", "lower"),
    "teethlost": ("Adults 65 and over with all natural teeth lost", "lower"),
    "hearing": ("Adults with hearing disability", "lower"),
    "vision": ("Adults with vision disability", "lower"),
    "cognition": ("Adults with cognitive disability", "lower"),
    "mobility": ("Adults with mobility disability", "lower"),
    "selfcare": ("Adults with self-care disability", "lower"),
    "indeplive": ("Adults with independent-living disability", "lower"),
    "disability": ("Adults with any disability", "lower"),
    "loneliness": ("Adults who feel lonely", "lower"),
    "foodstamp": ("Adults who received food stamps in the past year", None),
    "foodinsecu": ("Adults with food insecurity", "lower"),
    "housinsecu": ("Adults with housing insecurity", "lower"),
    "shututility": ("Adults who had utilities shut off or threatened", "lower"),
    "lacktrpt": ("Adults who lacked reliable transportation", "lower"),
    "emotionspt": ("Adults lacking social and emotional support", "lower"),
}

SOURCE = {
    "id": "cdc_places_zcta",
    "name": "CDC PLACES adult health measures by ZIP code area",
    "publisher": "Centers for Disease Control and Prevention",
    "homepage": "https://www.cdc.gov/places/",
    "level": "zip",
    "group": "risk",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "places_" + mid: dict(
            {"label": label, "unit": "pct", "agg": "pop_weighted_mean"},
            **({"better": better} if better else {}))
        for mid, (label, better) in MEASURES.items()
    },
}
SOURCE["fields"]["places_pop_adults"] = {"label": "Adults the estimates cover", "unit": "count", "agg": "sum"}

# data.cdc.gov Socrata export of the wide ("GIS friendly") table, 2025 release. One row per ZCTA, about 32,500 rows.
URL = "https://data.cdc.gov/resource/kee5-23sr.csv?$limit=50000&$order=zcta5"
AS_OF = "2023"  # BRFSS 2023 (a few measures 2022); the 2025 release
MIN_ROWS = 15000


def parse(path, min_rows=MIN_ROWS):
    """Wide PLACES csv -> ({zcta: {field: value}}, rows, as_of). Crude prevalence in percent; blank cells are None."""
    data, rows = {}, 0
    with open(path, newline="", encoding="utf8") as fh:
        reader = csv.DictReader(fh)
        head = reader.fieldnames or []
        if "zcta5" not in head or not any(c.endswith("_crudeprev") for c in head):
            raise SourceUnavailable("PLACES file has no zcta5 / *_crudeprev columns")
        for row in reader:
            rows += 1
            zip5 = zfill_zip(row.get("zcta5"))
            if not zip5:
                continue
            rec = {}
            for mid in MEASURES:
                rec["places_" + mid] = num(row.get(mid + "_crudeprev"))
            pop18 = num(row.get("totalpop18plus"))
            rec["places_pop_adults"] = int(pop18) if pop18 is not None else None
            if any(v is not None for v in rec.values()):
                data[zip5] = rec
    if rows < min_rows:
        raise SourceUnavailable("PLACES file has %d rows, expected about 32,500" % rows)
    return data, rows, AS_OF


def load(ctx):
    path, meta = ctx.fetch(URL, "places_zcta_2025.csv", timeout=300, min_bytes=1000000)
    data, rows, as_of = parse(path)
    return {"as_of": as_of, "rows": rows, "data": data,
            "note": "Model-based estimates from BRFSS survey data, not counts; small ZIP areas are less certain."}
