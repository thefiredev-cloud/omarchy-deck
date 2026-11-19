import Foundation

/// Every hardware keyboard shortcut the deck screen offers, in one table. Foundation only, so the Linux harness
/// checks which shortcut is offered in which state. `DeckShortcutLayer` turns the offered ones into
/// `.keyboardShortcut` buttons, which iPadOS lists while Command is held and which also work on iPhone.
/// Return and Escape are not in this table: each screen marks its own default and cancel buttons.
enum DeckShortcut: Hashable, Identifiable {
    case addDeck
    case showDecks
    case findOnPage
    case reload
    case previousDeck
    case nextDeck
    /// Plain Command [ and ]: the page before or after the one showing inside the deck.
    case previousPage
    case nextPage
    /// Command 1 to Command 9 open the saved decks in list order.
    case openDeck(Int)

    static let maxNumberedDecks = 9

    var id: String {
        switch self {
        case .addDeck: "add"
        case .showDecks: "decks"
        case .findOnPage: "find"
        case .reload: "reload"
        case .previousDeck: "previous"
        case .nextDeck: "next"
        case .previousPage: "previousPage"
        case .nextPage: "nextPage"
        case .openDeck(let number): "deck\(number)"
        }
    }

    var title: String {
        switch self {
        case .addDeck: "Add Deck"
        case .showDecks: "Show Decks"
        case .findOnPage: "Find on Page"
        case .reload: "Reload"
        case .previousDeck: "Previous Deck"
        case .nextDeck: "Next Deck"
        case .previousPage: "Previous Page"
        case .nextPage: "Next Page"
        case .openDeck(let number): "Open Deck \(number)"
        }
    }

    /// The Command overlay title. Numbered shortcuts name the deck they open, so the overlay reads like the Decks list.
    func overlayTitle(in decks: [URL]) -> String {
        guard case .openDeck(let number) = self,
              let origin = DeckCycle.deck(number: number, in: decks) else { return title }
        return "Open \(SavedDeckRowText.title(for: origin))"
    }

    var key: Character {
        switch self {
        case .addDeck: "n"
        case .showDecks: "d"
        case .findOnPage: "f"
        case .reload: "r"
        case .previousDeck: "["
        case .nextDeck: "]"
        case .previousPage: "["
        case .nextPage: "]"
        // `Character(String)` traps unless the string is exactly one character, so "10" or "-1" would crash the
        // deck screen while it builds its shortcut buttons. `offered` only emits 1...9; clamp anything else to a digit.
        case .openDeck(let number): Character(String(min(max(number, 0), Self.maxNumberedDecks)))
        }
    }

    /// Previous and next deck follow Safari's tab keys: Shift Command [ and Shift Command ].
    /// The page keys are the plain pair, so one chord never means two things.
    var usesShift: Bool {
        switch self {
        case .previousDeck, .nextDeck: true
        case .addDeck, .showDecks, .findOnPage, .reload, .previousPage, .nextPage, .openDeck: false
        }
    }
}

/// What the deck screen is doing, reduced to what decides which shortcuts apply.
struct DeckShortcutState: Equatable {
    enum Screen: Equatable { case connect, token, loading, offline, ready }

    var screen: Screen
    var deckCount: Int
    var isPro: Bool
    /// The Decks sheet is up. It brings its own Command N, Command F and Escape, so the deck screen offers none.
    var decksOpen: Bool

    var offered: [DeckShortcut] {
        // First run is the add screen: its own Command N puts the cursor in the address field.
        guard !decksOpen, screen != .connect else { return [] }
        var shortcuts: [DeckShortcut] = [.addDeck, .showDecks]
        // The page keys move inside the deck on screen, so they exist only while it is showing.
        if screen == .ready { shortcuts += [.findOnPage, .previousPage, .nextPage] }
        if screen == .ready || screen == .offline { shortcuts.append(.reload) }
        // Switching is Pro. Free and lapsed Pro see no switching shortcut rather than one that does nothing.
        if isPro && deckCount > 1 {
            shortcuts += [.previousDeck, .nextDeck]
            shortcuts += (1...min(deckCount, DeckShortcut.maxNumberedDecks)).map(DeckShortcut.openDeck)
        }
        return shortcuts
    }
}

/// Moving through saved decks from the keyboard.
enum DeckCycle {
    /// The deck `step` places away from `selected`, wrapping at both ends. Nil when there is nothing to switch to.
    static func neighbor(of selected: URL?, in decks: [URL], step: Int) -> URL? {
        guard decks.count > 1 else { return nil }
        guard let selected, let index = decks.firstIndex(of: selected) else { return decks.first }
        let count = decks.count
        return decks[((index + step) % count + count) % count]
    }

    /// The deck behind Command `number`, counting from 1. Nil past the end of the list.
    static func deck(number: Int, in decks: [URL]) -> URL? {
        guard number >= 1, number <= min(decks.count, DeckShortcut.maxNumberedDecks) else { return nil }
        return decks[number - 1]
    }
}

/// The Decks list only grows a search field once it is long enough to need one.
enum DeckListSearch {
    static let minimumDecks = 6

    static func isOffered(deckCount: Int) -> Bool { deckCount >= minimumDecks }

    /// Matches anywhere in the address, ignoring case. An empty query keeps every deck.
    static func filter(_ decks: [URL], query: String) -> [URL] {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return decks }
        return decks.filter { $0.absoluteString.localizedCaseInsensitiveContains(text) }
    }
}
