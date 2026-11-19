"""Behavioral tests for feed loading: source block, staleness, malformed files, and freshness.

Every test writes its own feed files into a temp directory and points every feed name at it,
so results do not depend on what sits under the owner's real status root.
"""

from __future__ import annotations

import json
import os
import tempfile
import time
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

from deck_feeds_mcp import feeds


class FeedFileCase(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        patcher = patch.dict(feeds.FEEDS, {name: (self.root,) for name in feeds.ALLOWED_NAMES})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.now = time.time()

    def put(self, name: str, body: str | dict, mtime: float | None = None) -> Path:
        path = self.root / f"{name}.json"
        path.write_text(body if isinstance(body, str) else json.dumps(body), encoding="utf-8")
        if mtime is not None:
            os.utime(path, (mtime, mtime))
        return path


class SourceBlockTests(FeedFileCase):
    def test_epoch_t_sets_generated_at(self):
        epoch = 1_700_000_000
        self.put("jobs", {"t": epoch, "refresh": 3600})

        source = feeds.load("jobs")["source"]

        self.assertEqual(source["generated_at"], datetime.fromtimestamp(epoch, tz=UTC).isoformat(timespec="seconds"))

    def test_checked_at_iso_is_the_stamp_and_refresh_s_is_read(self):
        self.put("jobs", {"checked_at": "2026-11-08T09:30:00+00:00", "refresh_s": 600})

        source = feeds.load("jobs")["source"]

        self.assertEqual(source["generated_at"], "2026-11-08T09:30:00+00:00")
        self.assertEqual(source["refresh_s"], 600)

    def test_generated_at_iso_is_the_stamp_and_contract_timer_fills_refresh(self):
        self.put("life", {"generated_at": "2026-11-08T09:30:00+00:00"})

        source = feeds.load("life")["source"]

        self.assertEqual(source["generated_at"], "2026-11-08T09:30:00+00:00")
        self.assertEqual(source["refresh_s"], 86400)

    def test_unparseable_iso_stamp_falls_back_to_file_mtime(self):
        self.put("jobs", {"checked_at": "last tuesday"}, mtime=self.now - 900)

        source = feeds.load("jobs")["source"]

        self.assertIsNone(source["generated_at"])
        self.assertTrue(895 <= source["age_s"] <= 1000, source["age_s"])

    def test_boolean_refresh_is_ignored_and_contract_timer_used(self):
        self.put("outdoors", {"refresh": True, "generated_at": "2026-11-08T09:30:00+00:00"})

        self.assertEqual(feeds.load("outdoors")["source"]["refresh_s"], 7200)

    def test_feed_src_falls_back_to_sources_block(self):
        sources = [{"name": "example", "url": "https://example.test", "fetched_at": "2026-11-08T09:30:00+00:00"}]
        self.put("life", {"generated_at": "2026-11-08T09:30:00+00:00", "sources": sources})

        source = feeds.load("life")["source"]

        self.assertEqual(source["feed_src"], sources)
        self.assertEqual(source["feed_errors"], [])

    def test_non_object_json_is_refused_with_its_file(self):
        self.put("jobs", "[1, 2]")

        loaded = feeds.load("jobs")

        self.assertEqual(loaded["error"], "feed is not a JSON object")
        self.assertTrue(loaded["source"]["file"].endswith("jobs.json"))

    def test_malformed_json_reports_the_parse_error(self):
        self.put("jobs", "{not json")

        loaded = feeds.load("jobs")

        self.assertIn("JSONDecodeError", loaded["error"])
        self.assertTrue(loaded["source"]["file"].endswith("jobs.json"))


class StalenessTests(FeedFileCase):
    def test_stale_only_after_three_refresh_periods(self):
        self.put("jobs", {"t": self.now - 10_000, "refresh": 3600})
        self.assertFalse(feeds.load("jobs")["source"]["stale"])

        self.put("jobs", {"t": self.now - 20_000, "refresh": 3600})
        self.assertTrue(feeds.load("jobs")["source"]["stale"])

    def test_five_minute_floor_applies_to_fast_refresh(self):
        self.put("jobs", {"t": self.now - 200, "refresh": 60})
        self.assertFalse(feeds.load("jobs")["source"]["stale"])

        self.put("jobs", {"t": self.now - 1000, "refresh": 60})
        self.assertTrue(feeds.load("jobs")["source"]["stale"])

    def test_feed_without_any_refresh_is_never_stale(self):
        self.put("stalls", {"t": self.now - 10_000_000})

        source = feeds.load("stalls")["source"]

        self.assertIsNone(source["refresh_s"])
        self.assertFalse(source["stale"])


class FreshnessTests(FeedFileCase):
    def test_stale_feed_is_listed_and_absent_feed_is_missing(self):
        self.put("jobs", {"t": self.now - 20_000, "refresh": 3600})

        report = feeds.freshness()

        self.assertIn("jobs", report["stale"])
        self.assertIn("surf", report["missing"])

    def test_non_object_feed_is_reported_unreadable_instead_of_raising(self):
        self.put("jobs", "[1, 2]")

        report = feeds.freshness()

        row = next(row for row in report["feeds"] if row["feed"] == "jobs")
        self.assertTrue(row["present"])
        self.assertIn("not a JSON object", row["unreadable"])
        self.assertNotIn("jobs", report["stale"])


if __name__ == "__main__":
    unittest.main()
