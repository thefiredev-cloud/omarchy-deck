import XCTest
@testable import OmarchyDeck

final class W3L26SavedDeckRowDetailsTests: XCTestCase {
    private let portA = URL(string: "https://deck.example.com:8443")!
    private let portB = URL(string: "https://deck.example.com:9443")!
    private let plain = URL(string: "https://deck.example.com")!

    func testSameHostDifferentPortsHaveDistinctTitles() {
        XCTAssertEqual(SavedDeckRowText.title(for: portA), "deck.example.com:8443")
        XCTAssertEqual(SavedDeckRowText.title(for: portB), "deck.example.com:9443")
        XCTAssertNotEqual(SavedDeckRowText.title(for: portA), SavedDeckRowText.title(for: portB))
    }

    func testDefaultPortRowKeepsPlainHostTitle() {
        XCTAssertEqual(SavedDeckRowText.title(for: plain), "deck.example.com")
    }

    func testTitleFallsBackToTheAddressWhenURLHasNoHost() {
        let address = URL(string: "relative-deck-address")!
        XCTAssertNil(address.host)
        XCTAssertEqual(SavedDeckRowText.title(for: address), address.absoluteString)
    }

    func testSameHostDifferentPortsAreSpokenDistinctly() {
        let spokenA = SavedDeckRowText.spokenLabel(for: portA, isSelected: false, isLocked: false)
        let spokenB = SavedDeckRowText.spokenLabel(for: portB, isSelected: false, isLocked: false)
        XCTAssertEqual(spokenA, "https://deck.example.com:8443")
        XCTAssertEqual(spokenB, "https://deck.example.com:9443")
        XCTAssertNotEqual(spokenA, spokenB)
    }

    func testSelectedRowSpeaksCurrentDeck() {
        XCTAssertEqual(
            SavedDeckRowText.spokenLabel(for: portA, isSelected: true, isLocked: false),
            "https://deck.example.com:8443, current deck"
        )
    }

    func testSelectedWinsOverLockedInSpokenState() {
        XCTAssertEqual(
            SavedDeckRowText.spokenLabel(for: portA, isSelected: true, isLocked: true),
            "https://deck.example.com:8443, current deck"
        )
    }

    func testLockedRowSpeaksLockedAndHintExplainsRestore() {
        XCTAssertEqual(
            SavedDeckRowText.spokenLabel(for: portB, isSelected: false, isLocked: true),
            "https://deck.example.com:9443, locked"
        )
        XCTAssertEqual(SavedDeckRowText.hint(isLocked: true), "Restore Pro to switch decks.")
        XCTAssertEqual(SavedDeckRowText.hint(isLocked: true), SavedDeckRowText.lockedHint)
    }

    func testUnlockedRowHasNoStateWordsOrHint() {
        XCTAssertEqual(
            SavedDeckRowText.spokenLabel(for: portB, isSelected: false, isLocked: false),
            "https://deck.example.com:9443"
        )
        XCTAssertEqual(SavedDeckRowText.hint(isLocked: false), "")
    }
    func testIPv6TitleKeepsAddressBracketsAndPort() {
        let ipv6 = URL(string: "https://[2001:db8::1]:8443")!

        XCTAssertEqual(SavedDeckRowText.title(for: ipv6), "[2001:db8::1]:8443")
    }

    func testIPv6TitleWithoutPortKeepsBrackets() {
        let ipv6 = URL(string: "https://[2001:db8::1]/")!

        XCTAssertEqual(SavedDeckRowText.title(for: ipv6), "[2001:db8::1]")
    }

}
