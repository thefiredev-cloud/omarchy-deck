import Foundation
import WatchConnectivity
import XCTest
@testable import OmarchyDeck

/// Covers the phone's reply contract for watch action messages. The client is the `DeckActionExecuting` seam, so no WebKit or network runs.
@MainActor
final class WatchBridgeTests: XCTestCase {
    @MainActor
    private final class RecordingClient: DeckActionExecuting {
        private(set) var ids: [String] = []
        var failure: Error?

        func runAction(id: String) async throws {
            ids.append(id)
            if let failure { throw failure }
        }
    }

    @MainActor
    private final class ReplyBox {
        var reply: [String: Any]?
    }

    private func deliver(_ message: [String: Any], to client: RecordingClient) async -> [String: Any]? {
        let bridge = WatchBridge(client: client, session: nil)
        let box = ReplyBox()
        let replied = expectation(description: "watch reply")
        bridge.session(WCSession.default, didReceiveMessage: message, replyHandler: { reply in
            box.reply = reply
            replied.fulfill()
        })
        await fulfillment(of: [replied], timeout: 2)
        return box.reply
    }

    func testListedActionRunsOnceAndRepliesOK() async {
        let client = RecordingClient()
        let reply = await deliver(WatchActionCodec.request(id: "mute"), to: client)
        XCTAssertEqual(client.ids, ["mute"])
        XCTAssertEqual(reply?["ok"] as? Bool, true)
        XCTAssertNil(reply?["error"])
    }

    func testUnlistedActionIsRejectedBeforeReachingClient() async {
        let client = RecordingClient()
        let reply = await deliver(["type": "runAction", "id": "screenshot"], to: client)
        XCTAssertEqual(client.ids, [])
        XCTAssertEqual(reply?["ok"] as? Bool, false)
        XCTAssertFalse((reply?["error"] as? String ?? "").isEmpty)
    }

    func testMessageWithExtraFieldsIsRejectedBeforeReachingClient() async {
        let client = RecordingClient()
        let reply = await deliver(["type": "runAction", "id": "lock", "token": "not-for-the-watch"], to: client)
        XCTAssertEqual(client.ids, [])
        XCTAssertEqual(reply?["ok"] as? Bool, false)
    }

    func testPhoneActionFailureReachesWatchAsItsOwnMessage() async {
        let client = RecordingClient()
        client.failure = WatchActionError.message("No player is open.")
        let reply = await deliver(WatchActionCodec.request(id: "play-pause"), to: client)
        XCTAssertEqual(client.ids, ["play-pause"])
        XCTAssertEqual(reply?["ok"] as? Bool, false)
        XCTAssertEqual(reply?["error"] as? String, "No player is open.")
    }

    func testUnexpectedClientErrorDoesNotLeakRawDescriptionToWatch() async {
        let client = RecordingClient()
        let raw = URLError(.notConnectedToInternet)
        client.failure = raw
        let reply = await deliver(WatchActionCodec.request(id: "lock"), to: client)
        XCTAssertEqual(client.ids, ["lock"])
        XCTAssertEqual(reply?["ok"] as? Bool, false)
        let text = reply?["error"] as? String ?? ""
        XCTAssertFalse(text.isEmpty)
        XCTAssertNotEqual(text, raw.localizedDescription)
    }

    /// WatchConnectivity calls its delegate on a background queue. The callback must not be main-actor isolated,
    /// or Swift 6 traps on the isolation check before the reply is sent.
    func testMessageFromBackgroundQueueStillRepliesOnce() async {
        let client = RecordingClient()
        let bridge = WatchBridge(client: client, session: nil)
        let replied = expectation(description: "watch reply from background queue")
        DispatchQueue.global().async {
            bridge.session(WCSession.default, didReceiveMessage: WatchActionCodec.request(id: "mute"), replyHandler: { reply in
                XCTAssertEqual(reply["ok"] as? Bool, true)
                replied.fulfill()
            })
        }
        await fulfillment(of: [replied], timeout: 2)
        XCTAssertEqual(client.ids, ["mute"])
    }
}
