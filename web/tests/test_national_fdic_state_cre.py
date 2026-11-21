"""Behavioral tests for FDIC state commercial-real-estate aggregation."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import fdic_state_cre  # noqa: E402
from ctx import SourceUnavailable  # noqa: E402


def bank(cert, state="CA", date="20250630", **values):
    row = {code: 0 for code in fdic_state_cre.CODES}
    row.update({"CERT": cert, "REPDTE": date, "STALP": state})
    row.update(values)
    return {"data": row}


def page(path, rows):
    path.write_text(json.dumps({"data": rows}), encoding="utf8")
    return path


class FdicStateCreTests(unittest.TestCase):
    def test_parse_deduplicates_banks_and_excludes_non_state_rows(self):
        first = bank("1", LNRENRES="100", LNREMULT="200", LNRECONS="300",
                     NCRENRES="10", NCREMULT="20", NCRECONS="30")
        second = bank("2", state="PR", LNRENRES="900")
        with tempfile.TemporaryDirectory() as tmp:
            paths = [
                page(Path(tmp) / "page-1.json", [first]),
                page(Path(tmp) / "page-2.json", [first, second]),
            ]

            states, rows, quarter = fdic_state_cre.parse(paths)

        self.assertEqual(quarter, "20250630")
        self.assertEqual(rows, 2)
        self.assertEqual(states["CA"], {
            "LNRENRES": 100.0,
            "LNREMULT": 200.0,
            "LNRECONS": 300.0,
            "covered_cre": 600.0,
            "covered_noncurrent": 60.0,
        })

    def test_combine_converts_thousands_and_hides_rate_below_coverage_threshold(self):
        current = {
            "CA": {
                "LNRENRES": 600.0,
                "LNREMULT": 300.0,
                "LNRECONS": 100.0,
                "covered_cre": 899.0,
                "covered_noncurrent": 90.0,
            }
        }
        prior = {"CA": {"LNRENRES": 500.0, "LNREMULT": 250.0, "LNRECONS": 50.0}}

        data = fdic_state_cre.combine(current, prior)["CA"]

        self.assertEqual(data["fdics_cre_loans"], 1_000_000)
        self.assertEqual(data["fdics_cre_loans_yoy"], 25.0)
        self.assertEqual(data["fdics_mf_loans"], 300_000)
        self.assertEqual(data["fdics_noncurrent_coverage"], 89.9)
        self.assertIsNone(data["fdics_noncurrent_cre_rate"])

    def test_parse_rejects_pages_with_mixed_quarters(self):
        with tempfile.TemporaryDirectory() as tmp:
            paths = [
                page(Path(tmp) / "page-1.json", [bank("1")]),
                page(Path(tmp) / "page-2.json", [bank("2", date="20250930")]),
            ]

            with self.assertRaisesRegex(SourceUnavailable, "mix report quarters"):
                fdic_state_cre.parse(paths)


if __name__ == "__main__":
    unittest.main()
