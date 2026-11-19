import WebKit
import XCTest
@testable import OmarchyDeck

/// The Decks control and the corner of the page it reserves (shell and web contract 2).
@MainActor
final class ChromeTests: XCTestCase {
    /// A sleep the test releases by hand, so the 3 s idle wait takes no real time.
    @MainActor
    private final class SleepGate {
        private var waiters: [CheckedContinuation<Void, Never>] = []
        var waiting: Int { waiters.count }
        func wait() async { await withCheckedContinuation { waiters.append($0) } }
        func release() {
            let pending = waiters
            waiters = []
            pending.forEach { $0.resume() }
        }
    }

    private func makeChrome(gate: SleepGate, assistive: @escaping () -> Bool = { false }) -> DeckChrome {
        DeckChrome(sleep: { _ in await gate.wait() }, assistiveRunning: assistive)
    }

    func testControlDimsWhenIdleAndStaysVisibleAndTappable() async {
        let gate = SleepGate()
        let chrome = makeChrome(gate: gate)
        var reserves: [Int] = []
        chrome.onReserveChange = { reserves.append($0) }

        // A native screen is up: the control stays, and the page keeps its corner empty.
        chrome.update(present: true, contentReady: false)
        XCTAssertTrue(chrome.isVisible)
        XCTAssertFalse(chrome.isDimmed)
        XCTAssertEqual(chrome.reservedPoints, 56)
        XCTAssertEqual(gate.waiting, 0, "Nothing may dim while a native screen is showing")

        // The deck is on screen: the idle wait starts, then the control dims. It stays on screen,
        // stays tappable, and keeps its corner reserved (Guideline 5.6).
        chrome.update(present: true, contentReady: true)
        let waiting = await waitUntil { gate.waiting == 1 }
        XCTAssertTrue(waiting)
        XCTAssertTrue(chrome.isVisible)
        gate.release()
        let dimmed = await waitUntil { chrome.isDimmed }
        XCTAssertTrue(dimmed)
        XCTAssertTrue(chrome.isVisible, "A dimmed control must stay on screen and tappable")
        XCTAssertEqual(chrome.reservedPoints, 56, "The corner stays reserved while the control is tappable")

        // A tap in the top band returns it to full strength, and the idle wait starts over.
        chrome.reveal()
        XCTAssertFalse(chrome.isDimmed)
        XCTAssertTrue(chrome.isVisible)
        XCTAssertEqual(chrome.reservedPoints, 56)
        let restarted = await waitUntil { gate.waiting == 1 }
        XCTAssertTrue(restarted)

        XCTAssertEqual(reserves, [56], "The page hears one reserve value and never loses the corner")
    }

    func testControlStaysWhileASheetIsOpenOrAssistiveTechnologyRuns() async {
        let gate = SleepGate()
        var voiceOver = true
        let chrome = makeChrome(gate: gate, assistive: { voiceOver })
        chrome.update(present: true, contentReady: true)
        XCTAssertEqual(gate.waiting, 0, "VoiceOver users must never lose the control")
        XCTAssertTrue(chrome.isVisible)

        voiceOver = false
        chrome.setSheetPresented(true)
        XCTAssertEqual(gate.waiting, 0, "A sheet owns the screen; the control does not fade behind it")
        chrome.setSheetPresented(false)
        let waiting = await waitUntil { gate.waiting == 1 }
        XCTAssertTrue(waiting, "Closing the sheet starts the idle wait")
    }

    /// Larger Text and Reduce Transparency users keep the full-strength control too, not only VoiceOver users.
    func testLargerTextAndReduceTransparencySuppressTheDim() {
        XCTAssertTrue(DeckChrome.suppressesDim(voiceOver: false, switchControl: false,
                                               reduceTransparency: true, accessibilityTextSize: false))
        XCTAssertTrue(DeckChrome.suppressesDim(voiceOver: false, switchControl: false,
                                               reduceTransparency: false, accessibilityTextSize: true))
        XCTAssertTrue(DeckChrome.suppressesDim(voiceOver: true, switchControl: false,
                                               reduceTransparency: false, accessibilityTextSize: false))
        XCTAssertTrue(DeckChrome.suppressesDim(voiceOver: false, switchControl: true,
                                               reduceTransparency: false, accessibilityTextSize: false))
        XCTAssertFalse(DeckChrome.suppressesDim(voiceOver: false, switchControl: false,
                                                reduceTransparency: false, accessibilityTextSize: false))
    }

    func testNoDeckMeansNoControlAndNoReservedCorner() {
        let chrome = makeChrome(gate: SleepGate())
        chrome.update(present: false, contentReady: true)
        XCTAssertFalse(chrome.isPresent)
        XCTAssertFalse(chrome.isVisible)
        XCTAssertEqual(chrome.reservedPoints, 0)
    }

    func testRevealBandIsTheTopFortyFourPointsBelowTheSafeAreaEdge() {
        XCTAssertTrue(DeckChrome.isRevealTouch(y: 10, safeAreaTop: 62))
        XCTAssertTrue(DeckChrome.isRevealTouch(y: 62 + 43, safeAreaTop: 62))
        XCTAssertFalse(DeckChrome.isRevealTouch(y: 62 + 44, safeAreaTop: 62))
        XCTAssertTrue(DeckChrome.isRevealTouch(y: 43, safeAreaTop: 0))
        XCTAssertFalse(DeckChrome.isRevealTouch(y: 300, safeAreaTop: 0))
        XCTAssertFalse(DeckChrome.isRevealTouch(y: -1, safeAreaTop: 0))
    }

    /// The page reads `--shell-reserve-top-right`. A real web view proves the value at document start, on a
    /// live update, and on the next document, which is what the web side of the contract depends on.
    func testPageReadsTheReservedCornerAtDocumentStartAndAfterAnUpdate() async throws {
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        let waiter = WebLoadWaiter()
        let page = "<!doctype html><meta name=viewport content='width=device-width,viewport-fit=cover'><p>deck</p>"
        func reserve() async throws -> String {
            let value = try await view.evaluateJavaScript(
                "getComputedStyle(document.documentElement).getPropertyValue('--shell-reserve-top-right')")
            return (value as? String ?? "").trimmingCharacters(in: .whitespaces)
        }

        ShellReserve.install(points: 56, in: view)
        await waiter.load(html: page, in: view)
        let first = try await reserve()
        XCTAssertEqual(first, "56px", "The control is visible when the page loads")

        ShellReserve.install(points: 0, in: view)
        let live = try await reserve()
        XCTAssertEqual(live, "0px", "The script can give the corner back without a reload")

        await waiter.load(html: page, in: view)
        let next = try await reserve()
        XCTAssertEqual(next, "0px", "A reload starts from the current value, not the one the view was created with")

        ShellReserve.install(points: 56, in: view)
        let back = try await reserve()
        XCTAssertEqual(back, "56px")
    }

    /// Installing the reserve script must not remove the token scrub. The scrub runs at document start, so a page
    /// script that reads `location` sees no `t` parameter; without the scrub the same page sees it.
    func testReserveScriptKeepsTheTokenScrubAndThePageNeverSeesTheToken() async throws {
        let page = "<!doctype html><script>window.sawToken = new URL(location.href).searchParams.has('t')</script><p>deck</p>"
        let bootstrap = try XCTUnwrap(URL(string: "https://deck.test/?t=fixture-token-0000"))

        func sawToken(scrubbed: Bool) async throws -> Bool {
            let configuration = WKWebViewConfiguration()
            if scrubbed {
                configuration.userContentController.addUserScript(WKUserScript(
                    source: DeckConfig.bootstrapScrubScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            }
            let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: configuration)
            ShellReserve.install(points: 56, in: view)
            ShellReserve.install(points: 0, in: view)
            let installed = view.configuration.userContentController.userScripts.count
            XCTAssertEqual(installed, scrubbed ? 2 : 1, "repeated installs keep one reserve script and every other script")
            await WebLoadWaiter().load(html: page, in: view, baseURL: bootstrap)
            let value = try await view.evaluateJavaScript("window.sawToken")
            return try XCTUnwrap(value as? Bool)
        }

        let control = try await sawToken(scrubbed: false)
        XCTAssertTrue(control, "control: without the scrub the page reads the token")
        let scrubbed = try await sawToken(scrubbed: true)
        XCTAssertFalse(scrubbed, "the scrub must run before page scripts and survive the reserve install")
    }

    /// Gap 2: with the shell's own web view styling, the page reads the real device safe area through
    /// `env(safe-area-inset-*)`. Skips where the device has no top inset (iPad, or a window not yet on screen).
    func testPageReadsTheDeviceSafeAreaThroughEnv() async throws {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.flatMap(\.windows).first else {
            throw XCTSkip("No app window in this test host")
        }
        guard window.safeAreaInsets.top > 0 else { throw XCTSkip("This device has no top safe area") }
        let view = WKWebView(frame: window.bounds)
        DeckModel.applyChrome(to: view)
        window.addSubview(view)
        defer { view.removeFromSuperview() }
        view.layoutIfNeeded()
        let page = "<!doctype html><meta name=viewport content='width=device-width,viewport-fit=cover'>" +
            "<style>body{margin:0}#p{padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}</style><div id=p>deck</div>"
        await WebLoadWaiter().load(html: page, in: view)
        // WebKit hands the web process the inset after layout, not synchronously with the load, so poll briefly.
        var points = -1.0
        var top: String?
        for _ in 0..<30 {
            top = try await view.evaluateJavaScript("getComputedStyle(document.getElementById('p')).paddingTop") as? String
            points = try XCTUnwrap(top.flatMap { Double($0.dropLast(2)) }, "paddingTop was \(top ?? "nil")")
            if abs(points - Double(window.safeAreaInsets.top)) <= 0.5 { break }
            view.setNeedsLayout()
            view.layoutIfNeeded()
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTAssertEqual(points, Double(window.safeAreaInsets.top), accuracy: 0.5,
                       "env(safe-area-inset-top) must carry the real inset, not 0 (window \(window.safeAreaInsets.top), view \(view.safeAreaInsets.top), frame \(view.frame), scene \(String(describing: window.windowScene?.activationState.rawValue)))")
    }
}
