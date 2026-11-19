#!/usr/bin/env bash
# Runs the Foundation-only Omarchy Deck unit tests on Linux (see linux-harness/).
# This proves pure logic only. Tests that need UIKit, SwiftUI, WebKit, StoreKit or WatchConnectivity run on the Mini.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/linux-harness"

# Not run on Linux: AppVersionTests reads PrivacyInfo.xcprivacy from Bundle.main, which only exists in the built app.
# The Mini's full OmarchyDeckTests run still checks it.
SKIP_LINUX='testBuiltAppIncludesEveryRequiredReasonDeclaration'

swift test -j 2 --skip "$SKIP_LINUX" 2>&1 | grep -E 'Executed |error:|failed|passed|Test Suite'
