"""Raw download cache for the national housing producer (deck-feed-housing-national).

Every public bulk file is kept under ~/.cache/deck-housing-national/ with a sidecar `<name>.meta.json` holding the
URL, ETag, Last-Modified and fetch time. A refetch sends If-None-Match / If-Modified-Since, so an unchanged file
costs one 304. Inside `min_age` seconds of the last check the cached copy is used without any request.
A failed download never replaces a good cached file; the caller decides whether a stale copy is acceptable.

`read_xlsx_rows` is a small stdlib reader for the first worksheet of an .xlsx file (HUD and FHFA publish only xlsx and
this host has no openpyxl).
"""
import email.utils
import json
import os
import re
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

CACHE_DIR = os.path.expanduser("~/.cache/deck-housing-national")
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "Accept": "*/*"}
DEFAULT_MIN_AGE = 20 * 3600


class SourceUnavailable(Exception):
    """A source could not be read. The message is safe to publish in manifest.sources[].reason."""


def short(exc, limit=160):
    text = re.sub(r"\s+", " ", str(exc) or exc.__class__.__name__).strip()
    return text[:limit]


def _paths(name, cache_dir):
    os.makedirs(cache_dir, mode=0o700, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", name)[:160]
    return os.path.join(cache_dir, safe), os.path.join(cache_dir, safe + ".meta.json")


def _load_meta(path):
    try:
        with open(path, encoding="utf8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def _save_meta(path, meta):
    tmp = "%s.%d.tmp" % (path, os.getpid())
    with open(tmp, "w", encoding="utf8") as fh:
        json.dump(meta, fh)
    os.replace(tmp, path)


def fetch(url, name, min_age=DEFAULT_MIN_AGE, force=False, cache_dir=None, min_bytes=1024, timeout=300,
          opener=urllib.request.urlopen):
    """Return (path, meta) for a cached copy of `url`. meta: {url, etag, last_modified, checked_at, changed_at,
    bytes, status}. status is "fetched", "not_modified" or "cached". Raises SourceUnavailable when nothing usable
    exists (no cached copy and the request failed)."""
    cache_dir = cache_dir or CACHE_DIR
    path, meta_path = _paths(name, cache_dir)
    meta = _load_meta(meta_path)
    have = os.path.exists(path) and os.path.getsize(path) >= min_bytes and meta.get("url") == url
    if have and not force and time.time() - meta.get("checked_at", 0) < min_age:
        return path, dict(meta, status="cached")
    headers = dict(UA)
    if have:
        if meta.get("etag"):
            headers["If-None-Match"] = meta["etag"]
        if meta.get("last_modified"):
            headers["If-Modified-Since"] = meta["last_modified"]
    tmp = "%s.%d.part" % (path, os.getpid())
    try:
        with opener(urllib.request.Request(url, headers=headers), timeout=timeout) as resp:
            if getattr(resp, "status", 200) != 200:
                raise SourceUnavailable("HTTP %s from %s" % (resp.status, urllib.request.urlparse(url).netloc))
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
        _save_meta(meta_path, meta)
        return path, dict(meta, status="fetched")
    except urllib.error.HTTPError as exc:
        if exc.code == 304 and have:
            meta["checked_at"] = int(time.time())
            _save_meta(meta_path, meta)
            return path, dict(meta, status="not_modified")
        reason = "HTTP %d from %s" % (exc.code, urllib.request.urlparse(url).netloc)
    except SourceUnavailable as exc:
        reason = str(exc)
    except Exception as exc:  # noqa: BLE001 - network errors of every kind become a reason
        reason = short(exc)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    if have:
        return path, dict(meta, status="cached", refresh_error=reason)
    raise SourceUnavailable(reason)


def last_modified_date(meta):
    """'YYYY-MM-DD' from the Last-Modified header, else from the fetch time. Used as as_of only when the file itself
    carries no date."""
    lm = meta.get("last_modified")
    if lm:
        try:
            return time.strftime("%Y-%m-%d", email.utils.parsedate_to_datetime(lm).timetuple())
        except (TypeError, ValueError):
            pass
    t = meta.get("changed_at") or meta.get("checked_at")
    return time.strftime("%Y-%m-%d", time.gmtime(t)) if t else None


# ---------------------------------------------------------------- minimal xlsx reader

_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def _col_index(ref):
    n = 0
    for ch in ref:
        if ch.isalpha():
            n = n * 26 + (ord(ch.upper()) - 64)
        else:
            break
    return n - 1


def _first_sheet(zf):
    try:
        wb = ET.fromstring(zf.read("xl/workbook.xml"))
        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        first = wb.find(_NS + "sheets")[0]
        rid = first.get(_REL + "id")
        for rel in rels:
            if rel.get("Id") == rid:
                target = rel.get("Target").lstrip("/")
                return target if target.startswith("xl/") else "xl/" + target
    except (KeyError, IndexError, TypeError, ET.ParseError):
        pass
    return "xl/worksheets/sheet1.xml"


def read_xlsx_rows(path):
    """Yield each row of the first worksheet as a list of strings ('' for empty cells)."""
    with zipfile.ZipFile(path) as zf:
        shared = []
        if "xl/sharedStrings.xml" in zf.namelist():
            for _, el in ET.iterparse(zf.open("xl/sharedStrings.xml")):
                if el.tag == _NS + "si":
                    shared.append("".join(t.text or "" for t in el.iter(_NS + "t")))
                    el.clear()
        with zf.open(_first_sheet(zf)) as fh:
            for _, el in ET.iterparse(fh):
                if el.tag != _NS + "row":
                    continue
                cells = {}
                for c in el.findall(_NS + "c"):
                    kind, ref = c.get("t"), c.get("r") or ""
                    if kind == "inlineStr":
                        val = "".join(t.text or "" for t in c.iter(_NS + "t"))
                    else:
                        v = c.find(_NS + "v")
                        val = v.text if v is not None and v.text is not None else ""
                        if kind == "s" and val != "":
                            val = shared[int(val)]
                    cells[_col_index(ref) if ref else len(cells)] = val
                el.clear()
                if cells:
                    width = max(cells) + 1
                    yield [cells.get(i, "") for i in range(width)]
