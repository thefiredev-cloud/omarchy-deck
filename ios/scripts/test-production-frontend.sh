#!/usr/bin/env bash
# Run the production frontend UI test with only vendored source and synthetic loopback feeds.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# -ne 1 ]]; then
  printf 'Usage: bash scripts/test-production-frontend.sh SIMULATOR_UDID\n' >&2
  exit 2
fi
command -v xcrun >/dev/null
command -v xcodegen >/dev/null
command -v node >/dev/null
# I5: rebuild the vendored frontend from pixel-deck first when a checkout is given (pc-desktop). The Mini has no
# checkout and runs the committed archive, whose source commit is in scripts/fixtures/production-frontend.source.
if [[ -n "${PIXEL_DECK_DIR:-}" ]]; then
  python3 scripts/production_frontend_fixture.py regenerate "$PIXEL_DECK_DIR" "${PIXEL_DECK_REF:-origin/main}"
fi
printf 'Frontend fixture source: %s\n' "$(cat scripts/fixtures/production-frontend.source)"
bash scripts/create-fixture-cert.sh
xcrun simctl bootstatus "$1" -b
xcrun simctl keychain "$1" add-root-cert build/fixtures/rsa-cert.pem
fixture_log=$(mktemp build/fixtures/frontend.XXXXXX)
fixture_pid=""
cleanup() {
  if [[ -n "$fixture_pid" ]]; then
    kill "$fixture_pid" 2>/dev/null || true
    wait "$fixture_pid" 2>/dev/null || true
  fi
  rm -f "$fixture_log"
}
trap cleanup EXIT
python3 scripts/production_frontend_fixture.py 28446 28447 \
  build/fixtures/rsa-cert.pem build/fixtures/rsa-key.pem >"$fixture_log" 2>&1 &
fixture_pid=$!
python3 - "$fixture_log" <<'PY'
import http.client
from pathlib import Path
import ssl
import sys
import time
context = ssl.create_default_context(cafile="build/fixtures/rsa-cert.pem")
deadline = time.monotonic() + 15
while "Production frontend source + synthetic backend on native WKWebView (loopback TLS)" not in Path(sys.argv[1]).read_text():
    if time.monotonic() >= deadline:
        raise RuntimeError("Owned fixture did not start: " + Path(sys.argv[1]).read_text())
    time.sleep(0.1)
while True:
    connection = http.client.HTTPSConnection("127.0.0.1", 28446, context=context, timeout=2)
    try:
        connection.request("GET", "/?t=production-frontend-fixture-0000")
        response = connection.getresponse()
        response.read()
        if response.status != 200:
            raise RuntimeError(f"Frontend fixture returned {response.status}")
        break
    except (OSError, http.client.HTTPException):
        if time.monotonic() >= deadline:
            raise
        time.sleep(0.1)
    finally:
        connection.close()
PY
kill -0 "$fixture_pid"
xcodegen generate --quiet
TEST_RUNNER_OMARCHY_DECK_FRONTEND_ORIGIN=https://127.0.0.1:28446/ \
  xcodebuild test -project OmarchyDeck.xcodeproj -scheme OmarchyDeck \
    -destination "platform=iOS Simulator,id=$1" -derivedDataPath build/frontend-dd \
    -only-testing:OmarchyDeckUITests/ProductionFrontendUITests \
    CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO
