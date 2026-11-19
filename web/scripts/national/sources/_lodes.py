"""Shared helper for the LEHD LODES sources (lodes_wac workplace jobs, lodes_rac resident workers). Not a source: the
runner skips files starting with _.

LODES is published per state and per census block. The state crosswalk file (`<st>_xwalk.csv.gz`) gives the ZCTA of every
block, so the plugins sum blocks to ZIP themselves (SPEC rule 1: the publisher gives the ZIP per row). One state is
streamed at a time. The crosswalk of a state is downloaded once into the shared `lodes_xwalk` cache and used by both
plugins."""
import csv
import gzip
import os

from ctx import Ctx, SourceUnavailable, zfill_zip

BASE = "https://lehd.ces.census.gov/data/lodes/LODES8/%s/%s"
STATES = ("al ak az ar ca co ct de dc fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok "
          "or pa ri sc sd tn tx ut vt va wa wv wi wy").split()
# columns summed per ZIP: total jobs, earnings bands (CE01 <= $1,250 a month, CE02 $1,251-3,333, CE03 > $3,333),
# age bands (CA01 <= 29, CA02 30-54, CA03 55+) and the 20 NAICS sector counts
COLUMNS = (["C000", "CE01", "CE02", "CE03", "CA01", "CA02", "CA03"] + ["CNS%02d" % n for n in range(1, 21)])


def xwalk_ctx(ctx):
    """A context that caches in the shared lodes_xwalk folder next to this source's own cache folder."""
    return Ctx("lodes_xwalk", force=ctx.force, cache_root=os.path.dirname(ctx.cache_dir), quiet=ctx.quiet)


def block_zcta(path):
    """{15-digit block: 5-digit ZCTA} from a state crosswalk. Blocks without a ZCTA (water, unpopulated) are left out."""
    out = {}
    with gzip.open(path, "rt", encoding="utf-8", errors="replace", newline="") as fh:
        reader = csv.reader(fh)
        head = next(reader, None)
        if not head or "tabblk2020" not in head or "zcta" not in head:
            raise SourceUnavailable("LODES crosswalk has no tabblk2020 and zcta columns")
        ib, iz = head.index("tabblk2020"), head.index("zcta")
        for row in reader:
            if len(row) > iz:
                z = zfill_zip(row[iz])
                if z:
                    out[row[ib]] = z
    return out


def sum_by_zip(path, key_column, blocks, into):
    """Add the COLUMNS of one state's WAC (key `w_geocode`) or RAC (key `h_geocode`) file into `into` ({zip: [sums]}).
    -> (blocks read, jobs with no ZCTA)."""
    read = lost = 0
    with gzip.open(path, "rt", encoding="utf-8", errors="replace", newline="") as fh:
        reader = csv.reader(fh)
        head = next(reader, None)
        if not head or key_column not in head or any(c not in head for c in COLUMNS):
            raise SourceUnavailable("LODES file has no %s column or is missing job counts" % key_column)
        ik = head.index(key_column)
        idx = [head.index(c) for c in COLUMNS]
        for row in reader:
            if len(row) <= max(idx):
                continue
            read += 1
            z = blocks.get(row[ik])
            if z is None:
                lost += int(row[idx[0]] or 0)
                continue
            acc = into.get(z)
            if acc is None:
                acc = into[z] = [0] * len(COLUMNS)
            for j, i in enumerate(idx):
                acc[j] += int(row[i] or 0)
    return read, lost


def run(ctx, kind, years):
    """Download and sum every state. `kind` is "wac" or "rac". `years` is the list of file years, newest first; each
    state uses the newest one it has. -> ({zip: sums as a dict by column}, blocks read, jobs without a ZCTA, set of years used)."""
    key = {"wac": "w_geocode", "rac": "h_geocode"}[kind]
    xctx = xwalk_ctx(ctx)
    into, total_read, total_lost, used, missing = {}, 0, 0, set(), []
    for st in STATES:
        xpath, _ = xctx.fetch(BASE % (st, "%s_xwalk.csv.gz" % st), "%s_xwalk.csv.gz" % st, timeout=900)
        path, year = None, None
        for y in years:
            try:
                path, _ = ctx.fetch(BASE % (st, "%s/%s_%s_S000_JT00_%d.csv.gz" % (kind, st, kind, y)),
                                    "%s_%s_%d.csv.gz" % (st, kind, y), timeout=900)
                year = y
                years = [v for v in years if v <= y]  # later states need not retry newer years that 404
                break
            except SourceUnavailable:
                continue
        if path is None:
            missing.append(st)
            continue
        read, lost = sum_by_zip(path, key, block_zcta(xpath), into)
        total_read, total_lost = total_read + read, total_lost + lost
        used.add(year)
        ctx.log("%s %s %d blocks" % (st, year, read))
    if len(missing) > 3:
        raise SourceUnavailable("LODES %s files missing for %d states (%s...)" % (kind, len(missing), ", ".join(missing[:5])))
    return {z: dict(zip(COLUMNS, acc)) for z, acc in into.items()}, total_read, total_lost, used
