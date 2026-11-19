import XCTest
@testable import OmarchyDeck

/// The hardware keyboard table. Foundation only, so it also runs in the Linux harness.
final class DeckShortcutsTests: XCTestCase {
    private let a = URL(string: "https://a.example.com")!
    private let b = URL(string: "https://b.example.com:8443")!
    private let c = URL(string: "https://c.example.com")!

    private func offered(_ screen: DeckShortcutState.Screen, decks: Int = 1, pro: Bool = false,
                         decksOpen: Bool = false) -> [DeckShortcut] {
        DeckShortcutState(screen: screen, deckCount: decks, isPro: pro, decksOpen: decksOpen).offered
    }

    func testReadyDeckOffersAddShowFindPagesAndReload() {
        XCTAssertEqual(offered(.ready), [.addDeck, .showDecks, .findOnPage,
                                         .previousPage, .nextPage, .reload])
    }

    /// The page keys move inside the deck on screen, so a deck that is not showing has no pages to step.
    func testPageKeysAreOnlyOfferedWhileAPageIsShown() {
        for screen in [DeckShortcutState.Screen.token, .loading, .offline] {
            XCTAssertFalse(offered(screen).contains(.previousPage), "\(screen)")
            XCTAssertFalse(offered(screen).contains(.nextPage), "\(screen)")
        }
        XCTAssertTrue(offered(.ready).contains(.previousPage))
        XCTAssertTrue(offered(.ready).contains(.nextPage))
    }

    /// Steps are not Pro: they move inside the one deck the customer already owns.
    func testPageKeysIgnoreTheProRule() {
        XCTAssertTrue(offered(.ready, decks: 1, pro: false).contains(.nextPage))
        XCTAssertTrue(offered(.ready, decks: 6, pro: true).contains(.nextPage))
    }

    func testFindIsOnlyOfferedWhenAPageIsShown() {
        for screen in [DeckShortcutState.Screen.token, .loading, .offline] {
            XCTAssertFalse(offered(screen).contains(.findOnPage), "\(screen)")
        }
    }

    func testReloadIsOfferedReadyAndOfflineOnly() {
        XCTAssertTrue(offered(.ready).contains(.reload))
        XCTAssertTrue(offered(.offline).contains(.reload))
        XCTAssertFalse(offered(.loading).contains(.reload), "A load is already running")
        XCTAssertFalse(offered(.token).contains(.reload), "The token screen has nothing to reload")
    }

    func testFirstRunAndAnOpenDecksSheetOfferNothingHere() {
        XCTAssertEqual(offered(.connect), [], "First run brings its own Command N")
        XCTAssertEqual(offered(.ready, decks: 3, pro: true, decksOpen: true), [],
                       "The Decks sheet brings its own keys")
    }

    func testSwitchingKeysNeedProAndASecondDeck() {
        XCTAssertFalse(offered(.ready, decks: 3, pro: false).contains(.nextDeck), "Switching is Pro")
        XCTAssertFalse(offered(.ready, decks: 1, pro: true).contains(.nextDeck), "One deck has nothing to switch to")
        let shortcuts = offered(.ready, decks: 3, pro: true)
        XCTAssertTrue(shortcuts.contains(.previousDeck))
        XCTAssertTrue(shortcuts.contains(.nextDeck))
        XCTAssertEqual(shortcuts.filter { if case .openDeck = $0 { true } else { false } },
                       [.openDeck(1), .openDeck(2), .openDeck(3)])
    }

    func testNumberedDecksStopAtNine() {
        let numbered = offered(.ready, decks: 12, pro: true).filter { if case .openDeck = $0 { true } else { false } }
        XCTAssertEqual(numbered.count, DeckShortcut.maxNumberedDecks)
        XCTAssertEqual(numbered.last, .openDeck(9))
    }

    func testEveryOfferedKeyIsDistinct() {
        let shortcuts = offered(.ready, decks: 9, pro: true)
        let keys = shortcuts.map { "\($0.usesShift ? "shift-" : "")\($0.key)" }
        XCTAssertEqual(Set(keys).count, keys.count, "Two shortcuts share a key: \(keys)")
        XCTAssertEqual(Set(shortcuts.map(\.id)).count, shortcuts.count)
    }

    func testKeysFollowTheSystemConventions() {
        XCTAssertEqual(DeckShortcut.addDeck.key, "n")
        XCTAssertEqual(DeckShortcut.findOnPage.key, "f")
        XCTAssertEqual(DeckShortcut.reload.key, "r")
        XCTAssertEqual(DeckShortcut.previousDeck.key, "[")
        XCTAssertEqual(DeckShortcut.nextDeck.key, "]")
        XCTAssertTrue(DeckShortcut.previousDeck.usesShift)
        XCTAssertTrue(DeckShortcut.nextDeck.usesShift)
        // The page pair is the plain chord, so no key means two things at once.
        XCTAssertEqual(DeckShortcut.previousPage.key, "[")
        XCTAssertEqual(DeckShortcut.nextPage.key, "]")
        XCTAssertFalse(DeckShortcut.previousPage.usesShift)
        XCTAssertFalse(DeckShortcut.nextPage.usesShift)
        XCTAssertFalse(DeckShortcut.addDeck.usesShift)
        XCTAssertEqual(DeckShortcut.openDeck(4).key, "4")
        XCTAssertEqual(DeckShortcut.openDeck(4).title, "Open Deck 4")
    }

    /// `Character(String(number))` traps for "10" and "-1". Out-of-range numbers must still bind one digit key.
    func testNumberedShortcutKeyNeverTrapsOutsideOneToNine() {
        XCTAssertEqual(DeckShortcut.openDeck(10).key, "9")
        XCTAssertEqual(DeckShortcut.openDeck(1234).key, "9")
        XCTAssertEqual(DeckShortcut.openDeck(-1).key, "0")
        XCTAssertEqual(DeckShortcut.openDeck(9).key, "9")
    }

    func testTitlesAreShortTitleCaseCommands() {
        for shortcut in offered(.ready, decks: 2, pro: true) {
            XCTAssertFalse(shortcut.title.isEmpty)
            XCTAssertTrue(shortcut.title.first?.isUppercase ?? false, shortcut.title)
            XCTAssertFalse(shortcut.title.hasSuffix("."), shortcut.title)
        }
    }

    // MARK: Cycling

    func testNeighborWrapsBothWays() {
        let decks = [a, b, c]
        XCTAssertEqual(DeckCycle.neighbor(of: a, in: decks, step: 1), b)
        XCTAssertEqual(DeckCycle.neighbor(of: c, in: decks, step: 1), a)
        XCTAssertEqual(DeckCycle.neighbor(of: a, in: decks, step: -1), c)
        XCTAssertEqual(DeckCycle.neighbor(of: b, in: decks, step: -1), a)
    }

    func testNeighborNeedsASecondDeck() {
        XCTAssertNil(DeckCycle.neighbor(of: a, in: [a], step: 1))
        XCTAssertNil(DeckCycle.neighbor(of: nil, in: [], step: 1))
    }

    /// With no usable selection (none yet, or one just removed from the list) the keys land on the first deck,
    /// whichever way they point, instead of doing nothing or jumping by the step from an imagined position.
    func testNeighborFallsBackToTheFirstDeckWithoutAUsableSelection() {
        let decks = [a, b, c]
        for step in [1, -1, 2, -2, 0, 7, -7] {
            XCTAssertEqual(DeckCycle.neighbor(of: nil, in: decks, step: step), a, "no selection, step \(step)")
            let removed = URL(string: "https://removed.example.com/")!
            XCTAssertEqual(DeckCycle.neighbor(of: removed, in: decks, step: step), a, "stale selection, step \(step)")
        }
    }

    func testNeighborFallbackStillNeedsASecondDeck() {
        XCTAssertNil(DeckCycle.neighbor(of: nil, in: [a], step: 1), "One deck has nothing to switch to")
        XCTAssertNil(DeckCycle.neighbor(of: c, in: [a], step: -1))
        XCTAssertNil(DeckCycle.neighbor(of: c, in: [], step: 1))
    }

    func testNeighborWrapsStepsLongerThanTheList() {
        let decks = [a, b, c]
        XCTAssertEqual(DeckCycle.neighbor(of: a, in: decks, step: 4), b)
        XCTAssertEqual(DeckCycle.neighbor(of: a, in: decks, step: -4), c)
        XCTAssertEqual(DeckCycle.neighbor(of: b, in: decks, step: 3), b, "A full lap returns to the same deck")
        XCTAssertEqual(DeckCycle.neighbor(of: b, in: decks, step: 0), b)
    }

    func testNumberedDeckCountsFromOne() {
        let decks = [a, b, c]
        XCTAssertEqual(DeckCycle.deck(number: 1, in: decks), a)
        XCTAssertEqual(DeckCycle.deck(number: 3, in: decks), c)
        XCTAssertNil(DeckCycle.deck(number: 0, in: decks))
        XCTAssertNil(DeckCycle.deck(number: 4, in: decks))
        let many = (1...12).map { URL(string: "https://d\($0).example.com")! }
        XCTAssertNil(DeckCycle.deck(number: 10, in: many), "Only Command 1 to 9 exist")
    }

    /// The Command overlay names the deck each number opens. A number with no deck keeps the plain title.
    func testOverlayTitleNamesTheDeckEachNumberOpens() {
        let decks = [a, b]
        XCTAssertEqual(DeckShortcut.openDeck(1).overlayTitle(in: decks), "Open a.example.com")
        XCTAssertEqual(DeckShortcut.openDeck(2).overlayTitle(in: decks), "Open b.example.com:8443")
        XCTAssertEqual(DeckShortcut.openDeck(3).overlayTitle(in: decks), "Open Deck 3")
        XCTAssertEqual(DeckShortcut.openDeck(0).overlayTitle(in: decks), "Open Deck 0")
    }

    func testOverlayTitleLeavesOtherShortcutsAsTheirTitle() {
        let others: [DeckShortcut] = [.addDeck, .showDecks, .findOnPage, .reload,
                                      .previousDeck, .nextDeck, .previousPage, .nextPage]
        for shortcut in others {
            XCTAssertEqual(shortcut.overlayTitle(in: [a, b]), shortcut.title, "\(shortcut)")
        }
    }

    // MARK: List search

    func testSearchOnlyAppearsForALongList() {
        XCTAssertFalse(DeckListSearch.isOffered(deckCount: DeckListSearch.minimumDecks - 1))
        XCTAssertTrue(DeckListSearch.isOffered(deckCount: DeckListSearch.minimumDecks))
    }

    func testSearchMatchesAnywhereIgnoringCase() {
        let decks = [a, b, c]
        XCTAssertEqual(DeckListSearch.filter(decks, query: ""), decks)
        XCTAssertEqual(DeckListSearch.filter(decks, query: "   "), decks)
        XCTAssertEqual(DeckListSearch.filter(decks, query: "B.EXAMPLE"), [b])
        XCTAssertEqual(DeckListSearch.filter(decks, query: "8443"), [b], "The port is part of the address")
        XCTAssertEqual(DeckListSearch.filter(decks, query: "nowhere"), [])
    }
}
