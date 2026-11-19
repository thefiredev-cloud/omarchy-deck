#!/usr/bin/env python3
"""Serve the vendored production frontend and synthetic feeds over simulator TLS.

Usage: production_frontend_fixture.py TLS_PORT MOCK_HTTP_PORT CERT KEY
Both listeners are loopback-only. The committed archive needs no live services or external checkout.
Only GET is supported. The bootstrap credential is synthetic; no query values, cookies or bodies are logged.
GET /__fixture/requests (no session needed) returns {"root": N}, the number of authenticated GET / page loads,
so the pull-to-refresh UI test can tell a fresh load from a page that never reloaded.

Regenerate the vendored archive from a pixel-deck checkout (scripted step before each UI run, I5):
  production_frontend_fixture.py regenerate PIXEL_DECK_DIR [REF]
It writes fixtures/production-frontend.tar.gz from `git archive REF` (default origin/main) and records the
source commit in fixtures/production-frontend.source.
"""
import gzip
import http.client
import http.server
import inspect
import io
import json
import signal
import ssl
import subprocess
import sys
import tarfile
import tempfile
import threading
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

TOKEN = "production-frontend-fixture-0000"
# What the synthetic backend (qa/mock-deck.mjs) needs from pixel-deck: the shipped page and its QA backend and fixtures.
# keys.json stays out on purpose: it names the owner's real key tiles, and the mock serves an empty list without it.
ARCHIVE_PATHS = ("static", "qa/fixtures.mjs", "qa/mock-deck.mjs", "qa/theme.css")


def regenerate(pixel_deck, ref="origin/main", scripts=None):
    """Rebuild fixtures/production-frontend.tar.gz from `git archive REF` of a pixel-deck checkout.

    Returns the full source commit. static/ and the QA backend must exist at REF. The gzip header carries no
    timestamp, so the same commit always gives the same bytes.
    """
    scripts = Path(scripts or Path(__file__).resolve().parent)
    repo = Path(pixel_deck)
    commit = subprocess.run(["git", "-C", str(repo), "rev-parse", "--verify", ref + "^{commit}"],
                            check=True, capture_output=True, text=True).stdout.strip()
    present = subprocess.run(["git", "-C", str(repo), "ls-tree", "--name-only", commit, "--", *ARCHIVE_PATHS],
                             check=True, capture_output=True, text=True).stdout.split()
    for required in ("static", "qa/mock-deck.mjs", "qa/fixtures.mjs"):
        if required not in present:
            raise RuntimeError("pixel-deck %s has no %s" % (commit[:12], required))
    tar_bytes = subprocess.run(["git", "-C", str(repo), "archive", "--format=tar", commit, "--", *present],
                               check=True, capture_output=True).stdout
    out = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=out, mtime=0) as packed:
        packed.write(tar_bytes)
    (scripts / "fixtures/production-frontend.tar.gz").write_bytes(out.getvalue())
    (scripts / "fixtures/production-frontend.source").write_text("pixel-deck %s\n" % commit)
    return commit


def _extractall_has_filter():
    try:
        return "filter" in inspect.signature(tarfile.TarFile.extractall).parameters
    except (TypeError, ValueError):
        return False


# Cached at import so tests can patch extractall without flipping the 3.12 path.
EXTRACTALL_ACCEPTS_FILTER = _extractall_has_filter()


def extractall_accepts_filter():
    """True on Python 3.12+, where TarFile.extractall accepts filter=."""
    return EXTRACTALL_ACCEPTS_FILTER


def _reject_unsafe_member(member, dest):
    name = member.name.replace("\\", "/")
    if not name or "\x00" in name:
        raise ValueError("refusing empty or NUL archive member name")
    if name.startswith("/") or name.startswith("~/") or (len(name) >= 2 and name[1] == ":"):
        raise ValueError("refusing absolute archive path: %r" % member.name)
    if any(part == ".." for part in name.split("/")):
        raise ValueError("refusing parent-path archive member: %r" % member.name)
    if member.issym() or member.islnk():
        raise ValueError("refusing archive link: %r" % member.name)
    if not (member.isfile() or member.isdir()):
        raise ValueError("refusing special archive member: %r" % member.name)
    target = (dest / name).resolve()
    if target != dest and dest not in target.parents:
        raise ValueError("refusing archive member outside dest: %r" % member.name)


def extract_frontend_archive(archive, dest):
    """Unpack the vendored frontend. Uses extractall(filter='data') on 3.12+;
    on 3.9–3.11 walks members and rejects absolute paths, '..', and links.
    """
    dest = Path(dest).resolve()
    dest.mkdir(parents=True, exist_ok=True)
    if extractall_accepts_filter():
        archive.extractall(dest, filter="data")
        return
    members = []
    for member in archive.getmembers():
        _reject_unsafe_member(member, dest)
        members.append(member)
    archive.extractall(dest, members=members)


class Handler(http.server.BaseHTTPRequestHandler):
    upstream_port = 0
    root_loads = 0
    lock = threading.Lock()

    def log_message(self, *_):
        pass

    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path == "/__fixture/requests":
            body = json.dumps({"root": Handler.root_loads}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        bootstrap = parse_qs(parsed.query).get("t") == [TOKEN]
        cookies = self.headers.get("Cookie", "").split(";")
        signed_in = f"pdeck={TOKEN}" in [cookie.strip() for cookie in cookies]
        if not bootstrap and not signed_in:
            self.send_response(401)
            self.end_headers()
            return
        if parsed.path == "/":
            with Handler.lock:
                Handler.root_loads += 1
        connection = http.client.HTTPConnection("127.0.0.1", self.upstream_port, timeout=15)
        try:
            connection.request("GET", self.path, headers={"Host": f"127.0.0.1:{self.upstream_port}"})
            response = connection.getresponse()
            body = response.read()
            self.send_response(response.status)
            for name, value in response.getheaders():
                if name.lower() not in {"connection", "transfer-encoding", "content-length", "set-cookie"}:
                    self.send_header(name, value)
            self.send_header("Content-Length", str(len(body)))
            if bootstrap:
                self.send_header("Set-Cookie", f"pdeck={TOKEN}; Path=/; HttpOnly; Secure; SameSite=Lax")
            self.end_headers()
            self.wfile.write(body)
        finally:
            connection.close()


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == "regenerate":
        commit = regenerate(sys.argv[2], *(sys.argv[3:4]))
        print("Regenerated production-frontend.tar.gz from pixel-deck %s" % commit, flush=True)
        return
    tls_port, upstream_port, cert, key = sys.argv[1:]
    scripts = Path(__file__).resolve().parent
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)

    def stop(*_):
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    with tempfile.TemporaryDirectory(prefix="deck-frontend-") as source:
        with tarfile.open(scripts / "fixtures/production-frontend.tar.gz") as archive:
            extract_frontend_archive(archive, source)
        backend = subprocess.Popen(
            ["node", str(scripts / "start_frontend_mock.mjs"), source, upstream_port],
            stdout=subprocess.PIPE, text=True,
        )
        try:
            if not backend.stdout.readline():
                raise RuntimeError("Synthetic frontend backend failed to start")
            Handler.upstream_port = int(upstream_port)
            with http.server.ThreadingHTTPServer(("127.0.0.1", int(tls_port)), Handler) as server:
                server.socket = context.wrap_socket(server.socket, server_side=True)
                print("Production frontend source + synthetic backend on native WKWebView (loopback TLS)", flush=True)
                server.serve_forever()
        finally:
            backend.terminate()
            try:
                backend.wait(timeout=5)
            except subprocess.TimeoutExpired:
                backend.kill()
                backend.wait()
            backend.stdout.close()


if __name__ == "__main__":
    main()
