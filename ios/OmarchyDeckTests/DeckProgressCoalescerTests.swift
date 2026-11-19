import XCTest
@testable import OmarchyDeck

final class DeckProgressCoalescerTests: XCTestCase {
    func testProgressBurstAppliesOnlyNewestValue() {
        let coalescer = DeckProgressCoalescer()

        XCTAssertTrue(coalescer.record(0.2))
        XCTAssertFalse(coalescer.record(0.4))
        XCTAssertFalse(coalescer.record(0.8))

        XCTAssertEqual(coalescer.take(), 0.8)
    }

    func testProgressAfterApplySchedulesAnotherUpdate() {
        let coalescer = DeckProgressCoalescer()

        XCTAssertTrue(coalescer.record(0.3))
        XCTAssertEqual(coalescer.take(), 0.3)

        XCTAssertTrue(coalescer.record(0.6))
        XCTAssertEqual(coalescer.take(), 0.6)
    }
}
