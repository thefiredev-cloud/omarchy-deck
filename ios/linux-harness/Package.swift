// swift-tools-version:5.9
// Linux harness for the Foundation-only Omarchy Deck types. Sources are relative symlinks into the app
// and test folders, so the app code runs unmodified. The library target is named `OmarchyDeck` so the existing
// `@testable import OmarchyDeck` lines compile without edits. Run with scripts/linux-test.sh.
import PackageDescription

let package = Package(
    name: "OmarchyDeckLinuxHarness",
    targets: [
        .target(
            name: "OmarchyDeck",
            path: "Sources/OmarchyDeck"
        ),
        .testTarget(
            name: "OmarchyDeckTests",
            dependencies: ["OmarchyDeck"],
            path: "Tests/OmarchyDeckTests",
            // XCTest discovery on Linux force-casts every test method to `(Self) -> () throws -> ()`, which
            // traps on a `@MainActor` test class and aborts the whole bundle before any test runs. Both
            // files below are `@MainActor`; the Mac simulator run still executes them.
            exclude: [
                "W3L29WatchActionSingleStateTests.swift",
                "WatchActionsTests.swift",
            ]
        ),
    ]
)
