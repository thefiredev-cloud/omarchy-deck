"""Behavioral coverage for FEMA NRI and FHFA UAD tract parsers."""
import csv
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import fema_nri_tract  # noqa: E402
import fhfa_uad_tract  # noqa: E402
from ctx import SourceUnavailable  # noqa: E402


class FemaNriTractTests(unittest.TestCase):
    def test_parse_rows_maps_hazards_and_skips_invalid_tract_ids(self):
        row = {
            "TRACTFIPS": " 06001000100 ",
            "RISK_SCORE": "18.456",
            "BUILDVALUE": "200000",
            "EAL_VALB": "2500",
            "EAL_VALT": "10.6",
            "SOVI_SCORE": "42.346",
            "RESL_SCORE": "61.556",
            "CFLD_RISKS": "10.123",
            "IFLD_RISKS": "20.226",
            "WFIR_RISKS": "8.987",
            "HWAV_RISKS": "7",
            "ERQK_RISKS": "6",
            "HRCN_RISKS": "50",
            "TRND_RISKS": "35",
        }
        no_risk = {"TRACTFIPS": "06001000300", "BUILDVALUE": "0", "EAL_VALB": "9"}
        rows = [row, {"TRACTFIPS": "not-a-tract"}, no_risk]

        data, count, as_of = fema_nri_tract.parse_rows(rows, min_rows=3)

        self.assertEqual(count, 3)
        self.assertEqual(as_of, fema_nri_tract.AS_OF)
        self.assertEqual(data["06001000100"], {
            "nri_risk_score": 18.46,
            "nri_eal_rate_bldg": 1.25,
            "nri_eal_total": 11,
            "nri_flood_score": 20.23,
            "nri_wildfire_score": 8.99,
            "nri_heat_score": 7.0,
            "nri_quake_score": 6.0,
            "nri_wind_score": 50.0,
            "nri_social_vuln": 42.35,
            "nri_resilience": 61.56,
            "nri_top_hazard": "Hurricane",
        })
        self.assertEqual(data["06001000300"]["nri_eal_rate_bldg"], None)
        self.assertIsNone(data["06001000300"]["nri_top_hazard"])

    def test_parse_rows_rejects_response_below_minimum_row_count(self):
        with self.assertRaisesRegex(SourceUnavailable, "returned 1 tracts"):
            fema_nri_tract.parse_rows([{"TRACTFIPS": "not-a-tract"}], min_rows=2)


class FhfaUadTractTests(unittest.TestCase):
    def test_parse_zip_keeps_only_latest_unsuppressed_enterprise_purchase_rows(self):
        def record(**overrides):
            row = {
                "SOURCE": "Enterprise",
                "APPRAISALSOURCE": "Enterprise Single Family",
                "SERIES": "Median Appraised Value",
                "GEOLEVEL": "Tract",
                "TRACT": "06001000100",
                "PURPOSE": "Purchase",
                "YEAR": "2024",
                "QUARTER": "5",
                "CHARACTERISTIC1": "No Characteristic",
                "SUPPRESSED": "0",
                "VALUE": "200000.8",
            }
            row.update(overrides)
            return row

        rows = [
            record(),
            record(SERIES="Count of Appraisals", VALUE="4.4"),
            record(TRACT="06001000300", YEAR="2023", VALUE="100000"),
            record(TRACT="06001000500", PURPOSE="Refinance"),
            record(TRACT="06001000700", QUARTER="4"),
            record(TRACT="06001000900", SERIES="Unknown series"),
            record(TRACT="06001001100", GEOLEVEL="County"),
            record(TRACT="06001001300", CHARACTERISTIC1="Property age"),
            record(TRACT="06001001500", SUPPRESSED="1"),
            record(TRACT="06001001700", APPRAISALSOURCE="Other source"),
            record(TRACT="0600100190"),
            record(TRACT="06001002100", VALUE="not numeric"),
        ]
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=fhfa_uad_tract.COLS)
        writer.writeheader()
        writer.writerows(rows)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "uad.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("release.csv", stream.getvalue())

            with patch.object(fhfa_uad_tract, "MIN_TRACTS", 1):
                data, row_count, as_of = fhfa_uad_tract.parse(path)

        self.assertEqual(data, {"06001000100": {"uad_median_value": 200001, "uad_appraisals": 4}})
        self.assertEqual(row_count, len(rows))
        self.assertEqual(as_of, "2024")

    def test_parse_rejects_zip_with_multiple_csv_members(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ambiguous.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("first.csv", "")
                archive.writestr("second.csv", "")

            with self.assertRaisesRegex(SourceUnavailable, "2 CSV members"):
                fhfa_uad_tract.parse(path)


if __name__ == "__main__":
    unittest.main()
