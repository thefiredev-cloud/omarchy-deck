import XCTest
@testable import OmarchyDeck

final class DeckConfigTests: XCTestCase {
    func testTypedHostWithoutSchemeBecomesHTTPSOrigin() {
        XCTAssertEqual(DeckConfig.parseOrigin("deck.example.com:10443")?.absoluteString, "https://deck.example.com:10443/")
        XCTAssertEqual(DeckConfig.parseOrigin("  Deck.Example.com/ ")?.absoluteString, "https://deck.example.com/")
    }

    func testOnlyHTTPSOriginsWithoutPathOrTokenAreAccepted() {
        XCTAssertEqual(DeckConfig.parseOrigin("https://deck.example.com:443/")?.absoluteString, "https://deck.example.com/")
        XCTAssertNil(DeckConfig.parseOrigin("http://deck.example.com/"))
        XCTAssertNil(DeckConfig.parseOrigin("ftp://deck.example.com/"))
        XCTAssertNil(DeckConfig.parseOrigin("deck.example.com/?t=secret-token"))
        XCTAssertNil(DeckConfig.parseOrigin("deck.example.com/admin"))
        XCTAssertNil(DeckConfig.parseOrigin("user:pass@deck.example.com"))
        XCTAssertNil(DeckConfig.parseOrigin(""))
    }

    /// The navigation gate: host, port and https must match the selected origin. Anything else leaves the deck.
    func testDeckOriginMatchesHostPortAndHTTPSOnly() throws {
        let origin = try XCTUnwrap(DeckConfig.parseOrigin("deck.example.com:10443"))
        XCTAssertTrue(DeckConfig.isDeckOrigin(URL(string: "https://deck.example.com:10443/dashboard?x=1")!, origin: origin))
        XCTAssertTrue(DeckConfig.isDeckOrigin(URL(string: "https://DECK.example.com:10443/")!, origin: origin),
                      "Host case never changes the origin")
        XCTAssertFalse(DeckConfig.isDeckOrigin(URL(string: "https://deck.example.com/")!, origin: origin),
                       "Another port on the same host is another deck")
        XCTAssertFalse(DeckConfig.isDeckOrigin(URL(string: "http://deck.example.com:10443/")!, origin: origin))
        XCTAssertFalse(DeckConfig.isDeckOrigin(URL(string: "https://user@deck.example.com:10443/")!, origin: origin))
        XCTAssertFalse(DeckConfig.isDeckOrigin(URL(string: "https://deck.example.com.evil.test:10443/")!, origin: origin))
        XCTAssertFalse(DeckConfig.isDeckOrigin(URL(string: "https://evil.test/?deck.example.com")!, origin: origin))
        XCTAssertFalse(DeckConfig.isDeckOrigin(URL(string: "https://other.deck.example.com:10443/")!, origin: origin))
    }

    /// Reload deck keeps the page he is on: the web shell's route lives in the query (`/?p=surf`, pixel-deck
    /// ShellRoute), so the root with a query reloads itself. Almanac goes home; a `t` token is never replayed.
    func testReloadKeepsTheRouteInTheAddressButNeverATokenOrAServerPage() throws {
        let origin = try XCTUnwrap(DeckConfig.parseOrigin("deck.example.com:10443"))
        func inPlace(_ text: String) -> Bool { DeckConfig.reloadsInPlace(URL(string: text), origin: origin) }
        XCTAssertTrue(inPlace("https://deck.example.com:10443/"))
        XCTAssertTrue(inPlace("https://deck.example.com:10443/?p=surf"), "the page he is on stays")
        XCTAssertTrue(inPlace("https://deck.example.com:10443/?p=realestate/residential&zip=92647"), "a sheet's key stays too")
        XCTAssertTrue(inPlace("https://deck.example.com:10443/?view=tv&p=today"))
        XCTAssertFalse(inPlace("https://deck.example.com:10443/?t=abcdef12"), "a bootstrap token is never replayed")
        XCTAssertFalse(inPlace("https://deck.example.com:10443/?p=surf&t=abcdef12"))
        XCTAssertFalse(inPlace("https://deck.example.com:10443/almanac/"), "a server page goes back to the deck")
        XCTAssertFalse(inPlace("https://other.example.com:10443/?p=surf"))
        XCTAssertFalse(DeckConfig.reloadsInPlace(nil, origin: origin))
    }

    func testExplicitDefaultHTTPSPortIsTheSameOriginAsNoPort() throws {
        let origin = try XCTUnwrap(DeckConfig.parseOrigin("https://deck.example.com:443/"))
        XCTAssertTrue(DeckConfig.isDeckOrigin(URL(string: "https://deck.example.com:443/a")!, origin: origin))
        XCTAssertTrue(DeckConfig.isDeckOrigin(URL(string: "https://deck.example.com/a")!, origin: origin))
    }

    /// The root and token requests must ask the host every time, so a cached dashboard never hides a dead server.
    func testRootAndBootstrapRequestsAskTheHostAndCarryTokenOnlyInTheURL() throws {
        let origin = try XCTUnwrap(DeckConfig.parseOrigin("deck.example.com:10443"))
        let root = DeckConfig.rootRequest(origin: origin)
        XCTAssertEqual(root.url, origin)
        XCTAssertEqual(root.cachePolicy, .reloadIgnoringLocalCacheData)
        XCTAssertEqual(root.timeoutInterval, 15)

        let bootstrap = try XCTUnwrap(DeckConfig.bootstrapRequest(token: "fixture", origin: origin))
        let bootstrapURL = try XCTUnwrap(bootstrap.url)
        XCTAssertEqual(URLComponents(url: bootstrapURL, resolvingAgainstBaseURL: false)?.queryItems,
                       [URLQueryItem(name: "t", value: "fixture")])
        XCTAssertEqual(bootstrapURL.path, "/")
        XCTAssertEqual(bootstrap.cachePolicy, .reloadIgnoringLocalCacheData)
        XCTAssertEqual(bootstrap.timeoutInterval, 15)
    }

    // MARK: Live session cookie

    private func sessionCookie(name: String = "pdeck", domain: String, expires: Date? = nil) throws -> HTTPCookie {
        var properties: [HTTPCookiePropertyKey: Any] = [.name: name, .value: "fixture", .domain: domain, .path: "/"]
        if let expires { properties[.expires] = expires }
        return try XCTUnwrap(HTTPCookie(properties: properties))
    }

    func testDeckSessionCookieOnItsOwnHostIsLiveWhateverThePort() throws {
        let origin = try XCTUnwrap(DeckConfig.parseOrigin("deck.example.com:10443"))
        let cookie = try sessionCookie(domain: "deck.example.com")
        XCTAssertTrue(DeckConfig.isSessionCookie(cookie, at: origin))
    }

    func testOnlyTheCookieNamedPdeckIsTheDeckSession() throws {
        let origin = try XCTUnwrap(DeckConfig.parseOrigin("deck.example.com"))
        let other = try sessionCookie(name: "other", domain: "deck.example.com")
        XCTAssertFalse(DeckConfig.isSessionCookie(other, at: origin))
    }

    func testCookieDomainMatchesTheHostIgnoringLeadingDotAndCase() throws {
        let origin = try XCTUnwrap(DeckConfig.parseOrigin("deck.example.com"))
        let cookie = try sessionCookie(domain: ".Deck.Example.COM")
        XCTAssertTrue(DeckConfig.isSessionCookie(cookie, at: origin))
    }

    func testCookieForAnotherHostOrAHostSuffixIsNotThisDecksSession() throws {
        let origin = try XCTUnwrap(DeckConfig.parseOrigin("deck.example.com"))
        for domain in ["example.com", "other.deck.example.com", "deck.example.com.evil.test", "evil.test"] {
            let cookie = try sessionCookie(domain: domain)
            XCTAssertFalse(DeckConfig.isSessionCookie(cookie, at: origin), domain)
        }
    }

    func testExpiredSessionCookieIsNotLiveButSessionOnlyAndFutureCookiesAre() throws {
        let origin = try XCTUnwrap(DeckConfig.parseOrigin("deck.example.com"))
        let expired = try sessionCookie(domain: "deck.example.com", expires: Date(timeIntervalSinceNow: -60))
        let future = try sessionCookie(domain: "deck.example.com", expires: Date(timeIntervalSinceNow: 3600))
        let sessionOnly = try sessionCookie(domain: "deck.example.com")
        XCTAssertFalse(DeckConfig.isSessionCookie(expired, at: origin))
        XCTAssertTrue(DeckConfig.isSessionCookie(future, at: origin))
        XCTAssertTrue(DeckConfig.isSessionCookie(sessionOnly, at: origin))
    }
}
