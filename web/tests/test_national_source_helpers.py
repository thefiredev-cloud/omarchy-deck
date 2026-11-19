"""Behavioral tests for shared national source parsers."""
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import _bps  # noqa: E402
import _federal_layers as federal  # noqa: E402
import _xlsx  # noqa: E402


class BuildingPermitsTests(unittest.TestCase):
    def test_monthly_sum_keeps_only_geographies_present_in_every_file(self):
        first = {"06001": {key: 1 for key in _bps.KEYS}, "06003": {key: 2 for key in _bps.KEYS}}
        second = {"06001": {key: 3 for key in _bps.KEYS}, "06005": {key: 4 for key in _bps.KEYS}}

        self.assertEqual(_bps.sum_months([first, second]), {"06001": {key: 4 for key in _bps.KEYS}})

    def test_ytd_subtraction_drops_revised_negative_areas(self):
        current = {"06001": {key: 20 for key in _bps.KEYS}, "06003": {key: 1 for key in _bps.KEYS}}
        annual = {"06001": {key: 9 for key in _bps.KEYS}, "06003": {key: 2 for key in _bps.KEYS}}
        prior = {"06001": {key: 30 for key in _bps.KEYS}, "06003": {key: 1 for key in _bps.KEYS}}

        self.assertEqual(_bps.sum_ytd(current, annual, prior), {"06003": {key: 2 for key in _bps.KEYS}})


class FederalLayerTests(unittest.TestCase):
    def test_parse_day_accepts_publisher_formats_and_rejects_invalid_dates(self):
        self.assertEqual(str(federal.parse_day("31-MAY-41")), "2041-05-31")
        self.assertEqual(str(federal.parse_day("2026-11-12T00:00:00Z")), "2026-11-12")
        self.assertEqual(str(federal.parse_day("11/30/2030")), "2030-11-30")
        self.assertIsNone(federal.parse_day("31-FEB-2026"))

    def test_zip_of_prefers_record_zip_then_uses_point_lookup(self):
        locate = lambda lat, lon: "00999"
        self.assertEqual(federal.zip_of({"ZIP": "501-1234"}, ["ZIP"], locate), ("00501", "zip"))
        self.assertEqual(federal.zip_of({"ZIP": "00000", "LAT": 1, "LON": 2}, ["ZIP"], locate), ("00999", "point"))
        self.assertEqual(federal.zip_of({"ZIP": "00000", "LAT": 0, "LON": 2}, ["ZIP"], locate), (None, None))


class XlsxTests(unittest.TestCase):
    def test_rows_resolve_shared_inline_and_sparse_column_cells(self):
        main_ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        workbook = f'<workbook xmlns="{main_ns}"><sheets><sheet name="First"/><sheet name="Second"/></sheets></workbook>'
        shared = f'<sst xmlns="{main_ns}"><si><t>Shared value</t></si></sst>'
        sheet = f'''<worksheet xmlns="{main_ns}"><sheetData>
          <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Inline</t></is></c><c r="AA1"><v>42</v></c></row>
          <row r="2"><c r="B2" t="inlineStr"><is><t>Second row</t></is></c></row>
        </sheetData></worksheet>'''
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sample.xlsx"
            with zipfile.ZipFile(path, "w") as book:
                book.writestr("xl/workbook.xml", workbook)
                book.writestr("xl/sharedStrings.xml", shared)
                book.writestr("xl/worksheets/sheet1.xml", sheet)
                book.writestr("xl/worksheets/sheet2.xml", sheet)

            self.assertEqual(_xlsx.sheet_names(path), ["First", "Second"])
            self.assertEqual(list(_xlsx.read_xlsx_rows(path)), [
                ["Shared value", None, "Inline"] + [None] * 23 + ["42"],
                [None, "Second row"],
            ])
            self.assertEqual(list(_xlsx.read_xlsx_rows(path, 2))[0][0], "Shared value")


if __name__ == "__main__":
    unittest.main()
