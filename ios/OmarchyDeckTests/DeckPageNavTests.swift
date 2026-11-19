import XCTest
@testable import OmarchyDeck

/// The page step script. Foundation only, so it also runs in the Linux harness.
final class DeckPageNavTests: XCTestCase {
    func testStepScriptReadsThePageStripAndPressesTheNextTab() {
        let script = DeckPageNav.stepScript(1)
        XCTAssertTrue(script.contains(DeckPageNav.tabSelector))
        XCTAssertTrue(script.contains("classList.contains('on')"))
        XCTAssertTrue(script.contains(".click()"))
        XCTAssertTrue(script.contains("(1 % tabs.length)"), "the step is written into the script")
    }

    func testSelectorIsTheDocumentedPageStrip() {
        XCTAssertEqual(DeckPageNav.tabSelector, "#pgs button[data-p]")
    }

    /// The sign of the step survives, and a step longer than the strip still wraps by the modulo.
    func testBackAndForwardStepsKeepTheirSign() {
        XCTAssertTrue(DeckPageNav.stepScript(-1).contains("(-1 % tabs.length)"))
        XCTAssertTrue(DeckPageNav.stepScript(1).contains("(1 % tabs.length)"))
        XCTAssertTrue(DeckPageNav.stepScript(12).contains("(12 % tabs.length)"))
    }

    /// One page (or a page with no strip) reports and moves nothing, so a single-page deck answers the key.
    func testScriptSaysWhenThereIsNothingToStep() {
        let script = DeckPageNav.stepScript(1)
        XCTAssertTrue(script.contains("tabs.length < 2"))
        XCTAssertTrue(script.contains("return 'none'"))
        XCTAssertTrue(script.contains("return 'same'"))
    }
}
