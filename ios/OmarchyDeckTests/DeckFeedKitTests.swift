import XCTest
@testable import OmarchyDeck

/// The freshness mark's icon is the one glance signal per section. Only stale or missing parts may read as a warning;
/// a feed still "Building" is new, not an alarm (DeckFeedKit's FeedFreshnessMark).
@MainActor
final class DeckFeedKitTests: XCTestCase {
    func testOnlyStaleAndMissingMarksReadAsWarnings() {
        let warned = [DeckFreshness.Kind.fresh, .stale, .missing, .building]
            .filter { FeedFreshnessMark.symbol($0) == "exclamationmark.triangle.fill" }
        XCTAssertEqual(warned, [.stale, .missing])
    }
}
