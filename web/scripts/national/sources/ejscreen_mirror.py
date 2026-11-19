"""EPA EJScreen 2024 (v2.3) environmental indicators by census tract, from the Harvard Dataverse mirror.

EPA took ejscreen.epa.gov offline in February 2025. The public mirror (PEDP, Harvard Dataverse doi:10.7910/DVN/RLR5AX) holds
EPA's own tract-level file, so no block-group roll-up is needed. The file id is looked up by file name on every refresh.
"""
import csv

from ctx import SourceUnavailable, num

SOURCE = {
    "id": "ejscreen_mirror",
    "name": "EPA EJScreen 2024 environmental indicators (Harvard Dataverse mirror)",
    "publisher": "US EPA EJScreen, mirrored by PEDP on Harvard Dataverse",
    "homepage": "https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/RLR5AX",
    "level": "tract",
    "tract_vintage": 2020,
    "group": "risk",
    "cadence": "static",
    "license": "EPA public domain data; mirror published on Harvard Dataverse (see the dataset page for its terms)",
    "key_env": None,
    "fields": {
        "ej_pm25": {"label": "Fine particle pollution (micrograms per cubic meter)", "unit": "index",
                    "agg": "pop_weighted_mean", "metric": "health", "xwalk": "mean", "better": "lower"},
        "ej_ozone": {"label": "Ozone (ppb)", "unit": "index", "agg": "pop_weighted_mean", "xwalk": "mean",
                     "better": "lower"},
        "ej_diesel_pm": {"label": "Diesel particulate matter (micrograms per cubic meter)", "unit": "index",
                         "agg": "pop_weighted_mean", "xwalk": "mean", "better": "lower"},
        "ej_traffic": {"label": "Traffic proximity", "unit": "index", "agg": "pop_weighted_mean", "xwalk": "mean",
                       "better": "lower"},
        "ej_lead_paint": {"label": "Homes built before 1960", "unit": "pct", "agg": "pop_weighted_mean",
                          "xwalk": "mean", "better": "lower"},
        "ej_superfund": {"label": "Superfund site proximity", "unit": "index", "agg": "pop_weighted_mean",
                         "metric": "commercial_risk", "xwalk": "mean", "better": "lower"},
    },
}
DOI = "doi:10.7910/DVN/RLR5AX"
LISTING = ("https://dataverse.harvard.edu/api/datasets/:persistentId/versions/:latest/files"
           "?persistentId=" + DOI + "&limit=1000&offset=%d")
FILE_NAME = "EJScreen_2024_Tract_with_AS_CNMI_GU_VI.csv"
DOWNLOAD = "https://dataverse.harvard.edu/api/access/datafile/%d?format=original"
AS_OF = "2024 (v2.3)"
MIN_ROWS = 50000  # about 85,000 tracts
COLUMNS = {"PM25": ("ej_pm25", 1.0), "OZONE": ("ej_ozone", 1.0), "DSLPM": ("ej_diesel_pm", 1.0),
           "PTRAF": ("ej_traffic", 1.0), "PRE1960PCT": ("ej_lead_paint", 100.0), "PNPL": ("ej_superfund", 1.0)}


def find_file_id(listing_pages):
    """File id of the national tract csv in the Dataverse file listings (a list of parsed JSON pages)."""
    for page in listing_pages:
        for entry in page.get("data") or []:
            data = entry.get("dataFile") or {}
            if data.get("filename") == FILE_NAME and data.get("id"):
                return int(data["id"])
    raise SourceUnavailable("the Dataverse listing has no file named %s" % FILE_NAME)


def parse(path, min_rows=MIN_ROWS):
    """EJScreen tract csv -> ({tract geoid: {field: value}}, rows, as_of). Streams the 150 MB file."""
    data, rows = {}, 0
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if "ID" not in (reader.fieldnames or []) or not set(COLUMNS) <= set(reader.fieldnames):
            raise SourceUnavailable("EJScreen file has unexpected columns")
        for row in reader:
            rows += 1
            geoid = (row.get("ID") or "").strip().zfill(11)
            if len(geoid) != 11 or not geoid.isdigit():
                continue
            rec = {}
            for col, (field, factor) in COLUMNS.items():
                val = num(row.get(col))
                rec[field] = None if val is None else round(val * factor, 3)
            if any(v is not None for v in rec.values()):
                data[geoid] = rec
    if rows < min_rows:
        raise SourceUnavailable("EJScreen file has %d rows, expected about 85,000" % rows)
    return data, rows, AS_OF


def load(ctx):
    pages = [ctx.get_json(LISTING % off, "listing_%d.json" % off, min_age=7 * 86400, timeout=90, min_bytes=100)
             for off in (0, 1000, 2000, 3000)]
    file_id = find_file_id(pages)
    path, _ = ctx.fetch(DOWNLOAD % file_id, "ejscreen_2024_tract.csv", timeout=900, min_bytes=1000000,
                        min_age=60 * 86400)
    data, rows, as_of = parse(path)
    return {"as_of": as_of, "rows": rows, "data": data,
            "note": "EPA's own tract-level file from the public mirror; the EJScreen site itself has been offline since February 2025."}
