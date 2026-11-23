"""Behavioral coverage for shared Zillow and Redfin market parsers."""
import csv
import struct
import zipfile
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import _redfin_segments  # noqa: E402
import _zillow_market  # noqa: E402
from ctx import SourceUnavailable  # noqa: E402


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


class ZillowForecastParserTests(unittest.TestCase):
    HEADER = ["RegionName", "RegionType", "StateName", "BaseDate", "2026-10-31", "2027-09-30", "2027-10-31"]

    @staticmethod
    def _write(tmp, header, rows):
        path = Path(tmp) / "zhvf.csv"
        with path.open("w", newline="", encoding="utf8") as fh:
            writer = csv.writer(fh)
            writer.writerow(header)
            writer.writerows(rows)
        return path

    def test_forecast_picks_the_horizon_column_from_the_latest_base_month(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(tmp, self.HEADER, [
                ["Example Metro", "msa", "CA", "2026-10-31", "100", "102", "104.567"],
                ["Stale Metro", "msa", "NV", "2026-09-30", "100", "1", "1"],
                ["United States", "country", "", "2026-11-30", "100", "1", "1"],
            ])
            out, rows, base = _zillow_market.parse_forecast(path, "msa", horizon=12, min_regions=1)

        self.assertEqual(out, {("Example Metro", "CA"): 104.57})
        self.assertEqual((rows, base), (3, "2026-10"))

    def test_forecast_refuses_too_few_regions_missing_horizon_or_missing_base_date(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(tmp, self.HEADER, [["Example Metro", "msa", "CA", "2026-10-31", "100", "102", "104"]])
            with self.assertRaises(SourceUnavailable):
                _zillow_market.parse_forecast(path, "msa", horizon=12, min_regions=2)

            short = self._write(tmp, self.HEADER[:4] + ["2027-09-30"], [["Example Metro", "msa", "CA", "2026-10-31", "1"]])
            with self.assertRaises(SourceUnavailable):
                _zillow_market.parse_forecast(short, "msa", horizon=12, min_regions=1)

            no_base = self._write(tmp, ["RegionName", "RegionType", "StateName", "2026-10-31", "2027-10-31"],
                                  [["Example Metro", "msa", "CA", "100", "104"]])
            with self.assertRaises(SourceUnavailable):
                _zillow_market.parse_forecast(no_base, "msa", horizon=12, min_regions=1)


class ZillowLagAndCastTests(unittest.TestCase):
    def test_lag_note_is_blank_when_series_end_together_and_names_the_late_ones(self):
        self.assertEqual(_zillow_market.lag_note({"zhvi": "2026-10", "zori": "2026-10"}), "")
        self.assertEqual(_zillow_market.lag_note({"zhvi": "2026-10", "zhvf": "2026-09", "inv": "2026-08"}),
                         "Ends earlier than 2026-10: inv 2026-08, zhvf 2026-09.")

    def test_cast_publishes_each_kind_in_its_unit(self):
        self.assertEqual(_zillow_market.cast("0.1234", "p"), 12.34)
        self.assertEqual(_zillow_market.cast("3.14159", "f"), 3.1)
        self.assertEqual(_zillow_market.cast("250000.4", "d"), 250000)
        self.assertIsNone(_zillow_market.cast("NA", "i"))


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

class RedfinAreaLoaderTests(unittest.TestCase):
    def test_loader_merges_supplements_only_for_base_areas(self):
        class Context:
            def fetch(self, url, name, **kwargs):
                return name, {"bytes": 1}

            def log(self, message):
                pass

        records = {
            "housing_market": ({"92629": {"rf_median_sale": 500000},
                                "92630": {"rf_median_sale": 600000}}, 3),
            "property_types": ({"92629": {"rf_mf_inventory": 4},
                                "99999": {"rf_mf_inventory": 99}}, 2),
            "price_drops": ({"92629": {"rf_price_drop_share": 12.5},
                             "99999": {"rf_price_drop_share": 99.0}}, 4),
        }

        def parse(path, **kwargs):
            return (*records[path.removesuffix(".csv")], "2026-10")

        with patch.object(_redfin_segments.time, "sleep"):
            result = _redfin_segments.load_area(Context(), parse, "zip", "rf_", minimum=2)

        self.assertEqual(result["data"], {
            "92629": {
                "rf_median_sale": 500000,
                "rf_mf_inventory": 4,
                "rf_price_drop_share": 12.5,
            },
            "92630": {"rf_median_sale": 600000},
        })
        self.assertEqual((result["rows"], result["as_of"]), (9, "2026-10"))



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
