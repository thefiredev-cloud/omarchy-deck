import XCTest
@testable import OmarchyDeck

final class DeckExternalLinkTests: XCTestCase {
    func testWebPhoneTextAndMailLinksOpenInTheSystem() throws {
        for input in ["https://example.com/news", "http://example.com/", "tel:+15555550100",
                      "sms:+15555550100", "mailto:support@example.com"] {
            XCTAssertTrue(DeckModel.opensExternally(try XCTUnwrap(URL(string: input))), input)
        }
    }

    func testSchemeMatchIgnoresCase() throws {
        XCTAssertTrue(DeckModel.opensExternally(try XCTUnwrap(URL(string: "SMS:+15555550100"))))
    }

    func testOtherSchemesStayClosed() throws {
        for input in ["javascript:alert(1)", "ftp://example.com/", "file:///etc/hosts",
                      "data:text/html,hi", "omarchy://token"] {
            XCTAssertFalse(DeckModel.opensExternally(try XCTUnwrap(URL(string: input))), input)
        }
    }
}
