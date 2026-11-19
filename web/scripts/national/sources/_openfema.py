"""Shared OpenFEMA paging for the FEMA sources (a helper, not a source: the runner skips files that start with _).

OpenFEMA answers csv for any entity. Two paging styles are used:
  keyset_pages: `id gt <last id>` plus `$orderby=id`. Fast on tables with millions of rows (a $skip of 100,000 takes
                27 s a page, a keyset page 3 s) and every page is cached under its own name.
  skip_pages:   `$skip` paging for small tables.
"""
import time
import urllib.parse

from ctx import SourceUnavailable, zfill_zip

BASE = "https://www.fema.gov/api/open/"


def zip5(value):
    """Insurers sometimes report ZIP+4 ('70458-3870'): keep the first five digits."""
    return zfill_zip((value or "").split("-")[0])


def url(entity, select, flt, top, orderby="id", skip=0):
    params = [("$top", str(top)), ("$select", select), ("$orderby", orderby), ("$format", "csv")]
    if flt:
        params.append(("$filter", flt))
    if skip:
        params.append(("$skip", str(skip)))
    return BASE + entity + "?" + "&".join("%s=%s" % (k, urllib.parse.quote(v, safe=",")) for k, v in params)


def count_and_last_id(path):
    """(rows, last numeric id) of a csv page whose first column is the numeric id."""
    with open(path, "rb") as fh:
        lines = fh.read().strip().split(b"\n")
    if len(lines) <= 1:
        return 0, 0
    try:
        return len(lines) - 1, int(lines[-1].split(b",", 1)[0])
    except ValueError:
        raise SourceUnavailable("OpenFEMA page did not end with a numeric id")


def _fetch(ctx, url_, name, min_age, tries=4):
    """ctx.fetch with a patient retry: OpenFEMA answers 503 or times out now and then on big pages."""
    delay = 15
    for attempt in range(tries):
        try:
            return ctx.fetch(url_, name, min_age=min_age, timeout=290, min_bytes=10)
        except SourceUnavailable as exc:
            if attempt == tries - 1 or "HTTP 4" in str(exc):  # a 4xx will not get better by asking again
                raise
            ctx.log("%s: %s, retrying in %d s" % (name, exc, delay))
            time.sleep(delay)
            delay *= 2


def keyset_pages(ctx, entity, select, flt, name, top, min_age, t0=None, deadline=None, pause=0.4):
    """Yield the cached csv path of every page of `flt`, walking ids upward. `select` must start with id.
    With a deadline (seconds since t0) a slow cold run stops with SourceUnavailable and the next run resumes from cache."""
    after = 0
    while True:
        if deadline and time.time() - t0 > deadline:
            raise SourceUnavailable("%s is still warming its cache (stopped at id %d); the next run resumes" % (name, after))
        full = ("%s and id gt %d" % (flt, after)) if flt else ("id gt %d" % after)
        path, meta = _fetch(ctx, url(entity, select, full, top), "%s_after_%d.csv" % (name, after), min_age)
        rows, last_id = count_and_last_id(path)
        if rows:
            yield path
        if meta.get("status") == "fetched":
            time.sleep(pause)
        if rows < top:
            return
        after = last_id


def skip_pages(ctx, entity, select, flt, orderby, name, top, min_age, pause=0.4):
    """Yield csv paths page by page with $skip (tables of a few hundred thousand rows at most)."""
    skip = 0
    while True:
        path, meta = _fetch(ctx, url(entity, select, flt, top, orderby, skip), "%s_skip_%d.csv" % (name, skip), min_age)
        with open(path, "rb") as fh:
            rows = max(0, len(fh.read().strip().split(b"\n")) - 1)
        if rows:
            yield path
        if meta.get("status") == "fetched":
            time.sleep(pause)
        if rows < top:
            return
        skip += top
