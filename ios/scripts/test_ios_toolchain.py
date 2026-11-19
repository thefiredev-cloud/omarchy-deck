"""Behavior tests for the pinned Apple build-toolchain guard."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts/check-ios-toolchain.sh"


class IOSBuildToolchainTests(unittest.TestCase):
    def run_with_tools(self, xcode_version=None, xcodegen_version=None, allow_mismatch=False):
        with tempfile.TemporaryDirectory() as directory:
            tool_dir = Path(directory)
            if xcode_version is not None:
                self.fake_command(tool_dir, "xcodebuild", f"printf '%s\\n' 'Xcode {xcode_version}' 'Build version 27A266a'\n")
            if xcodegen_version is not None:
                self.fake_command(tool_dir, "xcodegen", f"printf '%s\\n' 'Version: {xcodegen_version}'\n")
            env = {
                **os.environ,
                "PATH": str(tool_dir) + os.pathsep + os.environ["PATH"],
                "ALLOW_TOOLCHAIN_MISMATCH": "1" if allow_mismatch else "0",
            }
            return subprocess.run(
                ["bash", str(SCRIPT)], cwd=REPO_ROOT, env=env,
                capture_output=True, text=True, check=False,
            )

    @staticmethod
    def fake_command(directory, name, body):
        command = directory / name
        command.write_text("#!/bin/sh\n" + body)
        command.chmod(0o755)

    def test_matching_versions_pass(self):
        result = self.run_with_tools("27.0", "2.46.0")

        self.assertEqual(result.returncode, 0)
        self.assertIn("Apple toolchain matches .xcode-version: Xcode 27.0 (27A266a), XcodeGen 2.46.0", result.stdout)

    def test_xcode_mismatch_fails_by_default(self):
        result = self.run_with_tools("26.4", "2.46.0")

        self.assertEqual(result.returncode, 1)
        self.assertIn("Xcode mismatch: running 26.4", result.stderr)

    def test_explicit_mismatch_override_warns_and_passes(self):
        result = self.run_with_tools("26.4", "2.45.0", allow_mismatch=True)

        self.assertEqual(result.returncode, 0)
        self.assertIn("Xcode mismatch: running 26.4", result.stderr)
        self.assertIn("XcodeGen mismatch: running 2.45.0", result.stderr)
        self.assertIn("ALLOW_TOOLCHAIN_MISMATCH=1: reporting the mismatch as a warning", result.stderr)

    def test_missing_xcodebuild_fails_with_platform_guidance(self):
        result = self.run_with_tools(None, "2.46.0")

        self.assertEqual(result.returncode, 2)
        self.assertIn("xcodebuild not found: run this on macOS", result.stderr)

    def test_missing_xcodegen_is_a_mismatch(self):
        result = self.run_with_tools("27.0", None)

        self.assertEqual(result.returncode, 1)
        self.assertIn("xcodegen not installed: .xcode-version pins 2.46.0", result.stderr)


if __name__ == "__main__":
    unittest.main()
