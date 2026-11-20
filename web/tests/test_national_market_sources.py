"""Behavioral coverage for shared Zillow and Redfin market parsers."""
import csv
import struct
import zipfile
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import _redfin_segments  # noqa: E402
import _zillow_market  # noqa: E402


class ZillowMarketParserTests(unittest.TestCase):
    def test_series_uses_latest_month_matching_geography_and_year_ago_column(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "series.csv"
            months = [f"{year}-{month:02d}-01" for year, month in
                      [(2024, month) for month in range(1, 13)] + [(2025, 1), (2025, 2)]]
            with path.open("w", newline="", encoding="utf8") as fh:
                writer = csv.writer(fh)
                writer.writerow(["RegionName", "RegionType", "StateName", *months])
                writer.writerow(["Example Metro", "msa", "CA", *(["100"] * 13 + ["125"])])
                writer.writerow(["United States", "country", "", *(["900"] * 14)])
                writer.writerow(["Other Metro", "state", "NV", *(["80"] * 14)])

            data, rows, as_of = _zillow_market.parse_series(
                path, "msa", "d", want_yoy=True, hist_months=2, min_regions=1)

        self.assertEqual(as_of, "2025-02")
        self.assertEqual(data, {
            ("Example Metro", "CA"): {
                "v": 125, "yoy": 25.0, "hist": [["2025-01", 100], ["2025-02", 125]]
            }
        })


class RedfinMarketParserTests(unittest.TestCase):
    def test_periods_keep_latest_window_and_resolve_only_exact_census_metros(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "market.csv"
            headers = [
                "PERIOD END", "REGION TYPE", "REGION NAME", "REGION ID", "FREQUENCY",
                "IS SEASONALLY ADJUSTED", "MEDIAN SALE PRICE NSA ($)",
            ]
            with path.open("w", newline="", encoding="utf8") as fh:
                writer = csv.writer(fh)
                writer.writerow(headers)
                writer.writerows([
                    ["2025-03-31", "Metro", "Example Metro Area", "99999", "Monthly", "false", "300000"],
                    ["2025-01-31", "Metro", "Example Metro Area", "12345", "Monthly", "false", "100000"],
                    ["2025-02-28", "Metro", "Example Metro Area", "12345", "Monthly", "false", "200000"],
                    ["2025-03-31", "Metro", "Example Metro Area", "12345", "Monthly", "true", "999999"],
                    ["2025-03-31", "Metro", "Example City", "99998", "Monthly", "false", "400000"],
                ])

            periods, rows, latest = _redfin_segments.parse_periods(
                path, "cbsa", "redfin_", ("median_sale",), cbsas={"12345": "Example Metro Area"}, months=2)

        self.assertEqual(latest, "2025-03")
        self.assertEqual(rows, 5)
        self.assertEqual(periods, {
            "2025-02": {"12345": {"redfin_median_sale": 200000}},
            "2025-03": {"12345": {"redfin_median_sale": 300000}},
        })


class CensusDivisionParserTests(unittest.TestCase):
    @staticmethod
    def _dbf():
        fields = (("CBSAFP", 5), ("METDIVFP", 5), ("NAME", 30))
        header_size = 32 + len(fields) * 32 + 1
        record_size = 1 + sum(width for _, width in fields)
        header = bytearray(32)
        struct.pack_into("<IHH", header, 4, 16, header_size, record_size)
        descriptors = bytearray()
        for name, width in fields:
            descriptor = bytearray(32)
            descriptor[:len(name)] = name.encode("ascii")
            descriptor[11] = ord("C")
            descriptor[16] = width
            descriptors.extend(descriptor)
        records = bytearray()
        for index in range(16):
            deleted = index == 15
            parent = "10000"
            code = "%05d" % (20000 + index)
            name = ("Deleted" if deleted else "Division %d" % index).ljust(30)
            records.extend((b"*" if deleted else b" ") + parent.encode() + code.encode() + name.encode())
        return bytes(header + descriptors + b"\r" + records + b"\x1a")

    def test_census_divisions_reads_parent_codes_and_skips_deleted_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "divisions.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("division.dbf", self._dbf())

            divisions = _redfin_segments.census_divisions(path)

        self.assertEqual(len(divisions), 15)
        self.assertEqual(divisions["20000"], {"parent": "10000", "title": "Division 0"})

    def test_metro_resolver_rejects_ambiguous_normalized_titles(self):
        resolve = _redfin_segments.metro_resolver({
            "12345": "Springfield Metro Area",
            "54321": "Springfield",
        })

        self.assertIsNone(resolve("99999", "Springfield"))
        self.assertEqual(resolve("12345", "Different title"), "12345")

if __name__ == "__main__":
    unittest.main()
