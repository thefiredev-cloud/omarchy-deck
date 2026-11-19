import Security
import StoreKitTest
import XCTest

/// Shared launch path so every UI class starts Free, with no leftover process or saved decks.
enum UITestLaunch {
    static let cleanInstallArgument = "-deck-demo-clean-install"

    /// Keys the app persists in UserDefaults. The existing DEBUG launch argument
    /// drops these in the app process; the test process clears the same names.
    private static let persistedDefaultKeys = [
        "deck.savedOrigins.v1",
        "deck.selectedOrigin.v1",
        "deck.originStoreIDs.v1",
        "deck.legacyCookieMigration.v1",
        "deck.pendingStoreRemovals.v1",
        "deck.decksTipSeen",
        "deck.feeds.section",
        "deck.feeds.appearance",
        "deck.realestate.page",
        "deck.realestate.lens",
        "deck.markets.level",
        "deck.markets.segment",
    ]

    /// Per-test reset of every store a prior case can leave behind. Same pattern as
    /// SKTestSession.resetToDefaultState: drop the process, then wipe UserDefaults,
    /// keychain, the on-disk deck snapshot store, launch args, and StoreKit.
    @discardableResult
    static func resetPersistedState() throws -> SKTestSession {
        terminateAndResetLaunch()
        resetUserDefaults()
        resetKeychain()
        resetDeckStore()
        return try resetStoreKit()
    }

    static func finishPersistedState(_ session: SKTestSession?) {
        terminateAndResetLaunch()
        resetUserDefaults()
        resetKeychain()
        resetDeckStore()
        session?.resetToDefaultState()
        session?.clearTransactions()
    }

    static func freshApp(_ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [cleanInstallArgument] + extra
        app.launchEnvironment = [:]
        app.launch()
        return app
    }

    static func relaunchKeepingState(_ app: XCUIApplication) {
        app.launchArguments.removeAll { $0 == cleanInstallArgument }
        app.launch()
    }

    /// First run shows the address field. Later, Decks is behind `connection.manage`.
    /// After the page has been ready for `DeckChrome.idleSeconds` (3s) the control only dims:
    /// it stays on screen and tappable, so one tap always opens the sheet (Guideline 5.6).
    /// The Add deck row is always on that list, including after Pro revocation
    /// (`AddDeckMode.locked` still titles it "Add deck" and withholds only the address
    /// field). A lazy List does not build the row until it is on screen, and two saved
    /// decks push it below the fold of the short sheet, so waiting alone never sees it.
    static func openDecks(_ app: XCUIApplication) {
        let origin = app.textFields["connection.origin"]
        let add = app.buttons["connection.add"]
        let manage = app.buttons["connection.manage"]
        let surface = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            origin.exists || add.exists || manage.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [surface], timeout: 20), .completed)
        guard !origin.exists, !add.exists else { return }
        XCTAssertTrue(manage.waitForExistence(timeout: 10),
                      "The ready deck must show the Decks control")
        manage.tap()
        // The control is tappable whether or not it has dimmed, so one tap opens the sheet.
        XCTAssertTrue(realize(app, "connection.add"), "Decks must offer Add deck")
    }

    /// Scrolls a lazy Decks row into a hittable position.
    /// Each check builds a new query. A query captured before the sheet existed
    /// stays on the old hierarchy, and existence alone counts a row that is not
    /// hittable. A swipe while the sheet is presenting hits the page.
    /// The sheet can take several seconds to settle on a slow simulator. Wait that
    /// out before swiping, then bound the swipes so a missing row still fails.
    @discardableResult
    static func realize(_ app: XCUIApplication, _ identifier: String, swipes: Int = 8) -> Bool {
        if waitUntilHittable(app, identifier, timeout: 0.5) { return true }
        _ = waitUntilDecksSheetSettled(app, identifier, timeout: 10)
        if waitUntilHittable(app, identifier, timeout: 0.4) { return true }
        for _ in 0..<max(swipes, 0) {
            if decksSheetIsPresenting(app) {
                _ = waitUntilDecksSheetSettled(app, identifier, timeout: 2)
                if decksSheetIsPresenting(app) { return buttonIsHittable(app, identifier) }
            }
            swipeDecksSheet(app)
            if waitUntilHittable(app, identifier, timeout: 0.4) { return true }
        }
        return buttonIsHittable(app, identifier)
    }

    private static func buttonIsHittable(_ app: XCUIApplication, _ identifier: String) -> Bool {
        let button = app.buttons[identifier].firstMatch
        return button.exists && button.isHittable
    }

    private static func waitUntilHittable(_ app: XCUIApplication, _ identifier: String, timeout: TimeInterval) -> Bool {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            buttonIsHittable(app, identifier)
        }, object: nil)
        return XCTWaiter.wait(for: [ready], timeout: timeout) == .completed
    }

    /// Positive evidence only. A missing sheet is not treated as presenting, so a
    /// hierarchy XCTest does not call a sheet can still be scrolled after the wait.
    private static func decksSheetIsPresenting(_ app: XCUIApplication) -> Bool {
        let sheet = app.sheets.firstMatch
        if sheet.exists && !sheet.isHittable { return true }
        let bar = app.navigationBars["Decks"].firstMatch
        return bar.exists && !bar.isHittable
    }

    private static func decksSheetIsReady(_ app: XCUIApplication) -> Bool {
        let sheet = app.sheets.firstMatch
        if sheet.exists && sheet.isHittable { return true }
        let bar = app.navigationBars["Decks"].firstMatch
        return bar.exists && bar.isHittable
    }

    private static func waitUntilDecksSheetSettled(_ app: XCUIApplication, _ identifier: String, timeout: TimeInterval) -> Bool {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            if buttonIsHittable(app, identifier) { return true }
            return !decksSheetIsPresenting(app) && decksSheetIsReady(app)
        }, object: nil)
        return XCTWaiter.wait(for: [ready], timeout: timeout) == .completed
    }

    private static func swipeDecksSheet(_ app: XCUIApplication) {
        let sheet = app.sheets.firstMatch
        if sheet.exists && sheet.isHittable {
            sheet.swipeUp()
        } else {
            app.swipeUp()
        }
    }

    /// Alert actions and the message are each exposed twice (the control and the
    /// copy inside the alert scroll view). Scope to the presented alert and take
    /// firstMatch so a snapshot, label, or tap resolves to one element.
    static func alertButton(_ app: XCUIApplication, _ name: String) -> XCUIElement {
        app.alerts.firstMatch.buttons[name].firstMatch
    }

    static func alertText(_ app: XCUIApplication, _ name: String) -> XCUIElement {
        app.alerts.firstMatch.staticTexts[name].firstMatch
    }

    static func waitForAlert(_ app: XCUIApplication, titled title: String, timeout: TimeInterval = 5) {
        XCTAssertTrue(app.alerts.firstMatch.waitForExistence(timeout: timeout),
                      "\(title) must appear")
        XCTAssertEqual(app.alerts.firstMatch.label, title)
    }

    /// A dismiss tap can leave the alert in the tree for a beat. Later queries then
    /// resolve the stale actions instead of the Decks list under it.
    static func waitForAlertToDismiss(_ app: XCUIApplication, timeout: TimeInterval = 5) {
        XCTAssertTrue(app.alerts.firstMatch.waitForNonExistence(timeout: timeout),
                      "The alert must disappear before the next query")
    }

    /// List footers and Pro sit below the fold. SwiftUI may not realize them until
    /// they scroll into view. firstMatch covers a duplicated accessibility entry.
    @discardableResult
    static func reveal(_ app: XCUIApplication, _ identifier: String, timeout: TimeInterval = 5) -> XCUIElement {
        let element = app.descendants(matching: .any)[identifier].firstMatch
        if element.waitForExistence(timeout: 1) { return element }
        for _ in 0..<8 {
            app.swipeUp()
            if element.waitForExistence(timeout: 0.5) { return element }
        }
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "\(identifier) must be on screen")
        return element
    }

    private static func terminateAndResetLaunch() {
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = [cleanInstallArgument]
        app.launchEnvironment = [:]
        XCUIDevice.shared.orientation = .portrait
    }

    private static func resetStoreKit() throws -> SKTestSession {
        let session = try SKTestSession(configurationFileNamed: "OmarchyDeck")
        session.resetToDefaultState()
        session.clearTransactions()
        session.disableDialogs = true
        return session
    }

    private static func resetUserDefaults() {
        clearPersisted(UserDefaults.standard)
        if let suite = UserDefaults(suiteName: "net.meshchat.deck") {
            clearPersisted(suite)
            suite.removePersistentDomain(forName: "net.meshchat.deck")
        }
    }

    private static func clearPersisted(_ defaults: UserDefaults) {
        persistedDefaultKeys.forEach { defaults.removeObject(forKey: $0) }
        // The migration flag is per origin: every "deck.legacyCookieMigration.v1.<origin>" must go too.
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix("deck.legacyCookieMigration.v1") {
            defaults.removeObject(forKey: key)
        }
    }

    private static func resetKeychain() {
        let secClasses: [CFString] = [
            kSecClassGenericPassword,
            kSecClassInternetPassword,
            kSecClassCertificate,
            kSecClassKey,
            kSecClassIdentity,
        ]
        for secClass in secClasses {
            SecItemDelete([kSecClass: secClass] as CFDictionary)
        }
    }

    private static func resetDeckStore() {
        let fileManager = FileManager.default
        for cache in fileManager.urls(for: .cachesDirectory, in: .userDomainMask) {
            try? fileManager.removeItem(at: cache.appendingPathComponent("DeckSnapshots", isDirectory: true))
        }
    }
}
