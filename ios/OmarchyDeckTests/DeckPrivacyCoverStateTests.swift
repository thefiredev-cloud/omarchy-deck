import XCTest
@testable import OmarchyDeck

final class DeckPrivacyCoverStateTests: XCTestCase {
    func testCoverRestoresAccessibilityStateAfterHiding() {
        var state = PrivacyCoverAccessibilityState()

        state.hide(currentAccessibilityHidden: false)
        XCTAssertEqual(state.show(), false)
        XCTAssertNil(state.show())
    }

    func testCoverPreservesAnAlreadyHiddenRootAcrossRepeatedHides() {
        var state = PrivacyCoverAccessibilityState()

        state.hide(currentAccessibilityHidden: true)
        state.hide(currentAccessibilityHidden: true)
        XCTAssertEqual(state.show(), true)
    }

    func testRepeatedHidePreservesInitialStateWhenCurrentValueChanges() {
        var state = PrivacyCoverAccessibilityState()

        state.hide(currentAccessibilityHidden: false)
        state.hide(currentAccessibilityHidden: true)
        XCTAssertEqual(state.show(), false)
    }

    func testEachCoverCycleRestoresTheStateCapturedAtItsOwnHide() {
        var state = PrivacyCoverAccessibilityState()

        state.hide(currentAccessibilityHidden: false)
        XCTAssertEqual(state.show(), false)

        state.hide(currentAccessibilityHidden: true)
        XCTAssertEqual(state.show(), true)
    }

#if canImport(UIKit)
    @MainActor
    func testCoverAnchorDecodeReturnsNilInsteadOfTrapping() throws {
        let archiver = NSKeyedArchiver(requiringSecureCoding: false)
        archiver.finishEncoding()
        let unarchiver = try NSKeyedUnarchiver(forReadingFrom: archiver.encodedData)
        XCTAssertNil(DeckPrivacyCover.CoverAnchor(coder: unarchiver))
    }
#endif
}
