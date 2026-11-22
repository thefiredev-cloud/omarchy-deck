"""Behavioral tests for Zillow monthly listing metrics."""
import csv
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import zillow_listing_metrics_zip  # noqa: E402


class ZillowListingMetricsTests(unittest.TestCase):
    def test_parse_scales_price_share_filters_non_zip_rows_and_keeps_sparse_history(self):
        months = [
            "2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30",
            "2024-05-31", "2024-06-30", "2024-07-31", "2024-08-31",
            "2024-09-30", "2024-10-31", "2024-11-30", "2024-12-31",
        ]
        header = ["RegionName", "RegionType", *months]
        zip_values = ["0.1"] * 9 + ["0.1", "", "0.125"]
        metro_values = ["0.5"] * len(months)
        missing_latest = ["0.2"] * 11 + [""]

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "price_cut.csv"
            with path.open("w", newline="", encoding="utf8") as fh:
                writer = csv.writer(fh)
                writer.writerow(header)
                writer.writerows([
                    ["1001", "zip", *zip_values],
                    ["Los Angeles", "msa", *metro_values],
                    ["606", "zip", *missing_latest],
                ])

            with patch.object(zillow_listing_metrics_zip, "MIN_ZIPS", 1):
                values, history, rows, newest = zillow_listing_metrics_zip.parse(
                    path, "price_cut", keep_hist=True, hist_months=3
                )

        self.assertEqual(values, {"01001": 12.5})
        self.assertEqual(history, {"01001": [["2024-10", 10.0], ["2024-12", 12.5]]})
        self.assertEqual((rows, newest), (3, "2024-12"))


if __name__ == "__main__":
    unittest.main()
