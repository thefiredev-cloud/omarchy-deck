"""Behavioral tests for IRS ZIP bracket aggregation and derived metrics."""
import csv
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import irs_soi_zip  # noqa: E402


class IrsSoiZipTests(unittest.TestCase):
    def test_parse_sums_brackets_and_drops_non_zip_totals(self):
        headers = ["zipcode", "agi_stub", *irs_soi_zip.SUMS]

        def row(zipcode, stub, n1, agi):
            values = dict.fromkeys(irs_soi_zip.SUMS, "0")
            values.update(N1=str(n1), A00100=str(agi))
            return [zipcode, str(stub), *(values[column] for column in irs_soi_zip.SUMS)]

        rows = [
            row("501", 1, 10, 100),
            row("00501", 5, 3, 50),
            row("00501", 6, 2, 30),
            row("00000", 1, 8, 80),
            row("99999", 1, 9, 90),
            ["12345", "1"],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "soi.csv"
            with path.open("w", newline="", encoding="utf-8") as fh:
                writer = csv.writer(fh)
                writer.writerow(headers)
                writer.writerows(rows)
            with patch.object(irs_soi_zip, "MIN_ROWS", 4):
                data, count = irs_soi_zip.parse(path)

        self.assertEqual(count, 5)
        self.assertEqual(data, {
            "00501": {
                **dict.fromkeys(irs_soi_zip.SUMS, 0.0),
                "N1": 15.0,
                "A00100": 180.0,
                "hi": 5.0,
                "top": 2.0,
            },
        })

    def test_build_derives_income_shares_and_year_over_year_changes(self):
        current = dict.fromkeys(irs_soi_zip.SUMS, 0.0)
        current.update({
            "N1": 12, "A00100": 6000, "A02650": 12000, "A00200": 9000,
            "N00900": 3, "N04470": 6, "N18500": 4, "A18500": 800,
            "N19300": 3, "A19300": 600, "A01000": 2400, "hi": 6, "top": 2,
        })
        prior = dict.fromkeys(irs_soi_zip.SUMS, 0.0)
        prior.update({"N1": 10, "A00100": 4000})

        result = irs_soi_zip.build({"00501": current}, {"00501": prior})

        self.assertEqual(result["00501"], {
            "irs_returns": 12,
            "irs_agi_per_return": 500000,
            "irs_wage_share": 75.0,
            "irs_sched_c_share": 25.0,
            "irs_over100k_share": 50.0,
            "irs_over200k_share": 16.67,
            "irs_itemizer_share": 50.0,
            "irs_re_tax_share": 33.33,
            "irs_re_tax_avg": 200000,
            "irs_mortgage_int_avg": 200000,
            "irs_cap_gains_per_return": 200000,
            "irs_returns_yoy": 20.0,
            "irs_agi_per_return_yoy": 25.0,
        })


if __name__ == "__main__":
    unittest.main()
