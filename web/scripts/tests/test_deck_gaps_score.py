"""Gap scoring for deck-feed-gaps: python3 -m unittest discover -s scripts/tests"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import deck_gaps_score as G  # noqa: E402


class GapScore(unittest.TestCase):
    def test_extremes_and_bounds(self):
        self.assertEqual(G.gap_score(1.0, 0.0, 3), 100)  # all demand, no supply
        self.assertEqual(G.gap_score(0.0, 1.0, 3), 0)  # no demand, all supply
        self.assertEqual(G.gap_score(0.5, 0.5, 3), 50)
        self.assertEqual(G.gap_score(5.0, -3.0, 9, fit=4), 100)  # out-of-range inputs are clamped

    def test_formula(self):
        # 100 * (0.55 * 0.8 + 0.45 * (1 - 0.3)) = 75.5; two evidence rows -> confidence 0.9 -> 67.95; fit 0.5 -> +4
        self.assertEqual(G.gap_score(0.8, 0.3, 2), 68)
        self.assertEqual(G.gap_score(0.8, 0.3, 2, fit=0.5), 72)
        self.assertEqual(G.gap_score(0.8, 0.3, 3), 76)  # three or more rows: full confidence
        self.assertEqual(G.gap_score(0.8, 0.3, 7), 76)

    def test_monotonic(self):
        self.assertGreater(G.gap_score(0.9, 0.4, 3), G.gap_score(0.6, 0.4, 3))
        self.assertGreater(G.gap_score(0.6, 0.2, 3), G.gap_score(0.6, 0.7, 3))

    def test_unpublishable(self):
        self.assertIsNone(G.gap_score(0.9, 0.1, 1))  # under 2 evidence rows
        self.assertIsNone(G.gap_score(None, 0.1, 3))
        self.assertIsNone(G.gap_score(0.9, float("nan"), 3))
        self.assertIsNone(G.gap_score(0.9, 0.1, "3"))

    def test_deterministic(self):
        self.assertEqual({G.gap_score(0.37, 0.61, 4, 0.2) for _ in range(50)}, {G.gap_score(0.37, 0.61, 4, 0.2)})


class Helpers(unittest.TestCase):
    def test_pct_rank(self):
        u = [1, 2, 3, 4]
        self.assertEqual(G.pct_rank(u, 4), 0.875)
        self.assertEqual(G.pct_rank(u, 1), 0.125)
        self.assertEqual(G.pct_rank(u, 10), 1.0)
        self.assertIsNone(G.pct_rank(u, None))
        self.assertIsNone(G.pct_rank([None, "x"], 3))

    def test_scale_and_mean(self):
        self.assertEqual(G.scale(5, 0, 10), 0.5)
        self.assertEqual(G.scale(-5, 0, 10), 0.0)
        self.assertIsNone(G.scale(None, 0, 10))
        self.assertEqual(G.mean([0.2, None, 0.4]), 0.30000000000000004)
        self.assertIsNone(G.mean([None]))

    def test_iso_as_of(self):
        self.assertEqual(G.iso_as_of("2026-10"), "2026-10-01")
        self.assertEqual(G.iso_as_of("2026-Q1"), "2026-01-01")
        self.assertEqual(G.iso_as_of("2025"), "2025-01-01")
        self.assertEqual(G.iso_as_of("2025-10 to 2026-09"), "2026-09-01")
        self.assertEqual(G.iso_as_of("2020-2024"), "2024-01-01")
        self.assertEqual(G.iso_as_of("2026-11-13"), "2026-11-13")
        self.assertEqual(G.iso_as_of("2026-11-17T06:22:38-08:00"), "2026-11-17T06:22:38-08:00")
        self.assertEqual(G.iso_as_of(0), None)
        self.assertEqual(G.iso_as_of(1794924783), "2026-11-17T14:13:03+00:00")
        self.assertIsNone(G.iso_as_of("fall 2023"))
        self.assertIsNone(G.iso_as_of(None))


class NextStepRule(unittest.TestCase):
    """Cluster next steps are written from the owner's position; one that assumes he owns the asset is dropped."""

    @classmethod
    def setUpClass(cls):
        import importlib.machinery
        import importlib.util
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "deck-feed-gaps")
        loader = importlib.machinery.SourceFileLoader("deck_feed_gaps", path)
        spec = importlib.util.spec_from_loader(loader.name, loader)
        cls.gaps = importlib.util.module_from_spec(spec)
        loader.exec_module(cls.gaps)

    def test_owner_position_steps_pass(self):
        for s in ("Pull five Rockford single-family comps and check rent-to-price",
                  "Shortlist Orange County AI employers for Kodros pilots",
                  "Call two Alameda multifamily listing brokers for rent rolls",
                  "Bid on the private-AI gigs with a fixed-price Kodros pilot"):
            self.assertTrue(self.gaps.step_ok(s), s)

    def test_ownership_and_restated_numbers_fail(self):
        for s in ("List a Rockford property for sale to capture the tight market demand",
                  "List a Dana Point property for sale to capitalize on rising home values",
                  "Raise rents on your Boise units before leases renew",
                  "Sell your San Jose building while caps are low",
                  "Review Santa Clara industrial caps of 3.44% against the spread",
                  "Buy under $1,600 and resell"):
            self.assertFalse(self.gaps.step_ok(s), s)


if __name__ == "__main__":
    unittest.main()
