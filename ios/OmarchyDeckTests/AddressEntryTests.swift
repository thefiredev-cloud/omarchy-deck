import Foundation
import XCTest
@testable import OmarchyDeck

final class AddressEntryTests: XCTestCase {
    func testValidPortBoundariesAndIPv6OriginsHaveNoProblem() throws {
        for input in [
            "deck.example.com:1",
            "deck.example.com:65535",
            "HTTPS://Deck.Example.com:443/",
            "https://[::1]:10443/",
            "\n\tdeck.example.com:10443/\r\n",
        ] {
            _ = try XCTUnwrap(DeckConfig.parseOrigin(input), input)
            XCTAssertNil(AddressEntryCopy.problem(input), input)
        }
    }

    func testPortsOutsideBothBoundariesReceiveTheSamePortCorrection() throws {
        let portCorrection = try XCTUnwrap(AddressEntryCopy.problem("deck.example.com:99999"))
        for input in ["deck.example.com:0", "https://deck.example.com:65536/"] {
            XCTAssertNil(DeckConfig.parseOrigin(input), input)
            XCTAssertEqual(AddressEntryCopy.problem(input), portCorrection, input)
        }
    }

    func testFragmentAndEmptyQueryReceiveTheTokenRemovalCorrection() throws {
        let tokenCorrection = try XCTUnwrap(AddressEntryCopy.problem("deck.example.com/?t=bad!"))
        for input in [
            "deck.example.com/#fixture-token",
            "deck.example.com/#",
            "deck.example.com/?",
            "deck.example.com/admin#fixture-token",
        ] {
            XCTAssertNil(DeckConfig.parseOrigin(input), input)
            XCTAssertEqual(AddressEntryCopy.problem(input), tokenCorrection, input)
        }
    }

    func testCredentialsTakePrecedenceOverQueryPathAndPortProblems() throws {
        let credentialsCorrection = try XCTUnwrap(AddressEntryCopy.problem("user@deck.example.com"))
        let input = "https://user:fixture-password@deck.example.com:65536/admin?t=fixture-token"
        XCTAssertNil(DeckConfig.parseOrigin(input))
        XCTAssertEqual(AddressEntryCopy.problem(input), credentialsCorrection)
    }

    func testInternalUnicodeWhitespaceTakesPrecedenceOverSchemeAndCredentials() throws {
        let whitespaceCorrection = try XCTUnwrap(AddressEntryCopy.problem("deck example.com"))
        for whitespace in ["\t", "\n", "\u{00A0}", "\u{2003}"] {
            let input = "http://user:fixture-password@deck\(whitespace)example.com"
            XCTAssertNil(DeckConfig.parseOrigin(input), input)
            XCTAssertEqual(AddressEntryCopy.problem(input), whitespaceCorrection, input)
        }
    }

    func testEveryDiagnosticBranchKeepsPastedSecretsOutOfItsMessage() throws {
        let secret = "fixture-private-value-987"
        let inputs = [
            "deck \(secret).example.com",
            "\(secret)://deck.example.com",
            "user:\(secret)@deck.example.com",
            "deck.example.com/#\(secret)",
            "\(secret).example.com:65536",
            "deck.example.com/\(secret)",
            "deck.example.com:\(secret)",
        ]
        for input in inputs {
            XCTAssertNil(DeckConfig.parseOrigin(input), input)
            let diagnostic = try XCTUnwrap(AddressEntryCopy.problem(input), input)
            XCTAssertFalse(diagnostic.contains(secret), diagnostic)
        }
    }

    // MARK: Pasted deck link (I9)

    func testDeckLinkWithTokenSplitsIntoOriginAndToken() throws {
        for input in ["https://deck.example.com:10443/?t=fixture-token-0000",
                      "deck.example.com:10443/?t=fixture-token-0000",
                      "  HTTPS://Deck.Example.com:10443?t=fixture-token-0000\n"] {
            let link = try XCTUnwrap(DeckConfig.splitDeckLink(input), input)
            XCTAssertEqual(link.origin.absoluteString, "https://deck.example.com:10443/", input)
            XCTAssertEqual(link.token, "fixture-token-0000", input)
            XCTAssertNil(AddressEntryCopy.problem(input), "A full deck link is accepted: \(input)")
        }
        // The replace prompt reads the link's origin, so a saved deck pasted as a link replaces nothing.
        let saved = try XCTUnwrap(DeckConfig.parseOrigin("deck.example.com:10443"))
        XCTAssertFalse(AddDeckMode.replace(saved).confirmsReplacement(
            of: "https://deck.example.com:10443/?t=fixture-token-0000", saved: [saved]))
        XCTAssertTrue(AddDeckMode.replace(saved).confirmsReplacement(
            of: "https://other.example.com/?t=fixture-token-0000", saved: [saved]))
    }

    func testDeckLinkWithoutTokenIsAPlainAddress() throws {
        let link = try XCTUnwrap(DeckConfig.splitDeckLink("https://deck.example.com:10443/"))
        XCTAssertEqual(link.origin.absoluteString, "https://deck.example.com:10443/")
        XCTAssertNil(link.token)
        // A query that is not one complete `t` token is still refused.
        for input in ["https://deck.example.com/?t=short", "https://deck.example.com/?x=fixture-token-0000",
                      "https://deck.example.com/?t=fixture-token-0000&x=1", "https://deck.example.com/?t=fixture-token-0000#a",
                      "https://deck.example.com/admin?t=fixture-token-0000"] {
            XCTAssertNil(DeckConfig.splitDeckLink(input), input)
            XCTAssertNotNil(AddressEntryCopy.problem(input), input)
        }
    }

    func testNonHTTPSDeckLinkIsRefusedWithoutEchoingTheToken() throws {
        let secret = "fixture-token-0000"
        for input in ["http://deck.example.com:10443/?t=\(secret)", "ftp://deck.example.com/?t=\(secret)"] {
            XCTAssertNil(DeckConfig.splitDeckLink(input), input)
            let problem = try XCTUnwrap(AddressEntryCopy.problem(input), input)
            XCTAssertTrue(problem.contains("Start the address with https://"), problem)
            XCTAssertFalse(problem.contains(secret), problem)
        }
    }
}
