"""Behavioral coverage for shared Zillow and Redfin market parsers."""
import csv
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import _redfin_segments  # noqa: E402
import _zillow_market  # noqa: E402


class ZillowMarketParserTests(unittest.TestCase):
    def test_series_uses_latest_month_matching_geography_and_year_ago_column(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "series.csv"
            months = [f"{year}-{month:02d}-01" for year, month in
                      [(2024, month) for month in range(1, 13)] + [(2025, 1), (2025, 2)]]
            with path.open("w", newline="", encoding="utf8") as fh:
                writer = csv.writer(fh)
                writer.writerow(["RegionName", "RegionType", "StateName", *months])
                writer.writerow(["Example Metro", "msa", "CA", *(["100"] * 13 + ["125"])])
                writer.writerow(["United States", "country", "", *(["900"] * 14)])
                writer.writerow(["Other Metro", "state", "NV", *(["80"] * 14)])

            data, rows, as_of = _zillow_market.parse_series(
                path, "msa", "d", want_yoy=True, hist_months=2, min_regions=1)

        self.assertEqual(as_of, "2025-02")
        self.assertEqual(data, {
            ("Example Metro", "CA"): {
                "v": 125, "yoy": 25.0, "hist": [["2025-01", 100], ["2025-02", 125]]
            }
        })


class RedfinMarketParserTests(unittest.TestCase):
    def test_periods_keep_latest_window_and_resolve_only_exact_census_metros(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "market.csv"
            headers = [
                "PERIOD END", "REGION TYPE", "REGION NAME", "REGION ID", "FREQUENCY",
                "IS SEASONALLY ADJUSTED", "MEDIAN SALE PRICE NSA ($)",
            ]
            with path.open("w", newline="", encoding="utf8") as fh:
                writer = csv.writer(fh)
                writer.writerow(headers)
                writer.writerows([
                    ["2025-03-31", "Metro", "Example Metro Area", "99999", "Monthly", "false", "300000"],
                    ["2025-01-31", "Metro", "Example Metro Area", "12345", "Monthly", "false", "100000"],
                    ["2025-02-28", "Metro", "Example Metro Area", "12345", "Monthly", "false", "200000"],
                    ["2025-03-31", "Metro", "Example Metro Area", "12345", "Monthly", "true", "999999"],
                    ["2025-03-31", "Metro", "Example City", "99998", "Monthly", "false", "400000"],
                ])

            periods, rows, latest = _redfin_segments.parse_periods(
                path, "cbsa", "redfin_", ("median_sale",), cbsas={"12345": "Example Metro Area"}, months=2)

        self.assertEqual(latest, "2025-03")
        self.assertEqual(rows, 5)
        self.assertEqual(periods, {
            "2025-02": {"12345": {"redfin_median_sale": 200000}},
            "2025-03": {"12345": {"redfin_median_sale": 300000}},
        })


if __name__ == "__main__":
    unittest.main()
