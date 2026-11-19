"""Fixture tests for scripts/deck-feed-dev (dev.json). Run: python3 -m unittest discover -s tests"""
import importlib.machinery
import importlib.util
import json
import os
import stat
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "fixtures", "feed_dev")
SCRIPT = os.path.join(HERE, "..", "scripts", "deck-feed-dev")


def load():
    loader = importlib.machinery.SourceFileLoader("deck_feed_dev", SCRIPT)
    spec = importlib.util.spec_from_loader("deck_feed_dev", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    # Never touch the real last-good cache from a test.
    mod.GH_STATE = os.path.join(tempfile.mkdtemp(prefix="deck-feed-dev-test-"), "dev-github.json")
    return mod


def fixture(name):
    with open(os.path.join(FIX, name)) as f:
        return json.load(f)


dev = load()


def reset_state():
    try:
        os.remove(dev.GH_STATE)
    except FileNotFoundError:
        pass


class GithubTests(unittest.TestCase):
    def test_pr_rollup_maps_to_ci_states_and_unknown_stays_null(self):
        prs, _ = dev.parse_github_graphql(fixture("gh_graphql.json"))
        self.assertEqual({(p["repo"], p["num"]): p["ci"] for p in prs},
                         {("o/A", 501): "fail", ("o/B", 7): "pass", ("o/C", 3): "pending", ("o/D", 1): None})

    def test_watch_set_skips_archived_and_branchless_repos_and_keeps_default_branch(self):
        _, watch = dev.parse_github_graphql(fixture("gh_graphql.json"))
        self.assertEqual(watch, {"o/A": "main", "o/B": "trunk", "o/C": "main", "o/E": "main"})

    def test_failing_workflows_use_latest_non_pr_run_per_workflow(self):
        got = dev.failing_workflows("o/A", fixture("gh_runs.json"))
        self.assertEqual([(g["workflow"], g["url"].rsplit("/", 1)[1]) for g in got], [("CI", "9"), ("Nightly", "3")])
        # Deploy failed earlier but its newest run passed, PR-only and cancelled runs never count.

    def test_failing_main_is_capped_and_run_lookup_failures_are_reported(self):
        def fake_run(cmd, timeout, env=None):
            if cmd[:3] == ["gh", "api", "graphql"]:
                return json.dumps(fixture("gh_graphql.json"))
            if "o/B" in cmd[2]:
                raise dev.Fail("gh exit 1: HTTP 404")
            return json.dumps({"workflow_runs": fixture("gh_runs.json")})
        errors = []
        reset_state()
        with mock.patch.object(dev, "run", fake_run), mock.patch.object(dev, "MAX_FAILING", 3):
            gh = dev.collect_github(errors)
        self.assertEqual(len(gh["failing_main"]), 3)
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0]["source"], "github.actions")
        self.assertIn("1/4 repos", errors[0]["reason"])


class VercelTests(unittest.TestCase):
    def test_projects_map_state_pause_alias_and_epoch_seconds(self):
        p = {x["name"]: x for x in dev.parse_vercel(fixture("vercel_projects.json"))}
        self.assertEqual(p["site"], {"name": "site", "state": "READY", "latest_state": "READY", "paused": False,
                                     "last_deploy_at": 1790771863, "production_deploy_at": None,
                                     "url": "https://site.example"})
        self.assertEqual(p["blocked"]["url"], "https://blocked-x.vercel.app")
        self.assertTrue(p["blocked"]["paused"])
        self.assertEqual(p["never"]["state"], None)
        self.assertEqual(p["never"]["last_deploy_at"], None)
        self.assertEqual(p["never"]["url"], None)

    def test_state_is_the_production_deployment_not_the_newest_preview(self):
        p = dev.parse_vercel([{"name": "s", "latestDeployments": [{"readyState": "ERROR", "createdAt": 1790771863000}],
                               "targets": {"production": {"readyState": "READY", "createdAt": 1790700000000,
                                                          "alias": ["s.example"]}}}])[0]
        self.assertEqual((p["state"], p["latest_state"]), ("READY", "ERROR"))
        self.assertEqual((p["last_deploy_at"], p["production_deploy_at"]), (1790771863, 1790700000))

    def test_cdp_on_ipv6_only_says_restart_not_down(self):
        calls = []

        def fake(url, timeout=None):
            calls.append(url)
            if url == dev.CDP:
                raise dev.Fail("connection refused")
            return []
        with mock.patch.object(dev, "http_json", fake):
            with self.assertRaises(dev.Fail) as cm:
                dev.collect_chromium()
        self.assertEqual(calls, [dev.CDP, dev.CDP_V6])
        self.assertIn("answers on [::1] only", str(cm.exception))
        with mock.patch.object(dev, "http_json", side_effect=dev.Fail("refused")):
            with self.assertRaises(dev.Fail) as cm:
                dev.collect_chromium()
        self.assertIn("CDP 9333 down", str(cm.exception))

    def test_expired_oauth_token_is_an_error_not_a_request(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "vercel.json"), "w") as f:
                json.dump({"access_token": "SECRET-VALUE", "expires_at": 1.0}, f)
            with mock.patch.object(dev, "MCP_TOKENS", d), mock.patch.object(dev, "env_value", lambda n: None):
                with self.assertRaises(dev.Fail) as cm:
                    dev.stored_token("VERCEL_TOKEN", "vercel")
        self.assertIn("expired", str(cm.exception))
        self.assertNotIn("SECRET-VALUE", str(cm.exception))

    def test_missing_token_store_names_the_gap(self):
        with tempfile.TemporaryDirectory() as d:
            with mock.patch.object(dev, "MCP_TOKENS", d), mock.patch.object(dev, "env_value", lambda n: None):
                with self.assertRaises(dev.Fail) as cm:
                    dev.stored_token("SUPABASE_ACCESS_TOKEN", "supabase")
        self.assertIn("SUPABASE_ACCESS_TOKEN", str(cm.exception))

    def test_explicit_env_token_wins_over_oauth_store(self):
        with mock.patch.object(dev, "env_value", lambda n: "from-env"):
            self.assertEqual(dev.stored_token("VERCEL_TOKEN", "vercel"), "from-env")


class HerdrChromiumGrokTests(unittest.TestCase):
    def test_herdr_tab_names_and_busy_agents(self):
        h = fixture("herdr.json")
        got = dev.parse_herdr(h["workspaces"], h["tabs"], h["agents"])
        self.assertEqual(got, {"tabs": [{"name": "btop", "panes": 1}, {"name": "opus/main", "panes": 2},
                                        {"name": "opus/logs", "panes": 1}], "agents_busy": 2})

    def test_chromium_counts_pages_only_and_scrubs_token_like_titles(self):
        got = dev.parse_chromium(fixture("cdp_list.json"))
        self.assertEqual(got["tabs"], 4)
        self.assertTrue(got["cdp_up"])
        joined = " ".join(got["titles"])
        self.assertNotIn("SECRETSECRET", joined)
        self.assertNotIn("ghp_", joined)
        self.assertNotIn("http", joined)
        self.assertEqual(got["titles"][0], "App Store Connect")

    def test_chromium_titles_capped_at_eight(self):
        tabs = [{"type": "page", "title": f"t{i}"} for i in range(12)]
        got = dev.parse_chromium(tabs)
        self.assertEqual((got["tabs"], len(got["titles"])), (12, 8))

    def test_grok_version_and_login(self):
        self.assertEqual(dev.parse_grok_version("grok 1.0.40 (eb1a2256660d) [stable]\n"), "1.0.40")
        self.assertIsNone(dev.parse_grok_version("something else"))
        self.assertTrue(dev.grok_logged_in({"issuer::id": {"key": "k", "refresh_token": "r"}}))
        self.assertTrue(dev.grok_logged_in({"i": {"refresh_token": "r"}}))
        self.assertFalse(dev.grok_logged_in({"i": {"key": "", "refresh_token": ""}}))
        self.assertFalse(dev.grok_logged_in({}))


class BuildTests(unittest.TestCase):
    def test_failed_sources_become_null_with_a_reason_and_never_zero(self):
        def boom(*a, **k):
            raise dev.Fail("no VERCEL_TOKEN and no vercel OAuth token store")
        with mock.patch.object(dev, "collect_github", lambda errors: {"open_prs": [], "failing_main": [], "at": 1}), \
                mock.patch.object(dev, "collect_vercel", boom), \
                mock.patch.object(dev, "collect_supabase", boom), \
                mock.patch.object(dev, "collect_herdr", lambda: {"tabs": [], "agents_busy": 0}), \
                mock.patch.object(dev, "collect_chromium", lambda: (_ for _ in ()).throw(dev.Fail("CDP 9333 down: x"))), \
                mock.patch.object(dev, "collect_grok", lambda errors: {"build_cli": None, "logged_in": None}):
            doc = dev.build()
        self.assertIsNone(doc["vercel"])
        self.assertIsNone(doc["supabase"])
        self.assertEqual(doc["github"]["open_prs"], [])
        self.assertEqual(doc["herdr"]["agents_busy"], 0)
        self.assertEqual(doc["chromium"], {"cdp_up": False, "tabs": None, "titles": []})
        self.assertEqual(sorted(e["source"] for e in doc["errors"]), ["chromium", "supabase", "vercel"])
        self.assertNotIn("vercel api", doc["src"])
        self.assertEqual(doc["refresh"], 300)

    def test_write_is_atomic_and_private(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "deck", "dev.json")
            dev.write_atomic(path, {"t": 1})
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
            self.assertEqual(os.listdir(os.path.dirname(path)), ["dev.json"])
            with open(path) as f:
                self.assertEqual(json.load(f), {"t": 1})


if __name__ == "__main__":
    unittest.main()
