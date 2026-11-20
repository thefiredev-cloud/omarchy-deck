"""Behavioral coverage for LIHTC expiration and county building aggregation."""
import datetime
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import lihtc_expiring  # noqa: E402
import usa_structures_county  # noqa: E402
from ctx import SourceUnavailable  # noqa: E402


class LihtcExpirationTests(unittest.TestCase):
    def test_aggregate_counts_expiration_windows_and_skips_unmonitored_projects(self):
        today = datetime.date(2025, 6, 15)
        rows = [
            {"proj_zip": "92629", "yr_pis": "2011", "yr_alloc": "1990", "li_units": "12"},
            {"proj_zip": "92629", "yr_pis": "1991", "yr_alloc": "1991", "li_unitr": "8",
             "aff_period": "1", "aff_yrs": "35"},
            {"proj_zip": "92629", "yr_pis": "2011", "yr_alloc": "1990", "li_units": "50", "nonprog": "1"},
            {"proj_zip": "92630", "yr_pis": "2011", "yr_alloc": "1989", "li_units": "4"},
            {"proj_zip": "92630", "yr_pis": "2011", "yr_alloc": "1990", "li_units": "0"},
        ]

        data, used = lihtc_expiring.aggregate(rows, today=today)

        self.assertEqual(used, 4)
        self.assertEqual(data["92629"], {
            "lihx_units_expiring_5y": 12,
            "lihx_units_year30_5y": 8,
            "lihx_projects_expiring_5y": 1,
        })
        self.assertEqual(data["92630"]["lihx_units_expiring_5y"], 4)
        self.assertEqual(data["92630"]["lihx_units_year30_5y"], 0)


class UsaStructuresTests(unittest.TestCase):
    def test_aggregate_sums_use_groups_and_ignores_invalid_counties(self):
        answers = {
            "commercial": [
                {"FIPS": "06037", "PRIM_OCC": "Retail Trade", "n": 2, "sqft": 1200.5},
                {"FIPS": "06037", "PRIM_OCC": "Professional/Technical Services", "n": 1, "sqft": 800},
                {"FIPS": "06037", "PRIM_OCC": "Other", "n": 3, "sqft": None},
                {"FIPS": "637", "PRIM_OCC": "Retail Trade", "n": 99, "sqft": 900},
                {"FIPS": "06037", "PRIM_OCC": "Retail Trade", "n": None, "sqft": 900},
            ],
            "industrial": [{"FIPS": "06037", "n": 4, "sqft": 1000.7}],
            "multifamily": [{"FIPS": "06037", "n": 5, "sqft": 2000}],
            "lodging": [{"FIPS": "06037", "n": 6, "sqft": 3000}],
        }

        data = usa_structures_county.aggregate(answers)

        self.assertEqual(data["06037"], {
            "bldg_commercial_sqft": 2000,
            "bldg_industrial_sqft": 1001,
            "bldg_commercial_count": 6,
            "bldg_industrial_count": 4,
            "bldg_retail_sqft": 1200,
            "bldg_retail_count": 2,
            "bldg_office_sqft": 800,
            "bldg_office_count": 1,
            "bldg_warehouse_sqft": 0,
            "bldg_warehouse_count": 0,
            "bldg_multifamily_sqft": 2000,
            "bldg_multifamily_count": 5,
            "bldg_hotel_sqft": 3000,
            "bldg_hotel_count": 6,
        })

    def test_parse_rejects_arcgis_errors_in_saved_response(self):
        with self.assertRaisesRegex(SourceUnavailable, "ArcGIS error"):
            usa_structures_county._rows({"error": {"message": "service unavailable"}}, "commercial")


if __name__ == "__main__":
    unittest.main()
