"""Shared metro name to CBSA code matcher (a helper, not a source: the runner skips files that start with _).

Publishers that name a metro by text ("Los Angeles, CA") and not by code are matched against the Census OMB delineation
list 1 (the same workbook census_cbsa reads). Zillow, Redfin and Realtor.com name a metro by its first principal city and
state, so "Los Angeles, CA" is the CBSA "Los Angeles-Long Beach-Anaheim, CA". A name that does not match one CBSA is
dropped by the caller and counted; it is never guessed.
"""
import re

from _xlsx import read_xlsx_rows
from ctx import SourceUnavailable

URL = "https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/%d/delineation-files/list1_%d.xlsx"
MIN_CBSAS = 900  # the 2023 list carries 935 CBSAs (393 metropolitan, 542 micropolitan)


def norm(text):
    """Lower-case name with punctuation and type words flattened: 'St. Louis' -> 'st louis'."""
    low = (text or "").lower().replace("saint ", "st ").replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", " ", low).strip()


def parse(path, min_cbsas=None):
    """Delineation workbook -> {cbsa: {"title": "Aberdeen, SD", "kind": "metro" | "micro", "states": ["SD"]}}."""
    out, header = {}, None
    for row in read_xlsx_rows(path):
        if header is None:
            if "CBSA Code" in row:
                header = {h.strip(): i for i, h in enumerate(row) if h}
            continue

        def cell(name):
            i = header.get(name)
            return (row[i] if i is not None and i < len(row) and row[i] else "").strip()

        code, title = cell("CBSA Code"), cell("CBSA Title")
        if not (code.isdigit() and len(code) == 5 and "," in title) or code in out:
            continue
        states = [s.strip() for s in title.rpartition(",")[2].split("-") if s.strip()]
        kind = "metro" if cell("Metropolitan/Micropolitan Statistical Area").startswith("Metropolitan") else "micro"
        out[code] = {"title": title, "kind": kind, "states": states}
    if len(out) < (MIN_CBSAS if min_cbsas is None else min_cbsas):
        raise SourceUnavailable("CBSA delineation parsed to %d areas (expected about 935)" % len(out))
    return out


def index(cbsas):
    """-> (full, single): full[(state, name)] lists codes whose title starts with name (first principal city, then each
    longer hyphen prefix, then the whole city part); single[(state, name)] lists codes where name is any one city in the
    title. A state is any state the title names."""
    full, single = {}, {}
    for code, info in cbsas.items():
        left = info["title"].rpartition(",")[0]
        parts = [p for p in re.split(r"[-/]", left) if p.strip()]
        firsts = {norm(left)} | {norm(" ".join(parts[:k])) for k in range(1, len(parts) + 1)}
        for state in info["states"]:
            for name in firsts:
                full.setdefault((state, name), []).append(code)
            for name in {norm(p) for p in parts}:
                single.setdefault((state, name), []).append(code)
    return full, single


def _pick(codes, cbsas, state):
    """One code from candidates: a metropolitan area before a micropolitan one, then the title whose first state is
    `state`. None when it is still ambiguous."""
    for keep in (lambda c: cbsas[c]["kind"] == "metro", lambda c: cbsas[c]["states"][0] == state):
        narrowed = [c for c in codes if keep(c)]
        if narrowed:
            codes = narrowed
    return codes[0] if len(set(codes)) == 1 else None


def match(idx, cbsas, region_name, state_name=""):
    """Zillow-style 'City, ST' (plus a separate state column) -> 5-digit CBSA code or None."""
    full, single = idx
    city, _, suffix = (region_name or "").rpartition(",")
    suffix = suffix.strip()
    if not city:
        city, suffix = region_name or "", ""
    name = norm(city)
    states = [s for s in dict.fromkeys([suffix.split("-")[0].strip(), (state_name or "").strip()]) if s]
    for table in (full, single):
        for state in states:
            hits = table.get((state, name))
            if hits:
                code = _pick(hits, cbsas, state)
                if code:
                    return code
    return None


def resolver(cbsas):
    """-> (resolve(region_name, state_name) -> CBSA code or None, memo {(region_name, state_name): code or None}).
    One CBSA goes to one region: the first region asked wins, so a second Zillow name for the same CBSA is dropped."""
    idx, memo, claimed = index(cbsas), {}, set()

    def resolve(name, state=""):
        key = (name, state)
        if key not in memo:
            code = match(idx, cbsas, name, state)
            if code in claimed:
                code = None
            elif code:
                claimed.add(code)
            memo[key] = code
        return memo[key]

    return resolve, memo


def load(ctx):
    """Fetch the newest delineation list -> ({cbsa: info} as in parse, vintage year text of the list used)."""
    url, path, _ = ctx.first([URL % (y, y) for y in range(ctx.year, 2022, -1)], "cbsa_list1.xlsx", min_bytes=10000)
    return parse(path), re.search(r"/(\d{4})/delineation", url).group(1)
