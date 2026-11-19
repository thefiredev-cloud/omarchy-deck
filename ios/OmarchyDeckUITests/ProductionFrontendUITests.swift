import StoreKitTest
import XCTest

/// Accepts the simulator fixture certificate for 127.0.0.1 only, for the test's own fixture counter request.
private final class FrontendFixtureTrust: NSObject, URLSessionDelegate {
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.host == "127.0.0.1",
              challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
}

/// Production frontend source + synthetic backend on native WKWebView. No live service or camera hardware.
/// Uses the committed archive behind scripts/production_frontend_fixture.py on loopback TLS.
final class ProductionFrontendUITests: XCTestCase {
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

    private func capture(_ name: String) {
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = "production-frontend-synthetic-" + name
        image.lifetime = .keepAlways
        add(image)
    }

    private func visible(_ element: XCUIElement, timeout: TimeInterval = 20) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout))
        let web = XCUIApplication().webViews.firstMatch
        // Static WebKit headings have no activation point. Verify their rendered bounds, not tap hittability.
        for _ in 0..<8 {
            if web.frame.intersects(element.frame) && element.frame.width > 0 && element.frame.height > 0 { return }
            web.swipeUp()
        }
        XCTFail("The expected frontend content must be within the native WebView viewport")
    }

    /// WebKit keeps reporting the layout it had before a rotation for up to a few seconds: the strip reads as a tall
    /// portrait box inside a wide landscape window and every tab frame is the old one turned a quarter turn. A tap
    /// synthesized from those frames lands on another tab and the page never changes, so wait until the strip reports
    /// the same horizontal, touch-sized frame twice in a row before measuring or tapping anything.
    private func settledPageStrip(in web: XCUIElement, timeout: TimeInterval = 10) {
        let strip = web.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Pages'")).firstMatch
        let deadline = Date().addingTimeInterval(timeout)
        var previous = CGRect.null
        while Date() < deadline {
            let frame = strip.exists ? strip.frame : .null
            let touchSizedTabs = ["Today", "Fleet", "Life"].allSatisfy {
                web.buttons.matching(NSPredicate(format: "label == %@", $0)).firstMatch.frame.height >= 44
            }
            if frame.width > frame.height, frame.height >= 44, touchSizedTabs, frame == previous { return }
            previous = frame
            Thread.sleep(forTimeInterval: 0.4)
        }
    }

    /// Select a page and confirm the page actually switched. The strip is a sideways scroller, so a tab can be
    /// clipped, and a tap can still be lost while the page relayouts; both are retried a bounded number of times
    /// against freshly read frames instead of being reported as a page failure.
    private func openPage(_ name: String, expected: XCUIElement, in web: XCUIElement) {
        for _ in 0..<3 {
            settledPageStrip(in: web)
            selectPage(name, in: web)
            if expected.waitForExistence(timeout: 10) { return }
        }
        settledPageStrip(in: web)
        selectPage(name, in: web)
        XCTAssertTrue(expected.waitForExistence(timeout: 20), "\(name) must open its page")
    }

    /// The page strip scrolls sideways. A tab past its right edge is clipped even though the accessibility tree still
    /// reports a frame there, and a tap on that frame lands on the status pill or the page. A swipe flings the strip to
    /// its end, so drag by the measured distance instead until the tab's centre is inside the strip, then tap it.
    private func selectPage(_ name: String, in web: XCUIElement) {
        let button = web.buttons[name]
        XCTAssertTrue(button.waitForExistence(timeout: 10), "\(name) page button must exist")
        let strip = web.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Pages'")).firstMatch
        XCTAssertTrue(strip.waitForExistence(timeout: 10), "The page strip must exist")
        func inStrip() -> Bool {
            strip.frame.insetBy(dx: 8, dy: 0).contains(CGPoint(x: button.frame.midX, y: button.frame.midY)) && button.isHittable
        }
        // The strip is a CSS scroller (overflow-x:auto, touch-action:pan-x). A drag that ends
        // past the screen edge is clamped, and a fast swipe is treated as a fling, so drag
        // slowly between two points inside the strip: right brings earlier tabs back, left
        // brings later ones in.
        func drag(earlier: Bool) {
            let from = CGVector(dx: earlier ? 0.15 : 0.85, dy: 0.5)
            let to = CGVector(dx: earlier ? 0.85 : 0.15, dy: 0.5)
            strip.coordinate(withNormalizedOffset: from)
                .press(forDuration: 0.15,
                       thenDragTo: strip.coordinate(withNormalizedOffset: to),
                       withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        for _ in 0..<8 where !inStrip() {
            drag(earlier: button.frame.midX < strip.frame.midX)
            Thread.sleep(forTimeInterval: 0.5)
        }
        XCTAssertTrue(inStrip(), "\(name) must be reachable in the page strip, button \(button.frame) strip \(strip.frame)")
        button.tap()
    }

    func testCommittedFrontendFleetLifeReserveAndRotation() throws {
        let origin = ProcessInfo.processInfo.environment["OMARCHY_DECK_FRONTEND_ORIGIN"]
            ?? "https://127.0.0.1:28446/"
        XCUIDevice.shared.orientation = .portrait
        let app = UITestLaunch.freshApp()
        let address = app.textFields["connection.origin"]
        XCTAssertTrue(address.waitForExistence(timeout: 20))
        address.tap()
        address.typeText(origin)
        app.buttons["connection.save"].tap()
        let token = app.secureTextFields["token.field"]
        XCTAssertTrue(token.waitForExistence(timeout: 20))
        token.tap()
        token.typeText("production-frontend-fixture-0000")
        app.buttons["token.open"].tap()

        let web = app.webViews.firstMatch
        XCTAssertTrue(web.buttons["Today"].waitForExistence(timeout: 30))
        let manage = app.buttons["connection.manage"]
        XCTAssertTrue(manage.waitForExistence(timeout: 10))
        XCTAssertEqual(manage.frame.width, 44, accuracy: 0.5)
        capture("portrait-shell")

        for (step, orientation) in [UIDeviceOrientation.landscapeLeft, .portrait].enumerated() {
            XCUIDevice.shared.orientation = orientation
            let machine = web.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'Machines'")).firstMatch
            openPage("Fleet", expected: machine, in: web)
            visible(machine)
            capture("\(step)-fleet")

            let headline = web.descendants(matching: .any).matching(
                NSPredicate(format: "label CONTAINS 'Fixture headline one: markets move on synthetic news'")
            ).firstMatch
            openPage("Life", expected: headline, in: web)
            visible(headline)
            capture("\(step)-life")

            Thread.sleep(forTimeInterval: 4.5)
            capture("\(step)-reserve-hidden")
            // The control dims but never stops taking taps (Guideline 5.6, build 21): one tap
            // opens Decks, and the production page stays underneath it.
            manage.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            XCTAssertTrue(app.buttons["connection.add"].waitForExistence(timeout: 5),
                          "The dimmed control must still open Decks in one tap")
            capture("\(step)-reserve-visible")
            // Done closes the sheet. A swipe down lands on the sheet's own list and scrolls it, which left the sheet
            // open and every later page tap answered by the sheet (2026-10-29).
            let done = app.buttons.matching(NSPredicate(format: "label == 'Done'")).firstMatch
            XCTAssertTrue(done.waitForExistence(timeout: 5), "Decks must offer Done")
            done.tap()
            XCTAssertTrue(done.waitForNonExistence(timeout: 10), "Done must close Decks")
            // WebKit drops off-screen text from the accessibility tree, so scroll it back into
            // view. A navigation would replace the page and the headline would never return.
            visible(headline)
            XCTAssertFalse(app.secureTextFields["token.field"].exists,
                           "The native control must not sign the production Life page out")
        }
    }

    private var origin: String {
        ProcessInfo.processInfo.environment["OMARCHY_DECK_FRONTEND_ORIGIN"] ?? "https://127.0.0.1:28446/"
    }

    /// `GET /__fixture/requests`: how many authenticated page loads of `/` the fixture served.
    private func rootLoads() -> Int {
        guard let url = URL(string: "__fixture/requests", relativeTo: URL(string: origin))?.absoluteURL else { return -1 }
        let session = URLSession(configuration: .ephemeral, delegate: FrontendFixtureTrust(), delegateQueue: nil)
        let done = XCTestExpectation(description: "fixture requests")
        var loads = -1
        session.dataTask(with: url) { data, _, _ in
            if let data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Int] { loads = json["root"] ?? -1 }
            done.fulfill()
        }.resume()
        _ = XCTWaiter().wait(for: [done], timeout: 5)
        session.finishTasksAndInvalidate()
        return loads
    }

    /// I2, I15 on the real page: its root is locked (`html,body{overflow:hidden}`), so pull to refresh is the page's
    /// own gesture. A slow pull down from the top of Today reloads `/` in place: the fixture serves a fresh load, the
    /// dimmed launch picture never appears, and the page stays on screen throughout.
    func testCommittedFrontendPullToRefreshReloadsInPlace() throws {
        XCUIDevice.shared.orientation = .portrait
        let app = UITestLaunch.freshApp()
        let address = app.textFields["connection.origin"]
        XCTAssertTrue(address.waitForExistence(timeout: 20))
        address.tap()
        address.typeText(origin)
        app.buttons["connection.save"].tap()
        let token = app.secureTextFields["token.field"]
        XCTAssertTrue(token.waitForExistence(timeout: 20))
        token.tap()
        token.typeText("production-frontend-fixture-0000")
        app.buttons["token.open"].tap()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.buttons["Today"].waitForExistence(timeout: 30))
        Thread.sleep(forTimeInterval: 1.5)
        let backdrop = app.descendants(matching: .any).matching(identifier: "deck.loading").firstMatch
        let start = rootLoads()
        XCTAssertGreaterThanOrEqual(start, 1, "The fixture counter must answer")
        var reloaded = false
        var backdropSeen = false
        for attempt in 0..<3 where !reloaded {
            let top = web.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.28))
            let bottom = web.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.62))
            top.press(forDuration: 0.01, thenDragTo: bottom, withVelocity: .slow, thenHoldForDuration: 0.3)
            for _ in 0..<24 {
                if backdrop.exists { backdropSeen = true }
                if rootLoads() > start { reloaded = true; break }
                Thread.sleep(forTimeInterval: 0.25)
            }
            NSLog("DECK_PULL_PRODUCTION attempt=\(attempt) reloaded=\(reloaded) backdrop=\(backdropSeen)")
        }
        XCTAssertTrue(reloaded, "A pull down at the top of the real page must load / again")
        XCTAssertFalse(backdropSeen, "The page must stay visible: no dimmed launch picture during the pull reload")
        XCTAssertTrue(web.buttons["Today"].waitForExistence(timeout: 20), "The page is back after the reload")
        XCTAssertFalse(app.secureTextFields["token.field"].exists)
        capture("pull-refreshed")
    }
}
