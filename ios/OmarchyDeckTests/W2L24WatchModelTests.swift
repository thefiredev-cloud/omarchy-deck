import XCTest
#if canImport(OmarchyDeck)
@testable import OmarchyDeck
#else
@testable import LaneCore
#endif

/// Transitions of the watch request state machine. Pure logic, so it runs on Linux without WatchConnectivity.
final class W2L24WatchModelTests: XCTestCase {
    func testStartMovesIdleToSendingAndIssuesTokenOne() throws {
        var machine = WatchDeckMachine()
        XCTAssertEqual(try XCTUnwrap(machine.start("mute")), 1)
        XCTAssertEqual(machine.status, .sending("mute"))
    }

    func testDuplicateTapWhileSendingIsIgnored() throws {
        var machine = WatchDeckMachine()
        _ = try XCTUnwrap(machine.start("mute"))
        XCTAssertNil(machine.start("lock"))
        XCTAssertEqual(machine.status, .sending("mute"))
    }

    func testSuccessReplyEndsInDone() throws {
        var machine = WatchDeckMachine()
        let token = try XCTUnwrap(machine.start("lock"))
        machine.replied(.success(()), token: token)
        XCTAssertEqual(machine.status, .done("lock"))
    }

    func testOwnerFacingFailureEndsInFailedWithReason() throws {
        var machine = WatchDeckMachine()
        let token = try XCTUnwrap(machine.start("lock"))
        machine.replied(.failure(.message(WatchActionMessage.signIn)), token: token)
        XCTAssertEqual(machine.status, .failed("lock", reason: WatchActionMessage.signIn))
    }

    func testDeckNotConnectedRepliesEndInDeckOffline() throws {
        let reasons = [
            WatchActionMessage.openDeck,
            WatchActionMessage.desktopNoResponse,
            WatchActionMessage.desktopUnavailable
        ]
        for reason in reasons {
            var machine = WatchDeckMachine()
            let token = try XCTUnwrap(machine.start("mute"))
            machine.replied(.failure(.message(reason)), token: token)
            XCTAssertEqual(machine.status, .deckOffline, reason)
        }
    }

    func testDeliveryFailureOrTimeoutEndsInPhoneUnreachable() throws {
        var machine = WatchDeckMachine()
        let token = try XCTUnwrap(machine.start("mute"))
        machine.undelivered(token: token)
        XCTAssertEqual(machine.status, .phoneUnreachable)
    }

    func testStartIsRefusedWhilePhoneUnreachableUntilReachableAgain() throws {
        var machine = WatchDeckMachine()
        machine.reachability(false)
        XCTAssertNil(machine.start("mute"))
        XCTAssertEqual(machine.status, .phoneUnreachable)
        machine.reachability(true)
        XCTAssertEqual(machine.status, .idle)
        XCTAssertEqual(try XCTUnwrap(machine.start("mute")), 1)
    }

    func testLateReplyFromOlderRequestCannotFinishNewerOne() throws {
        var machine = WatchDeckMachine()
        let old = try XCTUnwrap(machine.start("mute"))
        machine.undelivered(token: old)
        machine.reachability(true)
        let new = try XCTUnwrap(machine.start("lock"))
        machine.replied(.success(()), token: old)
        XCTAssertEqual(machine.status, .sending("lock"))
        machine.replied(.success(()), token: new)
        XCTAssertEqual(machine.status, .done("lock"))
    }

    func testTimeoutFromOlderRequestCannotBreakNewerRequest() throws {
        var machine = WatchDeckMachine()
        let old = try XCTUnwrap(machine.start("mute"))
        machine.replied(.success(()), token: old)
        _ = try XCTUnwrap(machine.start("lock"))
        machine.undelivered(token: old)
        XCTAssertEqual(machine.status, .sending("lock"))
    }

    func testReplyWithoutRequestIsIgnored() {
        var machine = WatchDeckMachine()
        machine.replied(.success(()), token: 0)
        XCTAssertEqual(machine.status, .idle)
        machine.undelivered(token: 0)
        XCTAssertEqual(machine.status, .idle)
    }

    func testPhoneLostDuringSendDropsLateReply() throws {
        var machine = WatchDeckMachine()
        let token = try XCTUnwrap(machine.start("mute"))
        machine.reachability(false)
        XCTAssertEqual(machine.status, .phoneUnreachable)
        machine.replied(.success(()), token: token)
        XCTAssertEqual(machine.status, .phoneUnreachable)
    }

    func testRetryIsAllowedAfterFailedAndDeckOffline() throws {
        var failed = WatchDeckMachine()
        let first = try XCTUnwrap(failed.start("lock"))
        failed.replied(.failure(.message(WatchActionMessage.signIn)), token: first)
        XCTAssertEqual(try XCTUnwrap(failed.start("lock")), 2)
        XCTAssertEqual(failed.status, .sending("lock"))

        var offline = WatchDeckMachine()
        let second = try XCTUnwrap(offline.start("mute"))
        offline.replied(.failure(.message(WatchActionMessage.openDeck)), token: second)
        XCTAssertEqual(try XCTUnwrap(offline.start("mute")), 2)
        XCTAssertEqual(offline.status, .sending("mute"))
    }

    func testReachabilityGainKeepsDoneAndFailedStates() throws {
        var machine = WatchDeckMachine()
        let token = try XCTUnwrap(machine.start("mute"))
        machine.replied(.success(()), token: token)
        machine.reachability(true)
        XCTAssertEqual(machine.status, .done("mute"))
    }

    func testAcceptsRequestExceptWhileInFlightOrUnreachable() {
        XCTAssertTrue(WatchDeckStatus.idle.acceptsRequest)
        XCTAssertTrue(WatchDeckStatus.deckOffline.acceptsRequest)
        XCTAssertTrue(WatchDeckStatus.done("mute").acceptsRequest)
        XCTAssertTrue(WatchDeckStatus.failed("mute", reason: "x").acceptsRequest)
        XCTAssertFalse(WatchDeckStatus.sending("mute").acceptsRequest)
        XCTAssertFalse(WatchDeckStatus.phoneUnreachable.acceptsRequest)
    }

    func testResponseTimeoutIsEightSeconds() {
        XCTAssertEqual(WatchDeckMachine.responseTimeout, 8)
    }

    func testOnlyDeckNotConnectedMessagesCountAsDeckOffline() {
        XCTAssertTrue(WatchActionMessage.deckOfflineReasons.contains(WatchActionMessage.openDeck))
        XCTAssertFalse(WatchActionMessage.deckOfflineReasons.contains(WatchActionMessage.signIn))
        XCTAssertFalse(WatchActionMessage.deckOfflineReasons.contains(WatchActionMessage.notAvailable))
        XCTAssertFalse(WatchActionMessage.deckOfflineReasons.contains("The desktop could not run this action. Try again."))
    }
}
