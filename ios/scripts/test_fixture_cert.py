#!/usr/bin/env python3
"""Behavior tests for the disposable simulator TLS certificate generator."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "create-fixture-cert.sh"
CONFIG = REPO_ROOT / "scripts" / "fixtures" / "test-cert.cnf"


class FixtureCertTests(unittest.TestCase):
    def test_generates_private_key_and_loopback_trusted_certificate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "scripts" / "fixtures").mkdir(parents=True)
            shutil.copy2(SCRIPT, root / "scripts" / SCRIPT.name)
            shutil.copy2(CONFIG, root / "scripts" / "fixtures" / CONFIG.name)

            result = subprocess.run(
                ["bash", str(root / "scripts" / SCRIPT.name)],
                cwd=root,
                capture_output=True,
                text=True,
                check=False,
            )

            cert = root / "build" / "fixtures" / "rsa-cert.pem"
            key = root / "build" / "fixtures" / "rsa-key.pem"
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(cert.is_file())
            self.assertTrue(key.is_file())
            self.assertEqual((root / "build" / "fixtures").stat().st_mode & 0o777, 0o700)
            self.assertEqual(key.stat().st_mode & 0o777, 0o600)
            subprocess.run(
                ["openssl", "verify", "-CAfile", str(cert), str(cert)],
                check=True,
                capture_output=True,
                text=True,
            )
            subprocess.run(
                ["openssl", "x509", "-in", str(cert), "-noout", "-checkip", "127.0.0.1"],
                check=True,
                capture_output=True,
                text=True,
            )
            subprocess.run(
                ["openssl", "x509", "-in", str(cert), "-noout", "-checkhost", "localhost"],
                check=True,
                capture_output=True,
                text=True,
            )


if __name__ == "__main__":
    unittest.main()
