"""Shared reader for BEA Regional bulk zips (CAINC1, CAGDP2): the all-areas CSV has one row per area and line code
with one column per year. Used by bea_cainc1 and bea_cagdp2. Not a source: the runner skips files starting with _."""
import csv
import io
import zipfile

from ctx import SourceUnavailable, num


def read_lines(path, line_codes):
    """-> ({fips: {line_code: {year: value}}}, [years]). Only county areas (5-digit FIPS not ending 000) and the wanted
    line codes are kept. '(NA)' and '(D)' cells are None. BEA's combined independent-city areas keep BEA's own code."""
    with zipfile.ZipFile(path) as zf:
        names = [n for n in zf.namelist() if "ALL_AREAS" in n and n.endswith(".csv")]
        if not names:
            raise SourceUnavailable("BEA zip has no all-areas CSV")
        with zf.open(names[0]) as raw:
            reader = csv.reader(io.TextIOWrapper(raw, encoding="latin-1"))
            head = next(reader, None)
            if not head or head[0] != "GeoFIPS" or "LineCode" not in head:
                raise SourceUnavailable("BEA file has no GeoFIPS and LineCode columns")
            year_cols = {int(h): i for i, h in enumerate(head) if h.strip().isdigit()}
            if not year_cols:
                raise SourceUnavailable("BEA file has no year columns")
            line = head.index("LineCode")
            out = {}
            for row in reader:
                if len(row) < len(head):
                    continue
                fips = row[0].replace('"', "").strip()
                if len(fips) != 5 or not fips.isdigit() or fips.endswith("000"):
                    continue
                code = row[line].strip()
                if code in line_codes:
                    out.setdefault(fips, {})[code] = {y: num(row[i]) for y, i in year_cols.items()}
    return out, sorted(year_cols)


def latest_year(rows, code, years, share=0.8):
    """Newest year in which more than `share` of the areas report line `code`."""
    for y in sorted(years, reverse=True):
        if sum(1 for r in rows.values() if (r.get(code) or {}).get(y) is not None) > share * len(rows):
            return y
    return max(years)
