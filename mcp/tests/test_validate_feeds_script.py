"""Behavior tests for the validate_feeds CLI."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "validate_feeds.py"
SPEC = importlib.util.spec_from_file_location("validate_feeds", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
validate_feeds = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validate_feeds)


class ValidateFeedsScriptTests(unittest.TestCase):
    def test_json_mode_reports_each_requested_feed_without_claiming_validation(self):
        jobs = {"ok": False, "error": "missing jobs feed"}
        output = io.StringIO()
        with patch.dict(validate_feeds.CHECKS, {"jobs": lambda: jobs}), contextlib.redirect_stdout(output):
            status = validate_feeds.main(["--json", "jobs"])

        self.assertEqual(status, 0)
        self.assertEqual(json.loads(output.getvalue()), {"jobs": jobs})

    def test_text_mode_returns_failure_when_any_requested_feed_fails(self):
        failed = {"ok": False, "error": "missing jobs feed"}
        output = io.StringIO()
        with patch.dict(validate_feeds.CHECKS, {"jobs": lambda: failed}), contextlib.redirect_stdout(output):
            status = validate_feeds.main(["jobs"])

        self.assertEqual(status, 1)
        self.assertIn("jobs: FAILED", output.getvalue())
        self.assertIn("contract does not hold", output.getvalue())

    def test_unknown_feed_is_rejected_before_reporting(self):
        errors = io.StringIO()
        with patch.object(validate_feeds, "report", side_effect=AssertionError("must not report")), contextlib.redirect_stderr(errors):
            status = validate_feeds.main(["not-a-feed"])

        self.assertEqual(status, 2)
        self.assertIn("unknown feed(s): not-a-feed", errors.getvalue())


    def test_text_mode_reports_successful_feed_measurements_and_checks(self):
        jobs = {
            "ok": True,
            "source": {"file": "/feeds/jobs.json", "generated_at": "2026-11-09T20:00:00Z",
                       "age_s": 60, "stale": False},
            "rows": 2,
            "categories": {"operations": 2},
            "metros": {"oc": 2},
            "remote_pay_violations": 0,
            "checks": [{"ok": True, "check": "rows", "detail": "2 rows"}],
        }
        output = io.StringIO()
        with patch.dict(validate_feeds.CHECKS, {"jobs": lambda: jobs}), contextlib.redirect_stdout(output):
            status = validate_feeds.main(["jobs"])

        self.assertEqual(status, 0)
        self.assertIn("jobs: ok", output.getvalue())
        self.assertIn("rows 2 · categories operations=2", output.getvalue())
        self.assertIn("[PASS] rows: 2 rows", output.getvalue())
        self.assertIn("contract holds", output.getvalue())

    def test_text_mode_reports_interest_profile_measurements(self):
        profile = {
            "ok": True,
            "source": {"file": "/feeds/interest-profile.json", "generated_at": "2026-11-09T20:00:00Z",
                       "age_s": 5, "stale": False},
            "keys": ["interests", "job_targets"],
            "interests": 7,
            "job_targets": 3,
            "pending": 1,
            "checks": [{"ok": True, "check": "keys", "detail": "2 keys"}],
        }
        output = io.StringIO()
        with patch.dict(validate_feeds.CHECKS, {"interest-profile": lambda: profile}), contextlib.redirect_stdout(output):
            status = validate_feeds.main(["interest-profile"])

        self.assertEqual(status, 0)
        text = output.getvalue()
        self.assertIn("interest-profile: ok", text)
        self.assertIn("keys interests, job_targets", text)
        self.assertIn("interests 7 · job_targets 3 · pending 1", text)
        self.assertIn("contract holds", text)

    def test_text_mode_reports_launch_kinds_sorted_by_name(self):
        launch = {
            "ok": True,
            "keys": ["items"],
            "items": 5,
            "kinds": {"update": 2, "announcement": 3},
            "checks": [],
        }
        output = io.StringIO()
        with patch.dict(validate_feeds.CHECKS, {"launch": lambda: launch}), contextlib.redirect_stdout(output):
            status = validate_feeds.main(["launch"])

        self.assertEqual(status, 0)
        self.assertIn("items 5 · kinds announcement=3, update=2", output.getvalue())

    def test_failed_check_is_marked_and_one_failed_feed_fails_the_whole_run(self):
        launch = {"ok": True, "keys": [], "items": 0, "kinds": {}, "checks": []}
        jobs = {
            "ok": False,
            "rows": 1,
            "categories": {},
            "metros": {},
            "remote_pay_violations": 2,
            "checks": [{"ok": False, "check": "remote-pay", "detail": "2 violations"}],
        }
        output = io.StringIO()
        checks = {"jobs": lambda: jobs, "launch": lambda: launch}
        with patch.dict(validate_feeds.CHECKS, checks, clear=True), contextlib.redirect_stdout(output):
            status = validate_feeds.main([])

        self.assertEqual(status, 1)
        text = output.getvalue()
        self.assertIn("jobs: FAILED", text)
        self.assertIn("launch: ok", text)
        self.assertIn("remote-pay violations 2", text)
        self.assertIn("[FAIL] remote-pay: 2 violations", text)
        self.assertIn("contract does not hold", text)

    def test_error_report_stops_before_reading_feed_measurements(self):
        failed = {"ok": False, "error": "feed file missing", "source": {"file": "/feeds/jobs.json"}}
        output = io.StringIO()
        with patch.dict(validate_feeds.CHECKS, {"jobs": lambda: failed}), contextlib.redirect_stdout(output):
            status = validate_feeds.main(["jobs"])

        self.assertEqual(status, 1)
        self.assertIn("error: feed file missing", output.getvalue())
        self.assertNotIn("rows", output.getvalue())

if __name__ == "__main__":
    unittest.main()
