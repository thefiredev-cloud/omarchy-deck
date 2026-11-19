#!/usr/bin/env python3
"""Isolated Mini/simulator fixture, never a review/live server. Only synthetic credentials.

python3 scripts/security_fixture.py cert.pem key.pem [port]
The port defaults to 9443 (the suites' default origin) and FIXTURE_PORT overrides it; a lane that finds 9443 held
by another session's fixture runs its own on another port and passes OMARCHY_DECK_SECURITY_ORIGIN to both suites.
TLS SANs must include localhost and 127.0.0.1, trusted by the dedicated simulator.
The server binds loopback only. Request logs omit query values and cookies.

One page serves both hardening suites, so `DeckSecurityUITests` and
`DeckHardeningUITests` can run against a single fixture:

  token security-fixture-token-0000  normal deck page (DeckSecurityUITests)
  token fixture-token-0000           normal deck page (DeckHardeningUITests)

A 503 is not retried automatically by the app: it shows the offline screen with a
Retry button, covered by DeckFlowUITests. This fixture therefore serves no hold
mode of its own.

The page is magenta (#ff00ff) so `DeckHardeningUITests` can prove the app
switcher cover hides the deck by finding none of that colour in its snapshot.
"""
import http.server
import os
import ssl
import sys
from urllib.parse import parse_qs, urlsplit

TOKEN = "security-fixture-token-0000"
TOKENS = (TOKEN, "fixture-token-0000")
PORT = int(os.environ.get("FIXTURE_PORT", "9443"))

PAGE_TEMPLATE = b"""<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>html,body{margin:0;height:100%;background:#ff00ff;color:#fff;font:18px system-ui}p,h1{margin:8px 12px}</style>
<script>window.bootstrapWasVisible = new URL(location.href).searchParams.has('t');</script>
</head><body>
<h1>SECURITY FIXTURE - synthetic only</h1>
<h1>DECK FIXTURE - synthetic only</h1>
<p id="token"></p><p id="same">Same-origin pending</p><p id="cross">Cross-site pending</p>
<script>
document.getElementById('token').textContent = window.bootstrapWasVisible
  ? 'Token visible to page scripts' : 'Token removed before page scripts';
fetch('/control.txt').then(r => {
  if (!r.ok) throw new Error('control');
  document.getElementById('same').textContent = 'Same-origin resource loaded';
}).catch(() => document.getElementById('same').textContent = 'Same-origin resource failed');
fetch('https://localhost:__FIXTURE_PORT__/cross.txt').then(r => {
  if (!r.ok) throw new Error('cross');
  document.getElementById('cross').textContent = 'Cross-site resource loaded';
}).catch(() => document.getElementById('cross').textContent = 'Cross-site resource blocked');
</script></body></html>"""


def render(port=PORT):
    """The one page, with its cross-site probe pointed at this fixture's own port."""
    return PAGE_TEMPLATE.replace(b"__FIXTURE_PORT__", str(port).encode())


PAGE = render()


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, code, ctype="text/plain", body=b"", extra=()):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        for name, value in extra:
            self.send_header(name, value)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def saved_token(self):
        cookies = [cookie.strip() for cookie in self.headers.get("Cookie", "").split(";")]
        for cookie in cookies:
            name, _, value = cookie.partition("=")
            if name == "pdeck" and value in TOKENS:
                return value
        return None

    def do_GET(self):
        url = urlsplit(self.path)
        query = parse_qs(url.query)
        print(f"FIXTURE path={url.path} bootstrap_query_present={'t' in query}", flush=True)
        if url.path in ("/control.txt", "/cross.txt"):
            self.reply(200, extra=(("Access-Control-Allow-Origin", "*"),),
                       body=b"synthetic control")
            return
        if url.path != "/":
            self.send_error(404)
            return
        bootstrap = query.get("t", [None])[0]
        via = bootstrap in TOKENS
        saved = None if via else self.saved_token()
        if not (via or saved):
            self.reply(401)
            return
        extra = (("Set-Cookie", f"pdeck={bootstrap}; Path=/; HttpOnly; Secure; SameSite=Lax"),) if via else ()
        self.reply(200, "text/html", PAGE, extra)


def main():
    global PAGE
    cert, key = sys.argv[1:3]
    port = int(sys.argv[3]) if len(sys.argv) > 3 else PORT
    PAGE = render(port)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    print(f"FIXTURE listening on loopback TLS port {port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
