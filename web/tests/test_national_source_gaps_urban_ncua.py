"""Behavioral coverage for Urban school and NCUA credit-union sources."""
import csv
import json
import sys
import tempfile
import unittest
import zipfile
from io import StringIO
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import ncua_call_report  # noqa: E402
import urban_schools  # noqa: E402
from ctx import SourceUnavailable  # noqa: E402


def write_json(path, results):
    path.write_text(json.dumps({"results": results}), encoding="utf8")
    return str(path)


class UrbanSchoolsTests(unittest.TestCase):
    def test_parse_weights_district_measures_and_ranks_proficiency_within_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            directory = write_json(root / "directory.json", [
                {"zip_location": "92629-1234", "school_status": 1, "fips": "06001", "enrollment": 100, "leaid": 1, "ncessch": 11},
                {"zip_location": "92630", "school_status": 1, "fips": "06001", "enrollment": 300, "leaid": 2, "ncessch": 12},
                {"zip_location": "92640", "school_status": 1, "fips": "06001", "enrollment": 100, "leaid": 3, "ncessch": 13},
                {"zip_location": "92641", "school_status": 1, "fips": "06001", "enrollment": 100, "leaid": 4, "ncessch": 14},
                {"zip_location": "92642", "school_status": 1, "fips": "06001", "enrollment": 100, "leaid": 5, "ncessch": 15},
                {"zip_location": "92643", "school_status": 2, "fips": "06001", "enrollment": 999, "leaid": 6, "ncessch": 16},
            ])
            finance = write_json(root / "finance.json", [
                {"leaid": 1, "exp_current_elsec_total": 10000, "enrollment_fall_responsible": 100},
                {"leaid": 2, "exp_current_elsec_total": 20000, "enrollment_fall_responsible": 100},
            ])
            all_students = {key: 99 for key in ("race", "sex", "lep", "homeless", "migrant", "disability",
                                                    "foster_care", "military_connected", "econ_disadvantaged")}
            edfacts = write_json(root / "edfacts.json", [
                {**all_students, "leaid": 1, "read_test_pct_prof_midpt": 50, "math_test_pct_prof_midpt": 70},
                {**all_students, "leaid": 2, "read_test_pct_prof_midpt": 80, "math_test_pct_prof_midpt": 100},
                {**all_students, "leaid": 3, "read_test_pct_prof_midpt": 60, "math_test_pct_prof_midpt": 60},
                {**all_students, "leaid": 4, "read_test_pct_prof_midpt": 70, "math_test_pct_prof_midpt": 70},
                {**all_students, "leaid": 5, "read_test_pct_prof_midpt": 90, "math_test_pct_prof_midpt": 90},
                {**all_students, "leaid": 6, "race": 1, "read_test_pct_prof_midpt": 100, "math_test_pct_prof_midpt": 100},
            ])
            meps = write_json(root / "meps.json", [
                {"ncessch": 11, "meps_poverty_pct": 40},
                {"ncessch": 12, "meps_poverty_pct": 20},
            ])

            data, rows, as_of = urban_schools.parse({
                "directory": [directory], "finance": [finance], "edfacts": [edfacts], "meps": [meps],
            }, min_schools=1)

        self.assertEqual((rows, as_of), (6, urban_schools.AS_OF))
        self.assertEqual(data["92629"], {
            "school_count": 1, "school_enrollment": 100, "school_prof_pctile": 12.5,
            "school_prof_pctile_2018": None, "school_poverty": 40.0, "school_ppe": 100,
            "school_score": 12.5,
        })
        self.assertEqual(data["92630"]["school_prof_pctile"], 87.5)
        self.assertNotIn("92643", data)
        self.assertEqual(data["92640"]["school_prof_pctile"], 12.5)
        self.assertEqual(data["92642"]["school_prof_pctile"], 87.5)

    def test_parse_rejects_directory_below_requested_minimum(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = write_json(Path(tmp) / "directory.json", [{}])
            with self.assertRaisesRegex(SourceUnavailable, "school directory has 1 rows"):
                urban_schools.parse({"directory": [directory], "finance": [], "edfacts": [], "meps": []}, min_schools=2)


class NcuaCallReportTests(unittest.TestCase):
    @staticmethod
    def write_csv(archive, name, rows):
        stream = StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
        archive.writestr(name, stream.getvalue().encode("latin-1"))

    def test_parse_separates_branch_locations_from_headquarters_balance_sheets(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "quarter.zip"
            with zipfile.ZipFile(path, "w") as archive:
                self.write_csv(archive, "Credit Union Branch Information.txt", [
                    {"CU_NUMBER": "CU1", "PhysicalAddressPostalCode": "92629-1234"},
                    {"CU_NUMBER": "CU1", "PhysicalAddressPostalCode": "92629"},
                    {"CU_NUMBER": "CU2", "PhysicalAddressPostalCode": "926"},
                    {"CU_NUMBER": "", "PhysicalAddressPostalCode": "92629"},
                ])
                self.write_csv(archive, "FOICU.txt", [
                    {"CU_NUMBER": "CU1", "ZIP_CODE": "501-9999", "CYCLE_DATE": "6/30/2026 0:00:00"},
                    {"CU_NUMBER": "CU2", "ZIP_CODE": "90210", "CYCLE_DATE": "6/30/2026 0:00:00"},
                ])
                self.write_csv(archive, "FS220.txt", [
                    {"CU_NUMBER": "CU1", "ACCT_010": "1200", "ACCT_018": "900", "ACCT_083": "30"},
                    {"CU_NUMBER": "CU2", "ACCT_010": "800", "ACCT_018": "", "ACCT_083": "20"},
                    {"CU_NUMBER": "CU3", "ACCT_010": "9999", "ACCT_018": "1", "ACCT_083": "1"},
                ])

            with patch.object(ncua_call_report, "MIN_OFFICES", 1), patch.object(ncua_call_report, "MIN_CREDIT_UNIONS", 1):
                data, rows, as_of = ncua_call_report.parse(path)

        self.assertEqual((rows, as_of), (8, "2026-06-30"))
        self.assertEqual(data["92629"], {"ncua_offices": 2, "ncua_credit_unions": 1})
        self.assertEqual(data["00501"], {
            "ncua_hq_assets": 1200, "ncua_hq_shares": 900, "ncua_hq_members": 30,
        })
        self.assertEqual(data["90210"], {"ncua_hq_assets": 800, "ncua_hq_members": 20})
        self.assertEqual(data["00926"], {"ncua_offices": 1, "ncua_credit_unions": 1})

    def test_parse_rejects_a_non_zip_download(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "not-a-zip"
            path.write_text("not zip data", encoding="utf8")
            with self.assertRaisesRegex(SourceUnavailable, "file is not a zip"):
                ncua_call_report.parse(path)


if __name__ == "__main__":
    unittest.main()
