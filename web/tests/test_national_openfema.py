"""Behavioral tests for shared OpenFEMA pagination."""
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import _openfema  # noqa: E402
from ctx import SourceUnavailable  # noqa: E402


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


class OpenFemaHelperTests(unittest.TestCase):
    def test_zip5_keeps_first_five_digits_of_zip_plus_four(self):
        self.assertEqual(_openfema.zip5("70458-3870"), "70458")
        self.assertEqual(_openfema.zip5("501"), "00501")
        self.assertIsNone(_openfema.zip5("ABCDE"))

    def test_url_percent_encodes_filter_and_omits_empty_filter_and_zero_skip(self):
        query = parse_qs(urlparse(_openfema.url("claims", "id,zip", "county eq 'A & B'", 2)).query)
        self.assertEqual(query["$filter"], ["county eq 'A & B'"])
        self.assertEqual(query["$select"], ["id,zip"])
        self.assertEqual(query["$top"], ["2"])
        self.assertNotIn("$skip", query)
        self.assertNotIn("$filter", parse_qs(urlparse(_openfema.url("claims", "id", "", 2)).query))
        skipped = parse_qs(urlparse(_openfema.url("claims", "id", "", 2, skip=4)).query)
        self.assertEqual(skipped["$skip"], ["4"])

    def test_count_and_last_id_reads_last_numeric_id_and_rejects_text_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            good, empty, bad = Path(tmp) / "good.csv", Path(tmp) / "empty.csv", Path(tmp) / "bad.csv"
            good.write_text("id,zip\n2,00001\n5,00002\n", encoding="utf-8")
            empty.write_text("id,zip\n", encoding="utf-8")
            bad.write_text("id,zip\n2,00001\nabc,00002\n", encoding="utf-8")
            self.assertEqual(_openfema.count_and_last_id(good), (2, 5))
            self.assertEqual(_openfema.count_and_last_id(empty), (0, 0))
            with self.assertRaises(SourceUnavailable):
                _openfema.count_and_last_id(bad)


class FlakyFetchContext:
    def __init__(self, failures):
        self.failures = list(failures)
        self.calls = 0
        self.logs = []

    def fetch(self, url, name, **kwargs):
        self.calls += 1
        if self.failures:
            raise self.failures.pop(0)
        return Path(name), {"status": "fetched"}

    def log(self, message):
        self.logs.append(message)


class OpenFemaRetryTests(unittest.TestCase):
    def test_fetch_retries_server_errors_with_doubling_delay(self):
        ctx = FlakyFetchContext([SourceUnavailable("HTTP 503"), SourceUnavailable("timed out")])
        with patch.object(_openfema.time, "sleep") as sleep:
            _, meta = _openfema._fetch(ctx, "https://example.test/page", "page.csv", 3600)
        self.assertEqual((ctx.calls, meta["status"]), (3, "fetched"))
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [15, 30])

    def test_fetch_gives_up_after_four_tries_and_never_retries_a_client_error(self):
        exhausted = FlakyFetchContext([SourceUnavailable("HTTP 503")] * 4)
        with patch.object(_openfema.time, "sleep") as sleep, self.assertRaises(SourceUnavailable):
            _openfema._fetch(exhausted, "https://example.test/page", "page.csv", 3600)
        self.assertEqual((exhausted.calls, sleep.call_count), (4, 3))

        refused = FlakyFetchContext([SourceUnavailable("HTTP 404 for page")])
        with patch.object(_openfema.time, "sleep") as sleep, self.assertRaises(SourceUnavailable):
            _openfema._fetch(refused, "https://example.test/page", "page.csv", 3600)
        self.assertEqual((refused.calls, sleep.call_count), (1, 0))


if __name__ == "__main__":
    unittest.main()
