import SwiftUI
import XCTest
@testable import OmarchyDeck

/// The SwiftUI side of the hardware shortcut table in DeckKeyboard.swift: which key and which modifiers each
/// shortcut binds. The table itself (which shortcuts exist in which state) is DeckShortcutsTests.
final class DeckKeyboardTests: XCTestCase {
    func testPlainShortcutsUseCommandAlone() {
        let plain: [DeckShortcut] = [.addDeck, .showDecks, .findOnPage, .reload, .previousPage, .nextPage, .openDeck(4)]
        for shortcut in plain {
            XCTAssertEqual(shortcut.modifiers, .command, "\(shortcut) must be Command alone")
        }
    }

    func testDeckCyclingAddsShiftToCommand() {
        XCTAssertEqual(DeckShortcut.previousDeck.modifiers, [.command, .shift])
        XCTAssertEqual(DeckShortcut.nextDeck.modifiers, [.command, .shift])
    }

    func testKeyEquivalentIsTheTableKey() {
        XCTAssertEqual(DeckShortcut.addDeck.keyEquivalent, KeyEquivalent("n"))
        XCTAssertEqual(DeckShortcut.reload.keyEquivalent, KeyEquivalent("r"))
        XCTAssertEqual(DeckShortcut.previousPage.keyEquivalent, KeyEquivalent("["))
        XCTAssertEqual(DeckShortcut.nextDeck.keyEquivalent, KeyEquivalent("]"))
        XCTAssertEqual(DeckShortcut.openDeck(4).keyEquivalent, KeyEquivalent("4"))
    }

    /// Page steps and deck steps share the bracket keys. The Shift chord is the only thing that tells them apart,
    /// so the two pairs must never bind the same key and modifiers.
    func testPageAndDeckStepsOnTheSameKeyDifferOnlyByShift() {
        XCTAssertEqual(DeckShortcut.previousPage.keyEquivalent, DeckShortcut.previousDeck.keyEquivalent)
        XCTAssertEqual(DeckShortcut.nextPage.keyEquivalent, DeckShortcut.nextDeck.keyEquivalent)
        XCTAssertNotEqual(DeckShortcut.previousPage.modifiers, DeckShortcut.previousDeck.modifiers)
        XCTAssertNotEqual(DeckShortcut.nextPage.modifiers, DeckShortcut.nextDeck.modifiers)
    }
}
