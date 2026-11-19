"""Behavioral tests for shared CES and building-permits file parsers."""
import csv
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import _bls_ces  # noqa: E402
import _bps  # noqa: E402


class BlsCesParserTests(unittest.TestCase):
    def test_cbsa_parse_uses_seasonally_adjusted_values_for_latest_and_yoy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = {name: root / name for name in ("sm.area", "sm.series", "data")}
            with paths["sm.area"].open("w", newline="") as fh:
                writer = csv.writer(fh, delimiter="\t")
                writer.writerow(("area_code", "area_name"))
                writer.writerow(("31080", "Los Angeles-Long Beach-Anaheim, CA"))
                writer.writerow(("31081", "Los Angeles Metropolitan Division"))
            with paths["sm.series"].open("w", newline="") as fh:
                writer = csv.writer(fh, delimiter="\t")
                writer.writerow(("series_id", "state_code", "area_code", "industry_code", "data_type_code",
                                 "seasonal", "end_year", "end_period"))
                writer.writerow(("sa", "06", "31080", _bls_ces.NONFARM, "01", "S", "2025", "M01"))
                writer.writerow(("nsa", "06", "31080", _bls_ces.NONFARM, "01", "U", "2025", "M01"))
            with paths["data"].open("w", newline="") as fh:
                writer = csv.writer(fh, delimiter="\t")
                writer.writerow(("series_id", "year", "period", "value"))
                writer.writerows((("sa", "2024", "M01", "100.0"), ("sa", "2025", "M01", "110.0"),
                                  ("nsa", "2024", "M01", "900.0"), ("nsa", "2025", "M01", "990.0")))

            data, rows, as_of, history, _ = _bls_ces.parse(paths, "cbsa", "cesm_", 1)

        self.assertEqual(as_of, "2025-01")
        self.assertEqual(rows, 4)
        self.assertEqual(set(data), {"31080"})
        self.assertEqual(data["31080"]["cesm_nonfarm"], 110000)
        self.assertEqual(data["31080"]["cesm_nonfarm_yoy"], 10.0)
        self.assertEqual(history["31080"]["cesm_nonfarm"], [["2024-01", 100000], ["2025-01", 110000]])


class BuildingPermitsParserTests(unittest.TestCase):
    def test_cbsa_parse_filters_micropolitan_rows_and_reads_trailing_counts(self):
        values = ["0", "10", "0", "0", "20", "0", "0", "30", "0", "40", "50", "60"] + ["0"] * 12
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "cbsa2611c.txt"
            path.write_text(
                "202611,06,31080,2,Metro, With a comma," + ",".join(values) + "\n"
                + "202611,06,12345,5,Micropolitan," + ",".join(values) + "\n",
                encoding="latin-1",
            )

            data, label = _bps.parse(path, "cbsa")

        self.assertEqual(label, "2026-11")
        self.assertEqual(data, {"31080": {"u1": 10, "u24": 50, "u5": 50, "b5": 40, "v5": 60000}})


if __name__ == "__main__":
    unittest.main()
