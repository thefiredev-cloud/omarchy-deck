import XCTest
@testable import OmarchyDeck

/// Offline recovery rules for a home server reached over Tailscale or HTTPS:
/// failure wording, a web-content process that dies mid-load, and sessions of removed decks.
final class DeckConnectionRecoveryTests: XCTestCase {
    private func urlError(_ code: Int) -> NSError {
        NSError(domain: NSURLErrorDomain, code: code)
    }

    /// Private-CA and not-yet-valid certificates are certificate failures, not a generic "Network error".
    func testCertificateFailuresAllReadAsSecureConnectionProblems() {
        let codes = [
            NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted,
            NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateHasUnknownRoot,
            NSURLErrorServerCertificateNotYetValid, NSURLErrorClientCertificateRejected,
            NSURLErrorClientCertificateRequired
        ]
        for code in codes {
            let reason = DeckModel.offlineReason(for: urlError(code))
            XCTAssertEqual(OfflineCause(reason: reason), .secureConnection, "code \(code): \(reason)")
        }
    }

    func testDeviceSideConnectivityBlocksReadAsNoNetwork() {
        let codes = [
            NSURLErrorNotConnectedToInternet, NSURLErrorDataNotAllowed,
            NSURLErrorInternationalRoamingOff, NSURLErrorCallIsActive
        ]
        for code in codes {
            let reason = DeckModel.offlineReason(for: urlError(code))
            XCTAssertEqual(OfflineCause(reason: reason), .noNetwork, "code \(code): \(reason)")
        }
    }

    /// A dropped tunnel mid-load names the lost connection and keeps the VPN guidance of `.unreachable`.
    func testLostConnectionIsNamedAndStaysUnreachable() {
        let reason = DeckModel.offlineReason(for: urlError(NSURLErrorNetworkConnectionLost))
        XCTAssertEqual(reason, "The connection to the deck was lost.")
        XCTAssertEqual(OfflineCause(reason: reason), .unreachable)
        for code in [NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed, NSURLErrorTimedOut, NSURLErrorCannotConnectToHost] {
            XCTAssertEqual(OfflineCause(reason: DeckModel.offlineReason(for: urlError(code))), .unreachable)
        }
        XCTAssertEqual(DeckModel.offlineReason(for: urlError(-9999)), "Network error -9999.")
    }

    func testNonURLErrorsKeepTheirLocalizedDescription() {
        let error = NSError(domain: "WebKitErrorDomain", code: 100,
                            userInfo: [NSLocalizedDescriptionKey: "Synthetic WebKit failure."])
        XCTAssertEqual(DeckModel.offlineReason(for: error), "Synthetic WebKit failure.")
    }

    func testProcessStoppedReasonIsALocalDeviceProblem() {
        XCTAssertEqual(OfflineCause(reason: DeckModel.processStoppedReason), .deviceProblem)
    }

    /// I12: the model passes the deck's host, so a tailnet name that does not resolve says to turn on Tailscale.
    func testTailnetDNSFailureNamesTailscale() {
        for code in [NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed] {
            let reason = DeckModel.offlineReason(for: urlError(code), host: "pc-desktop.example.ts.net")
            XCTAssertEqual(OfflineCause(reason: reason), .tailscaleOff)
            XCTAssertEqual(OfflineCause(reason: reason).title, "Turn on Tailscale on this device")
            XCTAssertEqual(OfflineCause(reason: DeckModel.offlineReason(for: urlError(code), host: "deck.example.com")),
                           .unreachable)
        }
        // Other failures on a tailnet host keep their own cause.
        XCTAssertEqual(OfflineCause(reason: DeckModel.offlineReason(for: urlError(NSURLErrorTimedOut),
                                                                    host: "pc-desktop.example.ts.net")), .unreachable)
    }

    /// I3: Almanac and other same-origin server pages are away from the deck; `/` (with or without a query) is home.
    func testAwayFromDeckRootOnlyForSameOriginPaths() throws {
        let origin = try XCTUnwrap(URL(string: "https://deck.example.com:10443/"))
        func away(_ url: String) -> Bool { DeckModel.isAwayFromDeckRoot(URL(string: url), origin: origin) }
        XCTAssertTrue(away("https://deck.example.com:10443/almanac/"))
        XCTAssertTrue(away("https://deck.example.com:10443/same"))
        XCTAssertFalse(away("https://deck.example.com:10443/"))
        XCTAssertFalse(away("https://deck.example.com:10443"))
        XCTAssertFalse(away("https://deck.example.com:10443/?p=life"))
        XCTAssertFalse(away("https://other.example.com:10443/almanac/"), "Another origin is never shown in the shell")
        XCTAssertFalse(away("https://deck.example.com/almanac/"), "Another port is another origin")
        XCTAssertFalse(DeckModel.isAwayFromDeckRoot(nil, origin: origin))
        XCTAssertFalse(DeckModel.isAwayFromDeckRoot(URL(string: "https://deck.example.com:10443/almanac/"), origin: nil))
    }

    // MARK: Web content process termination

    func testProcessDeathMidLoadRestartsTheLoadUpToTheLimitThenGivesUp() {
        let limit = DeckModel.maxProcessRestartsDuringLoad
        for restarts in 0..<limit {
            XCTAssertEqual(DeckModel.processTerminationAction(phase: .loading, restartsDuringLoad: restarts),
                           .restartLoad, "restart \(restarts + 1) of \(limit)")
        }
        XCTAssertEqual(DeckModel.processTerminationAction(phase: .loading, restartsDuringLoad: limit), .giveUp)
    }

    func testProcessDeathOutsideALoadKeepsTheExistingRetryBehaviour() {
        let phases: [DeckPhase] = [
            .starting, .needsConnection, .needsToken(notice: nil), .ready, .offline(reason: "Synthetic outage")
        ]
        for phase in phases {
            XCTAssertEqual(DeckModel.processTerminationAction(phase: phase, restartsDuringLoad: 0), .retry)
            XCTAssertEqual(DeckModel.processTerminationAction(phase: phase, restartsDuringLoad: 99), .retry)
        }
    }

    @MainActor
    func testProcessDeathMidLoadRestartsOnceThenOffersRetryWithoutProbing() throws {
        let (model, defaults, suite, retries) = try makeModel(saved: ["https://deck.example.com/"])
        defer { defaults.removePersistentDomain(forName: suite) }
        for expected in 1...DeckModel.maxProcessRestartsDuringLoad {
            model.phase = .loading
            model.webContentProcessDidTerminate()
            XCTAssertEqual(retries(), expected, "Each early death restarts the load")
        }
        model.phase = .loading
        model.webContentProcessDidTerminate()
        XCTAssertEqual(retries(), DeckModel.maxProcessRestartsDuringLoad, "The limit stops the loop")
        XCTAssertEqual(model.phase, .offline(reason: DeckModel.processStoppedReason))
        XCTAssertNil(model.probeTask, "A local page failure is not fixed by the host coming back")
    }

    // MARK: Removed deck sessions

    private let queueKey = "deck.pendingStoreRemovals.v1"

    /// A removed deck's store id stays in preferences until its wipe has finished, so quitting mid-wipe
    /// cannot orphan a signed-in session.
    @MainActor
    func testRemovedDeckStaysQueuedUntilItsWipeFinishes() async throws {
        let kept = "https://kept.invalid/", removed = "https://removed.invalid/"
        let keptID = UUID().uuidString, removedID = UUID().uuidString
        let suite = "DeckConnectionRecovery.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set([kept, removed], forKey: "deck.savedOrigins.v1")
        defaults.set(kept, forKey: "deck.selectedOrigin.v1")
        defaults.set(true, forKey: DeckModel.legacyMigrationKey(for: try XCTUnwrap(URL(string: kept))))
        defaults.set(true, forKey: DeckModel.legacyMigrationKey(for: try XCTUnwrap(URL(string: removed))))
        defaults.set([kept: keptID, removed: removedID], forKey: "deck.originStoreIDs.v1")
        var wipes = 0
        var queuedDuringWipe: [String]?
        let model = DeckModel(defaults: defaults, startsAutomatically: false,
                              pro: ProEntitlement(startsAutomatically: false),
                              retryAction: {}, refreshOnActivation: {},
                              sessionRemoval: { _ in
                                  wipes += 1
                                  queuedDuringWipe = defaults.stringArray(forKey: "deck.pendingStoreRemovals.v1")
                              })
        let removedURL = try XCTUnwrap(URL(string: removed))
        model.removeConnection(removedURL)
        XCTAssertEqual(defaults.stringArray(forKey: queueKey), [removedID],
                       "The id is queued before the asynchronous wipe starts")
        let ids = defaults.dictionary(forKey: "deck.originStoreIDs.v1") as? [String: String]
        XCTAssertEqual(ids, [kept: keptID], "The removed origin no longer maps to a store")
        for _ in 0..<100 where defaults.object(forKey: queueKey) != nil {
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTAssertEqual(wipes, 1)
        XCTAssertEqual(queuedDuringWipe, [removedID], "Still queued while the wipe runs")
        XCTAssertNil(defaults.object(forKey: queueKey), "Dequeued once the wipe finished")
    }

    /// A launch after an interrupted wipe finishes it, and never wipes a store that is still saved.
    @MainActor
    func testLaunchFinishesInterruptedWipesAndSkipsLiveStores() async throws {
        let kept = "https://kept.invalid/"
        let liveID = UUID().uuidString, staleID = UUID().uuidString
        let suite = "DeckConnectionRecovery.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set([kept], forKey: "deck.savedOrigins.v1")
        defaults.set(kept, forKey: "deck.selectedOrigin.v1")
        defaults.set([kept: liveID], forKey: "deck.originStoreIDs.v1")
        defaults.set([staleID, liveID, "not-a-uuid"], forKey: queueKey)
        var wipes = 0
        let model = DeckModel(defaults: defaults, startsAutomatically: false,
                              pro: ProEntitlement(startsAutomatically: false),
                              retryAction: {}, refreshOnActivation: {},
                              sessionRemoval: { _ in wipes += 1 })
        await model.purgePendingSessionRemovals()
        XCTAssertEqual(wipes, 1, "Only the stale store is wiped")
        XCTAssertNil(defaults.object(forKey: queueKey), "Live and malformed ids are dropped from the queue")
        let ids = defaults.dictionary(forKey: "deck.originStoreIDs.v1") as? [String: String]
        XCTAssertEqual(ids, [kept: liveID], "The saved deck keeps its store")
    }

    @MainActor
    private func makeModel(saved: [String]) throws -> (DeckModel, UserDefaults, String, () -> Int) {
        let suite = "DeckConnectionRecovery.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defaults.set(saved, forKey: "deck.savedOrigins.v1")
        defaults.set(saved.first, forKey: "deck.selectedOrigin.v1")
        if let first = saved.first, let origin = URL(string: first) {
            defaults.set(true, forKey: DeckModel.legacyMigrationKey(for: origin))
        }
        var count = 0
        let model = DeckModel(defaults: defaults, startsAutomatically: false,
                              pro: ProEntitlement(startsAutomatically: false),
                              retryAction: { count += 1 }, refreshOnActivation: {})
        return (model, defaults, suite, { count })
    }
}
