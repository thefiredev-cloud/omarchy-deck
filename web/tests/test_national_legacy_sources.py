"""Behavioral tests for wrapped legacy national sources."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import _legacy  # noqa: E402



class SafmrCandidatesTests(unittest.TestCase):
    def test_index_candidates_prefer_newest_revised_metro_workbooks(self):
        page = """
        <a href="/portal/datasets/fmr/fmr2025/FY25_safmrs.xlsx">base</a>
        <a href="/portal/datasets/fmr/fmr2025/FY25_safmrs_rev.xlsx">revision</a>
        <a href="/portal/datasets/fmr/fmr2026/FY26_safmrs.xlsx">newer</a>
        <a href="/portal/datasets/fmr/fmr2025/FY25_nonmetro_safmrs.xlsx">nonmetro</a>
        <a href="/portal/datasets/fmr/fmr2027/FY27_hypothetical_safmrs.xlsx">hypothetical</a>
        <a href="/portal/datasets/fmr/fmr2027/FY27_selection_safmrs.xlsx">selection</a>
        """
        with tempfile.TemporaryDirectory() as tmp:
            index = Path(tmp) / "index.html"
            index.write_text(page, encoding="utf8")
            class Context:
                def fetch(self, *args, **kwargs):
                    return str(index), {}

            candidates = _legacy._safmr_candidates(Context())

        self.assertEqual(candidates, [
            "https://www.huduser.gov/portal/datasets/fmr/fmr2026/FY26_safmrs.xlsx",
            "https://www.huduser.gov/portal/datasets/fmr/fmr2025/FY25_safmrs_rev.xlsx",
            "https://www.huduser.gov/portal/datasets/fmr/fmr2025/FY25_safmrs.xlsx",
        ])

    def test_unavailable_index_falls_back_to_current_and_prior_fiscal_years(self):
        class Context:
            def fetch(self, *args, **kwargs):
                from ctx import SourceUnavailable
                raise SourceUnavailable("index unavailable")

        with patch.object(_legacy, "YEAR", 2027):
            candidates = _legacy._safmr_candidates(Context())

        self.assertEqual(candidates, [
            "https://www.huduser.gov/portal/datasets/fmr/fmr2028/FY28_safmrs.xlsx",
            "https://www.huduser.gov/portal/datasets/fmr/fmr2027/FY27_safmrs.xlsx",
        ])


class ChrDataYearsTests(unittest.TestCase):
    def test_reads_homicide_data_years_from_measures_text(self):
        class Context:
            def fetch(self, *args, **kwargs):
                return "/unused/chr_measures.pdf", {}

        with patch.object(
            _legacy.subprocess,
            "run",
            return_value=Mock(stdout="Homicides* 2017-2023\n"),
        ):
            years = _legacy._chr_data_years(Context(), 2025)

        self.assertEqual(years, "2017-2023")

    def test_returns_none_when_measures_text_has_no_homicide_years(self):
        class Context:
            def fetch(self, *args, **kwargs):
                return "/unused/chr_measures.pdf", {}

        with patch.object(
            _legacy.subprocess,
            "run",
            return_value=Mock(stdout="Measures\nHomicides* Not reported\n"),
        ):
            years = _legacy._chr_data_years(Context(), 2025)

        self.assertIsNone(years)


if __name__ == "__main__":
    unittest.main()
