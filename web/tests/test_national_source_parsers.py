"""Behavioral tests for shared CES and building-permits file parsers."""
import csv
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import _bls_ces  # noqa: E402
import _bps  # noqa: E402
from ctx import SourceUnavailable  # noqa: E402
import census_bps_county  # noqa: E402
import fdic_call_cre  # noqa: E402
import sec_absee_cmbs  # noqa: E402


class BlsCesParserTests(unittest.TestCase):
    def test_cbsa_parse_uses_seasonally_adjusted_values_for_latest_and_yoy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = {name: root / name for name in ("sm.area", "sm.series", "data")}
            with paths["sm.area"].open("w", newline="") as fh:
                writer = csv.writer(fh, delimiter="\t")
                writer.writerow(("area_code", "area_name"))
                writer.writerow(("31080", "Los Angeles-Long Beach-Anaheim, CA"))
                writer.writerow(("31081", "Los Angeles Metropolitan Division"))
            with paths["sm.series"].open("w", newline="") as fh:
                writer = csv.writer(fh, delimiter="\t")
                writer.writerow(("series_id", "state_code", "area_code", "industry_code", "data_type_code",
                                 "seasonal", "end_year", "end_period"))
                writer.writerow(("sa", "06", "31080", _bls_ces.NONFARM, "01", "S", "2025", "M01"))
                writer.writerow(("nsa", "06", "31080", _bls_ces.NONFARM, "01", "U", "2025", "M01"))
            with paths["data"].open("w", newline="") as fh:
                writer = csv.writer(fh, delimiter="\t")
                writer.writerow(("series_id", "year", "period", "value"))
                writer.writerows((("sa", "2024", "M01", "100.0"), ("sa", "2025", "M01", "110.0"),
                                  ("nsa", "2024", "M01", "900.0"), ("nsa", "2025", "M01", "990.0")))

            data, rows, as_of, history, _ = _bls_ces.parse(paths, "cbsa", "cesm_", 1)

        self.assertEqual(as_of, "2025-01")
        self.assertEqual(rows, 4)
        self.assertEqual(set(data), {"31080"})
        self.assertEqual(data["31080"]["cesm_nonfarm"], 110000)
        self.assertEqual(data["31080"]["cesm_nonfarm_yoy"], 10.0)
        self.assertEqual(history["31080"]["cesm_nonfarm"], [["2024-01", 100000], ["2025-01", 110000]])


    def test_cbsa_uses_unadjusted_series_when_adjusted_latest_month_is_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = {name: root / name for name in ("sm.area", "sm.series", "data")}
            paths["sm.area"].write_text(
                "area_code\tarea_name\n31080\tLos Angeles-Long Beach-Anaheim, CA\n",
                encoding="utf-8",
            )
            paths["sm.series"].write_text(
                "series_id\tstate_code\tarea_code\tindustry_code\tdata_type_code\tseasonal\tend_year\tend_period\n"
                f"sa\t06\t31080\t{_bls_ces.NONFARM}\t01\tS\t2025\tM02\n"
                f"nsa\t06\t31080\t{_bls_ces.NONFARM}\t01\tU\t2025\tM02\n",
                encoding="utf-8",
            )
            paths["data"].write_text(
                "series_id\tyear\tperiod\tvalue\n"
                "sa\t2025\tM01\t200\n"
                "nsa\t2024\tM02\t100\n"
                "nsa\t2025\tM01\t100\n"
                "nsa\t2025\tM02\t110\n",
                encoding="utf-8",
            )

            data, _, as_of, history, _ = _bls_ces.parse(paths, "cbsa", "cesm_", 1)

        self.assertEqual(as_of, "2025-02")
        self.assertEqual(data["31080"]["cesm_nonfarm_yoy"], 10.0)
        self.assertEqual(
            history["31080"]["cesm_nonfarm"],
            [["2024-02", 100000], ["2025-01", 100000], ["2025-02", 110000]],
        )




class FdicCallCreTests(unittest.TestCase):
    def test_parse_weights_ratios_by_covered_deposits_and_drops_undercovered_zip(self):
        banks = {
            "1": {"assets": 1000, "equity": 100, "cre": 300, "mf": 100},
            "2": {"assets": 2000, "equity": 200, "cre": 1000, "mf": 400},
        }
        branches = {
            "02108": {"1": 80, "2": 20},
            "10001": {"1": 49, "missing": 51},
        }

        data = fdic_call_cre.parse(branches, banks)

        self.assertEqual(data, {
            "02108": {
                "fdiccre_pct_assets": 34.0,
                "fdiccre_mf_pct_assets": 12.0,
                "fdiccre_pct_equity": 340.0,
            }
        })


class SecCmbsAggregateTests(unittest.TestCase):
    def test_aggregate_combines_property_metrics_and_excludes_unknown_status(self):
        rows = [
            {"zip": "02108", "type": "OF", "noi": 100000, "occ": 90, "value": 1000000,
             "nra": 50000, "dscr": 1.25, "delinq": True},
            {"zip": "02108", "type": "OF", "noi": 50000, "occ": 80, "value": 1000000,
             "nra": 50000, "dscr": 1.5, "delinq": False},
            {"zip": "02108", "type": "ZZ", "noi": None, "occ": None, "value": None,
             "nra": None, "dscr": None, "delinq": None},
        ]

        data = sec_absee_cmbs.aggregate(rows)

        self.assertEqual(data["02108"]["cmbs_props"], 3)
        self.assertEqual(data["02108"]["cmbs_occ_median"], 85.0)
        self.assertEqual(data["02108"]["cmbs_cap_rate"], 7.5)
        self.assertEqual(data["02108"]["cmbs_noi_psf_median"], 1.5)
        self.assertEqual(data["02108"]["cmbs_delinq_share"], 50.0)
        self.assertEqual(data["02108"]["cmbs_status_known"], 2)
        self.assertEqual(data["02108"]["cmbs_office_props"], 2)
        self.assertEqual(data["02108"]["cmbs_office_delinq"], 50.0)
        self.assertEqual(data["02108"]["cmbs_retail_props"], 0)
class BuildingPermitsTrailingTests(unittest.TestCase):
    def test_trailing_falls_back_to_ytd_arithmetic_and_drops_negative_areas(self):
        def row(value):
            return {key: value for key in _bps.KEYS}

        class MissingMonths:
            def get(self, flavor, year, month=None):
                if flavor == "c":
                    raise SourceUnavailable("monthly file unavailable")
                if flavor == "y" and year == 2025:
                    return {"good": row(20), "revised_down": row(1)}
                if flavor == "a":
                    return {"good": row(100), "revised_down": row(5)}
                return {"good": row(60), "revised_down": row(10)}

        data, via = _bps.trailing(MissingMonths(), 2025, 6)

        self.assertEqual(via, "year-to-date")
        self.assertEqual(data, {"good": row(60)})


class BuildingPermitsParserTests(unittest.TestCase):
    def test_cbsa_parse_filters_micropolitan_rows_and_reads_trailing_counts(self):
        values = ["0", "10", "0", "0", "20", "0", "0", "30", "0", "40", "50", "60"] + ["0"] * 12
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "cbsa2611c.txt"
            path.write_text(
                "202611,06,31080,2,Metro, With a comma," + ",".join(values) + "\n"
                + "202611,06,12345,5,Micropolitan," + ",".join(values) + "\n",
                encoding="latin-1",
            )

            data, label = _bps.parse(path, "cbsa")

        self.assertEqual(label, "2026-11")
        self.assertEqual(data, {"31080": {"u1": 10, "u24": 50, "u5": 50, "b5": 40, "v5": 60000}})


class CensusCountyPermitsTests(unittest.TestCase):
    def test_month_parser_uses_trailing_estimates_when_county_name_has_comma(self):
        estimates = ["0", "3", "101", "0", "5", "202", "0", "7", "303", "0", "11", "404"]
        reported = ["0"] * 12
        row = ["202501", "06", "001", "San Francisco, City", "x", "x", *estimates, *reported]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "county.txt"
            path.write_text(",".join(row) + "\n", encoding="latin-1")

            data, month = census_bps_county.parse_month(path)

        self.assertEqual(month, "2025-01")
        self.assertEqual(data, {
            "06001": {"units_1": 3, "units_2_4": 12, "units_5plus": 11, "value": 1010}
        })

    def test_trailing_months_sum_only_counties_present_in_every_file(self):
        months = [
            {
                "06001": {"units_1": 2, "units_2_4": 3, "units_5plus": 4, "value": 100},
                "06003": {"units_1": 20, "units_2_4": 30, "units_5plus": 40, "value": 1000},
            },
            {
                "06001": {"units_1": 5, "units_2_4": 6, "units_5plus": 7, "value": 200},
                "06005": {"units_1": 50, "units_2_4": 60, "units_5plus": 70, "value": 2000},
            },
        ]

        data, dropped = census_bps_county.combine(months)

        self.assertEqual(dropped, 2)
        self.assertEqual(data, {
            "06001": {
                "bps_units_12m": 27,
                "bps_units_1_12m": 7,
                "bps_units_2_4_12m": 9,
                "bps_units_5plus_12m": 11,
                "bps_value_12m": 300,
            }
        })


if __name__ == "__main__":
    unittest.main()
