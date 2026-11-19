import XCTest
@testable import OmarchyDeck

@MainActor
final class DeckFeedStoreTests: XCTestCase {
    func testSectionWithoutSelectedDeckSettlesEveryFeedAsSignedOut() async {
        let suite = "DeckFeedStoreTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }

        let model = DeckModel(defaults: defaults, startsAutomatically: false,
                              pro: ProEntitlement(startsAutomatically: false))
        let store = DeckFeedStore(model: model)

        XCTAssertEqual(store.state("life"), .loading)
        await store.load(.life)

        XCTAssertEqual(store.state("life"), .signedOut)
        XCTAssertEqual(store.state("history-goodnews"), .signedOut)
    }
}
