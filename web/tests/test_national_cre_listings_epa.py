"""Behavioral coverage for commercial listings and EPA FRS ZIP sources."""
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import cre_listings_zip  # noqa: E402
import epa_frs_zip  # noqa: E402
from ctx import SourceUnavailable  # noqa: E402


class CommercialListingsTests(unittest.TestCase):
    def test_parse_aggregates_valid_sale_and_lease_metrics_per_zip(self):
        data = cre_listings_zip.parse(
            [
                {"zip": "926", "price": 100000, "sqft": 1000, "cap_rate": 6, "type": "Office"},
                {"zip": "00926-1234", "price": 300000, "sqft": 100, "cap_rate": 40,
                 "type": "retail"},
                {"addr": "1 Main St, Somewhere, CA 92629", "price": 500000, "sqft": 1000,
                 "cap_rate": 8, "type": "retail"},
                {"zip": "bad", "price": 900000, "sqft": 1000, "cap_rate": 7},
            ],
            [
                {"zip": "926", "rent_psf_yr": 24},
                {"zip": "92629", "rent_psf_yr": 600},
            ],
        )
        self.assertEqual(data["00926"], {
            "com_listings": 2,
            "com_median_price": 200000,
            "com_median_cap": 6,
            "crel_cap_n": 1,
            "crel_sale_psf": 100,
            "crel_lease_psf_yr": 24,
            "crel_lease_listings": 1,
            "crel_cap_office": 6,
            "crel_cap_retail": None,
            "crel_cap_industrial": None,
            "crel_cap_multifamily": None,
        })
        self.assertEqual(data["92629"]["com_listings"], 1)
        self.assertIsNone(data["92629"]["crel_lease_psf_yr"])


class EpaFrsTests(unittest.TestCase):
    def test_parse_counts_programs_normalizes_zips_and_uses_newest_valid_date(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "facilities.csv"
            path.write_text(
                '"POSTAL_CODE","PGM_SYS_ACRNMS","UPDATE_DATE"\n'
                '"92629","ACRES: brownfield","11-SEP-25"\n'
                '"92629-1234","TRIS: reporter","02-JAN-26"\n'
                '"123456789","ACRES: brownfield, TRIS: reporter","invalid"\n'
                '"1234","TRIS: malformed zip","12-DEC-25"\n',
                encoding="latin-1",
            )

            data, rows, as_of = epa_frs_zip.parse(path)

        self.assertEqual(rows, 4)
        self.assertEqual(as_of, "2026-01-02")
        self.assertEqual(data, {
            "92629": {"epa_facilities": 2, "epa_brownfields": 1, "epa_tri_sites": 1},
            "12345": {"epa_facilities": 1, "epa_brownfields": 1, "epa_tri_sites": 1},
        })


    def test_parse_rejects_facility_file_without_required_columns(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "facilities.csv"
            path.write_text('"POSTAL_CODE","UPDATE_DATE"\n"92629","11-SEP-25"\n', encoding="latin-1")

            with self.assertRaisesRegex(SourceUnavailable, "header changed"):
                epa_frs_zip.parse(path)


if __name__ == "__main__":
    unittest.main()
