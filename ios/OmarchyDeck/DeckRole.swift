import Foundation

/// Who a deck token signs this device in as. The deck answers `GET /api/whoami` with `{"role":"owner"}` or
/// `{"role":"guest"}` (pixel-deck `main.rs`, `guest.rs`). A guest may read the deck but the server refuses owner
/// actions such as Lock, so the shell names the role and the watch hides what a guest cannot run (I7, I10).
/// Foundation only, so the Linux harness tests it.
enum DeckRole: String, Equatable, CaseIterable {
    case owner
    case guest

    /// The Decks sheet row.
    var signedInLabel: String {
        switch self {
        case .owner: "Signed in as Owner"
        case .guest: "Signed in as Guest"
        }
    }

    /// The one request the shell sends: the selected origin's `/api/whoami`, the session cookie by hand and no
    /// other credential. Nil when the origin cannot carry a path.
    static func whoamiRequest(origin: URL, cookie: HTTPCookie) -> URLRequest? {
        guard var components = URLComponents(url: origin, resolvingAgainstBaseURL: false) else { return nil }
        components.path = "/api/whoami"
        components.query = nil
        guard let url = components.url else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 10
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("\(cookie.name)=\(cookie.value)", forHTTPHeaderField: "Cookie")
        return request
    }

    /// The role in a 200 answer. Anything else (a 401, `{"role":"none"}`, an unknown role, a body that is not JSON)
    /// is unknown, and the shell then says nothing rather than guess.
    static func parse(body: Data, response: URLResponse) -> DeckRole? {
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
              let name = json["role"] as? String else { return nil }
        return DeckRole(rawValue: name)
    }
}
