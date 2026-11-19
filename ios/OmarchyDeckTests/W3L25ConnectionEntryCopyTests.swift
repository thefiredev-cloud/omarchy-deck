import Foundation
import XCTest
@testable import OmarchyDeck

/// Lane 25: connection entry copy. Pure copy and format checks run on Linux. Source wiring guards pin the view code
/// paths that the Linux harness cannot compile. Rendered SwiftUI behavior is verified only on the Mac.
final class W3L25ConnectionEntryCopyTests: XCTestCase {

    // MARK: Address

    func testAcceptedAddressesHaveNoProblemAndParse() {
        for input in ["https://deck.example.com:10443/", "deck.example.com", "deck.example.com:10443", "  Deck.Example.com/  "] {
            XCTAssertNil(AddressEntryCopy.problem(input), input)
            XCTAssertNotNil(DeckConfig.parseOrigin(input), input)
        }
    }

    func testEmptyAddressHasNoProblem() {
        XCTAssertNil(AddressEntryCopy.problem(""))
        XCTAssertNil(AddressEntryCopy.problem("   "))
    }

    func testMalformedAddressGetsSpecificNextStep() {
        let cases: [(input: String, expect: String)] = [
            ("http://deck.example.com", "Start the address with https://"),
            ("ftp://deck.example.com/", "Start the address with https://"),
            ("user:pass@deck.example.com", "Remove the username, password, or token before the @"),
            ("deck.example.com/?t=bad!", "or remove everything after the address"),
            ("deck.example.com/admin", "Remove the path after the address"),
            ("deck.example.com:99999", "The port must be a number from 1 to 65535"),
            ("deck example.com", "A server address has no spaces"),
        ]
        for c in cases {
            XCTAssertNil(DeckConfig.parseOrigin(c.input), c.input)
            let problem = AddressEntryCopy.problem(c.input)
            XCTAssertNotNil(problem, c.input)
            XCTAssertTrue(problem?.contains(c.expect) ?? false, "\(c.input) -> \(problem ?? "nil")")
        }
    }

    func testAddressMessagesNeverEchoTheInput() {
        let secret = "secret-token-xyz987"
        for input in ["http://deck.example.com/?t=\(secret)", "user:\(secret)@deck.example.com", "deck.example.com/\(secret)"] {
            let problem = AddressEntryCopy.problem(input) ?? ""
            XCTAssertFalse(problem.isEmpty, input)
            XCTAssertFalse(problem.contains(secret), problem)
        }
    }

    // MARK: Token

    func testAcceptedTokensHaveNoProblem() {
        for input in ["abcdefgh1234", "https://deck.example.com/?t=abcdefgh1234", "t=abcdefgh1234", "  abcdefgh1234\n"] {
            XCTAssertNil(TokenEntryCopy.problem(input), input)
            XCTAssertNotNil(DeckConfig.extractToken(input), input)
        }
    }

    func testEmptyTokenHasNoProblem() {
        XCTAssertNil(TokenEntryCopy.problem(""))
        XCTAssertNil(TokenEntryCopy.problem("  \n"))
    }

    func testMalformedTokenGetsSpecificNextStep() {
        let cases: [(input: String, expect: String)] = [
            ("abc def ghi jkl", "A deck token has no spaces"),
            ("https://deck.example.com/?t=abc", "The ?t= value is not a complete deck token"),
            ("https://deck.example.com/", "Paste the token itself"),
            ("short", "A deck token is at least 8 characters"),
            ("abcd!efgh123", "A deck token uses letters, numbers, - and _ only"),
            (String(repeating: "a", count: 300), "That is longer than a deck token"),
        ]
        for c in cases {
            XCTAssertNil(DeckConfig.extractToken(c.input), c.input)
            let problem = TokenEntryCopy.problem(c.input)
            XCTAssertTrue(problem?.contains(c.expect) ?? false, "\(c.input.prefix(40)) -> \(problem ?? "nil")")
        }
    }

    func testTokenMessagesNeverEchoTheToken() {
        let secret = "secret-token-xyz987"
        for input in ["abc def \(secret)", "https://deck.example.com/?t=\(secret)!", "\(secret)!!"] {
            let problem = TokenEntryCopy.problem(input) ?? ""
            XCTAssertFalse(problem.isEmpty, input)
            XCTAssertFalse(problem.contains(secret), problem)
        }
    }

    // MARK: Source wiring guards

    private func sourceOf(_ relative: String) throws -> String {
        // Resolve symlinks so the guard reads the app file in the worktree, not the harness link.
        let here = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath()
        let root = here.deletingLastPathComponent().deletingLastPathComponent()
        return try String(contentsOf: root.appendingPathComponent(relative), encoding: .utf8)
    }


    func testTokenSubmitPathChecksFormatBeforeSubmitting() throws {
        let source = try sourceOf("OmarchyDeck/TokenView.swift")
        let check = try XCTUnwrap(source.range(of: "TokenEntryCopy.problem(t)"))
        let submit = try XCTUnwrap(source.range(of: "deck.submit(token: t)"))
        XCTAssertLessThan(check.lowerBound, submit.lowerBound)
        XCTAssertTrue(source.contains(".accessibilityLabel(\"Deck token\")"))
        XCTAssertTrue(source.contains("guard !t.isEmpty else { return }"))
    }

    func testTokenViewNeverReadsOrShowsTheClipboardAutomatically() throws {
        let source = try sourceOf("OmarchyDeck/TokenView.swift")
        XCTAssertFalse(source.contains("UIPasteboard"))
        XCTAssertFalse(source.contains("accessibilityValue"))
        XCTAssertFalse(source.contains("accessibilityAction"))
        XCTAssertTrue(source.contains("PasteButton("))
    }

    func testTokenScreenGivesEachControlItsOwnIdentifier() throws {
        let source = try sourceOf("OmarchyDeck/TokenView.swift")
        for identifier in ["token.eyebrow", "token.title", "token.body", "token.field",
                           "token.help", "token.notice", "token.paste", "token.open", "token.server", "screen.token"] {
            let needle = "\"\(identifier)\""
            XCTAssertEqual(source.components(separatedBy: needle).count - 1, 1, "\(identifier) must be unique")
        }
        XCTAssertTrue(source.contains("accessibilityElement(children: .combine)"))
        XCTAssertFalse(source.contains("accessibilityElement(children: .ignore)"))
    }

    /// README "Adding decks": the Decks list always has one Add deck row. Revocation locks
    /// the other rows and withholds the address field on the pushed screen. It does not
    /// delete or disable `connection.add`.
    func testDecksListKeepsAddDeckWhenSwitchingIsLocked() throws {
        let source = try sourceOf("OmarchyDeck/ConnectionsView.swift")
        let sheet = try XCTUnwrap(source.range(of: "private var sheet: some View"))
        let add = try XCTUnwrap(source.range(of: ".accessibilityIdentifier(\"connection.add\")"))
        XCTAssertGreaterThan(add.lowerBound, sheet.lowerBound)
        let row = source[sheet.lowerBound..<add.upperBound]
        XCTAssertFalse(row.contains("if pro.isPro"),
                       "The Add deck row must not be gated on Pro")
        XCTAssertFalse(row.contains(".disabled"),
                       "The row stays tappable so the lock screen can explain itself")
        let mode = try sourceOf("OmarchyDeck/AddressEntry.swift")
        XCTAssertTrue(mode.contains("case .add, .locked: \"Add deck\""))
        XCTAssertTrue(mode.contains("var acceptsAddress: Bool { self != .locked }"))
    }

    /// 44 × 0.9 is 39.6 pt. The dimmed glyph may scale; the button's hit shape may not.
    /// Guideline 5.6: the control never hides and never stops taking taps.
    func testDecksControlStaysVisibleAndTappableAfterTheIdleWait() throws {
        let source = try sourceOf("OmarchyDeck/ContentView.swift")
        let glyphStart = try XCTUnwrap(source.range(of: "private struct DeckControlGlyph"))
        let controlStart = try XCTUnwrap(source.range(of: "private struct DecksControl"))
        let styleStart = try XCTUnwrap(source.range(of: "private struct DeckPressStyle"))
        let glassStart = try XCTUnwrap(source.range(of: "private extension View"))
        XCTAssertLessThan(glyphStart.lowerBound, controlStart.lowerBound)
        XCTAssertLessThan(controlStart.lowerBound, styleStart.lowerBound)
        let glyph = source[glyphStart.lowerBound..<controlStart.lowerBound]
        XCTAssertTrue(glyph.contains(".scaleEffect(scale)"))
        XCTAssertTrue(glyph.contains("0.9"))
        XCTAssertTrue(glyph.contains(".allowsHitTesting(false)"))
        XCTAssertTrue(glyph.contains(".accessibilityHidden(true)"))
        let control = source[controlStart.lowerBound..<styleStart.lowerBound]
        XCTAssertFalse(control.contains("scaleEffect"),
                       "Scaling the button shrinks the accessibility frame below 44 pt")
        XCTAssertTrue(control.contains(".frame(width: DeckChrome.controlPoints, height: DeckChrome.controlPoints)"))
        XCTAssertTrue(control.contains(".contentShape(Circle())"))
        XCTAssertFalse(control.contains(".opacity(chrome.isVisible"),
                       "Fading the button itself keeps XCTest isHittable false")
        XCTAssertFalse(control.contains(".animation("),
                       "Animating the button delayed allowsHitTesting until after the fade-in")
        XCTAssertTrue(control.contains(".allowsHitTesting(chrome.isVisible)"),
                       "The control is tappable whenever it is present")
        XCTAssertTrue(control.contains(".accessibilityIdentifier(\"connection.manage\")"))
        XCTAssertTrue(glyph.contains(".opacity(dimmed ? Self.dimmedOpacity : 1)"),
                       "The glyph dims but never reaches zero opacity (Guideline 5.6)")
        XCTAssertFalse(glyph.contains(".opacity(visible ? 1 : 0)"),
                       "A zero-opacity glyph is an invisible control, which is what App Review flagged")
        XCTAssertTrue(glyph.contains("dimmedOpacity: Double = 0.55"))
        let style = source[styleStart.lowerBound..<glassStart.lowerBound]
        XCTAssertFalse(style.contains("scaleEffect"),
                       "Press scale on the button label shrinks the hit target")
    }

    func testAboutSurfacesShowTheExactCopyrightNotice() throws {
        for relative in ["OmarchyDeck/ConnectionsView.swift",
                         "OmarchyDeck/FirstRunView.swift",
                         "OmarchyDeck/DemoConnectSheet.swift"] {
            let source = try sourceOf(relative)
            XCTAssertTrue(source.contains("AppCopyright.notice"), relative)
            XCTAssertTrue(source.contains("deck.about.copyright"), relative)
        }
        XCTAssertTrue(try sourceOf("OmarchyDeck/AppVersion.swift").contains("© 2026 thefiredev-cloud"))
    }

    func testAddDeckScreenPublishesTheReplaceNoteAsItsOwnRow() throws {
        let source = try sourceOf("OmarchyDeck/ConnectionsView.swift")
        let note = try XCTUnwrap(source.range(of: ".accessibilityIdentifier(\"connection.note\")"))
        let entry = try XCTUnwrap(source.range(of: "AddressEntry(focus: $focused, onSaved: close, replacePrompt: $replacePrompt, showsNote: false)"))
        XCTAssertLessThan(note.lowerBound, entry.lowerBound)
        XCTAssertTrue(source.contains("showsNote: false"))
    }

    func testReplaceAlertIsPresentedOnceOnAddDeckNotTheStackOrList() throws {
        let connections = try sourceOf("OmarchyDeck/ConnectionsView.swift")
        XCTAssertTrue(connections.contains("Topmost Add deck screen only"))
        XCTAssertEqual(connections.components(separatedBy: ".replaceDeckAlert(").count - 1, 1)
        let addDeck = try XCTUnwrap(connections.range(of: "private struct AddDeckScreen: View"))
        let alert = try XCTUnwrap(connections.range(of: ".replaceDeckAlert(prompt: $replacePrompt"))
        XCTAssertGreaterThan(alert.lowerBound, addDeck.lowerBound,
                             "Replace confirm must be presented from AddDeckScreen, not the Decks stack")
        let demo = try sourceOf("OmarchyDeck/DemoConnectSheet.swift")
        let done = try XCTUnwrap(demo.range(of: ".deckKeyboardDoneButton { addressFocused = false }"))
        let demoAlert = try XCTUnwrap(demo.range(of: ".replaceDeckAlert(prompt: $replacePrompt"))
        XCTAssertGreaterThan(demoAlert.lowerBound, done.lowerBound)
        let address = try sourceOf("OmarchyDeck/AddressEntry.swift")
        XCTAssertFalse(address.contains(".replaceDeckAlert(prompt: $localReplacePrompt"),
                       "AddressEntry must not present the replace alert; Add deck is the only Decks presenter")
        let firstRun = try sourceOf("OmarchyDeck/FirstRunView.swift")
        XCTAssertFalse(firstRun.contains(".replaceDeckAlert"),
                       "First run must not present a second Replace deck alert")
    }

    func testAddressWarningAppearsBeforeItsSaveAction() throws {
        let address = try sourceOf("OmarchyDeck/AddressEntry.swift")
        let warning = try XCTUnwrap(address.range(of: "if let error {"))
        let save = try XCTUnwrap(address.range(of: "Button(mode.actionTitle, action: submit)"))
        XCTAssertLessThan(warning.lowerBound, save.lowerBound,
                          "Address warnings must stay beside the field, before the save action")
    }
}
