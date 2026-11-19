"""Exercise the committed frontend and synthetic feeds over verified loopback TLS."""
import http.client
import json
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import time
import unittest

import production_frontend_fixture


class CommittedFrontendTests(unittest.TestCase):
    def test_tls_bootstrap_assets_and_fleet_life_feeds(self):
        root = Path(__file__).resolve().parent
        with tempfile.TemporaryDirectory() as tmp:
            cert, key = Path(tmp) / "cert.pem", Path(tmp) / "key.pem"
            subprocess.run([
                "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                "-config", str(root / "fixtures/test-cert.cnf"), "-extensions", "test_server",
                "-keyout", str(key), "-out", str(cert),
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            # Reserve both distinct ports until just before the child binds them.
            with socket.socket() as tls, socket.socket() as upstream:
                tls.bind(("127.0.0.1", 0))
                upstream.bind(("127.0.0.1", 0))
                tls_port, http_port = tls.getsockname()[1], upstream.getsockname()[1]
            process = subprocess.Popen([
                "python3", str(root / "production_frontend_fixture.py"),
                str(tls_port), str(http_port), str(cert), str(key),
            ], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            try:
                context = ssl.create_default_context(cafile=str(cert))

                def get(path, cookie=None):
                    connection = http.client.HTTPSConnection("127.0.0.1", tls_port, context=context, timeout=2)
                    try:
                        connection.request("GET", path, headers={"Cookie": cookie} if cookie else {})
                        response = connection.getresponse()
                        return response.status, response.getheaders(), response.read()
                    finally:
                        connection.close()

                deadline = time.monotonic() + 10
                while True:
                    if process.poll() is not None:
                        self.fail("Committed fixture exited before serving: " + process.stdout.read())
                    try:
                        status, _, _ = get("/")
                        break
                    except (OSError, http.client.HTTPException):
                        if time.monotonic() >= deadline:
                            self.fail("Committed fixture never served loopback TLS")
                        time.sleep(0.05)
                self.assertEqual(status, 401)
                status, headers, _ = get("/?t=" + production_frontend_fixture.TOKEN)
                self.assertEqual(status, 200)
                self.assertIn(("Content-Type", "text/html; charset=utf-8"), headers)
                cookie = next(value.split(";", 1)[0] for name, value in headers if name.lower() == "set-cookie")
                for path in ("/app.js", "/deck.js", "/pad.js", "/agents.js", "/schedules.js", "/invest.js", "/theme.css"):
                    with self.subTest(asset=path):
                        self.assertEqual(get(path, cookie)[0], 200)
                status, _, fleet = get("/api/fleet-board", cookie)
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(fleet)["machines"]["items"][0]["name"], "pc-desktop")
                status, _, today = get("/api/today", cookie)
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(today)["markets"]["items"][0]["title"],
                                 "Fixture headline one: markets move on synthetic news")
            finally:
                if process.poll() is None:
                    process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
                process.stdout.close()


if __name__ == "__main__":
    unittest.main()
