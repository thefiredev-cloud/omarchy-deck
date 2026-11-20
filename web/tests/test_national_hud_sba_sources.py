"""Behavioral coverage for HUD CHAS and SBA loan source parsers."""
import csv
import io
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import hud_chas_tract  # noqa: E402
import sba_7a_504  # noqa: E402
from ctx import SourceUnavailable  # noqa: E402


class HudChasTests(unittest.TestCase):
    def test_derive_excludes_uncomputed_households_from_burden_shares(self):
        estimates = {n: 0 for n in range(1, 134)}
        estimates[1] = 100
        estimates[2] = 60
        estimates[68] = 40
        for tenure in (2, 68):
            start = tenure + 1
            estimates[start + 1] = 4
            estimates[start + 4] = 3
            estimates[start + 7] = 3
            estimates[start + 10] = 5  # not computed, excluded from denominator
        estimates[3] = 30
        estimates[69] = 40

        row = hud_chas_tract.derive(estimates)

        self.assertEqual(row["chas_owner_burden"], 60.0)
        self.assertEqual(row["chas_renter_burden"], 60.0)
        self.assertEqual(row["chas_severe_burden"], 30.0)
        self.assertEqual(row["chas_low_income_renter_burden"], 60.0)
        self.assertEqual(row["chas_low_income_share"], 70.0)

    def test_parse_reads_table8_from_zip_and_requires_tract_population(self):
        header = ["geoid"] + [f"T8_est{i}" for i in range(1, 134)]
        estimates = ["0"] * 133
        estimates[0] = "100"
        estimates[1] = "50"
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "chas.zip"
            with zipfile.ZipFile(path, "w") as archive:
                with archive.open("release/Table8.csv", "w") as raw:
                    text = io.TextIOWrapper(raw, encoding="latin-1", newline="")
                    writer = csv.writer(text)
                    writer.writerow(header)
                    writer.writerow(["1400000US06037200100", *estimates])
                    text.flush()
            with patch.object(hud_chas_tract, "MIN_TRACTS", 1):
                data, rows = hud_chas_tract.parse(path)
                self.assertEqual(rows, 1)
                self.assertIn("06037200100", data)
            with patch.object(hud_chas_tract, "MIN_TRACTS", 2):
                with self.assertRaisesRegex(SourceUnavailable, "only 1 tracts"):
                    hud_chas_tract.parse(path)


class SbaLoanTests(unittest.TestCase):
    def test_parse_aggregates_eligible_five_year_loans_by_zip(self):
        columns = ["AsOfDate", "Program", "BorrZip", "GrossApproval", "ApprovalDate",
                   "LoanStatus", "GrossChargeOffAmount", "JobsSupported"]
        rows = [
            ["2025-06-30", "504", "9262", "100000", "2020-07-01", "FUNDED", "10000", "3"],
            ["2025-06-30", "7a", "09262", "50000", "2020-07-02", "FUNDED", "5000", "2"],
            ["2025-06-30", "504", "92629", "90000", "2021-01-01", "CANCLD", "0", "9"],
            ["2025-06-30", "7a", "92629", "80000", "2020-06-30", "FUNDED", "0", "4"],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "loans.csv"
            with path.open("w", newline="", encoding="latin-1") as handle:
                writer = csv.writer(handle)
                writer.writerow(columns)
                writer.writerows(rows)

            data, count, as_of = sba_7a_504.parse(str(path))

        self.assertEqual(count, 4)
        self.assertEqual(as_of, "2025-06-30")
        self.assertEqual(data["09262"], {
            "sba504_loans_5y": 1,
            "sba504_dollars_5y": 100000,
            "sba7a_loans_5y": 1,
            "sba7a_dollars_5y": 50000,
            "sba_jobs_5y": 5,
            "sba_chargeoff_rate": 10.0,
        })
        self.assertNotIn("92629", data)

    def test_parse_rejects_files_without_required_columns(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "loans.csv"
            path.write_text("AsOfDate,Program\n2025-06-30,504\n", encoding="latin-1")

            with self.assertRaisesRegex(SourceUnavailable, "SBA header changed"):
                sba_7a_504.parse([str(path)])


if __name__ == "__main__":
    unittest.main()
