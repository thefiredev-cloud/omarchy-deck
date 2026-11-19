"""deck-fleet-snapshot: failed-unit parsing, atomic mode-600 write, and a failing systemctl never reads as all clear."""
import importlib.machinery
import importlib.util
import json
import stat
import tempfile
import unittest
from pathlib import Path

_PATH = Path(__file__).resolve().parent.parent / "scripts" / "deck-fleet-snapshot"
_loader = importlib.machinery.SourceFileLoader("deck_fleet_snapshot", str(_PATH))
_spec = importlib.util.spec_from_loader("deck_fleet_snapshot", _loader)
fs = importlib.util.module_from_spec(_spec)
_loader.exec_module(fs)

SAMPLE = (
    "app-com.onepassword.OnePassword@autostart.service loaded failed failed 1Password\n"
    "\u25cf mcp-liveness-sweep.service                     loaded failed failed MCP Liveness Sweep\n"
    "app-remmina\\x2dapplet@autostart.service           loaded failed failed Remmina Applet\n"
    "mcp-liveness-sweep.service loaded failed failed dup\n"
    "x;rm -rf ~ loaded failed failed hostile\n"
    "$(id).service loaded failed failed hostile\n"
    "\n"
)


class Parse(unittest.TestCase):
    def test_names_only_sorted_deduped_and_hostile_dropped(self):
        got = fs.parse_failed(SAMPLE)
        self.assertEqual(got, sorted(["app-com.onepassword.OnePassword@autostart.service",
                                      "app-remmina\\x2dapplet@autostart.service", "mcp-liveness-sweep.service"]))
        self.assertNotIn("$(id).service", got)
        self.assertTrue(all(fs.UNIT_RE.match(n) for n in got))

    def test_empty_means_none_failed(self):
        self.assertEqual(fs.parse_failed(""), [])

    def test_capped(self):
        many = "".join(f"u{i}.service loaded failed failed d\n" for i in range(80))
        self.assertEqual(len(fs.parse_failed(many)), fs.MAX_UNITS)


class Write(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)
        self.saved = (fs.OUT, fs.SYSTEMCTL)

    def tearDown(self):
        fs.OUT, fs.SYSTEMCTL = self.saved
        self.tmp.cleanup()

    def fake(self, body: str) -> str:
        p = self.d / "systemctl"
        p.write_text("#!/bin/sh\n" + body)
        p.chmod(0o700)
        return str(p)

    def test_good_run_writes_names_time_and_mode_600(self):
        fs.SYSTEMCTL = self.fake("printf 'a.service loaded failed failed A\\nb.service loaded failed failed B\\n'\n")
        fs.OUT = self.d / "deck" / "fleet.json"
        snap = fs.snapshot(now=1790900000)
        fs.write_atomic(fs.OUT, snap)
        data = json.loads(fs.OUT.read_text())
        self.assertEqual((data["ok"], data["failed_units"], data["t"], data["refresh"]), (True, ["a.service", "b.service"], 1790900000, 300))
        self.assertEqual(stat.S_IMODE(fs.OUT.stat().st_mode), 0o600)
        self.assertEqual([p.name for p in fs.OUT.parent.iterdir()], ["fleet.json"])  # no temp file left

    def test_systemctl_failure_is_not_an_all_clear(self):
        fs.SYSTEMCTL = self.fake("exit 3\n")
        snap = fs.snapshot(now=1790900000)
        self.assertFalse(snap["ok"])
        self.assertEqual(snap["failed_units"], [])
        self.assertEqual(snap["errors"][0]["source"], "systemctl")

    def test_missing_systemctl_is_reported(self):
        fs.SYSTEMCTL = str(self.d / "nope")
        snap = fs.snapshot()
        self.assertFalse(snap["ok"])
        self.assertTrue(snap["errors"])

    def test_main_exit_codes(self):
        fs.OUT = self.d / "f.json"
        fs.SYSTEMCTL = self.fake("exit 0\n")
        self.assertEqual(fs.main(), 0)
        self.assertEqual(json.loads(fs.OUT.read_text())["failed_units"], [])
        fs.SYSTEMCTL = self.fake("exit 1\n")
        self.assertEqual(fs.main(), 1)
        self.assertFalse(json.loads(fs.OUT.read_text())["ok"])


if __name__ == "__main__":
    unittest.main()
