"""Behavioral coverage for SEC ABS-EE submission parsing."""
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import sec_absee_cmbs  # noqa: E402


class SecCmbsSubmissionTests(unittest.TestCase):
    def test_nested_properties_normalize_zip_and_parse_reported_metrics(self):
        submission = """ABS ASSET CLASS: Commercial mortgages
CONFORMED PERIOD OF REPORT: 20250930
COMPANY CONFORMED NAME: Example Trust
<assetData>
  <asset>
    <paymentStatusLoanCode>1</paymentStatusLoanCode>
    <property>
      <propertyZip>1234-0000</propertyZip>
      <propertyTypeCode>OF</propertyTypeCode>
      <mostRecentNetOperatingIncomeAmount>1000</mostRecentNetOperatingIncomeAmount>
      <mostRecentFinancialsStartDate>01-01-2025</mostRecentFinancialsStartDate>
      <mostRecentFinancialsEndDate>06-30-2025</mostRecentFinancialsEndDate>
      <mostRecentPhysicalOccupancyPercentage>0.85</mostRecentPhysicalOccupancyPercentage>
      <mostRecentValuationAmount>20000</mostRecentValuationAmount>
      <netRentableSquareFeetNumber>5000</netRentableSquareFeetNumber>
      <mostRecentDebtServiceCoverageNetOperatingIncomePercentage>1.25</mostRecentDebtServiceCoverageNetOperatingIncomePercentage>
    </property>
    <property>
      <propertyZip>123</propertyZip>
    </property>
  </asset>
  <asset>
    <paymentStatusLoanCode>0</paymentStatusLoanCode>
    <property>
      <propertyZip>02108</propertyZip>
      <propertyTypeCode>RT</propertyTypeCode>
      <netOperatingIncomeSecuritizationAmount>500</netOperatingIncomeSecuritizationAmount>
      <physicalOccupancySecuritizationPercentage>75</physicalOccupancySecuritizationPercentage>
      <valuationSecuritizationAmount>10000</valuationSecuritizationAmount>
      <netRentableSquareFeetSecuritizationNumber>2500</netRentableSquareFeetSecuritizationNumber>
      <debtServiceCoverageNetOperatingIncomeSecuritizationPercentage>1.5</debtServiceCoverageNetOperatingIncomeSecuritizationPercentage>
    </property>
  </asset>
  <asset>
    <propertyZip>123</propertyZip>
  </asset>
</assetData>"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "submission.txt"
            path.write_text(submission, encoding="utf8")

            header, rows = sec_absee_cmbs.parse_submission(str(path))

        self.assertEqual(header, {
            "asset_class": "Commercial mortgages",
            "period": "20250930",
            "name": "Example Trust",
        })
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["zip"], "01234")
        self.assertEqual(rows[0]["type"], "OF")
        self.assertAlmostEqual(rows[0]["noi"], 1000 * 365 / 181)
        self.assertEqual(rows[0]["occ"], 85)
        self.assertEqual(rows[0]["value"], 20000)
        self.assertEqual(rows[0]["nra"], 5000)
        self.assertEqual(rows[0]["dscr"], 1.25)
        self.assertTrue(rows[0]["delinq"])
        self.assertEqual(rows[1]["zip"], "02108")
        self.assertEqual(rows[1]["noi"], 500)
        self.assertEqual(rows[1]["occ"], 75)
        self.assertFalse(rows[1]["delinq"])


if __name__ == "__main__":
    unittest.main()
