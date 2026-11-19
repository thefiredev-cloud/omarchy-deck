#!/usr/bin/env bash
# Fails when the running Apple toolchain differs from .xcode-version.
#
# Xcode builds, signing and archives cannot run in Docker: Xcode is macOS-only and Apple's license
# limits macOS to Apple hardware. This script is the container-side substitute: it pins the Mac that
# builds the app to one Xcode and one XcodeGen version.
#
#   bash scripts/check-ios-toolchain.sh
#
# Run it on the Mac that builds or signs. A hosted macOS runner that intentionally differs (for
# example macos-26 with Xcode 26.x) may set ALLOW_TOOLCHAIN_MISMATCH=1 to turn the mismatch into a
# warning instead of a failure.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIN_FILE="$ROOT/.xcode-version"

if [[ ! -f "$PIN_FILE" ]]; then
  echo "missing $PIN_FILE" >&2
  exit 2
fi

read_pin() {
  sed -n "s/^$1=//p" "$PIN_FILE" | tail -n 1
}

expect_xcode="$(read_pin XCODE_VERSION)"
expect_build="$(read_pin XCODE_BUILD)"
expect_xcodegen="$(read_pin XCODEGEN_VERSION)"

if [[ -z "$expect_xcode" || -z "$expect_build" || -z "$expect_xcodegen" ]]; then
  echo "$PIN_FILE must set XCODE_VERSION, XCODE_BUILD and XCODEGEN_VERSION" >&2
  exit 2
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild not found: run this on macOS. Docker cannot provide Xcode." >&2
  exit 2
fi

actual_xcode="$(xcodebuild -version | sed -n '1s/^Xcode //p')"
actual_build="$(xcodebuild -version | sed -n '2s/^Build version //p')"
status=0

if [[ "$actual_xcode" != "$expect_xcode" || "$actual_build" != "$expect_build" ]]; then
  echo "Xcode mismatch: running ${actual_xcode:-unknown} (${actual_build:-unknown}), .xcode-version pins ${expect_xcode} (${expect_build})" >&2
  status=1
fi

if command -v xcodegen >/dev/null 2>&1; then
  actual_xcodegen="$(xcodegen --version | sed -n 's/^Version: //p')"
  if [[ "$actual_xcodegen" != "$expect_xcodegen" ]]; then
    echo "XcodeGen mismatch: running ${actual_xcodegen:-unknown}, .xcode-version pins ${expect_xcodegen}" >&2
    status=1
  fi
else
  echo "xcodegen not installed: .xcode-version pins ${expect_xcodegen}" >&2
  status=1
fi

if [[ "$status" -ne 0 ]]; then
  if [[ "${ALLOW_TOOLCHAIN_MISMATCH:-0}" == "1" ]]; then
    echo "ALLOW_TOOLCHAIN_MISMATCH=1: reporting the mismatch as a warning" >&2
    exit 0
  fi
  exit 1
fi

echo "Apple toolchain matches .xcode-version: Xcode ${actual_xcode} (${actual_build}), XcodeGen ${actual_xcodegen}"
