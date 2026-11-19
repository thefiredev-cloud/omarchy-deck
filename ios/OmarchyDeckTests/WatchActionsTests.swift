import XCTest
@testable import OmarchyDeck

@MainActor
final class WatchActionsTests: XCTestCase {
    /// Action POSTs must carry only the hand-set pdeck cookie; a shared-storage cookie must never join in.
    func testActionClientUsesAnEphemeralCookielessSession() throws {
        let suite = "WatchActions.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let model = DeckModel(defaults: defaults, startsAutomatically: false,
                              pro: ProEntitlement(startsAutomatically: false))
        let client = DeckActionClient(model: model)
        XCTAssertFalse(client.session === URLSession.shared)
        XCTAssertNil(client.session.configuration.httpCookieStorage)
        XCTAssertFalse(client.session.configuration.httpShouldSetCookies)
    }
}
