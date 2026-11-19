import XCTest
import StoreKitTest
import UIKit

/// Accepts the simulator fixture certificate for 127.0.0.1 only. The app still uses the trusted test CA.
private final class LocalFixtureTrust: NSObject, URLSessionDelegate {
    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        let host = challenge.protectionSpace.host
        guard host == "127.0.0.1" || host == "localhost",
              challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
}

final class DeckFlowUITests: XCTestCase {
    /// Held for the whole test. ProConnectionUITests buys `net.meshchat.deck.pro` on the local
    /// OmarchyDeck.storekit file. Without a reset, `Transaction.currentEntitlements` still
    /// reports Pro and Add deck becomes `.add` (no `connection.note`) for a Free case.
    private var store: SKTestSession?

    override func setUpWithError() throws {
        continueAfterFailure = false
        store = try UITestLaunch.resetPersistedState()
    }

    /// First launch of a test: no saved decks. StoreKit is already cleared in setUp.
    private func launchFresh(_ extra: [String] = []) -> XCUIApplication {
        UITestLaunch.freshApp(extra)
    }

    /// Relaunch the same app without wiping the deck this test just saved.
    private func relaunchKeepingState(_ app: XCUIApplication) {
        UITestLaunch.relaunchKeepingState(app)
    }

    /// With continueAfterFailure false, a failed assertion unwinds as an exception and Swift `defer` never runs.
    /// Tick 21: testOfflineSceneActivation... failed while the fixture was held, so testPadPage... launched into 503.
    /// tearDown still runs after that unwind, so the fixture is released here for every test.
    override func tearDown() {
        releaseFixtureQuietly()
        UITestLaunch.finishPersistedState(store)
        store = nil
        super.tearDown()
    }

    private func fixtureOrigin() -> String {
        ProcessInfo.processInfo.environment["OMARCHY_DECK_TEST_ORIGIN"] ?? "https://127.0.0.1:28445/"
    }

    /// Best-effort release: tests that never touched the fixture must not fail here when the fixture answers. A non-200,
    /// an error or a 5 s timeout is logged and recorded as an issue (tick 24), because it means the next test may launch
    /// into a held fixture.
    private func releaseFixtureQuietly() {
        guard let base = URL(string: fixtureOrigin()),
              let url = URL(string: "__fixture/release", relativeTo: base)?.absoluteURL else { return }
        let session = URLSession(configuration: .ephemeral, delegate: LocalFixtureTrust(), delegateQueue: nil)
        let done = XCTestExpectation(description: "fixture release in tearDown")
        var outcome = "no response within 5 s"
        var released = false
        session.dataTask(with: url) { data, response, error in
            if let error {
                outcome = "error \(error.localizedDescription)"
            } else {
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                outcome = "status \(status) body \(String(decoding: data ?? Data(), as: UTF8.self))"
                released = status == 200
            }
            done.fulfill()
        }.resume()
        _ = XCTWaiter().wait(for: [done], timeout: 5)
        session.finishTasksAndInvalidate()
        NSLog("DECK_FIXTURE_RELEASE tearDown \(name): \(outcome)")
        if !released {
            record(XCTIssue(type: .assertionFailure,
                            compactDescription: "fixture release in tearDown did not return 200: \(outcome)"))
        }
    }

    /// Fixture controls never count as deck requests.
    private func fixtureResponse(_ name: String) -> (Int, Data) {
        guard let base = URL(string: fixtureOrigin()) else {
            XCTFail("The isolated flow fixture origin is not a URL")
            return (0, Data())
        }
        guard let url = URL(string: "__fixture/\(name)", relativeTo: base)?.absoluteURL else {
            XCTFail("could not build fixture control URL")
            return (0, Data())
        }
        let session = URLSession(configuration: .ephemeral, delegate: LocalFixtureTrust(), delegateQueue: nil)
        let done = expectation(description: "fixture \(name)")
        var status = 0
        var body = Data()
        session.dataTask(with: url) { data, response, _ in
            status = (response as? HTTPURLResponse)?.statusCode ?? 0
            body = data ?? Data()
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 10)
        session.finishTasksAndInvalidate()
        return (status, body)
    }

    /// mock_deck.py control. held=true makes later deck requests return 503 until release.
    private func setFixtureHeld(_ held: Bool, checking: Bool, delayMilliseconds: Int = 0) throws {
        let name = held && delayMilliseconds > 0 ? "hold?delay_ms=\(delayMilliseconds)" :
                   held ? "hold" : "release"
        let (status, data) = fixtureResponse(name)
        if checking {
            XCTAssertEqual(status, 200, "fixture \(name) failed (\(status))")
            XCTAssertEqual(String(data: data, encoding: .utf8), held ? "held" : "up")
        }
    }

    private func fixtureRequestCounts() -> [String: [String: Int]] {
        let (status, data) = fixtureResponse("requests")
        XCTAssertEqual(status, 200, "fixture request counter failed")
        guard let counts = try? JSONDecoder().decode([String: [String: Int]].self, from: data) else {
            XCTFail("fixture request counter did not return client and path counts")
            return [:]
        }
        return counts
    }

    private func fixtureWebViewRequestCount(_ path: String) -> Int {
        fixtureRequestCounts()["webview"]?[path] ?? 0
    }

    private func fixtureRootRequestCount() -> Int {
        fixtureWebViewRequestCount("/")
    }

    /// `reloads` is the page's own `/__gesture/reload` beacon, sent only by a document whose navigation type is
    /// "reload" (WKWebView.reload(), the pull-to-refresh path; scripts/mock_deck.py). `roots` counts every WebKit root GET.
    private struct GestureCounts {
        let touches: Int, scrolls: Int, roots: Int, reloads: Int
    }

    /// One fixture snapshot, so the four numbers describe the same instant.
    private func gestureCounts() -> GestureCounts {
        let counts = fixtureRequestCounts()
        let webview = counts["webview"] ?? [:]
        return GestureCounts(touches: webview["/__gesture/touchstart"] ?? 0,
                             scrolls: webview["/__gesture/scroll"] ?? 0,
                             roots: webview["/"] ?? 0,
                             reloads: webview["/__gesture/reload"] ?? 0)
    }

    /// Owner checklist item 4: pull down, or two-finger double tap, reloads. UIRefreshControl needs a sustained drag;
    /// `app.swipeDown()` is a flick and left the dashboard untouched in tick 21 (final.xcresult, no Refreshing content).
    /// Ticks 22-23 (flow.xcresult): `press(forDuration:thenDragTo:)` starts with a hold, which WebKit routes to its
    /// press recognisers instead of the scroll view, so the dashboard stayed on screen and the fixture saw no request;
    /// and `tap(withNumberOfTaps:2, numberOfTouches:2)` on the WebView and on the application element both died with
    /// "Unable to compute coordinates for gesture", so no two-finger gesture can be synthesized on this simulator.
    /// Tick 24: the same two gestures, no new variant. The fixture page now reports touchstart and scroll to
    /// `/__gesture/<event>`, so each attempt logs a DECK_GESTURE_ISOLATION line telling a gesture that never reached
    /// the page (touchstart +0) from one that reached it but did not reload (touchstart > 0, root +0).
    /// Tick 26 (ReviewDeck26): a root GET alone, or a touch followed by an unrelated root GET, proves nothing. The
    /// reloaded document reports navigation type "reload" to `/__gesture/reload` (`reloads`); a plain load of the root
    /// URL, such as an app retry, is type "navigate" and sends nothing. There is no time window: any reload that
    /// arrives before a poll ends counts, and an earlier attempt's late reload still counts on the next poll.
    /// Returns true only when both the root count and the reload beacon count rose since the start, so a gesture
    /// that did nothing cannot pass, and touch beacons alone never qualify.
    private func pullToRefresh(_ app: XCUIApplication) -> Bool {
        let web = app.webViews.firstMatch
        let start = gestureCounts()
        for attempt in 0..<4 {
            let before = gestureCounts()
            let gesture: String
            if attempt < 2 {
                gesture = "swipeDown(velocity: .slow)"
                web.swipeDown(velocity: .slow)
            } else {
                gesture = "press(0.01s)+drag(.slow)+hold(1s)"
                let top = web.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1))
                let bottom = web.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9))
                top.press(forDuration: 0.01, thenDragTo: bottom, withVelocity: .slow, thenHoldForDuration: 1.0)
            }
            var after = before
            for _ in 0..<24 {
                after = gestureCounts()
                if after.roots > start.roots && after.reloads > start.reloads { break }
                Thread.sleep(forTimeInterval: 0.25)
            }
            let line = "DECK_GESTURE_ISOLATION attempt=\(attempt) gesture=\(gesture) " +
                "touchstart=+\(after.touches - before.touches) scroll=+\(after.scrolls - before.scrolls) " +
                "root=+\(after.roots - before.roots) reload=+\(after.reloads - before.reloads) " +
                "delivered=\(after.touches > before.touches) " +
                "reloaded=\(after.roots > start.roots && after.reloads > start.reloads)"
            NSLog(line)
            XCTContext.runActivity(named: line) { _ in }
            if after.roots > start.roots && after.reloads > start.reloads { return true }
        }
        return false
    }

    /// On Free with one saved deck, saving a new address replaces it and asks first. Pro and first run never ask.
    /// "Replace deck" is also the label of `connection.save` on the same screen, so a label query matches two
    /// buttons and the tap fails with "Multiple matching elements found". The identifier is unique.
    /// A global button query counts the same alert action twice (the action and the copy inside the
    /// alert's scroll view), so this asks for one alert and a confirm on that alert.
    private func assertOneReplaceConfirm(_ app: XCUIApplication) {
        XCTAssertEqual(app.alerts.count, 1, "Replace deck must ask with one alert")
        XCTAssertTrue(UITestLaunch.alertButton(app, "connection.replace.confirm").exists,
                      "Replace deck confirm must exist once")
    }

    private func signInToFixture(_ app: XCUIApplication) {
        openAddDeck(app)
        let field = app.textFields["connection.origin"]
        field.tap()
        field.typeText(fixtureOrigin())
        app.buttons["connection.save"].tap()
        let token = app.secureTextFields["token.field"]
        if token.waitForExistence(timeout: 5) {
            // Tick 12 hides the decorative grid, not the token form's readable controls.
            let tokenScreen = app.scrollViews["screen.token"]
            XCTAssertTrue(tokenScreen.exists)
            XCTAssertEqual(tokenScreen.images.count, 0, "The decorative token header must not enter the accessibility tree")
            token.tap()
            token.typeText("mock-token-0000")
            app.buttons["token.open"].tap()
        } else {
            XCTAssertTrue(app.webViews.firstMatch.staticTexts["MOCK DECK (not the real deck)"].waitForExistence(timeout: 20),
                          "An existing mock session must reopen the dashboard")
        }
    }

    /// First run, or the Decks sheet's list of saved decks.
    private func openDecks(_ app: XCUIApplication) {
        UITestLaunch.openDecks(app)
    }

    /// The address field: on first run directly, otherwise through Decks and its Add deck screen.
    private func openAddDeck(_ app: XCUIApplication) {
        openDecks(app)
        let origin = app.textFields["connection.origin"]
        if !origin.exists {
            let add = app.buttons["connection.add"]
            XCTAssertTrue(add.waitForExistence(timeout: 10), "Decks must offer Add deck")
            add.tap()
        }
        XCTAssertTrue(origin.waitForExistence(timeout: 10))
    }

    /// ContentView names the launch backdrop `deck.starting`. It is a picture or the mark, not a spinner.
    private func startingSpinner(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "deck.starting").firstMatch
    }

    /// The delayed 503 keeps the transition visible; WebKit counts exclude background probes.
    private func assertHeldActivationRequestsDeckThenShowsNotice(_ app: XCUIApplication,
                                                                  notice: XCUIElement, after previousCount: Int) {
        let starting = startingSpinner(app)
        let left = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            starting.exists || !notice.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [left], timeout: 20), .completed,
                       "Activation must leave offline before its held deck request can count")
        var count = previousCount
        for _ in 0..<80 {
            count = fixtureRootRequestCount()
            if count > previousCount { break }
            Thread.sleep(forTimeInterval: 0.25)
        }
        XCTAssertGreaterThan(count, previousCount, "Activation must request the deck again")
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "deck.loading").firstMatch.waitForNonExistence(timeout: 20),
                      "The held deck request must finish before another activation")
        XCTAssertTrue(notice.waitForExistence(timeout: 20),
                      "Held 503 must restore the offline notice after retry")
    }

    /// Tick 33 (ReviewDeck31 LOW): at accessibility text sizes the offline screen's controls sit below the fold, so
    /// the tick 31 captures never showed them. Swipes the ScrollView (up to `limit` times, direction by `up`) until
    /// every listed button is hittable at once. Returns the swipe count; -1 when the buttons never shared a screen.
    @discardableResult
    private func scrollUntilHittable(_ app: XCUIApplication, buttons: [XCUIElement], up: Bool, limit: Int = 6) -> Int {
        for swipes in 0...limit {
            if buttons.allSatisfy(\.isHittable) { return swipes }
            if swipes == limit { break }
            if up { app.swipeUp() } else { app.swipeDown() }
        }
        return -1
    }

    /// Keeps a full-screen capture in the xcresult (`xcrun xcresulttool export attachments` reads it back).
    private func attachScreenshot(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// The desktop serves this panel as HTML, not native feed JSON. This pins its
    /// initially visible content; tapping the summary first would conceal the defect.
    func testLifeAndResearchShowsServerContentWithoutExpanding() throws {
        let app = launchFresh()
        signInToFixture(app)
        let web = app.webViews.firstMatch
        attachScreenshot(app, name: "synthetic-deck-shell-portrait")
        let link = web.links["Life and research fixture"]
        XCTAssertTrue(link.waitForExistence(timeout: 20))
        XCTAssertGreaterThanOrEqual(scrollUntilHittable(app, buttons: [link], up: true), 0,
                                    "The fixture link must be on screen before the navigation tap")
        link.tap()
        let item = web.staticTexts["Fixture market item"]
        let visible = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            item.exists && item.isHittable
        }, object: nil)
        let result = XCTWaiter.wait(for: [visible], timeout: 5)
        attachScreenshot(app, name: "life-research-initial")
        XCTAssertEqual(result, .completed, "Populated Life and research content must not start hidden")
    }

    /// Clean install of saved decks, plus the StoreKit session reset in setUp, so this is Free.
    /// No fixture: 127.0.0.1:59999 is closed. After the first save there is one deck and the
    /// replace note must already be on Add deck, before a second address is typed.
    func testFirstConnectionRejectsInsecureOriginAndFreeExtra() throws {
        let app = launchFresh()
        XCTAssertTrue(app.textFields["connection.origin"].waitForExistence(timeout: 20),
                      "A clean install must show the first-run address field")
        let savedHeader = app.staticTexts.matching(NSPredicate(format: "label ==[c] %@", "Saved decks"))
        XCTAssertEqual(savedHeader.count, 0, "First run must not show an empty Saved decks section")
        let field = app.textFields["connection.origin"]
        field.tap()
        field.typeText("http://example.com/")
        app.buttons["connection.save"].tap()
        XCTAssertTrue(app.staticTexts["connection.error"].waitForExistence(timeout: 5))
        app.buttons["connection.clear"].tap()
        field.tap()
        // I9: a whole deck link with one valid ?t= token is accepted now, so the refused cases are a short token
        // and a non-HTTPS link that carries one.
        field.typeText("https://example.org/?t=short")
        app.buttons["connection.save"].tap()
        XCTAssertTrue(app.staticTexts["connection.error"].waitForExistence(timeout: 5))
        app.buttons["connection.clear"].tap()
        field.tap()
        field.typeText("http://example.org/?t=secret-token")
        app.buttons["connection.save"].tap()
        XCTAssertTrue(app.staticTexts["connection.error"].waitForExistence(timeout: 5))
        app.buttons["connection.clear"].tap()
        field.tap()
        field.typeText("https://127.0.0.1:59999/")
        app.buttons["connection.save"].tap()
        XCTAssertTrue(app.secureTextFields["token.field"].waitForExistence(timeout: 10))
        openAddDeck(app)
        XCTAssertNotEqual(app.staticTexts["pro.title"].firstMatch.label, "Pro is on",
                          "This case is Free; a leftover StoreKit purchase would hide the replace note")
        let note = app.staticTexts["connection.note"]
        XCTAssertTrue(note.waitForExistence(timeout: 5), "Free must say it replaces before anything is typed")
        XCTAssertTrue(app.buttons["connection.save"].label == "Replace deck")
        let second = app.textFields["connection.origin"]
        second.tap()
        second.typeText("https://example.org/")
        app.buttons["connection.save"].tap()
        UITestLaunch.waitForAlert(app, titled: "Replace deck?")
        let confirm = UITestLaunch.alertButton(app, "connection.replace.confirm")
        XCTAssertTrue(confirm.waitForExistence(timeout: 2))
        assertOneReplaceConfirm(app)
        XCTAssertEqual(confirm.label, "Replace deck")
        UITestLaunch.alertButton(app, "connection.replace.keep").tap()
        UITestLaunch.waitForAlertToDismiss(app)
        XCTAssertTrue(second.waitForExistence(timeout: 5), "Keeping the deck must leave the address to correct")
        let decks = app.navigationBars.buttons["Decks"].firstMatch
        XCTAssertTrue(decks.waitForExistence(timeout: 5), "Add deck must keep a Decks back control")
        decks.tap()
        // Add deck still owns connection.origin, so openDecks would return before the list appears.
        XCTAssertTrue(app.buttons["connection.add"].waitForExistence(timeout: 10),
                      "Decks must return after Keep current deck")
        let version = UITestLaunch.reveal(app, "deck.about.version")
        XCTAssertTrue(version.label.hasPrefix("Version "), "About row must start with Version ")
        let copyright = UITestLaunch.reveal(app, "deck.about.copyright")
        XCTAssertEqual(copyright.label, "© 2026 thefiredev-cloud")
    }

    /// Tick 36: the token screen scales with the system text size like the offline screen (build 8) does.
    /// No server is needed: an unanswered address still shows the token form (DeckModel.openSelected reads only local
    /// cookies before `.needsToken`). The test launches at accessibility-extra-extra-extra-large itself so it
    /// runs in the full suite without simctl or a skip.
    func testTokenScreenScalesWithAccessibilityTextSize() throws {
        let app = launchFresh([
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityXXXL"
        ])
        openAddDeck(app)
        let field = app.textFields["connection.origin"]
        field.tap()
        field.typeText("https://127.0.0.1:59999/")
        app.buttons["connection.save"].tap()
        XCTAssertTrue(app.secureTextFields["token.field"].waitForExistence(timeout: 10))
        let title = app.staticTexts["token.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        let open = app.buttons["token.open"]
        XCTAssertTrue(open.waitForExistence(timeout: 5))
        let paste = app.buttons["token.paste"]
        let screen = app.windows.firstMatch.frame
        let titleHeight = title.frame.height   // measured before scrolling moves the title off screen
        attachScreenshot(app, name: "token-axxxl-top")
        // Swipe until Open deck is hittable, fully inside the window, and clear of the keyboard frame.
        // Hittable alone can stop while the button is still partly past the window edge.
        let swipes = TokenScreenVisibility.scrollUntilClear(app, elements: [open, paste])
        let window = app.windows.firstMatch.frame
        attachScreenshot(app, name: "token-axxxl")
        NSLog("DECK_TOKEN_AXXXL title=\(titleHeight) open=\(open.frame.height) openMaxY=\(open.frame.maxY) screenMaxY=\(window.maxY) swipes=\(swipes) pasteExists=\(paste.exists) pasteFrame=\(paste.frame) pasteMaxY=\(paste.frame.maxY) openMinY=\(open.frame.minY) hittable=\(open.isHittable)")
        // A fixed 24 pt heavy title is 28.67 pt per line, so even a wrapped two-line one stays under 58 pt.
        // The scaled title is at least two lines of roughly 57 pt here.
        XCTAssertGreaterThanOrEqual(titleHeight, 100,
                                    "The token title must scale with the accessibility text size, got \(titleHeight)")
        XCTAssertGreaterThanOrEqual(open.frame.height, 50, "Open deck must keep at least its default height")
        // Two lines of the scaled callout stay under 120 pt; "Ope / n / deck" (three lines, 181 pt) does not.
        XCTAssertLessThanOrEqual(open.frame.height, 120, "Open deck must not wrap mid-word, got \(open.frame.height)")
        XCTAssertNotEqual(swipes, -1, "Open deck must scroll fully inside the window and clear of the keyboard")
        XCTAssertLessThanOrEqual(open.frame.maxY, window.maxY, "Open deck must end on screen, maxY \(open.frame.maxY) of \(window.maxY)")
        XCTAssertTrue(open.isHittable, "Open deck must stay on screen at the largest text size")
        XCTAssertTrue(paste.exists, "Paste must exist on the token screen at the largest text size")
        XCTAssertLessThanOrEqual(paste.frame.maxY, open.frame.minY + 1, "Paste must sit above Open deck, not beside it")
        XCTAssertLessThanOrEqual(paste.frame.maxY, screen.maxY, "Paste must end on screen")
    }

    /// Needs scripts/mock_deck.py with its certificate trusted by the owned simulator.
    /// OMARCHY_DECK_TEST_ORIGIN selects an isolated fixture; the default is port 28445, separate from the Pro fixtures.
    func testConfiguredServerCookiePersistsAndExternalLinkLeavesApp() throws {
        let app = launchFresh()
        let origin = fixtureOrigin()
        openAddDeck(app)
        let field = app.textFields["connection.origin"]
        field.tap()
        field.typeText(origin)
        app.buttons["connection.save"].tap()
        let token = app.secureTextFields["token.field"]
        if token.waitForExistence(timeout: 5) {
            token.tap()
            token.typeText("mock-token-0000")
            app.buttons["token.open"].tap()
        }
        XCTAssertTrue(app.webViews.firstMatch.staticTexts["MOCK DECK (not the real deck)"].waitForExistence(timeout: 30))
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            app.webViews.firstMatch.staticTexts["MOCK DECK (not the real deck)"].isHittable
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed)
        app.terminate()
        relaunchKeepingState(app)
        XCTAssertTrue(app.webViews.firstMatch.staticTexts["MOCK DECK (not the real deck)"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.secureTextFields["token.field"].exists)
        app.webViews.firstMatch.links["External link (must open Safari)"].tap()
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 20))
        // Re-assert after the response-policy probe change. Action policy is still
        // action.targetFrame?.isMainFrame ?? true. These three taps stay: plain, target=_blank, game row.
        // A target=_blank link has no target frame. Pages often use it for outside links, and it must leave the app too.
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
        let blank = app.webViews.firstMatch.links["External _blank (must open Safari)"]
        XCTAssertTrue(blank.waitForExistence(timeout: 20))
        blank.tap()
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 20), "A target=_blank outside link must open Safari")
        // The deck server renders each Kings or Ducks game as a block link (a.frow) to its NHL Gamecenter page with
        // target=_blank and rel="noopener noreferrer". The fixture carries one such row; it must leave the app too.
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
        let game = app.webViews.firstMatch.links.matching(NSPredicate(format: "label CONTAINS %@", "LAK vs SJS")).firstMatch
        XCTAssertTrue(game.waitForExistence(timeout: 20))
        game.tap()
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 20), "A game row (noopener _blank link) must open Safari")
    }

    /// Requires the trusted mock_deck.py TLS fixture. Unexecuted until a Mini simulator is approved.
    func testPadPageOpensSameOriginWebSocket() throws {
        let app = launchFresh()
        signInToFixture(app)
        XCTAssertTrue(app.webViews.firstMatch.staticTexts["MOCK DECK (not the real deck)"].waitForExistence(timeout: 30))
        let pad = app.webViews.firstMatch.links["Pad socket fixture"]
        XCTAssertTrue(pad.waitForExistence(timeout: 20))
        pad.tap()
        XCTAssertTrue(app.webViews.firstMatch.staticTexts["Pad socket open"].waitForExistence(timeout: 20),
                      "The pad page must receive the fixture's echoed WebSocket text frame")
    }

    /// Requires scripts/mock_deck.py with its certificate trusted by the simulator.
    /// This page needs to load before the camera assertion; this test does not isolate a missing page-level HTTPS rule.
    func testCamPageLoadsSameOriginStream() throws {
        let app = launchFresh()
        signInToFixture(app)
        XCTAssertTrue(app.webViews.firstMatch.staticTexts["MOCK DECK (not the real deck)"].waitForExistence(timeout: 30))
        let camera = app.webViews.firstMatch.links["Camera fixture"]
        XCTAssertTrue(camera.waitForExistence(timeout: 20))
        // The fixture counter is cumulative across tests, so compare against the count read before this tap.
        let playlistRequestsBefore = fixtureWebViewRequestCount("/cam/index.m3u8")
        camera.tap()
        XCTAssertTrue(app.webViews.firstMatch.staticTexts["Camera video playing"].waitForExistence(timeout: 30),
                      "The fixture HLS media must reach the video playing event")
        XCTAssertGreaterThan(fixtureWebViewRequestCount("/cam/index.m3u8"), playlistRequestsBefore,
                             "The page must request its same-origin playlist")
    }

    /// Needs scripts/mock_deck.py from this revision. The test holds the fixture, so a cached page cannot hide the outage.
    /// After the banner appears it holds again, so Deck is back must hide, then releases so the banner returns.
    /// Link policy is not covered here; testConfiguredServerCookiePersistsAndExternalLinkLeavesApp still taps the plain link,
    /// the target=_blank link, and the game row.
    /// I1: the app now reconnects by itself on the first answer, so this banner suite launches with
    /// `-deck-no-auto-reconnect` (DEBUG only) to keep the manual Deck is back path on screen.
    func testOfflineReconnectBannerWhenFixtureReturns() throws {
        let app = launchFresh(["-deck-no-auto-reconnect"])
        signInToFixture(app)
        XCTAssertTrue(app.webViews.firstMatch.staticTexts["MOCK DECK (not the real deck)"].waitForExistence(timeout: 30))
        app.terminate()
        try setFixtureHeld(true, checking: true)
        defer { try? setFixtureHeld(false, checking: false) }
        relaunchKeepingState(app)
        let offline = app.staticTexts["offline.title"]
        let cached = app.webViews.firstMatch.staticTexts["MOCK DECK (not the real deck)"]
        let shown = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            offline.exists || cached.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [shown], timeout: 25), .completed)
        if !offline.exists {
            app.webViews.firstMatch.swipeDown(velocity: .slow)
            XCTAssertTrue(offline.waitForExistence(timeout: 20), "A reload while the fixture is held must show Check your connection")
        }
        let offlineScreen = app.scrollViews["screen.offline"]
        XCTAssertTrue(offlineScreen.exists)
        // The Details disclosure draws its own chevron; the decorative cause glyph is the image that must stay hidden.
        let decorative = offlineScreen.images.matching(NSPredicate(format: "NOT (identifier IN {'expanded', 'collapsed'})"))
        XCTAssertEqual(decorative.count, 0, "The decorative cause glyph must not enter the accessibility tree")
        let banner = app.staticTexts["reconnect.banner"]
        XCTAssertFalse(banner.waitForExistence(timeout: 3), "Banner must stay hidden while the fixture is held")
        try setFixtureHeld(false, checking: true)
        XCTAssertTrue(banner.waitForExistence(timeout: 12), "Deck is back must appear after the fixture answers")
        XCTAssertEqual(banner.label, "Deck is back", "VoiceOver must read the banner title")
        XCTAssertEqual(app.buttons["reconnect.open"].label, "Reconnect", "VoiceOver must read the Reconnect control")
        XCTAssertEqual(app.staticTexts["reconnect.detail"].label, "Your server answered. Tap Reconnect to open it.",
                       "VoiceOver must read the banner detail")
        // Tick 33: Reconnect, Retry and Sign in again must all be reachable (and shown together) at any text size.
        let offlineButtons = ["reconnect.open", "offline.retry", "offline.signout"].map { app.buttons[$0] }
        for button in offlineButtons {
            XCTAssertTrue(button.waitForExistence(timeout: 5), "\(button.identifier) must exist on the offline screen")
        }
        let swipes = scrollUntilHittable(app, buttons: offlineButtons, up: true)
        let screenshotName = ProcessInfo.processInfo.environment["OMARCHY_DECK_SCREENSHOT_NAME"] ?? "offline-axxxl-buttons"
        attachScreenshot(app, name: screenshotName)
        NSLog("DECK_OFFLINE_BUTTONS swipes=\(swipes) hittable=\(offlineButtons.map(\.isHittable))")
        XCTAssertNotEqual(swipes, -1, "Reconnect, Retry and Sign in again must fit one screen after scrolling, got \(offlineButtons.map(\.isHittable))")
        // Tick 28: one instruction per state. The Retry paragraph must not sit under the Reconnect banner.
        let notice = app.staticTexts["offline.notice"]
        XCTAssertFalse(notice.exists, "The Then tap Retry text must hide while Deck is back is showing")
        try setFixtureHeld(true, checking: true)
        let hidden = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !banner.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [hidden], timeout: 12), .completed, "Banner must hide when the fixture drops again")
        XCTAssertTrue(offline.exists, "Check your connection stays up after the banner hides")
        XCTAssertTrue(notice.waitForExistence(timeout: 5), "The Then tap Retry text must return once the banner hides")
        try setFixtureHeld(false, checking: true)
        XCTAssertTrue(banner.waitForExistence(timeout: 12), "Deck is back must return after the fixture answers again")
        // The screenshot scroll above may have left the banner above the fold at large sizes.
        XCTAssertNotEqual(scrollUntilHittable(app, buttons: [app.buttons["reconnect.open"]], up: false), -1,
                          "Reconnect must be reachable again after scrolling back")
        app.buttons["reconnect.open"].tap()
        XCTAssertTrue(app.webViews.firstMatch.staticTexts["MOCK DECK (not the real deck)"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.staticTexts["reconnect.banner"].exists)
    }

    /// I1: a wall-mounted deck must come back after a server restart with no tap. The fixture holds (server down),
    /// the app goes offline, the fixture releases (server back) and the dashboard returns without Reconnect or Retry.
    func testRestartedServerReturnsTheDeckWithNoTap() throws {
        try setFixtureHeld(false, checking: true)
        let app = launchFresh()
        signInToFixture(app)
        let dashboard = app.webViews.firstMatch.staticTexts["MOCK DECK (not the real deck)"]
        XCTAssertTrue(dashboard.waitForExistence(timeout: 30))
        app.terminate()
        try setFixtureHeld(true, checking: true)
        defer { try? setFixtureHeld(false, checking: false) }
        relaunchKeepingState(app)
        let offline = app.staticTexts["offline.title"]
        XCTAssertTrue(offline.waitForExistence(timeout: 25), "A held fixture must show the offline screen")
        let beforeRelease = fixtureRootRequestCount()
        try setFixtureHeld(false, checking: true)
        let recovered = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            dashboard.exists && !offline.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [recovered], timeout: 30), .completed,
                       "The deck must return by itself once the server answers (no Reconnect tap)")
        XCTAssertGreaterThan(fixtureRootRequestCount(), beforeRelease, "Recovery must come from a new deck request")
        attachScreenshot(app, name: "auto-reconnect-ready")
    }

    /// I3: Almanac is a same-origin server page with no way home. Back to deck returns to `/`, and so does Reload deck.
    func testAlmanacBackToDeckAndReloadReturnToTheDeckRoot() throws {
        try setFixtureHeld(false, checking: true)
        let app = launchFresh()
        signInToFixture(app)
        let web = app.webViews.firstMatch
        let dashboard = web.staticTexts["MOCK DECK (not the real deck)"]
        XCTAssertTrue(dashboard.waitForExistence(timeout: 30))
        let back = app.buttons["deck.back"]
        XCTAssertFalse(back.exists, "The deck's own root needs no Back control")
        let almanacLink = web.links["Almanac (server page)"]
        XCTAssertTrue(almanacLink.waitForExistence(timeout: 10))
        if !almanacLink.isHittable { web.swipeUp() }
        almanacLink.tap()
        let almanac = web.staticTexts["MOCK ALMANAC (server page)"]
        XCTAssertTrue(almanac.waitForExistence(timeout: 20), "The Almanac link must open in the shell")
        XCTAssertTrue(back.waitForExistence(timeout: 10), "A server page must offer Back to deck")
        XCTAssertEqual(back.label, "Back to deck")
        XCTAssertGreaterThanOrEqual(back.frame.height, 44, "Back to deck must be a 44 pt target")
        attachScreenshot(app, name: "almanac-back-to-deck")
        back.tap()
        XCTAssertTrue(dashboard.waitForExistence(timeout: 20), "Back to deck must land on the deck root")
        XCTAssertTrue(back.waitForNonExistence(timeout: 10), "Back to deck hides again on `/`")
        // Reload deck from Almanac loads `/`, not Almanac again.
        almanacLink.tap()
        XCTAssertTrue(almanac.waitForExistence(timeout: 20))
        openDecks(app)
        let reload = app.buttons["connection.reload"]
        XCTAssertTrue(UITestLaunch.realize(app, "connection.reload"), "Decks must offer Reload deck")
        reload.tap()
        XCTAssertTrue(dashboard.waitForExistence(timeout: 20), "Reload deck from Almanac must load the deck root")
        XCTAssertFalse(almanac.exists)
    }

    /// I9: a whole deck link pasted in the address field saves the address and opens the deck with no token screen.
    func testPastedDeckLinkOpensTheDeckWithoutTheTokenScreen() throws {
        try setFixtureHeld(false, checking: true)
        let app = launchFresh()
        openAddDeck(app)
        let field = app.textFields["connection.origin"]
        field.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        field.typeText(fixtureOrigin() + "?t=mock-token-0000")
        app.buttons["connection.save"].tap()
        XCTAssertTrue(app.webViews.firstMatch.staticTexts["MOCK DECK (not the real deck)"].waitForExistence(timeout: 30),
                      "The pasted link must open the deck")
        XCTAssertFalse(app.secureTextFields["token.field"].exists, "The token screen must be skipped")
    }

    /// I10: the Decks sheet names the role the deck reported and offers Sign out, which keeps the address.
    func testDecksSheetNamesTheOwnerAndSignsOut() throws {
        try setFixtureHeld(false, checking: true)
        let app = launchFresh()
        signInToFixture(app)
        XCTAssertTrue(app.webViews.firstMatch.staticTexts["MOCK DECK (not the real deck)"].waitForExistence(timeout: 30))
        openDecks(app)
        // The role arrives from /api/whoami just after the page is ready; realize scrolls the lazy list to it.
        _ = UITestLaunch.realize(app, "connection.role")
        let role = app.descendants(matching: .any).matching(identifier: "connection.role").firstMatch
        XCTAssertTrue(role.waitForExistence(timeout: 10))
        XCTAssertTrue(role.label.contains("Signed in as Owner"), role.label)
        XCTAssertTrue(UITestLaunch.realize(app, "connection.signout"))
        app.buttons["connection.signout"].tap()
        let confirm = UITestLaunch.alertButton(app, "connection.signout.confirm")
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "Sign out must ask first")
        confirm.tap()
        XCTAssertTrue(app.secureTextFields["token.field"].waitForExistence(timeout: 20),
                      "Signing out returns to the token screen for the same deck")
    }

    /// I10: a guest token is named as Guest.
    func testGuestTokenIsNamedGuest() throws {
        try setFixtureHeld(false, checking: true)
        let app = launchFresh()
        openAddDeck(app)
        let field = app.textFields["connection.origin"]
        field.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        field.typeText(fixtureOrigin() + "?t=guest-mock-token-0000")
        app.buttons["connection.save"].tap()
        XCTAssertTrue(app.webViews.firstMatch.staticTexts["MOCK DECK (not the real deck)"].waitForExistence(timeout: 30))
        openDecks(app)
        _ = UITestLaunch.realize(app, "connection.role")
        let role = app.descendants(matching: .any).matching(identifier: "connection.role").firstMatch
        XCTAssertTrue(role.waitForExistence(timeout: 10))
        XCTAssertTrue(role.label.contains("Signed in as Guest"), role.label)
    }

    /// Uses the owned mock_deck.py fixture with default token and title.
    /// offline.notice can exist only once, so a count of 1 does not prove a retry.
    /// Each held activation increments the fixture's root-request count before the notice returns.
    /// Tick 24: the offline screen is reached by the owner's checklist item 2 route (close fully, reopen). A relaunch
    /// always asks the host (DeckConfig.rootRequest ignores the cache, DeckConfig.swift:61-62), so the held fixture
    /// answers 503 after its delay and the app shows Check your connection with no synthesized gesture. Pull-to-refresh
    /// has its own acceptance test, testPullToRefreshRequestsDeckAgain, below.
    func testOfflineSceneActivationShowsOneRetryNoticeAndRecovers() throws {
        try setFixtureHeld(false, checking: true)
        defer { try? setFixtureHeld(false, checking: false) }
        let app = launchFresh()
        openDecks(app)
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
        signInToFixture(app)
        let dashboard = app.webViews.firstMatch.staticTexts["MOCK DECK (not the real deck)"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            dashboard.isHittable
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed)
        app.terminate()
        try setFixtureHeld(true, checking: true, delayMilliseconds: 5000)
        let beforeRelaunch = fixtureRootRequestCount()
        relaunchKeepingState(app)
        // The fixture delays the network response, keeping .loading observable without a production test hook.
        let loading = app.descendants(matching: .any).matching(identifier: "deck.loading").firstMatch
        XCTAssertTrue(loading.waitForExistence(timeout: 3), "The delayed fixture must expose the loading backdrop")
        XCTAssertEqual(loading.label, "Loading deck")
        let offline = app.staticTexts["offline.title"]
        XCTAssertTrue(offline.waitForExistence(timeout: 20), "A relaunch into the held fixture must show Check your connection")
        XCTAssertGreaterThan(fixtureRootRequestCount(), beforeRelaunch, "The relaunch must request the deck from the fixture")
        let notice = app.staticTexts["offline.notice"]
        XCTAssertTrue(notice.waitForExistence(timeout: 10))
        XCTAssertEqual(notice.label,
                       "Your server answered but couldn't open the deck. This is often temporary. Tap Retry in a moment.")
        // Tick 26: the offline screen names the deck that did not answer (host and port of the fixture origin).
        let server = app.staticTexts["offline.server"]
        XCTAssertTrue(server.waitForExistence(timeout: 5), "The offline screen must name the unreachable deck")
        if let url = URL(string: fixtureOrigin()), let host = url.host, let port = url.port {
            XCTAssertTrue(server.label.contains("\(host):\(port)"),
                          "offline.server must show the selected deck address, got \(server.label)")
        } else {
            XCTFail("OMARCHY_DECK_TEST_ORIGIN must carry a host and port")
        }

        // First activation while held. The notice already on screen must not satisfy this wait.
        XCUIDevice.shared.press(.home)
        let firstCount = fixtureRootRequestCount()
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
        assertHeldActivationRequestsDeckThenShowsNotice(app, notice: notice, after: firstCount)
        XCTAssertTrue(app.buttons["offline.retry"].exists)
        XCTAssertFalse(app.staticTexts["reconnect.banner"].exists)

        // Second activation while the fixture still holds 503. This replaces the count tautology.
        XCUIDevice.shared.press(.home)
        let secondCount = fixtureRootRequestCount()
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
        assertHeldActivationRequestsDeckThenShowsNotice(app, notice: notice, after: secondCount)

        // Release only after that held retry has settled. An in-flight retry could load the dashboard first.
        XCUIDevice.shared.press(.home)
        try setFixtureHeld(false, checking: true)
        let beforeRecovery = fixtureRootRequestCount()
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
        let starting = startingSpinner(app)
        // Tick 28: offline.notice also hides under the Deck is back banner, so the offline title is the state signal.
        let left = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            starting.exists || !offline.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [left], timeout: 20), .completed,
                       "Recovery activation must leave the offline screen before the dashboard can count")
        let recovered = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            dashboard.isHittable && !offline.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [recovered], timeout: 30), .completed,
                       "The active scene must retry the offline deck without a Retry or Reconnect tap")
        XCTAssertGreaterThan(fixtureRootRequestCount(), beforeRecovery, "Recovery must come from a new deck request")
    }

    /// Owner checklist item 4 as its own acceptance test, kept apart from the scene test so that test no longer depends
    /// on gesture synthesis. Tick 24 on the iOS 27 simulator (build/deck24-run.log): the slow swipe is delivered
    /// (touchstart +1, scroll +3) but never crosses the refresh threshold (root +0); the 0.01 s press-and-drag is
    /// delivered and reloads (touchstart +2, scroll +13, root +1). The assertion is strict: a run where no gesture
    /// reaches the page or none reloads fails, and the DECK_GESTURE_ISOLATION lines say which (README,
    /// "Pull-to-refresh on the simulator").
    func testPullToRefreshRequestsDeckAgain() throws {
        try setFixtureHeld(false, checking: true)
        let app = launchFresh()
        signInToFixture(app)
        let dashboard = app.webViews.firstMatch.staticTexts["MOCK DECK (not the real deck)"]
        XCTAssertTrue(dashboard.waitForExistence(timeout: 30))
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in dashboard.isHittable }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed)
        let startTouches = gestureCounts().touches
        let reloaded = pullToRefresh(app)
        XCTAssertGreaterThan(gestureCounts().touches, startTouches, "The gestures must reach the page (touchstart beacon)")
        XCTAssertTrue(reloaded, "Pull-to-refresh must request the deck root again")
    }

    /// Gap 1: the Decks control is a 44 pt glass circle inside the top-trailing corner of the safe area. After 3 s idle
    /// it dims but stays on screen and tappable, so one tap always opens Decks (Guideline 5.6).
    /// The dim itself and the 56px corner the page hears are pinned in ChromeTests.
    func testDecksControlIsFortyFourPointsInTheTopTrailingCornerAndStaysTappable() throws {
        try setFixtureHeld(false, checking: true)
        let app = launchFresh()
        signInToFixture(app)
        XCTAssertTrue(app.webViews.firstMatch.staticTexts["MOCK DECK (not the real deck)"].waitForExistence(timeout: 30))
        let manage = app.buttons["connection.manage"]
        XCTAssertTrue(manage.waitForExistence(timeout: 10))
        XCTAssertEqual(manage.label, "Decks")
        // The fade animation is 0.3 s. An NSPredicate on the captured element never saw this frame
        // (the waiter timed out while the failure text already read 44×44). Poll a fresh query.
        let settleBy = Date().addingTimeInterval(2)
        var width = CGFloat.zero
        var height = CGFloat.zero
        while Date() < settleBy {
            let frame = app.buttons["connection.manage"].frame
            width = frame.width
            height = frame.height
            if abs(width - 44) <= 0.5, abs(height - 44) <= 0.5 { break }
        }
        XCTAssertEqual(width, 44, accuracy: 0.5)
        XCTAssertEqual(height, 44, accuracy: 0.5)
        let window = app.windows.firstMatch.frame
        XCTAssertLessThanOrEqual(manage.frame.maxX, window.maxX - 8 + 0.5, "Inside the trailing edge, with air")
        XCTAssertGreaterThanOrEqual(manage.frame.minY, window.minY + 8 - 0.5, "Below the top edge, with air")
        XCTAssertLessThan(manage.frame.midX, window.maxX)
        XCTAssertGreaterThan(manage.frame.midX, window.midX, "In the trailing half")
        XCTAssertLessThan(manage.frame.midY, window.midY, "In the top half")
        attachScreenshot(app, name: "decks-control-visible")

        // Idle past the 3 s dim. The control stays on screen and tappable, so the corner keeps
        // its reserve and one tap opens Decks (Guideline 5.6).
        Thread.sleep(forTimeInterval: 4.5)
        attachScreenshot(app, name: "decks-control-dimmed")
        let dimmed = app.buttons["connection.manage"]
        XCTAssertTrue(dimmed.exists, "The Decks control must stay on screen after the idle wait")
        XCTAssertTrue(dimmed.isHittable, "The Decks control must stay tappable after the idle wait")
        XCTAssertEqual(dimmed.frame.width, 44, accuracy: 0.5, "Dimming must not shrink the tap target")
        XCTAssertEqual(dimmed.frame.height, 44, accuracy: 0.5, "Dimming must not shrink the tap target")
        dimmed.tap()
        XCTAssertTrue(app.buttons["connection.add"].waitForExistence(timeout: 10),
                      "One tap on the dimmed control must open Decks")
    }

    // MARK: Calm offline copy, one title per cause, confirmations

    private let fixtureDashboardTitle = "MOCK DECK (not the real deck)"

    /// Launches the app, signs in to the fixture when no session is saved, and leaves the dashboard on screen.
    private func launchSignedInToFixture() -> XCUIApplication {
        let app = launchFresh()
        signInToFixture(app)
        XCTAssertTrue(app.webViews.firstMatch.staticTexts[fixtureDashboardTitle].waitForExistence(timeout: 30))
        return app
    }

    /// A 503 is "Your deck hit a problem". The raw status stays behind Details, and signing out asks first.
    func testOfflineTitleForServerErrorHidesStatusCodeAndSignOutAsksFirst() throws {
        try setFixtureHeld(false, checking: true)
        let app = launchSignedInToFixture()
        app.terminate()
        try setFixtureHeld(true, checking: true)
        relaunchKeepingState(app)
        let title = app.staticTexts["offline.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 25), "A held fixture must show the offline screen")
        XCTAssertEqual(title.label, "Your deck hit a problem")
        let rawStatus = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'HTTP 5'"))
        XCTAssertEqual(rawStatus.count, 0, "The raw status code must not show until Details is opened")
        XCTAssertFalse(app.staticTexts["offline.reason"].exists)
        scrollUntilHittable(app, buttons: [app.buttons["Details"]], up: true)
        app.buttons["Details"].tap()
        let reason = app.staticTexts["offline.reason"]
        XCTAssertTrue(reason.waitForExistence(timeout: 5), "Details must reveal the raw sentence")
        XCTAssertTrue(reason.label.contains("HTTP 503"), reason.label)

        // One primary action: Retry. Signing out asks before it clears the session.
        XCTAssertTrue(app.buttons["offline.retry"].exists)
        scrollUntilHittable(app, buttons: [app.buttons["offline.signout"]], up: true)
        app.buttons["offline.signout"].tap()
        let keep = UITestLaunch.alertButton(app, "Keep waiting")
        XCTAssertTrue(keep.waitForExistence(timeout: 5), "Sign in again must ask for confirmation")
        keep.tap()
        UITestLaunch.waitForAlertToDismiss(app)
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertFalse(app.secureTextFields["token.field"].exists, "Cancel must not sign the device out")
    }

    /// A closed port is "Can't reach your deck", not a status code or a generic error.
    func testOfflineTitleForUnreachableServer() throws {
        let app = launchFresh()
        openAddDeck(app)
        let field = app.textFields["connection.origin"]
        field.tap()
        field.typeText("https://127.0.0.1:59999/")
        app.buttons["connection.save"].tap()
        let token = app.secureTextFields["token.field"]
        XCTAssertTrue(token.waitForExistence(timeout: 10))
        token.tap()
        token.typeText("unreachable-token-0000")
        app.buttons["token.open"].tap()
        let title = app.staticTexts["offline.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 30), "A closed port must reach the offline screen")
        XCTAssertEqual(title.label, "Can't reach your deck")
    }

    /// A saved session the server no longer accepts leads with "Sign in again".
    func testExpiredSessionTitleLeadsWithSignInAgain() throws {
        try setFixtureHeld(false, checking: true)
        let app = launchSignedInToFixture()
        XCTAssertEqual(fixtureResponse("expire").0, 200)
        app.terminate()
        relaunchKeepingState(app)
        let title = app.staticTexts["token.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 25), "A rejected session must show the sign-in screen")
        XCTAssertEqual(title.label, "Sign in again")
        XCTAssertFalse(app.staticTexts["offline.title"].exists)
    }

    /// Swipe-delete removes a deck's session too, so it asks first. Keeping the deck leaves the row in place.
    func testSwipeDeleteAsksBeforeRemovingDeck() throws {
        let app = launchFresh()
        openDecks(app)
        let rows = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'connection.https://'"))
        if rows.count == 0 {
            let field = app.textFields["connection.origin"]
            field.tap()
            field.typeText("https://127.0.0.1:59999/")
            app.buttons["connection.save"].tap()
            XCTAssertTrue(app.secureTextFields["token.field"].waitForExistence(timeout: 10))
            openDecks(app)
        }
        let row = rows.firstMatch
        let identifier = row.identifier
        row.swipeLeft()
        let delete = app.buttons["Delete"].firstMatch
        XCTAssertTrue(delete.waitForExistence(timeout: 5), "Swipe-delete must show Delete")
        delete.tap()
        let keep = UITestLaunch.alertButton(app, "Keep deck")
        XCTAssertTrue(keep.waitForExistence(timeout: 5), "Deleting a deck must ask first")
        keep.tap()
        UITestLaunch.waitForAlertToDismiss(app)
        XCTAssertTrue(app.buttons[identifier].waitForExistence(timeout: 5), "Keeping the deck must leave its row")
    }

    /// VoiceOver activate reaches PasteButton only when `token.paste` is that control. One match, then `tap()`
    /// (never a coordinate). The test process writes one fixture string; the app reads the clipboard only through PasteButton.
    func testTokenPasteButtonIsTheOnlyMatchAndFillsTheField() throws {
        let app = launchFresh()
        openTokenScreen(app)
        let open = app.buttons["token.open"]
        XCTAssertTrue(open.waitForExistence(timeout: 5))
        XCTAssertFalse(open.isEnabled, "Open deck stays disabled until the field has a token")
        let done = app.buttons["keyboard.done"]
        if done.waitForExistence(timeout: 2), done.isHittable { done.tap() }
        UIPasteboard.general.string = "pasted-token-0000"
        let paste = app.buttons.matching(identifier: "token.paste")
        XCTAssertEqual(paste.count, 1)
        paste.firstMatch.tap()
        let filled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            open.isEnabled && Self.tokenFieldIsFilled(app.secureTextFields["token.field"])
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [filled], timeout: 5), .completed, "Paste must fill the token field")
    }

    /// The empty token screen is the one the contrast audit failed on: disabled Open deck and the server caption.
    func testTokenScreenPassesAccessibilityAudit() throws {
        let app = launchFresh()
        openTokenScreen(app)
        let done = app.buttons["keyboard.done"]
        if done.waitForExistence(timeout: 2), done.isHittable { done.tap() }
        XCTAssertTrue(app.staticTexts["token.server"].waitForExistence(timeout: 5))
        try app.performAccessibilityAudit()
    }

    /// An unanswered address still shows the token form. No fixture is required.
    private func openTokenScreen(_ app: XCUIApplication) {
        openAddDeck(app)
        let field = app.textFields["connection.origin"]
        field.tap()
        field.typeText("https://127.0.0.1:59999/")
        app.buttons["connection.save"].tap()
        XCTAssertTrue(app.scrollViews["screen.token"].waitForExistence(timeout: 10))
    }

    /// Secure fields may expose the text or bullets. Either is filled. The placeholder is not. The value is not logged.
    private static func tokenFieldIsFilled(_ field: XCUIElement) -> Bool {
        guard let value = field.value as? String else { return false }
        return !value.isEmpty && value != "Deck token"
    }
}
