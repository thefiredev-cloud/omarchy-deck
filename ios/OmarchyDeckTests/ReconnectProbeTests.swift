import XCTest
@testable import OmarchyDeck

/// Probe schedule and generation fence. A miss advances the wait; an answer resets it.
/// Written, unexecuted: no Swift toolchain on pc-desktop.
final class ReconnectProbeTests: XCTestCase {
    private var defaultsSuites: [(name: String, defaults: UserDefaults)] = []

    override func tearDown() {
        for suite in defaultsSuites {
            suite.defaults.removePersistentDomain(forName: suite.name)
        }
        defaultsSuites.removeAll()
        super.tearDown()
    }

    /// Calls the same no-argument entry point as the app's scene-phase handler.
    /// Counts retry dispatch, not load completion; startup and StoreKit work are disabled.
    @MainActor
    func testDidBecomeActiveDispatchesExactlyOneRetryOnlyWhileOffline() throws {
        let suiteName = "ReconnectProbeTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaultsSuites.append((suiteName, defaults))
        let origin = try XCTUnwrap(URL(string: "https://deck.example.com/"))
        defaults.set([origin.absoluteString], forKey: "deck.savedOrigins.v1")
        defaults.set(origin.absoluteString, forKey: "deck.selectedOrigin.v1")
        var retryAttempts = 0
        let model = DeckModel(
            defaults: defaults, startsAutomatically: false,
            pro: ProEntitlement(startsAutomatically: false),
            retryAction: { retryAttempts += 1 },
            refreshOnActivation: {})
        XCTAssertEqual(model.connections, [origin])
        XCTAssertEqual(model.selectedOrigin, origin)
        XCTAssertEqual(model.phase, .starting)
        XCTAssertNil(model.webView)

        model.phase = .offline(reason: "Connection lost")
        model.didBecomeActive()
        XCTAssertEqual(retryAttempts, 1)
        for phase: DeckPhase in [.starting, .needsConnection, .needsToken(notice: nil),
                                 .needsToken(notice: "Sign in again."), .loading, .ready] {
            model.phase = phase
            model.didBecomeActive()
            XCTAssertEqual(retryAttempts, 1, "\(phase) must not dispatch a retry")
        }
        XCTAssertNil(model.webView, "The injected retry must not launch a WebKit load")
    }

    func testReconnectProbeDelayBacksOffThenCapsAndResetsOnSuccess() {
        XCTAssertEqual(DeckModel.reconnectProbeDelayMilliseconds, [1_200, 2_000, 3_500, 5_000])
        XCTAssertEqual(DeckModel.reconnectProbeDelayNanoseconds(afterFailures: 0), 1_200_000_000)
        XCTAssertEqual(DeckModel.reconnectProbeDelayNanoseconds(afterFailures: 1), 2_000_000_000)
        XCTAssertEqual(DeckModel.reconnectProbeDelayNanoseconds(afterFailures: 2), 3_500_000_000)
        XCTAssertEqual(DeckModel.reconnectProbeDelayNanoseconds(afterFailures: 3), 5_000_000_000)
        XCTAssertEqual(DeckModel.reconnectProbeDelayNanoseconds(afterFailures: 8), 5_000_000_000)
        XCTAssertEqual(DeckModel.reconnectProbeDelayNanoseconds(afterFailures: -1), 1_200_000_000)
        XCTAssertEqual(DeckModel.reconnectProbeFailures(after: 3, succeeded: true), 0)
        XCTAssertEqual(DeckModel.reconnectProbeDelayNanoseconds(afterFailures: DeckModel.reconnectProbeFailures(after: 3, succeeded: true)), 1_200_000_000)
        XCTAssertEqual(DeckModel.reconnectProbeFailures(after: 1, succeeded: false), 2)
        XCTAssertEqual(DeckModel.reconnectProbeFailures(after: -4, succeeded: false), 1)
    }

    func testBannerUpWaitHoldsAtTheSlowestStep() {
        // Banner down: the schedule is unchanged, so the first probe and each miss keep their steps.
        XCTAssertEqual(DeckModel.reconnectWaitNanoseconds(afterFailures: 0, reconnectReady: false), 1_200_000_000)
        XCTAssertEqual(DeckModel.reconnectWaitNanoseconds(afterFailures: 2, reconnectReady: false), 3_500_000_000)
        // Banner up: a host that already answered is not polled every 1.2s.
        XCTAssertEqual(DeckModel.reconnectWaitNanoseconds(afterFailures: 0, reconnectReady: true), 5_000_000_000)
        XCTAssertEqual(DeckModel.reconnectWaitNanoseconds(afterFailures: 1, reconnectReady: true), 5_000_000_000)
    }

    func testLateProbeCannotRaiseBannerAfterReconnectOrConnectionSwitch() {
        let original = URL(string: "https://deck.example.com/")!
        let replacement = URL(string: "https://other.example.com/")!
        XCTAssertTrue(DeckModel.shouldApplyProbeResult(
            generation: 4, activeGeneration: 4, phase: .offline(reason: "Connection lost"),
            origin: original, selectedOrigin: original))
        XCTAssertFalse(DeckModel.shouldApplyProbeResult(
            generation: 4, activeGeneration: 5, phase: .offline(reason: "Connection lost"),
            origin: original, selectedOrigin: original))
        XCTAssertFalse(DeckModel.shouldApplyProbeResult(
            generation: 4, activeGeneration: 4, phase: .loading,
            origin: original, selectedOrigin: original))
        XCTAssertFalse(DeckModel.shouldApplyProbeResult(
            generation: 4, activeGeneration: 4, phase: .ready,
            origin: original, selectedOrigin: original))
        XCTAssertFalse(DeckModel.shouldApplyProbeResult(
            generation: 4, activeGeneration: 4, phase: .offline(reason: "Connection lost"),
            origin: original, selectedOrigin: replacement))
    }

    /// A same-origin 3xx is the saved server answering while redirects stay blocked.
    /// An off-origin Location and a 5xx remain misses. Written, unexecuted.
    func testSameOriginRedirectCountsAsAliveAndOffOriginOrServerErrorDoesNot() {
        let origin = URL(string: "https://deck.example.com/")!
        let otherPort = URL(string: "https://deck.example.com:10443/")!
        XCTAssertTrue(DeckModel.probeAnswerIsAlive(statusCode: 302, location: "https://deck.example.com/", origin: origin))
        XCTAssertTrue(DeckModel.probeAnswerIsAlive(statusCode: 302, location: "/", origin: origin))
        XCTAssertTrue(DeckModel.probeAnswerIsAlive(statusCode: 301, location: "/index.html", origin: origin))
        XCTAssertTrue(DeckModel.probeAnswerIsAlive(statusCode: 302, location: "https://DECK.EXAMPLE.COM/", origin: origin))
        XCTAssertFalse(DeckModel.probeAnswerIsAlive(statusCode: 302, location: nil, origin: origin))
        XCTAssertFalse(DeckModel.probeAnswerIsAlive(statusCode: 302, location: "", origin: origin))
        XCTAssertFalse(DeckModel.probeAnswerIsAlive(statusCode: 302, location: "   ", origin: origin))
        XCTAssertFalse(DeckModel.probeAnswerIsAlive(statusCode: 302, location: "https://user:pass@deck.example.com/", origin: origin))
        // Trailing-dot host is the same DNS name. We still count it as a miss: it is not the saved origin string.
        XCTAssertFalse(DeckModel.probeAnswerIsAlive(statusCode: 302, location: "https://deck.example.com./", origin: origin))
        XCTAssertFalse(DeckModel.probeAnswerIsAlive(statusCode: 302, location: "javascript:alert(1)", origin: origin))
        XCTAssertFalse(DeckModel.probeAnswerIsAlive(statusCode: 302, location: " javascript:alert(1)", origin: origin))
        XCTAssertTrue(DeckModel.probeAnswerIsAlive(statusCode: 200, location: nil, origin: origin))
        XCTAssertTrue(DeckModel.probeAnswerIsAlive(statusCode: 401, location: nil, origin: origin))
        XCTAssertTrue(DeckModel.probeAnswerIsAlive(statusCode: 302, location: "https://deck.example.com:10443/", origin: otherPort))
        XCTAssertFalse(DeckModel.probeAnswerIsAlive(statusCode: 302, location: "https://evil.example/", origin: origin))
        XCTAssertFalse(DeckModel.probeAnswerIsAlive(statusCode: 302, location: "https://deck.example.com:10443/", origin: origin))
        XCTAssertFalse(DeckModel.probeAnswerIsAlive(statusCode: 302, location: "http://deck.example.com/", origin: origin))
        XCTAssertFalse(DeckModel.probeAnswerIsAlive(statusCode: 303, location: "//evil.example/phish", origin: origin))
        XCTAssertFalse(DeckModel.probeAnswerIsAlive(statusCode: 503, location: nil, origin: origin))
        XCTAssertFalse(DeckModel.probeAnswerIsAlive(statusCode: 500, location: "https://deck.example.com/", origin: origin))
        XCTAssertFalse(DeckModel.probeAnswerIsAlive(statusCode: nil, location: "https://deck.example.com/", origin: origin))
    }

    /// The probe call site must read Location through the case-insensitive header helper.
    /// Written, unexecuted.
    func testProbeHeaderReadsLowercaseLocation() {
        let origin = URL(string: "https://deck.example.com/")!
        let response = HTTPURLResponse(
            url: origin, statusCode: 302, httpVersion: "HTTP/1.1",
            headerFields: ["location": "https://deck.example.com/"])
        XCTAssertNotNil(response)
        let header = DeckModel.probeHeaderFields(from: response!)
        XCTAssertEqual(header.statusCode, 302)
        XCTAssertEqual(header.location, "https://deck.example.com/")
        XCTAssertTrue(DeckModel.probeAnswerIsAlive(
            statusCode: header.statusCode, location: header.location, origin: origin))
    }

    /// Exercises the response-classification path used by the loop, not just the header helper.
    /// No URLSession or WebView is needed. Written, unexecuted.
    func testProbeResponseUsesInjectedHeaderReader() throws {
        let origin = URL(string: "https://deck.example.com/")!
        let response = try XCTUnwrap(HTTPURLResponse(
            url: origin, statusCode: 503, httpVersion: "HTTP/1.1", headerFields: nil))
        var reads = 0
        XCTAssertTrue(DeckModel.probeResponseIsAlive(response, origin: origin) { received in
            reads += 1
            XCTAssertTrue(received === response)
            // Override both fields: reading the raw 503 or dropping Location must fail.
            return (statusCode: 302, location: "/")
        })
        XCTAssertEqual(reads, 1)
        XCTAssertFalse(DeckModel.probeResponseIsAlive(response, origin: origin) { _ in
            (statusCode: 302, location: "https://other.example.com/")
        })
    }

    func testProbeResponseDefaultReaderHandlesLowercaseLocation() throws {
        let origin = URL(string: "https://deck.example.com/")!
        for (location, expected) in [("/", true), ("https://other.example.com/", false)] {
            let response = try XCTUnwrap(HTTPURLResponse(
                url: origin, statusCode: 302, httpVersion: "HTTP/1.1",
                headerFields: ["location": location]))
            XCTAssertEqual(DeckModel.probeResponseIsAlive(response, origin: origin), expected)
        }
    }

    func testNonHTTPProbeResponseSkipsHeaderReader() {
        let origin = URL(string: "https://deck.example.com/")!
        let response = URLResponse(
            url: origin, mimeType: nil, expectedContentLength: 0, textEncodingName: nil)
        XCTAssertFalse(DeckModel.probeResponseIsAlive(response, origin: origin) { _ in
            XCTFail("A non-HTTP response must not reach the HTTP header reader")
            return (statusCode: 200, location: nil)
        })
    }

    func testProbeResponseDefaultReaderPreservesMissingLocationAndStatus() throws {
        let origin = URL(string: "https://deck.example.com/")!
        for (statusCode, expected) in [(302, false), (500, false), (204, true)] {
            let response = try XCTUnwrap(HTTPURLResponse(
                url: origin, statusCode: statusCode, httpVersion: "HTTP/1.1", headerFields: nil))
            XCTAssertEqual(
                DeckModel.probeResponseIsAlive(response, origin: origin), expected,
                "HTTP \(statusCode) without Location must retain its response policy")
        }
    }

    /// Foreground return retries only from the offline phase. The tester note depends on this:
    /// returning from a VPN switch may load the deck without the banner. Written, unexecuted.
    func testForegroundReturnRetriesOnlyWhileOffline() {
        XCTAssertTrue(DeckModel.shouldRetryOnActivation(phase: .offline(reason: "The deck did not answer in time.")))
        XCTAssertTrue(DeckModel.shouldRetryOnActivation(phase: .offline(reason: "")))
        for phase: DeckPhase in [.starting, .needsConnection, .needsToken(notice: nil),
                                 .needsToken(notice: "Sign in again to open the deck."), .loading, .ready] {
            XCTAssertFalse(DeckModel.shouldRetryOnActivation(phase: phase), "\(phase) must not retry on foreground")
        }
    }

    /// Real `retry()` body (DeckModel.swift:376-382), no injected retry action. With no saved deck,
    /// `openSelected` has no origin, so it must leave offline for the first-run state and touch no WebKit or network.
    /// Written, unexecuted.
    @MainActor
    func testRealRetryBodyLeavesOfflineWhenNoDeckIsSaved() async throws {
        let suiteName = "ReconnectProbeTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaultsSuites.append((suiteName, defaults))
        let model = DeckModel(
            defaults: defaults, startsAutomatically: false,
            pro: ProEntitlement(startsAutomatically: false),
            refreshOnActivation: {})
        XCTAssertNil(model.selectedOrigin)
        model.phase = .offline(reason: "Connection lost")
        model.retry()
        for _ in 0..<50 where model.phase != .needsConnection { await Task.yield() }
        XCTAssertEqual(model.phase, .needsConnection)
        XCTAssertNil(model.webView)
        XCTAssertFalse(model.reconnectReady)
    }

    /// The foreground path end to end through the real retry body: the scene calls `didBecomeActive`, an offline
    /// phase retries, any other phase is left alone. Written, unexecuted.
    @MainActor
    func testDidBecomeActiveReachesRealRetryOnlyWhileOffline() async throws {
        let suiteName = "ReconnectProbeTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaultsSuites.append((suiteName, defaults))
        let model = DeckModel(
            defaults: defaults, startsAutomatically: false,
            pro: ProEntitlement(startsAutomatically: false),
            refreshOnActivation: {})
        model.phase = .loading
        model.didBecomeActive()
        for _ in 0..<10 { await Task.yield() }
        XCTAssertEqual(model.phase, .loading, "A non-offline phase must not retry")
        model.phase = .offline(reason: "Connection lost")
        model.didBecomeActive()
        for _ in 0..<50 where model.phase != .needsConnection { await Task.yield() }
        XCTAssertEqual(model.phase, .needsConnection)
    }
}
