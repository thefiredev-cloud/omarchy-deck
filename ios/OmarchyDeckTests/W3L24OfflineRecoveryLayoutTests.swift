import XCTest
@testable import OmarchyDeck

/// Offline recovery: Reconnect only when the model says the deck answered, the action never scrolls away,
/// recovery is spoken once, and the hidden page is neither read nor tappable behind the native screens.
/// The first three groups run on Linux through the Foundation types in OfflineCause.swift. The last group reads the
/// SwiftUI sources as text, because SwiftUI cannot be built on Linux: it pins the wiring, not the rendered layout.
final class W3L24OfflineRecoveryLayoutTests: XCTestCase {
    // MARK: Which action

    func testReconnectOnlyAppearsWhenTheModelSaysTheDeckAnswered() {
        XCTAssertEqual(OfflinePrimaryAction(reconnectReady: false), .retry)
        XCTAssertEqual(OfflinePrimaryAction(reconnectReady: true), .reconnect)
        XCTAssertEqual(OfflinePrimaryAction.retry.title, "Retry")
        XCTAssertEqual(OfflinePrimaryAction.reconnect.title, "Reconnect")
        XCTAssertEqual(OfflinePrimaryAction.retry.identifier, "offline.retry")
        XCTAssertEqual(OfflinePrimaryAction.reconnect.identifier, "reconnect.open")
    }

    // MARK: Where the action sits

    func testActionStaysPinnedBelowTheTextOnATallScreenAndBesideItOnAShortOne() {
        XCTAssertEqual(OfflineActionPlacement(isCompactHeight: false), .bottomBar)
        XCTAssertEqual(OfflineActionPlacement(isCompactHeight: true), .trailingColumn)
    }

    // MARK: Spoken once

    func testFocusStartsOnTheCauseUnlessTheDeckAlreadyAnswered() {
        var gate = OfflineSpeechGate()
        XCTAssertEqual(gate.focusOnAppear(reconnectReady: false), .cause)
        var answered = OfflineSpeechGate()
        XCTAssertEqual(answered.focusOnAppear(reconnectReady: true), .banner)
    }

    func testBannerThatAppearsLaterIsAnnouncedOnce() {
        var gate = OfflineSpeechGate()
        _ = gate.focusOnAppear(reconnectReady: false)
        XCTAssertFalse(gate.shouldAnnounceBanner(reconnectReady: false))
        XCTAssertTrue(gate.shouldAnnounceBanner(reconnectReady: true))
        XCTAssertFalse(gate.shouldAnnounceBanner(reconnectReady: true), "A repeated change must not speak again")
    }

    func testBannerFocusedOnAppearIsNotAnnouncedOnTop() {
        var gate = OfflineSpeechGate()
        XCTAssertEqual(gate.focusOnAppear(reconnectReady: true), .banner)
        XCTAssertFalse(gate.shouldAnnounceBanner(reconnectReady: true), "Focus already reads it")
    }

    func testDroppingBackIsSilentAndALaterReturnSpeaksAgain() {
        var gate = OfflineSpeechGate()
        _ = gate.focusOnAppear(reconnectReady: false)
        XCTAssertTrue(gate.shouldAnnounceBanner(reconnectReady: true))
        XCTAssertFalse(gate.shouldAnnounceBanner(reconnectReady: false), "Nothing is said when the banner drops back")
        XCTAssertTrue(gate.shouldAnnounceBanner(reconnectReady: true), "The deck answered again, which is news")
    }

    // MARK: Wiring (SwiftUI sources read as text)

    func testPageIsHiddenAndUntouchableUntilReady() throws {
        let content = try Self.source("ContentView.swift")
        // I15: the page shows once ready, and stays during an in-place reload; never while starting, offline or on the token screen.
        XCTAssertTrue(content.contains("deck.phase == .ready || (deck.phase == .loading && deck.keepsPageVisible)"))
        XCTAssertTrue(content.contains(".opacity(pageShowing ? 1 : 0)"))
        XCTAssertTrue(content.contains(".allowsHitTesting(pageShowing)"),
                      "A hidden page must not take touches behind loading or offline")
        XCTAssertTrue(content.contains(".accessibilityHidden(!pageShowing)"),
                      "VoiceOver must not read a hidden page's controls behind loading or offline")
        XCTAssertTrue(content.contains(".allowsHitTesting(tokenFieldIsReachable)"),
                      "The token field must not stay tappable after the deck is showing")
        XCTAssertTrue(content.contains("if case .needsToken = deck.phase"),
                      "tokenFieldIsReachable is true only on the token screen")
    }

    func testSavedPictureIsNeverCalledLive() throws {
        let content = try Self.source("ContentView.swift")
        XCTAssertTrue(content.contains("Last saved picture, not live"))
        XCTAssertFalse(content.localizedCaseInsensitiveContains("live picture"))
    }

    func testOfflineScreenUsesThePureRecoveryPolicy() throws {
        let view = try Self.source("OfflineView.swift")
        XCTAssertTrue(view.contains("OfflinePrimaryAction(reconnectReady: deck.reconnectReady)"))
        XCTAssertTrue(view.contains("OfflineActionPlacement(isCompactHeight: verticalSize == .compact)"))
        XCTAssertTrue(view.contains("speech.focusOnAppear(reconnectReady: deck.reconnectReady)"))
        XCTAssertTrue(view.contains("speech.shouldAnnounceBanner(reconnectReady: ready)"))
        XCTAssertTrue(view.contains(".accessibilityFocused($focus, equals: .cause)"))
        XCTAssertTrue(view.contains(".accessibilityFocused($focus, equals: .banner)"))
        // Reconnect has one source: the policy enum. The view must not draw it from a literal of its own.
        XCTAssertFalse(view.contains("Button(\"Reconnect\")"))
        XCTAssertFalse(view.contains("Button(Banner.action)"))
    }

    func testReasonAndNextStepsNeverTruncateAtLargeTextSizes() throws {
        let view = try Self.source("OfflineView.swift")
        for forbidden in ["lineLimit(", "minimumScaleFactor", "truncationMode", "dynamicTypeSize("] {
            XCTAssertFalse(view.contains(forbidden), "\(forbidden) would cut the reason or the next steps")
        }
        let reason = try XCTUnwrap(view.range(of: "Text(reason)"))
        let reasonModifiers = String(view[reason.upperBound...].prefix(260))
        XCTAssertTrue(reasonModifiers.contains(".fixedSize(horizontal: false, vertical: true)"),
                      "The full reason must wrap, not clip")
    }

    func testSignOutStillNeedsTheExplicitConfirmation() throws {
        let view = try Self.source("OfflineView.swift")
        XCTAssertEqual(view.components(separatedBy: "deck.signOut()").count - 1, 1,
                       "Signing out must be reachable from exactly one place")
        XCTAssertEqual(view.components(separatedBy: "confirmingSignOut = true").count - 1, 1)
        let alert = try XCTUnwrap(view.range(of: ".alert(\"Sign in again?\", isPresented: $confirmingSignOut)"))
        let signOut = try XCTUnwrap(view.range(of: "deck.signOut()"))
        XCTAssertTrue(alert.upperBound <= signOut.lowerBound, "The sign-out call must sit inside the confirmation alert")
        XCTAssertTrue(view.contains("Button(\"Keep waiting\", role: .cancel)"))
    }

    // MARK: Source lookup

    /// The app sources sit beside the test folder in the Xcode project and two levels up in a Linux harness package
    /// that links this file. Either way the sources are found relative to this file, never by a fixed machine path.
    private static func source(_ name: String, file: StaticString = #filePath) throws -> String {
        var folder = URL(fileURLWithPath: "\(file)").deletingLastPathComponent()
        for _ in 0..<3 {
            let candidate = folder.appendingPathComponent("OmarchyDeck").appendingPathComponent(name)
            if let text = try? String(contentsOf: candidate, encoding: .utf8) { return text }
            folder = folder.deletingLastPathComponent()
        }
        throw SourceNotFound(description: "OmarchyDeck/\(name) not found next to \(file)")
    }

    private struct SourceNotFound: Error, CustomStringConvertible {
        let description: String
    }
}
