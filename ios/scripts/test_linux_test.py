#!/usr/bin/env python3
"""Behavior tests for scripts/linux-test.sh, the Linux Foundation harness entry point."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().with_name("linux-test.sh")
SKIPPED_TEST = "testBuiltAppIncludesEveryRequiredReasonDeclaration"


class LinuxTestWrapperTests(unittest.TestCase):
    def run_wrapper(self, swift_body):
        """Run a copy of the wrapper in a temp repo with a fake `swift` on PATH.

        The fake logs its working directory and arguments to SWIFT_LOG, then runs swift_body.
        """
        temp = tempfile.mkdtemp(prefix="linux-test-wrapper-")
        self.addCleanup(shutil.rmtree, temp, True)
        root = Path(temp)
        (root / "scripts").mkdir()
        (root / "linux-harness").mkdir()
        script = root / "scripts" / "linux-test.sh"
        shutil.copy(SCRIPT, script)
        bin_dir = root / "bin"
        bin_dir.mkdir()
        shim = bin_dir / "swift"
        shim.write_text('#!/bin/bash\nprintf "%s\\n" "$PWD" "$@" > "$SWIFT_LOG"\n' + swift_body)
        shim.chmod(0o755)
        log = root / "swift.log"
        env = {
            **os.environ,
            "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
            "SWIFT_LOG": str(log),
        }
        result = subprocess.run(
            ["bash", str(script)], capture_output=True, text=True, env=env, timeout=60
        )
        cwd, *args = log.read_text().splitlines()
        return result, Path(cwd), args, root

    def test_runs_swift_test_in_harness_and_skips_the_app_bundle_check(self):
        result, cwd, args, root = self.run_wrapper('echo "Executed 3 tests, with 0 failures"\n')

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(cwd.resolve(), (root / "linux-harness").resolve())
        self.assertEqual(args, ["test", "-j", "2", "--skip", SKIPPED_TEST])

    def test_prints_only_the_summary_lines(self):
        swift_body = (
            'echo "Compiling module OmarchyDeck"\n'
            'echo "Test Case \'FooTests.testBar\' passed"\n'
            'echo "Executed 3 tests, with 0 failures"\n'
        )
        result, _, _, _ = self.run_wrapper(swift_body)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Executed 3 tests, with 0 failures", result.stdout)
        self.assertNotIn("Compiling module", result.stdout)

    def test_failing_swift_test_fails_the_wrapper(self):
        swift_body = (
            'echo "/src/Tests/FooTests.swift:12: error: testBar : XCTAssertEqual failed"\n'
            'echo "Executed 3 tests, with 1 failure"\n'
            "exit 1\n"
        )
        result, _, _, _ = self.run_wrapper(swift_body)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("error: testBar", result.stdout)


if __name__ == "__main__":
    unittest.main()
