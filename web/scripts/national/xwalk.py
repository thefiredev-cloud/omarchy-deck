"""Tract and county to ZIP crosswalks for the national dataset v2 (program 2026-11-14).

Weights come from the Census 2020 relationship files (ZCTA5 2020 to tract 2020, ZCTA5 2020 to county 2020), which give
the land area of every ZCTA and geography piece (`AREALAND_PART`). For ZIP z and source geography g:

  geo_share(z, g) = land of the piece / land of g     (the part of g that lies in z)
  zip_share(z, g) = land of the piece / land of z     (the part of z that lies in g)

Water-only geographies (land 0) use water area instead. Behaviors per field (`xwalk` in the field spec, see SPEC.md):

  sum     counts:  value(z) = sum over g of value(g) * geo_share(z, g)   (apportions a count by land)
  mean    rates:   value(z) = sum of value(g) * zip_share(z, g) / sum of zip_share(z, g) over g with a value
  assign  copies the value of the g that holds the largest share of z's land (text, flags, dates, ids)

A ZIP gets a value only when the geographies with a value cover at least MIN_COVER of its land (sum and mean), so a
ZIP that is mostly outside the reported area stays null. ZIPs that are not ZCTAs (PO boxes, unique ZIPs) have no
land: they take county values by `assign`/`mean` from the county the collector already knows for them (GeoNames),
and stay null for `sum`. Land area is a stand-in for where people live; the manifest says so next to each
crosswalked source. The build reweights county `sum` by ZIP population (ACS), and by ZIP jobs (LODES WAC) for sources of
`group: commercial` (`reweighted`, key "county_jobs"); the stats of each to_zip call name the weights used.

cbsa, state and us levels are not pushed down to ZIPs: they attach to the metro, state and US rollups.
"""
import array
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

REL_BASE = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/"
# level -> (file under REL_BASE, target columns stem, target id width, source columns stem, source id width).
# "tract10" maps 2010 tracts onto 2020 tracts (its targets are 2020 tract GEOIDs, not ZIPs); a source with
# SOURCE["tract_vintage"] == 2010 goes through it first, then through "tract".
REL = {
    "tract": ("zcta520/tab20_zcta520_tract20_natl.txt", "ZCTA5_20", 5, "TRACT_20", 11),
    "county": ("zcta520/tab20_zcta520_county20_natl.txt", "ZCTA5_20", 5, "COUNTY_20", 5),
    "tract10": ("tract/tab20_tract20_tract10_natl.txt", "TRACT_20", 11, "TRACT_10", 11),
}
# The national collector already keeps the county file; reuse it instead of a second download.
LEGACY_REL = {"county": os.path.expanduser("~/.cache/deck-housing-national/zcta_county.txt")}
MIN_COVER = 0.5
MODES = ("sum", "mean", "assign")
METHOD_NOTE = ("Tract and county values reach ZIPs through the Census 2020 ZCTA relationship files. Tract counts are "
               "apportioned by the share of each tract's land inside the ZIP; county counts by the ZIP's share of the "
               "county's population (ACS), or of its jobs (LEHD LODES workplace table) for commercial counts. Rates "
               "are averaged by the share of the ZIP inside each tract or county, and text or flags take the largest "
               "piece. A ZIP is left empty when the reporting areas cover less than half of its land.")


def default_mode(spec):
    """The SPEC default: sum for counts, assign for text, flags and dates, mean for every other unit."""
    if spec.get("xwalk") in MODES:
        return spec["xwalk"]
    unit = spec.get("unit")
    if unit == "count":
        return "sum"
    if unit in ("text", "flag", "date"):
        return "assign"
    return "mean"


def _round(value, unit):
    if unit == "count":
        return int(round(value))
    if unit in ("usd", "usd_month", "sqft", "acres"):
        return int(round(value)) if abs(value) >= 100 else round(value, 2)
    return round(value, 4) if abs(value) < 1 else round(value, 2)


class Crosswalk:
    """One relationship file in memory: for every source geography the ZIPs it touches with both shares."""

    def __init__(self, level, pieces, weights="land"):
        """pieces: iterable of (zip, geo, geo_share, zip_share). weights names what `sum` apportions by."""
        self.level = level
        self.weights = weights
        self.geos = set()
        self.by_zip = {}   # zip -> [(geo, geo_share, zip_share)]
        for z, g, gs, zs in pieces:
            self.geos.add(g)
            self.by_zip.setdefault(z, []).append((g, gs, zs))
        self.main = {z: max(parts, key=lambda p: (p[2], p[0]))[0] for z, parts in self.by_zip.items()}

    @classmethod
    def from_rel_file(cls, path, level, min_pieces=30000):
        """Read a Census 2020 relationship file (pipe separated, header row). The national ZCTA-county file has
        46,960 pieces; far fewer means a truncated download."""
        _, tgt, tw, geo, gw_ = REL[level]
        pieces = []
        with open(path, encoding="utf-8-sig", errors="replace") as fh:
            head = fh.readline().rstrip("\r\n").split("|")
            try:
                iz, ig = head.index("GEOID_" + tgt), head.index("GEOID_" + geo)
                izl, izw = head.index("AREALAND_" + tgt), head.index("AREAWATER_" + tgt)
                igl, igw = head.index("AREALAND_" + geo), head.index("AREAWATER_" + geo)
                ipl, ipw = head.index("AREALAND_PART"), head.index("AREAWATER_PART")
            except ValueError as exc:
                raise ValueError("relationship file layout changed: %s" % exc) from None
            for line in fh:
                p = line.rstrip("\r\n").split("|")
                if len(p) <= max(ipw, igw) or not p[iz] or not p[ig]:
                    continue  # a piece of the geography outside every target (ZCTA)
                z, g = p[iz].zfill(tw), p[ig].zfill(gw_)
                try:
                    zl, zw, gl, gw = float(p[izl] or 0), float(p[izw] or 0), float(p[igl] or 0), float(p[igw] or 0)
                    pl, pw = float(p[ipl] or 0), float(p[ipw] or 0)
                except ValueError:
                    continue
                gs = pl / gl if gl > 0 else (pw / gw if gw > 0 else 0.0)
                zs = pl / zl if zl > 0 else (pw / zw if zw > 0 else 0.0)
                if gs > 0 or zs > 0:
                    pieces.append((z, g, gs, zs))
        if len(pieces) < min_pieces:
            raise ValueError("relationship file has only %d pieces" % len(pieces))
        return cls(level, pieces)

    def to_zip(self, data, fields, extra_county=None):
        """data {geo: {field: value}} at this level -> ({zip: {field: value}}, stats).
        fields: {name: spec} from SOURCE.fields. extra_county: {zip: county_fips} for ZIPs that are not ZCTAs
        (county level only). stats: geos_matched, geos_total, zips."""
        modes = {f: default_mode(s) for f, s in fields.items()}
        units = {f: s.get("unit") for f, s in fields.items()}
        out = {}
        matched = sum(1 for g in data if g in self.geos)
        for z, parts in self.by_zip.items():
            rec = {}
            for f, mode in modes.items():
                if mode == "assign":
                    row = data.get(self.main[z])
                    v = row.get(f) if row else None
                    if v is not None:
                        rec[f] = v
                    continue
                acc = cover = 0.0
                seen = False
                for g, gs, zs in parts:
                    row = data.get(g)
                    v = row.get(f) if row else None
                    if v is None or isinstance(v, (str, bool)):
                        continue
                    seen = True
                    cover += zs
                    # mean weighs by the ZIP's share in g; sum apportions g's count by g's share inside the ZIP
                    acc += v * (zs if mode == "mean" else gs)
                if not seen or cover < MIN_COVER:
                    continue
                rec[f] = _round(acc / cover if mode == "mean" else acc, units[f])
            if rec:
                out[z] = rec
        if self.level == "county" and extra_county:
            for z, fips in extra_county.items():
                if z in self.by_zip or not fips:
                    continue
                row = data.get(fips)
                if not row:
                    continue
                rec = {f: row[f] for f, mode in modes.items() if mode != "sum" and row.get(f) is not None}
                if rec:
                    out[z] = rec
        return out, {"geos_total": len(data), "geos_matched": matched, "zips": len(out), "weights": self.weights}

    def main_geo(self, z):
        """The geography holding the largest share of ZIP z's land (used to pick a county series for a ZIP)."""
        return self.main.get(z)


def rel_path(level, ctx_mod=None):
    """Local path of the relationship file for `level`, downloaded once into ~/.cache/deck-data/census_rel2020/."""
    legacy = LEGACY_REL.get(level)
    if legacy and os.path.exists(legacy) and os.path.getsize(legacy) > 1_000_000:
        return legacy
    if ctx_mod is None:
        import ctx as ctx_mod  # noqa: PLC0415 - scripts/national/ctx.py
    rel = REL[level][0]
    name = rel.rsplit("/", 1)[-1]
    path, _ = ctx_mod.Ctx("census_rel2020", quiet=True).fetch(REL_BASE + rel, name, min_age=30 * 86400, timeout=600)
    return path


_CACHE = {}


def get(level):
    """The Crosswalk for 'tract', 'county' or 'tract10', read once per process. 'county_jobs' (the key a commercial
    county source asks for) is the land crosswalk here; the build's getter reweights it by ZIP jobs."""
    level = "county" if level == "county_jobs" else level
    if level not in _CACHE:
        _CACHE[level] = Crosswalk.from_rel_file(rel_path(level), level)
    return _CACHE[level]


def reweighted(xw, weight, label="population"):
    """A copy of a crosswalk whose `sum` apportions by `weight` (ACS population, or LODES jobs, per ZIP) instead of
    land: geo_share(z, g) = weight(z) x zip_share(z, g) / the same summed over the ZIPs of g. A geography whose ZIPs
    carry no weight keeps its land shares. `mean` and `assign` do not change (DataArch section 4)."""
    tot = {}
    for z, parts in xw.by_zip.items():
        w = weight.get(z) or 0
        for g, _, zs in parts:
            tot[g] = tot.get(g, 0.0) + w * zs
    pieces = []
    for z, parts in xw.by_zip.items():
        w = weight.get(z) or 0
        for g, gs, zs in parts:
            pieces.append((z, g, (w * zs / tot[g]) if tot.get(g) else gs, zs))
    return Crosswalk(xw.level, pieces, label)


NAN = float("nan")


class Store:
    """Columnar ZIP table for the v2 build: one array('d') per numeric field (NaN = missing) and one list per text or
    flag field over a fixed, sorted ZIP universe, so 400+ fields stay far under the 6 GB cap.
    meta[field] = {source, level, native, unit, as_of, context}; context fields are metro, state or US values copied
    down for the blend only and never written as ZIP columns."""

    def __init__(self, zips):
        self.zips = sorted(zips)
        self.ix = {z: i for i, z in enumerate(self.zips)}
        self.n = len(self.zips)
        self.num, self.obj, self.meta = {}, {}, {}

    def put(self, field, i, value):
        """Set one cell; None is a no-op. Text or a flag in a numeric column turns the column into a list."""
        if value is None:
            return
        numeric = isinstance(value, (int, float)) and not isinstance(value, bool)
        if field in self.num:
            if numeric:
                self.num[field][i] = value
                return
            self.obj[field] = [None if v != v else v for v in self.num.pop(field)]
        elif field not in self.obj:
            if numeric:
                self.num[field] = array.array("d", [NAN]) * self.n
                self.num[field][i] = value
                return
            self.obj[field] = [None] * self.n
        self.obj[field][i] = value

    def get(self, field, i):
        col = self.num.get(field)
        if col is not None:
            v = col[i]
            return None if v != v else v
        col = self.obj.get(field)
        return col[i] if col is not None else None

    def has(self, field):
        return field in self.num or field in self.obj

    def drop(self, field, i):
        """Clear one cell (a value the validity table rejected)."""
        if field in self.num:
            self.num[field][i] = NAN
        elif field in self.obj:
            self.obj[field][i] = None

    def fields(self):
        return list(self.num) + list(self.obj)

    def values(self, field):
        """[(i, value)] for the present cells of a field."""
        col = self.num.get(field)
        if col is not None:
            return [(i, v) for i, v in enumerate(col) if v == v]
        return [(i, v) for i, v in enumerate(self.obj.get(field) or ()) if v is not None]

    def count(self, field):
        return len(self.values(field))
