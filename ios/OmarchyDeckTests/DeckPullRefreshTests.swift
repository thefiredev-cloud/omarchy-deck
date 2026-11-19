import XCTest
@testable import OmarchyDeck

/// I2, I15: the real deck page locks its root, so pull to refresh is the page's own gesture posting `deckRefresh`.
final class DeckPullRefreshTests: XCTestCase {
    func testScriptPostsOnceAfterSeventyPixelsAndYieldsToThePage() {
        let script = DeckPullRefresh.script
        XCTAssertEqual(DeckPullRefresh.thresholdPixels, 70)
        XCTAssertTrue(script.contains("const LIMIT = 70;"))
        XCTAssertTrue(script.contains("window.webkit.messageHandlers.deckRefresh.postMessage"))
        XCTAssertTrue(script.contains("event.defaultPrevented"), "A touch the page handles (the Pad) never pulls")
        XCTAssertTrue(script.contains("touchAction"), "Pad (none) and strips (pan-x) never pull")
        XCTAssertTrue(script.contains("pull.sent = true"), "One message per pull")
        XCTAssertTrue(script.contains("#kin"), "The remote typing field never pulls")
        XCTAssertTrue(script.contains("window.__deckPullRefresh"), "Installing twice must not double the listeners")
    }

    func testModelRegistersThePageGestureAndNoDeadRefreshControl() throws {
        let root = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath().deletingLastPathComponent().deletingLastPathComponent()
        let model = try String(contentsOf: root.appendingPathComponent("OmarchyDeck/DeckModel.swift"), encoding: .utf8)
        XCTAssertTrue(model.contains("source: DeckPullRefresh.script"))
        XCTAssertTrue(model.contains("name: DeckPullRefresh.handlerName"))
        XCTAssertTrue(model.contains("removeScriptMessageHandler(forName: DeckPullRefresh.handlerName)"))
        XCTAssertFalse(model.contains("UIRefreshControl"), "The root lock makes a refresh control unreachable")
        XCTAssertFalse(model.contains("refreshControl"))
    }
}
