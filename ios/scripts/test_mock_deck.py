"""Exercise mock_deck.py's simulator control contract over verified loopback TLS."""
import http.client
import json
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import unittest


class MockDeckTests(unittest.TestCase):
    token = "synthetic-deck-test-token"

    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parent
        tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(tmp.cleanup)
        cls.cert, cls.key = Path(tmp.name) / "cert.pem", Path(tmp.name) / "key.pem"
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
            "-config", str(cls.root / "fixtures/test-cert.cnf"), "-extensions", "test_server",
            "-keyout", str(cls.key), "-out", str(cls.cert),
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.context = ssl.create_default_context(cafile=str(cls.cert))

    def setUp(self):
        with socket.socket() as reserved:
            reserved.bind(("127.0.0.1", 0))
            self.port = reserved.getsockname()[1]
        self.process = subprocess.Popen([
            sys.executable, str(self.root / "mock_deck.py"), str(self.port),
            str(self.cert), str(self.key), self.token,
        ], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        self.addCleanup(self.stop_server)
        deadline = time.monotonic() + 10
        while True:
            if self.process.poll() is not None:
                self.fail("Mock deck exited before serving: " + self.process.stdout.read())
            try:
                status, _, body = self.get("/__fixture/status")
                break
            except (OSError, http.client.HTTPException):
                if time.monotonic() >= deadline:
                    self.fail("Mock deck never served loopback TLS")
                time.sleep(0.05)
        self.assertEqual((status, body), (200, b"up"))

    def stop_server(self):
        if self.process.poll() is None:
            self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        self.process.stdout.close()

    def get(self, path, headers=None):
        connection = http.client.HTTPSConnection(
            "127.0.0.1", self.port, context=self.context, timeout=2
        )
        try:
            connection.request("GET", path, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def session(self):
        status, headers, _ = self.get("/?t=" + self.token)
        self.assertEqual(status, 200)
        return {"Cookie": headers["Set-Cookie"].split(";", 1)[0]}

    def control(self, name):
        status, headers, body = self.get("/__fixture/" + name)
        self.assertEqual(status, 200)
        self.assertNotIn("Set-Cookie", headers)
        return body

    def test_bootstrap_cookie_authenticates_subsequent_navigation(self):
        self.assertEqual(self.get("/")[0], 401)
        self.assertEqual(self.get("/?t=wrong")[0], 401)
        headers = self.session()
        status, response_headers, _ = self.get("/same", headers)
        self.assertEqual(status, 200)
        self.assertNotIn("Set-Cookie", response_headers)

    def test_housing_and_deal_desk_routes_serve_the_decks_own_shapes(self):
        for path in ("/api/realestate", "/api/cre?person=tanner", "/api/housing/profile"):
            self.assertEqual(self.get(path)[0], 401, path + " needs a session")
        headers = self.session()
        status, _, body = self.get("/api/realestate", headers)
        self.assertEqual(status, 200)
        realestate = json.loads(body)
        self.assertEqual(set(realestate) >= {"homes", "commercial", "market", "t", "stale", "sources"}, True)
        self.assertEqual(realestate["market"]["age_restricted"]["hidden"], 4)
        self.assertGreater(len(realestate["homes"]), 20, "enough homes to prove Show more reaches twenty")
        status, _, body = self.get("/api/cre?person=tanner", headers)
        self.assertEqual(status, 200)
        desk = json.loads(body)
        self.assertEqual((desk["person"], desk["viewer"]), ("tanner", False))
        self.assertEqual(set(desk["boxes_of"]), {"jordan", "riley"})
        self.assertEqual(len(desk["deals"]), desk["counts"]["deals"])
        self.assertTrue(all(len(deal["id"]) == 12 for deal in desk["deals"]), "deal ids are 12 hex characters")
        self.assertEqual(desk["generated_at"], desk["t"], "both are stamped 15 minutes old")
        status, _, body = self.get("/api/housing/profile", headers)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["budget"]["budget"], 1000000)
        # The not-collected state: a desk that is not reporting, and no budget file.
        self.control("feeds-missing")
        self.assertEqual(json.loads(self.get("/api/cre?person=tanner", headers)[2])["status"], "not_reporting")
        self.assertEqual(json.loads(self.get("/api/realestate", headers)[2])["error"], "file missing")
        self.control("release")
        self.assertIn("deals", json.loads(self.get("/api/cre?person=tanner", headers)[2]))

    def test_rank_sorts_gross_yield_nulls_last_and_serves_a_rejected_zip(self):
        headers = self.session()
        status, _, body = self.get("/api/housing/rank?kind=housing&sort=gross_yield&limit=200", headers)
        self.assertEqual(status, 200)
        yields = [r.get("gross_yield") for r in json.loads(body)["rows"]]
        present = [y for y in yields if y is not None]
        self.assertEqual(yields[:len(present)], sorted(present, reverse=True), "the blended yield, largest first")
        self.assertTrue(all(y is None for y in yields[len(present):]), "no yield sorts last")
        status, _, body = self.get("/api/housing/zip/62927", headers)
        self.assertEqual(status, 200)
        m = json.loads(body)["m"]
        self.assertEqual((m["home_value"]["v"], m["home_value"]["reason"]), (None, "placeholder"))

    def test_best_zip_columns_and_markets_lists_follow_the_deck(self):
        headers = self.session()
        status, _, body = self.get("/api/housing/fields", headers)
        self.assertEqual(status, 200)
        catalog = json.loads(body)
        self.assertEqual(catalog["dataset"], "v2")
        in_zips = {f["name"] for f in catalog["fields"] if f["in_zips"]}
        self.assertIn("affordability", in_zips)
        self.assertNotIn("gross_yield_conf", in_zips, "a catalog column the ZIP table lacks")
        cols = "city,state,days_on_market,price_cuts,affordability,acsmf_renter_5plus_share"
        status, _, body = self.get("/api/housing/rank?kind=housing&sort=days_on_market&limit=20&cols=" + cols, headers)
        self.assertEqual(status, 200)
        rank = json.loads(body)
        self.assertEqual((rank["dataset"], rank["sort_dir"]), ("v2", "asc"), "days to sell ranks lowest first")
        self.assertEqual(rank["cols"][0], "zip")
        days = [r.get("days_on_market") for r in rank["rows"]]
        self.assertEqual(days, sorted(d for d in days if d is not None) + [d for d in days if d is None])
        self.assertTrue(all(set(r) <= set(rank["cols"]) | {"rank", "price", "price_src", "from"} for r in rank["rows"]))
        self.assertTrue(any(r.get("from") == {"days_on_market": "county", "price_cuts": "county"} for r in rank["rows"]))
        flipped = json.loads(self.get("/api/housing/rank?kind=housing&sort=days_on_market&dir=desc&limit=5&cols=" + cols, headers)[2])
        self.assertEqual(flipped["sort_dir"], "desc")
        self.assertEqual(self.get("/api/housing/rank?kind=housing&sort=score&limit=5&cols=gross_yield_conf", headers)[0], 400,
                         "a column the ZIP table lacks answers 400 bad cols, as housing.rs")
        status, _, body = self.get("/api/housing/national?part=segments", headers)
        spec = json.loads(body)
        self.assertEqual([s["id"] for s in spec["segments"]][:2], ["residential", "multifamily"])
        self.assertFalse(spec["stale"])
        status, _, body = self.get("/api/housing/national?part=metros&state=CA&fields=cbsa,name,home_value", headers)
        metros = json.loads(body)["metros"]
        self.assertTrue(metros and all(set(m) <= {"cbsa", "name", "home_value"} for m in metros))
        self.assertTrue(all("CA" in m["name"].rsplit(", ", 1)[1].split("-") for m in metros))
        self.assertEqual(len(json.loads(self.get("/api/housing/national?part=states&fields=state,name", headers)[2])["states"]), 51)
        self.assertEqual(self.get("/api/housing/national?part=states&fields=Bad-Name", headers)[0], 400)

    def test_surf_and_shop_routes_pass_the_contract_through(self):
        for path in ("/api/surf-coast", "/api/surf-coast/region/orange-county", "/api/ecom-market"):
            self.assertEqual(self.get(path)[0], 401, path + " needs a session")
        headers = self.session()
        status, _, body = self.get("/api/surf-coast", headers)
        surf = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(len(surf["regions"]), 14)
        self.assertEqual(surf["spots"][0]["pinned"], 1)
        self.assertFalse(surf["stale"])
        self.assertEqual(surf["refresh"], 1800)
        region = json.loads(self.get("/api/surf-coast/region/orange-county", headers)[2])
        self.assertEqual(region["region"]["id"], "orange-county")
        self.assertEqual(len(region["spots"][0]["hours"]["hs_ft"]), 72)
        self.assertEqual(json.loads(self.get("/api/surf-coast/region/ventura", headers)[2])["status"], "not_reporting")
        self.assertEqual(self.get("/api/surf-coast/region/hawaii", headers)[0], 404)
        shop = json.loads(self.get("/api/ecom-market", headers)[2])
        self.assertEqual(len(shop["macro"]), 28)
        self.assertIn("sources", shop)
        self.control("old-deck")
        for path in ("/api/surf-coast", "/api/surf-coast/region/orange-county", "/api/ecom-market"):
            self.assertEqual(self.get(path, headers)[0], 404, path + " on a deck that predates it")
        self.control("release")
        self.control("feeds-missing")
        self.assertEqual(json.loads(self.get("/api/surf-coast", headers)[2])["status"], "not_reporting")
        self.assertEqual(json.loads(self.get("/api/ecom-market", headers)[2])["error"], "file missing")
        self.control("release")

    def test_surf_alert_fixtures_move_alerts_off_and_onto_the_home_region(self):
        headers = self.session()
        alerts = lambda: json.loads(self.get("/api/surf-coast", headers)[2])["alerts"]
        home = lambda alert: "orange-county" in alert["regions"]
        self.assertEqual(sum(map(home, alerts())), 1, "the cut fixture has one alert on the pinned spots' region")
        far_count = len([a for a in alerts() if not home(a)])
        self.control("surf-alerts-far")
        far = alerts()
        self.assertEqual((len(far), sum(map(home, far))), (far_count, 0), "far keeps only the other regions' alerts")
        self.control("surf-alerts-home")
        near = alerts()
        self.assertEqual([a["severity"] for a in near if home(a)], ["Minor", "Moderate", "Severe", "Extreme"])
        self.assertEqual(len(near), far_count + 4)
        self.control("release")
        self.assertEqual(sum(map(home, alerts())), 1, "release restores the fixture's alerts")

    def test_whoami_names_owner_and_guest_and_needs_a_session(self):
        self.assertEqual(self.get("/api/whoami")[0], 401)
        status, _, body = self.get("/api/whoami", self.session())
        self.assertEqual((status, json.loads(body)), (200, {"role": "owner"}))
        status, headers, _ = self.get("/?t=guest-" + self.token)
        self.assertEqual(status, 200)
        guest = {"Cookie": headers["Set-Cookie"].split(";", 1)[0]}
        self.assertEqual(guest["Cookie"], "pdeck=guest-" + self.token)
        status, _, body = self.get("/api/whoami", guest)
        self.assertEqual((status, json.loads(body)), (200, {"role": "guest"}))
        # The Pad socket stays owner only, as on the real deck.
        self.assertEqual(self.get("/pad?target=mini", {**guest, "Origin": f"https://127.0.0.1:{self.port}"})[0], 403)

    def test_almanac_is_a_same_origin_page_without_a_link_home(self):
        headers = self.session()
        status, _, body = self.get("/", headers)
        self.assertEqual(status, 200)
        self.assertIn(b'href="/almanac/"', body)
        status, _, body = self.get("/almanac/", headers)
        self.assertEqual(status, 200)
        self.assertIn(b"MOCK ALMANAC (server page)", body)
        self.assertNotIn(b'href="/"', body)
        self.assertEqual(self.get("/almanac/")[0], 401)

    def test_expiry_rejects_cookie_but_allows_bootstrap_until_release(self):
        headers = self.session()
        self.control("expire")
        self.assertEqual(self.get("/", headers)[0], 401)
        renewed = self.session()
        self.assertEqual(self.get("/", renewed)[0], 401)
        self.control("release")
        self.assertEqual(self.get("/", renewed)[0], 200)

    def test_hold_overrides_authentication_and_can_be_repeated(self):
        headers = self.session()
        for _ in range(2):
            self.assertEqual(self.control("hold"), b"held")
            self.assertEqual(self.control("status"), b"held")
            for path, auth in (("/", None), ("/", headers), ("/?t=" + self.token, None)):
                with self.subTest(path=path, authenticated=bool(auth)):
                    status, response_headers, body = self.get(path, auth)
                    self.assertEqual((status, body), (503, b"down"))
                    self.assertNotIn("Set-Cookie", response_headers)
            self.assertEqual(self.control("release"), b"up")
            self.assertEqual(self.get("/", headers)[0], 200)
            self.assertEqual(self.get("/")[0], 401)

    def test_redirect_requires_auth_and_release_clears_redirect_mode(self):
        headers = self.session()
        self.control("redirect")
        self.assertEqual(self.get("/")[0], 401)
        status, response_headers, body = self.get("/same", headers)
        self.assertEqual((status, body), (302, b""))
        self.assertEqual(response_headers["Location"], f"https://127.0.0.1:{self.port}/")
        self.control("hold")
        self.assertEqual(self.get("/", headers)[0], 503)
        self.control("release")
        self.assertEqual(self.get("/", headers)[0], 200)

    def test_invalid_delay_does_not_change_availability(self):
        headers = self.session()
        for invalid in ("", "abc", "1.5"):
            with self.subTest(delay=invalid):
                path = "/__fixture/hold?delay_ms=" + invalid
                self.assertEqual(self.get(path)[0], 400)
                self.assertEqual(self.control("status"), b"up")
                self.assertEqual(self.get("/", headers)[0], 200)
                self.control("hold")
                self.assertEqual(self.get(path)[0], 400)
                self.assertEqual(self.control("status"), b"held")
                self.assertEqual(self.get("/", headers)[0], 503)
                self.control("release")

    def test_counts_separate_clients_strip_queries_and_exclude_controls(self):
        self.get("/?t=wrong", {"User-Agent": "AppleWebKit/605.1 CFNetwork/1"})
        self.control("hold")
        self.get("/same?attempt=1", {"User-Agent": "CFNetwork/1"})
        self.control("release")
        self.get("/same?attempt=2", {"User-Agent": "CFNetwork/1"})
        self.get("/__gesture/reload", {"User-Agent": "AppleWebKit/605.1"})
        self.get("/asset.js?version=3")
        expected = {
            "webview": {"/": 1, "/__gesture/reload": 1},
            "probe": {"/same": 2},
            "other": {"/asset.js": 1},
        }
        self.assertEqual(json.loads(self.control("requests")), expected)
        self.assertEqual(json.loads(self.control("requests")), expected)

    def test_camera_playlist_key_is_scoped_to_camera_resources(self):
        headers = self.session()
        status, response_headers, body = self.get("/cam/index.m3u8", headers)
        self.assertEqual(status, 200)
        self.assertEqual(response_headers["Content-Type"], "application/vnd.apple.mpegurl")
        segment = next(line for line in body.decode().splitlines() if not line.startswith("#"))
        status, response_headers, _ = self.get("/cam/" + segment)
        self.assertEqual(status, 200)
        self.assertEqual(response_headers["Content-Type"], "video/mp2t")
        self.assertNotIn("Set-Cookie", response_headers)
        self.assertEqual(self.get("/cam/segment.ts")[0], 401)
        self.assertEqual(self.get("/cam/segment.ts?k=wrong")[0], 401)
        key_query = segment.split("?", 1)[1]
        self.assertEqual(self.get("/api/cam?" + key_query)[0], 401)
        self.assertEqual(self.get("/?" + key_query)[0], 401)

    def test_pad_requires_session_same_origin_target_and_websocket_upgrade(self):
        headers = self.session()
        origin = f"https://127.0.0.1:{self.port}"
        self.assertEqual(self.get("/pad?target=mini", headers)[0], 403)
        self.assertEqual(self.get("/pad?target=mini", {**headers, "Origin": "https://example.net"})[0], 403)
        headers["Origin"] = origin
        self.assertEqual(self.get("/pad?target=other", headers)[0], 400)
        self.assertEqual(self.get("/pad?target=mini", headers)[0], 426)
        self.assertEqual(self.get("/pad?target=mini&t=" + self.token, {"Origin": origin})[0], 403)

    def test_stalled_tls_client_does_not_block_other_clients(self):
        # WebKit and CFNetwork open spare TCP connections that never start a handshake. The
        # tearDown fixture release in DeckFlowUITests must still answer inside its 5 s budget.
        stalled = [socket.create_connection(("127.0.0.1", self.port), timeout=2) for _ in range(2)]
        self.addCleanup(lambda: [s.close() for s in stalled])
        started = time.monotonic()
        self.assertEqual(self.control("release"), b"up")
        self.assertLess(time.monotonic() - started, 1.5)


if __name__ == "__main__":
    unittest.main()
