"""Behavioral coverage for ZIP Redfin history and Realtor metro supplements."""
import csv
import gzip
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import redfin_zip_market  # noqa: E402
import realtor_metro  # noqa: E402


class RedfinZipMarketTests(unittest.TestCase):
    def test_parse_keeps_latest_unadjusted_zip_rows_and_oldest_first_history(self):
        columns = [
            "PERIOD END", "REGION TYPE", "REGION NAME", "IS SEASONALLY ADJUSTED",
            "MEDIAN SALE PRICE NSA ($)", "INVENTORY",
        ]
        rows = [
            ["2024-02-29", "Zip", "926", "false", "510000", "21"],
            ["2024-03-31", "Zip", "926", "true", "999999", "99"],
            ["2024-03-31", "Zip", "926", "false", "520000", "22"],
            ["2024-01-31", "Zip", "1234", "false", "400000", "10"],
            ["2024-03-31", "Zip", "1234", "false", "410000", "11"],
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "redfin.csv.gz"
            with gzip.open(path, "wt", newline="", encoding="utf8") as fh:
                writer = csv.writer(fh)
                writer.writerow(columns)
                writer.writerows(rows)
            with patch.object(redfin_zip_market, "MIN_ZIPS", 2):
                data, hist, count, as_of = redfin_zip_market.parse(path, hist_months=2)

        self.assertEqual((count, as_of), (5, "2024-03"))
        self.assertEqual(data, {
            "00926": {"redfin_median_sale": 520000, "redfin_inventory": 22},
            "01234": {"redfin_median_sale": 410000, "redfin_inventory": 11},
        })
        self.assertEqual(hist["00926"], {
            "redfin_median_sale": [["2024-02", 510000], ["2024-03", 520000]],
            "redfin_inventory": [["2024-02", 21], ["2024-03", 22]],
        })


class RealtorMetroSupplementTests(unittest.TestCase):
    def test_parse_hotness_uses_only_the_newest_month_and_requires_core_month_match(self):
        columns = [
            "month_date_yyyymm", "cbsa_code", "quality_flag", "hotness_score", "supply_score", "demand_score",
        ]
        rows = [
            ["202609", "31080", "0", "72.25", "60", "80"],
            ["202610", "31080", "1", "75.34", "61.2", "82.7"],
            ["202610", "not-a-cbsa", "0", "99", "99", "99"],
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "hotness.csv"
            with path.open("w", newline="", encoding="utf8") as fh:
                writer = csv.writer(fh)
                writer.writerow(columns)
                writer.writerows(rows)

            current, month = realtor_metro.parse_hotness(path, "2026-10")
            stale, stale_month = realtor_metro.parse_hotness(path, "2026-09")

        self.assertEqual((month, current), (
            "2026-10", {"31080": {
                "rdm_hotness": 75.3, "rdm_supply_score": 61.2, "rdm_demand_score": 82.7, "flag": 1,
            }},
        ))
        self.assertEqual((stale_month, stale), ("2026-10", {}))

    def test_parse_history_skips_flagged_rows_and_unrequested_metros(self):
        columns = [
            "month_date_yyyymm", "cbsa_code", "quality_flag", "active_listing_count",
            "median_days_on_market", "price_reduced_share",
        ]
        rows = [
            ["202608", "31080", "0", "100", "30", "0.125"],
            ["202609", "31080", "1", "110", "31", "0.2"],
            ["202610", "31080", "0", "120", "32", "0.25"],
            ["202608", "16980", "0", "999", "99", "0.9"],
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "history.csv"
            with path.open("w", newline="", encoding="utf8") as fh:
                writer = csv.writer(fh)
                writer.writerow(columns)
                writer.writerows(rows)
            history, flagged = realtor_metro.parse_history(path, {"31080"}, months=3)

        self.assertEqual(flagged, 1)
        self.assertEqual(history, {"31080": {
            "rdm_active": [["2026-08", 100], ["2026-10", 120]],
            "rdm_dom": [["2026-08", 30], ["2026-10", 32]],
            "rdm_price_reduced_share": [["2026-08", 12.5], ["2026-10", 25.0]],
        }})


if __name__ == "__main__":
    unittest.main()
