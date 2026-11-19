"""Shared county list from the Census gazetteer (a helper, not a source: the runner skips files that start with _).

Used where a publisher names counties by state and name instead of FIPS (EPA AirData) or applies a record to every county
of a state (FEMA statewide declarations).
"""
import io
import re
import zipfile

from ctx import SourceUnavailable

URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/%d_Gazetteer/%d_Gaz_counties_national.zip"
_SUFFIXES = (" county", " parish", " borough", " census area", " municipality", " city and borough", " municipio",
             " island")


STATE_USPS = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO",
    "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC", "Florida": "FL", "Georgia": "GA",
    "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY",
    "Louisiana": "LA", "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
    "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH",
    "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND",
    "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI",
    "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT",
    "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
    "Puerto Rico": "PR", "Virgin Islands": "VI", "Guam": "GU", "American Samoa": "AS",
    "Northern Mariana Islands": "MP",
}


def by_state_name(counties):
    """{(USPS, normalised name): fips}; where two counties share a key (county and independent city) the type-word key stays distinct."""
    return {(info["state"], info["key"]): fips for fips, info in counties.items()}


def norm(name):
    """Lower-case county name without its type word and punctuation: 'St. Louis County' -> 'st louis'."""
    text = re.sub(r"[^a-z0-9 ]", "", (name or "").lower().replace("saint ", "st ").replace(".", ""))
    text = re.sub(r"\s+", " ", text).strip()
    for suffix in _SUFFIXES:
        if text.endswith(suffix):
            text = text[: -len(suffix)].strip()
    return text


def parse(path, min_rows=3000):
    """Gazetteer zip -> {fips: {"state": "CA", "name": "Orange County", "key": "orange"}}."""
    out = {}
    with zipfile.ZipFile(path) as zf:
        with zf.open(zf.namelist()[0]) as raw:
            lines = io.TextIOWrapper(raw, encoding="latin-1")
            head = next(lines).rstrip("\r\n")
            sep = "|" if "|" in head else "\t"
            cols = [c.strip() for c in head.split(sep)]
            if not {"USPS", "GEOID", "NAME"} <= set(cols):
                raise SourceUnavailable("county gazetteer has unexpected columns")
            iu, ig, inm = cols.index("USPS"), cols.index("GEOID"), cols.index("NAME")
            for line in lines:
                parts = line.rstrip("\r\n").split(sep)
                if len(parts) <= max(iu, ig, inm):
                    continue
                fips = parts[ig].strip()
                if len(fips) == 5 and fips.isdigit():
                    out[fips] = {"state": parts[iu].strip(), "name": parts[inm].strip(), "key": norm(parts[inm])}
    if len(out) < min_rows:
        raise SourceUnavailable("county gazetteer has %d rows, expected about 3,200" % len(out))
    return out


def counties(ctx):
    _, path, _ = ctx.first([URL % (y, y) for y in (ctx.year, ctx.year - 1, ctx.year - 2)], "gaz_counties.zip",
                           timeout=120, min_bytes=10000)
    return parse(path)
