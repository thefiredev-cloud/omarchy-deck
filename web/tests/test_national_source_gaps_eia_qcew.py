"""Behavioral tests for EIA-861 and BLS QCEW county parsers."""
import csv
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import bls_qcew_county  # noqa: E402
import eia_861_county  # noqa: E402
from ctx import SourceUnavailable  # noqa: E402


class BlsQcewCountyTests(unittest.TestCase):
    def test_parse_keeps_total_county_rows_and_leaves_disclosed_fields_missing(self):
        columns = bls_qcew_county.NEEDED
        rows = [
            {
                "area_fips": "06001", "own_code": "0", "agglvl_code": "70", "year": "2024", "qtr": "2",
                "disclosure_code": "N", "qtrly_estabs": "100", "month3_emplvl": "1200", "avg_wkly_wage": "900",
                "oty_qtrly_estabs_pct_chg": "2.0", "oty_month3_emplvl_pct_chg": "3.0",
                "oty_month3_emplvl_chg": "35", "oty_avg_wkly_wage_pct_chg": "4.0",
            },
            {
                "area_fips": "06000", "own_code": "0", "agglvl_code": "70", "year": "2024", "qtr": "2",
                "disclosure_code": "", "qtrly_estabs": "999", "month3_emplvl": "999", "avg_wkly_wage": "999",
                "oty_qtrly_estabs_pct_chg": "9", "oty_month3_emplvl_pct_chg": "9",
                "oty_month3_emplvl_chg": "9", "oty_avg_wkly_wage_pct_chg": "9",
            },
        ]

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "qcew.csv"
            with path.open("w", newline="", encoding="latin-1") as stream:
                writer = csv.DictWriter(stream, fieldnames=columns)
                writer.writeheader()
                writer.writerows(rows)

            with patch.object(bls_qcew_county, "MIN_COUNTIES", 1):
                data, count, period = bls_qcew_county.parse({"10": path})

        self.assertEqual((count, period), (1, (2024, 2)))
        self.assertIsNone(data["06001"]["qcew_emp"])
        self.assertIsNone(data["06001"]["qcew_avg_wkly_wage"])
        self.assertIsNone(data["06001"]["qcew_emp_yoy"])
        self.assertEqual(data["06001"]["qcew_retail_emp_yoy"], None)

    def test_parse_rejects_missing_total_slice(self):
        with self.assertRaisesRegex(SourceUnavailable, "total employment slice"):
            bls_qcew_county.parse({})


class Eia861CountyTests(unittest.TestCase):
    @staticmethod
    def sales_row():
        row = [""] * 17
        row[1], row[3], row[4], row[6] = "001", "A", "Bundled", "CA"
        row[9], row[10] = "1000", "10000"
        return row

    def test_parse_weights_utility_prices_and_adds_state_level_prices(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "eia.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("Sales_Ult_Cust_2024.xlsx", b"sales")
                archive.writestr("Service_Territory_2024.xlsx", b"territory")

            sales = [self.sales_row()]
            territory = [
                ["Data Year", "Utility Number", "Utility Name", "Short Form", "State", "County"],
                ["2024", "001", "Utility", "N", "CA", "St. Louis County"],
            ]

            def read_rows(stream):
                return sales if stream.read() == b"sales" else territory

            with patch.object(eia_861_county._xlsx, "read_xlsx_rows", side_effect=read_rows), \
                    patch.object(eia_861_county, "MIN_COUNTIES", 1):
                data, row_count, matched = eia_861_county.parse(path, {("CA", "stlouis"): "06001"})

        self.assertEqual((row_count, matched), (3, 1.0))
        self.assertEqual(data, {
            "06001": {
                "eia_utilities": 1,
                "eia_priced_utilities": 1,
                "eia_res_cents": 10.0,
                "eia_state_res_cents": 10.0,
            }
        })

    def test_parse_rejects_changed_service_territory_header(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "eia.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("Sales_Ult_Cust_2024.xlsx", b"sales")
                archive.writestr("Service_Territory_2024.xlsx", b"territory")

            def read_rows(stream):
                return [self.sales_row()] if stream.read() == b"sales" else [["wrong header"]]

            with patch.object(eia_861_county._xlsx, "read_xlsx_rows", side_effect=read_rows):
                with self.assertRaisesRegex(SourceUnavailable, "service territory header changed"):
                    eia_861_county.parse(path, {("CA", "stlouis"): "06001"})


if __name__ == "__main__":
    unittest.main()
