"""Behavior tests for scripts/gen_taxonomy_contract.py.

Each test builds a fake collector directory (deck_jobs_taxonomy.py plus deck-feed-jobs) in a temp dir
and points the script's ROOT and CONTRACT at temp paths, so the repo contract is never touched.
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "gen_taxonomy_contract.py"
SPEC = importlib.util.spec_from_file_location("gen_taxonomy_contract", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
gen = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gen)

COLLECTOR_TAXONOMY = '''
import re

SOUTH_OC = ["Huntington Beach"]
OC = ["Irvine"]
LA = ["Long Beach"]
SD = ["San Diego"]
TAXONOMY = {"ops": {"label": "Operations"}}
DEFAULT_SUB = {"ops": "general"}
TITLE_DROP = re.compile(r"intern")
MATCH = [("ops", "dispatch", 3, r"dispatch")]
CONTEXT = {"remote": (2, r"remote")}
_FOREIGN = re.compile(r"visa")
_US_OK = re.compile(r"us only")
'''


class TaxonomyScriptTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.bin_dir = self.root / "bin"
        self.bin_dir.mkdir()
        (self.bin_dir / "deck_jobs_taxonomy.py").write_text(COLLECTOR_TAXONOMY, encoding="utf-8")
        self.contract = self.root / "deck_feeds_mcp" / "taxonomy_contract.json"
        self.contract.parent.mkdir()
        for active in (patch.object(gen, "ROOT", self.root), patch.object(gen, "CONTRACT", self.contract)):
            active.start()
            self.addCleanup(active.stop)

    def run_main(self, *args: str) -> tuple[int, str]:
        output = io.StringIO()
        with patch.object(sys, "argv", ["gen_taxonomy_contract.py", *args]), contextlib.redirect_stdout(output):
            status = gen.main()
        return status, output.getvalue()

    def write_collector_min_pay(self, text: str) -> None:
        (self.bin_dir / "deck-feed-jobs").write_text(text, encoding="utf-8")

    def test_remote_min_pay_uses_collector_constant_over_current_contract(self):
        self.write_collector_min_pay("import x\nMIN_PAY_REMOTE = 120000\n")

        pay = gen.remote_min_pay(self.bin_dir, {"rules": {"remote_min_pay": 90000}})

        self.assertEqual(pay, 120000)

    def test_remote_min_pay_keeps_current_contract_value_when_constant_absent(self):
        self.write_collector_min_pay("MIN_PAY_OTHER = 5\n")

        pay = gen.remote_min_pay(self.bin_dir, {"rules": {"remote_min_pay": 90000}})

        self.assertEqual(pay, 90000)

    def test_remote_min_pay_keeps_current_contract_value_when_collector_file_missing(self):
        pay = gen.remote_min_pay(self.bin_dir, {"rules": {"remote_min_pay": 90000}})

        self.assertEqual(pay, 90000)

    def test_remote_min_pay_falls_back_to_100000_without_any_source(self):
        pay = gen.remote_min_pay(self.bin_dir, {})

        self.assertEqual(pay, 100000)

    def test_check_flag_reports_stale_contract_and_leaves_file_unchanged(self):
        self.contract.write_text("{}\n", encoding="utf-8")

        status, output = self.run_main("--check", "--bin", str(self.bin_dir))

        self.assertEqual(status, 1)
        self.assertIn("is stale", output)
        self.assertEqual(self.contract.read_text(encoding="utf-8"), "{}\n")

    def test_write_mode_regenerates_contract_from_collector_and_check_then_passes(self):
        self.write_collector_min_pay("MIN_PAY_REMOTE = 120000\n")

        written, _ = self.run_main("--bin", str(self.bin_dir))
        written_contract = json.loads(self.contract.read_text(encoding="utf-8"))
        checked, output = self.run_main("--check", "--bin", str(self.bin_dir))

        self.assertEqual(written, 0)
        self.assertEqual(written_contract["rules"]["remote_min_pay"], 120000)
        self.assertEqual(written_contract["metros"]["la"], ["Long Beach"])
        self.assertEqual(
            written_contract["keyword_rules"],
            [{"category": "ops", "subcategory": "dispatch", "weight": 3, "pattern": "dispatch"}],
        )
        self.assertEqual(checked, 0)
        self.assertIn("matches the collector", output)


if __name__ == "__main__":
    unittest.main()
