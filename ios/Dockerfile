# syntax=docker/dockerfile:1
# Reproducible Linux Swift toolchain for the Omarchy Deck Foundation harness (linux-harness/).
#
# What linux-harness/ is: a SwiftPM package whose Sources and Tests are relative symlinks into the app
# (OmarchyDeck/), the shared watch types (Shared/) and the app unit tests (OmarchyDeckTests/). It builds
# only the files that compile without SwiftUI, UIKit, WebKit or WatchConnectivity, so the Foundation
# logic and its tests run on Linux with no simulator. scripts/linux-test.sh is the repo's entry point.
#
# Runs here: `swift build`, `swift test` and scripts/linux-test.sh.
# Cannot run here: the OmarchyDeck app, OmarchyDeckTests, OmarchyDeckUITests and OmarchyDeckWatch need
# SwiftUI, UIKit, WebKit, StoreKit and Xcode. Xcode is macOS-only and Apple's license limits macOS to
# Apple hardware, so those stay on a Mac. .xcode-version plus scripts/check-ios-toolchain.sh pin it.
#
# Build:  docker build --target test -t omarchy-deck-linux-harness .
# Run:    docker run --rm omarchy-deck-linux-harness

ARG SWIFT_IMAGE=swift:6.2.4@sha256:d6f8f6112e9a63da0a4a151d6b93acd16699d35c0b82531ac1a245f5af210197

FROM ${SWIFT_IMAGE} AS build

# The image never runs as root: the build itself runs as `runner`, so no root-owned build cache or
# SwiftPM lock file is left for the runtime user to trip over.
ARG USER_ID=10001
RUN groupadd --gid "${USER_ID}" runner \
 && useradd --uid "${USER_ID}" --gid "${USER_ID}" --create-home --shell /bin/bash runner

WORKDIR /src
RUN chown "${USER_ID}:${USER_ID}" /src
ENV SWIFT_DETERMINISTIC_HASHING=1

# Resolve first so a source-only change reuses the dependency layer.
COPY --chown=${USER_ID}:${USER_ID} linux-harness/Package.swift linux-harness/

USER runner
RUN swift package --package-path linux-harness resolve

# The harness sources are symlinks into the app and test folders, so the context is the repository root.
COPY --chown=${USER_ID}:${USER_ID} . .
RUN swift build --package-path linux-harness --build-tests

FROM build AS test

USER runner
WORKDIR /src
# The same command scripts/linux-test.sh runs, without its output filter, so a failure keeps its full
# message. AppVersionTests is skipped because it reads PrivacyInfo.xcprivacy from the built app bundle,
# which only exists on the Mac; the full OmarchyDeckTests run there still checks it.
ENTRYPOINT ["swift", "test", "--package-path", "linux-harness", "-j", "2", "--skip", "testBuiltAppIncludesEveryRequiredReasonDeclaration"]
