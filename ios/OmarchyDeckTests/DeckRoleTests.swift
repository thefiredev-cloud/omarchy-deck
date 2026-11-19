import Foundation
import XCTest
@testable import OmarchyDeck

/// I10, I7: the shell reads `/api/whoami` once per sign-in and names the role. Pure parts only, so Linux runs them.
final class DeckRoleTests: XCTestCase {
    private let origin = URL(string: "https://deck.example.com:10443/")!

    private func response(_ status: Int) -> URLResponse {
        HTTPURLResponse(url: URL(string: "https://deck.example.com:10443/api/whoami")!, statusCode: status,
                        httpVersion: "HTTP/1.1", headerFields: nil)!
    }

    func testOwnerAndGuestAnswersAreNamed() {
        XCTAssertEqual(DeckRole.parse(body: Data(#"{"role":"owner"}"#.utf8), response: response(200)), .owner)
        XCTAssertEqual(DeckRole.parse(body: Data(#"{"role":"guest"}"#.utf8), response: response(200)), .guest)
        XCTAssertEqual(DeckRole.owner.signedInLabel, "Signed in as Owner")
        XCTAssertEqual(DeckRole.guest.signedInLabel, "Signed in as Guest")
    }

    func testAnythingElseIsUnknownRatherThanGuessed() {
        XCTAssertNil(DeckRole.parse(body: Data(#"{"role":"none"}"#.utf8), response: response(200)))
        XCTAssertNil(DeckRole.parse(body: Data(#"{"role":"admin"}"#.utf8), response: response(200)))
        XCTAssertNil(DeckRole.parse(body: Data(#"{"role":"owner"}"#.utf8), response: response(401)))
        XCTAssertNil(DeckRole.parse(body: Data("login".utf8), response: response(200)))
        XCTAssertNil(DeckRole.parse(body: Data(), response: URLResponse(url: origin, mimeType: nil,
                                                                        expectedContentLength: 0, textEncodingName: nil)))
    }

    func testWhoamiRequestCarriesOnlyTheSessionCookieToTheSelectedOrigin() throws {
        let cookie = try XCTUnwrap(HTTPCookie(properties: [
            .name: "pdeck", .value: "fixture-token-0000", .domain: "deck.example.com", .path: "/",
        ]))
        let request = try XCTUnwrap(DeckRole.whoamiRequest(origin: origin, cookie: cookie))
        XCTAssertEqual(request.url?.absoluteString, "https://deck.example.com:10443/api/whoami")
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "pdeck=fixture-token-0000")
        XCTAssertNil(request.url?.query, "No token in the URL")
    }
}
