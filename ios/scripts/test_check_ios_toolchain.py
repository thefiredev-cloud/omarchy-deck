#!/usr/bin/env python3
"""Behavior tests for the pinned Apple toolchain gate."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "check-ios-toolchain.sh"


class ToolchainCheckTests(unittest.TestCase):
    def run_check(self, xcode_version="27.0", xcode_build="27A266a", xcodegen_version="2.46.0", *, allow_mismatch=None, include_xcodegen=True):
        with tempfile.TemporaryDirectory() as bin_dir:
            bin_path = Path(bin_dir)
            xcodebuild = bin_path / "xcodebuild"
            xcodebuild.write_text(
                "#!/bin/sh\nprintf 'Xcode " + xcode_version + "\\nBuild version " + xcode_build + "\\n'\n"
            )
            xcodebuild.chmod(0o755)
            if include_xcodegen:
                xcodegen = bin_path / "xcodegen"
                xcodegen.write_text("#!/bin/sh\nprintf 'Version: " + xcodegen_version + "\\n'\n")
                xcodegen.chmod(0o755)
            env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}
            if allow_mismatch is not None:
                env["ALLOW_TOOLCHAIN_MISMATCH"] = allow_mismatch
            else:
                env.pop("ALLOW_TOOLCHAIN_MISMATCH", None)
            return subprocess.run(
                ["bash", str(SCRIPT)],
                cwd=REPO_ROOT,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )

    def test_matching_pinned_versions_pass(self):
        result = self.run_check()

        self.assertEqual(result.returncode, 0)
        self.assertIn("Apple toolchain matches .xcode-version", result.stdout)

    def test_version_mismatches_fail_and_name_both_tools(self):
        result = self.run_check("26.4", "26E123", "2.45.0")

        self.assertEqual(result.returncode, 1)
        self.assertIn("Xcode mismatch:", result.stderr)
        self.assertIn("XcodeGen mismatch:", result.stderr)

    def test_mismatch_override_warns_and_passes(self):
        result = self.run_check("26.4", "26E123", "2.45.0", allow_mismatch="1")

        self.assertEqual(result.returncode, 0)
        self.assertIn("ALLOW_TOOLCHAIN_MISMATCH=1", result.stderr)
        self.assertIn("Xcode mismatch:", result.stderr)

    def test_missing_xcodegen_fails_and_override_only_warns(self):
        result = self.run_check(include_xcodegen=False)

        self.assertEqual(result.returncode, 1)
        self.assertIn("xcodegen not installed", result.stderr)
        allowed = self.run_check(include_xcodegen=False, allow_mismatch="1")
        self.assertEqual(allowed.returncode, 0)
        self.assertIn("ALLOW_TOOLCHAIN_MISMATCH=1", allowed.stderr)


if __name__ == "__main__":
    unittest.main()
