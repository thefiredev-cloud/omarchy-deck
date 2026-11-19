import XCTest
import StoreKitTest

final class ProConnectionUITests: XCTestCase {
    private let first = ProcessInfo.processInfo.environment["OMARCHY_DECK_TEST_FIRST_ORIGIN"] ?? "https://127.0.0.1:28443/"
    private let second = ProcessInfo.processInfo.environment["OMARCHY_DECK_TEST_SECOND_ORIGIN"] ?? "https://127.0.0.1:28444/"
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

    private func fixtureToken(_ side: String) -> String {
        ["fixture", side, "0000"].joined(separator: "-")
    }

    /// First run, or the Decks sheet's list of saved decks.
    private func openConnections(_ app: XCUIApplication) {
        UITestLaunch.openDecks(app)
    }

    private func removeSavedConnections(_ app: XCUIApplication) {
        let rows = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'connection.https://'"))
        while rows.count > 0 {
            let identifier = rows.firstMatch.identifier
            rows.firstMatch.swipeLeft()
            let delete = app.buttons["Delete"].firstMatch
            XCTAssertTrue(delete.waitForExistence(timeout: 5), "Swipe-delete must show Delete")
            delete.tap()
            let remove = UITestLaunch.alertButton(app, "connection.remove.confirm")
            XCTAssertTrue(remove.waitForExistence(timeout: 5), "Deleting a deck must ask first")
            remove.tap()
            UITestLaunch.waitForAlertToDismiss(app)
            XCTAssertTrue(app.buttons[identifier].waitForNonExistence(timeout: 5))
        }
    }

    private func add(_ origin: String, token: String, title: String, in app: XCUIApplication) {
        let field = app.textFields["connection.origin"]
        if !field.exists {
            let add = app.buttons["connection.add"]
            XCTAssertTrue(add.waitForExistence(timeout: 10), "Decks must offer Add deck")
            add.tap()
        }
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5),
                      "the address field must take keyboard focus before typing")
        field.typeText(origin)
        app.buttons["connection.save"].tap()
        let tokenField = app.secureTextFields["token.field"]
        XCTAssertTrue(tokenField.waitForExistence(timeout: 15))
        tokenField.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5),
                      "the token field must take keyboard focus before typing")
        tokenField.typeText(token)
        app.buttons["token.open"].tap()
        XCTAssertTrue(app.webViews.firstMatch.staticTexts[title].waitForExistence(timeout: 30))
    }

    private func select(_ origin: String, title: String, in app: XCUIApplication) {
        openConnections(app)
        let row = app.buttons["connection.\(origin)"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "Decks must list \(origin)")
        row.tap()
        XCTAssertTrue(app.webViews.firstMatch.staticTexts[title].waitForExistence(timeout: 30),
                      "Switching servers must retain that server's authenticated session")
        XCTAssertFalse(app.secureTextFields["token.field"].exists)
    }

    /// The Decks form is lazy. On iPad it is a short form sheet, so Unlock Pro sits below the fold and does not exist
    /// until the form scrolls. Wait for the refund to land, then scroll until the button is realized.
    private func revealBuy(_ app: XCUIApplication) -> Bool {
        let buy = app.buttons["pro.buy"]
        if buy.waitForExistence(timeout: 15) { return true }
        for _ in 0..<4 {
            app.swipeUp()
            if buy.waitForExistence(timeout: 3) { return true }
        }
        return false
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// Lazy List trap (I26, deck-ui-suite skill): a row off screen does not exist until the list scrolls to it, and a
    /// realized row can take a moment to appear. Waits after every scroll and scrolls the list itself slowly, so a
    /// swipe that lands at the top never pulls the Decks sheet down. Rows above the fold come first (swipe down),
    /// then rows below it (swipe up).
    @discardableResult
    private func revealRow(_ app: XCUIApplication, _ origin: String) -> XCUIElement {
        let row = app.buttons["connection.\(origin)"].firstMatch
        if row.waitForExistence(timeout: 2) { return row }
        let list = app.collectionViews.firstMatch
        for direction in [true, false] {
            for _ in 0..<5 {
                guard list.exists else { return row }
                if direction { list.swipeDown(velocity: .slow) } else { list.swipeUp(velocity: .slow) }
                if row.waitForExistence(timeout: 1.5) { return row }
            }
        }
        return row
    }

    /// Requires the two explicitly labeled mock TLS servers, not any customer's deck.
    @MainActor
    func testVerifiedProIsolatesSameHostPortsAndRevocationLocksSwitching() async throws {
        let store = try XCTUnwrap(self.store)
        let app = UITestLaunch.freshApp()
        openConnections(app)
        removeSavedConnections(app)
        // A new customer can explore offline; commerce loads only after their first real deck.
        add(first, token: fixtureToken("first"), title: "MOCK DECK A (not the real deck)", in: app)
        openConnections(app)
        let firstRow = app.buttons["connection.\(first)"].firstMatch
        XCTAssertTrue(firstRow.waitForExistence(timeout: 10), "Decks must list the first server")
        firstRow.press(forDuration: 1)
        let inspect = app.buttons["Show server address"].firstMatch
        XCTAssertTrue(inspect.waitForExistence(timeout: 5))
        inspect.tap()
        UITestLaunch.waitForAlert(app, titled: "Server address")
        XCTAssertTrue(UITestLaunch.alertText(app, first).exists)
        UITestLaunch.alertButton(app, "Done").tap()
        UITestLaunch.waitForAlertToDismiss(app)
        let buy = app.buttons["pro.buy"]
        XCTAssertTrue(revealBuy(app), "Unlock Pro must be on Decks after the address alert")
        XCTAssertTrue(buy.waitForExistence(timeout: 15))
        XCTAssertTrue(buy.isEnabled)
        let purchase = try await store.buyProduct(identifier: "net.meshchat.deck.pro")
        XCTAssertTrue(buy.waitForNonExistence(timeout: 20), "Verified purchase must activate Pro")
        app.swipeDown()
        add(second, token: fixtureToken("second"), title: "MOCK DECK B (not the real deck)", in: app)
        select(first, title: "MOCK DECK A (not the real deck)", in: app)
        select(second, title: "MOCK DECK B (not the real deck)", in: app)
        app.terminate()
        UITestLaunch.relaunchKeepingState(app)
        XCTAssertTrue(app.webViews.firstMatch.staticTexts["MOCK DECK B (not the real deck)"].waitForExistence(timeout: 30))
        select(first, title: "MOCK DECK A (not the real deck)", in: app)
        openConnections(app)
        shot(app, "deck-pro-saved-connections")
        try store.refundTransaction(identifier: UInt(purchase.id))
        XCTAssertTrue(revealBuy(app), "Revoked Pro must show Unlock Pro again")
        let locked = revealRow(app, second)
        XCTAssertTrue(locked.waitForExistence(timeout: 10), "Decks must still list the second server")
        locked.tap()
        // The lock sentence is inserted under the tapped row. Add deck stays in the
        // list (revocation does not remove it) but can drop below the fold.
        XCTAssertTrue(UITestLaunch.realize(app, "connection.add"),
                      "Revoked Pro must not switch servers")
        let lock = app.staticTexts["connection.lock"].firstMatch
        XCTAssertTrue(lock.waitForExistence(timeout: 5), "Tapping a locked deck must say why")
        XCTAssertEqual(lock.label, "Restore Pro to switch decks.")
        XCTAssertEqual(revealRow(app, second).label, "\(second), locked",
                       "VoiceOver must hear the full address, including the port")
        // The lock sentence inserts under the tapped row, so the current deck's row can sit
        // above the fold. Scroll to each row before reading it.
        let current = revealRow(app, first)
        XCTAssertTrue(current.waitForExistence(timeout: 5), "The current deck must still be listed")
        XCTAssertEqual(current.label, "\(first), current deck")
        XCTAssertTrue(revealRow(app, second).exists, "Revocation must retain saved connections")
        shot(app, "deck-pro-revoked-connections")
        _ = try await store.buyProduct(identifier: "net.meshchat.deck.pro")
        XCTAssertTrue(app.buttons["pro.buy"].waitForNonExistence(timeout: 20), "Restored Pro must activate again")
        XCTAssertTrue(lock.waitForNonExistence(timeout: 5), "Restoring Pro must hide the lock sentence")
        XCTAssertEqual(revealRow(app, second).label, second, "Restored Pro must name the deck by its address alone")
        shot(app, "deck-pro-restored-connections")
        removeSavedConnections(app)
    }
}
