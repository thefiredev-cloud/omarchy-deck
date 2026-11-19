#!/bin/bash
# Create a disposable simulator-only TLS fixture; never commit the generated key.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p build/fixtures
# openssl keeps an existing file's mode, so drop old outputs for umask 077 to apply.
rm -f build/fixtures/rsa-key.pem build/fixtures/rsa-cert.pem
openssl req -x509 -newkey rsa:2048 -nodes -days 7 \
  -config scripts/fixtures/test-cert.cnf -extensions test_server \
  -keyout build/fixtures/rsa-key.pem -out build/fixtures/rsa-cert.pem
openssl x509 -in build/fixtures/rsa-cert.pem -noout -checkend 3600
