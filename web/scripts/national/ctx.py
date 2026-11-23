#!/usr/bin/env python3
"""Source plugin context and standalone runner for the Deck national dataset (program 2026-11-14).

A source is one Python file that exposes `SOURCE` (a dict) and `load(ctx)` (see SPEC.md beside this file).
This module gives a source everything it may touch: cached downloads, cached JSON calls, ArcGIS paging, API keys by
name, and ZIP centroids. Stdlib only. The core runner imports the same `Ctx`, so a source that runs here runs there.

Run one source by hand:
    lowprio python3 ctx.py path/to/source.py [--force] [--out result.json] [--sample 3]
It prints status, as_of, rows, how many geographies came back and the coverage of every field.
"""
import hashlib
import importlib.util
import io
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

CACHE_ROOT = os.path.expanduser(os.environ.get("DECK_DATA_CACHE", "~/.cache/deck-data"))
# Kept fresh by the census_gazetteer plugin; the old collector's copy is the fallback until the cache is seeded.
GAZ_CACHE = os.path.join(CACHE_ROOT, "census_gazetteer", "gaz_zcta.zip")
GAZ_CACHE_OLD = os.path.expanduser("~/.cache/deck-housing-national/gaz_zcta.zip")
GAZ_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/%d_Gazetteer/%d_Gaz_zcta_national.zip"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "Accept": "*/*"}
# sec.gov and api.weather.gov ask for a contact in the User-Agent (same string the markets-filings feed already sends).
CONTACT_UA = {"User-Agent": "pixel-deck-feed (read-only; tanner@meshvault.ai)", "Accept": "*/*"}
# Hosts that need a different User-Agent. FRED hangs on browser strings and answers a curl string (probed 2026-11-14).
HOST_UA = {"fred.stlouisfed.org": {"User-Agent": "curl/8.5.0", "Accept": "*/*"},
           "www.sec.gov": CONTACT_UA, "data.sec.gov": CONTACT_UA, "efts.sec.gov": CONTACT_UA,
           "api.weather.gov": CONTACT_UA}
DEFAULT_MIN_AGE = 20 * 3600
LEVELS = ("zip", "tract", "county", "cbsa", "state", "us")
UNITS = ("usd", "usd_month", "usd_sqft", "pct", "pct_pts", "count", "ratio", "index", "days", "years", "year", "score",
         "per_1k", "per_100k", "sqft", "acres", "kwh_cents", "text", "flag", "date")
AGGS = ("sum", "pop_weighted_mean", "pop_weighted_median", "ratio_of_sums", "none")
NATIVES = ("zip3", "block", "blockgroup", "point", "place")  # optional SOURCE["native"]: the publisher's own geography


class SourceUnavailable(Exception):
    """A source could not be read. The message is safe to publish in the manifest."""


class NeedsKey(SourceUnavailable):
    def __init__(self, env):
        super().__init__("needs the API key %s (not set)" % env)
        self.env = env


def short(exc, limit=160):
    return re.sub(r"\s+", " ", str(exc) or exc.__class__.__name__).strip()[:limit]


def _safe(name):
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name)[:140]


class Ctx:
    def __init__(self, source_id, force=False, cache_root=None, quiet=False):
        self.source_id = source_id
        self.force = force
        self.cache_dir = os.path.join(cache_root or CACHE_ROOT, _safe(source_id))
        os.makedirs(self.cache_dir, mode=0o700, exist_ok=True)
        self.year = int(time.strftime("%Y"))
        self.quiet = quiet
        self.requests = 0
        self._zip_points = None
        self._grid = None

    # ------------------------------------------------------------ small helpers
    def log(self, msg):
        if not self.quiet:
            print("[%s] %s" % (self.source_id, msg), file=sys.stderr, flush=True)

    def key(self, env):
        """API key from the environment by NAME, or None. Never log the value."""
        return os.environ.get(env) or None

    def need_key(self, env):
        val = self.key(env)
        if not val:
            raise NeedsKey(env)
        return val

    def _paths(self, name):
        path = os.path.join(self.cache_dir, _safe(name))
        return path, path + ".meta.json"

    # ------------------------------------------------------------ downloads
    def fetch(self, url, name=None, min_age=DEFAULT_MIN_AGE, timeout=300, min_bytes=64, headers=None, data=None):
        """Cached conditional download. Returns (path, meta). meta: url, etag, last_modified, checked_at, changed_at,
        bytes, status ("fetched" | "not_modified" | "cached"), refresh_error when a stale copy is served.
        Raises SourceUnavailable when no usable copy exists. `data` (bytes) makes it a POST (cached by body hash)."""
        if name is None:
            tail = os.path.basename(urllib.parse.urlparse(url).path) or "index"
            digest = hashlib.sha1((url + (data or b"").decode("utf8", "replace")).encode()).hexdigest()[:10]
            name = "%s-%s" % (digest, tail)
        path, meta_path = self._paths(name)
        try:
            with open(meta_path, encoding="utf8") as fh:
                meta = json.load(fh)
        except (OSError, ValueError):
            meta = {}
        have = os.path.exists(path) and os.path.getsize(path) >= min_bytes and meta.get("url") == url
        if have and not self.force and time.time() - meta.get("checked_at", 0) < min_age:
            return path, dict(meta, status="cached")
        hdrs = dict(HOST_UA.get(urllib.parse.urlparse(url).netloc, UA))
        hdrs.update(headers or {})
        if have and data is None:
            if meta.get("etag"):
                hdrs["If-None-Match"] = meta["etag"]
            if meta.get("last_modified"):
                hdrs["If-Modified-Since"] = meta["last_modified"]
        tmp = "%s.%d.part" % (path, os.getpid())
        self.requests += 1
        try:
            req = urllib.request.Request(url, headers=hdrs, data=data)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                with open(tmp, "wb") as fh:
                    while True:
                        chunk = resp.read(1 << 20)
                        if not chunk:
                            break
                        fh.write(chunk)
                etag, lastmod = resp.headers.get("ETag"), resp.headers.get("Last-Modified")
            size = os.path.getsize(tmp)
            if size < min_bytes:
                raise SourceUnavailable("body of %d bytes is too small to be a data file" % size)
            os.chmod(tmp, 0o600)
            os.replace(tmp, path)
            now = int(time.time())
            meta = {"url": url, "etag": etag, "last_modified": lastmod, "checked_at": now, "changed_at": now, "bytes": size}
            with open(meta_path, "w", encoding="utf8") as fh:
                json.dump(meta, fh)
            return path, dict(meta, status="fetched")
        except urllib.error.HTTPError as exc:
            if exc.code == 304 and have:
                meta["checked_at"] = int(time.time())
                with open(meta_path, "w", encoding="utf8") as fh:
                    json.dump(meta, fh)
                return path, dict(meta, status="not_modified")
            reason = "HTTP %d from %s" % (exc.code, urllib.parse.urlparse(url).netloc)
        except SourceUnavailable as exc:
            reason = str(exc)
        except Exception as exc:  # noqa: BLE001 - every network error becomes a publishable reason
            reason = short(exc)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        if have:
            return path, dict(meta, status="cached", refresh_error=reason)
        raise SourceUnavailable(reason)

    def first(self, urls, name=None, **kw):
        """First URL that answers (pass newest vintage first). Returns (url, path, meta)."""
        reasons = []
        for url in urls:
            try:
                path, meta = self.fetch(url, name, **kw)
                return url, path, meta
            except SourceUnavailable as exc:
                reasons.append("%s: %s" % (url.rsplit("/", 1)[-1][:60], exc))
        raise SourceUnavailable("; ".join(reasons)[:300])

    def get_json(self, url, name=None, **kw):
        """Cached GET (or POST with data=) that returns parsed JSON."""
        path, _ = self.fetch(url, name, **kw)
        try:
            with open(path, encoding="utf8") as fh:
                return json.load(fh)
        except ValueError as exc:
            os.unlink(path)  # never keep an unparseable body as a good copy
            raise SourceUnavailable("not JSON from %s (%s)" % (urllib.parse.urlparse(url).netloc, short(exc, 60)))

    def arcgis(self, layer_url, where="1=1", fields="*", page=2000, order_by="OBJECTID", max_rows=None, geometry=False,
               min_age=DEFAULT_MIN_AGE, pause=0.2):
        """Yield attribute dicts from an ArcGIS FeatureServer or MapServer layer (`.../FeatureServer/0`), page by page.
        With geometry=True points get `_lon` and `_lat` (WGS84). Each page is cached like any download."""
        base = layer_url.rstrip("/") + "/query"
        offset, seen = 0, 0
        while True:
            params = {"where": where, "outFields": fields, "f": "json", "resultOffset": offset, "resultRecordCount": page,
                      "returnGeometry": "true" if geometry else "false", "outSR": 4326}
            if order_by:
                params["orderByFields"] = order_by
            url = base + "?" + urllib.parse.urlencode(params)
            body = self.get_json(url, min_age=min_age, timeout=180)
            if body.get("error"):
                raise SourceUnavailable("ArcGIS error %s" % short(body["error"].get("message") or body["error"], 100))
            feats = body.get("features") or []
            for feat in feats:
                row = feat.get("attributes") or {}
                geom = feat.get("geometry") or {}
                if geometry and "x" in geom:
                    row["_lon"], row["_lat"] = geom.get("x"), geom.get("y")
                yield row
                seen += 1
                if max_rows and seen >= max_rows:
                    return
            if not feats or not (body.get("exceededTransferLimit") or len(feats) >= page):
                return
            offset += len(feats)
            time.sleep(pause)

    # ------------------------------------------------------------ ZIP centroids
    def zip_points(self):
        """{zip: (lat, lon)} for every Census ZCTA (gazetteer internal point)."""
        if self._zip_points is None:
            path = GAZ_CACHE if os.path.exists(GAZ_CACHE) else GAZ_CACHE_OLD
            if not os.path.exists(path):
                _, path, _ = Ctx("census_gazetteer", quiet=True).first(
                    [GAZ_URL % (y, y) for y in (self.year, self.year - 1, self.year - 2)], "gaz_zcta.zip")
            pts = {}
            with zipfile.ZipFile(path) as zf:
                with zf.open(zf.namelist()[0]) as fh:
                    lines = io.TextIOWrapper(fh, encoding="latin-1")
                    first_line = next(lines).rstrip("\n")
                    sep = "|" if "|" in first_line else "\t"  # the gazetteer switched from tabs to pipes in 2026
                    head = [h.strip() for h in first_line.split(sep)]
                    ilat, ilon = head.index("INTPTLAT"), head.index("INTPTLONG")
                    for line in lines:
                        parts = line.rstrip("\n").split(sep)
                        try:
                            pts[parts[0].strip().zfill(5)] = (float(parts[ilat]), float(parts[ilon]))
                        except (ValueError, IndexError):
                            continue
            self._zip_points = pts
        return self._zip_points

    def nearest_zip(self, lat, lon, max_km=25.0):
        """ZIP whose centroid is nearest to a point, or None beyond max_km. Use the record's own ZIP when it has one;
        this is the fallback for point data without a ZIP."""
        if lat is None or lon is None:
            return None
        if self._grid is None:
            grid = {}
            for z, (la, lo) in self.zip_points().items():
                grid.setdefault((int(math.floor(la * 4)), int(math.floor(lo * 4))), []).append((z, la, lo))
            self._grid = grid
        gi, gj = int(math.floor(lat * 4)), int(math.floor(lon * 4))
        best, best_d = None, max_km
        coslat = math.cos(math.radians(lat))
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for z, la, lo in self._grid.get((gi + di, gj + dj), ()):
                    d = 111.2 * math.hypot(la - lat, (lo - lon) * coslat)
                    if d < best_d:
                        best, best_d = z, d
        return best


def zfill_zip(value):
    """'501' -> '00501'; returns None unless the result is 5 digits."""
    text = re.sub(r"\D", "", str(value or "").split("-")[0])
    if not text or len(text) > 5:
        return None
    return text.zfill(5)


def num(value):
    """Parse a publisher number ('1,234', '$5.2', '12%', '', 'NA', '-') to float, or None."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return None if isinstance(value, float) and math.isnan(value) else float(value)
    text = str(value).strip().replace(",", "").replace("$", "").replace("%", "")
    if text in ("", "NA", "N/A", "null", "None", "-", "--", ".", "(D)", "(S)", "(X)", "D", "S", "N"):
        return None
    try:
        out = float(text)
    except ValueError:
        return None
    return None if math.isnan(out) or math.isinf(out) else out


# ------------------------------------------------------------ validation and CLI

def check_source(source):
    """Return a list of problems with a SOURCE dict (empty when it follows SPEC.md)."""
    bad = []
    for key in ("id", "name", "publisher", "homepage", "level", "group", "cadence", "license", "fields"):
        if not source.get(key):
            bad.append("SOURCE.%s is missing" % key)
    if source.get("id") and not re.fullmatch(r"[a-z][a-z0-9_]{2,40}", source["id"]):
        bad.append("SOURCE.id must be snake_case, 3 to 41 characters")
    if source.get("level") not in LEVELS:
        bad.append("SOURCE.level must be one of %s" % ", ".join(LEVELS))
    if source.get("native") is not None and source["native"] not in NATIVES + LEVELS:
        bad.append("SOURCE.native must be one of %s" % ", ".join(NATIVES + LEVELS))
    if source.get("tract_vintage") is not None and (source.get("level") != "tract" or source["tract_vintage"] not in (2010, 2020)):
        bad.append("SOURCE.tract_vintage must be 2010 or 2020 and only on a tract-level source")
    for name, spec in (source.get("fields") or {}).items():
        if not re.fullmatch(r"[a-z][a-z0-9_]{1,48}", name):
            bad.append("field %s: name must be snake_case" % name)
        if not spec.get("label"):
            bad.append("field %s: label missing" % name)
        if spec.get("unit") not in UNITS:
            bad.append("field %s: unit must be one of %s" % (name, ", ".join(UNITS)))
        if spec.get("agg", "none") not in AGGS:
            bad.append("field %s: agg must be one of %s" % (name, ", ".join(AGGS)))
    return bad


def check_result(source, result):
    bad = []
    if not isinstance(result, dict) or not isinstance(result.get("data"), dict):
        return ["load() must return a dict with a `data` dict"]
    if not result.get("as_of"):
        bad.append("result.as_of is missing (the period the publisher states)")
    width = {"zip": 5, "tract": 11, "county": 5, "cbsa": 5, "state": 2}.get(source["level"])
    declared = set(source["fields"])
    extra, bad_keys = set(), 0
    for geo, row in result["data"].items():
        if source["level"] == "us":
            if geo != "US":
                bad_keys += 1
        elif not isinstance(geo, str) or len(geo) != width:
            bad_keys += 1
        extra.update(k for k in row if k not in declared)
    if bad_keys:
        bad.append("%d data keys do not look like a %s id" % (bad_keys, source["level"]))
    if extra:
        bad.append("fields not declared in SOURCE.fields: %s" % ", ".join(sorted(extra)[:12]))
    for geo, series in (result.get("hist") or {}).items():
        for field, points in series.items():
            if len(points) > 72:
                bad.append("hist %s has %d points for %s (72 at most)" % (field, len(points), geo))
                break
    return bad


def load_module(path):
    spec = importlib.util.spec_from_file_location("deck_source_" + _safe(os.path.basename(path))[:-3], path)
    mod = importlib.util.module_from_spec(spec)
    sys.path.insert(0, os.path.dirname(os.path.abspath(path)))
    spec.loader.exec_module(mod)
    return mod


def run_source(path, force=False):
    """Run one source file. Returns a report dict: id, status, reason, as_of, rows, geos, coverage, seconds, problems."""
    t0 = time.time()
    mod = load_module(path)
    source = getattr(mod, "SOURCE", None) or {}
    report = {"id": source.get("id"), "level": source.get("level"), "status": "ok", "reason": None,
              "problems": check_source(source)}
    if report["problems"]:
        report["status"] = "invalid"
        return report, None
    ctx = Ctx(source["id"], force=force)
    try:
        result = mod.load(ctx)
    except NeedsKey as exc:
        report.update(status="needs_key", reason=str(exc), key_env=exc.env)
        return report, None
    except SourceUnavailable as exc:
        report.update(status="unavailable", reason=short(exc))
        return report, None
    report["problems"] = check_result(source, result)
    data = result.get("data") or {}
    cover = {}
    for row in data.values():
        for key, val in row.items():
            if val is not None:
                cover[key] = cover.get(key, 0) + 1
    report.update(as_of=result.get("as_of"), rows=result.get("rows"), geos=len(data), coverage=cover,
                  note=result.get("note"), requests=ctx.requests, seconds=round(time.time() - t0, 1))
    if report["problems"]:
        report["status"] = "invalid"
    return report, result


def main(argv):
    if not argv or argv[0].startswith("-"):
        print(__doc__)
        return 2
    path, force, out, sample = argv[0], "--force" in argv, None, 3
    if "--out" in argv:
        out = argv[argv.index("--out") + 1]
    if "--sample" in argv:
        sample = int(argv[argv.index("--sample") + 1])
    report, result = run_source(path, force)
    print(json.dumps(report, indent=1, sort_keys=True))
    if result:
        for geo in sorted(result["data"])[:sample]:
            print(geo, json.dumps(result["data"][geo], sort_keys=True)[:400])
        if out:
            with open(out, "w", encoding="utf8") as fh:
                json.dump(result, fh)
            print("wrote", out)
    return 0 if report["status"] in ("ok", "needs_key") else 1


if __name__ == "__main__":
    # Run through the importable module so a source's `from ctx import SourceUnavailable` is the same class.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import ctx as _ctx
    sys.exit(_ctx.main(sys.argv[1:]))
