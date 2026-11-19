import WebKit
import XCTest
@testable import OmarchyDeck

/// Web to native haptics (shell and web contract 3).
@MainActor
final class HapticBridgeTests: XCTestCase {
    @MainActor
    private final class RecordingPlayer: HapticPlaying {
        var played: [DeckHaptic] = []
        func play(_ style: DeckHaptic) { played.append(style) }
    }

    func testEveryContractStylePlays() {
        let player = RecordingPlayer()
        var clock: TimeInterval = 0
        let bridge = HapticBridge(player: player, now: { clock })
        for name in ["selection", "light", "medium", "success", "warning", "error"] {
            XCTAssertTrue(bridge.handle(body: ["style": name]), name)
            clock += 1
        }
        XCTAssertEqual(player.played, [.selection, .light, .medium, .success, .warning, .error])
    }

    func testUnknownStylesAndMalformedBodiesAreIgnored() {
        let player = RecordingPlayer()
        let bridge = HapticBridge(player: player, now: { 0 })
        let bodies: [Any] = [
            ["style": "thunder"], ["style": ""], ["style": "SUCCESS"], ["style": 3], ["style": NSNull()],
            ["Style": "success"], [String: Any](), "success", 7, NSNull(), ["style": ["success"]]
        ]
        for body in bodies {
            XCTAssertFalse(bridge.handle(body: body), "\(body)")
        }
        XCTAssertEqual(player.played, [])
    }

    func testAPageScriptCannotPlayMoreThanTwentyAtOnce() {
        let player = RecordingPlayer()
        var clock: TimeInterval = 100
        let bridge = HapticBridge(player: player, now: { clock })
        for _ in 0..<50 { bridge.handle(body: ["style": "light"]) }
        XCTAssertEqual(player.played.count, 20)
        clock += 0.5
        XCTAssertFalse(bridge.handle(body: ["style": "light"]), "Still inside the same second")
        clock += 0.51
        XCTAssertTrue(bridge.handle(body: ["style": "light"]), "A second later the window is open again")
    }

    func testWebKitDoesNotKeepTheBridgeAlive() {
        let player = RecordingPlayer()
        var bridge: HapticBridge? = HapticBridge(player: player, now: { 0 })
        weak var weakBridge = bridge
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(WeakScriptMessageHandler(bridge!), name: HapticBridge.handlerName)
        bridge = nil
        XCTAssertNil(weakBridge, "The configuration holds the proxy, and the proxy holds the bridge weakly")
    }

    /// Posts from a real page through the real handler: a known style plays, an unknown one does not.
    func testPageMessagesReachThePlayerOnlyForKnownStyles() async {
        let player = RecordingPlayer()
        let bridge = HapticBridge(player: player, now: { ProcessInfo.processInfo.systemUptime })
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(WeakScriptMessageHandler(bridge), name: HapticBridge.handlerName)
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: configuration)
        let page = """
        <!doctype html><script>
        const h = window.webkit?.messageHandlers?.deckHaptic;
        h?.postMessage({style: 'nonsense'});
        h?.postMessage('success');
        h?.postMessage({style: 'success'});
        </script>
        """
        await WebLoadWaiter().load(html: page, in: view)
        let played = await waitUntil { !player.played.isEmpty }
        XCTAssertTrue(played)
        try? await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(player.played, [.success])
    }

    /// Simulator proof of dispatch, not physical vibration: one web-control tap crosses the real WK message
    /// bridge once. A scroll without a posted message produces no feedback.
    func testOneWebControlTapDispatchesOneFeedbackAndScrollingDispatchesNone() async throws {
        let player = RecordingPlayer()
        let bridge = HapticBridge(player: player)
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(WeakScriptMessageHandler(bridge), name: HapticBridge.handlerName)
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: configuration)
        let page = """
        <!doctype html><button id="tap" onclick="window.webkit.messageHandlers.deckHaptic.postMessage({style:'selection'})">Tab</button>
        <div style="height:2000px"></div>
        """
        await WebLoadWaiter().load(html: page, in: view)
        _ = try await view.evaluateJavaScript("window.scrollTo(0,200)")
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(player.played, [])
        _ = try await view.evaluateJavaScript("document.getElementById('tap').click()")
        let dispatched = await waitUntil { player.played.count == 1 }
        XCTAssertTrue(dispatched)
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(player.played, [.selection])
    }
}
