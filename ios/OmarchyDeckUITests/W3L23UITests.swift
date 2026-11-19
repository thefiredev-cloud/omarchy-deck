import StoreKitTest
import XCTest

/// Integrator-only: scripts/mock_deck.py with its trusted CA on a fresh owned simulator.
/// Control requests are restricted to loopback. No real deck or saved owner session is used.
final class W3L23UITests: XCTestCase {
    private final class FixtureTrust: NSObject, URLSessionDelegate {
        func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
            guard ["127.0.0.1", "localhost"].contains(challenge.protectionSpace.host),
                  challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
                  let trust = challenge.protectionSpace.serverTrust else {
                completionHandler(.performDefaultHandling, nil)
                return
            }
            completionHandler(.useCredential, URLCredential(trust: trust))
        }
    }

    private var store: SKTestSession?

    override func setUpWithError() throws {
        continueAfterFailure = false
        store = try UITestLaunch.resetPersistedState()
    }

    override func tearDown() {
        control("release")
        UITestLaunch.finishPersistedState(store)
        store = nil
        super.tearDown()
    }

    private func origin() -> URL {
        let raw = ProcessInfo.processInfo.environment["OMARCHY_DECK_TEST_ORIGIN"] ?? "https://127.0.0.1:28445/"
        guard let url = URL(string: raw), url.scheme == "https",
              ["127.0.0.1", "localhost"].contains(url.host ?? ""), url.path == "/",
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else {
            preconditionFailure("W3L23 requires an isolated HTTPS loopback fixture")
        }
        return url
    }

    @discardableResult
    private func control(_ command: String) -> Data {
        let url = URL(string: "__fixture/\(command)", relativeTo: origin())!.absoluteURL
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 5
        let session = URLSession(configuration: configuration, delegate: FixtureTrust(), delegateQueue: nil)
        let done = expectation(description: "fixture \(command)")
        var status = 0
        var result = Data()
        session.dataTask(with: url) { data, response, _ in
            status = (response as? HTTPURLResponse)?.statusCode ?? 0
            result = data ?? Data()
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 8)
        session.invalidateAndCancel()
        XCTAssertEqual(status, 200, "Loopback fixture control must succeed")
        return result
    }

    private func rootCount() throws -> Int {
        let counts = try JSONDecoder().decode([String: [String: Int]].self, from: control("requests"))
        return counts["webview"]?["/"] ?? 0
    }

    private func capture(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func reveal(_ app: XCUIApplication, _ element: XCUIElement) {
        for _ in 0..<8 {
            if element.exists && element.isHittable { return }
            app.swipeUp()
        }
        XCTAssertTrue(element.isHittable, "The action must remain reachable at AX5")
    }

    func testStalledLoadTimesOutAndOneRetryReopensTheDeck() throws {
        control("release")
        let app = UITestLaunch.freshApp(["-deck-watchdog-short-deadline"])
        let address = app.textFields["connection.origin"]
        XCTAssertTrue(address.waitForExistence(timeout: 15))
        reveal(app, address)
        address.tap()
        address.typeText(origin().absoluteString)
        let save = app.buttons["connection.save"]
        reveal(app, save)
        save.tap()
        let token = app.secureTextFields["token.field"]
        XCTAssertTrue(token.waitForExistence(timeout: 10))
        reveal(app, token)
        token.tap()
        token.typeText("mock-token-0000")
        let open = app.buttons["token.open"]
        reveal(app, open)
        open.tap()
        let page = app.webViews.firstMatch.staticTexts["MOCK DECK (not the real deck)"]
        XCTAssertTrue(page.waitForExistence(timeout: 15))
        app.terminate()
        control("hold?delay_ms=5000")
        app.launchArguments = ["-deck-watchdog-short-deadline"]
        app.launch()
        let offline = app.staticTexts["offline.title"]
        XCTAssertTrue(offline.waitForExistence(timeout: 4), "The watchdog must beat the fixture's delayed 503")
        let retry = app.buttons["offline.retry"]
        reveal(app, retry)
        XCTAssertEqual(retry.label, "Retry")
        capture(app, name: "w3l23-timeout-retry")
        let details = app.buttons["Details"]
        reveal(app, details)
        details.tap()
        let reason = app.staticTexts["The deck did not finish loading in time. Try again."]
        XCTAssertTrue(reason.waitForExistence(timeout: 2), "Recovery must name the load timeout, not the late 503")
        capture(app, name: "w3l23-timeout-reason")
        control("release")
        let before = try rootCount()
        reveal(app, retry)
        retry.tap()
        XCTAssertTrue(page.waitForExistence(timeout: 15))
        XCTAssertEqual(try rootCount(), before + 1, "Retry sends exactly one WebKit root navigation; probes are excluded")
        Thread.sleep(forTimeInterval: 5.2)
        XCTAssertTrue(page.exists, "The old delayed 503 must not replace the recovered deck")
        XCTAssertFalse(offline.exists)
        capture(app, name: "w3l23-retry-ready")
    }
}
