#!/usr/bin/env python3
"""Behavior tests for the loopback fixture servers that the simulator UI tests depend on.

Run from the repo root:
    python3 -m unittest discover -s scripts -p 'test_*.py' -v

Only the HTTP handlers run here, on plain HTTP over ephemeral loopback ports. The TLS wrapping
in each script's main() and the page scripts that run in the browser are not covered.
"""
import http.client
import http.server
import io
import os
import sys
import threading
import unittest
from contextlib import redirect_stderr, redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import production_frontend_fixture  # noqa: E402
import security_fixture  # noqa: E402


class LoopbackServer:
    """One request handler on 127.0.0.1 with an ephemeral port, served from a daemon thread."""

    def __init__(self, handler):
        self._httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.port = self._httpd.server_address[1]
        self._thread = threading.Thread(
            target=self._httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True
        )

    def start(self):
        self._thread.start()
        return self

    def stop(self):
        self._httpd.shutdown()
        self._httpd.server_close()

    def request(self, method, path, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            connection.request(method, path, headers=headers or {})
            response = connection.getresponse()
            body = response.read()
            return response.status, response.getheaders(), body
        finally:
            connection.close()


def values(headers, name):
    return [value for key, value in headers if key.lower() == name.lower()]


def cookie_attributes(set_cookie):
    return [part.strip() for part in set_cookie.split(";")]


class RecordingUpstream(http.server.BaseHTTPRequestHandler):
    """Stands in for the mock frontend backend. Test subclasses give each test its own `seen` list."""

    seen = []
    status = 200

    def log_message(self, *_):
        pass

    def do_GET(self):
        type(self).seen.append(self.path)
        body = b"upstream body"
        self.send_response(self.status)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Set-Cookie", "upstream=leak; Path=/")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


PROXY_TOKEN = production_frontend_fixture.TOKEN
PROXY_COOKIE = f"pdeck={PROXY_TOKEN}"


class FrontendFixtureTests(unittest.TestCase):
    def setUp(self):
        self.upstream_cls = type("Upstream", (RecordingUpstream,), {"seen": [], "status": 200})
        upstream = LoopbackServer(self.upstream_cls).start()
        self.addCleanup(upstream.stop)
        proxy_cls = type("Proxy", (production_frontend_fixture.Handler,), {"upstream_port": upstream.port})
        self.proxy = LoopbackServer(proxy_cls).start()
        self.addCleanup(self.proxy.stop)

    def get(self, path, cookie=None):
        return self.proxy.request("GET", path, {"Cookie": cookie} if cookie else {})

    def test_request_without_token_or_session_is_401_and_not_proxied(self):
        status, _, _ = self.get("/")
        self.assertEqual(status, 401)
        self.assertEqual(self.upstream_cls.seen, [])

    def test_wrong_bootstrap_token_is_rejected_and_not_proxied(self):
        status, _, _ = self.get("/?t=not-the-token")
        self.assertEqual(status, 401)
        self.assertEqual(self.upstream_cls.seen, [])

    def test_bootstrap_token_proxies_body_and_issues_hardened_session_cookie(self):
        status, headers, body = self.get(f"/?t={PROXY_TOKEN}")
        self.assertEqual((status, body), (200, b"upstream body"))
        cookies = values(headers, "Set-Cookie")
        self.assertEqual(len(cookies), 1)
        attributes = cookie_attributes(cookies[0])
        self.assertEqual(attributes[0], PROXY_COOKIE)
        self.assertEqual(set(attributes[1:]), {"Path=/", "HttpOnly", "Secure", "SameSite=Lax"})

    def test_upstream_set_cookie_never_reaches_client(self):
        _, headers, _ = self.get(f"/?t={PROXY_TOKEN}")
        self.assertFalse(any(value.startswith("upstream=") for value in values(headers, "Set-Cookie")))

    def test_session_cookie_is_proxied_without_issuing_a_new_cookie(self):
        status, headers, body = self.get("/life", cookie=f"theme=dark; {PROXY_COOKIE}")
        self.assertEqual((status, body), (200, b"upstream body"))
        self.assertEqual(values(headers, "Set-Cookie"), [])
        self.assertEqual(self.upstream_cls.seen, ["/life"])

    def test_cookie_name_and_value_must_match_exactly(self):
        for cookie in (f"pdeck={PROXY_TOKEN}x", f"xpdeck={PROXY_TOKEN}"):
            with self.subTest(cookie=cookie):
                status, _, _ = self.get("/", cookie=cookie)
                self.assertEqual(status, 401)
        self.assertEqual(self.upstream_cls.seen, [])

    def test_path_and_query_reach_upstream_unchanged(self):
        self.get("/pad/page?room=2&x=%20y", cookie=PROXY_COOKIE)
        self.assertEqual(self.upstream_cls.seen, ["/pad/page?room=2&x=%20y"])

    def test_upstream_status_is_passed_through(self):
        self.upstream_cls.status = 404
        status, _, _ = self.get(f"/?t={PROXY_TOKEN}")
        self.assertEqual(status, 404)

    def test_non_get_methods_never_reach_upstream(self):
        status, _, _ = self.proxy.request("POST", f"/?t={PROXY_TOKEN}", {})
        self.assertGreaterEqual(status, 400)
        self.assertEqual(self.upstream_cls.seen, [])

    def test_token_is_never_written_to_console(self):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            self.get(f"/?t={PROXY_TOKEN}")
            self.get("/", cookie=PROXY_COOKIE)
        self.assertNotIn(PROXY_TOKEN, out.getvalue() + err.getvalue())


SECURITY_TOKEN = security_fixture.TOKEN
SECURITY_COOKIE = f"pdeck={SECURITY_TOKEN}"


class SecurityFixtureTests(unittest.TestCase):
    def setUp(self):
        self.server = LoopbackServer(security_fixture.Handler).start()
        self.addCleanup(self.server.stop)

    def get(self, path, cookie=None):
        return self.server.request("GET", path, {"Cookie": cookie} if cookie else {})

    def test_page_without_token_or_session_is_401_without_page(self):
        status, _, body = self.get("/")
        self.assertEqual(status, 401)
        self.assertNotIn(b"SECURITY FIXTURE", body)

    def test_wrong_bootstrap_token_is_rejected(self):
        status, _, body = self.get("/?t=wrong")
        self.assertEqual(status, 401)
        self.assertNotIn(b"SECURITY FIXTURE", body)

    def test_bootstrap_token_serves_uncached_page_and_sets_hardened_cookie(self):
        status, headers, body = self.get(f"/?t={SECURITY_TOKEN}")
        self.assertEqual(status, 200)
        self.assertEqual(values(headers, "Content-Type"), ["text/html"])
        self.assertEqual(values(headers, "Cache-Control"), ["no-store"])
        self.assertIn(b"SECURITY FIXTURE", body)
        cookies = values(headers, "Set-Cookie")
        self.assertEqual(len(cookies), 1)
        attributes = cookie_attributes(cookies[0])
        self.assertEqual(attributes[0], SECURITY_COOKIE)
        self.assertEqual(set(attributes[1:]), {"Path=/", "HttpOnly", "Secure", "SameSite=Lax"})

    def test_saved_session_cookie_serves_page_without_reissuing_cookie(self):
        status, headers, _ = self.get("/", cookie=SECURITY_COOKIE)
        self.assertEqual(status, 200)
        self.assertEqual(values(headers, "Set-Cookie"), [])

    def test_session_cookie_must_equal_token_exactly(self):
        for cookie in (f"pdeck={SECURITY_TOKEN}-extra", f"apdeck={SECURITY_TOKEN}"):
            with self.subTest(cookie=cookie):
                status, _, _ = self.get("/", cookie=cookie)
                self.assertEqual(status, 401)

    def test_control_files_are_public_and_cross_origin_readable(self):
        for path in ("/control.txt", "/cross.txt"):
            with self.subTest(path=path):
                status, headers, body = self.get(path)
                self.assertEqual(status, 200)
                self.assertEqual(values(headers, "Access-Control-Allow-Origin"), ["*"])
                self.assertEqual(body, b"synthetic control")

    def test_unknown_path_is_404_even_with_valid_session(self):
        status, _, _ = self.get(f"/missing?t={SECURITY_TOKEN}", cookie=SECURITY_COOKIE)
        self.assertEqual(status, 404)

    def test_request_log_names_path_but_never_token_or_cookie(self):
        out = io.StringIO()
        with redirect_stdout(out):
            self.get(f"/?t={SECURITY_TOKEN}")
            self.get("/", cookie=SECURITY_COOKIE)
        log = out.getvalue()
        self.assertIn("FIXTURE path=/ bootstrap_query_present=True", log)
        self.assertIn("FIXTURE path=/ bootstrap_query_present=False", log)
        self.assertNotIn(SECURITY_TOKEN, log)

    def test_page_carries_both_hardening_banners(self):
        status, _, body = self.get(f"/?t={SECURITY_TOKEN}")
        self.assertEqual(status, 200)
        self.assertIn(b"SECURITY FIXTURE - synthetic only", body)
        self.assertIn(b"DECK FIXTURE - synthetic only", body)



if __name__ == "__main__":
    unittest.main()
