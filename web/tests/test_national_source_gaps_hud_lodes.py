"""Behavioral coverage for HUD LIHTC and LEHD workplace source aggregation."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import hud_lihtc  # noqa: E402
import lehd_lodes_wac  # noqa: E402


class HudLihtcAggregationTests(unittest.TestCase):
    def test_aggregate_uses_low_income_units_and_counts_recent_projects(self):
        rows = [
            {"STD_ZIP5": "92629", "LI_UNITS": "12", "N_UNITS": "20", "YR_PIS": "2022"},
            {"PROJ_ZIP": "92629", "LI_UNITS": None, "N_UNITS": "8", "YR_PIS": "2019"},
            {"STD_ZIP5": "92629", "LI_UNITS": "5", "YR_PIS": "8888"},
            {"STD_ZIP5": "92630", "LI_UNITS": "0", "N_UNITS": "30", "YR_PIS": "2024"},
            {"STD_ZIP5": "00000", "LI_UNITS": "9", "YR_PIS": "2024"},
        ]

        data, used = hud_lihtc.aggregate(rows, year=2024)

        self.assertEqual(used, 3)
        self.assertEqual(data, {
            "92629": {"lihtc_units": 25, "lihtc_projects": 3, "lihtc_units_5y": 20}
        })


class LehdLodesWacTests(unittest.TestCase):
    def test_derive_builds_sector_and_wage_shares_and_omits_empty_zip(self):
        sums = {"C000": 100, "CE01": 20, "CE03": 30}
        sums.update({"CNS%02d" % code: 0 for code in range(1, 21)})
        sums.update({"CNS05": 4, "CNS06": 5, "CNS07": 10, "CNS08": 6,
                     "CNS09": 2, "CNS10": 3, "CNS11": 4, "CNS12": 5,
                     "CNS13": 6, "CNS14": 7, "CNS16": 8, "CNS18": 9})

        self.assertEqual(lehd_lodes_wac.build({"00926": sums, "00000": {"C000": 0}}), {
            "00926": {
                "lodes_jobs_total": 100,
                "lodes_jobs_office": 27,
                "lodes_jobs_retail": 10,
                "lodes_jobs_industrial": 15,
                "lodes_jobs_hotel_food": 9,
                "lodes_jobs_health": 8,
                "lodes_jobs_high_wage_share": 30.0,
                "lodes_jobs_low_wage_share": 20.0,
                "lodes_jobs_office_share": 27.0,
            }
        })


if __name__ == "__main__":
    unittest.main()
