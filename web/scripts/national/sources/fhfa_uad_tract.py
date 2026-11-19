"""FHFA Uniform Appraisal Dataset aggregate statistics, Enterprise single-family appraisals by census tract. Level "tract".

One zip with one 4.9 GB long-format CSV (30 million rows, 19 columns), streamed row by row; peak memory is tens of MB. Each row is one
statistic (SERIES) for one tract, appraisal purpose, year and quarter, optionally split by a property characteristic. The source keeps
only Median Appraised Value and Count of Appraisals for PURPOSE = Purchase, no characteristic split, the annual row (QUARTER 5),
unsuppressed, for the newest year in the file. These are appraisals of Fannie Mae and Freddie Mac single-family purchase loans, not
all sales. The release folder changes with every version, so the link is read from the FHFA page.
"""
import csv
import io
import re
import time
import zipfile

from ctx import SourceUnavailable, num

PAGE = "https://www.fhfa.gov/data/uniform-appraisal-dataset-aggregate-statistics"
KNOWN = "https://www.fhfa.gov/sites/default/files/2024-12/UADAggs_ent_sf_tract_v3_3.zip"
MIN_TRACTS = 20000  # about 79,000 tracts per year

SOURCE = {
    "id": "fhfa_uad_tract",
    "name": "FHFA appraisal statistics by tract (single-family purchase appraisals)",
    "publisher": "Federal Housing Finance Agency",
    "homepage": "https://www.fhfa.gov/data/uniform-appraisal-dataset-aggregate-statistics",
    "level": "tract",
    "native": "tract",
    "tract_vintage": 2020,
    "group": "residential",
    "cadence": "periodic",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "uad_median_value": {"label": "Median appraised value, purchase appraisals (tract)", "unit": "usd",
                             "agg": "pop_weighted_median", "metric": "home_value", "xwalk": "mean"},
        "uad_appraisals": {"label": "Purchase appraisals in the year (tract)", "unit": "count", "agg": "sum", "xwalk": "sum"},
    },
}
SERIES = {"Median Appraised Value": "uad_median_value", "Count of Appraisals": "uad_appraisals"}
COLS = ("SOURCE", "APPRAISALSOURCE", "SERIES", "GEOLEVEL", "TRACT", "PURPOSE", "YEAR", "QUARTER", "CHARACTERISTIC1", "SUPPRESSED", "VALUE")


def _open_csv(path):
    if zipfile.is_zipfile(path):
        zf = zipfile.ZipFile(path)
        members = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        if len(members) != 1:
            raise SourceUnavailable("UAD zip has %d CSV members (expected 1)" % len(members))
        return io.TextIOWrapper(zf.open(members[0]), encoding="utf-8", errors="replace", newline="")
    return open(path, newline="", encoding="utf-8", errors="replace")


def parse(path):
    """-> (data, rows, as_of year). `path` is the UAD zip or its CSV."""
    by_year, rows = {}, 0
    with _open_csv(path) as fh:
        reader = csv.reader(fh)
        try:
            head = next(reader)
        except StopIteration:
            raise SourceUnavailable("UAD file is empty")
        missing = [c for c in COLS if c not in head]
        if missing:
            raise SourceUnavailable("UAD header changed: %s missing" % ", ".join(missing))
        ix = {c: head.index(c) for c in COLS}
        i_ser, i_geo, i_tract, i_pur, i_yr, i_q, i_char, i_sup, i_val, i_app = (
            ix["SERIES"], ix["GEOLEVEL"], ix["TRACT"], ix["PURPOSE"], ix["YEAR"], ix["QUARTER"], ix["CHARACTERISTIC1"],
            ix["SUPPRESSED"], ix["VALUE"], ix["APPRAISALSOURCE"])
        width = len(head)
        for row in reader:
            rows += 1
            if len(row) < width or row[i_pur] != "Purchase" or row[i_q] != "5":
                continue
            field = SERIES.get(row[i_ser])
            if field is None or row[i_geo] != "Tract" or row[i_char] != "No Characteristic" or row[i_sup] != "0":
                continue
            if row[i_app] != "Enterprise Single Family":
                continue
            tract, year = row[i_tract].strip(), row[i_yr].strip()
            val = num(row[i_val])
            if len(tract) != 11 or not year.isdigit() or val is None:
                continue
            by_year.setdefault(int(year), {}).setdefault(tract, {})[field] = int(round(val))
    if not by_year:
        raise SourceUnavailable("UAD file had no unsuppressed Enterprise single-family purchase rows")
    latest = max(by_year)
    data = {t: v for t, v in by_year[latest].items() if v}
    if len(data) < MIN_TRACTS:
        raise SourceUnavailable("UAD parsed to %d tracts for %d (expected about 79,000)" % (len(data), latest))
    return data, rows, str(latest)


def find_url(ctx):
    """Newest tract zip linked from the FHFA page; the known 2024-12 link when the page cannot be read."""
    try:
        path, _ = ctx.fetch(PAGE, "uad_page.html", timeout=60, min_bytes=1000, min_age=3 * 86400)
        with open(path, encoding="utf-8", errors="replace") as fh:
            links = re.findall(r'href="([^"]*UADAggs_ent_sf_tract[^"]*\.zip)"', fh.read())
        if links:
            link = sorted(set(links))[-1]
            return link if link.startswith("http") else "https://www.fhfa.gov" + link
    except SourceUnavailable:
        pass
    return KNOWN


def load(ctx):
    url = find_url(ctx)
    path, meta = ctx.fetch(url, "uad_tract.zip", timeout=300, min_bytes=1 << 20)
    ctx.log("parsing %.0f MB zip (%s)" % (meta.get("bytes", 0) / 1e6, meta.get("status")))
    t0 = time.time()
    data, rows, as_of = parse(path)
    ctx.log("%d rows, %d tracts in %.0fs" % (rows, len(data), time.time() - t0))
    return {"as_of": as_of, "rows": rows, "data": data,
            "note": "Appraisals behind Fannie Mae and Freddie Mac single-family purchase loans, one annual figure per tract; not all sales."}
