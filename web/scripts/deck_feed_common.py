"""Shared helpers for the Pixel Deck feed collectors (deck-feed-*).

Contract: ~/.kodros/status/<dir>/<name>.json, written atomically, mode 600.
Top-level keys on every file: t, refresh, src, errors.

Two directories:
  deck/        owner and fleet feeds served by the Deck itself.
  house-feeds/ public house-wall feeds (surf, hockey, markets, markets-calendar,
               realestate, ecom). Their only readers are the house briefing and the
               Deck; they are canonical here so the briefing never depends on Deck
               storage. Use write_house_feed for these six.
"""
import gzip
import hashlib
import json
import os
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib

OUT_DIR = os.path.expanduser("~/.kodros/status/deck")
# Public house-wall feeds: canonical here, read by the house briefing and by the Deck.
HOUSE_OUT_DIR = os.path.expanduser("~/.kodros/status/house-feeds")
HOUSE_FEEDS = ("surf", "hockey", "markets", "markets-calendar", "realestate", "ecom")
CACHE_DIR = os.path.expanduser("~/.cache/deck-feeds")
GATEWAY = "http://127.0.0.1:8291"
UA_BROWSER = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0 Safari/537.36"
)
UA_PLAIN = "Mozilla/5.0"
UA_FEED = "Mozilla/5.0 (compatible; pixel-deck-feed/1.0)"


class FetchError(Exception):
    """A source failed. The message is safe to publish in `errors`."""


def now():
    return int(time.time())


def short_reason(exc, limit=160):
    text = re.sub(r"\s+", " ", str(exc) or exc.__class__.__name__).strip()
    return text[:limit]


def write_feed(name, refresh, src, errors, payload, out_dir=None):
    out_dir = out_dir or OUT_DIR
    os.makedirs(out_dir, mode=0o700, exist_ok=True)
    doc = {"t": now(), "refresh": refresh, "src": sorted(set(src)), "errors": errors}
    doc.update(payload)
    final = os.path.join(out_dir, name + ".json")
    fd, tmp = tempfile.mkstemp(prefix=name + ".", suffix=".tmp", dir=out_dir)
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))
        os.chmod(tmp, 0o600)
        os.replace(tmp, final)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    return final


def write_house_feed(name, refresh, src, errors, payload):
    """Write one public house-wall feed to HOUSE_OUT_DIR. Only the six allowed names.

    Same atomic tmp+rename, mode 600, and contract keys as write_feed. Deck storage is
    never written for these feeds: the Deck reads HOUSE_OUT_DIR too.
    """
    if name not in HOUSE_FEEDS:
        raise ValueError("house feed %r is not a public house feed" % (name,))
    return write_feed(name, refresh, src, errors, payload, out_dir=HOUSE_OUT_DIR)


def http_get(url, headers=None, timeout=25, data=None):
    """GET (or POST when data is given) and return the body as text."""
    hdrs = {"User-Agent": UA_FEED, "Accept": "*/*"}
    hdrs.update(headers or {})
    req = urllib.request.Request(url, headers=hdrs, data=data)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
        # Some origins (sandiegogulls.com CDN, intermittently) answer with a gzip body even
        # though no Accept-Encoding was sent. Sniff the magic bytes so the caller gets text.
        if body[:2] == b"\x1f\x8b":
            body = gzip.decompress(body)
        return body.decode("utf-8", "replace")
    except (gzip.BadGzipFile, EOFError, zlib.error) as exc:
        raise FetchError("bad gzip body from %s" % urllib.parse.urlsplit(url).netloc) from exc
    except urllib.error.HTTPError as exc:
        raise FetchError("HTTP %d from %s" % (exc.code, urllib.parse.urlsplit(url).netloc)) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise FetchError("%s from %s" % (short_reason(getattr(exc, "reason", exc), 80),
                                         urllib.parse.urlsplit(url).netloc)) from exc


def http_json(url, headers=None, timeout=25):
    body = http_get(url, headers, timeout)
    try:
        return json.loads(body)
    except ValueError as exc:
        raise FetchError("bad JSON from %s" % urllib.parse.urlsplit(url).netloc) from exc


def gateway_fetch(engine, url, timeout=150):
    """Fetch a page through the local scrape gateway. Returns (status, html).

    The gateway is the only route. There is deliberately no host-side fallback: agent browsers
    and public fetches must not bypass the gateway/Omabox route when it fails. A Chrome error
    page returned as HTTP 200 is rejected so it is never cached as content.
    """
    status, body = _gateway_post(engine, url, timeout)
    if 'id="main-frame-error"' in body:
        raise FetchError("scrape gateway %s returned a browser error page" % engine)
    return status, body


def _gateway_post(engine, url, timeout):
    payload = json.dumps({"url": url}).encode()
    req = urllib.request.Request(
        GATEWAY + engine, data=payload, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            doc = json.load(resp)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        raise FetchError("scrape gateway %s failed: %s" % (engine, short_reason(exc, 80))) from exc
    return doc.get("status"), (doc.get("html") or doc.get("text") or "")


class Cache:
    """Per-collector response cache so a rerun inside `ttl` does not re-hit sites.

    Only successful bodies are stored. A failure is never replaced by stale data.
    """

    def __init__(self, name, ttl, base=None):
        self.dir = os.path.join(base or CACHE_DIR, name)
        self.ttl = ttl
        os.makedirs(self.dir, mode=0o700, exist_ok=True)

    def _path(self, key):
        return os.path.join(self.dir, hashlib.sha1(key.encode()).hexdigest() + ".txt")

    def get(self, key, fetch):
        path = self._path(key)
        try:
            if time.time() - os.path.getmtime(path) < self.ttl:
                with open(path, encoding="utf-8") as fh:
                    return fh.read()
        except OSError:
            pass
        body = fetch()
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(body)
        return body
