"""Network and key access for the e-commerce market sources (stdlib only).

Same method names as the Deck source plugin context (`plan/source-plugin/ctx.py`): `fetch`, `get_json`, `key`,
`need_key`, `log`, and the `SourceUnavailable` / `NeedsKey` errors, so a source reads the same way in both places.
Additions for this feed: a per-host pace (at most 2 requests a second to one host), a run deadline, `get_text`,
and `stale_reason`, set when a refresh failed and a cached copy was served instead.

Downloads are cached under `~/.cache/deck-data/ecom_<source id>/` with conditional requests. Keys come from the
environment by name, then from `~/.hermes/.env` (where the owner keeps them). Values are never logged.
"""
import hashlib
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

CACHE_ROOT = os.path.expanduser(os.environ.get("DECK_DATA_CACHE", "~/.cache/deck-data"))
ENV_FILE = os.path.expanduser(os.environ.get("DECK_ECOM_ENV_FILE", "~/.hermes/.env"))
# One honest User-Agent with a contact for every host (sec.gov style). Shopify answers it and 429s browser strings.
CONTACT_UA = {"User-Agent": "pixel-deck-feed/1.0 (read-only; tanner@meshvault.ai)", "Accept": "*/*"}
# FRED hangs on browser strings and answers a curl string (probed 2026-11-14).
HOST_UA = {"fred.stlouisfed.org": {"User-Agent": "curl/8.5.0", "Accept": "*/*"}}
DEFAULT_MIN_AGE = 50 * 60
HOST_GAP = 0.5  # seconds between two requests to one host

_host_lock = threading.Lock()
_host_last = {}


class SourceUnavailable(Exception):
    """A source could not be read. The message is safe to publish in the feed."""


class NeedsKey(SourceUnavailable):
    def __init__(self, envs):
        envs = [envs] if isinstance(envs, str) else list(envs)
        super().__init__("needs %s" % " and ".join(envs))
        self.envs = envs


def short(exc, limit=160):
    return re.sub(r"\s+", " ", str(exc) or exc.__class__.__name__).strip()[:limit]


def _safe(name):
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name)[:140]


def read_env_file(path=None):
    """{NAME: value} from a dotenv file (`export` prefix and quotes allowed). Missing file = {}."""
    out = {}
    try:
        with open(path or ENV_FILE, encoding="utf8") as fh:
            lines = fh.read().splitlines()
    except (OSError, UnicodeDecodeError):
        return out
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, val = line.split("=", 1)
        name = name.strip()
        if name.startswith("export "):
            name = name[7:].strip()
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "'\"":
            val = val[1:-1]
        if re.fullmatch(r"[A-Z][A-Z0-9_]*", name) and val:
            out[name] = val
    return out


def _pace(host):
    with _host_lock:
        wait = _host_last.get(host, 0) + HOST_GAP - time.monotonic()
        _host_last[host] = max(time.monotonic(), _host_last.get(host, 0) + HOST_GAP)
    if wait > 0:
        time.sleep(wait)


class Ctx:
    def __init__(self, source_id, force=False, cache_root=None, quiet=False, deadline=None, environ=None, env_file=None):
        self.source_id = source_id
        self.force = force
        self.cache_dir = os.path.join(cache_root or CACHE_ROOT, "ecom_" + _safe(source_id))
        self.quiet = quiet
        self.deadline = deadline
        self.requests = 0
        self.stale_reason = None
        self._environ = os.environ if environ is None else environ
        self._env_file = env_file
        self._file_env = None

    def log(self, msg):
        if not self.quiet:
            print("[ecom_%s] %s" % (self.source_id, msg), file=sys.stderr, flush=True)

    # ------------------------------------------------------------ keys
    def key(self, env):
        """Key by NAME from the environment, then the owner's env file, or None. Never log the value."""
        val = str(self._environ.get(env, "") or "").strip()
        if val:
            return val
        if self._file_env is None:
            self._file_env = read_env_file(self._env_file)
        return self._file_env.get(env) or None

    def need_key(self, *envs):
        missing = [e for e in envs if not self.key(e)]
        if missing:
            raise NeedsKey(missing)
        vals = [self.key(e) for e in envs]
        return vals[0] if len(vals) == 1 else vals

    # ------------------------------------------------------------ downloads
    def _paths(self, name):
        path = os.path.join(self.cache_dir, _safe(name))
        return path, path + ".meta.json"

    def fetch(self, url, name=None, min_age=DEFAULT_MIN_AGE, timeout=40, min_bytes=16, headers=None, data=None,
              cache=True):
        """Cached conditional download -> (path, meta). meta: url, etag, last_modified, checked_at, bytes, status
        (fetched | not_modified | cached), refresh_error when a stale copy is served. `cache=False` keeps no copy of
        the body beyond this run (Best Buy terms). Raises SourceUnavailable when no usable copy exists."""
        os.makedirs(self.cache_dir, mode=0o700, exist_ok=True)
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
        have = cache and os.path.exists(path) and os.path.getsize(path) >= min_bytes and meta.get("url") == url
        if have and not self.force and time.time() - meta.get("checked_at", 0) < min_age:
            return path, dict(meta, status="cached")
        if self.deadline and time.time() > self.deadline:
            reason = "run time budget used up"
            if have:
                return path, dict(meta, status="cached", refresh_error=reason)
            raise SourceUnavailable(reason)
        host = urllib.parse.urlparse(url).netloc
        hdrs = dict(HOST_UA.get(host, CONTACT_UA))
        hdrs.update(headers or {})
        if have and data is None:
            if meta.get("etag"):
                hdrs["If-None-Match"] = meta["etag"]
            if meta.get("last_modified"):
                hdrs["If-Modified-Since"] = meta["last_modified"]
        tmp = "%s.%d.%d.part" % (path, os.getpid(), threading.get_ident())
        self.requests += 1
        _pace(host)
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
                raise SourceUnavailable("body of %d bytes is too small" % size)
            os.chmod(tmp, 0o600)
            os.replace(tmp, path)
            now = int(time.time())
            meta = {"url": url, "etag": etag, "last_modified": lastmod, "checked_at": now, "bytes": size}
            if cache:
                with open(meta_path, "w", encoding="utf8") as fh:
                    json.dump(meta, fh)
            return path, dict(meta, status="fetched")
        except urllib.error.HTTPError as exc:
            if exc.code == 304 and have:
                meta["checked_at"] = int(time.time())
                with open(meta_path, "w", encoding="utf8") as fh:
                    json.dump(meta, fh)
                return path, dict(meta, status="not_modified")
            reason = "HTTP %d from %s" % (exc.code, host)
        except SourceUnavailable as exc:
            reason = str(exc)
        except Exception as exc:  # noqa: BLE001 - every network error becomes a publishable reason
            reason = "%s (%s)" % (short(exc, 100), host)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        if have:
            self.stale_reason = reason
            return path, dict(meta, status="cached", refresh_error=reason)
        raise SourceUnavailable(reason)

    def get_text(self, url, name=None, **kw):
        path, meta = self.fetch(url, name, **kw)
        with open(path, "rb") as fh:
            body = fh.read()
        if not kw.get("cache", True):
            os.unlink(path)
        return body.decode("utf8", "replace"), meta

    def get_json(self, url, name=None, **kw):
        text, _ = self.get_text(url, name, **kw)
        try:
            return json.loads(text)
        except ValueError as exc:
            path, _ = self._paths(name) if name else (None, None)
            if path and os.path.exists(path):
                os.unlink(path)  # never keep an unparseable body as a good copy
            raise SourceUnavailable("not JSON from %s (%s)" % (urllib.parse.urlparse(url).netloc, short(exc, 60)))
