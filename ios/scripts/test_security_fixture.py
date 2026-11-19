#!/usr/bin/env python3
"""Cover the second synthetic token used by the deck hardening suite."""
import unittest

import security_fixture
from test_fixture_servers import LoopbackServer, values


class SecondarySecurityFixtureTokenTests(unittest.TestCase):
    def test_secondary_bootstrap_token_sets_matching_cookie_and_serves_page(self):
        server = LoopbackServer(security_fixture.Handler).start()
        self.addCleanup(server.stop)

        status, headers, body = server.request("GET", "/?t=fixture-token-0000")

        self.assertEqual(status, 200)
        self.assertIn(b"SECURITY FIXTURE - synthetic only", body)
        self.assertEqual(
            values(headers, "Set-Cookie"),
            ["pdeck=fixture-token-0000; Path=/; HttpOnly; Secure; SameSite=Lax"],
        )


if __name__ == "__main__":
    unittest.main()
