import XCTest
@testable import OmarchyDeck

/// Light or Dark on the sections screen. Foundation only, so it also runs on Linux.
final class FeedAppearanceTests: XCTestCase {
    /// The choice is stored under `deck.feeds.appearance`, so these raw names are what installed apps already hold.
    func testStoredNamesAreStableAndOfferedDarkFirst() {
        XCTAssertEqual(FeedAppearance.allCases.map(\.rawValue), ["dark", "light"])
        XCTAssertEqual(FeedAppearance(rawValue: "dark"), .dark)
        XCTAssertEqual(FeedAppearance(rawValue: "light"), .light)
    }

    /// The title is the spoken value of the Appearance control.
    func testTitlesNameTheThemeOnScreen() {
        XCTAssertEqual(FeedAppearance.dark.title, "Dark")
        XCTAssertEqual(FeedAppearance.light.title, "Light")
    }
}
