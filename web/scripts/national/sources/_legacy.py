"""Shared loaders for the legacy national sources wrapped as plugins (DataArch section 3).

Each wrapped source (`sources/<id>.py`) is one SOURCE dict plus `load = loader("<id>")`. The loaders are the
`load_all()` steps of the old collector, unchanged in what they download and parse, moved onto `ctx.fetch` (cache
`~/.cache/deck-data/<id>/`, seeded from the old cache by `seed_cache.py`). They return the SPEC result with an empty
`data` plus `legacy`: the exact parser output the legacy builder (`legacy/assemble.py`) feeds to
`national_build.merge_zip`, and `legacy_row`: the v1 manifest row, so the compat output stays byte-shape identical.
The ZIP fields they feed (SOURCE.fields) are written by the legacy builder, never by the plugin merge.
"""
import os
import re
import subprocess
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
_LEGACY = os.path.join(os.path.dirname(_HERE), "legacy")
if _LEGACY not in sys.path:
    sys.path.insert(0, _LEGACY)

import market_metrics  # noqa: E402
import national_area as A  # noqa: E402
import national_fetch as F  # noqa: E402
import national_sources as S  # noqa: E402
from ctx import SourceUnavailable  # noqa: E402

YEAR = int(time.strftime("%Y"))
ACS_BASE = "https://www2.census.gov/programs-surveys/acs/summary_file/%d/table-based-SF/data/5YRData/acsdt5y%d-%s.dat"
GAZ = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/%d_Gazetteer/%d_Gaz_zcta_national.zip"
CBSA = "https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/%d/delineation-files/list1_%d.xlsx"
ZBP = "https://www2.census.gov/programs-surveys/cbp/datasets/%d/zbp%02d%s.zip"
SAFMR_INDEX = "https://www.huduser.gov/portal/datasets/fmr/smallarea/index.html"
REL = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt"
FHFA = "https://www.fhfa.gov/hpi/download/annually/hpi_at_zip5.xlsx"
GEONAMES = "https://download.geonames.org/export/zip/US.zip"
ZHVI_URL = market_metrics.ZILLOW_ZIP % ("zhvi", "zhvi", "_tier_0.33_0.67_sm_sa_month")
ZORI_URL = market_metrics.ZILLOW_ZIP % ("zori", "zori", "mfr_sm_month")
RDC_URL = market_metrics.REALTOR_ZIP
RDC_HIST_URL = market_metrics.REALTOR_ZIP.replace(".csv", "_History.csv")
IPEDS = "https://nces.ed.gov/ipeds/datacenter/data/%s%d.zip"
EDGE = "https://nces.ed.gov/programs/edge/data/EDGE_GEOCODE_PUBLICSCH_%02d%02d.zip"
CHR_DIR = "https://www.countyhealthrankings.org/sites/default/files/media/document/"
CHR_CSV = CHR_DIR + "analytic_data%d%s.csv"
CHR_MEASURES = CHR_DIR + "%d%%20Select%%20and%%20additional%%20measures,%%20data%%20sources%%20and%%20years.pdf"
MIN = 1024  # the old cache refused bodies under 1 KB as data files


def note_of(meta):
    if meta.get("refresh_error"):
        return "refresh failed (%s); using the download of %s" % (meta["refresh_error"][:100], F.last_modified_date(meta))
    return None


def _out(sid, name, url, as_of, rows, legacy, note=None, **extra):
    row = {"id": sid, "name": name, "url": url, "as_of": as_of, "rows": rows, "status": "ok", "reason": None}
    row.update(extra)
    row["note"] = note
    return {"as_of": as_of or "unknown", "rows": rows, "data": {}, "note": note, "legacy": legacy, "legacy_row": row}


def _parsed(fn, path):
    """Run a vendored parser; a file it cannot read is an unavailable source with the parser's words."""
    try:
        return fn(path)
    except (OSError, ValueError, KeyError, IndexError, StopIteration) as exc:
        raise SourceUnavailable("could not parse %s (%s)" % (os.path.basename(path), str(exc)[:120])) from None


def zillow_zhvi(ctx):
    path, meta = ctx.fetch(ZHVI_URL, "zhvi_zip.csv", min_bytes=MIN)
    data, m = _parsed(S.parse_zillow_monthly, path)
    return _out("zillow_zhvi", "Zillow Home Value Index, ZIP, all homes mid tier, smoothed seasonally adjusted",
                ZHVI_URL, m["as_of"], m["rows"], data, note_of(meta))


def zillow_zori(ctx):
    path, meta = ctx.fetch(ZORI_URL, "zori_zip.csv", min_bytes=MIN)
    data, m = _parsed(S.parse_zillow_monthly, path)
    return _out("zillow_zori", "Zillow Observed Rent Index, ZIP, all homes plus multifamily, smoothed", ZORI_URL,
                m["as_of"], m["rows"], data, note_of(meta))


def realtor_zip(ctx):
    path, meta = ctx.fetch(RDC_URL, "rdc_zip.csv", min_bytes=MIN)
    data, m = _parsed(S.parse_realtor_current, path)
    return _out("realtor_zip", "Realtor.com residential listings core metrics, ZIP, latest month", RDC_URL,
                m["as_of"], m["rows"], data, note_of(meta))


def realtor_zip_history(ctx):
    path, meta = ctx.fetch(RDC_HIST_URL, "rdc_zip_history.csv", timeout=900, min_bytes=MIN)
    data, m = _parsed(S.parse_realtor_history, path)
    return _out("realtor_zip_history", "Realtor.com residential listings core metrics, ZIP, monthly history (last 60 "
                "months used)", RDC_HIST_URL, m["as_of"], m["rows"], data, note_of(meta))


def census_gazetteer(ctx):
    url, path, meta = ctx.first([GAZ % (y, y) for y in (YEAR, YEAR - 1, YEAR - 2)], "gaz_zcta.zip", min_bytes=MIN)
    data, m = _parsed(S.parse_gazetteer, path)
    return _out("census_gazetteer", "Census Gazetteer, ZIP Code Tabulation Areas", url,
                re.search(r"/(\d{4})_Gazetteer/", url).group(1), m["rows"], data, note_of(meta))


def census_zcta_county(ctx):
    path, meta = ctx.fetch(REL, "zcta_county.txt", min_bytes=MIN)
    data, m = _parsed(S.parse_zcta_county, path)
    return _out("census_zcta_county", "Census 2020 ZCTA to county relationship file (largest land share)", REL, "2020",
                m["rows"], data, note_of(meta))


def census_cbsa(ctx):
    url, path, meta = ctx.first([CBSA % (y, y) for y in range(YEAR, 2022, -1)], "cbsa_list1.xlsx", min_bytes=MIN)
    data, m = _parsed(S.parse_cbsa, path)
    return _out("census_cbsa", "OMB core based statistical area delineation (Census list 1)", url, m["as_of"],
                m["rows"], data, note_of(meta))


def geonames_postal(ctx):
    path, meta = ctx.fetch(GEONAMES, "geonames_us.zip", min_bytes=MIN)
    data, m = _parsed(S.parse_geonames, path)
    return _out("geonames_postal", "GeoNames US postal codes (city and county names, CC BY 4.0)", GEONAMES,
                F.last_modified_date(meta), m["rows"], data, note_of(meta))


def census_acs5(ctx):
    url0, year = None, None
    for y in (YEAR - 1, YEAR - 2, YEAR - 3):
        try:
            url0 = ACS_BASE % (y, y, "b01003")
            ctx.fetch(url0, "acs5_b01003.dat", min_bytes=MIN)
            year = y
            break
        except SourceUnavailable:
            continue
    if not year:
        raise SourceUnavailable("no ACS 5-year table-based summary file found for %d to %d" % (YEAR - 3, YEAR - 1))
    tables, rows, missing = {}, 0, []
    for t in S.ACS_TABLES:
        try:
            path, _ = ctx.fetch(ACS_BASE % (year, year, t), "acs5_%s.dat" % t, min_bytes=MIN)
        except SourceUnavailable as exc:
            if t not in S.ACS_OPTIONAL:
                raise
            missing.append("%s: %s" % (t.upper(), str(exc)[:80]))
            continue
        rows = max(rows, S.parse_acs_table(path, t, tables))
    names = ", ".join(t.upper() for t in S.ACS_TABLES)
    note = "api.census.gov answers 'Missing Key' to keyless calls; the same tables are read from the published bulk summary file"
    as_of = "%d-%d" % (year - 4, year)
    return _out("census_acs5", "Census ACS %d-%d 5-year, ZCTA (%s)" % (year - 4, year, names),
                url0.rsplit("/", 1)[0] + "/", as_of, rows, {z: S.acs_derive(r) for z, r in tables.items()},
                note + ("; unavailable, fields null: " + "; ".join(missing) if missing else ""))


def _safmr_candidates(ctx):
    """Newest SAFMR workbook linked from HUD's Small Area FMR page; a revised file wins within a fiscal year."""
    try:
        path, _ = ctx.fetch(SAFMR_INDEX, "safmr_index.html", min_bytes=MIN)
        with open(path, encoding="utf8", errors="replace") as fh:
            page = fh.read()
        links = set(re.findall(r'href="(/portal/datasets/fmr/fmr(\d{4})/[^"]*safmrs[^"]*\.xlsx)"', page, re.I))
        ranked = sorted(((int(y), "revis" in u.lower() or "_rev" in u.lower(), "nonmetro" not in u.lower(), u)
                         for u, y in links if "hypothetical" not in u.lower() and "selection" not in u.lower()),
                        reverse=True)
        urls = ["https://www.huduser.gov" + u for y, _, metro, u in ranked if metro]
        if urls:
            return urls
    except SourceUnavailable:
        pass
    return ["https://www.huduser.gov/portal/datasets/fmr/fmr%d/FY%02d_safmrs.xlsx" % (y, y % 100) for y in (YEAR + 1, YEAR)]


def hud_safmr(ctx):
    url, path, meta = ctx.first(_safmr_candidates(ctx), "safmr.xlsx", min_bytes=MIN)
    data, m = _parsed(S.parse_safmr, path)
    fy = re.search(r"fmr(\d{4})", url)
    as_of = "FY%s" % fy.group(1) if fy else None
    return _out("hud_safmr", "HUD Small Area Fair Market Rents by ZIP", url, as_of, m["rows"], data,
                "%d ZIPs listed under more than one HUD area keep the first row" % m["multi_area"])


def fhfa_zip5(ctx):
    path, meta = ctx.fetch(FHFA, "fhfa_zip5.xlsx", min_bytes=MIN)
    data, m = _parsed(S.parse_fhfa, path)
    return _out("fhfa_zip5", "FHFA House Price Index, five-digit ZIP, annual, all transactions (developmental)", FHFA,
                m["as_of"], m["rows"], data, note_of(meta), published=m["published"])


def _zbp_current(ctx):
    """(year, url, path, meta) of the newest ZBP totals file."""
    url, path, meta = ctx.first([ZBP % (y, y % 100, "totals") for y in range(YEAR - 1, YEAR - 5, -1)],
                                "zbp_totals_cur.zip", min_bytes=MIN)
    return int(re.search(r"/datasets/(\d{4})/", url).group(1)), url, path, meta


def census_zbp(ctx):
    y, url, path, meta = _zbp_current(ctx)
    data, m = _parsed(S.parse_zbp_totals, path)
    return _out("census_zbp", "Census ZIP Code Business Patterns %d, totals" % y, url, str(y), m["rows"], data,
                note_of(meta))


def census_zbp_detail(ctx):
    y = _zbp_current(ctx)[0]
    url = ZBP % (y, y % 100, "detail")
    path, meta = ctx.fetch(url, "zbp_detail_cur.zip", min_bytes=MIN)
    data, m = _parsed(S.parse_zbp_detail, path)
    return _out("census_zbp_detail", "Census ZIP Code Business Patterns %d, establishments by 2-digit NAICS sector" % y,
                url, str(y), m["rows"], data, note_of(meta))


def census_zbp_prior(ctx):
    y = _zbp_current(ctx)[0] - 5
    url = ZBP % (y, y % 100, "totals")
    path, meta = ctx.fetch(url, "zbp_totals_old.zip", min_bytes=MIN)
    data, m = _parsed(S.parse_zbp_totals, path)
    return _out("census_zbp_prior", "Census ZIP Code Business Patterns %d, totals (five-year comparison)" % y, url,
                str(y), m["rows"], data, note_of(meta))


def ipeds_hd(ctx):
    url, path, meta = ctx.first([IPEDS % ("HD", y) for y in (YEAR - 1, YEAR - 2, YEAR - 3)], "ipeds_hd.zip",
                                min_bytes=MIN)
    data, m = _parsed(A.parse_ipeds_hd, path)
    y = int(re.search(r"HD(\d{4})", url).group(1))
    return _out("ipeds_hd", "IPEDS institutional characteristics HD%d, degree-granting active colleges with lat/lon" % y,
                url, "%d-%02d" % (y, (y + 1) % 100), m["rows"], data, note_of(meta))


def ipeds_enroll(ctx):
    url, path, meta = ctx.first([IPEDS % ("DRVEF", y) for y in (YEAR - 1, YEAR - 2, YEAR - 3, YEAR - 4)],
                                "ipeds_drvef.zip", min_bytes=MIN)
    data, m = _parsed(A.parse_ipeds_enroll, path)
    return _out("ipeds_enroll", "IPEDS derived fall enrollment (ENRTOT, total headcount)", url,
                "fall " + re.search(r"DRVEF(\d{4})", url).group(1), m["rows"], data, note_of(meta))


def nces_edge_schools(ctx):
    url, path, meta = ctx.first([EDGE % (y % 100, (y + 1) % 100) for y in (YEAR - 1, YEAR - 2, YEAR - 3)],
                                "edge_publicsch.zip", timeout=600, min_bytes=MIN)
    pts, m = _parsed(A.parse_edge_schools, path)
    return _out("nces_edge_schools", "NCES EDGE public school geocodes (all open public schools, no quality ratings)",
                url, m["as_of"], m["rows"], pts, note_of(meta))


def _chr_data_years(ctx, release):
    """'2016-2022' for the Homicides row of the CHR measures PDF of `release`, else None."""
    try:
        path, _ = ctx.fetch(CHR_MEASURES % release, "chr_measures_%d.pdf" % release, min_age=7 * 86400, min_bytes=MIN)
        text = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True, timeout=60).stdout
    except (SourceUnavailable, OSError, subprocess.SubprocessError):
        return None  # the as_of falls back to the release year, labelled as such
    m = re.search(r"Homicides\*?\s.*?(\d{4}-\d{4})", text)
    return m.group(1) if m else None


def chr_homicides(ctx):
    cands = [(CHR_CSV % (y, v), y) for y in (YEAR, YEAR - 1, YEAR - 2) for v in ("_v2", "")]
    url, path, meta = ctx.first([u for u, _ in cands], "chr_analytic.csv", min_bytes=MIN)
    release = dict(cands)[url]
    data, m = _parsed(A.parse_chr_homicides, path)
    years = _chr_data_years(ctx, release)
    return _out("chr_homicides", "County Health Rankings %d, homicides per 100,000 (NCHS mortality files), "
                "county-level crime proxy" % release, url, years or "%d release" % release, m["rows"],
                {"map": data, "release": str(release)},
                ("data years %s per the CHR measures list" % years) if years else
                "data years not read from the CHR measures list; as_of is the release year", level="county")


def loader(sid):
    """The load(ctx) of one wrapped legacy source."""
    return globals()[sid]
