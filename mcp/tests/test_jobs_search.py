"""Behavioral tests for job filtering and search result ordering."""

from __future__ import annotations

import unittest

from deck_feeds_mcp import jobs


class JobSearchTests(unittest.TestCase):
    def test_min_pay_includes_boundary_and_counts_rejections(self):
        listings = [
            {"company": "Below floor", "metro": "south_oc", "pay_max": 79_999},
            {"company": "At floor", "metro": "south_oc", "pay_max": 80_000},
            {"company": "Unknown pay", "metro": "south_oc", "pay_max": None},
        ]

        result = jobs.search(listings, min_pay=80_000, apply_rules=False)

        self.assertEqual([row["company"] for row in result["listings"]], ["At floor"])
        self.assertEqual(result["excluded"]["min_pay"], 2)

    def test_results_sort_by_metro_score_then_pay_before_limiting(self):
        listings = [
            {"company": "Lower score", "metro": "south_oc", "score": 9, "pay_max": 150_000},
            {"company": "Higher pay", "metro": "south_oc", "score": 10, "pay_max": 90_000},
            {"company": "Higher score", "metro": "south_oc", "score": 10, "pay_max": 80_000},
        ]

        result = jobs.search(listings, limit=2, apply_rules=False)

        self.assertEqual(result["matched"], 3)
        self.assertEqual(
            [row["company"] for row in result["listings"]],
            ["Higher pay", "Higher score"],
        )

    def test_market_aggregates_even_median_and_top_employers(self):
        listings = [
            {"category": "ai_software", "company": "Zeta", "metro": "south_oc", "pay_max": 100_000},
            {"category": "ai_software", "company": "Beta", "metro": "remote", "pay_max": 120_000},
            {"category": "ai_software", "company": "Beta", "metro": "la", "pay_max": 140_000},
            {"category": "ai_software", "company": "Gamma", "metro": "unknown", "pay_max": 160_000},
            {"category": "ai_software", "company": "Alpha", "metro": "oc", "pay_max": 180_000},
            {"category": "ai_software", "company": "Delta", "metro": "sd", "pay_max": 200_000},
            {"category": "ai_software", "company": "Epsilon", "metro": "south_oc", "pay_max": 220_000},
            {"category": "ai_software", "company": "Eta", "metro": "la", "pay_max": 240_000},
        ]

        result = jobs.market(listings)["ai_software"]

        self.assertEqual(result["total"], 8)
        self.assertEqual(result["by_metro"], {
            "south_oc": 2, "oc": 1, "la": 2, "sd": 1, "remote": 1, "other": 1,
        })
        self.assertEqual(result["median_pay_max"], 170_000)
        self.assertEqual(result["top_employers"], [
            {"name": "Beta", "count": 2},
            {"name": "Alpha", "count": 1},
            {"name": "Delta", "count": 1},
            {"name": "Epsilon", "count": 1},
            {"name": "Eta", "count": 1},
        ])

    def test_market_counts_remote_rows_without_pay(self):
        result = jobs.market([
            {"category": "ai_software", "company": "Remote Co", "metro": "remote", "pay_max": None},
            {"category": None, "company": "", "metro": "unknown", "pay_max": None},
        ])

        self.assertEqual(result["ai_software"]["remote_unknown_pay"], 1)
        self.assertEqual(result["uncategorized"]["remote_unknown_pay"], 0)



if __name__ == "__main__":
    unittest.main()
