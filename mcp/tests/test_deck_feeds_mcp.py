"""Offline tests against fixture feeds. Run with .venv/bin/python -m unittest discover -s tests."""

from __future__ import annotations

import importlib
import json
import os
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import patch

NOW = int(datetime.now(tz=UTC).timestamp())

ROOT = Path(tempfile.mkdtemp(prefix="deck-feeds-test-"))
os.environ["DECK_FEEDS_ROOT"] = str(ROOT)

contract = importlib.import_module("deck_feeds_mcp.contract")
feeds = importlib.import_module("deck_feeds_mcp.feeds")
jobs = importlib.import_module("deck_feeds_mcp.jobs")
server = importlib.import_module("deck_feeds_mcp.server")
taxonomy = importlib.import_module("deck_feeds_mcp.taxonomy")


def write(rel: str, payload: dict) -> Path:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


JOBS: dict[str, Any] = {
    "t": NOW - 120,
    "refresh": 3600,
    "src": ["ashby", "greenhouse"],
    "errors": [{"source": "ziprecruiter", "reason": "blocked page"}],
    "listings": [
        {
            "title": "Senior AI Infrastructure Engineer",
            "company": "Anduril Industries",
            "location": "Costa Mesa, California",
            "remote": None,
            "salary": "$185K - $300K",
            "site": "greenhouse",
            "url": "https://example.test/1",
            "posted_at": NOW - 3600,
            "score": 93,
        },
        {
            "title": "Firefighter Paramedic",
            "company": "Orange County Fire Authority",
            "location": "Irvine, CA",
            "remote": None,
            "salary": "$95,000 - $120,000 a year",
            "site": "governmentjobs",
            "url": "https://example.test/2",
            "posted_at": NOW - 7200,
            "score": 88,
        },
        {
            "title": "Forward Deployed Engineer",
            "company": "OpenAI",
            "location": "San Francisco",
            "remote": True,
            "salary": "$185K - $300K",
            "site": "ashby",
            "url": "https://example.test/3",
            "posted_at": NOW - 1200,
            "score": 91,
        },
        {
            "title": "Founding Engineer",
            "company": "Tiny Startup",
            "location": "Remote",
            "remote": True,
            "salary": None,
            "site": "wellfound",
            "url": "https://example.test/4",
            "posted_at": NOW - 600,
            "score": 70,
        },
        {
            "title": "Ice Hockey Coach",
            "company": "Anaheim Ice",
            "location": "Anaheim, CA",
            "remote": None,
            "salary": "$30 - $45 per hour",
            "site": "dice",
            "url": "https://example.test/5",
            "posted_at": NOW - 900,
            "score": 60,
        },
        {
            "title": "Line Cook",
            "company": "Diner",
            "location": "Dana Point, CA",
            "remote": None,
            "salary": None,
            "site": "dice",
            "url": "https://example.test/6",
            "posted_at": NOW - 300,
            "score": 5,
        },
    ],
}

SURF = {
    "t": NOW - 60,
    "refresh": 1800,
    "spots": [
        {"name": "Salt Creek", "wave_ft_min": 2.0, "wave_ft_max": 2.3, "period_s": 14.0, "rating": "fair"},
        {"name": "Doheny", "wave_ft_min": 1.0, "wave_ft_max": 1.5, "period_s": 12.0, "rating": "poor"},
    ],
    "tide": {"station": "Newport Beach (9410580)", "next": []},
    "buoys": [],
}

HOCKEY = {
    "t": NOW - 300,
    "refresh": 900,
    "teams": [
        {"abbr": "ANA", "name": "Anaheim Ducks", "record": "5-6-1", "points": 11, "standing": "5th Pacific",
         "last_game": {"opp": "VAN", "result": "OTL"}, "next_game": {"opp": "BUF", "home": True}},
        {"abbr": "LAK", "name": "Los Angeles Kings", "record": "3-6-2", "points": 8, "standing": "7th Pacific"},
    ],
    "live": [],
}

REALESTATE = {
    "t": NOW - 400,
    "refresh": 3600,
    "homes": [
        {"addr": "1 A St, Dana Point, CA 92629", "city": "Dana Point", "price": 900000, "beds": 2, "baths": 2},
        {"addr": "2 B St, San Clemente, CA 92672", "city": "San Clemente", "price": 1500000, "beds": 3, "baths": 2},
        {"addr": "3 C St, Dana Point, CA 92629", "city": "Dana Point", "price": 2500000, "beds": 4, "baths": 3},
    ],
    "commercial": [{"addr": "4 D St", "price": 3200000, "sqft": 4000}],
    "market": {"area": "Dana Point", "median_list_price": 1899000},
    "disabled": [{"source": "loopnet", "reason": "Access Denied"}],
}

SCHEDULES = {
    "t": NOW - 90,
    "refresh": 300,
    "counts": {"total": 4, "failing": 1},
    "groups": [
        {"id": "pc-desktop-systemd", "ok": True, "jobs": [
            {"id": "a", "name": "backup", "host": "pc-desktop", "kind": "systemd", "schedule": "hourly",
             "result": "ok", "detail": "", "last": NOW - 600},
            {"id": "b", "name": "verify-builds", "host": "pc-desktop", "kind": "systemd", "schedule": "daily",
             "result": "failed", "detail": "exit 1", "last": NOW - 3600},
        ]},
        {"id": "hermes", "ok": False, "jobs": []},
    ],
}

FLEET = {"t": NOW - 30, "refresh": 300, "ok": False, "failed_units": ["verify-builds.service"]}

CLUSTER = {
    "t": NOW - 45,
    "refresh": 60,
    "errors": [{"source": "spark engine", "reason": "engine inspect: invalid container name or ID: value is empty"}],
    "engine": {"served_name": "DeepSeek-V4.1-Flash-1017-EXL3", "status": "down", "container": None},
    "nodes": [{"name": "spark", "reachable": True, "containers": ["dsv41-1017-tf"]}],
    "proxy": {"pc_desktop_8080_up": True, "models": ["DeepSeek-V4.1-Flash-1017-EXL3"]},
}

INTEREST = {
    "t": NOW - 600,
    "updated": "2026-10-28",
    "sources": {"mail": 1200, "photos": 300},
    "interests": [{"tag": "surf", "weight": 0.8, "evidence_count": 42, "sources": {"photos": 30, "mail": 12}}],
    "job_targets": [{"category": "ai_software", "subcategory": "ai_engineering", "weight": 0.9}],
    "pending": [{"tag": "crypto"}],
}

CASEY_JOBS = {
    "t": NOW - 60,
    "refresh": 3600,
    "person": "casey",
    "src": ["linkedin"],
    "errors": [],
    "taxonomy": [{"slug": "sdr_bdr", "name": "SDR and BDR", "definition": "Entry sales",
                  "subs": [{"slug": "sdr", "name": "SDR"}]}],
    "rules": {"home": "Dana Point, CA", "in_person_metros": ["south_oc", "oc", "sd", "la"],
              "remote_min_pay": 60000},
    "listings": [
        {"title": "Business Development Representative", "company": "Irvine Catering",
         "location": "Irvine, CA", "remote": None, "site": "linkedin", "url": "https://example.test/e1",
         "category": "sdr_bdr", "subcategory": "sdr", "metro": "south_oc", "mode": "in_person",
         "pay_min": 55000, "pay_max": 70000, "score": 80},
        {"title": "Sales Development Representative", "company": "Remote SaaS Co",
         "location": "Remote", "remote": True, "site": "linkedin", "url": "https://example.test/e2",
         "category": "sdr_bdr", "subcategory": "sdr", "metro": "remote", "mode": "remote",
         "pay_min": 60000, "pay_max": 75000, "score": 70},
        {"title": "Sales Development Representative", "company": "Phoenix Sales",
         "location": "Phoenix, AZ", "remote": False, "site": "linkedin", "url": "https://example.test/e3",
         "category": "sdr_bdr", "subcategory": "sdr", "metro": "unknown", "mode": "in_person",
         "pay_min": 60000, "pay_max": 80000, "score": 60},
    ],
}


def setUpModule() -> None:
    write("deck/jobs.json", JOBS)
    write("house-feeds/surf.json", SURF)
    write("house-feeds/hockey.json", HOCKEY)
    write("house-feeds/realestate.json", REALESTATE)
    write("deck/schedules.json", SCHEDULES)
    write("deck/fleet.json", FLEET)
    write("deck/cluster.json", CLUSTER)
    write("deck/interest-profile.json", INTEREST)


class FeedTests(unittest.TestCase):
    def test_source_block_carries_file_and_age(self):
        loaded = feeds.load("surf")
        self.assertIn("house-feeds", loaded["source"]["file"])
        self.assertGreaterEqual(loaded["source"]["age_s"], 55)
        self.assertFalse(loaded["source"]["stale"])

    def test_missing_feed_reports_tried_paths(self):
        loaded = feeds.load("stalls")
        self.assertIn("error", loaded)
        self.assertTrue(loaded["source"]["tried"])

    def test_unknown_feed_refused(self):
        self.assertIn("unknown feed", feeds.load("../../etc/passwd")["error"])

    def test_freshness_lists_stale_and_missing(self):
        report = feeds.freshness()
        self.assertIn("jobs", [row["feed"] for row in report["feeds"]])
        self.assertIn("stalls", report["missing"])
        self.assertFalse(report["stale"])


class FeedFallbackTests(unittest.TestCase):
    def test_load_uses_second_directory_when_primary_file_is_missing(self):
        with tempfile.TemporaryDirectory() as temporary:
            primary = Path(temporary) / "house"
            fallback = Path(temporary) / "deck"
            fallback.mkdir()
            payload = {"t": NOW, "marker": "fallback"}
            (fallback / "surf.json").write_text(json.dumps(payload), encoding="utf-8")
            with patch.dict(feeds.FEEDS, {"surf": (primary, fallback)}):
                loaded = feeds.load("surf")

        self.assertEqual(loaded["data"]["marker"], "fallback")
        self.assertEqual(Path(loaded["source"]["file"]).parent, fallback)


class JobsTests(unittest.TestCase):
    def test_pay_parsing(self):
        self.assertEqual(jobs.pay_range({"salary": "$185K - $300K"})[:2], (185000, 300000))
        self.assertEqual(jobs.pay_range({"salary": "$30 - $45 per hour"})[:2], (62400, 93600))
        self.assertEqual(jobs.pay_range({"salary": None}), (None, None, None))

    def test_metro_classification(self):
        self.assertEqual(jobs.metro_of({"location": "Costa Mesa, California"}), "oc")
        self.assertEqual(jobs.metro_of({"location": "Dana Point, CA"}), "south_oc")
        self.assertEqual(jobs.metro_of({"location": "San Diego, CA"}), "sd")
        self.assertEqual(jobs.metro_of({"location": "Remote"}), "remote")
        self.assertEqual(jobs.metro_of({"location": "Denver, CO"}), "unknown")
        # the collector's territory: the southern OC corridor includes Irvine and Lake Forest
        self.assertEqual(jobs.metro_of({"location": "Irvine, CA"}), "south_oc")
        self.assertEqual(jobs.metro_of({"location": "Lake Forest, CA"}), "south_oc")
        # the source flag wins, and a remote role restricted to another country is out of area
        self.assertEqual(jobs.metro_of({"location": "San Francisco", "remote": True}), "remote")
        self.assertEqual(jobs.metro_of({"location": "Toronto, Canada", "remote": True}), "unknown")
        self.assertEqual(jobs.mode_of({"location": "Irvine, CA", "summary": "hybrid, 3 days onsite"}),
                         "hybrid")

    def test_classifier_uses_the_collector_slugs(self):
        # Same slugs the Jobs collector publishes, so a fallback classification still filters.
        self.assertEqual(jobs.classify({"title": "Firefighter Paramedic"}), ("fire_ems", "fire_paramedic"))
        self.assertEqual(jobs.classify({"title": "Senior AI Infrastructure Engineer"}),
                         ("ai_software", "ai_engineering"))
        self.assertEqual(jobs.classify({"title": "Ice Hockey Coach"}), ("hockey_sports", "hockey_operations"))
        self.assertEqual(jobs.classify({"title": "Ocean Lifeguard"}), ("fire_ems", "ocean_rescue"))
        self.assertEqual(jobs.classify({"title": "Chief of Staff"}), ("founder_startup", "generalist_ops"))
        self.assertEqual(jobs.classify({"title": "Line Cook"}), (None, None))

    def test_search_applies_area_and_remote_pay_rules(self):
        out = jobs.search(JOBS["listings"], limit=10)
        companies = [row["company"] for row in out["listings"]]
        self.assertIn("Anduril Industries", companies)
        self.assertIn("Orange County Fire Authority", companies)
        self.assertIn("OpenAI", companies)          # remote, pay_max 300k
        self.assertNotIn("Tiny Startup", companies)  # remote, pay unknown
        self.assertEqual(out["excluded"]["remote_pay"], 1)

    def test_search_filters(self):
        out = jobs.search(JOBS["listings"], category="fire_ems", limit=10)
        self.assertEqual([row["company"] for row in out["listings"]], ["Orange County Fire Authority"])
        out = jobs.search(JOBS["listings"], query="anduril", limit=10)
        self.assertEqual(out["matched"], 1)
        out = jobs.search(JOBS["listings"], metro="remote", limit=10)
        self.assertEqual([row["company"] for row in out["listings"]], ["OpenAI"])

    def test_search_orders_matches_by_metro_then_score_and_caps_results(self):
        listings = [
            {"title": "Lower score", "company": "B", "location": "Costa Mesa, CA", "score": 10},
            {"title": "Higher score", "company": "A", "location": "Costa Mesa, CA", "score": 90},
            {"title": "Closer metro", "company": "C", "location": "Dana Point, CA", "score": 1},
        ]

        out = jobs.search(listings, apply_rules=False, limit=2)

        self.assertEqual([row["company"] for row in out["listings"]], ["C", "A"])
        self.assertEqual(out["matched"], 3)

    def test_search_reports_minimum_pay_exclusions(self):
        listings = [
            {"title": "Below floor", "company": "A", "location": "Irvine, CA", "pay_max": 90000},
            {"title": "At floor", "company": "B", "location": "Irvine, CA", "pay_max": 100000},
        ]

        out = jobs.search(listings, min_pay=100000)

        self.assertEqual([row["company"] for row in out["listings"]], ["B"])
        self.assertEqual(out["excluded"]["min_pay"], 1)

    def test_market_rollup(self):
        rolled = jobs.market_or_derived(JOBS)
        self.assertEqual(rolled["market_source"], "derived-from-listings")
        ai = rolled["market"]["by_category"]["ai_software"]
        self.assertEqual(ai["total"], 2)
        self.assertEqual(ai["median_pay_max"], 300000)
        self.assertEqual(ai["remote_unknown_pay"], 0)
        founder = rolled["market"]["by_category"]["founder_startup"]
        self.assertEqual(founder["total"], 1)
        self.assertEqual(founder["remote_unknown_pay"], 1)

    def test_taxonomy_seed_has_required_slugs(self):
        found = jobs.taxonomy({})
        self.assertEqual(found["taxonomy_source"], "server-seed")
        slugs = {row["slug"] for row in found["taxonomy"]}
        for slug in ("ai_software", "fire_ems", "public_safety_tech", "health_medtech", "real_estate",
                     "finance_markets", "hockey_sports", "surf_outdoor", "founder_startup"):
            self.assertIn(slug, slugs)
        for row in found["taxonomy"]:
            self.assertTrue(row["definition"])
            self.assertTrue(row["subs"])
        self.assertEqual(found["rules"]["remote_min_pay"], 100000)


class ToolTests(unittest.TestCase):
    def test_every_tool_returns_source(self):
        calls = [
            ("jobs_search", {"limit": 5}),
            ("job_market", {}),
            ("job_taxonomy", {}),
            ("interest_profile_summary", {}),
            ("housing_market", {}),
            ("surf_report", {}),
            ("hockey", {}),
            ("crons_attention", {}),
            ("fleet_status", {}),
            ("cluster_status", {}),
            ("feed_freshness", {}),
            ("deck_feeds_status", {}),
        ]
        for name, args in calls:
            tool = getattr(server, name)
            out = tool(**args)
            self.assertTrue(out.get("ok"), f"{name} failed: {out}")
            if name in ("feed_freshness", "deck_feeds_status"):
                continue
            self.assertIn("source", out, name)
            self.assertIn("file", out["source"], name)

    def test_surf_spot_filter_and_unknown(self):
        self.assertEqual(len(server.surf_report("")["spots"]), 2)
        self.assertEqual(server.surf_report("doheny")["spots"][0]["name"], "Doheny")
        self.assertIn("error", server.surf_report("Teahupoo"))

    def test_hockey_by_abbr(self):
        out = server.hockey("ana")
        self.assertEqual(out["teams"][0]["name"], "Anaheim Ducks")

    def test_housing_scope_and_filters(self):
        out = server.housing_market("homes", city="dana point", max_price=1000000)
        self.assertEqual(out["homes"]["matched"], 1)
        self.assertEqual(out["homes"]["median_price"], 900000)
        self.assertEqual(server.housing_market("bogus")["ok"], False)

    def test_crons_attention(self):
        out = server.crons_attention()
        self.assertEqual([j["name"] for j in out["attention"]], ["verify-builds"])
        self.assertEqual(out["unhealthy_groups"], ["hermes"])

    def test_cluster_flags_suspect_engine(self):
        out = server.cluster_status()
        self.assertTrue(out["engine_status_suspect"])

    def test_interest_profile_tags_only(self):
        out = server.interest_profile_summary()
        self.assertTrue(out["present"])
        self.assertEqual(out["tags"][0]["tag"], "surf")
        self.assertEqual(out["pending_count"], 1)
        self.assertNotIn("pending", out)

    def test_interest_profile_absent(self):
        (ROOT / "deck/interest-profile.json").unlink()
        out = server.interest_profile_summary()
        self.assertFalse(out["ok"])
        self.assertFalse(out["present"])
        write("deck/interest-profile.json", INTEREST)

    def test_jobs_search_metro_unknown_note(self):
        out = server.jobs_search(category="ai_software", limit=5)
        self.assertTrue(out["ok"])
        self.assertEqual(out["taxonomy_source"], "server-seed")

    def test_jobs_tools_refuse_an_unknown_person(self):
        for name in ("jobs_search", "job_market", "job_taxonomy"):
            out = getattr(server, name)(person="quill")
            self.assertFalse(out["ok"], name)
            self.assertIn("unknown person", out["error"])
            self.assertEqual(out["allowed"], ["tanner", "casey", "riley", "morgan"])

    def test_jobs_search_reads_the_person_feed_and_its_own_rules(self):
        write("deck/jobs-casey.json", CASEY_JOBS)
        try:
            out = server.jobs_search(person="casey", limit=10)
            self.assertTrue(out["ok"], out)
            self.assertEqual(out["feed"], "jobs-casey")
            self.assertIn("jobs-casey.json", out["source"]["file"])
            self.assertEqual(out["rules_source"], "feed")
            self.assertEqual(out["rules"]["remote_min_pay"], 60000)
            companies = [row["company"] for row in out["listings"]]
            self.assertIn("Remote SaaS Co", companies)    # remote at 75k clears Casey's 60k floor
            self.assertNotIn("Phoenix Sales", companies)  # Phoenix is outside Casey's metros
            self.assertEqual(out["excluded"]["area"], 1)
            # Irvine plus the 75k remote row; Tanner's 100k floor would have kept only Irvine.
            self.assertEqual(server.jobs_search(person="casey", category="sdr_bdr", limit=5)["matched"], 2)
            tax = server.job_taxonomy(person="casey")
            self.assertEqual(tax["taxonomy_source"], "feed")
            self.assertEqual([row["slug"] for row in tax["taxonomy"]], ["sdr_bdr"])
            market = server.job_market(person="casey")
            self.assertEqual(market["feed"], "jobs-casey")
            self.assertEqual(market["market"]["by_category"]["sdr_bdr"]["total"], 3)  # derived roll-up counts every row
        finally:
            (ROOT / "deck/jobs-casey.json").unlink()

    def test_person_feed_without_blocks_never_borrows_tanners_seed(self):
        bare = {k: v for k, v in CASEY_JOBS.items() if k not in ("taxonomy", "rules")}
        write("deck/jobs-riley.json", bare)
        try:
            tax = server.job_taxonomy(person="riley")
            self.assertEqual(tax["taxonomy_source"], "none")
            self.assertIsNone(tax["taxonomy"])
            out = server.jobs_search(person="riley")
            self.assertFalse(out["ok"])
            self.assertIn("no valid rules block", out["error"])
            loose = server.jobs_search(person="riley", apply_rules=False, limit=10)
            self.assertTrue(loose["ok"])
            self.assertTrue(all(row["classified_by"] == "feed" for row in loose["listings"]))
        finally:
            (ROOT / "deck/jobs-riley.json").unlink()

    def test_missing_person_feed_reports_tried_paths(self):
        out = server.jobs_search(person="morgan")
        self.assertFalse(out["ok"])
        self.assertEqual(out["feed"], "jobs-morgan")
        self.assertIn("jobs-morgan.json", out["source"]["tried"][0])


class TaxonomyLoaderTests(unittest.TestCase):
    def test_load_rejects_boolean_remote_pay_threshold(self):
        document = json.loads(taxonomy.CONTRACT_PATH.read_text(encoding="utf-8"))
        document["rules"]["remote_min_pay"] = True
        with tempfile.TemporaryDirectory() as temporary:
            contract_path = Path(temporary) / "taxonomy.json"
            contract_path.write_text(json.dumps(document), encoding="utf-8")
            with patch.object(taxonomy, "CONTRACT_PATH", contract_path):
                taxonomy.load.cache_clear()
                try:
                    with self.assertRaisesRegex(taxonomy.ContractError, "remote_min_pay must be an integer"):
                        taxonomy.load()
                finally:
                    taxonomy.load.cache_clear()


class TaxonomyContractTests(unittest.TestCase):
    def test_seed_matches_the_published_feed_when_the_live_feed_is_present(self):
        live = Path.home() / ".meshvault/status/deck/jobs.json"
        if not live.is_file():
            self.skipTest("no live jobs.json on this host")
        data = json.loads(live.read_text(encoding="utf-8"))
        published = data.get("taxonomy")
        if not isinstance(published, list) or not published:
            self.skipTest("live jobs.json has no taxonomy block yet")
        self.assertIsNone(jobs.taxonomy_block_problem(published))
        self.assertEqual(
            [(row["slug"], [sub["slug"] for sub in row["subs"]]) for row in taxonomy.taxonomy()],
            [(row["slug"], [sub["slug"] for sub in row["subs"]]) for row in published],
            "deck_feeds_mcp/taxonomy_contract.json drifted from the Jobs collector's taxonomy",
        )

    def test_every_rule_points_at_a_published_subcategory(self):
        subs = taxonomy.subs()
        for category, sub, weight, _pattern in taxonomy.keyword_rules():
            self.assertIn(sub, subs[category], f"{category}/{sub} is not a published subcategory")
            self.assertGreater(weight, 0)

    def test_malformed_feed_taxonomy_falls_back_to_the_seed(self):
        broken = {"taxonomy": [{"slug": "ai_software"}], "rules": {"remote_min_pay": "lots"}}
        found = jobs.taxonomy(broken)
        self.assertEqual(found["taxonomy_source"], "server-seed")
        self.assertEqual(found["rules_source"], "server-seed")
        self.assertIn("no name", found["taxonomy_problem"])
        self.assertEqual(found["taxonomy"], taxonomy.taxonomy())
        self.assertEqual(found["rules"]["remote_min_pay"], 100000)

    def test_published_taxonomy_is_served_as_is(self):
        published = taxonomy.taxonomy()
        found = jobs.taxonomy({"taxonomy": published,
                               "rules": {"in_person_metros": ["south_oc", "oc", "la", "sd"],
                                         "remote_min_pay": 120000}})
        self.assertEqual(found["taxonomy_source"], "feed")
        self.assertEqual(found["rules_source"], "feed")
        self.assertEqual(found["rules"]["remote_min_pay"], 120000)
        self.assertNotIn("taxonomy_problem", found)


def published_jobs() -> dict:
    """A jobs feed shaped exactly like the collector's output: blocks plus fully tagged rows."""
    rows = []
    for row in JOBS["listings"]:
        item = dict(row)
        category, subcategory = jobs.classify(item)
        item.update({
            "category": category, "subcategory": subcategory,
            "metro": jobs.metro_of(item), "mode": jobs.mode_of(item),
            "pay_min": jobs.pay_range(item)[0], "pay_max": jobs.pay_range(item)[1],
            "pay_text": row.get("salary"), "summary": None, "why": [], "cluster_take": None,
            "flags": [], "flag_text": [], "note": None,
        })
        if item["metro"] == "remote" and not item["pay_max"]:
            continue  # the collector drops remote roles with unknown pay, so the feed never has them
        rows.append(item)
    payload = dict(JOBS)
    payload["listings"] = rows
    payload["taxonomy"] = taxonomy.taxonomy()
    payload["rules"] = {"home": "Dana Point, CA", "in_person_metros": ["south_oc", "oc", "sd", "la"],
                        "remote_min_pay": 100000}
    payload["market"] = {"by_category": jobs.market(rows), "listings_total": len(rows)}
    return payload


class ContractTests(unittest.TestCase):
    """The validator must measure the live contract, not assume it."""

    def setUp(self):
        self.saved = {name: (ROOT / f"deck/{name}.json").read_text(encoding="utf-8")
                      for name in ("jobs", "interest-profile")
                      if (ROOT / f"deck/{name}.json").is_file()}
        write("deck/jobs.json", published_jobs())
        self.launch = {"t": NOW - 60, "refresh": 900, "items": [
            {"id": "skill:fleet-audit", "kind": "skill", "name": "Fleet audit", "targets": ["hermes"],
             "arg": "fleet-audit"},
            {"id": "automation:timer-backup", "kind": "automation", "name": "Backup", "targets": []},
        ]}
        write("deck/launch.json", self.launch)

    def tearDown(self):
        for name, text in self.saved.items():
            (ROOT / f"deck/{name}.json").write_text(text, encoding="utf-8")
        (ROOT / "deck/launch.json").unlink(missing_ok=True)
        (ROOT / "deck/jobs-insight.json").unlink(missing_ok=True)

    def test_jobs_contract_counts_categories_metros_and_violations(self):
        found = contract.validate_jobs()
        self.assertEqual(found["rows"], len(published_jobs()["listings"]))
        self.assertTrue(found["categories"])
        self.assertEqual(found["remote_pay_violations"], 0)
        self.assertFalse(any("violations" in c and c["violations"] for c in found["checks"]))

    def test_jobs_contract_catches_a_remote_row_under_the_pay_floor(self):
        payload = published_jobs()
        openai = next(row for row in payload["listings"] if row["company"] == "OpenAI")
        openai["pay_max"] = 90000
        openai["pay_text"] = "$90K"
        write("deck/jobs.json", payload)
        found = contract.validate_jobs()
        self.assertGreater(found["remote_pay_violations"], 0)
        self.assertFalse(found["ok"])
        check = next(c for c in found["checks"] if c["check"] == "remote pay rule")
        self.assertEqual(check["violations"], 1)

    def test_jobs_contract_catches_an_unpublished_subcategory(self):
        payload = published_jobs()
        payload["listings"][0]["category"] = "fire_ems"
        payload["listings"][0]["subcategory"] = "firefighter_paramedic"
        write("deck/jobs.json", payload)
        found = contract.validate_jobs()
        check = next(c for c in found["checks"] if c["check"].startswith("every subcategory"))
        self.assertEqual(len(check["violations"]), 1)

    def test_jobs_contract_reports_missing_published_fields(self):
        payload = published_jobs()
        payload["listings"][0].pop("cluster_take")
        write("deck/jobs.json", payload)

        found = contract.validate_jobs()

        check = next(c for c in found["checks"] if c["check"] == "every listing carries the published fields")
        self.assertFalse(check["ok"])
        self.assertEqual(check["missing"], {"cluster_take": 1})

    def test_launch_contract_allows_view_only_items(self):
        found = contract.validate_launch()
        self.assertTrue(found["ok"], found)
        self.assertEqual(found["items"], 2)

    def test_launch_contract_rejects_an_unknown_target(self):
        broken = json.loads(json.dumps(self.launch))
        broken["items"][0]["targets"] = ["quill"]
        write("deck/launch.json", broken)
        found = contract.validate_launch()
        self.assertFalse(found["ok"])

    def test_launch_contract_rejects_an_empty_hermes_argument(self):
        broken = json.loads(json.dumps(self.launch))
        broken["items"][0]["arg"] = ""
        write("deck/launch.json", broken)

        found = contract.validate_launch()

        check = next(c for c in found["checks"] if c["check"] == "hermes-targeted items carry an arg")
        self.assertFalse(check["ok"])
        self.assertEqual(check["empty"], 1)

    def test_launch_contract_rejects_an_empty_id_slug(self):
        broken = json.loads(json.dumps(self.launch))
        broken["items"][0]["id"] = "skill:"
        write("deck/launch.json", broken)
        found = contract.validate_launch()
        check = next(c for c in found["checks"] if c["check"] == "ids follow the launch contract")
        self.assertFalse(check["ok"])
        self.assertEqual(check["malformed"], 1)

    def test_interest_profile_flags_targets_outside_the_taxonomy(self):
        found = contract.validate_interest_profile()
        self.assertTrue(found["ok"], found)
        payload = json.loads((ROOT / "deck/interest-profile.json").read_text(encoding="utf-8"))
        payload["job_targets"] = [{"category": "fire_ems", "subcategory": "firefighter_paramedic",
                                   "weight": 0.8}]
        write("deck/interest-profile.json", payload)
        found = contract.validate_interest_profile()
        check = next(c for c in found["checks"] if c["check"].startswith("job targets"))
        self.assertEqual(len(check["violations"]), 1)

    def test_interest_profile_tool_reports_unmapped_targets(self):
        payload = json.loads((ROOT / "deck/interest-profile.json").read_text(encoding="utf-8"))
        payload["job_targets"] = [{"category": "fire_ems", "subcategory": "firefighter_paramedic",
                                   "weight": 0.8},
                                  {"category": "ai_software", "subcategory": "ai_engineering",
                                   "weight": 0.9}]
        write("deck/interest-profile.json", payload)
        out = server.interest_profile_summary()
        self.assertEqual([row["taxonomy_match"] for row in out["job_targets"]], [False, True])
        self.assertEqual(out["job_targets_unmapped"][0]["subcategory"], "firefighter_paramedic")

    def test_contract_tool_serves_all_three_feeds(self):
        out = server.feed_contract()
        self.assertEqual(sorted(out["feeds"]), ["interest-profile", "jobs", "launch"])
        self.assertTrue(out["feeds"]["jobs"]["rows"])
        self.assertEqual(server.feed_contract("bogus")["ok"], False)


class ReplyBlockRankWatchTests(unittest.TestCase):
    def setUp(self):
        write("deck/replyblock.json", {
            "t": NOW - 600, "refresh": 86400, "src": ["gmail via composio"], "errors": [],
            "date": "2026-10-29", "card_for": "09:00", "mode": "run",
            "model": {"used": False, "id": None, "note": "cluster unreachable"},
            "counts": {"waiting": 2, "drafted": 2, "cap": 15, "gmail_drafts_before": 208, "gmail_drafts_after": 210},
            "drafts_url": "https://mail.google.com/mail/u/0/#drafts",
            "items": [
                {"rank": 1, "name": "Casey Harbor", "subject": "Quote", "drafted": True, "draft_mode": "template",
                 "thread_url": "https://mail.google.com/mail/u/0/#inbox/1a", "draft_url": "https://mail.google.com/mail/u/0/#drafts/r1",
                 "preview": ["Hi Casey,", "SECRET BODY"]},
                {"rank": 2, "name": "Lane Quill", "subject": "Dinner", "drafted": True, "draft_mode": "model",
                 "thread_url": "https://mail.google.com/mail/u/0/#inbox/1b"},
            ],
        })
        write("deck/rankwatch.json", {
            "t": NOW - 600, "refresh": 86400, "src": ["itunes"], "errors": [], "day": "2026-10-29", "stale": False,
            "run": {"ok_charts": 14, "failed_charts": 1}, "counts": {"apps": 9, "live": 0, "alerts_today": 1, "alerts_7d": 3},
            "apps": [{"key": "mesh"}], "categories": [{"label": "Productivity"}],
            "alerts": [
                {"day": "2026-10-29", "kind": "own_entered", "severity": "good", "name": "Mesh", "text": "Mesh entered at #80."},
                {"day": "2026-10-29", "kind": "jump", "severity": "warn", "name": "Rival", "text": "Rival moved 25 places."},
                {"day": "2026-10-28", "kind": "new_entrant", "severity": "warn", "name": "New", "text": "New in chart at #12."},
                {"day": "2026-10-27", "kind": "own_live", "severity": "good", "name": "Dictate", "text": "Dictate is live."},
            ],
        })

    def tearDown(self):
        (ROOT / "deck/replyblock.json").unlink(missing_ok=True)
        (ROOT / "deck/rankwatch.json").unlink(missing_ok=True)

    def test_feeds_are_registered_read_only(self):
        self.assertIn("replyblock", feeds.ALLOWED_NAMES)
        self.assertIn("rankwatch", feeds.ALLOWED_NAMES)
        self.assertTrue(feeds.load("replyblock")["source"]["file"].endswith("deck/replyblock.json"))
        names = {row["feed"] for row in feeds.freshness()["feeds"]}
        self.assertTrue({"replyblock", "rankwatch"} <= names)

    def test_reply_block_tool_returns_counts_and_links_and_drops_everything_else(self):
        out = server.reply_block()
        self.assertTrue(out["ok"])
        self.assertEqual(out["counts"]["drafted"], 2)
        self.assertEqual(out["card_for"], "09:00")
        self.assertEqual(out["items"][0]["draft_url"], "https://mail.google.com/mail/u/0/#drafts/r1")
        self.assertEqual(out["items_total"], 2)
        self.assertNotIn("SECRET", json.dumps(out))
        self.assertEqual(len(server.reply_block(limit=1)["items"]), 1)

    def test_rank_watch_tool_puts_warnings_first_and_caps_alerts(self):
        out = server.rank_watch()
        self.assertTrue(out["ok"])
        self.assertEqual(out["run"]["ok_charts"], 14)
        self.assertEqual([a["name"] for a in out["alerts"]], ["Rival", "New", "Mesh"])
        self.assertEqual(out["alerts_total"], 4)
        self.assertNotIn("apps", out)
        self.assertEqual(len(server.rank_watch(limit=1)["alerts"]), 1)

    def test_missing_feeds_report_an_error_not_zero(self):
        (ROOT / "deck/replyblock.json").unlink()
        (ROOT / "deck/rankwatch.json").unlink()
        self.assertFalse(server.reply_block()["ok"])
        self.assertFalse(server.rank_watch()["ok"])


class HouseToolsTests(unittest.TestCase):
    """release_status, deadlines, network, stalls, deck_needs: shapes follow the live collectors."""

    NAMES = ("testflight", "deadlines", "tailscale", "stalls", "products")

    def setUp(self):
        iso = datetime.fromtimestamp(NOW - 90, tz=UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        good = {"id": "b1", "number": "13", "version": "1.0", "uploaded_at": "2026-10-29T13:12:10-07:00",
                "processing_state": "VALID", "expired": False, "internal_state": "IN_BETA_TESTING",
                "external_state": "READY_FOR_BETA_SUBMISSION"}
        write("deck/testflight.json", {  # live shape: checked_at and refresh_s, no t
            "schema_version": 1, "checked_at": iso, "refresh_s": 300,
            "apps": [
                {"id": "1", "name": "Calm", "bundle_id": "net.example.calm", "checked_at": iso, "error": None,
                 "versions": [{"version": "1.0", "state": "WAITING_FOR_REVIEW", "submitted_build": {"number": "7"},
                               "submission": {"state": "WAITING_FOR_REVIEW"}}],
                 "latest_build": good, "feedback": {"screenshots_count": 2, "crashes_count": 0, "last_received_at": None}},
                {"id": "2", "name": "Stuck", "bundle_id": "net.example.stuck", "checked_at": iso, "error": None,
                 "versions": [{"version": "2.0", "state": "UNRESOLVED_ISSUES"}],
                 "latest_build": dict(good, expired=True), "feedback": {"screenshots_count": 0, "crashes_count": 3}},
                {"id": "3", "name": "Crashy", "checked_at": iso, "error": None, "versions": [],
                 "latest_build": good, "feedback": {"crashes_count": 2, "last_received_at": iso}},
                {"id": "4", "name": "OldCrashes", "checked_at": iso, "error": None, "versions": [],
                 "latest_build": good, "feedback": {"crashes_count": 9, "last_received_at": "2020-01-01T00:00:00.000Z"}},
            ]})
        write("deck/deadlines.json", {
            "t": NOW - 60, "refresh": 3600, "src": ["renewals", "paperwork"], "errors": [{"source": "paperwork", "reason": "db locked"}],
            "renewals": [{"vendor": "Vercel", "date": "2026-11-20", "days": 22, "amount": 240},
                         {"vendor": "Domain", "date": "2026-11-05", "days": 7, "amount": 20}],
            "paperwork": [{"id": "p1", "kind": "tax", "thing": "Estimated tax", "date": "2026-11-01", "days_left": 3,
                           "status": "open", "evidence": ["SECRET"], "history": [1]}]})
        write("deck/tailscale.json", {
            "t": NOW - 30, "refresh": 300, "src": ["tailscale status --json"], "errors": [],
            "counts": {"own_devices": 3, "own_online": 2, "funnel_public": 1, "warn": 2, "crit": 0},
            "alerts": [{"host": "a", "kind": "traffic_spike", "msg": "rx up", "severity": "info"},
                       {"host": "pc-desktop", "kind": "funnel_public", "msg": "PUBLIC via Funnel", "severity": "warn"}],
            "exposures": [{"host": "pc-desktop", "port": "10443", "path": "/", "proto": "https", "funnel": 0},
                          {"host": "pc-desktop", "port": "443", "path": "/gt", "proto": "https", "funnel": 1}],
            "nodes": [{"name": "ascent", "host": "ascent", "online": True, "last_seen_h": None, "os": "linux", "kind": "own",
                       "rx_mib": 17695, "tx_mib": 355, "relay": "lax"}]})
        write("deck/stalls.json", {
            "t": NOW - 20, "refresh": 120, "src": ["omp sessions"], "errors": [],
            "thresholds": {"quiet_min": 15}, "counts": {"watched": 3, "ok": 1, "stalled": 1, "failed": 1},
            "items": [{"id": "omp:1", "kind": "omp", "name": "OMP ~", "host": "pc-desktop", "state": "stalled",
                       "since": 1, "last_output_at": 1, "reason": "No output for 10 h", "hint": "Open the session"},
                      {"id": "omp:2", "kind": "omp", "name": "fine", "state": "ok"},
                      {"id": "unit:3", "kind": "unit", "name": "mesh-backup.service", "state": "failed", "reason": "exit 1"}],
            "alerts": {"phone_setup": "Add Environment=DECK_STALL_NTFY_URL=SECRET"}})
        write("deck/products.json", {
            "t": NOW - 45, "refresh": 300, "src": ["accounts.json"], "errors": [],
            "products": [{"id": "m", "name": "meshvault.ai", "url": "https://meshvault.ai/", "code": 200, "ms": 137,
                          "state": "up", "monitor": {"checks": 4}}],
            "needs": [{"sev": "med", "text": "Attach build 72", "why": "version uses build 71", "source": "app store connect",
                       "url": "https://example.test/a"},
                      {"sev": "med", "text": "Fix CI", "why": "Test Suite", "source": "dev.json", "url": "https://example.test/b"}]})

    def tearDown(self):
        for name in self.NAMES:
            (ROOT / f"deck/{name}.json").unlink(missing_ok=True)

    def test_feeds_are_registered_and_listed_in_freshness(self):
        for name in self.NAMES:
            self.assertIn(name, feeds.ALLOWED_NAMES)
        rows = {row["feed"]: row for row in feeds.freshness()["feeds"]}
        self.assertTrue(all(rows[name]["present"] for name in self.NAMES))

    def test_every_tool_returns_source_age(self):
        for tool in (server.release_status, server.deadlines, server.network, server.stalls, server.deck_needs):
            out = tool()
            self.assertTrue(out["ok"], tool.__name__)
            self.assertIsInstance(out["source"]["age_s"], int, tool.__name__)
            self.assertFalse(out["source"]["stale"], tool.__name__)

    def test_release_status_ages_from_checked_at_and_flags_attention(self):
        out = server.release_status()
        self.assertLess(out["source"]["age_s"], 200)  # derived from checked_at, not file mtime
        self.assertEqual(out["source"]["refresh_s"], 300)
        self.assertEqual((out["apps_total"], out["attention_total"]), (4, 2))
        stuck = next(a for a in out["apps"] if a["name"] == "Stuck")
        self.assertEqual(stuck["attention"], ["build expired", "version unresolved_issues"])
        self.assertNotIn("bundle_id", json.dumps(out))
        self.assertEqual([a["name"] for a in server.release_status(attention_only=True)["apps"]], ["Stuck", "Crashy"])
        crashy = next(a for a in out["apps"] if a["name"] == "Crashy")
        self.assertEqual(crashy["attention"], ["2 crash reports, latest within 7 d"])

    def test_release_status_does_not_treat_future_feedback_as_recent(self):
        future = datetime.fromtimestamp(NOW + 60, tz=UTC).isoformat()
        write("deck/testflight.json", {
            "schema_version": 1, "checked_at": future, "refresh_s": 300,
            "apps": [{
                "id": "1", "name": "FutureCrash", "latest_build": {},
                "versions": [], "feedback": {"crashes_count": 1, "last_received_at": future},
            }],
        })

        out = server.release_status()

        app = out["apps"][0]
        self.assertEqual(app["attention"], ["no build"])
        self.assertNotIn("crash reports", " ".join(app["attention"]))

    def test_release_status_treats_processing_as_pending_but_flags_rejection(self):
        iso = datetime.fromtimestamp(NOW - 90, tz=UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        build = {"processing_state": "PROCESSING", "expired": False,
                 "internal_state": "IN_BETA_TESTING", "external_state": "READY_FOR_BETA_SUBMISSION"}
        write("deck/testflight.json", {
            "schema_version": 1, "checked_at": iso, "refresh_s": 300,
            "apps": [
                {"id": "1", "name": "Pending", "latest_build": build, "versions": [], "feedback": {}},
                {"id": "2", "name": "Rejected", "latest_build": dict(build, external_state="REJECTED"),
                 "versions": [], "feedback": {}},
            ],
        })

        out = server.release_status()

        self.assertEqual(out["attention_total"], 1)
        self.assertEqual(out["apps"][0]["name"], "Pending")
        self.assertEqual(out["apps"][0]["attention"], [])
        self.assertEqual(out["apps"][1]["attention"], ["rejected"])

    def test_deadlines_sorted_and_drops_amounts_and_evidence(self):
        out = server.deadlines()
        self.assertEqual([r["vendor"] for r in out["renewals"]], ["Domain", "Vercel"])
        self.assertEqual(out["paperwork"][0]["days_left"], 3)
        blob = json.dumps(out)
        for leaked in ("amount", "evidence", "SECRET", "history"):
            self.assertNotIn(leaked, blob)
        self.assertEqual(out["errors"][0]["source"], "paperwork")
        self.assertEqual(len(server.deadlines(limit=1)["renewals"]), 1)

    def test_network_puts_funnel_and_warnings_first_and_drops_traffic(self):
        out = server.network()
        self.assertEqual(out["counts"]["funnel_public"], 1)
        self.assertEqual(out["exposures"][0]["path"], "/gt")
        self.assertEqual(out["alerts"][0]["severity"], "warn")
        self.assertEqual(out["nodes"][0]["name"], "ascent")
        self.assertNotIn("rx_mib", json.dumps(out))

    def test_stalls_hides_healthy_rows_and_alert_settings(self):
        out = server.stalls()
        self.assertEqual([i["id"] for i in out["items"]], ["omp:1", "unit:3"])
        self.assertEqual(out["items_total"], 2)
        self.assertEqual(len(server.stalls(include_ok=True)["items"]), 3)
        self.assertNotIn("SECRET", json.dumps(out))

    def test_deck_needs_lists_needs_and_site_state(self):
        out = server.deck_needs()
        self.assertEqual(out["needs_total"], 2)
        self.assertEqual(out["needs"][0]["text"], "Attach build 72")
        self.assertEqual(out["sites"][0]["state"], "up")
        self.assertNotIn("monitor", out["sites"][0])
        self.assertEqual(len(server.deck_needs(limit=1)["needs"]), 1)

    def test_missing_feeds_report_an_error_not_zero(self):
        for name in self.NAMES:
            (ROOT / f"deck/{name}.json").unlink()
        for tool in (server.release_status, server.deadlines, server.network, server.stalls, server.deck_needs):
            self.assertFalse(tool()["ok"], tool.__name__)


class PhotoToolsTests(unittest.TestCase):
    def setUp(self):
        write("deck/onthisday.json", {
            "t": NOW - 300, "refresh": 86400, "src": ["photo catalog (read-only)"], "errors": [],
            "source": "Photo catalog, read-only", "month_day": "10-29", "today": "2026-10-29", "catalog_rows": 100,
            "total": 20, "years": [{"year": 2025, "count": 11}, {"year": 2024, "count": 9}],
            "items": [{"id": 21476, "year": 2025, "media": "image", "file": "/SECRET/IMG_1.jpg"}]})
        write("deck/photoyears.json", {
            "t": NOW - 300, "refresh": 86400, "src": ["photo catalog (read-only)"], "errors": [],
            "source": "Photo catalog, read-only", "dated_total": 30, "undated": 2, "other_media": 0,
            "years": [{"year": 2024, "image": 10, "video": 2}, {"year": 2025, "image": 15, "video": 3}]})

    def tearDown(self):
        (ROOT / "deck/onthisday.json").unlink(missing_ok=True)
        (ROOT / "deck/photoyears.json").unlink(missing_ok=True)

    def test_feeds_are_registered_read_only(self):
        self.assertIn("onthisday", feeds.ALLOWED_NAMES)
        self.assertIn("photoyears", feeds.ALLOWED_NAMES)
        names = {row["feed"] for row in feeds.freshness()["feeds"]}
        self.assertTrue({"onthisday", "photoyears"} <= names)

    def test_photos_on_this_day_is_counts_only(self):
        out = server.photos_on_this_day()
        self.assertTrue(out["ok"])
        self.assertEqual((out["month_day"], out["total"]), ("10-29", 20))
        self.assertEqual(out["years"], [{"year": 2025, "count": 11}, {"year": 2024, "count": 9}])
        self.assertIsInstance(out["source"]["age_s"], int)
        self.assertNotIn("SECRET", json.dumps(out))
        self.assertNotIn("items", out)

    def test_photo_years_counts_and_undated(self):
        out = server.photo_years()
        self.assertTrue(out["ok"])
        self.assertEqual((out["dated_total"], out["undated"]), (30, 2))
        self.assertEqual(out["years"][1], {"year": 2025, "image": 15, "video": 3})
        self.assertIsInstance(out["source"]["age_s"], int)

    def test_missing_feeds_report_an_error_not_zero(self):
        (ROOT / "deck/onthisday.json").unlink()
        (ROOT / "deck/photoyears.json").unlink()
        self.assertFalse(server.photos_on_this_day()["ok"])
        self.assertFalse(server.photo_years()["ok"])


class GigsToolTests(unittest.TestCase):
    def setUp(self):
        write("deck/gigs.json", {
            "t": NOW - 300, "refresh": 7200, "src": ["hn-algolia", "remoteok"],
            "errors": [{"source": "upwork", "reason": "HTTP 403 from www.upwork.com"}],
            "sites_registry": 210, "sites_checked": 40, "by_site": {"hn-algolia": 2, "sam.gov": 1},
            "math": {"engine": "wolfram"}, "rotation": {"slice": 2, "of": 5},
            "sites_attempted": 50, "sites_returned": 31, "coverage": {"attempted_24h": 150, "of": 282},
            "fx": {"source": "ecb", "date": "2026-11-03"},
            "gigs": [
                {"id": "a", "title": "Contract iOS Swift engineer", "site": "hn-algolia", "url": "https://x/a",
                 "kind": "contract", "category": "ios", "pay": "$150/hr", "pay_min": 150, "pay_max": 150,
                 "pay_unit": "hour", "est_hourly": 150, "floor_ok": True, "fit": 70, "posted_at": NOW - 900,
                 "summary": "SwiftUI app", "why": ["swift", "ios"], "pitch": "Draft pitch A", "t": NOW - 300,
                 "skills": ["ios_swift"], "carried": True},
                {"id": "b", "title": "CAD dispatch software RFP", "site": "sam.gov", "url": "https://x/b",
                 "kind": "rfp", "category": "fire_ems", "pay": None, "pay_min": None, "pay_max": None,
                 "pay_unit": None, "est_hourly": None, "floor_ok": None, "fit": 88, "posted_at": None,
                 "summary": "Fire department CAD", "why": ["fire/EMS"], "pitch": "Draft pitch B", "t": NOW - 300},
                {"id": "c", "title": "Logo design", "site": "hn-algolia", "url": "https://x/c", "kind": "gig",
                 "category": "other", "pay": "$40/hr", "pay_unit": "hour", "est_hourly": 40, "floor_ok": False,
                 "fit": 5, "summary": "", "why": [], "pitch": "Draft pitch C", "t": NOW - 300},
            ],
        })

    def tearDown(self):
        (ROOT / "deck/gigs.json").unlink(missing_ok=True)

    def test_registered_read_only(self):
        self.assertIn("gigs", feeds.ALLOWED_NAMES)
        self.assertIn("gigs", server.deck_feeds_status()["feeds"])

    def test_sorted_by_fit_with_counts_and_errors(self):
        out = server.gigs()
        self.assertTrue(out["ok"])
        self.assertEqual([g["id"] for g in out["gigs"]], ["b", "a", "c"])
        self.assertEqual((out["gigs_total"], out["matched"], out["sites_registry"], out["sites_checked"]), (3, 3, 210, 40))
        self.assertEqual(out["errors"][0]["source"], "upwork")
        self.assertEqual(out["gigs"][0]["pitch"], "Draft pitch B")
        self.assertFalse(out["source"]["stale"])
        self.assertEqual((out["math"], out["rotation"]), ({"engine": "wolfram"}, {"slice": 2, "of": 5}))
        self.assertEqual((out["sites_attempted"], out["sites_returned"], out["coverage"]["of"], out["fx"]["source"]),
                         (50, 31, 282, "ecb"))
        self.assertEqual((out["gigs"][1]["skills"], out["gigs"][1]["carried"]), (["ios_swift"], True))
        self.assertEqual([g["id"] for g in server.gigs(query="ios_swift")["gigs"]], ["a"])

    def test_filters(self):
        self.assertEqual([g["id"] for g in server.gigs(kind="rfp")["gigs"]], ["b"])
        self.assertEqual([g["id"] for g in server.gigs(floor_only=True)["gigs"]], ["a"])
        self.assertEqual([g["id"] for g in server.gigs(min_fit=50, pay_unit="hour")["gigs"]], ["a"])
        self.assertEqual([g["id"] for g in server.gigs(site="SAM.gov")["gigs"]], ["b"])
        self.assertEqual([g["id"] for g in server.gigs(query="swift ios")["gigs"]], ["a"])
        self.assertEqual(server.gigs(limit=1)["matched"], 3)
        self.assertEqual(len(server.gigs(limit=1)["gigs"]), 1)

    def test_bad_arguments_refused(self):
        self.assertFalse(server.gigs(kind="job")["ok"])
        self.assertFalse(server.gigs(pay_unit="week")["ok"])

    def test_missing_feed_reports_an_error_not_zero(self):
        (ROOT / "deck/gigs.json").unlink()
        out = server.gigs()
        self.assertFalse(out["ok"])
        self.assertNotIn("gigs_total", out)



class ContractGeneratorTests(unittest.TestCase):
    def test_contract_matches_the_collector_when_it_is_present(self):
        collector = Path.home() / "ops/bin/deck_jobs_taxonomy.py"
        if not collector.is_file():
            self.skipTest("no collector on this host")
        script = Path(__file__).resolve().parent.parent / "scripts" / "gen_taxonomy_contract.py"
        import subprocess
        import sys
        done = subprocess.run(
            [sys.executable, str(script), "--check"], capture_output=True, text=True, timeout=30, check=False
        )
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)


class DeckSectionToolsTests(unittest.TestCase):
    """shop_deals, travel_deals, outdoors, life, history_goodnews over the shared feed contract (2026-10-30)."""

    GEN = datetime.fromtimestamp(NOW - 600, tz=UTC).isoformat(timespec="seconds").replace("+00:00", "Z")

    def contract(self, feed: str, items: list[dict], **top) -> dict:
        return {"feed": feed, "generated_at": self.GEN,
                "sources": [{"name": "Example source", "url": "https://example.test/", "fetched_at": self.GEN}],
                "items": items, "errors": [{"source": "blocked.example", "error": "bot wall, not bypassed"}], **top}

    def setUp(self):
        write("travel-deals.json", self.contract("travel-deals", [
            {"id": "f-1", "rank": 1, "kind": "flight", "title": "LAX to ATH", "price": 627, "currency": "USD",
             "savings_pct": None, "protected": False, "risk": "Separate tickets", "legs": [{"from": "LAX"}],
             "source_url": "https://example.test/f-1", "as_of": self.GEN},
            {"id": "h-1", "rank": 2, "kind": "hotel", "title": "Lisbon 4-star", "price": None, "currency": "USD",
             "source_url": "https://example.test/h-1", "as_of": self.GEN}], summary={"LAX-ATH": {"best": 627}}))
        write("outdoors.json", self.contract("outdoors", [
            {"kind": "surf", "title": "Doheny 2.5 ft", "summary": "FAIR", "location": "Dana Point, CA", "price": None,
             "currency": None, "source_url": "https://example.test/s", "as_of": self.GEN}], sections={"surf": {}}))
        write("life.json", self.contract("life", [
            {"kind": "gas", "title": "California regular", "price": 4.91, "currency": "USD", "place": "California",
             "source_url": "https://example.test/g", "as_of": "2026-10-26"}]))
        write("history-goodnews.json", self.contract("history-goodnews", [
            {"section": "good_news", "title": "Reef recovers", "summary": "Coral cover up", "source": "Positive News",
             "source_url": "https://example.test/n", "as_of": self.GEN}]))
        write("house-feeds/ecom.json", {"t": NOW - 60, "refresh": 3600, "src": ["shoptrends"], "errors": [],
                                        "as_of": NOW - 60,
                                        "deals": [{"slug": "x", "title": "Headphones", "site": "amazon", "price": 198.0,
                                                   "median": 248.0, "vs_median": -0.2, "url": "https://example.test/d"}],
                                        "movers": [{"slug": "x", "median": 262.0, "chg7": -0.06}]})

    def tearDown(self):
        for rel in ("travel-deals.json", "outdoors.json", "life.json", "history-goodnews.json", "house-feeds/ecom.json"):
            (ROOT / rel).unlink(missing_ok=True)

    def test_contract_feeds_are_registered_with_age_from_generated_at(self):
        for name in ("travel-deals", "outdoors", "life", "history-goodnews", "ecom"):
            self.assertIn(name, feeds.ALLOWED_NAMES)
        source = feeds.load("travel-deals")["source"]
        self.assertTrue(source["file"].endswith("/travel-deals.json"))
        self.assertTrue(600 <= source["age_s"] < 700, source["age_s"])
        self.assertEqual(source["refresh_s"], 21600)
        self.assertFalse(source["stale"])
        self.assertEqual(source["feed_src"][0]["name"], "Example source")

    def test_travel_deals_filters_by_kind_and_keeps_null_prices(self):
        out = server.travel_deals()
        self.assertTrue(out["ok"] and out["collected"])
        self.assertEqual(out["items_total"], 2)
        self.assertEqual(out["kind_values"], ["flight", "hotel"])
        self.assertIsNone(out["items"][1]["price"])
        self.assertNotIn("legs", out["items"][0])
        self.assertEqual(out["items"][0]["source_url"], "https://example.test/f-1")
        self.assertEqual(out["summary"], {"LAX-ATH": {"best": 627}})
        hotels = server.travel_deals(kind="hotel")
        self.assertEqual([i["id"] for i in hotels["items"]], ["h-1"])

    def test_outdoors_life_history_and_deals(self):
        self.assertEqual(server.outdoors(kind="surf")["items"][0]["location"], "Dana Point, CA")
        self.assertNotIn("sections", server.outdoors())
        self.assertEqual(server.life()["items"][0]["price"], 4.91)
        news = server.history_goodnews(section="good_news")
        self.assertEqual(news["items"][0]["source"], "Positive News")
        deals = server.shop_deals()
        self.assertEqual(deals["deals"][0]["site"], "amazon")
        self.assertEqual(deals["movers"][0]["chg7"], -0.06)

    def test_missing_feed_says_not_collected(self):
        (ROOT / "outdoors.json").unlink()
        out = server.outdoors()
        self.assertFalse(out["ok"])
        self.assertFalse(out["collected"])
        self.assertEqual(out["error"], "feed file not found")


if __name__ == "__main__":
    unittest.main()
