"""Behavioral tests for FBI crime assignment and NFIP claim aggregation."""
import csv
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import fbi_cde_agency  # noqa: E402
import openfema_nfip_claims  # noqa: E402


class FbiAgencyTests(unittest.TestCase):
    def test_zip_uses_nearest_reporting_agency_per_rate_within_radius(self):
        zip_points = {
            "92629": (33.4672, -117.6981),
            "92630": (33.6500, -117.7500),
        }
        rated = {
            "ORI1": {"lat": 33.4672, "lon": -117.6981,
                     "fbi_violent_rate": 12.5, "fbi_property_rate": None},
            "ORI2": {"lat": 33.4722, "lon": -117.6981,
                     "fbi_violent_rate": 99.0, "fbi_property_rate": 24.0},
        }

        self.assertEqual(fbi_cde_agency.assign(zip_points, rated, max_km=1), {
            "92629": {"fbi_violent_rate": 12.5, "fbi_property_rate": 24.0},
        })

    def test_annual_rate_requires_all_months_and_sums_monthly_rates(self):
        monthly = {"%02d-2025" % month: "1.25" for month in range(1, 13)}
        body = {"offenses": {"rates": {"Example PD Offenses": monthly}}}

        self.assertEqual(fbi_cde_agency.annual_rate(body, "Example PD", 2025), 15.0)
        del monthly["12-2025"]
        self.assertIsNone(fbi_cde_agency.annual_rate(body, "Example PD", 2025))


class NfipClaimsTests(unittest.TestCase):
    def test_parse_aggregates_claims_payments_occupancy_and_peak_year_by_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "claims.csv"
            with path.open("w", newline="", encoding="utf8") as fh:
                writer = csv.DictWriter(fh, fieldnames=[
                    "reportedZipCode", "yearOfLoss", "occupancyType", "netBuildingPaymentAmount",
                    "netContentsPaymentAmount", "netIccPaymentAmount",
                ])
                writer.writeheader()
                writer.writerows([
                    {"reportedZipCode": "92629-1234", "yearOfLoss": "2020", "occupancyType": "4",
                     "netBuildingPaymentAmount": "100.26", "netContentsPaymentAmount": "50.25",
                     "netIccPaymentAmount": ""},
                    {"reportedZipCode": "92629", "yearOfLoss": "2021", "occupancyType": "17",
                     "netBuildingPaymentAmount": "0", "netContentsPaymentAmount": "0",
                     "netIccPaymentAmount": "0"},
                    {"reportedZipCode": "92629", "yearOfLoss": "2021", "occupancyType": "1",
                     "netBuildingPaymentAmount": "50", "netContentsPaymentAmount": "0",
                     "netIccPaymentAmount": "0"},
                    {"reportedZipCode": "bad", "yearOfLoss": "2022", "occupancyType": "6",
                     "netBuildingPaymentAmount": "99"},
                    {"reportedZipCode": "92629", "yearOfLoss": "unknown", "occupancyType": "6",
                     "netBuildingPaymentAmount": "99"},
                ])

            data, rows, as_of = openfema_nfip_claims.parse([path], min_rows=1)

        self.assertEqual((rows, as_of), (5, "2020-2022"))
        self.assertEqual(data, {
            "92629": {
                "nfip_claims_10y": 3,
                "nfip_claims_paid_10y": 2,
                "nfip_paid_10y": 201,
                "nfip_nonres_claims_10y": 2,
                "nfip_peak_year": 2021,
            },
        })


if __name__ == "__main__":
    unittest.main()
