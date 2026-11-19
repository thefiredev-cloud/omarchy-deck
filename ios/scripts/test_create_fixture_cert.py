#!/usr/bin/env python3
"""Behavior tests for scripts/create-fixture-cert.sh, the disposable simulator TLS fixture."""
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "create-fixture-cert.sh"
CONFIG = REPO_ROOT / "scripts" / "fixtures" / "test-cert.cnf"
DAY = 86400


class FixtureCertificateTests(unittest.TestCase):
    def test_generates_private_key_and_valid_loopback_certificate(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
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

            self.assertEqual(result.returncode, 0, result.stderr)
            key = root / "build" / "fixtures" / "rsa-key.pem"
            cert = root / "build" / "fixtures" / "rsa-cert.pem"
            self.assertTrue(key.is_file())
            self.assertTrue(cert.is_file())
            self.assertEqual(key.stat().st_mode & 0o077, 0)

            cert_info = subprocess.run(
                ["openssl", "x509", "-in", str(cert), "-noout", "-subject", "-ext", "subjectAltName", "-checkend", "3600"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(cert_info.returncode, 0, cert_info.stderr)
            self.assertIn("subject=CN=DeckTestRoot", cert_info.stdout)
            self.assertIn("IP Address:127.0.0.1", cert_info.stdout)
            self.assertIn("DNS:localhost", cert_info.stdout)

            key_public = subprocess.run(
                ["openssl", "pkey", "-in", str(key), "-pubout"],
                capture_output=True,
                check=False,
            )
            cert_public = subprocess.run(
                ["openssl", "x509", "-in", str(cert), "-pubkey", "-noout"],
                capture_output=True,
                check=False,
            )
            self.assertEqual(key_public.returncode, 0, key_public.stderr.decode())
            self.assertEqual(cert_public.returncode, 0, cert_public.stderr.decode())
            self.assertEqual(key_public.stdout, cert_public.stdout)


class CreateFixtureCertRerunTests(unittest.TestCase):
    def setUp(self):
        # The script cds to its parent's parent, so run a copy inside a throwaway tree.
        tree = Path(tempfile.mkdtemp(prefix="deck-fixture-cert-"))
        self.addCleanup(shutil.rmtree, tree, True)
        (tree / "scripts" / "fixtures").mkdir(parents=True)
        shutil.copy(SCRIPT, tree / "scripts")
        shutil.copy(CONFIG, tree / "scripts" / "fixtures")
        self.tree = tree
        self.cert = tree / "build" / "fixtures" / "rsa-cert.pem"
        self.key = tree / "build" / "fixtures" / "rsa-key.pem"

    def run_script(self):
        return subprocess.run(
            ["bash", str(self.tree / "scripts" / SCRIPT.name)],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_rerun_over_world_readable_key_leaves_new_key_owner_only(self):
        self.key.parent.mkdir(parents=True, exist_ok=True)
        self.key.write_text("stale key from an earlier run")
        os.chmod(self.key, 0o644)

        self.assertEqual(self.run_script().returncode, 0)

        mode = stat.S_IMODE(os.stat(self.key).st_mode)
        self.assertEqual(mode & 0o077, 0, "a leftover key file must not keep its old permissions")

    def test_cert_expires_in_about_one_week(self):
        self.assertEqual(self.run_script().returncode, 0)

        cert = str(self.cert)
        still_valid_for_six_days = subprocess.run(
            ["openssl", "x509", "-in", cert, "-noout", "-checkend", str(6 * DAY)],
            capture_output=True, check=False,
        ).returncode
        expires_within_seven_days = subprocess.run(
            ["openssl", "x509", "-in", cert, "-noout", "-checkend", str(7 * DAY)],
            capture_output=True, check=False,
        ).returncode

        self.assertEqual(still_valid_for_six_days, 0)
        self.assertEqual(expires_within_seven_days, 1)

    def test_each_run_replaces_the_previous_key(self):
        self.assertEqual(self.run_script().returncode, 0)
        first_key = self.key.read_bytes()

        self.assertEqual(self.run_script().returncode, 0)

        self.assertNotEqual(self.key.read_bytes(), first_key)

    def test_missing_config_fails_and_writes_no_cert(self):
        (self.tree / "scripts" / "fixtures" / "test-cert.cnf").unlink()

        result = self.run_script()

        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.cert.exists())


if __name__ == "__main__":
    unittest.main()
