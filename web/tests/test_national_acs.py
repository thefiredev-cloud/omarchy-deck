"""Behavioral tests for shared ACS table parsing and derived fields."""
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import _acs  # noqa: E402
from ctx import SourceUnavailable  # noqa: E402


class AcsTableTests(unittest.TestCase):
    def test_parse_tables_pads_zip_and_annual_row_preserves_missing_estimates(self):
        with tempfile.TemporaryDirectory() as tmp:
            rent = Path(tmp) / "b25064.dat"
            occupied = Path(tmp) / "b25003.dat"
            rent.write_text(
                "GEO_ID|B25064_E001\n"
                "860Z200US06001|1250\n",
                encoding="utf-8",
            )
            occupied.write_text(
                "GEO_ID|B25003_E001|B25003_E003\n"
                "860Z200US06001|200|-666666666\n",
                encoding="utf-8",
            )

            records, count = _acs.parse_tables(
                {"b25064": rent, "b25003": occupied},
                {"b25064": {"E001": "rent"}, "b25003": {"E001": "occupied", "E003": "renters"}},
                "zip",
                minimum=1,
            )

        self.assertEqual(count, 1)
        self.assertEqual(records["06001"], {"rent": 1250, "occupied": 200, "renters": None})
        self.assertEqual(
            _acs.annual_row(records["06001"], "acs_")["acs_median_gross_rent"],
            1250,
        )
        self.assertIsNone(_acs.annual_row(records["06001"], "acs_")["acs_renter_share"])

    def test_parse_tables_rejects_duplicate_geographies(self):
        with tempfile.TemporaryDirectory() as tmp:
            table = Path(tmp) / "b25064.dat"
            table.write_text(
                "GEO_ID|B25064_E001\n"
                "860Z200US06001|1250\n"
                "860Z200US06001|1300\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(SourceUnavailable, "repeats geography 06001"):
                _acs.parse_tables({"b25064": table}, {"b25064": {"E001": "rent"}}, "zip", minimum=1)


if __name__ == "__main__":
    unittest.main()
