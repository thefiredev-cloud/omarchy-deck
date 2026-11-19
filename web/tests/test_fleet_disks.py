"""Disk probe failures are unknown, not an answered unreachable check. No network."""
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PATH = Path(__file__).resolve().parent.parent / "scripts" / "fleet-disks.py"
spec = importlib.util.spec_from_file_location("fleet_disks", PATH)
fd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fd)

DF = "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/test 20000000 10000000 10000000 50% /\n"


class Reachability(unittest.TestCase):
    def snapshot(self, directory, probe):
        state = Path(directory) / "fleet-disks.json"
        with patch.object(fd, "STATE", str(state)), patch.object(fd, "HOSTS", [("Spark", "spark")]), patch.object(fd, "df", side_effect=probe):
            code = fd.main()
        return code, json.loads(state.read_text())["hosts"][0]

    def test_answered_disk_check_is_reachable(self):
        with tempfile.TemporaryDirectory() as directory:
            code, host = self.snapshot(directory, lambda _: DF)
        self.assertEqual(code, 0)
        self.assertIs(host["ok"], True)
        self.assertIs(host["reachable"], True)
        self.assertNotIn("error", host)
        self.assertEqual(host["drives"][0]["label"], "System")

    def test_raised_probe_is_unknown_with_error_and_keeps_previous_disks(self):
        failures = [TimeoutError(), subprocess.CalledProcessError(255, ["ssh"]), ValueError(), FileNotFoundError()]
        for failure in failures:
            with self.subTest(error=type(failure).__name__), tempfile.TemporaryDirectory() as directory:
                _, previous = self.snapshot(directory, lambda _: DF)
                def raised(_):
                    raise failure
                code, host = self.snapshot(directory, raised)
                self.assertEqual(code, 2)
                self.assertIsNone(host["ok"])
                self.assertIsNone(host["reachable"])
                self.assertEqual(host["error"], type(failure).__name__)
                self.assertEqual(host["checked"], previous["checked"])
                self.assertEqual(host["drives"], previous["drives"])

    def test_first_raised_probe_has_no_invented_disk_or_check_time(self):
        with tempfile.TemporaryDirectory() as directory:
            def raised(_):
                raise TimeoutError()
            code, host = self.snapshot(directory, raised)
        self.assertEqual(code, 2)
        self.assertIsNone(host["reachable"])
        self.assertIsNone(host["ok"])
        self.assertIsNone(host["checked"])
        self.assertEqual(host["drives"], [])
        self.assertEqual(host["error"], "TimeoutError")


if __name__ == "__main__":
    unittest.main()
