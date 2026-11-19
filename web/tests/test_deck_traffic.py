"""Tests for scripts/deck_traffic.py.

Run: python3 -m unittest tests/test_deck_traffic.py -v

No network, no Google account, no real MCP server. `collect` runs against an in-process fake call
function; the stdio client runs against a tiny fake MCP server written to a temp dir; `main` runs
against a fake checkout. The real cache under ~/.meshvault is never touched (every write goes to a
temp dir via --out).
"""
import json
import os
import stat
import subprocess
import sys
import tempfile
import textwrap
import unittest
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import deck_traffic as dt  # noqa: E402

START, END = "2026-09-01", "2026-09-28"


def slurp(path):
    with open(path) as f:
        return f.read()


class Fake:
    """Stands in for McpStdio.call."""

    def __init__(self, sites, results):
        self.sites, self.results, self.calls = sites, results, []

    def __call__(self, tool, args):
        self.calls.append((tool, args))
        if tool == "list_search_console_sites":
            if isinstance(self.sites, Exception):
                raise self.sites
            return {"sites": self.sites}
        r = self.results.get(args["site_url"])
        if isinstance(r, Exception):
            raise r
        return r


def entry(url):
    return {"site_url": url, "permission_level": "siteOwner"}


class DomainAndWindow(unittest.TestCase):
    def test_normalize_domain(self):
        n = dt.normalize_domain
        self.assertEqual(n("sc-domain:MeshVault.ai"), "meshvault.ai")
        self.assertEqual(n("https://protocol-guide.com/"), "protocol-guide.com")
        self.assertEqual(n("https://a.example.com:8443/"), "a.example.com")
        for bad in ("https://a.com/path/", "ftp://a.com/", "sc-domain:", "sc-domain:nodot", "sc-domain:a b.com", None, 5, ""):
            self.assertIsNone(n(bad), bad)

    def test_window_is_inclusive_and_lagged(self):
        self.assertEqual(dt.window(date(2026, 9, 30), 28, 2), ("2026-09-01", "2026-09-28"))
        self.assertEqual(dt.window(date(2026, 9, 30), 1, 0), ("2026-09-30", "2026-09-30"))
        for days, lag in ((0, 2), (481, 2), (28, -1), (28, 31)):
            with self.assertRaises(ValueError):
                dt.window(date(2026, 9, 30), days, lag)

    def test_number_or_none(self):
        f = dt.number_or_none
        self.assertEqual(f(4), 4)
        self.assertEqual(f(4.0), 4)
        self.assertEqual(f(4.5), 4.5)
        for bad in (True, "4", None, -1, float("nan"), float("inf"), [], {}):
            self.assertIsNone(f(bad), repr(bad))


class SiteRow(unittest.TestCase):
    def test_ok_row_is_search_console_clicks_not_visits(self):
        r = dt.site_row("a.com", START, END, 100, {"rows": [{"clicks": 7, "impressions": 90}]}, None)
        self.assertEqual((r["status"], r["value"], r["impressions"], r["t"]), ("ok", 7, 90, 100))
        self.assertEqual((r["provider"], r["metric"]), ("google_search_console", "organic_search_clicks"))
        self.assertNotIn("visits", json.dumps(r))
        self.assertEqual((r["start_date"], r["end_date"]), (START, END))

    def test_measured_zero_is_zero(self):
        r = dt.site_row("a.com", START, END, 100, {"rows": [{"clicks": 0, "impressions": 0}]}, None)
        self.assertEqual((r["status"], r["value"]), ("ok", 0))

    def test_empty_rows_is_no_data_with_null(self):
        r = dt.site_row("a.com", START, END, 100, {"rows": []}, None)
        self.assertEqual(r["status"], "no_data")
        self.assertIsNone(r["value"])
        self.assertIsNone(r["impressions"])

    def test_error_and_malformed_are_null_never_zero(self):
        for res, err in ((None, "Search Console HTTP 403"), ({"rows": "x"}, None), ({"rows": [{"impressions": 3}]}, None), ({}, None)):
            r = dt.site_row("a.com", START, END, 100, res, err)
            self.assertEqual(r["status"], "unavailable")
            self.assertIsNone(r["value"])
            self.assertIsNone(r["impressions"])
            self.assertIsNone(r["t"])
            self.assertTrue(r["error"])

    def test_short_error_hides_wrapper_text(self):
        long = "Error calling tool 'query_search_analytics': Search Console request failed with HTTP 403. Confirm the API"
        self.assertEqual(dt.short_error(long), "Search Console HTTP 403")
        self.assertEqual(dt.short_error("mcp call timed out"), "timed out")
        self.assertEqual(dt.short_error("boom"), "query failed")


class Collect(unittest.TestCase):
    def test_mixed_results_and_read_only_tools(self):
        fake = Fake(
            [entry("sc-domain:a.com"), entry("https://b.com/"), entry("sc-domain:c.com"), entry("sc-domain:a.com")],
            {
                "sc-domain:a.com": {"rows": [{"clicks": 5, "impressions": 50}]},
                "https://b.com/": dt.McpError("Search Console request failed with HTTP 403. x"),
                "sc-domain:c.com": {"rows": []},
            },
        )
        rows = dt.collect(fake, START, END, clock=lambda: 42)
        self.assertEqual([r["domain"] for r in rows], ["a.com", "b.com", "c.com"])
        self.assertEqual([r["status"] for r in rows], ["ok", "unavailable", "no_data"])
        self.assertEqual(rows[1]["error"], "Search Console HTTP 403")
        self.assertIsNone(rows[1]["value"])
        # only the two read tools, never the add/delete property tools
        self.assertEqual({t for t, _ in fake.calls}, {"list_search_console_sites", "query_search_analytics"})
        q = [a for t, a in fake.calls if t == "query_search_analytics"][0]
        self.assertEqual((q["start_date"], q["end_date"], q["row_limit"]), (START, END, 1))
        self.assertEqual(len([1 for t, _ in fake.calls if t == "query_search_analytics"]), 3)

    def test_list_failure_raises_so_cache_is_untouched(self):
        with self.assertRaises(dt.McpError):
            dt.collect(Fake(dt.McpError("mcp server exited"), {}), START, END)
        with self.assertRaises(dt.McpError):
            dt.collect(Fake("nope", {}), START, END)

    def test_bad_entries_and_cap(self):
        entries = [None, {"site_url": 3}, {"site_url": "https://x.com/deep/path"}] + [
            entry(f"sc-domain:s{i}.com") for i in range(50)
        ]
        fake = Fake(entries, {f"sc-domain:s{i}.com": {"rows": [{"clicks": 1, "impressions": 1}]} for i in range(50)})
        rows = dt.collect(fake, START, END)
        self.assertEqual(len(rows), dt.MAX_SITES)

    def test_budget_exhaustion_is_unavailable_not_zero(self):
        fake = Fake([entry("sc-domain:a.com")], {"sc-domain:a.com": {"rows": [{"clicks": 1, "impressions": 1}]}})
        rows = dt.collect(fake, START, END, budget=-1.0)
        self.assertEqual(rows[0]["status"], "unavailable")
        self.assertIsNone(rows[0]["value"])


DAY = "2026-09-28"
PREV = "2026-09-27"
TRACKED = ("a.com", "b.com", "c.com", "d.com")


def days(*pairs):
    """A date-dimension response: (date, clicks) pairs, newest last."""
    return {"rows": [{"keys": [d], "clicks": c, "impressions": 10} for d, c in pairs]}


class CollectDaily(unittest.TestCase):
    def test_every_tracked_site_reported_with_its_own_reason_never_zero(self):
        fake = Fake(
            [
                entry("sc-domain:a.com"),
                {"site_url": "sc-domain:b.com", "permission_level": "siteUnverifiedUser"},
                entry("https://c.com/"),
                entry("sc-domain:extra.com"),
            ],
            {"sc-domain:a.com": days((DAY, 7)), "https://c.com/": dt.McpError("Search Console request failed with HTTP 500 x")},
        )
        day, rows = dt.collect_daily(fake, dt.list_properties(fake), DAY, tracked=TRACKED, clock=lambda: 42)
        self.assertEqual(day, DAY)
        self.assertEqual([r["domain"] for r in rows], list(TRACKED))
        self.assertEqual([r["status"] for r in rows], ["ok", "unavailable", "unavailable", "unavailable"])
        self.assertEqual((rows[0]["value"], rows[0]["impressions"], rows[0]["t"]), (7, 10, 42))
        self.assertEqual(rows[1]["error"], "property not verified")
        self.assertEqual(rows[2]["error"], "Search Console HTTP 500")
        self.assertEqual(rows[3]["error"], "no Search Console property")
        # C3: a 403, an unverified property and a missing property are the owner's to fix; anything else is retried
        self.assertEqual([r.get("reason") for r in rows], [None, "no_access", "failed", "no_access"])
        for r in rows[1:]:
            self.assertIsNone(r["value"])
            self.assertIsNone(r["t"])
        for r in rows:
            self.assertEqual((r["start_date"], r["end_date"]), (DAY, DAY))
            self.assertEqual((r["provider"], r["metric"]), ("google_search_console", "organic_search_clicks"))

    def test_queries_a_seven_day_date_window_and_skips_unverified_and_missing(self):
        fake = Fake(
            [entry("sc-domain:a.com"), {"site_url": "sc-domain:b.com", "permission_level": "siteUnverifiedUser"}],
            {"sc-domain:a.com": days((DAY, 1))},
        )
        dt.collect_daily(fake, dt.list_properties(fake), DAY, tracked=TRACKED)
        queries = [a for t, a in fake.calls if t == "query_search_analytics"]
        self.assertEqual(len(queries), 1)
        q = queries[0]
        self.assertEqual((q["start_date"], q["end_date"], q["dimensions"], q["row_limit"]), ("2026-09-22", DAY, ["date"], 7))
        self.assertEqual({t for t, _ in fake.calls}, {"list_search_console_sites", "query_search_analytics"})

    def test_day_is_newest_date_with_data_and_shared_by_every_row(self):
        # Search Console had nothing for 09-28 yet: the shared day steps back to 09-27, and the site
        # that only has older rows is no_data for that day, not a number from another day
        fake = Fake(
            [entry("sc-domain:a.com"), entry("sc-domain:b.com"), entry("sc-domain:c.com")],
            {
                "sc-domain:a.com": days(("2026-09-26", 4), (PREV, 9)),
                "sc-domain:b.com": days(("2026-09-25", 50)),
                "sc-domain:c.com": days((PREV, 0)),
            },
        )
        day, rows = dt.collect_daily(fake, dt.list_properties(fake), DAY, tracked=TRACKED[:3])
        self.assertEqual(day, PREV)
        self.assertEqual([r["status"] for r in rows], ["ok", "no_data", "ok"])
        self.assertEqual([r["value"] for r in rows], [9, None, 0])  # a measured zero stays 0
        self.assertTrue(all((r["start_date"], r["end_date"]) == (PREV, PREV) for r in rows))

    def test_no_data_anywhere_keeps_the_requested_end_day_with_null_values(self):
        fake = Fake([entry("sc-domain:a.com")], {"sc-domain:a.com": {"rows": []}})
        day, rows = dt.collect_daily(fake, dt.list_properties(fake), DAY, tracked=("a.com", "b.com"))
        self.assertEqual(day, DAY)
        self.assertEqual([(r["status"], r["value"]) for r in rows], [("no_data", None), ("unavailable", None)])

    def test_rows_outside_the_window_or_without_clicks_never_pick_the_day(self):
        fake = Fake(
            [entry("sc-domain:a.com")],
            {"sc-domain:a.com": {"rows": [{"keys": ["2026-10-05"], "clicks": 5}, {"keys": [PREV]}, {"clicks": 3}, "x", {"keys": [PREV, "x"], "clicks": 3}]}},
        )
        day, rows = dt.collect_daily(fake, dt.list_properties(fake), DAY, tracked=("a.com",))
        self.assertEqual(day, DAY)
        self.assertIsNone(rows[0]["value"])

    def test_malformed_response_and_budget_are_unavailable_not_zero(self):
        fake = Fake([entry("sc-domain:a.com"), entry("sc-domain:b.com")], {"sc-domain:a.com": {"rows": "x"}, "sc-domain:b.com": days((DAY, 3))})
        _, rows = dt.collect_daily(fake, dt.list_properties(fake), DAY, tracked=("a.com", "b.com"))
        self.assertEqual((rows[0]["status"], rows[0]["error"], rows[0]["value"]), ("unavailable", "malformed response", None))
        self.assertEqual(rows[1]["value"], 3)
        _, rows = dt.collect_daily(fake, dt.list_properties(fake), DAY, tracked=("b.com",), budget=-1.0)
        self.assertEqual((rows[0]["status"], rows[0]["value"]), ("unavailable", None))

    def test_default_tracked_sites_are_the_owner_monitoring_scope(self):
        self.assertEqual(dt.TRACKED, ("meshvault.ai", "protocol-guide.com", "pepgo.org"))
        self.assertNotIn("judgefinder.io", dt.TRACKED)
        self.assertEqual(dt.DAILY_GOAL, 2000)

    def test_reasons_split_no_access_from_failed(self):
        for text in ("Search Console HTTP 403", "property not verified", "no Search Console property", "siteUnverifiedUser"):
            self.assertEqual(dt.reason_for(text), "no_access", text)
        for text in ("Search Console HTTP 500", "timed out", "query failed", "run budget exhausted", "malformed response"):
            self.assertEqual(dt.reason_for(text), "failed", text)
        self.assertEqual(dt.short_error("tool said siteUnverifiedUser for site"), "property not verified")

    def test_28_day_rows_carry_a_reason_only_when_unavailable(self):
        ok = dt.site_row("a.com", "2026-09-01", "2026-09-28", 5, {"rows": [{"clicks": 4, "impressions": 9}]}, None)
        self.assertNotIn("reason", ok)
        empty = dt.site_row("a.com", "2026-09-01", "2026-09-28", 5, {"rows": []}, None)
        self.assertEqual((empty["status"], "reason" in empty), ("no_data", False))
        forbidden = dt.site_row("b.com", "2026-09-01", "2026-09-28", 5, None, dt.short_error("Search Console request failed with HTTP 403 x"))
        self.assertEqual((forbidden["status"], forbidden["reason"]), ("unavailable", "no_access"))
        for bad in ({"rows": "x"}, {"rows": [{"impressions": 1}]}):
            self.assertEqual(dt.site_row("c.com", "s", "e", 5, bad, None)["reason"], "failed")

    def test_list_properties_keeps_first_property_and_permission(self):
        props = dt.list_properties(
            Fake([{"site_url": "https://a.com/", "permission_level": "siteOwner"}, entry("sc-domain:a.com"), None], {})
        )
        self.assertEqual(props, {"a.com": ("https://a.com/", "siteOwner")})


class CacheFile(unittest.TestCase):
    def test_build_and_atomic_private_write(self):
        rows = [dt.site_row("a.com", START, END, 5, {"rows": [{"clicks": 1, "impressions": 2}]}, None)]
        cache = dt.build_cache(rows, START, END, 9)
        self.assertEqual((cache["schema"], cache["generated_at"], cache["provider"]), (1, 9, "google_search_console"))
        self.assertIn("not total visits", cache["note"])
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "new", "traffic.json")
            dt.write_atomic(out, cache)
            self.assertEqual(json.loads(slurp(out)), cache)
            self.assertEqual(stat.S_IMODE(os.stat(out).st_mode), 0o600)
            self.assertEqual(os.listdir(os.path.dirname(out)), ["traffic.json"])
            dt.write_atomic(out, {**cache, "generated_at": 10})
            self.assertEqual(json.loads(slurp(out))["generated_at"], 10)

    def test_daily_block_is_optional_and_carried_verbatim(self):
        rows = [dt.site_row("a.com", START, END, 5, {"rows": [{"clicks": 1, "impressions": 2}]}, None)]
        self.assertNotIn("daily", dt.build_cache(rows, START, END, 9))
        day = [dt.site_row("a.com", DAY, DAY, 5, None, "no Search Console property")]
        cache = dt.build_cache(rows, START, END, 9, daily=dt.build_daily(day, DAY, 2))
        self.assertEqual(cache["daily"], {"date": DAY, "lag_days": 2, "goal": 2000, "sites": day})
        self.assertEqual(cache["sites"], rows)


FAKE_SERVER = textwrap.dedent(
    '''
    import json, sys
    mode = sys.argv[1] if len(sys.argv) > 1 else "ok"
    for line in sys.stdin:
        m = json.loads(line)
        if "id" not in m:
            continue
        if m["method"] == "initialize":
            r = {"protocolVersion": "2024-11-05", "capabilities": {}}
        elif m["params"]["name"] == "list_search_console_sites":
            r = {"structuredContent": {"sites": [{"site_url": "sc-domain:a.com"}, {"site_url": "sc-domain:b.com"}]}}
        elif m["params"]["arguments"]["site_url"] == "sc-domain:b.com":
            r = {"isError": True, "content": [{"type": "text", "text": "Search Console request failed with HTTP 403. secret-ish"}]}
        else:
            r = {"content": [{"type": "text", "text": json.dumps({"rows": [{"clicks": 3, "impressions": 30}]})}]}
        if mode == "hang" and m["method"] == "tools/call":
            import time; time.sleep(30)
        print(json.dumps({"jsonrpc": "2.0", "id": m["id"], "result": r}), flush=True)
    '''
)


def make_checkout(d, mode="ok"):
    """A fake google-apis-mcp checkout whose .venv/bin/python is a wrapper around this Python."""
    os.makedirs(os.path.join(d, ".venv", "bin"))
    py = os.path.join(d, ".venv", "bin", "python")
    with open(py, "w") as f:
        f.write(f'#!/bin/sh\nexec "{sys.executable}" "$@" {mode}\n')
    os.chmod(py, 0o755)
    with open(os.path.join(d, "server.py"), "w") as f:
        f.write(FAKE_SERVER)


class StdioClient(unittest.TestCase):
    def test_round_trip_against_fake_server(self):
        with tempfile.TemporaryDirectory() as d:
            make_checkout(d)
            c = dt.McpStdio([os.path.join(d, ".venv/bin/python"), os.path.join(d, "server.py")], dt.minimal_env(), 10)
            try:
                rows = dt.collect(c.call, START, END)
            finally:
                c.close()
        self.assertEqual([(r["domain"], r["status"], r["value"]) for r in rows], [("a.com", "ok", 3), ("b.com", "unavailable", None)])
        self.assertEqual(rows[1]["error"], "Search Console HTTP 403")
        self.assertNotIn("secret-ish", json.dumps(rows))

    def test_hung_server_times_out_instead_of_blocking(self):
        with tempfile.TemporaryDirectory() as d:
            make_checkout(d, "hang")
            c = dt.McpStdio([os.path.join(d, ".venv/bin/python"), os.path.join(d, "server.py"), "hang"], dt.minimal_env(), 1.0)
            try:
                with self.assertRaises(dt.McpError) as cm:
                    c.call("list_search_console_sites", {})
                self.assertIn("timed out", str(cm.exception))
            finally:
                c.close()

    def test_minimal_env_drops_secrets_and_pythonpath(self):
        os.environ["PYTHONPATH"] = "/x"
        os.environ["SOME_API_KEY"] = "k"
        try:
            env = dt.minimal_env()
        finally:
            del os.environ["PYTHONPATH"], os.environ["SOME_API_KEY"]
        self.assertNotIn("PYTHONPATH", env)
        self.assertNotIn("SOME_API_KEY", env)
        self.assertLessEqual(set(env), {"PATH", "HOME", "XDG_CONFIG_HOME", "LANG", "LC_ALL"})


class Main(unittest.TestCase):
    def run_main(self, d, *extra):
        script = os.path.join(ROOT, "scripts", "deck_traffic.py")
        return subprocess.run(
            [sys.executable, script, "--mcp-dir", os.path.join(d, "mcp"), *extra],
            capture_output=True,
            text=True,
            timeout=60,
        )

    def test_main_writes_cache_and_exits_2_when_partial(self):
        with tempfile.TemporaryDirectory() as d:
            make_checkout(os.path.join(d, "mcp"))
            out = os.path.join(d, "traffic.json")
            r = self.run_main(d, "--out", out)
            self.assertEqual(r.returncode, 2, r.stderr)
            data = json.loads(slurp(out))
            self.assertEqual(data["schema"], 1)
            self.assertEqual([s["domain"] for s in data["sites"]], ["a.com", "b.com"])
            self.assertIsNone(data["sites"][1]["value"])
            self.assertIn("1/2 sites ok", r.stdout)

    def test_main_writes_daily_block_for_all_tracked_sites(self):
        with tempfile.TemporaryDirectory() as d:
            make_checkout(os.path.join(d, "mcp"))
            out = os.path.join(d, "traffic.json")
            r = self.run_main(d, "--out", out, "--lag", "3")
            self.assertEqual(r.returncode, 2, r.stderr)  # 28-day rows: b.com failed; tracked gaps do not change the code
            data = json.loads(slurp(out))
            daily = data["daily"]
            self.assertEqual(daily["date"], data["window"]["end_date"])
            self.assertEqual((daily["lag_days"], daily["goal"]), (3, 2000))
            self.assertEqual([s["domain"] for s in daily["sites"]], list(dt.TRACKED))
            for s in daily["sites"]:
                self.assertEqual((s["status"], s["value"]), ("unavailable", None))
                self.assertEqual((s["start_date"], s["end_date"]), (daily["date"], daily["date"]))
            self.assertEqual(data["sites"][0]["start_date"], data["window"]["start_date"])
            self.assertIn("daily " + daily["date"] + " (lag 3d) 0/3 tracked ok", r.stdout)

    def test_dry_run_writes_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            make_checkout(os.path.join(d, "mcp"))
            out = os.path.join(d, "traffic.json")
            r = self.run_main(d, "--out", out, "--dry-run")
            self.assertFalse(os.path.exists(out))
            self.assertEqual(json.loads(r.stdout.rsplit("\n", 2)[0])["provider"], "google_search_console")

    def test_missing_checkout_fails_and_leaves_cache(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "traffic.json")
            with open(out, "w") as f:
                f.write('{"keep": true}')
            r = self.run_main(d, "--out", out)
            self.assertEqual(r.returncode, 1)
            self.assertEqual(slurp(out), '{"keep": true}')

    def test_bad_window_args_fail(self):
        with tempfile.TemporaryDirectory() as d:
            make_checkout(os.path.join(d, "mcp"))
            self.assertEqual(self.run_main(d, "--days", "0", "--dry-run").returncode, 1)


if __name__ == "__main__":
    unittest.main()
