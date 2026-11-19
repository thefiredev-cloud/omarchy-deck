import XCTest
import StoreKitTest

/// First launch with no saved deck: the branded screen leads with the demo, keeps Pro and Restore on screen
/// (App Review 2.1(b)), and links Privacy and Support.
final class FirstRunUITests: XCTestCase {
    /// The simulator needs the project's StoreKit configuration for the app to find Pro; held for the whole test.
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

    private func launchFresh() -> XCUIApplication {
        UITestLaunch.freshApp()
    }

    private func anyElement(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    private func attach(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testFirstRunLeadsWithDemoAndKeepsProAndLegalLinksVisible() throws {
        let app = launchFresh()
        let demo = app.buttons["demo.try"]
        XCTAssertTrue(demo.waitForExistence(timeout: 20), "A clean install must show Try the demo")
        let window = app.windows.firstMatch.frame
        XCTAssertTrue(app.staticTexts["firstrun.title"].exists)
        XCTAssertEqual(app.staticTexts["firstrun.title"].label, "Omarchy Deck")
        for control in [demo, app.textFields["connection.origin"]] {
            XCTAssertTrue(control.isHittable, "\(control.identifier) must be reachable without scrolling")
            XCTAssertTrue(window.contains(control.frame), "\(control.identifier) must sit inside the screen")
        }
        attach("firstrun")

        // Pro is on the first-run screen, so a reviewer who only opens the demo can still find it.
        let restore = app.buttons["pro.restore"]
        XCTAssertTrue(restore.waitForExistence(timeout: 5), "Restore must stay reachable")
        let buy = app.buttons["pro.buy"]
        XCTAssertTrue(buy.waitForExistence(timeout: 30), "The Pro price must load")
        XCTAssertTrue(buy.label.hasPrefix("Unlock Pro"), buy.label)
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'unavailable'")).count, 0,
                       "Pro must never read as unavailable at rest")
        XCTAssertTrue(app.staticTexts["pro.title"].exists)
        // The Pro card with its price: the deck glyph, not the AI sparkle.
        _ = UITestLaunch.reveal(app, "pro.buy")
        attach("firstrun-pro-card")

        XCTAssertTrue(anyElement(app, "link.privacy").exists, "Privacy must be reachable from first run")
        XCTAssertTrue(anyElement(app, "link.support").exists, "Support must be reachable from first run")
        let copyright = anyElement(app, "deck.about.copyright")
        XCTAssertTrue(copyright.exists, "First run must show the copyright")
        XCTAssertEqual(copyright.label, "© 2026 thefiredev-cloud")

        // Landscape phones and iPads use two columns: nothing important waits below the fold.
        if window.width > window.height {
            for control in [restore, buy, anyElement(app, "link.privacy"), anyElement(app, "link.support")] {
                XCTAssertTrue(window.contains(control.frame), "\(control.identifier) must be on screen without scrolling")
            }
        }
    }

    func testLandscapeFirstRunColumnsShareTheirTopAlignment() {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = launchFresh()
        let brand = app.staticTexts["firstrun.title"].firstMatch
        let connect = app.staticTexts["Connect your deck"].firstMatch
        XCTAssertTrue(brand.waitForExistence(timeout: 20))
        XCTAssertTrue(connect.waitForExistence(timeout: 5))
        XCTAssertLessThan(abs(brand.frame.minY - connect.frame.minY), 48,
                          "The brand and server columns must begin together, not at opposite ends of the screen")
        XCTAssertTrue(app.buttons["demo.try"].isHittable)
        attach("firstrun-landscape-aligned")
    }

    /// The decks screen also carries Privacy and Support, and Pro. Restore hides once Pro is on, so the card's
    /// title stands for it here.
    func testDecksSheetKeepsPrivacySupportAndPro() throws {
        let app = launchFresh()
        UITestLaunch.openDecks(app)
        let origin = app.textFields["connection.origin"]
        let add = app.buttons["connection.add"]
        XCTAssertTrue(origin.exists || add.exists, "Decks must offer the address field or Add deck")
        // First run has no sheet title; the sheet does. Either way the three entries must be reachable.
        for id in ["link.privacy", "link.support", "pro.title"] {
            XCTAssertTrue(UITestLaunch.reveal(app, id).exists, "\(id) must be reachable")
        }
    }
}
