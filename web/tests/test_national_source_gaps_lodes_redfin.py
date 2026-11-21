"""Behavioral coverage for LODES aggregation and Redfin period parsing."""
import csv
import gzip
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import _lodes  # noqa: E402
import _redfin_segments as redfin  # noqa: E402
from ctx import SourceUnavailable  # noqa: E402


class LodesAggregationTests(unittest.TestCase):
    def test_sum_by_zip_sums_known_blocks_and_reports_jobs_without_zcta(self):
        columns = ["w_geocode", *_lodes.COLUMNS]
        rows = [
            ["block-a", "10", "1", "2", "7", "3", "4", "3", *([1] * 20)],
            ["block-b", "5", "2", "1", "2", "1", "2", "2", *([2] * 20)],
            ["block-water", "9", "1", "1", "7", "3", "3", "3", *([1] * 20)],
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "wac.csv.gz"
            with gzip.open(path, "wt", newline="") as fh:
                writer = csv.writer(fh)
                writer.writerow(columns)
                writer.writerows(rows)
            into = {}

            read, lost = _lodes.sum_by_zip(path, "w_geocode", {"block-a": "00926", "block-b": "00926"}, into)

        expected = [15, 3, 3, 9, 4, 6, 5, *([3] * 20)]
        self.assertEqual((read, lost, into), (3, 9, {"00926": expected}))

    def test_block_zcta_ignores_blocks_without_a_zip(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "xwalk.csv.gz"
            with gzip.open(path, "wt", newline="") as fh:
                writer = csv.writer(fh)
                writer.writerow(["tabblk2020", "zcta"])
                writer.writerow(["block-a", "926"])
                writer.writerow(["block-water", ""])

            result = _lodes.block_zcta(path)

        self.assertEqual(result, {"block-a": "00926"})

class RedfinSegmentPeriodTests(unittest.TestCase):
    def test_zip_parser_keeps_latest_rolling_periods_and_zero_fills_zip(self):
        columns = ["PERIOD END", "REGION TYPE", "REGION NAME", "REGION ID", "FREQUENCY",
                   "IS SEASONALLY ADJUSTED", "MEDIAN SALE PRICE NSA ($)"]
        rows = [
            ["2024-01-31", "Zip", "926", "926", "Rolling 3 Months", "false", "500000"],
            ["2024-03-31", "Zip", "926", "926", "Rolling 3 Months", "false", "520000"],
            ["2024-02-29", "Zip", "926", "926", "Rolling 3 Months", "false", "510000"],
            ["2024-03-31", "Zip", "926", "926", "Rolling 3 Months", "true", "999999"],
            ["2024-03-31", "Zip", "926", "926", "Monthly", "false", "999999"],
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "redfin.csv"
            with path.open("w", newline="") as fh:
                writer = csv.writer(fh)
                writer.writerow(columns)
                writer.writerows(rows)

            periods, row_count, latest = redfin.parse_periods(
                path, "zip", "rf_", ("median_sale",), months=2
            )

        self.assertEqual((latest, row_count), ("2024-03", 5))
        self.assertEqual(periods, {
            "2024-02": {"00926": {"rf_median_sale": 510000}},
            "2024-03": {"00926": {"rf_median_sale": 520000}},
        })

    def test_metro_parser_requires_census_crosswalk(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "empty.csv"
            path.write_text("", encoding="utf-8")

            with self.assertRaisesRegex(SourceUnavailable, "requires the Census CBSA list"):
                redfin.parse_periods(path, "cbsa", "rf_", ("median_sale",))


if __name__ == "__main__":
    unittest.main()
