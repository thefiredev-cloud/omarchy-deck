"""Behavioral tests for the jobs classifier, metro/mode/pay parsing, feed block validation,
the taxonomy contract loader and the job_market / job_taxonomy tools."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from typing import ClassVar
from unittest.mock import patch

from deck_feeds_mcp import jobs, server, taxonomy


class ClassifyTests(unittest.TestCase):
    def test_title_hit_outweighs_body_hit(self):
        listing = {"title": "Paramedic", "summary": "works beside a firefighter crew"}

        self.assertEqual(jobs.classify(listing), ("fire_ems", "ems_clinical"))

    def test_body_hit_alone_claims_a_category(self):
        listing = {"title": "Operations Associate", "summary": "ambulance dispatch support"}

        self.assertEqual(jobs.classify(listing), ("fire_ems", "ems_clinical"))

    def test_context_word_alone_is_below_the_claim_floor(self):
        listing = {"title": "Associate", "company": "Costa Mesa Fire Department"}

        self.assertEqual(jobs.classify(listing), (None, None))

    def test_dropped_title_wins_over_a_keyword_match(self):
        self.assertEqual(jobs.classify({"title": "Firefighter Paramedic Recruiter"}), (None, None))

    def test_missing_title_classifies_nothing(self):
        self.assertEqual(jobs.classify({"summary": "firefighter paramedic"}), (None, None))


class MetroAndModeTests(unittest.TestCase):
    def test_remote_role_restricted_to_a_foreign_country_is_out_of_area(self):
        self.assertEqual(jobs.metro_of({"location": "Canada (Remote)"}), "unknown")
        self.assertEqual(jobs.metro_of({"location": "Remote - London"}), "unknown")

    def test_remote_role_naming_the_us_stays_remote(self):
        self.assertEqual(jobs.metro_of({"location": "Remote - US or Canada"}), "remote")

    def test_plain_remote_names_no_country_and_stays_remote(self):
        self.assertEqual(jobs.metro_of({"location": "Remote"}), "remote")

    def test_new_mexico_is_not_mexico(self):
        self.assertEqual(jobs.metro_of({"location": "Remote - New Mexico"}), "remote")

    def test_body_remote_only_counts_when_no_city_is_named(self):
        self.assertEqual(jobs.metro_of({"location": "Irvine, CA", "summary": "fully remote team"}), "south_oc")
        self.assertEqual(jobs.metro_of({"location": "Denver, CO", "summary": "fully remote team"}), "remote")

    def test_south_oc_city_wins_over_oc_city_in_the_same_location(self):
        self.assertEqual(jobs.metro_of({"location": "Costa Mesa or Dana Point, CA"}), "south_oc")

    def test_valid_feed_mode_wins_case_insensitively(self):
        self.assertEqual(jobs.mode_of({"mode": " Hybrid ", "remote": True}), "hybrid")

    def test_invalid_feed_mode_falls_back_to_derivation(self):
        self.assertEqual(jobs.mode_of({"mode": "onsite", "location": "Remote"}), "remote")
        self.assertEqual(jobs.mode_of({"mode": "onsite", "summary": "Hybrid, two days in office"}), "hybrid")
        self.assertEqual(jobs.mode_of({"mode": "onsite", "location": "Irvine, CA"}), "in_person")


class PayRangeTests(unittest.TestCase):
    def test_single_hourly_rate_becomes_an_annual_value(self):
        self.assertEqual(jobs.pay_range({"pay_text": "$45/hr"})[:2], (93_600, 93_600))

    def test_comma_amount_is_kept_and_bare_hundreds_are_read_as_thousands(self):
        self.assertEqual(jobs.pay_range({"salary": "$95,000 a year"})[:2], (95_000, 95_000))
        self.assertEqual(jobs.pay_range({"salary": "$185 - $220"})[:2], (185_000, 220_000))

    def test_amounts_under_the_annual_floor_are_ignored_but_text_is_kept(self):
        self.assertEqual(jobs.pay_range({"salary": "$15 bonus"}), (None, None, "$15 bonus"))
        self.assertEqual(jobs.pay_range({"salary": "Competitive"}), (None, None, "Competitive"))

    def test_pay_text_and_salary_are_read_together(self):
        low, high, text = jobs.pay_range({"pay_text": "$90K", "salary": "up to $140K"})

        self.assertEqual((low, high), (90_000, 140_000))
        self.assertEqual(text, "$90K up to $140K")


class SearchEdgeTests(unittest.TestCase):
    LISTINGS: ClassVar[list[dict[str, object]]] = [
        {"title": "Firefighter Paramedic", "company": "A", "metro": "oc", "score": 5},
        {"title": "Paramedic", "company": "B", "metro": "oc", "score": 4},
        {"title": "Line Cook", "company": "C", "metro": "oc", "score": 3},
    ]

    def test_subcategory_filter_keeps_only_that_subcategory(self):
        result = jobs.search(self.LISTINGS, subcategory="fire_paramedic", apply_rules=False)

        self.assertEqual([row["company"] for row in result["listings"]], ["A"])

    def test_unclassified_rows_are_counted_when_a_category_is_requested(self):
        result = jobs.search(self.LISTINGS, category="fire_ems", apply_rules=False)

        self.assertEqual(result["matched"], 2)
        self.assertEqual(result["excluded"]["category_unknown"], 1)

    def test_non_dict_rows_are_skipped(self):
        result = jobs.search(["junk", None, {"title": "Paramedic", "metro": "oc"}], apply_rules=False)

        self.assertEqual(result["matched"], 1)

    def test_limit_is_clamped_between_one_and_one_hundred(self):
        rows = [{"company": f"Co {n}", "metro": "oc"} for n in range(150)]

        self.assertEqual(len(jobs.search(rows, limit=1000, apply_rules=False)["listings"]), 100)
        self.assertEqual(len(jobs.search(rows, limit=-5, apply_rules=False)["listings"]), 1)

    def test_remote_pay_threshold_can_be_overridden(self):
        rows = [{"company": "R", "metro": "remote", "pay_max": 90_000}]

        self.assertEqual(jobs.search(rows)["matched"], 0)
        self.assertEqual(jobs.search(rows, remote_min_pay=80_000)["matched"], 1)

    def test_feed_null_pay_falls_back_to_parsed_pay_but_a_feed_value_wins(self):
        rows = [
            {"company": "Null", "metro": "oc", "salary": "$150K", "pay_max": None},
            {"company": "Set", "metro": "oc", "salary": "$150K", "pay_max": 90_000},
        ]

        result = jobs.search(rows, min_pay=100_000, apply_rules=False)

        self.assertEqual([row["company"] for row in result["listings"]], ["Null"])
        self.assertEqual(result["excluded"]["min_pay"], 1)

    def test_search_without_rules_reports_no_rules(self):
        self.assertIsNone(jobs.search([], apply_rules=False)["rules"])
        self.assertEqual(jobs.search([])["rules"], jobs.RULES)


class FeedBlockValidationTests(unittest.TestCase):
    def test_taxonomy_block_problems_name_the_defect(self):
        sub = {"slug": "s"}
        cases = {
            "taxonomy must be a non-empty list": [],
            "every category must be an object": ["x"],
            "every category needs a slug": [{"name": "N"}],
            "duplicate category slug a": [{"slug": "a", "name": "A", "subs": [sub]},
                                          {"slug": "a", "name": "A", "subs": [sub]}],
            "category a has no name": [{"slug": "a", "subs": [sub]}],
            "category a has no subcategories": [{"slug": "a", "name": "A", "subs": []}],
            "category a has a subcategory without a slug": [{"slug": "a", "name": "A", "subs": [{}]}],
            "category a repeats subcategory s": [{"slug": "a", "name": "A", "subs": [sub, sub]}],
        }
        for expected, block in cases.items():
            with self.subTest(expected):
                self.assertEqual(jobs.taxonomy_block_problem(block), expected)

    def test_well_formed_taxonomy_block_has_no_problem(self):
        self.assertIsNone(jobs.taxonomy_block_problem(taxonomy.taxonomy()))

    def test_rules_block_problems_name_the_defect(self):
        good_metros = ["south_oc", "oc"]
        cases = [
            ("rules must be an object", []),
            ("rules.in_person_metros must be a non-empty list", {"in_person_metros": [], "remote_min_pay": 1}),
            ("rules.in_person_metros must name in-person metros only",
             {"in_person_metros": ["remote"], "remote_min_pay": 1}),
            ("rules.in_person_metros must name in-person metros only",
             {"in_person_metros": ["mars"], "remote_min_pay": 1}),
            ("rules.remote_min_pay must be an integer", {"in_person_metros": good_metros, "remote_min_pay": True}),
            ("rules.remote_min_pay must be an integer", {"in_person_metros": good_metros, "remote_min_pay": "9"}),
        ]
        for expected, block in cases:
            with self.subTest(expected, block=block):
                self.assertEqual(jobs.rules_block_problem(block), expected)
        self.assertIsNone(jobs.rules_block_problem({"in_person_metros": good_metros, "remote_min_pay": 1}))

    def test_a_bad_feed_block_falls_back_independently_of_the_other(self):
        good_rules = {"in_person_metros": ["oc"], "remote_min_pay": 150_000}

        found = jobs.taxonomy({"taxonomy": [], "rules": good_rules})

        self.assertEqual((found["taxonomy_source"], found["rules_source"]), ("server-seed", "feed"))
        self.assertEqual(found["rules"], good_rules)
        self.assertNotIn("rules_problem", found)


class MarketOrDerivedTests(unittest.TestCase):
    def test_published_market_block_is_served_untouched(self):
        published = {"by_category": {"ai_software": {"total": 7}}, "listings_total": 7}

        rolled = jobs.market_or_derived({"market": published, "listings": [{"category": "fire_ems"}]})

        self.assertEqual(rolled, {"market_source": "feed", "market": published})

    def test_empty_published_block_is_derived_from_listings(self):
        rolled = jobs.market_or_derived({"market": {"by_category": {}}, "t": 99,
                                         "listings": [{"category": "fire_ems", "metro": "oc"}]})

        self.assertEqual(rolled["market_source"], "derived-from-listings")
        self.assertEqual(rolled["market"]["listings_total"], 1)
        self.assertEqual(rolled["market"]["generated_at"], 99)
        self.assertEqual(rolled["market"]["by_category"]["fire_ems"]["total"], 1)


class JobToolTests(unittest.TestCase):
    FEED: ClassVar[dict[str, object]] = {
        "data": {"listings": [{"category": "fire_ems", "company": "OCFA", "metro": "oc", "pay_max": 120_000}]},
        "source": {"file": "/feeds/jobs.json"},
    }

    def tool(self, fn, loaded, **kwargs):
        with patch.object(server.feeds, "load", return_value=loaded):
            return fn(**kwargs)

    def test_job_market_returns_one_category_or_lists_the_known_ones(self):
        known = self.tool(server.job_market, self.FEED, category=" fire_ems ")
        self.assertEqual(known["category"], "fire_ems")
        self.assertEqual(known["market"]["total"], 1)
        self.assertEqual(known["market"]["median_pay_max"], 120_000)

        unknown = self.tool(server.job_market, self.FEED, category="hockey_sports")
        self.assertEqual(unknown["market"]["known"], ["fire_ems"])
        self.assertIn("no category", unknown["market"]["error"])

    def test_job_market_without_a_category_returns_the_whole_rollup(self):
        out = self.tool(server.job_market, self.FEED)

        self.assertTrue(out["ok"])
        self.assertEqual(out["market_source"], "derived-from-listings")
        self.assertEqual(list(out["market"]["by_category"]), ["fire_ems"])

    def test_job_tools_pass_a_feed_error_through(self):
        failed = {"error": "feed file not found", "source": {"tried": []}}
        for fn in (server.job_market, server.job_taxonomy):
            with self.subTest(fn.__name__):
                out = self.tool(fn, failed)
                self.assertFalse(out["ok"])
                self.assertEqual(out["error"], "feed file not found")

    def test_job_taxonomy_serves_the_seed_when_the_feed_has_no_blocks(self):
        out = self.tool(server.job_taxonomy, self.FEED)

        self.assertTrue(out["ok"])
        self.assertEqual(out["taxonomy_source"], "server-seed")
        self.assertEqual(out["rules"], taxonomy.rules())


class ContractLoaderTests(unittest.TestCase):
    def load_with(self, mutate):
        document = json.loads(taxonomy.CONTRACT_PATH.read_text(encoding="utf-8"))
        mutate(document)
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "taxonomy.json"
            path.write_text(json.dumps(document), encoding="utf-8")
            return self.load_path(path)

    def load_path(self, path):
        with patch.object(taxonomy, "CONTRACT_PATH", path):
            taxonomy.load.cache_clear()
            try:
                return taxonomy.load()
            finally:
                taxonomy.load.cache_clear()

    def assertRejected(self, mutate, message):
        with self.assertRaisesRegex(taxonomy.ContractError, message):
            self.load_with(mutate)

    def test_missing_file_is_a_contract_error(self):
        with self.assertRaisesRegex(taxonomy.ContractError, "unreadable"):
            self.load_path(Path(tempfile.gettempdir()) / "no-such-taxonomy-contract.json")

    def test_bad_json_is_a_contract_error(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "taxonomy.json"
            path.write_text("{nope", encoding="utf-8")
            with self.assertRaisesRegex(taxonomy.ContractError, "bad JSON"):
                self.load_path(path)

    def test_default_sub_must_be_one_of_the_category_subcategories(self):
        def mutate(document):
            slug = document["taxonomy"][0]["slug"]
            document["default_sub"][slug] = "not_a_sub"

        self.assertRejected(mutate, "default_sub")

    def test_keyword_rule_must_point_at_a_known_subcategory(self):
        self.assertRejected(lambda d: d["keyword_rules"][0].update(subcategory="nope"),
                            "unknown subcategory")

    def test_keyword_rule_pattern_must_compile(self):
        self.assertRejected(lambda d: d["keyword_rules"][0].update(pattern="(unclosed"), "bad pattern")

    def test_every_metro_needs_a_city_list(self):
        self.assertRejected(lambda d: d["metros"].update(sd=[]), "metro sd")

    def test_remote_patterns_are_required(self):
        self.assertRejected(lambda d: d.pop("remote_foreign_pattern"), "remote_foreign_pattern is required")

    def test_context_rule_must_point_at_a_known_category(self):
        self.assertRejected(lambda d: d["context_rules"][0].update(category="nope"), "unknown category")

    def test_valid_contract_loads_with_compiled_patterns(self):
        loaded = self.load_with(lambda document: None)

        self.assertEqual(set(loaded["metros"]), set(taxonomy.METRO_KEYS))
        self.assertTrue(loaded["title_drop"].search("summer intern"))
        self.assertTrue(loaded["remote_foreign"].search("Canada"))


if __name__ == "__main__":
    unittest.main()
