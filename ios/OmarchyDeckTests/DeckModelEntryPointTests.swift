import XCTest
@testable import OmarchyDeck

/// The `DeckModel` entry points that the keyboard, the page's pull gesture and the demo's Connect sheet call.
/// Pro stays inactive (`ProEntitlement.isPro` is `private(set)` and StoreKit is off), so these pin the free side:
/// locked decks stay locked from every entry point, a reload before the page shows only retries, and a refused
/// Connect keeps the demo on screen.
@MainActor
final class DeckModelEntryPointTests: XCTestCase {
    private let first = URL(string: "https://a.example.com/")!
    private let second = URL(string: "https://a.example.com:10443/")!
    private let third = URL(string: "https://c.example.com/")!
    private var suites: [(name: String, defaults: UserDefaults)] = []

    override func tearDown() {
        for suite in suites { suite.defaults.removePersistentDomain(forName: suite.name) }
        suites.removeAll()
        super.tearDown()
    }

    private func makeDefaults(saved: [URL], selected: URL?) throws -> UserDefaults {
        let name = "DeckModelEntryPointTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        suites.append((name, defaults))
        defaults.set(saved.map(\.absoluteString), forKey: "deck.savedOrigins.v1")
        if let selected { defaults.set(selected.absoluteString, forKey: "deck.selectedOrigin.v1") }
        for origin in saved { defaults.set(true, forKey: DeckModel.legacyMigrationKey(for: origin)) }
        return defaults
    }

    /// Two saved decks, `first` selected, Pro inactive, no startup task. `retries` counts `retryAction` calls.
    private func lockedModel(retries: @escaping () -> Void = {}) throws -> DeckModel {
        let defaults = try makeDefaults(saved: [first, second], selected: first)
        let model = DeckModel(defaults: defaults, startsAutomatically: false,
                              pro: ProEntitlement(startsAutomatically: false),
                              retryAction: retries, refreshOnActivation: {})
        XCTAssertEqual(model.selectedOrigin, first)
        XCTAssertFalse(model.pro.isPro)
        return model
    }

    private func assertStillOnFirstDeck(_ model: DeckModel, _ message: String,
                                        file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(model.selectedOrigin, first, message, file: file, line: line)
        XCTAssertEqual(model.phase, .starting, message, file: file, line: line)
        XCTAssertNil(model.webView, message, file: file, line: line)
        XCTAssertEqual(Set(model.connections), [first, second], "A locked deck is locked, not deleted",
                       file: file, line: line)
    }

    // MARK: Keyboard deck switching

    func testKeyboardDeckCyclingCannotSwitchToALockedDeck() throws {
        let model = try lockedModel()
        model.selectNeighbor(step: 1)
        assertStillOnFirstDeck(model, "Shift Command ] must not unlock another saved deck")
        model.selectNeighbor(step: -1)
        assertStillOnFirstDeck(model, "Shift Command [ must not unlock another saved deck")
    }

    func testNumberedDeckShortcutCannotSwitchToALockedDeckAndIgnoresOutOfRangeNumbers() throws {
        let model = try lockedModel()
        for number in [2, 1, 0, -1, 3, 10] {
            model.openDeck(number: number)
            assertStillOnFirstDeck(model, "Command \(number) must leave the current deck alone")
        }
    }

    // MARK: Reload and pull

    func testReloadBeforeThePageShowsOnlyRetries() throws {
        var retries = 0
        let model = try lockedModel { retries += 1 }
        model.reload()
        XCTAssertEqual(retries, 1, "Reload with no page on screen is a retry")
        XCTAssertEqual(model.phase, .starting, "The retry hook, not reload, owns the phase change")
        XCTAssertFalse(model.keepsPageVisible)
        XCTAssertNil(model.webView)
    }

    func testPullToRefreshIsIgnoredUntilAPageShows() throws {
        var retries = 0
        let model = try lockedModel { retries += 1 }
        for phase: DeckPhase in [.starting, .loading, .needsToken(notice: nil), .offline(reason: "Down")] {
            model.phase = phase
            model.pullToRefresh()
            XCTAssertEqual(retries, 0, "A pull during \(phase) must not start a reload or a retry")
            XCTAssertEqual(model.phase, phase)
        }
    }

    func testPullToRefreshIsIgnoredWhileTheDemoShows() throws {
        var retries = 0
        let model = try lockedModel { retries += 1 }
        model.beginDemo()
        model.phase = .ready
        model.pullToRefresh()
        XCTAssertEqual(retries, 0, "The demo has no page to reload")
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.keepsPageVisible)
    }

    // MARK: Demo Connect sheet

    func testRefusedConnectKeepsTheDemoOnScreen() throws {
        let model = try lockedModel()
        model.beginDemo()
        XCTAssertTrue(model.isDemo)

        let refusal = model.saveConnectionLeavingDemo("http://insecure.example.com/")
        XCTAssertEqual(refusal, "Enter your server's HTTPS address, like https://deck.example.com:10443/, with no path or token.")
        XCTAssertTrue(model.isDemo, "A refused address keeps the demo")
        XCTAssertEqual(model.saveConnectionLeavingDemo(third.absoluteString),
                       "Free includes one deck. Replace it, or unlock Pro to add another.")
        XCTAssertTrue(model.isDemo, "A refused Pro rule keeps the demo")
        XCTAssertEqual(model.selectedOrigin, first)
        XCTAssertEqual(Set(model.connections), [first, second])
    }

    func testAcceptedConnectLeavesTheDemoAndOpensTheSavedDeck() async throws {
        let origin = try XCTUnwrap(URL(string: "https://connected.invalid:10443/"))
        let defaults = try makeDefaults(saved: [], selected: nil)
        defaults.set(true, forKey: DeckModel.legacyMigrationKey(for: origin))
        let model = DeckModel(defaults: defaults, startsAutomatically: false,
                              pro: ProEntitlement(startsAutomatically: false),
                              retryAction: {}, refreshOnActivation: {},
                              sessionRemoval: { _ in })
        model.beginDemo()
        XCTAssertTrue(model.isDemo)
        XCTAssertEqual(model.phase, .needsConnection)

        XCTAssertNil(model.saveConnectionLeavingDemo(origin.absoluteString))

        XCTAssertFalse(model.isDemo, "A saved address ends the demo")
        XCTAssertEqual(model.selectedOrigin, origin)
        XCTAssertEqual(model.connections, [origin])
        XCTAssertEqual(defaults.string(forKey: "deck.selectedOrigin.v1"), origin.absoluteString)
        let opened = await waitUntil { model.webView != nil && model.phase == .needsToken(notice: nil) }
        XCTAssertTrue(opened, "The deck opens to its token screen once the demo is over; phase \(model.phase)")
        model.webView?.stopLoading()
    }
}
