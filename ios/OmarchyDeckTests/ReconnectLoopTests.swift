import XCTest
import WebKit
@testable import OmarchyDeck

/// Exercises the real DeckModel loop. Only waiting, cookie I/O and transport are replaced.
/// Written on Linux; native execution is blocked pending the authorized Mini route.
final class ReconnectLoopTests: XCTestCase {
    @MainActor
    private final class IO {
        var waits: [UInt64] = []
        var sleeps: [XCTestExpectation] = []
        var pendingSleep: CheckedContinuation<Void, Never>?
        var cookies: [HTTPCookie] = []
        var cookieReads = 0
        var cookieReached: XCTestExpectation?
        var pendingCookies: CheckedContinuation<[HTTPCookie]?, Never>?
        var requests: [URLRequest] = []
        var responseReached: XCTestExpectation?
        var pendingResponse: CheckedContinuation<URLResponse, Error>?
        var status = 503
        /// Counts `retry()` calls: the injected retry action keeps the real retry body (and WebKit) out of the loop.
        var retries = 0
        var error: Error?

        func sleep(_ nanoseconds: UInt64) async throws {
            waits.append(nanoseconds)
            await withCheckedContinuation { continuation in
                pendingSleep = continuation
                if waits.count <= sleeps.count { sleeps[waits.count - 1].fulfill() }
            }
        }

        func readCookies(_ view: WKWebView?) async -> [HTTPCookie]? {
            cookieReads += 1
            if let cookieReached {
                return await withCheckedContinuation { continuation in
                    pendingCookies = continuation
                    cookieReached.fulfill()
                }
            }
            return cookies
        }

        func response(_ request: URLRequest) async throws -> URLResponse {
            requests.append(request)
            if let responseReached {
                return try await withCheckedThrowingContinuation { continuation in
                    pendingResponse = continuation
                    responseReached.fulfill()
                }
            }
            if let error { throw error }
            return HTTPURLResponse(url: request.url!, statusCode: status,
                                   httpVersion: "HTTP/1.1", headerFields: nil)!
        }

        func advance() {
            let continuation = pendingSleep
            pendingSleep = nil
            continuation?.resume()
        }

        func cleanUp(_ model: DeckModel) {
            model.phase = .ready
            advance()
            pendingCookies?.resume(returning: cookies)
            pendingCookies = nil
            pendingResponse?.resume(throwing: CancellationError())
            pendingResponse = nil
        }
    }

    @MainActor
    private func makeModel(_ io: IO) throws -> DeckModel {
        let name = "ReconnectLoopTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        addTeardownBlock { defaults.removePersistentDomain(forName: name) }
        defaults.set(["https://deck.example.com:10443/"], forKey: "deck.savedOrigins.v1")
        defaults.set("https://deck.example.com:10443/", forKey: "deck.selectedOrigin.v1")
        return DeckModel(defaults: defaults, startsAutomatically: false,
                         pro: ProEntitlement(startsAutomatically: false),
                         retryAction: { [weak io] in io?.retries += 1 },
                         refreshOnActivation: {}, reconnectSleep: io.sleep,
                         reconnectCookies: io.readCookies, reconnectResponse: io.response)
    }

    @MainActor
    func testOnlyHostFailureStartsTheReconnectLoop() async throws {
        let io = IO()
        let model = try makeModel(io)
        defer { io.cleanUp(model) }
        model.showOffline(reason: "Local rule failure", probeHost: false)
        XCTAssertEqual(model.phase, .offline(reason: "Local rule failure"))
        XCTAssertNil(model.probeTask, "Local rule failure must not schedule a task")
        XCTAssertTrue(io.waits.isEmpty)
        XCTAssertEqual(io.cookieReads, 0)
        XCTAssertTrue(io.requests.isEmpty)

        model.phase = .starting
        let firstSleep = expectation(description: "Host failure starts a probe")
        io.sleeps = [firstSleep]
        model.showOffline(reason: "Host unavailable", probeHost: true)
        await fulfillment(of: [firstSleep], timeout: 1)
        XCTAssertEqual(io.waits, [1_200_000_000])
        XCTAssertEqual(io.cookieReads, 0, "Cookie I/O must wait for the timer")
    }

    @MainActor
    func testLoopBacksOffCapsResetsAndHidesBannerOnLaterMiss() async throws {
        let io = IO()
        let model = try makeModel(io)
        defer { io.cleanUp(model) }
        io.sleeps = (0..<7).map { expectation(description: "Wait \($0)") }
        model.showOffline(reason: "Host unavailable", probeHost: true)
        await fulfillment(of: [io.sleeps[0]], timeout: 1)
        for step in 1...4 {
            io.error = step == 2 ? URLError(.timedOut) : nil
            io.advance()
            await fulfillment(of: [io.sleeps[step]], timeout: 1)
            XCTAssertFalse(model.reconnectReady)
        }
        // Another offline reason must not restart the task or reset its backoff.
        model.showOffline(reason: "Still unavailable", probeHost: true)
        io.error = nil
        io.status = 401
        io.advance()
        await fulfillment(of: [io.sleeps[5]], timeout: 1)
        XCTAssertTrue(model.reconnectReady, "401 proves the saved host answered")
        XCTAssertEqual(model.phase, .offline(reason: "Still unavailable"))
        XCTAssertEqual(io.retries, 1, "The first answer of an outage reconnects once by itself (I1)")
        io.status = 503
        io.advance()
        await fulfillment(of: [io.sleeps[6]], timeout: 1)
        XCTAssertFalse(model.reconnectReady)
        // The banner-up wait holds at 5s. The miss after it returns to the 2s step.
        XCTAssertEqual(io.waits, [1_200_000_000, 2_000_000_000, 3_500_000_000,
                                  5_000_000_000, 5_000_000_000, 5_000_000_000, 2_000_000_000])
        XCTAssertEqual(io.requests.count, 6)
    }

    /// I1: the deck came back. The active scene reconnects once with no tap; later answers in the same outage only
    /// show the banner, so a deck that answers the probe but keeps failing its load never loops.
    @MainActor
    func testFirstAnswerReconnectsOnceWhileActiveAndNeverLoops() async throws {
        let io = IO()
        let model = try makeModel(io)
        defer { io.cleanUp(model) }
        io.sleeps = (0..<4).map { expectation(description: "Wait \($0)") }
        model.showOffline(reason: "Host unavailable", probeHost: true)
        await fulfillment(of: [io.sleeps[0]], timeout: 1)
        io.status = 200
        io.advance()
        await fulfillment(of: [io.sleeps[1]], timeout: 1)
        XCTAssertTrue(model.reconnectReady)
        XCTAssertEqual(io.retries, 1, "A restarted server returns the deck without a Reconnect tap")
        io.status = 503
        io.advance()
        await fulfillment(of: [io.sleeps[2]], timeout: 1)
        XCTAssertFalse(model.reconnectReady)
        io.status = 200
        io.advance()
        await fulfillment(of: [io.sleeps[3]], timeout: 1)
        XCTAssertTrue(model.reconnectReady, "The banner still says the deck is back")
        XCTAssertEqual(io.retries, 1, "One automatic Reconnect per outage; Reconnect stays a manual tap after it")
    }

    /// A scene that is not on screen leaves the answer to the banner; activation retries an offline deck itself.
    @MainActor
    func testInactiveSceneWaitsForActivation() async throws {
        let io = IO()
        let model = try makeModel(io)
        defer { io.cleanUp(model) }
        model.didResignActive()
        io.sleeps = (0..<2).map { expectation(description: "Wait \($0)") }
        model.showOffline(reason: "Host unavailable", probeHost: true)
        await fulfillment(of: [io.sleeps[0]], timeout: 1)
        io.status = 401
        io.advance()
        await fulfillment(of: [io.sleeps[1]], timeout: 1)
        XCTAssertTrue(model.reconnectReady)
        XCTAssertEqual(io.retries, 0, "No automatic Reconnect while the app is in the background")
        model.didBecomeActive()
        XCTAssertEqual(io.retries, 1, "Activation retries the offline deck, as before")
    }

    func testAutoReconnectPolicy() {
        XCTAssertTrue(DeckModel.shouldAutoReconnect(answered: true, sceneIsActive: true, alreadyUsed: false, enabled: true))
        XCTAssertFalse(DeckModel.shouldAutoReconnect(answered: false, sceneIsActive: true, alreadyUsed: false, enabled: true))
        XCTAssertFalse(DeckModel.shouldAutoReconnect(answered: true, sceneIsActive: false, alreadyUsed: false, enabled: true))
        XCTAssertFalse(DeckModel.shouldAutoReconnect(answered: true, sceneIsActive: true, alreadyUsed: true, enabled: true))
        XCTAssertFalse(DeckModel.shouldAutoReconnect(answered: true, sceneIsActive: true, alreadyUsed: false, enabled: false))
    }

    @MainActor
    func testLoopReadsFreshCookiesAndSendsOnlyTheSelectedHostsSession() async throws {
        let io = IO()
        let model = try makeModel(io)
        defer { io.cleanUp(model) }
        func cookie(_ name: String, _ value: String, _ domain: String, expired: Bool = false) -> HTTPCookie {
            HTTPCookie(properties: [.name: name, .value: value, .domain: domain,
                                   .path: "/", .expires: Date(timeIntervalSinceNow: expired ? -60 : 3600)])!
        }
        io.cookies = [cookie("pdeck", "wrong-host", "other.example.com"),
                      cookie("pdeck", "expired", "deck.example.com", expired: true),
                      cookie("other", "wrong-name", "deck.example.com"),
                      cookie("pdeck", "fixture-session", ".deck.example.com")]
        io.sleeps = (0..<3).map { expectation(description: "Cookie cycle \($0)") }
        model.showOffline(reason: "Host unavailable", probeHost: true)
        await fulfillment(of: [io.sleeps[0]], timeout: 1)
        io.advance()
        await fulfillment(of: [io.sleeps[1]], timeout: 1)
        let request = try XCTUnwrap(io.requests.first)
        XCTAssertEqual(request.url?.absoluteString, "https://deck.example.com:10443/")
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "pdeck=fixture-session")
        io.cookies = []
        io.advance()
        await fulfillment(of: [io.sleeps[2]], timeout: 1)
        XCTAssertEqual(io.cookieReads, 2)
        XCTAssertEqual(io.requests.count, 2)
        XCTAssertNil(io.requests.last?.value(forHTTPHeaderField: "Cookie"))
    }

    @MainActor
    func testLeavingOfflineDuringSleepSkipsCookiesAndRequest() async throws {
        let io = IO()
        let model = try makeModel(io)
        defer { io.cleanUp(model) }
        io.sleeps = [expectation(description: "Sleeping")]
        model.showOffline(reason: "Host unavailable", probeHost: true)
        await fulfillment(of: io.sleeps, timeout: 1)
        let task = try XCTUnwrap(model.probeTask)
        model.phase = .ready
        io.advance()
        await task.value
        XCTAssertNil(model.probeTask)
        XCTAssertEqual(io.waits.count, 1)
        XCTAssertEqual(io.cookieReads, 0)
        XCTAssertTrue(io.requests.isEmpty)
        XCTAssertFalse(model.reconnectReady)
    }

    @MainActor
    func testLeavingOfflineDuringCookieReadSkipsRequest() async throws {
        let io = IO()
        let model = try makeModel(io)
        defer { io.cleanUp(model) }
        io.cookieReached = expectation(description: "Cookie read suspended")
        io.sleeps = [expectation(description: "Sleeping")]
        model.showOffline(reason: "Host unavailable", probeHost: true)
        await fulfillment(of: io.sleeps, timeout: 1)
        io.advance()
        await fulfillment(of: [io.cookieReached!], timeout: 1)
        let task = try XCTUnwrap(model.probeTask)
        model.phase = .ready
        io.pendingCookies?.resume(returning: [])
        io.pendingCookies = nil
        await task.value
        XCTAssertNil(model.probeTask)
        XCTAssertEqual(io.waits.count, 1)
        XCTAssertTrue(io.requests.isEmpty)
        XCTAssertFalse(model.reconnectReady)
    }

    @MainActor
    func testLateResponseCannotRaiseBannerAfterLeavingOffline() async throws {
        let io = IO()
        let model = try makeModel(io)
        defer { io.cleanUp(model) }
        io.responseReached = expectation(description: "Request suspended")
        io.sleeps = [expectation(description: "Sleeping")]
        model.showOffline(reason: "Host unavailable", probeHost: true)
        await fulfillment(of: io.sleeps, timeout: 1)
        io.advance()
        await fulfillment(of: [io.responseReached!], timeout: 1)
        let task = try XCTUnwrap(model.probeTask)
        model.phase = .ready
        let response = try XCTUnwrap(HTTPURLResponse(url: model.selectedOrigin!, statusCode: 200,
                                                    httpVersion: "HTTP/1.1", headerFields: nil))
        io.pendingResponse?.resume(returning: response)
        io.pendingResponse = nil
        await task.value
        XCTAssertNil(model.probeTask)
        XCTAssertEqual(io.waits.count, 1)
        XCTAssertEqual(io.requests.count, 1)
        XCTAssertFalse(model.reconnectReady)
        XCTAssertEqual(model.phase, .ready)
    }
}
