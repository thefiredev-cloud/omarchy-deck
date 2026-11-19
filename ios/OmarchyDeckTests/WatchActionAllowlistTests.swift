import XCTest
@testable import OmarchyDeck

/// The watch allowlists: which action ids exist, which fixed desktop request each one becomes, and what a guest may see.
/// Pure logic and not @MainActor, so XCTest on Linux runs it. The phone-side client stays in WatchActionsTests.
final class WatchActionAllowlistTests: XCTestCase {
    /// Action POSTs are fixed, allowlisted requests: workspaces 1 to 5 only, and every action maps to exactly one request.
    func testWorkspaceActionsMapToTheServersWorkspaceRouteAndNothingElse() {
        XCTAssertEqual(WatchActionEndpoint.forAction("ws-1"), .init(path: "/api/ws", query: ["v": "1"]))
        XCTAssertEqual(WatchActionEndpoint.forAction("ws-5"), .init(path: "/api/ws", query: ["v": "5"]))
        XCTAssertEqual(WatchActionEndpoint.forAction("play-pause"), .init(path: "/api/media-act", query: ["v": "play-pause"]))
        XCTAssertEqual(WatchActionEndpoint.forAction("mute"), .init(path: "/api/mute", query: [:]))
        XCTAssertEqual(WatchActionEndpoint.forAction("lock"), .init(path: "/api/lock", query: [:]))
        for bad in ["ws-0", "ws-6", "ws-12", "ws-01", "ws--1", "ws-", "ws", "ws-1-2", "WS-1", "screenshot", "", "ws-1&x=1"] {
            XCTAssertNil(WatchActionEndpoint.forAction(bad), bad)
        }
        for action in WatchAction.available {
            XCTAssertNotNil(WatchActionEndpoint.forAction(action.id), "\(action.id) must have a fixed request")
        }
    }

    /// Int("+1") parses in Swift, so an id must also match its canonical spelling exactly.
    func testWorkspaceIdsWithSignsSpacesOrPathPartsAreRefused() {
        for bad in ["ws-+1", "ws- 1", "ws-1 ", " ws-1", "ws-1/../lock", "ws-1?v=2"] {
            XCTAssertNil(WatchActionEndpoint.forAction(bad), bad)
        }
    }

    func testWorkspaceActionsAreNamedInPlainWordsAndSurviveTheCodec() {
        let labels = WatchAction.available.filter { $0.id.hasPrefix("ws-") }.map(\.label)
        XCTAssertEqual(labels, (1...5).map { "Switch to desktop \($0)" })
        let context = WatchActionCodec.context(WatchAction.available)
        XCTAssertEqual(WatchActionCodec.actions(from: context), WatchAction.available)
        XCTAssertEqual(WatchActionCodec.actionID(from: WatchActionCodec.request(id: "ws-3")), "ws-3")
        XCTAssertNil(WatchActionCodec.actionID(from: ["type": "runAction", "id": "ws-6"]))
        XCTAssertEqual(WatchDeckStatus.done("ws-2").line, "Done: Switch to desktop 2.")
        XCTAssertEqual(WatchDeckStatus.sending("ws-2").line, "Sending Switch to desktop 2 to iPhone...")
    }

    func testUnknownActionIdGetsAGenericLabel() {
        XCTAssertEqual(WatchAction.label(for: "screenshot"), "Action")
        XCTAssertEqual(WatchAction.label(for: "lock"), "Lock computer")
    }

    func testCodecRejectsUnlistedActionAndNeverPublishesCredentials() {
        let context = WatchActionCodec.context(WatchAction.available)
        XCTAssertEqual(WatchActionCodec.actions(from: context), WatchAction.available)
        XCTAssertNil(WatchActionCodec.actionID(from: ["type": "runAction", "id": "screenshot"]))
        XCTAssertNil(WatchActionCodec.actionID(from: ["type": "runAction", "id": "lock", "token": "x"]))
        XCTAssertFalse(String(describing: context).contains("token"))
    }

    /// A request needs exactly the type marker and a listed string id. Anything else is dropped, not guessed at.
    func testCodecRequiresTheExactRunActionShape() {
        XCTAssertEqual(WatchActionCodec.actionID(from: ["type": "runAction", "id": "lock"]), "lock")
        XCTAssertNil(WatchActionCodec.actionID(from: ["type": "runaction", "id": "lock"]))
        XCTAssertNil(WatchActionCodec.actionID(from: ["id": "lock"]))
        XCTAssertNil(WatchActionCodec.actionID(from: ["type": "runAction", "id": 1]))
        XCTAssertNil(WatchActionCodec.actionID(from: ["type": "runAction"]))
    }

    /// The watch rebuilds its list from phone context. Bad rows and a missing list give fewer actions, never invented ones.
    func testCodecFiltersUnrecognizedLabelsAndReportsPhoneFailure() {
        let context: [String: Any] = ["actions": [
            ["id": "mute", "label": "Mute or unmute"],
            ["id": "lock", "label": "Factory Reset"],
            ["id": "mute"]
        ]]
        XCTAssertEqual(WatchActionCodec.actions(from: context), [.init(id: "mute", label: "Mute or unmute")])
        XCTAssertEqual(WatchActionCodec.actions(from: ["actions": "lock"]), [])
        XCTAssertEqual(WatchActionCodec.actions(from: [:]), [])
        guard case .failure(let error) = WatchActionCodec.result(from: WatchActionCodec.reply(error: "Sign in first.")) else {
            return XCTFail("Expected the phone failure to map to a watch error")
        }
        XCTAssertEqual(error, .message("Sign in first."))
    }

    func testReplyWithoutOkFlagIsAFailureWithPlainText() {
        guard case .failure(let missing) = WatchActionCodec.result(from: [:]) else {
            return XCTFail("A reply without an ok flag must fail")
        }
        XCTAssertEqual(missing, .message("The iPhone could not run this action. Try again."))
        guard case .success = WatchActionCodec.result(from: WatchActionCodec.reply()) else {
            return XCTFail("An ok reply must succeed")
        }
    }

    /// I7: a guest token cannot lock the desktop, so a guest's watch never offers Lock. Owners keep every action.
    func testGuestWatchHidesLockAndOwnerKeepsIt() {
        let guest = WatchAction.available(guest: true)
        XCTAssertFalse(guest.contains { $0.id == "lock" })
        XCTAssertEqual(guest.count, WatchAction.available.count - 1)
        XCTAssertEqual(WatchAction.available(guest: false), WatchAction.available)
        // The guest list still passes the watch's own allowlist check.
        XCTAssertEqual(WatchActionCodec.actions(from: WatchActionCodec.context(guest)), guest)
    }

    /// A 403 is a refusal for this device, not a desktop failure, and the watch must not call it offline.
    func testForbiddenReadsNotAllowedForThisDevice() {
        XCTAssertEqual(WatchActionMessage.failure(status: 403), "Not allowed for this device.")
        XCTAssertEqual(WatchActionMessage.failure(status: 401), WatchActionMessage.signIn)
        XCTAssertEqual(WatchActionMessage.failure(status: 500), WatchActionMessage.desktopFailed)
        var machine = WatchDeckMachine()
        guard let token = machine.start("lock") else { return XCTFail("An idle machine accepts a request") }
        machine.replied(.failure(.message(WatchActionMessage.notAllowed)), token: token)
        XCTAssertEqual(machine.status, .failed("lock", reason: WatchActionMessage.notAllowed))
        XCTAssertEqual(machine.status.line, "Lock computer did not run. Not allowed for this device.")
    }
}
