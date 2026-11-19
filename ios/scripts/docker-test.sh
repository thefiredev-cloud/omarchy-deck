#!/usr/bin/env bash
# Build and run the Linux Foundation harness image for this repository.
# Needs Docker. No secrets, no network services, no ports.
#
#   bash scripts/docker-test.sh                              # the harness suite
#   bash scripts/docker-test.sh --filter AddressEntryTests   # one suite
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-omarchy-deck-linux-harness:local}"

cd "$ROOT"
docker build --target test -t "$IMAGE" .
docker run --rm "$IMAGE" "$@"
