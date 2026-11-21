"""Behavioral tests for shared national source parsers."""
import datetime
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import _bps  # noqa: E402
import _federal_layers as federal  # noqa: E402
import _xlsx  # noqa: E402
import _cbsa_names as cbsa  # noqa: E402
import _counties as counties  # noqa: E402
import _hvs as hvs  # noqa: E402
import _fha_bf90 as fha  # noqa: E402
from ctx import SourceUnavailable  # noqa: E402


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


SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
FHA_HEADER = ["HUD PROJECT NUMBER", "PROPERTY ZIP", "UNITS", "INITIAL ENDORSEMENT DATE", "ORIGINAL MORTGAGE AMOUNT",
              "MATURITY DATE", "AMORITIZED PRINCIPAL BALANCE", "SECTION OF ACT CODE", "BUSINESS_TYPE"]
CBSAS = {
    "31100": {"title": "Los Angeles-Long Beach-Anaheim, CA", "kind": "metro", "states": ["CA"]},
    "11700": {"title": "Aberdeen, SD", "kind": "micro", "states": ["SD"]},
    "16740": {"title": "Charlotte-Concord-Gastonia, NC-SC", "kind": "metro", "states": ["NC", "SC"]},
    "16700": {"title": "Charleston-North Charleston, SC", "kind": "metro", "states": ["SC"]},
    "90001": {"title": "Fairfield, OH", "kind": "micro", "states": ["OH"]},
    "90002": {"title": "Fairfield-Hamilton, OH", "kind": "metro", "states": ["OH"]},
}


def write_xlsx(path, rows):
    """One-sheet workbook. None leaves a cell empty; every other value is an inline string."""
    body = []
    for r, row in enumerate(rows, 1):
        cells = "".join('<c r="%s%d" t="inlineStr"><is><t>%s</t></is></c>' % (chr(65 + c), r, escape(v))
                        for c, v in enumerate(row) if v is not None)
        body.append('<row r="%d">%s</row>' % (r, cells))
    sheet = '<worksheet xmlns="%s"><sheetData>%s</sheetData></worksheet>' % (SHEET_NS, "".join(body))
    workbook = '<workbook xmlns="%s"><sheets><sheet name="Sheet1"/></sheets></workbook>' % SHEET_NS
    with zipfile.ZipFile(path, "w") as book:
        book.writestr("xl/workbook.xml", workbook)
        book.writestr("xl/worksheets/sheet1.xml", sheet)


def write_gazetteer(path, rows, header="USPS|GEOID|NAME"):
    text = "\n".join([header] + ["|".join(row) for row in rows]) + "\n"
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("Gaz_counties_national.txt", text.encode("latin-1"))


class CountyTests(unittest.TestCase):
    def test_norm_drops_type_words_but_keeps_independent_city_names_apart(self):
        self.assertEqual(counties.norm("St. Louis County"), "st louis")
        self.assertEqual(counties.norm("Anchorage Municipality"), "anchorage")
        self.assertEqual(counties.norm("Baltimore city"), "baltimore city")

    def test_by_state_name_keys_each_county_by_state_and_normalized_name(self):
        found = counties.by_state_name({
            "24005": {"state": "MD", "name": "Baltimore County", "key": counties.norm("Baltimore County")},
            "24510": {"state": "MD", "name": "Baltimore city", "key": counties.norm("Baltimore city")},
        })
        self.assertEqual(found, {("MD", "baltimore"): "24005", ("MD", "baltimore city"): "24510"})

    def test_parse_keeps_five_digit_fips_rows_and_decodes_latin1_names(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "gaz.zip"
            write_gazetteer(path, [
                ["CA", "06059", "Orange County"],
                ["NM", "35013", "Doña Ana County"],
                ["CA", "6059", "Four Digit County"],
                ["CA", "06xx9", "Letters County"],
                ["CA"],
            ])
            found = counties.parse(path, min_rows=2)
        self.assertEqual(set(found), {"06059", "35013"})
        self.assertEqual(found["06059"], {"state": "CA", "name": "Orange County", "key": "orange"})
        self.assertEqual(found["35013"]["name"], "Doña Ana County")

    def test_parse_fails_closed_on_unexpected_columns_or_too_few_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "gaz.zip"
            write_gazetteer(path, [["CA", "06059", "Orange County"]], header="USPS|GEOID|LABEL")
            with self.assertRaisesRegex(SourceUnavailable, "unexpected columns"):
                counties.parse(path)
            write_gazetteer(path, [["CA", "06059", "Orange County"]])
            with self.assertRaisesRegex(SourceUnavailable, "has 1 rows"):
                counties.parse(path, min_rows=3)


class CbsaNameTests(unittest.TestCase):
    def setUp(self):
        self.idx = cbsa.index(CBSAS)

    def test_city_and_state_resolve_to_the_area_that_names_them(self):
        self.assertEqual(cbsa.match(self.idx, CBSAS, "Los Angeles, CA"), "31100")
        self.assertEqual(cbsa.match(self.idx, CBSAS, "Long Beach, CA"), "31100")
        self.assertEqual(cbsa.match(self.idx, CBSAS, "Charlotte, SC"), "16740")
        self.assertEqual(cbsa.match(self.idx, CBSAS, "Charleston, SC"), "16700")

    def test_state_column_fills_in_when_the_name_has_no_state(self):
        self.assertEqual(cbsa.match(self.idx, CBSAS, "Los Angeles", "CA"), "31100")

    def test_same_city_in_two_areas_prefers_the_metropolitan_one(self):
        self.assertEqual(cbsa.match(self.idx, CBSAS, "Fairfield, OH"), "90002")

    def test_unknown_city_or_wrong_state_returns_none(self):
        self.assertIsNone(cbsa.match(self.idx, CBSAS, "Springfield, IL"))
        self.assertIsNone(cbsa.match(self.idx, CBSAS, "Los Angeles, TX"))
        self.assertIsNone(cbsa.match(self.idx, CBSAS, ""))

    def test_resolver_gives_each_area_to_the_first_region_that_asks(self):
        resolve, memo = cbsa.resolver(CBSAS)
        self.assertEqual(resolve("Los Angeles, CA"), "31100")
        self.assertIsNone(resolve("Long Beach, CA"))
        self.assertEqual(memo[("Los Angeles, CA", "")], "31100")

    def test_parse_reads_delineation_rows_and_drops_duplicates_and_bad_codes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "list1.xlsx"
            write_xlsx(path, [
                ["CBSA Code", "CBSA Title", "Metropolitan/Micropolitan Statistical Area"],
                ["31100", "Los Angeles-Long Beach-Anaheim, CA", "Metropolitan Statistical Area"],
                ["31100", "Repeated, CA", "Metropolitan Statistical Area"],
                ["1234", "Four Digits, CA", "Metropolitan Statistical Area"],
                ["11700", "Aberdeen, SD", "Micropolitan Statistical Area"],
                ["16740", "Charlotte-Concord-Gastonia, NC-SC", "Metropolitan Statistical Area"],
            ])
            found = cbsa.parse(path, min_cbsas=1)
        self.assertEqual(found, {
            "31100": {"title": "Los Angeles-Long Beach-Anaheim, CA", "kind": "metro", "states": ["CA"]},
            "11700": {"title": "Aberdeen, SD", "kind": "micro", "states": ["SD"]},
            "16740": {"title": "Charlotte-Concord-Gastonia, NC-SC", "kind": "metro", "states": ["NC", "SC"]},
        })

    def test_parse_refuses_a_list_below_the_expected_size(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "list1.xlsx"
            write_xlsx(path, [["CBSA Code", "CBSA Title"], ["11700", "Aberdeen, SD"]])
            with self.assertRaisesRegex(SourceUnavailable, "parsed to 1 areas"):
                cbsa.parse(path)




class HousingVacancySurveyTests(unittest.TestCase):
    def test_parse_table_returns_latest_state_values_and_annual_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "hvs.xlsx"
            write_xlsx(path, [
                ["State", "First Quarter 2023", "Fourth Quarter 2023", "First Quarter 2024", "Fourth Quarter 2024"],
                ["California", "4.1", "4.2", "4.3", "4.4"],
                ["New York", "5.1", None, "5.3", "5.4"],
            ])

            result, history, latest = hvs.parse_table(path, "hvs_rental_vacancy", "state", history=True)

        self.assertEqual(latest, "2024Q4")
        self.assertEqual(result, {"CA": {"hvs_rental_vacancy": 4.4}, "NY": {"hvs_rental_vacancy": 5.4}})
        self.assertEqual(history, {
            "CA": {"hvs_rental_vacancy": [["2023Q4", 4.2], ["2024Q4", 4.4]]},
            "NY": {"hvs_rental_vacancy": [["2024Q4", 5.4]]},
        })

    def test_parse_table_rejects_workbooks_without_usable_observations(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "hvs.xlsx"
            write_xlsx(path, [["First Quarter 2024"], ["Not a state", "7.1"]])

            with self.assertRaisesRegex(SourceUnavailable, "no usable state observations"):
                hvs.parse_table(path, "hvs_rental_vacancy", "state")


class InsuredMultifamilyTests(unittest.TestCase):
    def test_excel_day_reads_serials_and_rejects_blank_or_nonpositive_values(self):
        self.assertEqual(fha.excel_day("46295.0"), datetime.date(2026, 9, 30))
        for value in ("", "0", "-3", "n/a"):
            self.assertIsNone(fha.excel_day(value))

    def test_loans_normalise_cells_and_keep_sparse_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bf90.xlsx"
            write_xlsx(path, [
                ["FHA-BF90 Active Loans"],
                FHA_HEADER,
                ["014-35001", "501-1234", "120", "46295", "1,234,567.4", "47000", "1000", "221(d)(4)", "MF Residential"],
                ["014-35002", None, "0", None, None, None, None, None, "MF Healthcare"],
                [None, "501-9999", "5", "46295", "100", "47000", "100", "221(d)(4)", "MF Residential"],
            ])
            rows = fha.loans(path)
        self.assertEqual(rows, [
            {"number": "014-35001", "zip": "00501", "units": 120, "ie": datetime.date(2026, 9, 30),
             "amount": 1234567, "maturity": datetime.date(2028, 9, 4), "upb": 1000, "soa": "221(D)(4)",
             "business": "MF Residential"},
            {"number": "014-35002", "zip": None, "units": None, "ie": None, "amount": None, "maturity": None,
             "upb": None, "soa": "", "business": "MF Healthcare"},
        ])

    def test_loans_leave_upb_empty_when_the_terminated_file_has_no_balance_column(self):
        header = [col for col in FHA_HEADER if col != "AMORITIZED PRINCIPAL BALANCE"]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bf90_t.xlsx"
            write_xlsx(path, [header, ["014-35003", "501-1234", "24", "46295", "500", "47000", "221(d)(4)", "MF Residential"]])
            rows = fha.loans(path)
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]["upb"])
        self.assertEqual(rows[0]["units"], 24)

    def test_loans_refuse_a_file_missing_a_required_column(self):
        header = [col for col in FHA_HEADER if col != "BUSINESS_TYPE"]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bf90.xlsx"
            write_xlsx(path, [header, ["014-35001", "501-1234", "120", "46295", "100", "47000", "100", "221(d)(4)"]])
            with self.assertRaisesRegex(SourceUnavailable, "BUSINESS_TYPE"):
                fha.loans(path)

    def test_loans_refuse_a_file_without_a_project_header(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bf90.xlsx"
            write_xlsx(path, [["Title only"], ["014-35001", "501-1234"]])
            with self.assertRaisesRegex(SourceUnavailable, "no HUD PROJECT NUMBER header"):
                fha.loans(path)

    def test_latest_endorsement_is_the_newest_dated_row(self):
        rows = [{"ie": datetime.date(2026, 9, 30)}, {"ie": None}, {"ie": datetime.date(2026, 10, 31)}]
        self.assertEqual(fha.latest_endorsement(rows), datetime.date(2026, 10, 31))
        with self.assertRaisesRegex(SourceUnavailable, "no endorsement dates"):
            fha.latest_endorsement([{"ie": None}])


if __name__ == "__main__":
    unittest.main()
