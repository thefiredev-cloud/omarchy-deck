"""Shared list of every Census tract GEOID, from the Census gazetteer. Sources that publish only the designated tracts use it
to give every other tract a 0, so a ZIP's share is a true share. Not a source (SPEC rule 12)."""
import io
import zipfile

from ctx import SourceUnavailable

URL_2020 = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/%d_Gazetteer/%d_Gaz_tracts_national.zip"
URL_2010 = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/Gaz_tracts_national.zip"


def parse_gazetteer(path):
    """Gazetteer tract zip (tab or pipe separated) -> sorted list of 11-digit GEOIDs."""
    with zipfile.ZipFile(path) as zf:
        with zf.open(zf.namelist()[0]) as fh:
            lines = io.TextIOWrapper(fh, encoding="latin-1")
            first = next(lines).rstrip("\r\n")
            sep = "|" if "|" in first else "\t"
            head = [h.strip() for h in first.split(sep)]
            if "GEOID" not in head:
                raise SourceUnavailable("tract gazetteer header has no GEOID")
            i = head.index("GEOID")
            out = []
            for line in lines:
                parts = line.rstrip("\r\n").split(sep)
                if len(parts) > i and len(parts[i].strip()) == 11 and parts[i].strip().isdigit():
                    out.append(parts[i].strip())
    if len(out) < 50000:
        raise SourceUnavailable("tract gazetteer had only %d tracts" % len(out))
    return sorted(out)


def fetch_universe(ctx, vintage):
    """Every tract GEOID of the 2020 or the 2010 Census, downloaded once through ctx and cached."""
    if vintage == 2010:
        path, _ = ctx.fetch(URL_2010, "gaz_tracts_2010.zip", timeout=120)
    else:
        _, path, _ = ctx.first([URL_2020 % (y, y) for y in (ctx.year, ctx.year - 1, ctx.year - 2)], "gaz_tracts_2020.zip",
                               timeout=120)
    return parse_gazetteer(path)
