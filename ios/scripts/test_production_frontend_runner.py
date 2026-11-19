#!/usr/bin/env python3
"""Behavior tests for the production frontend UI test runner's CLI."""
import os
import socket
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().with_name("test-production-frontend.sh")


def fake_toolchain(temp, call_log):
    """Shim xcrun, xcodegen and xcodebuild. Every call is logged; xcodebuild exits 37."""
    bin_dir = temp / "bin"
    bin_dir.mkdir()
    for command in ("xcrun", "xcodegen", "xcodebuild"):
        shim = bin_dir / command
        shim.write_text(
            "#!/bin/sh\n"
            "printf '%s %s\\n' \"$(basename \"$0\")\" \"$*\" >> \"$CALL_LOG\"\n"
            "if [ \"$(basename \"$0\")\" = xcodebuild ]; then exit 37; fi\n"
        )
        shim.chmod(0o755)
    return {
        **os.environ,
        "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
        "CALL_LOG": str(call_log),
    }


class ProductionFrontendRunnerTests(unittest.TestCase):
    def test_requires_exactly_one_simulator_id_before_starting(self):
        for args in ((), ("simulator-a", "simulator-b")):
            with self.subTest(args=args):
                result = subprocess.run(
                    ["bash", str(SCRIPT), *args],
                    capture_output=True,
                    text=True,
                    check=False,
                )

                self.assertEqual(result.returncode, 2)
                self.assertIn("Usage: bash scripts/test-production-frontend.sh SIMULATOR_UDID", result.stderr)

    def test_stops_fixture_after_xcodebuild_failure(self):
        tls_port, backend_port = 28446, 28447
        for port in (tls_port, backend_port):
            with socket.socket() as probe:
                probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                try:
                    probe.bind(("127.0.0.1", port))
                except OSError:
                    self.skipTest("production frontend runner port %d is occupied" % port)

        with tempfile.TemporaryDirectory() as temp:
            call_log = Path(temp) / "calls"
            env = fake_toolchain(Path(temp), call_log)
            result = subprocess.run(
                ["bash", str(SCRIPT), "simulator-test"],
                env=env,
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )
            calls = call_log.read_text().splitlines()

        self.assertEqual(result.returncode, 37, result.stderr)
        self.assertEqual(
            calls,
            [
                "xcrun simctl bootstatus simulator-test -b",
                "xcrun simctl keychain simulator-test add-root-cert build/fixtures/rsa-cert.pem",
                "xcodegen generate --quiet",
                "xcodebuild test -project OmarchyDeck.xcodeproj -scheme OmarchyDeck "
                "-destination platform=iOS Simulator,id=simulator-test "
                "-derivedDataPath build/frontend-dd -only-testing:OmarchyDeckUITests/"
                "ProductionFrontendUITests CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO",
            ],
        )
        with socket.socket() as probe:
            self.assertNotEqual(probe.connect_ex(("127.0.0.1", tls_port)), 0)

    def test_occupied_fixture_port_fails_setup_before_xcodebuild(self):
        occupant = socket.socket()
        occupant.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.addCleanup(occupant.close)
        try:
            occupant.bind(("127.0.0.1", 28446))
        except OSError:
            self.skipTest("production frontend runner port 28446 is occupied")
        occupant.listen()

        with tempfile.TemporaryDirectory() as temp:
            call_log = Path(temp) / "calls"
            env = fake_toolchain(Path(temp), call_log)
            result = subprocess.run(
                ["bash", str(SCRIPT), "simulator-test"],
                env=env,
                capture_output=True,
                text=True,
                check=False,
                timeout=60,
            )
            calls = call_log.read_text().splitlines()

        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertEqual(
            calls,
            [
                "xcrun simctl bootstatus simulator-test -b",
                "xcrun simctl keychain simulator-test add-root-cert build/fixtures/rsa-cert.pem",
            ],
        )


if __name__ == "__main__":
    unittest.main()
