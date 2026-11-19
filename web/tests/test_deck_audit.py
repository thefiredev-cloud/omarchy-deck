"""Tests for scripts/deck_audit.py and integrations/hermes-plugin.

Run (mock and real-SDK plugin tests need the hermes venv; they skip cleanly otherwise):
  ~/.hermes/hermes-agent/venv/bin/python -m unittest tests/test_deck_audit.py -v

No live deck is contacted: a fake transport is injected, and http.client is patched for the
transport tests. The real-SDK tests use a private PluginManager scope in a temp dir, register,
dispatch through tools.registry, then deregister. Nothing is enabled, installed or activated.
"""
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import deck_audit as da  # noqa: E402

NOW = 1_790_756_300
TOKEN = "s3cretTokenValue_-abcDEF0123456789"

TODAY = {
    "t": NOW - 5,
    "gateway": {"ok": True, "status": "ok", "version": "0.21.5", "src": "live GET /health on the gateway API", "t": NOW - 5},
    "mail": {"status": "ok", "stale": False, "t": NOW - 40, "src": "~/.meshvault/status/mail/inbox-full.json",
             "mailboxes": [{"role": "primary", "unread": 7, "ok": True, "address": "tanner@example.com",
                            "subject": "Wire transfer PRIVATE-SUBJECT", "body": "secret body"},
                           {"role": "personal", "unread": 3, "ok": True}]},
    "cron": {"enabled": 4, "paused": 62, "failing": [], "next": [{"at": NOW + 60, "name": "Markets Daily Brief"}],
             "src": "~/.hermes/cron/jobs.json", "t": NOW - 5},
    "markets": {"items": [{"source": "wire", "title": "BTC price 61,000 dollars", "at": NOW - 900}],
                "src": "newswire.db", "t": NOW - 5},
    "watch": {"connected": True, "hr": 61.0, "hrv": 88.0, "sleep_h": None, "resting_hr": 50.0,
              "battery": 80.0, "move_kcal": 420, "exercise_min": 30, "stand_h": 8, "t": NOW - 60, "src": "watch.json"},
    "unavailable": [{"name": "x", "why": "y"}],
}
CAMS = {"cams": [{"name": f"eufy_cam{i}", "ready": True, "readers": 1, "bytes": 1000 + i,
                  "url": "http://x/cam?k=CAMKEYSECRET", "k": "CAMKEYSECRET"} for i in range(1, 5)]}
TRAFFIC = {"status": "partial", "src": "~/.meshvault/status/traffic/traffic.json",
           "origin": "google-apis MCP > Search Console (read-only)",
           "window": {"start_date": "2026-09-01", "end_date": "2026-09-28"}, "t": NOW - 3600, "age": 3600,
           "refresh": 3600, "stale": False, "note": "organic_search_clicks are Google Search clicks, not total visits",
           "sites": [{"domain": "example.com", "provider": "google_search_console", "metric": "organic_search_clicks",
                      "value": 120, "impressions": 900, "start_date": "2026-09-01", "end_date": "2026-09-28",
                      "t": NOW - 3600, "status": "ok"},
                     {"domain": "b.example.org", "provider": "google_search_console", "metric": "organic_search_clicks",
                      "value": None, "impressions": None, "start_date": "2026-09-01", "end_date": "2026-09-28",
                      "t": NOW - 3600, "status": "unavailable", "error": "Search Console HTTP 403"}]}
SITES = {"src": "product-monitor", "t": NOW - 10, "stale": False, "items": [{"name": "site-a", "ok": True, "ms": 120}]}


class FakeTransport:
    """Records every request. Routes map path -> Reply."""

    def __init__(self, routes=None, unauth=None):
        self.calls = []
        self.routes = routes if routes is not None else {}
        self.unauth = unauth or {}
        self._token = TOKEN

    def __call__(self, path, auth=True):
        if path not in da.ALLOWED_GET:
            raise ValueError("path not allowlisted")
        self.calls.append((path, auth))
        if not auth and path in self.unauth:
            return self.unauth[path]
        if path in self.routes:
            return self.routes[path]
        return da.Reply(404, b"nf")


def j(obj, status=200):
    return da.Reply(status, json.dumps(obj).encode(), None, 3)


def good():
    return FakeTransport({"/api/today": j(TODAY), "/api/cams": j(CAMS), "/api/traffic": j(TRAFFIC),
                          "/api/sites": j(SITES)})


def clock():
    return NOW


class SafetyTests(unittest.TestCase):
    def test_constants_loopback_only(self):
        self.assertEqual((da.HOST, da.PORT), ("127.0.0.1", 8796))

    def test_allowlist_is_fixed_get_paths(self):
        for p in da.ALLOWED_GET:
            self.assertTrue(p.startswith("/"))
            if p != da.UNIT_PROBE:
                self.assertNotIn("?", p)
            self.assertNotIn("/api/camkey", p)
            self.assertNotIn("/api/keys", p)
            self.assertNotIn("/cam/", p)
        self.assertNotIn("/api/camkey", da.ALLOWED_GET)
        self.assertNotIn("/api/cam", da.ALLOWED_GET)  # snapshot image route

    def test_transport_rejects_non_allowlisted_path(self):
        t = da.LoopbackTransport()
        for bad in ("/api/camkey", "/api/today?t=x", "http://evil/", "//evil/api/today", "/api/lock"):
            with self.assertRaises(ValueError):
                t(bad)

    def test_transport_get_only_loopback_cookie_header_only(self):
        with tempfile.TemporaryDirectory() as d:
            tp = Path(d) / "token"
            tp.write_text(TOKEN + "\n")
            seen = {}

            class Conn:
                def __init__(self, host, port, timeout=None):
                    seen.update(host=host, port=port)

                def request(self, method, path, headers=None):
                    seen.update(method=method, path=path, headers=dict(headers))

                def getresponse(self):
                    r = mock.Mock(status=200)
                    r.read = lambda n=-1: b"{}"
                    return r

                def close(self):
                    pass

            with mock.patch.object(da.http.client, "HTTPConnection", Conn):
                r = da.LoopbackTransport(token_path=tp)("/api/today", True)
            self.assertEqual(r.status, 200)
            self.assertEqual((seen["host"], seen["port"], seen["method"]), ("127.0.0.1", 8796, "GET"))
            self.assertEqual(seen["path"], "/api/today")
            self.assertNotIn(TOKEN, seen["path"])
            self.assertEqual(seen["headers"]["Cookie"], f"pdeck={TOKEN}")

    def test_unauthenticated_call_sends_no_cookie(self):
        seen = {}

        class Conn:
            def __init__(self, *a, **k):
                pass

            def request(self, method, path, headers=None):
                seen.update(headers=dict(headers))

            def getresponse(self):
                r = mock.Mock(status=401)
                r.read = lambda n=-1: b"unauthorized"
                return r

            def close(self):
                pass

        with mock.patch.object(da.http.client, "HTTPConnection", Conn):
            r = da.LoopbackTransport(token_path=Path("/nonexistent"))("/api/today", False)
        self.assertEqual(r.status, 401)
        self.assertNotIn("Cookie", seen["headers"])

    def test_missing_token_is_auth_failed_not_zero(self):
        t = da.LoopbackTransport(token_path=Path("/nonexistent/token"))
        env = da.read_tool("today", t, clock)
        self.assertEqual(env["status"], "auth_failed")
        self.assertNotIn("data", env)

    def test_malformed_token_rejected_no_header_injection(self):
        with tempfile.TemporaryDirectory() as d:
            tp = Path(d) / "token"
            tp.write_text("abc\r\nX-Evil: 1")
            self.assertIsNone(da.LoopbackTransport(token_path=tp).token())

    def test_timeout_clamped(self):
        self.assertEqual(da.LoopbackTransport(timeout=999).timeout, 10.0)
        self.assertEqual(da.LoopbackTransport(timeout=0).timeout, 0.5)

    def test_cli_has_no_url_host_or_post_options(self):
        with self.assertRaises(SystemExit):
            da.main(["today", "--url", "http://x"], transport=good())
        with self.assertRaises(SystemExit):
            da.main(["today", "--host", "203.0.113.1"], transport=good())
        with self.assertRaises(SystemExit):
            da.main(["post"], transport=good())
        src = (ROOT / "scripts/deck_audit.py").read_text()
        self.assertNotIn('"POST"', src)
        self.assertNotIn("add_argument(\"--url", src)
        self.assertNotIn("add_argument(\"--host", src)
        self.assertNotIn("add_argument(\"--port", src)

    def test_source_never_logs_or_persists_token(self):
        src = (ROOT / "scripts/deck_audit.py").read_text()
        self.assertNotIn("write_text", src)
        self.assertNotIn("open(", src)
        self.assertNotIn("logging", src)


class SanitizeTests(unittest.TestCase):
    def test_failed_mailbox_unread_is_not_counted(self):
        payload = json.loads(json.dumps(TODAY))
        payload["mail"]["mailboxes"][0]["ok"] = False
        self.assertEqual(da.sum_mail(payload["mail"], NOW)["unread_total"], 3)

    def test_traffic_mixed_metrics_are_not_summed(self):
        payload = json.loads(json.dumps(TRAFFIC))
        payload["sites"][1].update(status="ok", metric="visits", value=100)
        env = da.read_tool("traffic", FakeTransport({"/api/traffic": j(payload)}), clock)
        self.assertIsNone(env["data"]["total_value"])

    def test_traffic_different_windows_are_not_summed(self):
        payload = json.loads(json.dumps(TRAFFIC))
        payload["sites"][1].update(status="ok", value=100, end_date="2026-09-27")
        env = da.read_tool("traffic", FakeTransport({"/api/traffic": j(payload)}), clock)
        self.assertIsNone(env["data"]["total_value"])

    def test_bad_section_shapes_do_not_crash_cli(self):
        payload = json.loads(json.dumps(TODAY))
        payload["mail"]["mailboxes"] = {"invalid": True}
        env = da.read_tool("today", FakeTransport({"/api/today": j(payload)}), clock)
        self.assertEqual(env["status"], "bad_reply")

    def run_all(self):
        t = good()
        outs = [da.run_tool(n, t, clock) for n in ("today", "cams", "traffic", "sites")]
        return t, json.dumps(outs)

    def test_no_private_strings_in_output(self):
        _, text = self.run_all()
        for secret in ("tanner@example.com", "PRIVATE-SUBJECT", "secret body", "61,000", "CAMKEYSECRET",
                       "Markets Daily Brief", TOKEN):
            self.assertNotIn(secret, text)
        self.assertNotIn("@", text)

    def test_watch_has_no_values(self):
        env = da.read_tool("today", good(), clock)
        w = env["data"]["sections"]["watch"]
        text = json.dumps(w)
        for val in ("61.0", "88.0", "50.0", "80.0", "420"):
            self.assertNotIn(val, text)
        self.assertEqual(w["metrics_missing"], ["sleep_h"])

    def test_today_counts_and_times(self):
        env = da.read_tool("today", good(), clock)
        self.assertEqual(env["status"], "ok")
        self.assertEqual(env["source"], "live GET http://127.0.0.1:8796/api/today")
        m = env["data"]["sections"]["mail"]
        self.assertEqual((m["unread_total"], m["mailbox_count"], m["mailboxes_ok"]), (10, 2, 2))
        self.assertEqual(env["data"]["sections"]["cron"]["enabled"], 4)
        self.assertEqual(env["data"]["sections"]["markets"]["headline_count"], 1)
        self.assertEqual(env["data"]["age_s"], 5)

    def test_cams_counts_only(self):
        env = da.read_tool("cams", good(), clock)
        self.assertEqual((env["status"], env["data"]["ready_count"], env["data"]["total"]), ("ok", 4, 4))
        for c in env["data"]["cams"]:
            self.assertEqual(set(c), {"name", "ready", "readers", "bytes"})

    def test_cams_partial_when_one_not_ready(self):
        bad = json.loads(json.dumps(CAMS))
        bad["cams"][2]["ready"] = False
        t = FakeTransport({"/api/cams": j(bad)})
        env = da.read_tool("cams", t, clock)
        self.assertEqual((env["status"], env["data"]["ready_count"]), ("partial", 3))

    def test_traffic_null_stays_null_and_metric_labeled(self):
        env = da.read_tool("traffic", good(), clock)
        d = env["data"]
        self.assertEqual(env["status"], "partial")
        by = {s["domain"]: s for s in d["sites"]}
        self.assertEqual(by["example.com"]["value"], 120)
        self.assertIsNone(by["b.example.org"]["value"])
        self.assertEqual(d["unavailable_count"], 1)
        self.assertEqual(d["window"], {"start_date": "2026-09-01", "end_date": "2026-09-28"})
        self.assertIn("not total visits", d["metric_note"])
        self.assertEqual(d["total_value"], 120)

    def test_traffic_measured_zero_stays_zero_and_error_text_dropped(self):
        payload = json.loads(json.dumps(TRAFFIC))
        payload["sites"][0]["value"] = 0
        env = da.read_tool("traffic", FakeTransport({"/api/traffic": j(payload)}), clock)
        self.assertEqual(env["data"]["sites"][0]["value"], 0)
        self.assertEqual(env["data"]["total_value"], 0)
        self.assertNotIn("403", json.dumps(env))

    def test_traffic_cache_missing_payload_is_unavailable_with_reason(self):
        payload = {"status": "unavailable", "sites": [], "src": "x", "t": None, "age": None, "stale": True,
                   "error": "no traffic cache yet"}
        env = da.read_tool("traffic", FakeTransport({"/api/traffic": j(payload)}), clock)
        self.assertEqual(env["status"], "unavailable")
        self.assertEqual(env["reason"], "no traffic cache yet")
        self.assertNotIn("sites", env.get("data", {}))

    def test_traffic_stale_flag_makes_partial(self):
        payload = json.loads(json.dumps(TRAFFIC))
        payload["sites"][1].update(value=5, status="ok", impressions=1)
        payload["stale"] = True
        env = da.read_tool("traffic", FakeTransport({"/api/traffic": j(payload)}), clock)
        self.assertEqual(env["status"], "partial")

    def test_traffic_all_null_not_zero(self):
        payload = json.loads(json.dumps(TRAFFIC))
        for s in payload["sites"]:
            s["value"], s["status"] = None, "unavailable"
        env = da.read_tool("traffic", FakeTransport({"/api/traffic": j(payload)}), clock)
        self.assertEqual(env["status"], "unavailable")
        self.assertIsNone(env["data"]["total_value"])

    def test_traffic_fake_zero_for_unavailable_row_is_dropped(self):
        payload = json.loads(json.dumps(TRAFFIC))
        payload["sites"][1]["value"] = 0  # status unavailable but a 0 slipped in
        env = da.read_tool("traffic", FakeTransport({"/api/traffic": j(payload)}), clock)
        by = {s["domain"]: s for s in env["data"]["sites"]}
        self.assertIsNone(by["b.example.org"]["value"])

    def test_bad_domain_dropped(self):
        payload = json.loads(json.dumps(TRAFFIC))
        payload["sites"][0]["domain"] = "user@evil.com/../x"
        env = da.read_tool("traffic", FakeTransport({"/api/traffic": j(payload)}), clock)
        self.assertIsNone(env["data"]["sites"][0]["domain"])

    def test_bad_mail_role_replaced(self):
        payload = json.loads(json.dumps(TODAY))
        payload["mail"]["mailboxes"][0]["role"] = "tanner@example.com"
        env = da.read_tool("today", FakeTransport({"/api/today": j(payload)}), clock)
        self.assertEqual(env["data"]["sections"]["mail"]["mailboxes"][0]["role"], "mailbox")

    def test_section_error_is_unavailable_not_zero(self):
        payload = json.loads(json.dumps(TODAY))
        payload["mail"] = {"error": "no reading", "src": "x"}
        env = da.read_tool("today", FakeTransport({"/api/today": j(payload)}), clock)
        self.assertEqual(env["status"], "partial")
        m = env["data"]["sections"]["mail"]
        self.assertEqual(m["status"], "unavailable")
        self.assertNotIn("unread_total", m)
        self.assertIn("mail", env["data"]["not_ok_sections"])

    def test_render_withholds_token_and_at_signs(self):
        t = FakeTransport()
        out = da.render({"tool": "x", "status": "ok", "leak": TOKEN}, t)
        self.assertNotIn(TOKEN, out)
        out2 = da.render({"tool": "x", "status": "ok", "leak": "a@b.c"}, t)
        self.assertIn("withheld", out2)


class FailureModeTests(unittest.TestCase):
    def test_401_is_auth_failed(self):
        env = da.read_tool("today", FakeTransport({"/api/today": da.Reply(401, b"unauthorized")}), clock)
        self.assertEqual(env["status"], "auth_failed")
        self.assertNotIn("data", env)
        self.assertEqual(da.exit_code(env["status"]), 1)

    def test_connection_failed_is_unavailable(self):
        env = da.read_tool("cams", FakeTransport({"/api/cams": da.Reply(0, b"", "connection_failed")}), clock)
        self.assertEqual(env["status"], "unavailable")
        self.assertIsNone(env["http"])

    def test_405_is_route_missing(self):
        env = da.read_tool("traffic", FakeTransport({"/api/traffic": da.Reply(405, b'{"error":"POST required"}')}), clock)
        self.assertEqual(env["status"], "route_missing")
        self.assertIn("cargo rebuild", env["reason"])

    def test_500_and_bad_json(self):
        self.assertEqual(da.read_tool("sites", FakeTransport({"/api/sites": da.Reply(500, b"x")}), clock)["status"], "unavailable")
        self.assertEqual(da.read_tool("sites", FakeTransport({"/api/sites": da.Reply(200, b"<html>")}), clock)["status"], "bad_reply")

    def test_cams_error_payload_not_zero(self):
        env = da.read_tool("cams", FakeTransport({"/api/cams": j({"error": "mediamtx unreachable", "cams": []})}), clock)
        self.assertEqual(env["status"], "unavailable")
        self.assertIsNone(env["data"]["ready_count"])

    def test_exit_codes(self):
        self.assertEqual([da.exit_code(s) for s in ("ok", "partial", "auth_failed", "unavailable", "route_missing")],
                         [0, 2, 1, 1, 1])

    def test_main_prints_json_and_returns_code(self):
        buf = io.StringIO()
        rc = da.main(["cams"], transport=good(), out=buf)
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(buf.getvalue())["tool"], "cams")
        self.assertEqual([c for c in good().calls], [])


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.static = Path(self.tmp.name)
        self.files = {"index.html": b"<html>", "app.js": b"app", "deck.js": b"deck", "pad.js": b"pad",
                      "sw.js": b"const V='pdeck-shell-__SHELL_HASH__',SHELL=['/'];"}
        for k, v in self.files.items():
            (self.static / k).write_bytes(v)

    def tearDown(self):
        self.tmp.cleanup()

    def transport(self, served=None, traffic=True, feeds=None):
        served = served or self.files
        routes = {"/api/today": j(TODAY), "/api/cams": j(CAMS), "/api/sites": j(SITES),
                  "/healthz": da.Reply(200, b"ok"), "/": da.Reply(200, served["index.html"]),
                  "/app.js": da.Reply(200, served["app.js"]), "/deck.js": da.Reply(200, served["deck.js"]),
                  "/pad.js": da.Reply(200, served["pad.js"]),
                  "/sw.js": da.Reply(200, served["sw.js"].replace(b"__SHELL_HASH__", b"0123456789abcdef"))}
        for name in da.FEEDS:
            routes[f"/api/{name}"] = j((feeds or {}).get(name, {"t": NOW - 30, "age": 30, "refresh": 60,
                                                                 "stale": False, "errors": []}))
        routes["/api/crons"] = j({"t": NOW, "counts": {"active": 1, "paused": 0, "total": 1}, "active": [], "paused": []})
        routes["/api/fleet-board"] = j({"machines": {}, "cluster": {}})
        for path in da.ACTION_PROBES:
            routes[path] = da.Reply(405, b'{"error":"POST required"}')
        routes[da.UNIT_PROBE] = da.Reply(400, b'{"error":"bad name"}')
        if traffic:
            routes["/api/traffic"] = j(TRAFFIC)
        else:
            routes["/api/traffic"] = da.Reply(405, b"")
        return FakeTransport(routes, unauth={"/api/today": da.Reply(401, b"unauthorized")})

    def by(self, res):
        return {c["check"]: c for c in res["checks"]}

    def test_all_pass(self):
        res = da.audit(self.transport(), clock, self.static)
        self.assertEqual(res["status"], "ok", [c for c in res["checks"] if c["result"] != "pass"])
        self.assertEqual(res["summary"]["fail"], 0)

    def test_v8_reads_pass_fail_and_are_allowlisted(self):
        self.assertIn("/api/crons", da.ALLOWED_GET)
        self.assertIn("/api/fleet-board", da.ALLOWED_GET)
        self.assertNotIn("/api/run", da.ALLOWED_GET)  # takes an id; never requested by the audit
        self.assertNotIn("/api/run-last", da.ALLOWED_GET)
        c = self.by(da.audit(self.transport(), clock, self.static))
        self.assertEqual((c["v8_crons"]["result"], c["v8_fleet-board"]["result"]), ("pass", "pass"))
        t = self.transport()
        t.routes["/api/crons"] = j({"error": "file missing"})
        t.routes["/api/fleet-board"] = da.Reply(405, b"")
        c = self.by(da.audit(t, clock, self.static))
        self.assertEqual(c["v8_crons"]["result"], "fail")
        self.assertIn("file missing", c["v8_crons"]["detail"])
        self.assertEqual(c["v8_fleet-board"]["result"], "fail")
        self.assertIn("route_missing", c["v8_fleet-board"]["detail"])

    def test_post_route_presence_is_probed_only_with_get(self):
        t = self.transport()
        c = self.by(da.audit(t, clock, self.static))
        for path in da.ACTION_PROBES:
            self.assertEqual(c[f"route_{path.rsplit('/', 1)[-1]}"]["result"], "pass")
            self.assertIn((path, True), t.calls)
        self.assertEqual(c["route_unit"]["result"], "pass")
        t.routes["/api/run-send"] = da.Reply(404, b"nf")
        self.assertEqual(self.by(da.audit(t, clock, self.static))["route_run-send"]["result"], "fail")

    def test_stale_embedded_asset_and_missing_route_flagged(self):
        served = dict(self.files, **{"app.js": b"old app"})
        res = da.audit(self.transport(served, traffic=False), clock, self.static)
        c = self.by(res)
        self.assertEqual(c["embedded_app.js"]["result"], "fail")
        self.assertIn("cargo rebuild", c["embedded_app.js"]["detail"])
        self.assertEqual(c["read_traffic"]["result"], "fail")
        self.assertEqual(c["embedded_pad.js"]["result"], "pass")
        self.assertEqual(res["status"], "partial")
        self.assertEqual(res["tool_status"]["traffic"], "route_missing")

    def test_the_served_worker_matches_the_checkout_once_its_stamp_is_put_back(self):
        self.assertEqual(self.by(da.audit(self.transport(), clock, self.static))["embedded_sw.js"]["result"], "pass")
        cases = {
            "a raw token (never stamped)": self.files["sw.js"],
            "a numbered cache (an old binary)": b"const V='pdeck-shell-v113',SHELL=['/'];",
            "a short stamp": b"const V='pdeck-shell-0123',SHELL=['/'];",
        }
        for name, body in cases.items():
            t = self.transport()
            t.routes["/sw.js"] = da.Reply(200, body)
            c = self.by(da.audit(t, clock, self.static))["embedded_sw.js"]
            self.assertEqual(c["result"], "fail", name)
            self.assertIn("no shell stamp", c["detail"], name)
        t = self.transport(dict(self.files, **{"sw.js": b"const V='pdeck-shell-__SHELL_HASH__',SHELL=['/','/app.js'];"}))
        c = self.by(da.audit(t, clock, self.static))["embedded_sw.js"]
        self.assertEqual(c["result"], "fail", "a stamped worker with other bytes")
        self.assertIn("cargo rebuild", c["detail"])
        self.assertEqual(da.unstamp(b"x V='pdeck-shell-00000000000000ff' y"), b"x V='pdeck-shell-__SHELL_HASH__' y")

    def test_auth_not_enforced_is_failure(self):
        t = self.transport()
        t.unauth = {"/api/today": da.Reply(200, b"{}")}
        self.assertEqual(self.by(da.audit(t, clock, self.static))["auth_enforced_without_cookie"]["result"], "fail")

    def test_down_deck_is_unavailable(self):
        t = FakeTransport({"/healthz": da.Reply(0, b"", "connection_failed")})
        res = da.audit(t, clock, self.static)
        self.assertEqual(res["status"], "unavailable")
        self.assertEqual(len(res["checks"]), 1)

    def test_audit_only_requests_allowlisted_get_paths_and_no_cookie_on_public(self):
        t = self.transport()
        da.audit(t, clock, self.static)
        for path, auth in t.calls:
            self.assertIn(path, da.ALLOWED_GET)
        self.assertIn(("/healthz", False), t.calls)
        self.assertIn(("/app.js", False), t.calls)

    def test_stale_section_flagged(self):
        payload = json.loads(json.dumps(TODAY))
        payload["mail"]["t"] = NOW - 9999
        t = self.transport()
        t.routes["/api/today"] = j(payload)
        self.assertEqual(self.by(da.audit(t, clock, self.static))["today_mail_fresh"]["result"], "fail")

    def test_feed_missing_stale_and_route_missing_are_named(self):
        feeds = {"jobs": {"error": "file missing", "stale": True},
                 "surf": {"t": NOW - 9000, "age": 9000, "refresh": 1800, "stale": True,
                          "errors": [{"source": "noaa", "reason": "timeout"}]}}
        t = self.transport(feeds=feeds)
        t.routes["/api/hockey"] = da.Reply(404, b"nf")
        res = da.audit(t, clock, self.static)
        c = self.by(res)
        self.assertEqual(c["feed_jobs"]["result"], "fail")
        self.assertIn("file missing", c["feed_jobs"]["detail"])
        self.assertEqual(c["feed_surf"]["detail"], "stale: age 9000s, refresh 1800s, 1 part(s) failed")
        self.assertIn("route_missing", c["feed_hockey"]["detail"])
        self.assertEqual(c["feed_cluster"]["result"], "pass")
        self.assertEqual(res["status"], "partial")

    def test_audit_output_has_no_private_text(self):
        text = json.dumps(da.audit(self.transport(), clock, self.static))
        for secret in ("tanner@example.com", "PRIVATE-SUBJECT", "CAMKEYSECRET", TOKEN):
            self.assertNotIn(secret, text)


# ── Hermes plugin candidate ──────────────────────────────────────────────────────────────
PLUGIN_DIR = ROOT / "integrations" / "hermes-plugin"
EXPECTED = {"deck_today", "deck_traffic", "deck_cameras", "deck_sites", "deck_endpoint_audit"}


def load_plugin():
    spec = importlib.util.spec_from_file_location("pdeck_plugin_under_test", PLUGIN_DIR / "__init__.py",
                                                  submodule_search_locations=[str(PLUGIN_DIR)])
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class PluginMockTests(unittest.TestCase):
    """Mock PluginContext with the exact register_tool keyword signature from hermes_cli.plugins."""

    class Ctx:
        def __init__(self):
            self.tools = {}

        def register_tool(self, name, toolset, schema, handler, check_fn=None, requires_env=None, is_async=False,
                          description="", emoji="", override=False):
            self.tools[name] = dict(toolset=toolset, schema=schema, handler=handler, override=override,
                                    requires_env=requires_env, is_async=is_async)

    def setUp(self):
        self.mod = load_plugin()
        self.ctx = self.Ctx()
        self.mod.register(self.ctx)
        # route the handler's transport to the fake one
        eng = self.mod._load_engine()
        self._orig = eng.LoopbackTransport
        eng.LoopbackTransport = lambda timeout=5.0, token_path=None: good()
        self.addCleanup(setattr, eng, "LoopbackTransport", self._orig)

    def test_registers_exactly_five_readonly_tools(self):
        self.assertEqual(set(self.ctx.tools), EXPECTED)
        for name, t in self.ctx.tools.items():
            self.assertEqual(t["toolset"], "pixel_deck")
            self.assertFalse(t["override"])
            self.assertIsNone(t["requires_env"])
            self.assertEqual(t["schema"]["name"], name)
            p = t["schema"]["parameters"]
            self.assertEqual((p["type"], p["properties"], p["additionalProperties"]), ("object", {}, False))

    def test_manifest_matches_registered_tools(self):
        text = (PLUGIN_DIR / "plugin.yaml").read_text()
        for name in EXPECTED:
            self.assertIn(f"- {name}", text)
        self.assertIn("name: pixel-deck-readonly", text)

    def test_handlers_return_json_string_and_ignore_args_and_kwargs(self):
        h = self.ctx.tools["deck_cameras"]["handler"]
        out = h({"url": "http://evil", "host": "x", "token": "y"}, task_id="t", session_id="s", extra=1)
        self.assertIsInstance(out, str)
        d = json.loads(out)
        self.assertEqual((d["tool"], d["status"], d["data"]["ready_count"]), ("cams", "ok", 4))
        self.assertEqual(d["source"], "live GET http://127.0.0.1:8796/api/cams")
        self.assertEqual(json.loads(h(None))["status"], "ok")
        self.assertEqual(json.loads(h({}))["status"], "ok")

    def test_each_handler_valid_json(self):
        for name, t in self.ctx.tools.items():
            d = json.loads(t["handler"]({}))
            self.assertIn("status", d, name)

    def test_handler_never_raises_and_hides_details(self):
        eng = self.mod._load_engine()
        eng.LoopbackTransport = lambda **k: (_ for _ in ()).throw(RuntimeError("boom " + TOKEN))
        out = self.ctx.tools["deck_today"]["handler"]({})
        self.assertEqual(json.loads(out)["status"], "unavailable")
        self.assertNotIn(TOKEN, out)

    def test_plugin_source_has_no_credential_or_network_code(self):
        import ast
        tree = ast.parse((PLUGIN_DIR / "__init__.py").read_text())
        imported = set()
        for n in ast.walk(tree):
            if isinstance(n, ast.Import):
                imported |= {a.name.split(".")[0] for a in n.names}
            elif isinstance(n, ast.ImportFrom):
                imported.add((n.module or "").split(".")[0])
        self.assertTrue(imported <= {"__future__", "importlib", "json", "sys", "pathlib", "typing"}, imported)
        code_strings = [n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)]
        for s in code_strings:
            self.assertNotIn(".config/pixel-deck", s)
            self.assertNotIn("Cookie", s)


def _real_sdk():
    hermes = Path.home() / ".hermes/hermes-agent"
    if str(hermes) not in sys.path and hermes.is_dir():
        sys.path.insert(0, str(hermes))
    try:
        from hermes_cli.plugins import PluginContext, PluginManager, PluginManifest  # noqa: F401
        from tools.registry import registry  # noqa: F401
        return True
    except Exception:
        return False


@unittest.skipUnless(_real_sdk(), "hermes SDK not importable (run with the hermes venv python)")
class PluginRealSdkTests(unittest.TestCase):
    """Real PluginContext.register_tool + tools.registry.dispatch in a private temp scope."""

    def setUp(self):
        from hermes_cli.plugins import PluginContext, PluginManager, PluginManifest
        from tools.registry import registry
        self.registry = registry
        self.tmp = tempfile.TemporaryDirectory()
        self.mgr = PluginManager(scope_key=self.tmp.name)
        self.manifest = PluginManifest(name="pixel-deck-readonly", source="user", path=str(PLUGIN_DIR),
                                       provides_tools=sorted(EXPECTED))
        self.ctx = PluginContext(self.manifest, self.mgr)
        self.mod = load_plugin()
        eng = self.mod._load_engine()
        self._orig = eng.LoopbackTransport
        eng.LoopbackTransport = lambda timeout=5.0, token_path=None: good()
        self.addCleanup(setattr, eng, "LoopbackTransport", self._orig)

    def tearDown(self):
        for n in EXPECTED:
            try:
                self.registry.deregister(n, scope=self.mgr.scope_key)
            except Exception:
                pass
        self.tmp.cleanup()

    def test_register_and_dispatch_real_sdk(self):
        self.mod.register(self.ctx)
        for n in EXPECTED:
            entry = self.registry.get_entry(n, scope=self.mgr.scope_key)
            self.assertIsNotNone(entry, n)
            self.assertEqual(entry.toolset, "pixel_deck")
        self.assertTrue(EXPECTED <= self.mgr._plugin_tool_names)
        out = self.registry.dispatch("deck_today", {}, scope=self.mgr.scope_key, task_id="t1", session_id="s1")
        d = json.loads(out if isinstance(out, str) else json.dumps(out))
        self.assertEqual((d["tool"], d["status"]), ("today", "ok"))
        out = self.registry.dispatch("deck_endpoint_audit", {}, scope=self.mgr.scope_key)
        self.assertIn("status", json.loads(out))

    def test_register_does_not_activate_in_test_scope(self):
        self.mod.register(self.ctx)
        self.assertEqual(self.mgr._plugins, {})  # register() alone loads nothing into a manager


if __name__ == "__main__":
    unittest.main()
