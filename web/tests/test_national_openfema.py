"""Behavioral tests for shared OpenFEMA pagination."""
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import _openfema  # noqa: E402


class Context:
    def __init__(self, directory, pages):
        self.directory = Path(directory)
        self.pages = iter(pages)
        self.calls = []

    def fetch(self, url, name, **kwargs):
        self.calls.append((url, name, kwargs))
        content = next(self.pages)
        path = self.directory / name
        path.write_text(content, encoding="utf-8")
        return path, {"status": "cached"}


class OpenFemaPaginationTests(unittest.TestCase):
    def test_keyset_pages_advance_from_last_id_and_stop_on_short_page(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = Context(tmp, [
                "id,zip\n2,00001\n5,00002\n",
                "id,zip\n8,00003\n11,00004\n",
                "id,zip\n20,00005\n",
            ])

            pages = list(_openfema.keyset_pages(
                ctx, "claims", "id,zip", "state eq 06", "claims", 2, 3600, pause=0
            ))

        self.assertEqual([Path(page).name for page in pages], [
            "claims_after_0.csv", "claims_after_5.csv", "claims_after_11.csv"
        ])
        filters = [parse_qs(urlparse(call[0]).query)["$filter"][0] for call in ctx.calls]
        self.assertEqual(filters, [
            "state eq 06 and id gt 0",
            "state eq 06 and id gt 5",
            "state eq 06 and id gt 11",
        ])
        self.assertTrue(all(call[2]["min_age"] == 3600 for call in ctx.calls))

    def test_skip_pages_advance_by_page_size_and_yield_only_nonempty_pages(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = Context(tmp, [
                "id,zip\n1,00001\n2,00002\n",
                "id,zip\n3,00003\n",
            ])

            pages = list(_openfema.skip_pages(
                ctx, "claims", "id,zip", "state eq 06", "id", "claims", 2, 3600, pause=0
            ))

        self.assertEqual([Path(page).name for page in pages], [
            "claims_skip_0.csv", "claims_skip_2.csv"
        ])
        skips = [parse_qs(urlparse(call[0]).query).get("$skip") for call in ctx.calls]
        self.assertEqual(skips, [None, ["2"]])


if __name__ == "__main__":
    unittest.main()
