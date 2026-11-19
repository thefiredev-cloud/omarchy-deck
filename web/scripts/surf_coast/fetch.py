"""Polite HTTP with an on-disk cache: one request per second per host, conditional requests, tiered TTLs.

A source that fails keeps its last good body with that body's age; the caller marks it stale.
Cache layout: `<root>/surf_<source>/<key>.body` and `<key>.meta.json` ({at, url, etag, last_modified}).
"""
import collections
import gzip
import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

UA = "pixel-deck-feed (read-only; tanner@meshvault.ai)"
MIN_GAP_S = 1.0


class Result:
    __slots__ = ("body", "at", "fresh", "error", "requested")

    def __init__(self, body, at, fresh, error=None, requested=False):
        self.body, self.at, self.fresh, self.error, self.requested = body, at, fresh, error, requested


def _safe_key(key):
    k = re.sub(r"[^A-Za-z0-9._-]+", "_", key)[:80]
    if k != key:
        k += "-" + hashlib.sha1(key.encode()).hexdigest()[:8]
    return k


class Fetcher:
    def __init__(self, root, now=None, offline=False):
        self.root = root
        self.now = now or int(time.time())
        self.offline = offline
        self.requests = collections.Counter()  # host -> HTTP requests made this run
        self._locks = collections.defaultdict(threading.Lock)
        self._last = {}
        self._guard = threading.Lock()

    def _dir(self, source):
        d = os.path.join(self.root, "surf_" + source)
        os.makedirs(d, mode=0o700, exist_ok=True)
        return d

    def cached(self, source, key):
        """(body, meta) of the last good response, or (None, None)."""
        base = os.path.join(self._dir(source), _safe_key(key))
        try:
            with open(base + ".meta.json") as f:
                meta = json.load(f)
            with open(base + ".body", "rb") as f:
                return f.read().decode("utf-8", "replace"), meta
        except (OSError, ValueError):
            return None, None

    def age(self, source, key):
        _, meta = self.cached(source, key)
        return None if not meta else self.now - int(meta.get("at", 0))

    def _store(self, source, key, url, body, headers):
        base = os.path.join(self._dir(source), _safe_key(key))
        meta = {"at": self.now, "url": url, "etag": headers.get("ETag"), "last_modified": headers.get("Last-Modified")}
        for path, data in ((base + ".body", body.encode("utf-8")), (base + ".meta.json", json.dumps(meta).encode())):
            tmp = path + ".tmp"
            with open(tmp, "wb") as f:
                f.write(data)
            os.chmod(tmp, 0o600)
            os.replace(tmp, path)

    def _touch(self, source, key, meta):
        base = os.path.join(self._dir(source), _safe_key(key))
        meta = dict(meta, at=self.now)
        tmp = base + ".meta.json.tmp"
        with open(tmp, "w") as f:
            json.dump(meta, f)
        os.replace(tmp, base + ".meta.json")

    def _pace(self, host):
        lock = self._locks[host]
        lock.acquire()
        wait = MIN_GAP_S - (time.monotonic() - self._last.get(host, 0.0))
        if wait > 0:
            time.sleep(wait)
        return lock

    def get(self, source, key, url, ttl, timeout=30, headers=None):
        """Cached GET. Within `ttl` the cache answers without a request; on failure the old body comes back
        with `fresh=False` and the error text."""
        body, meta = self.cached(source, key)
        if body is not None and meta and self.now - int(meta.get("at", 0)) < ttl:
            return Result(body, int(meta["at"]), True)
        if self.offline:
            return Result(body, None if not meta else int(meta["at"]), False, "offline run")
        host = urllib.parse.urlsplit(url).netloc
        hdrs = {"User-Agent": UA, "Accept-Encoding": "gzip"}
        if headers:
            hdrs.update(headers)
        if body is not None and meta:
            if meta.get("etag"):
                hdrs["If-None-Match"] = meta["etag"]
            if meta.get("last_modified"):
                hdrs["If-Modified-Since"] = meta["last_modified"]
        lock = self._pace(host)
        try:
            with self._guard:
                self.requests[host] += 1
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                text = raw.decode("utf-8", "replace")
                self._store(source, key, url, text, r.headers)
                return Result(text, self.now, True, requested=True)
        except urllib.error.HTTPError as e:
            if e.code == 304 and body is not None:
                self._touch(source, key, meta)
                return Result(body, self.now, True, requested=True)
            err = "HTTP %d from %s" % (e.code, host)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
            reason = getattr(e, "reason", None) or e.__class__.__name__
            err = "%s from %s" % (str(reason)[:80], host)
        finally:
            self._last[host] = time.monotonic()
            lock.release()
        return Result(body, None if not meta else int(meta["at"]), False, err, requested=True)

    def due(self, source, keys, ttl, cap):
        """Keys whose cache is older than `ttl`, oldest first. Keys with no cache are always due; the rest are
        capped at `cap` per run so a slow tier spreads across runs instead of landing on one."""
        cold, old = [], []
        for k in keys:
            a = self.age(source, k)
            if a is None:
                cold.append(k)
            elif a >= ttl:
                old.append((a, k))
        old.sort(reverse=True)
        return cold + [k for _, k in old[:cap]]
