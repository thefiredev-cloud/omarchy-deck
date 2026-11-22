"""Behavioral tests for ACS 5-year housing and people records."""
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import acs5_housing_people as acs5  # noqa: E402
from ctx import SourceUnavailable  # noqa: E402


class Acs5TableTests(unittest.TestCase):
    def test_table_parser_pads_zcta_and_treats_suppressed_estimates_as_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "acs.dat"
            path.write_text(
                "GEO_ID|NAME|B25077_E001\n"
                "0400000US06|California|100\n"
                "860Z200US926|ZIP Code Tabulation Area 926|450000\n"
                "860Z200US927|ZIP Code Tabulation Area 927|-333333333\n",
                encoding="utf-8",
            )
            records = {}

            rows = acs5.parse_table(path, "b25077", records)

        self.assertEqual(rows, 2)
        self.assertEqual(records, {"00926": {"value": 450000}, "00927": {"value": None}})

    def test_table_parser_rejects_missing_estimate_columns(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "acs.dat"
            path.write_text("GEO_ID|NAME\n", encoding="utf-8")

            with self.assertRaisesRegex(SourceUnavailable, "missing columns value"):
                acs5.parse_table(path, "b25077", {})


class Acs5DeriveTests(unittest.TestCase):
    def test_derived_rates_exclude_seasonal_vacancies_and_include_rent_burden_groups(self):
        result = acs5.derive({
            "tax": 2500,
            "value": 500000,
            "u_all": 100,
            "v_all": 20,
            "v_season": 5,
            "rb_all": 80,
            "rb_nc": 10,
            "rb_30": 20,
            "rb_35": 15,
            "rb_40": 10,
            "rb_50": 5,
        })

        self.assertEqual(result["acs_tax_rate_eff"], 0.5)
        self.assertEqual(result["acs_vacancy_ex_seasonal"], 15.0)
        self.assertEqual(result["acs_rent_burden_30_share"], 71.43)
        self.assertEqual(result["acs_rent_burden_50_share"], 7.14)
        self.assertIsNone(result["acs_broadband_share"])


if __name__ == "__main__":
    unittest.main()
