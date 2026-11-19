import Foundation
import XCTest
@testable import OmarchyDeck

final class TokenEntryTests: XCTestCase {
    func testLengthLimitsApplyToTheTokenInEveryPasteForm() {
        for length in [7, 8, 256, 257] {
            let token = String(repeating: "a", count: length)
            let accepted = (8...256).contains(length)
            for input in [token, "t=\(token)", "https://deck.example.com/?t=\(token)"] {
                XCTAssertEqual(TokenEntryCopy.problem(input) == nil, accepted,
                               "Token length \(length), paste length \(input.count)")
            }
        }
    }

    func testAllTokenAlphabetCharactersAreAccepted() {
        let token = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        XCTAssertNil(TokenEntryCopy.problem(token))
        XCTAssertNil(TokenEntryCopy.problem("t=\(token)"))
        XCTAssertNil(TokenEntryCopy.problem("https://deck.example.com/?t=\(token)"))
    }

    func testUnicodeLookalikesAndPunctuationAreRejectedInEveryPasteForm() {
        for character in ["é", "ｅ", "а", "١", "🔑", ".", "+", "/", "="] {
            let token = "abcd\(character)efgh"
            var link = URLComponents(string: "https://deck.example.com/")!
            link.queryItems = [URLQueryItem(name: "t", value: token)]
            for input in [token, "t=\(token)", link.string!] {
                XCTAssertNotNil(TokenEntryCopy.problem(input), "Rejected character: \(character)")
            }
        }
    }

    func testSurroundingUnicodeWhitespaceDoesNotRejectAValidPaste() {
        for whitespace in ["\t", "\n", "\r\n", "\u{00A0}", "\u{2003}", "\u{2028}"] {
            for input in ["abcdEF09-_", "t=abcdEF09-_", "https://deck.example.com/?t=abcdEF09-_"] {
                XCTAssertNil(TokenEntryCopy.problem(whitespace + input + whitespace))
            }
        }
    }

    func testWhitespaceInsideTheTokenIsNotTreatedAsSurroundingWhitespace() {
        for whitespace in [" ", "\t", "\n", "\u{00A0}", "\u{2003}"] {
            let token = "abcd\(whitespace)efgh"
            XCTAssertNotNil(TokenEntryCopy.problem(token))
            XCTAssertNotNil(TokenEntryCopy.problem("t=\(token)"))
        }
    }

    func testQueryWithoutTokenParameterGetsDeckLinkNextStep() {
        let problem = TokenEntryCopy.problem("abcdefgh?x=1")
        XCTAssertTrue(problem?.contains("deck link that contains ?t=") ?? false, problem ?? "nil")
    }

    func testRejectedPasteDiagnosticsDoNotDiscloseSecrets() throws {
        let secret = "synthetic-private-marker"
        let inputs = [
            "\(secret) invalid", "https://deck.example.com/?t=\(secret)!",
            "https://deck.example.com/\(secret)", "\(secret)!",
            String(repeating: secret, count: 12)
        ]
        for input in inputs {
            let problem = try XCTUnwrap(TokenEntryCopy.problem(input))
            XCTAssertFalse(problem.contains(secret))
            XCTAssertFalse(problem.contains(input))
        }
    }
}
