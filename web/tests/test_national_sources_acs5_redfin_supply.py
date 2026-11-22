"""Behavioral tests for ACS housing and Redfin supply source parsing."""
import csv
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import acs5_housing_people  # noqa: E402
import redfin_zip_supply_signals  # noqa: E402
from ctx import SourceUnavailable  # noqa: E402


class AcsHousingPeopleTests(unittest.TestCase):
    def test_parse_table_pads_zip_skips_other_geographies_and_preserves_missing_values(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "b25077.dat"
            path.write_text(
                "GEO_ID|B25077_E001\n"
                "0400000US06|900000\n"
                "860Z200US926|425000\n"
                "860Z200US06002|-666666666\n",
                encoding="utf-8",
            )
            records = {}

            rows = acs5_housing_people.parse_table(path, "b25077", records)

        self.assertEqual(rows, 2)
        self.assertEqual(records, {"00926": {"value": 425000}, "06002": {"value": None}})

    def test_parse_table_rejects_missing_estimate_columns(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "b25077.dat"
            path.write_text("GEO_ID|B25077_E002\n", encoding="utf-8")

            with self.assertRaisesRegex(SourceUnavailable, "missing columns value"):
                acs5_housing_people.parse_table(path, "b25077", {})


class RedfinZipSupplyTests(unittest.TestCase):
    def test_parse_keeps_latest_period_and_orders_history_for_latest_zips(self):
        columns = [
            "PERIOD END",
            "IS SEASONALLY ADJUSTED",
            "REGION TYPE",
            "REGION NAME",
            "HOME PURCHASE CANCELLATIONS",
            "PERCENT OF PENDING SALES (%)",
        ]
        rows = [
            ["2024-01-31", "false", "Zip", "926", "4", "8.25"],
            ["2024-03-31", "false", "Zip", "926", "7", "10.75"],
            ["2024-02-29", "false", "Zip", "926", "5", "9.5"],
            ["2024-02-29", "false", "Zip", "100", "2", "4.0"],
            ["2024-03-31", "false", "Metro", "Los Angeles", "99", "99"],
            ["2024-03-31", "true", "Zip", "926", "8", "99"],
        ]

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "supply.csv"
            with path.open("w", newline="", encoding="utf-8") as stream:
                writer = csv.writer(stream)
                writer.writerow(columns)
                writer.writerows(rows)

            with patch.object(redfin_zip_supply_signals, "MIN_ZIPS", 1):
                data, history, row_count, latest = redfin_zip_supply_signals.parse(
                    path, "contract_cancellations", hist_months=2
                )

        self.assertEqual((row_count, latest), (6, "2024-03"))
        self.assertEqual(data, {"00926": {
            "redfin_cancellations": 7,
            "redfin_cancel_rate": 10.75,
        }})
        self.assertEqual(history, {"00926": {
            "redfin_cancel_rate": [["2024-02", 9.5], ["2024-03", 10.75]],
        }})


if __name__ == "__main__":
    unittest.main()
