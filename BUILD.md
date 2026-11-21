# Build guide

This guide covers four things: the web deck on sample data, a production install on your own Linux server, the iOS app (Xcode on a Mac, or Linux with xtool), and the MCP server. Run every command from the repository root unless a step says otherwise.

## Requirements

| Part | Needs |
|---|---|
| Web deck server | Rust (stable, edition 2021), a C linker, Linux with systemd for production |
| Web tests | Node.js 22 or later, Python 3.9 or later |
| Collectors | Python 3.9 or later (standard library only) |
| Pad input | `ydotoold` on each machine the Pad controls |
| iOS on a Mac | Xcode and XcodeGen at the versions in `ios/.xcode-version` |
| iOS checks on Linux | Swift 5.9 or later, or Docker |
| iOS build on Linux | xtool and an iOS SDK it installs (`xtool setup`) |
| MCP server | Python 3.10 or later and `fastmcp` (pinned in `mcp/requirements.txt`) |

No GPU is needed for any part.

## 1. Web deck on sample data

```sh
(cd web/rust && cargo build --release)
web/scripts/run-sample.sh            # port 18796; pass another port as the first argument
```

The script copies `samples/home` into a temporary directory, writes a random token there and starts the server with that directory as `HOME`, bound to `127.0.0.1` only. Your real home directory is never read. Open the printed `http://127.0.0.1:18796/?t=...` link; the token sets a session cookie and leaves the address bar. Stop with Ctrl+C; the temporary directory is removed.

Pages whose feeds are not in `samples/` (calendar, mail, finance, cameras) show "Not reporting". That is the expected state, not a crash. To point the script at a binary built elsewhere, set `PIXEL_DECK_BIN`.

## 2. Tests

```sh
(cd web/rust && cargo test --locked && cargo clippy --all-targets --locked)
(cd web && node --test tests/*.test.js)
(cd web && python3 -m unittest discover -s tests && python3 -m unittest discover -s scripts/tests)
```

The front-end tests load the real scripts from `web/static` in Node and check the HTML they build, including an escape sweep that feeds hostile strings to every builder. No test opens a network connection outside loopback.

## 3. Production install on your server

1. Build: `(cd web/rust && cargo build --release)`.
2. Create the access token. The server refuses to start without it.
   ```sh
   install -d -m 700 ~/.config/pixel-deck
   head -c 24 /dev/urandom | base64 | tr '+/' '-_' > ~/.config/pixel-deck/token
   chmod 600 ~/.config/pixel-deck/token
   ```
   The `tr` keeps the token URL-safe. A `+` in the `?t=` link decodes to a space, so the bootstrap fails.
3. Install the binary and the systemd user unit: `web/scripts/install-server`. It copies the binary to `~/.local/bin/pixel-deck`, backs up any old one, and enables `pixel-deck.service`. A service that already runs keeps the old binary until you run `systemctl --user restart pixel-deck.service`.
4. Edit the unit with `systemctl --user edit pixel-deck.service` to set:
   - `PIXEL_DECK_BASE`: the `web/` directory of this checkout (the server reads `keys.json` there).
   - `PIXEL_DECK_BINDS`: addresses to listen on, comma separated. The default is `127.0.0.1`.
   - `PIXEL_DECK_PORT`: default `8796`.
   - `PIXEL_DECK_ALLOWED_HOSTS`: extra host names to accept. Any other `Host` header gets 403, which blocks DNS rebinding.
5. Put HTTPS in front. Any reverse proxy works (Caddy, nginx, or `tailscale serve` on a private tailnet). Phones and the iOS app need HTTPS.
6. Open `https://<your-host>/?t=<token>` once on each device.

Remove it with `web/scripts/uninstall-server`.

## 4. Collectors

Collectors are scripts. Most run from a systemd user timer. Install the ones you want:

```sh
web/scripts/install-ops-feeds deck-feed-stalls deck-feed-serverpage
web/scripts/install-traffic-feed
web/scripts/install-national          # national housing data from public sources (large first run)
```

The surf, trends and e-commerce collectors (`web/scripts/deck-feed-*`) ship with unit files in `web/scripts/systemd/`. `deck-feed-markets`, `deck-feed-crons` and `deck-feed-dev` ship none. Copy a pair into `~/.config/systemd/user/`, put the script at `~/ops/bin/<name>` (the path the unit names), then `systemctl --user enable --now <name>.timer`. Each script's header says what it reads and where it writes. Set `DECK_FEED_DIR` to stage output somewhere other than `~/.meshvault/status`.

## 5. iOS app on a Mac (Xcode)

```sh
cd ios
bash scripts/check-ios-toolchain.sh   # fails if Xcode or XcodeGen differ from .xcode-version
xcodegen generate
xcodebuild -project OmarchyDeck.xcodeproj -scheme OmarchyDeck \
  -destination 'generic/platform=iOS Simulator' build
```

To run on a device, set `DEVELOPMENT_TEAM` in `ios/project.yml` to your own Apple Developer team ID and change the bundle IDs. UI tests talk to a local mock deck over TLS: `bash scripts/create-fixture-cert.sh`, then `python3 scripts/mock_deck.py 28445 build/fixtures/rsa-cert.pem build/fixtures/rsa-key.pem`.

## 6. iOS on Linux

Foundation-only checks (address entry, tokens, feed parsers, layout math), no Mac needed:

```sh
cd ios
bash scripts/linux-test.sh            # needs Swift 5.9+
python3 scripts/ci/check_repo.py      # plists, privacy manifest, no tracked key material
docker compose up                     # same harness in a pinned swift image
```

A full app build on Linux goes through [xtool](https://github.com/xtool-org/xtool), as packaged for Omarchy by omarchy-apple-dev. `ios/omarchy-xtool` is a SwiftPM package that links the same sources:

```sh
xtool setup                           # signs in to Apple and installs the iOS SDK
cd ios/omarchy-xtool
xtool dev build                       # add --ipa for an .ipa, --sign to codesign
```

This path was not run while preparing this repository, because no iOS SDK was installed on the build machine. Signing and App Store upload still need an Apple Developer account.

## 7. MCP server

```sh
cd mcp
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests
DECK_FEEDS_ROOT="$PWD/../samples/home/.meshvault/status" .venv/bin/python run.py
```

`run.py` speaks MCP over stdio. Register it in your MCP client as a stdio server with the command `<checkout>/mcp/.venv/bin/python <checkout>/mcp/run.py`. Without `DECK_FEEDS_ROOT` it reads `~/.meshvault/status`. Every tool result carries the source file, its age and a stale flag.
