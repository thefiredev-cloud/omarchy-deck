import XCTest
@testable import OmarchyDeck

final class OfflineBannerTests: XCTestCase {
    func testRenderedLabelsMatchReconnectUI() {
        // Keep these aligned with DeckFlowUITests' accessibility-label assertions.
        XCTAssertEqual(OfflineView.Banner.title, "Deck is back")
        XCTAssertEqual(OfflineView.Banner.action, "Reconnect")
        XCTAssertEqual(
            OfflineView.Banner.subtitle,
            "Your server answered. Tap \(OfflineView.Banner.action) to open it."
        )
    }

    func testAnnouncementCombinesRenderedTitleAndDetail() {
        XCTAssertEqual(
            OfflineView.Banner.announcement,
            "\(OfflineView.Banner.title). \(OfflineView.Banner.subtitle)"
        )
        XCTAssertEqual(
            OfflineView.Banner.announcement,
            "Deck is back. Your server answered. Tap Reconnect to open it."
        )
    }
}
