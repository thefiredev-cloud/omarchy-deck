"""Behavioral coverage for Census nonemployer county parsing and Zillow ZHVI wide-file parsing."""
import csv
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import census_nes  # noqa: E402
import zillow_zhvi_variants  # noqa: E402
from ctx import SourceUnavailable  # noqa: E402


def _write_csv(path, header, rows):
    with open(path, "w", newline="", encoding="utf8") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        writer.writerows(rows)


class CensusNesParseTests(unittest.TestCase):
    NES_HEADER = ["ST", "CTY", "NAICS", "ESTAB", "RCPTOT", "ESTAB_F", "RCPTOT_F"]

    def test_parse_builds_county_rates_and_skips_suppressed_and_state_rows(self):
        rows = [
            ["6", "37", "00", "100", "5000", "", ""],
            ["6", "37", "53", "25", "900", "", ""],
            ["6", "37", "44-45", "20", "400", "", ""],
            ["6", "37", "72", "40", "100", "", ""],
            ["6", "999", "00", "1", "1", "", ""],
            ["6", "59", "00", "30", "300", "D", ""],
            ["6", "61", "00", "8", "80", "", ""],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "nonemp23co.csv"
            _write_csv(path, self.NES_HEADER, rows)

            data, read, as_of = census_nes.parse(str(path), population={"06037": 50000})

        self.assertEqual(as_of, "2023")
        self.assertEqual(read, 7)
        self.assertEqual(set(data), {"06037", "06061"})
        self.assertEqual(data["06037"], {
            "nes_firms": 100,
            "nes_firms_per_1k": 2.0,
            "nes_receipts_per_firm": 50000,
            "nes_realestate_share": 25.0,
            "nes_retail_share": 20.0,
        })
        self.assertIsNone(data["06061"]["nes_firms_per_1k"])

    def test_parse_rejects_header_without_required_columns(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "nonemp23co.csv"
            _write_csv(path, ["ST", "CTY", "NAICS"], [["6", "37", "00"]])

            with self.assertRaises(SourceUnavailable):
                census_nes.parse(str(path))

    def test_parse_population_picks_requested_year_and_county_rows_only(self):
        header = ["SUMLEV", "STATE", "COUNTY", "POPESTIMATE2022", "POPESTIMATE2023"]
        rows = [
            ["040", "06", "000", "9", "9"],
            ["050", "06", "037", "1000", "1200"],
            ["050", "06", "059", "0", "0"],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "co-est.csv"
            _write_csv(path, header, rows)

            self.assertEqual(census_nes.parse_population(str(path), 2022), {"06037": 1000.0})
            self.assertEqual(census_nes.parse_population(str(path), 2030), {"06037": 1200.0})


class ZillowZhviVariantsParseTests(unittest.TestCase):
    MONTHS = ["%d-%02d-28" % (year, month) for year in (2024, 2025) for month in range(1, 13)]

    def _header(self, months=None):
        return ["RegionID", "SizeRank", "RegionName", "RegionType", "StateName"] + (months or self.MONTHS)

    def _write_wide(self, path, extra_rows, months=None):
        width = len(months or self.MONTHS)
        generated = [["%d" % i, "1", str(90000 + i), "zip", "CA"] + ["100000"] * width
                     for i in range(2000)]
        _write_csv(path, self._header(months), extra_rows + generated)

    def test_parse_takes_newest_value_and_year_over_year_change_for_zip_rows(self):
        newest = [["1", "1", "1001", "zip", "MA"] + ["250000"] * 23 + ["300000"],
                  ["2", "2", "2000", "county", "MA"] + ["999999"] * 24,
                  ["3", "3", "", "zip", "MA"] + ["100000"] * 24,
                  ["4", "4", "1004", "zip", "MA"] + ["100000"] * 23 + [""],
                  ["5", "5", "1002"]]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Zip_zhvi.csv"
            self._write_wide(path, newest)

            data, rows, last = zillow_zhvi_variants.parse(str(path), "zillow_zhvi_top")

        self.assertEqual(last, "2025-12")
        self.assertEqual(rows, 2004)
        self.assertEqual(data["01001"], {"zillow_zhvi_top": 300000, "zillow_zhvi_top_yoy": 20.0})
        self.assertEqual(data["90000"], {"zillow_zhvi_top": 100000, "zillow_zhvi_top_yoy": 0.0})
        self.assertNotIn("02000", data)
        self.assertNotIn("01004", data)
        self.assertEqual(len(data), 2001)

    def test_parse_rejects_header_without_region_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Zip_zhvi.csv"
            _write_csv(path, ["RegionID", "Name"] + self.MONTHS, [["1", "x"] + ["1"] * 24])

            with self.assertRaises(SourceUnavailable):
                zillow_zhvi_variants.parse(str(path), "zillow_zhvi_top")

    def test_parse_rejects_file_with_fewer_than_24_month_columns(self):
        months = self.MONTHS[-12:]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Zip_zhvi.csv"
            self._write_wide(path, [], months=months)

            with self.assertRaises(SourceUnavailable):
                zillow_zhvi_variants.parse(str(path), "zillow_zhvi_top")

    def test_parse_rejects_file_below_minimum_zip_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Zip_zhvi.csv"
            _write_csv(path, self._header(), [["1", "1", "1001", "zip", "MA"] + ["250000"] * 24])

            with self.assertRaises(SourceUnavailable):
                zillow_zhvi_variants.parse(str(path), "zillow_zhvi_top")


if __name__ == "__main__":
    unittest.main()
