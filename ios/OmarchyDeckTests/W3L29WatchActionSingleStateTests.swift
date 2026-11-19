import XCTest
@testable import OmarchyDeck

/// WatchDeckMachine is the only watch action state. These tests carry the assertions that used to live on the removed
/// WatchActionState (reachability gate, duplicate tap, phone error shown, retry) plus the W3 copy and retry contract.
@MainActor
final class W3L29WatchActionSingleStateTests: XCTestCase {
    private struct FakeClient: DeckActionExecuting {
        let failure: WatchActionError?
        func runAction(id: String) async throws {
            if let failure { throw failure }
        }
    }

    /// Runs one request through the fake phone client and feeds the outcome back with the request token.
    private func run(_ id: String, on machine: inout WatchDeckMachine, client: FakeClient) async throws {
        let token = try XCTUnwrap(machine.start(id))
        do {
            try await client.runAction(id: id)
            machine.replied(.success(()), token: token)
        } catch let error as WatchActionError {
            machine.replied(.failure(error), token: token)
        }
    }

    func testUnreachablePhoneRefusesRequestUntilReachabilityReturns() throws {
        var machine = WatchDeckMachine()
        machine.reachability(false)
        XCTAssertNil(machine.start("mute"))
        XCTAssertEqual(machine.status, .phoneUnreachable)
        machine.reachability(true)
        XCTAssertEqual(try XCTUnwrap(machine.start("mute")), 1)
    }

    func testDuplicateTapWhileSendingKeepsFirstActionAndToken() throws {
        var machine = WatchDeckMachine()
        XCTAssertEqual(try XCTUnwrap(machine.start("mute")), 1)
        XCTAssertNil(machine.start("mute"))
        XCTAssertNil(machine.start("lock"))
        XCTAssertEqual(machine.status, .sending("mute"))
        XCTAssertEqual(machine.token, 1)
    }

    func testSuccessfulClientRunEndsInDoneAndNamesTheAction() async throws {
        var machine = WatchDeckMachine()
        try await run("mute", on: &machine, client: FakeClient(failure: nil))
        XCTAssertEqual(machine.status, .done("mute"))
        XCTAssertEqual(machine.status.line, "Done: Mute or unmute.")
        XCTAssertEqual(machine.status.announcement, "Done: Mute or unmute.")
    }

    func testClientErrorIsShownWithActionNameAndAllowsRetry() async throws {
        var machine = WatchDeckMachine()
        try await run("play-pause", on: &machine, client: FakeClient(failure: .message("No player is open.")))
        XCTAssertEqual(machine.status, .failed("play-pause", reason: "No player is open."))
        XCTAssertEqual(machine.status.line, "Play or pause did not run. No player is open.")
        XCTAssertFalse(machine.status.isSending)
        XCTAssertEqual(try XCTUnwrap(machine.start("play-pause")), 2)
        XCTAssertEqual(machine.status, .sending("play-pause"))
    }

    func testOnlyAnInFlightRequestDisablesButtons() throws {
        var machine = WatchDeckMachine()
        XCTAssertFalse(machine.status.isSending)
        _ = try XCTUnwrap(machine.start("lock"))
        XCTAssertTrue(machine.status.isSending)

        let retryable: [WatchDeckStatus] = [
            .idle, .phoneUnreachable, .deckOffline, .done("lock"), .failed("lock", reason: "x")
        ]
        for status in retryable {
            XCTAssertFalse(status.isSending, "\(status)")
        }
    }

    func testTimeoutIsEightSecondsAndLeavesAnUnreachableStateThatRetriesAfterReconnect() throws {
        XCTAssertEqual(WatchDeckMachine.responseTimeout, 8)
        var machine = WatchDeckMachine()
        let token = try XCTUnwrap(machine.start("lock"))
        machine.undelivered(token: token)
        XCTAssertEqual(machine.status, .phoneUnreachable)
        XCTAssertFalse(machine.status.isSending)
        XCTAssertEqual(machine.status.line, WatchActionMessage.notNearby)
        // The model re-reads reachability on every tap, which is what lets a retry through.
        machine.reachability(true)
        XCTAssertEqual(try XCTUnwrap(machine.start("lock")), 2)
    }

    func testStaleReplyAfterTimeoutCannotFinishTheRetry() throws {
        var machine = WatchDeckMachine()
        let old = try XCTUnwrap(machine.start("mute"))
        machine.undelivered(token: old)
        machine.reachability(true)
        let retry = try XCTUnwrap(machine.start("mute"))
        machine.replied(.success(()), token: old)
        XCTAssertEqual(machine.status, .sending("mute"))
        machine.undelivered(token: old)
        XCTAssertEqual(machine.status, .sending("mute"))
        machine.replied(.success(()), token: retry)
        XCTAssertEqual(machine.status, .done("mute"))
    }

    func testReconnectDuringSendDropsLateReplyThenRetries() throws {
        var machine = WatchDeckMachine()
        let lost = try XCTUnwrap(machine.start("lock"))
        machine.reachability(false)
        machine.reachability(true)
        XCTAssertEqual(machine.status, .idle)
        machine.replied(.success(()), token: lost)
        XCTAssertEqual(machine.status, .idle)
        XCTAssertEqual(try XCTUnwrap(machine.start("lock")), 2)
    }

    func testDeckOfflineReasonsMapToOneRetryableState() throws {
        for reason in [WatchActionMessage.openDeck, WatchActionMessage.desktopNoResponse, WatchActionMessage.desktopUnavailable] {
            var machine = WatchDeckMachine()
            let token = try XCTUnwrap(machine.start("mute"))
            machine.replied(.failure(.message(reason)), token: token)
            XCTAssertEqual(machine.status, .deckOffline, reason)
            XCTAssertEqual(machine.status.line, WatchActionMessage.deckNotConnected)
            XCTAssertFalse(machine.status.isSending)
            XCTAssertNotNil(machine.start("mute"))
        }
    }

    func testAnnouncementIsSpokenOnlyForEndedRequests() {
        XCTAssertNil(WatchDeckStatus.idle.announcement)
        XCTAssertNil(WatchDeckStatus.sending("lock").announcement)
        XCTAssertEqual(WatchDeckStatus.done("lock").announcement, "Done: Lock computer.")
        XCTAssertEqual(WatchDeckStatus.failed("lock", reason: WatchActionMessage.signIn).announcement,
                       "Lock computer did not run. Sign in on your iPhone, then try again.")
        XCTAssertEqual(WatchDeckStatus.deckOffline.announcement, WatchActionMessage.deckNotConnected)
        XCTAssertEqual(WatchDeckStatus.phoneUnreachable.announcement, WatchActionMessage.notNearby)
    }

    func testSendingLineNamesTheActionAndUnknownIdsGetAGenericName() {
        XCTAssertEqual(WatchDeckStatus.sending("play-pause").line, "Sending Play or pause to iPhone...")
        XCTAssertEqual(WatchAction.label(for: "screenshot"), "Action")
    }

    func testAllowlistStillRejectsUnlistedAndExtraKeyMessages() {
        XCTAssertEqual(WatchAction.available.map(\.id), ["play-pause", "mute", "lock", "ws-1", "ws-2", "ws-3", "ws-4", "ws-5"])
        XCTAssertNil(WatchActionCodec.actionID(from: ["type": "runAction", "id": "screenshot"]))
        XCTAssertNil(WatchActionCodec.actionID(from: ["type": "runAction", "id": "lock", "token": "x"]))
        XCTAssertEqual(WatchActionCodec.actionID(from: WatchActionCodec.request(id: "lock")), "lock")
    }
}
