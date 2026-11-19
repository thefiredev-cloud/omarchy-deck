import StoreKitTest
import XCTest

/// Hardening checks against `scripts/security_fixture.py` (loopback TLS on 9443, synthetic token only).
/// The origin is entered through the same connection form a customer uses. Each test launches with
/// `-deck-demo-clean-install`, which forgets saved decks and their per-origin WebKit stores, so the token
/// bootstrap always runs from a first connection.
final class DeckSecurityUITests: XCTestCase {
    private var store: SKTestSession?

    override func setUpWithError() throws {
        continueAfterFailure = false
        store = try UITestLaunch.resetPersistedState()
    }

    override func tearDown() {
        UITestLaunch.finishPersistedState(store)
        store = nil
        super.tearDown()
    }

    private func fixtureOrigin() -> String {
        ProcessInfo.processInfo.environment["OMARCHY_DECK_SECURITY_ORIGIN"] ?? "https://127.0.0.1:9443/"
    }

    private func launchClean() -> XCUIApplication {
        UITestLaunch.freshApp()
    }

    private func openFixture() -> XCUIApplication {
        let app = launchClean()
        let origin = app.textFields["connection.origin"]
        XCTAssertTrue(origin.waitForExistence(timeout: 20), "first run must offer the server form")
        origin.tap()
        origin.typeText(fixtureOrigin())
        app.buttons["connection.save"].tap()
        let field = app.secureTextFields["token.field"]
        XCTAssertTrue(field.waitForExistence(timeout: 20), "a first connection must ask for the token")
        field.tap()
        field.typeText("security-fixture-token-0000")
        app.buttons["token.open"].tap()
        XCTAssertTrue(app.webViews.firstMatch.staticTexts["SECURITY FIXTURE - synthetic only"].waitForExistence(timeout: 20))
        return app
    }

    func testTokenScrubbedBeforePageScripts() {
        let app = openFixture()
        XCTAssertTrue(app.webViews.firstMatch.staticTexts["Token removed before page scripts"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.webViews.firstMatch.staticTexts["Token visible to page scripts"].exists)
    }

    func testSameOriginAllowedAndCrossSiteBlocked() {
        let app = openFixture()
        XCTAssertTrue(app.webViews.firstMatch.staticTexts["Same-origin resource loaded"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.webViews.firstMatch.staticTexts["Cross-site resource blocked"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.webViews.firstMatch.staticTexts["Cross-site resource loaded"].exists)
    }

    /// Backgrounding covers the deck (app switcher), and returning to the foreground restores the screen.
    func testForegroundRestoresConnectScreen() {
        let app = launchClean()
        XCTAssertTrue(app.textFields["connection.origin"].waitForExistence(timeout: 20))
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.textFields["connection.origin"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["demo.try"].isHittable, "the privacy cover must be gone once the app is active")
        XCTAssertFalse(app.otherElements["Omarchy Deck privacy cover"].exists)
    }
}
