import XCTest
@testable import OmarchyDeck

/// Lock rules for saved decks without Pro. README "Free and Pro": revocation locks the other saved decks and
/// keeps the current one usable. Written, unexecuted: no Swift toolchain on pc-desktop.
/// Model-level cases run with Pro inactive only: `ProEntitlement.isPro` is `private(set)` and StoreKit is disabled,
/// so the Pro-active side is pinned through the pure predicates the model and the Decks row both call.
final class DeckSelectionTests: XCTestCase {
    private let first = URL(string: "https://a.example.com/")!
    private let second = URL(string: "https://a.example.com:10443/")!
    private let third = URL(string: "https://c.example.com/")!
    private var defaultsSuites: [(name: String, defaults: UserDefaults)] = []

    override func tearDown() {
        for suite in defaultsSuites {
            suite.defaults.removePersistentDomain(forName: suite.name)
        }
        defaultsSuites.removeAll()
        super.tearDown()
    }

    /// Two saved decks, `first` selected, Pro inactive, no startup task, no StoreKit task.
    @MainActor
    private func lockedModel() throws -> (model: DeckModel, defaults: UserDefaults) {
        let suiteName = "DeckSelectionTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaultsSuites.append((suiteName, defaults))
        defaults.set([first.absoluteString, second.absoluteString], forKey: "deck.savedOrigins.v1")
        defaults.set(first.absoluteString, forKey: "deck.selectedOrigin.v1")
        let model = DeckModel(
            defaults: defaults, startsAutomatically: false,
            pro: ProEntitlement(startsAutomatically: false),
            retryAction: {}, refreshOnActivation: {})
        XCTAssertEqual(Set(model.connections), [first, second])
        XCTAssertEqual(model.selectedOrigin, first)
        XCTAssertFalse(model.pro.isPro)
        return (model, defaults)
    }

    /// Migrating origin A must not mark origin B as migrated, or a deck added later loses its legacy cookie.
    @MainActor
    func testLegacyCookieMigrationFlagIsKeyedPerOrigin() throws {
        let suiteName = "DeckSelectionTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaultsSuites.append((suiteName, defaults))
        let keyA = DeckModel.legacyMigrationKey(for: first)
        let keyB = DeckModel.legacyMigrationKey(for: second)
        XCTAssertNotEqual(keyA, keyB)

        defaults.set(true, forKey: keyA)

        XCTAssertTrue(defaults.bool(forKey: keyA))
        XCTAssertFalse(defaults.bool(forKey: keyB), "Origin B must still be eligible for its own migration")
    }

    /// Relaunch ignores malformed and duplicate saved origins, then recovers selection when its saved deck was removed.
    @MainActor
    func testRelaunchFiltersInvalidAndDuplicateOriginsAndFallsBackToFirstSavedOrigin() throws {
        let suiteName = "DeckSelectionTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaultsSuites.append((suiteName, defaults))
        defaults.set([
            "https://b.example.com:443/",
            "https://a.example.com/",
            "https://a.example.com/",
            "http://insecure.example.com/",
            "https://a.example.com/private"
        ], forKey: "deck.savedOrigins.v1")
        defaults.set("https://removed.example.com/", forKey: "deck.selectedOrigin.v1")

        let model = DeckModel(
            defaults: defaults, startsAutomatically: false,
            pro: ProEntitlement(startsAutomatically: false),
            retryAction: {}, refreshOnActivation: {})

        XCTAssertEqual(model.connections, [
            URL(string: "https://a.example.com/")!,
            URL(string: "https://b.example.com/")!
        ])
        XCTAssertEqual(model.selectedOrigin, URL(string: "https://a.example.com/"))
    }

    /// Relaunch with a saved deck must paint `.loading` (`deck.loading`) on the first frame, not `.starting`.
    /// Only when the app will actually open the deck: a locked or test model that never starts stays `.starting`.
    @MainActor
    func testSavedDeckRelaunchStartsInLoading() throws {
        let suiteName = "DeckSelectionTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaultsSuites.append((suiteName, defaults))
        defaults.set([first.absoluteString], forKey: "deck.savedOrigins.v1")
        defaults.set(first.absoluteString, forKey: "deck.selectedOrigin.v1")
        let model = DeckModel(
            defaults: defaults, startsAutomatically: true,
            pro: ProEntitlement(startsAutomatically: false),
            retryAction: {}, refreshOnActivation: {},
            loadNavigation: { _, _ in nil })
        XCTAssertEqual(model.selectedOrigin, first)
        XCTAssertEqual(model.phase, .loading, "A saved deck must show the loading backdrop before cookies are read")
    }

    @MainActor
    func testLockedModelThatNeverStartsDoesNotSitOnLoading() throws {
        let (model, _) = try lockedModel()
        XCTAssertEqual(model.phase, .starting, "A model that never opens a deck must not show Loading deck")
        XCTAssertNil(model.webView)
    }

    /// The `select` guard (DeckModel.swift:344-345). A refused switch changes nothing and starts no load.
    @MainActor
    func testSelectRefusesAnotherSavedDeckWhileProIsInactive() throws {
        let (model, defaults) = try lockedModel()
        model.select(second)
        XCTAssertEqual(model.selectedOrigin, first)
        XCTAssertEqual(defaults.string(forKey: "deck.selectedOrigin.v1"), first.absoluteString)
        XCTAssertEqual(model.phase, .starting, "A refused switch must stay on the boot phase and must not start a load")
        XCTAssertNil(model.webView, "A refused switch must not build a WebKit view")
        XCTAssertEqual(Set(model.connections), [first, second], "A locked deck is locked, not deleted")
    }

    @MainActor
    func testSelectIgnoresCurrentAndUnsavedDecksWhileProIsInactive() throws {
        let (model, defaults) = try lockedModel()
        model.select(first)
        model.select(third)
        XCTAssertEqual(model.selectedOrigin, first)
        XCTAssertEqual(defaults.string(forKey: "deck.selectedOrigin.v1"), first.absoluteString)
        XCTAssertEqual(model.phase, .starting, "Ignoring current or unsaved decks must stay on the boot phase")
        XCTAssertNil(model.webView)
        XCTAssertEqual(Set(model.connections), [first, second])
    }

    /// The three refusal sentences at DeckModel.swift:300, :304 and :308. None may change selection or start a load.
    @MainActor
    func testSaveConnectionRefusalsLeaveLockedDecksUntouched() throws {
        let (model, defaults) = try lockedModel()
        XCTAssertEqual(model.saveConnection(second.absoluteString), "Restore Pro to switch decks.")
        XCTAssertEqual(model.saveConnection(third.absoluteString),
                       "Free includes one deck. Replace it, or unlock Pro to add another.")
        XCTAssertEqual(model.saveConnection(third.absoluteString, replacing: true),
                       "Restore Pro to change your locked decks.")
        XCTAssertEqual(model.selectedOrigin, first)
        XCTAssertEqual(defaults.string(forKey: "deck.selectedOrigin.v1"), first.absoluteString)
        XCTAssertEqual(Set(model.connections), [first, second])
        XCTAssertEqual(model.phase, .starting, "A refused save must stay on the boot phase and must not start a load")
        XCTAssertNil(model.webView)
    }

    /// Pro-restore side: with Pro active every saved deck may be activated; without it only the current one.
    func testMayActivateIsCurrentDeckAlwaysAndOthersOnlyWithPro() {
        XCTAssertTrue(DeckModel.mayActivate(first, selected: first, isPro: false))
        XCTAssertTrue(DeckModel.mayActivate(first, selected: first, isPro: true))
        XCTAssertFalse(DeckModel.mayActivate(second, selected: first, isPro: false))
        XCTAssertTrue(DeckModel.mayActivate(second, selected: first, isPro: true))
        XCTAssertFalse(DeckModel.mayActivate(second, selected: nil, isPro: false))
        XCTAssertTrue(DeckModel.mayActivate(second, selected: nil, isPro: true))
    }

    /// The lock sentence shows on the tapped row only, only while it stays locked, and hides after restore.
    func testLockNoticeShowsOnlyOnTappedLockedRowAndHidesAfterRestore() {
        XCTAssertTrue(DeckModel.showsLockNotice(tapped: second, row: second, selected: first, isPro: false))
        XCTAssertFalse(DeckModel.showsLockNotice(tapped: second, row: second, selected: first, isPro: true),
                       "Restoring Pro hides the sentence")
        XCTAssertFalse(DeckModel.showsLockNotice(tapped: nil, row: second, selected: first, isPro: false),
                       "No tap, no sentence")
        XCTAssertFalse(DeckModel.showsLockNotice(tapped: second, row: first, selected: first, isPro: false),
                       "Another row never shows the sentence")
        XCTAssertFalse(DeckModel.showsLockNotice(tapped: first, row: first, selected: first, isPro: false),
                       "The current deck is never locked")
        XCTAssertFalse(DeckModel.showsLockNotice(tapped: second, row: second, selected: second, isPro: false),
                       "A row that became current loses the sentence")
    }
}
