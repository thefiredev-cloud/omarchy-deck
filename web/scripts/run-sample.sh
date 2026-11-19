#!/usr/bin/env bash
# Run the deck server against the synthetic feeds in samples/home.
# The real HOME is never read: the server gets a scratch HOME with a fresh token.
# Usage: web/scripts/run-sample.sh [port]   (default 18796, loopback only)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
port="${1:-18796}"
bin="${PIXEL_DECK_BIN:-$root/web/rust/target/release/pixel-deck}"

if [[ ! -x "$bin" ]]; then
  echo "build first: (cd web/rust && cargo build --release)" >&2
  exit 1
fi

home="$(mktemp -d)"
trap 'rm -rf "$home"' EXIT
cp -a "$root/samples/home/." "$home/"
mkdir -p "$home/.config/pixel-deck" "$home/.local/state/pixel-deck"
token="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | cut -c1-32)"
printf '%s\n' "$token" > "$home/.config/pixel-deck/token"
chmod 600 "$home/.config/pixel-deck/token"

echo "open http://127.0.0.1:$port/?t=$token"
HOME="$home" PIXEL_DECK_BASE="$root/web" PIXEL_DECK_BINDS=127.0.0.1 PIXEL_DECK_PORT="$port" "$bin"
