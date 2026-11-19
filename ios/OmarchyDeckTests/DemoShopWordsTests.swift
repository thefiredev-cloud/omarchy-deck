import Foundation
import XCTest
@testable import OmarchyDeck

/// The demo Shop follows the deck's Coverage rule: a store that blocks automated search, or one waiting for keys,
/// is skipped on purpose. It never counts as a failure and never lowers the stores answering.
final class DemoShopWordsTests: XCTestCase {
    func testSkippedAndSetupStoresDoNotCountAgainstAnswering() {
        let c = DemoWords.coverage([.answering, .answering, .answering, .answering, .skipped, .needsSetup])
        XCTAssertEqual(c.title, "4 of 4 stores answering")
        XCTAssertEqual(c.detail, "1 skipped · 1 needs setup")
    }

    func testSkippedAndSetupStoresListInTheDetail() {
        let c = DemoWords.coverage([.answering, .skipped, .skipped, .needsSetup, .needsSetup])
        XCTAssertEqual(c.title, "1 of 1 stores answering")
        XCTAssertEqual(c.detail, "2 skipped · 2 need setup")
    }

    func testAllAnsweringSaysSo() {
        XCTAssertEqual(DemoWords.coverage([.answering, .answering]).detail, "Every store answered")
        XCTAssertEqual(DemoWords.coverage([.answering, .skipped]).detail, "1 skipped")
    }

    /// With every store skipped or waiting, nothing was asked: no "0 of 0", and no claim that every store answered.
    func testNoAskedStoresSaysSoInsteadOfZeroOfZero() {
        XCTAssertEqual(DemoWords.coverage([]).title, "No stores checked")
        XCTAssertEqual(DemoWords.coverage([]).detail, "Nothing to show yet")
        let c = DemoWords.coverage([.skipped, .needsSetup])
        XCTAssertEqual(c.title, "No stores checked")
        XCTAssertEqual(c.detail, "1 skipped · 1 needs setup")
    }

    func testSkippedAndSetupStatusIsCalmAndSaysWhy() {
        XCTAssertEqual(DemoWords.storeStatus(.skipped), "Skipped. The site blocks automated search and has no official API.")
        XCTAssertEqual(DemoWords.storeStatus(.needsSetup), "Needs setup. Add this store's access keys on your server.")
        for state: DemoWords.StoreState in [.skipped, .needsSetup] {
            let words = DemoWords.storeStatus(state).lowercased()
            XCTAssertFalse(words.contains("fail") || words.contains("error"), words)
        }
    }

    func testMinimumIntegerWeekChangeFormatsWithoutOverflow() {
        XCTAssertEqual(DemoWords.weekChange(Int.min), "Down $9223372036854775808 this week")
    }

    func testPriceLines() {
        XCTAssertEqual(DemoWords.price(249), "$249")
        XCTAssertEqual(DemoWords.weekChange(-50), "Down $50 this week")
        XCTAssertEqual(DemoWords.weekChange(10), "Up $10 this week")
        XCTAssertEqual(DemoWords.weekChange(0), "Same as last week")
        XCTAssertEqual(DemoWords.lowLine(price: 249, low30: 229, weekChange: -50), "30 day low $229 · Down $50 this week")
        XCTAssertEqual(DemoWords.lowLine(price: 139, low30: 139, weekChange: -10), "At its 30 day low · Down $10 this week")
        XCTAssertEqual(DemoWords.itemSpoken(title: "Grinder", price: 139, store: "Kitchen shop", low30: 139, weekChange: -10),
                       "Example item: Grinder. Best price $139 at Kitchen shop. At its 30 day low. Down $10 this week.")
    }
}
