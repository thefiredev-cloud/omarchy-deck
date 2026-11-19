import StoreKitTest
import XCTest

/// Needs scripts/security_fixture.py on https://127.0.0.1:9443 and its cert trusted by the simulator.
/// The port may differ: `OMARCHY_DECK_SECURITY_ORIGIN` (the key DeckSecurityUITests reads) names another fixture.
/// Each test starts and ends with no saved session, so the run order never matters.
final class DeckHardeningUITests: XCTestCase {
    private lazy var fixture = ProcessInfo.processInfo.environment["OMARCHY_DECK_SECURITY_ORIGIN"]
        ?? "https://127.0.0.1:9443/"
    private let banner = "DECK FIXTURE - synthetic only"

    private var store: SKTestSession?

    override func setUpWithError() throws {
        continueAfterFailure = false
        // Same reset the other UI classes use. The previous "-59999 origin" trick relied on a
        // launch environment key the app never reads, so it only worked while a deck happened
        // to be left behind by whichever suite ran before this one.
        store = try UITestLaunch.resetPersistedState()
    }

    override func tearDown() {
        UITestLaunch.finishPersistedState(store)
        store = nil
        super.tearDown()
    }

    /// Real customer path: fresh app, type the address, then the token.
    private func signIn(token: String = "fixture-token-0000") -> XCUIApplication {
        let app = UITestLaunch.freshApp()
        let origin = app.textFields["connection.origin"]
        XCTAssertTrue(origin.waitForExistence(timeout: 20), "first run must offer the server form")
        origin.tap()
        origin.typeText(fixture)
        app.buttons["connection.save"].tap()
        let field = app.secureTextFields["token.field"]
        XCTAssertTrue(field.waitForExistence(timeout: 20), "a first connection must ask for the token")
        field.tap()
        field.typeText(token)
        app.buttons["token.open"].tap()
        XCTAssertTrue(app.webViews.firstMatch.staticTexts[banner].waitForExistence(timeout: 30))
        return app
    }

    func testTokenIsRemovedBeforePageScriptsRun() {
        let app = signIn()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.staticTexts["Token removed before page scripts"].waitForExistence(timeout: 10))
        XCTAssertFalse(web.staticTexts["Token visible to page scripts"].exists)
    }

    func testSameOriginLoadsAndCrossSiteIsBlocked() {
        let app = signIn()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.staticTexts["Same-origin resource loaded"].waitForExistence(timeout: 15))
        XCTAssertTrue(web.staticTexts["Cross-site resource blocked"].waitForExistence(timeout: 15))
        XCTAssertFalse(web.staticTexts["Cross-site resource loaded"].exists)
    }

    func testAppSwitcherSnapshotDoesNotShowTheDeck() throws {
        let app = signIn()
        XCTAssertTrue(app.webViews.firstMatch.staticTexts["Same-origin resource loaded"].waitForExistence(timeout: 15))
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let from = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.999))
        let to = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        from.press(forDuration: 0.1, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 1.0)
        sleep(2)
        let shot = XCUIScreen.main.screenshot()
        let a = XCTAttachment(screenshot: shot)
        a.name = "switcher"
        a.lifetime = .keepAlways
        add(a)
        if let dir = ProcessInfo.processInfo.environment["DECK_SHOT_DIR"] {
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir + "/switcher.png"))
        }
        XCTAssertEqual(DeckHardeningUITests.magentaShare(shot), 0, accuracy: 0.001,
                       "the deck's magenta page must not appear in the switcher card")
    }

    /// Share of pixels that are the fixture page's magenta (#ff00ff), sampled on a grid.
    static func magentaShare(_ shot: XCUIScreenshot) -> Double {
        guard let cg = shot.image.cgImage,
              let data = cg.dataProvider?.data, let p = CFDataGetBytePtr(data) else { return -1 }
        let w = cg.width, h = cg.height, bpp = cg.bitsPerPixel / 8, bpr = cg.bytesPerRow
        var hit = 0, total = 0
        for y in stride(from: 0, to: h, by: 8) {
            for x in stride(from: 0, to: w, by: 8) {
                let o = y * bpr + x * bpp
                let (r, g, b) = (Int(p[o]), Int(p[o + 1]), Int(p[o + 2]))
                // byte order may be RGB or BGR; magenta is symmetric in R and B
                if r > 200 && b > 200 && g < 60 { hit += 1 }
                total += 1
            }
        }
        return total == 0 ? -1 : Double(hit) / Double(total)
    }
}
