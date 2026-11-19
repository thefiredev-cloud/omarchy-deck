import XCTest
@testable import OmarchyDeck

/// What saving an address will do, said before the customer types. Foundation only, so it also runs on Linux.
final class AddDeckModeTests: XCTestCase {
    // Saved decks are canonical origins (`DeckConfig.parseOrigin`), which always end in a slash.
    private let a = URL(string: "https://a.example.com/")!
    private let b = URL(string: "https://b.example.com:8443/")!

    func testModeFollowsTheFreeAndProRules() {
        XCTAssertEqual(AddDeckMode(connections: [], selected: nil, isPro: false), .connect)
        XCTAssertEqual(AddDeckMode(connections: [], selected: nil, isPro: true), .connect)
        XCTAssertEqual(AddDeckMode(connections: [a], selected: a, isPro: true), .add)
        XCTAssertEqual(AddDeckMode(connections: [a, b], selected: a, isPro: true), .add)
        XCTAssertEqual(AddDeckMode(connections: [a], selected: a, isPro: false), .replace(a))
        XCTAssertEqual(AddDeckMode(connections: [a], selected: nil, isPro: false), .replace(a))
        XCTAssertEqual(AddDeckMode(connections: [a, b], selected: b, isPro: false), .locked,
                       "Lapsed Pro keeps the saved decks and adds nothing")
    }

    func testButtonSaysWhatItDoes() {
        XCTAssertEqual(AddDeckMode.connect.actionTitle, "Connect")
        XCTAssertEqual(AddDeckMode.add.actionTitle, "Add deck")
        XCTAssertEqual(AddDeckMode.replace(a).actionTitle, "Replace deck")
        XCTAssertEqual(AddDeckMode.replace(a).screenTitle, "Replace Deck")
        XCTAssertEqual(AddDeckMode.add.screenTitle, "Add Deck")
        XCTAssertEqual(AddDeckMode.locked.actionTitle, "Add deck",
                       "Lapsed Pro still offers the row; the pushed screen explains the lock")
        XCTAssertEqual(AddDeckMode.locked.screenTitle, "Add Deck")
    }

    func testOnlyReplaceSavesWithTheReplaceFlag() {
        XCTAssertTrue(AddDeckMode.replace(a).replaces)
        for mode in [AddDeckMode.connect, .add, .locked] {
            XCTAssertFalse(mode.replaces, "\(mode)")
        }
    }

    func testLockedTakesNoAddressAndPointsToPro() {
        XCTAssertFalse(AddDeckMode.locked.acceptsAddress)
        XCTAssertTrue(AddDeckMode.locked.offersPro)
        XCTAssertTrue(AddDeckMode.locked.note?.contains("Restore Pro") ?? false)
    }

    func testReplaceNamesTheDeckItReplacesAndOffersPro() throws {
        let note = try XCTUnwrap(AddDeckMode.replace(b).note)
        XCTAssertTrue(note.contains("b.example.com:8443"), note)
        XCTAssertTrue(note.contains("Pro keeps both"), note)
        XCTAssertTrue(AddDeckMode.replace(b).offersPro)
        XCTAssertTrue(AddDeckMode.replace(b).confirmationMessage.contains("b.example.com:8443"))
    }

    func testConnectAndAddNeedNoNoteOrPro() {
        for mode in [AddDeckMode.connect, .add] {
            XCTAssertNil(mode.note, "\(mode)")
            XCTAssertFalse(mode.offersPro, "\(mode)")
            XCTAssertTrue(mode.acceptsAddress, "\(mode)")
            XCTAssertEqual(mode.confirmationMessage, "")
        }
    }

    func testReplacementIsConfirmedOnlyWhenSomethingIsReplaced() {
        let replace = AddDeckMode.replace(a)
        XCTAssertTrue(replace.confirmsReplacement(of: "b.example.com:8443", saved: [a]))
        XCTAssertFalse(replace.confirmsReplacement(of: "https://a.example.com/", saved: [a]),
                       "The saved address only reopens its deck")
        XCTAssertFalse(replace.confirmsReplacement(of: "not an address", saved: [a]),
                       "A malformed address gets its format message instead")
        XCTAssertFalse(AddDeckMode.add.confirmsReplacement(of: "b.example.com", saved: [a]))
    }

    func testHelperNeverPromisesToKeepTheToken() {
        XCTAssertTrue(AddDeckMode.helper.contains("never the token"))
    }
}
