"""Behavioral tests for shared ACS, BEA, and Realtor.com source parsers."""
import csv
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import _acs  # noqa: E402
import _bea  # noqa: E402
import _realtor_core  # noqa: E402
from ctx import SourceUnavailable  # noqa: E402


class AcsTableTests(unittest.TestCase):
    def test_parse_tables_keeps_matching_geographies_and_marks_suppressed_estimates(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "table.dat"
            path.write_text(
                "GEO_ID|B25064_E001\n"
                "860Z200US00501|1200\n"
                "860Z200US90210|-666666666\n"
                "0400000US06|99\n",
                encoding="utf-8",
            )

            records, count = _acs.parse_tables(
                {"b25064": path}, {"b25064": {"E001": "rent"}}, "zip", minimum=2
            )

        self.assertEqual(count, 2)
        self.assertEqual(records, {"00501": {"rent": 1200.0}, "90210": {"rent": None}})

    def test_sparse_tables_allow_unpublished_geographies_below_full_minimum(self):
        with tempfile.TemporaryDirectory() as tmp:
            first = Path(tmp) / "first.dat"
            second = Path(tmp) / "second.dat"
            first.write_text(
                "GEO_ID|B25064_E001\n"
                "860Z200US00501|100\n"
                "860Z200US00502|200\n"
                "860Z200US00503|300\n",
                encoding="utf-8",
            )
            second.write_text(
                "GEO_ID|B25065_E001\n"
                "860Z200US00501|10\n"
                "860Z200US00502|20\n",
                encoding="utf-8",
            )

            records, count = _acs.parse_tables(
                {"b25064": first, "b25065": second},
                {"b25064": {"E001": "rent"}, "b25065": {"E001": "units"}},
                "zip",
                minimum=3,
                sparse=True,
            )

        self.assertEqual(count, 3)
        self.assertEqual(records, {
            "00501": {"rent": 100.0, "units": 10.0},
            "00502": {"rent": 200.0, "units": 20.0},
            "00503": {"rent": 300.0},
        })

    def test_parse_tables_rejects_duplicate_normalized_geographies(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "table.dat"
            path.write_text(
                "GEO_ID|B25064_E001\n"
                "860Z200US00501|1200\n"
                "860Z200US00501|1300\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(SourceUnavailable, "repeats geography 00501"):
                _acs.parse_tables(
                    {"b25064": path}, {"b25064": {"E001": "rent"}}, "zip", minimum=1
                )


class RealtorCoreTests(unittest.TestCase):
    def test_parse_core_uses_latest_month_and_retains_quality_flagged_geographies(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "core.csv"
            headers = ["month_date_yyyymm", "cbsa_code", "quality_flag"] + [
                column for column, _ in _realtor_core.CORE.values()
            ]
            with path.open("w", newline="", encoding="utf8") as fh:
                writer = csv.writer(fh)
                writer.writerow(headers)
                writer.writerow(["202501", "11111", "0", "10", "0.1", "2", "30", "0.2", "1.23456", "200000", "0.05", "150"])
                writer.writerow(["202502", "22222", "1", "20", "-0.1", "3", "40", "0.25", "1.23456", "300000", "0.02", "175"])
                writer.writerow(["202502", "", "0", "999", "0", "0", "0", "0", "0", "0", "0", "0"])
                writer.writerow(["202513", "33333", "0", "999", "0", "0", "0", "0", "0", "0", "0", "0"])

            data, rows, as_of, info = _realtor_core.parse_core(
                path, "realtor_", "cbsa_code", _realtor_core.cbsa_key, "metro", min_rows=1
            )

        self.assertEqual(rows, 3)
        self.assertEqual(as_of, "2025-02")
        self.assertEqual(data, {
            "22222": {
                "realtor_active": 20,
                "realtor_active_yoy": -10.0,
                "realtor_new_listings": 3,
                "realtor_dom": 40,
                "realtor_price_reduced_share": 25.0,
                "realtor_pending_ratio": 1.2346,
                "realtor_median_list": 300000,
                "realtor_median_list_yoy": 2.0,
                "realtor_ppsf": 175,
                "realtor_low_quality": 1,
            }
        })
        self.assertEqual(info, {"no_key": 1, "flagged": 1})


class BeaSharedParserTests(unittest.TestCase):
    def test_read_lines_keeps_county_values_and_selects_latest_well_reported_year(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "regional.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr(
                    "CAINC1_ALL_AREAS.csv",
                    "GeoFIPS,LineCode,Description,2022,2023\n"
                    '"01001",1,County A,100,(NA)\n'
                    '"01003",1,County B,200,250\n'
                    '"01000",1,Alabama,999,999\n'
                    '"01005",2,Other line,300,300\n'
                    '"01007",1,County D,300,350\n',
                )

            rows, years = _bea.read_lines(path, {"1"})

        self.assertEqual(years, [2022, 2023])
        self.assertEqual(rows, {
            "01001": {"1": {2022: 100.0, 2023: None}},
            "01003": {"1": {2022: 200.0, 2023: 250.0}},
            "01007": {"1": {2022: 300.0, 2023: 350.0}},
        })
        self.assertEqual(_bea.latest_year(rows, "1", years, share=0.7), 2022)

    def test_read_lines_keeps_multiple_requested_line_codes_per_area(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "regional.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr(
                    "CAINC1_ALL_AREAS.csv",
                    "GeoFIPS,LineCode,Description,2022\n"
                    '"06037",1,Personal income,100\n'
                    '"06037",3,Population,200\n'
                    '"06000",1,California,999\n'
                    '"06037",2,Other line,300\n',
                )

            rows, years = _bea.read_lines(path, {"1", "3"})

        self.assertEqual(years, [2022])
        self.assertEqual(rows, {
            "06037": {
                "1": {2022: 100.0},
                "3": {2022: 200.0},
            },
        })

if __name__ == "__main__":
    unittest.main()
