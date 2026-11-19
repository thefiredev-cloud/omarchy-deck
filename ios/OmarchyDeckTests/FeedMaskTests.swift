import Foundation
import XCTest
@testable import OmarchyDeck

final class FeedMaskTests: XCTestCase {
    func testMoneyIsHiddenUntilExplicitlyShown() {
        XCTAssertEqual(FeedMask.money("$125,000", shown: false), "$\u{2022}\u{2022}\u{2022}")
    }

    /// One masked form in the app: the pages' mask is the formatter's, which the shared fixture pins.
    func testThePagesMaskIsTheOneMaskedMoneyForm() {
        XCTAssertEqual(FeedMask.money("$1.24M", shown: false), DeckMoney.masked)
        XCTAssertNil(FeedMask.money("$9,450", shown: false).rangeOfCharacter(from: .decimalDigits), "a hidden amount shows no digit")
    }

    func testShownMoneyPreservesItsOriginalFormatting() {
        XCTAssertEqual(FeedMask.money("$125,000", shown: true), "$125,000")
    }
}
