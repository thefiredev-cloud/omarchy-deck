import XCTest
#if canImport(OmarchyDeck)
@testable import OmarchyDeck
#else
@testable import LaneCore
#endif
#if canImport(WebKit)
import WebKit
import Combine
#endif

final class W3L23WebLoadWatchdogTests: XCTestCase {
    #if os(Linux)
    func testProductionNavigationArmsTheBoundedWatchdog() throws {
        let root = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath().deletingLastPathComponent().deletingLastPathComponent()
        let source = try String(contentsOf: root.appendingPathComponent("OmarchyDeck/DeckModel.swift"), encoding: .utf8)
        XCTAssertTrue(source.contains("loadGeneration.begin"), "User loads must arm the production watchdog")
        XCTAssertTrue(source.contains("loadGeneration.accepts(navigation:"), "Late WebKit completions must check navigation identity")
        XCTAssertTrue(source.contains("if phase != .loading { cancelUserLoad() }"))
        XCTAssertTrue(source.contains("loadGeneration.accepts(ticket: ticket, in: view)"), "Queued progress needs a generation guard")
        XCTAssertTrue(source.contains("replacesWebViewOnOpen = true"), "Expired response policies must not affect Retry")
        XCTAssertTrue(source.contains("bytes.task.cancel()"), "Reconnect probes stay headers-only")
        XCTAssertTrue(source.contains("\"action\": [\"type\": \"block\"]"), "Default-deny rules stay installed")
    }
    #endif

    #if canImport(WebKit) && DEBUG
    /// WebKit fires estimatedProgress many times per second; the model must queue one MainActor task per wave.
    func testProgressTicksCoalesceToOneQueuedTaskPerWave() {
        let box = DeckProgressCoalescer()
        for i in 0..<100 { _ = box.record(Double(i) / 100) }
        XCTAssertEqual(box.scheduledTaskCount, 1)
        XCTAssertEqual(box.take(), 0.99)
        XCTAssertTrue(box.record(1))
        XCTAssertEqual(box.scheduledTaskCount, 2)
        XCTAssertEqual(box.take(), 1)
    }
    #endif

    @MainActor
    private final class Clock {
        var waits: [UInt64] = []
        var pending: [CheckedContinuation<Void, Never>] = []
        var entered: XCTestExpectation?

        func sleep(_ delay: UInt64) async throws {
            try Task.checkCancellation()
            waits.append(delay)
            await withCheckedContinuation { continuation in
                pending.append(continuation)
                entered?.fulfill()
            }
        }

        func release() {
            let continuations = pending
            pending.removeAll()
            continuations.forEach { $0.resume() }
        }
    }

    @MainActor
    func testNeverCompletingNavigationExpiresOnce() async throws {
        let clock = Clock()
        clock.entered = expectation(description: "Deadline armed")
        let load = W3DeckLoadGeneration()
        let view = NSObject()
        let navigation = NSObject()
        var timeouts = 0
        let ticket = load.begin(in: view, sleep: clock.sleep) { _ in timeouts += 1 }
        load.bind(navigation: navigation, to: ticket)
        let task = try XCTUnwrap(load.deadlineTask)
        await fulfillment(of: [clock.entered!], timeout: 1)
        XCTAssertEqual(clock.waits, [30_000_000_000])
        XCTAssertTrue(load.accepts(navigation: navigation, in: view))
        clock.release()
        await task.value
        XCTAssertEqual(timeouts, 1)
        XCTAssertNil(load.active)
        XCTAssertNil(load.deadlineTask)
        XCTAssertFalse(load.accepts(navigation: navigation, in: view))
    }

    @MainActor
    func testLateACompletionCannotMakeBReadyOnTheSameView() async throws {
        let clock = Clock()
        let load = W3DeckLoadGeneration()
        let view = NSObject()
        let a = NSObject(), b = NSObject()
        var expired: [W3DeckLoadGeneration.Ticket] = []
        clock.entered = expectation(description: "A waiting")
        let ticketA = load.begin(in: view, sleep: clock.sleep) { expired.append($0) }
        load.bind(navigation: a, to: ticketA)
        let taskA = try XCTUnwrap(load.deadlineTask)
        await fulfillment(of: [clock.entered!], timeout: 1)
        clock.entered = expectation(description: "B waiting")
        let ticketB = load.begin(in: view, sleep: clock.sleep) { expired.append($0) }
        load.bind(navigation: b, to: ticketB)
        let taskB = try XCTUnwrap(load.deadlineTask)
        await fulfillment(of: [clock.entered!], timeout: 1)
        XCTAssertFalse(load.accepts(navigation: a, in: view))
        XCTAssertFalse(load.accepts(ticket: ticketA, in: view), "Queued A progress is stale")
        XCTAssertTrue(load.accepts(navigation: b, in: view))
        XCTAssertTrue(load.accepts(ticket: ticketB, in: view))
        load.bind(navigation: a, to: ticketA)
        XCTAssertTrue(load.accepts(navigation: b, in: view), "Late binding cannot replace B")
        load.cancel()
        clock.release()
        await taskA.value
        await taskB.value
        XCTAssertTrue(expired.isEmpty)
    }


    @MainActor
    func testCancelledDeadlineCannotExpireReplacementLoad() async throws {
        let clock = Clock()
        let load = W3DeckLoadGeneration()
        let view = NSObject()
        let navigationA = NSObject(), navigationB = NSObject()
        var expired: [W3DeckLoadGeneration.Ticket] = []
        clock.entered = expectation(description: "A waiting")
        let ticketA = load.begin(in: view, sleep: clock.sleep) { expired.append($0) }
        load.bind(navigation: navigationA, to: ticketA)
        let taskA = try XCTUnwrap(load.deadlineTask)
        await fulfillment(of: [clock.entered!], timeout: 1)

        clock.entered = expectation(description: "B waiting")
        let ticketB = load.begin(in: view, sleep: clock.sleep) { expired.append($0) }
        load.bind(navigation: navigationB, to: ticketB)
        let taskB = try XCTUnwrap(load.deadlineTask)
        await fulfillment(of: [clock.entered!], timeout: 1)

        clock.pending.removeFirst().resume()
        await taskA.value
        XCTAssertTrue(expired.isEmpty)
        XCTAssertTrue(load.accepts(ticket: ticketB, in: view))
        XCTAssertTrue(load.accepts(navigation: navigationB, in: view))

        load.cancel()
        clock.release()
        await taskB.value
    }


    @MainActor
    func testReplacedViewAndNilNavigationNeverCompleteCurrentLoad() async throws {
        let clock = Clock()
        clock.entered = expectation(description: "Waiting")
        let load = W3DeckLoadGeneration()
        let oldView = NSObject(), view = NSObject(), navigation = NSObject()
        let ticket = load.begin(in: view, sleep: clock.sleep) { _ in XCTFail("Cancelled load expired") }
        load.bind(navigation: navigation, to: ticket)
        let task = try XCTUnwrap(load.deadlineTask)
        await fulfillment(of: [clock.entered!], timeout: 1)
        XCTAssertFalse(load.accepts(navigation: navigation, in: oldView))
        XCTAssertFalse(load.accepts(ticket: ticket, in: oldView))
        XCTAssertFalse(load.accepts(navigation: nil, in: view))
        load.cancel()
        XCTAssertFalse(load.accepts(navigation: navigation, in: view))
        clock.release()
        await task.value
    }

    #if canImport(WebKit)
    @MainActor
    private func makeModel(clock: Clock, loaded: @escaping () -> Void) async throws -> DeckModel {
        let name = "W3L23.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        addTeardownBlock { defaults.removePersistentDomain(forName: name) }
        defaults.set(["https://deck.example.com:10443/"], forKey: "deck.savedOrigins.v1")
        defaults.set("https://deck.example.com:10443/", forKey: "deck.selectedOrigin.v1")
        defaults.set(true, forKey: DeckModel.legacyMigrationKey(
            for: try XCTUnwrap(URL(string: "https://deck.example.com:10443/"))))
        let model = DeckModel(defaults: defaults, pro: ProEntitlement(startsAutomatically: false),
                              reconnectCookies: { _ in nil }, loadSleep: clock.sleep,
                              loadNavigation: { _, _ in loaded(); return nil })
        let prepared = expectation(description: "Rules installed without network navigation")
        let observation = model.$phase.sink { phase in
            if case .needsToken = phase { prepared.fulfill() }
        }
        await fulfillment(of: [prepared], timeout: 5)
        observation.cancel()
        XCTAssertNotNil(model.webView)
        return model
    }

    @MainActor
    func testModelTimeoutShowsOfflineAndRetryDispatchesOneNavigation() async throws {
        let clock = Clock()
        var loads = 0
        let model = try await makeModel(clock: clock) { loads += 1 }
        defer { model.beginDemo(); clock.release() }
        let view = try XCTUnwrap(model.webView)
        let cookie = try XCTUnwrap(HTTPCookie(properties: [
            .name: "pdeck", .value: "synthetic-session", .domain: "deck.example.com",
            .path: "/", .secure: "TRUE", .expires: Date(timeIntervalSinceNow: 60)
        ]))
        await view.configuration.websiteDataStore.httpCookieStore.setCookie(cookie)
        addTeardownBlock { @MainActor in
            await view.configuration.websiteDataStore.httpCookieStore.deleteCookie(cookie)
        }
        clock.entered = expectation(description: "User navigation waits")
        model.submit(token: "synthetic-token")
        await fulfillment(of: [clock.entered!], timeout: 1)
        XCTAssertEqual(model.phase, .loading)
        let offline = expectation(description: "Never-finishing load reaches Retry")
        let observation = model.$phase.sink { phase in
            if case .offline = phase { offline.fulfill() }
        }
        clock.release()
        await fulfillment(of: [offline], timeout: 1)
        observation.cancel()
        XCTAssertEqual(model.phase, .offline(reason: W3DeckLoadGeneration.timeoutReason))
        XCTAssertEqual(loads, 1)
        clock.entered = expectation(description: "Retry navigation waits")
        model.retry()
        model.retry()
        await fulfillment(of: [clock.entered!], timeout: 5)
        XCTAssertEqual(model.phase, .loading)
        XCTAssertEqual(loads, 2, "One Retry dispatch, not two tasks or a WebKit reload plus a load")
        XCTAssertFalse(model.webView === view, "Retry must detach the view that can still send an expired response")
    }

    @MainActor
    func testReadyOfflineAndTokenTransitionsCancelTheDeadline() async throws {
        let clock = Clock()
        let model = try await makeModel(clock: clock) {}
        defer { model.beginDemo(); clock.release() }
        let destinations: [DeckPhase] = [.ready, .offline(reason: "Synthetic outage"), .needsToken(notice: nil)]
        for destination in destinations {
            clock.entered = expectation(description: "Waiting before \(destination)")
            model.submit(token: "synthetic-token")
            await fulfillment(of: [clock.entered!], timeout: 1)
            model.phase = destination
            clock.release()
            await Task.yield()
            XCTAssertEqual(model.phase, destination)
        }
    }

    @MainActor
    func testDemoCancelsTheModelsWaitingNavigation() async throws {
        let clock = Clock()
        let model = try await makeModel(clock: clock) {}
        clock.entered = expectation(description: "Waiting")
        model.submit(token: "synthetic-token")
        await fulfillment(of: [clock.entered!], timeout: 1)
        model.beginDemo()
        clock.release()
        await Task.yield()
        XCTAssertTrue(model.isDemo)
        XCTAssertNotEqual(model.phase, .loading)
        XCTAssertNil(model.webView)
        if case .offline = model.phase { XCTFail("Demo inherited the old timeout") }
    }
    #endif
}
