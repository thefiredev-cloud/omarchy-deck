import Foundation

/// A connection is an HTTPS origin, not an arbitrary URL or a URL containing credentials.
enum DeckConfig {

    static func parseOrigin(_ input: String) -> URL? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        // A typed host with no scheme means HTTPS. Any other scheme is still rejected below.
        if !text.isEmpty, !text.contains("://") { text = "https://" + text }
        guard let components = URLComponents(string: text), components.url != nil,
              components.scheme?.lowercased() == "https",
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              components.path.isEmpty || components.path == "/",
              components.port.map({ (1...65535).contains($0) }) ?? true
        else { return nil }
        var canonical = URLComponents()
        canonical.scheme = "https"
        canonical.host = host.lowercased()
        canonical.port = components.port == 443 ? nil : components.port
        canonical.path = "/"
        return canonical.url
    }

    /// A pasted deck link (I9). `https://deck.example.com:10443/?t=TOKEN` splits into the origin and the token, so the
    /// address field can save the deck and open it in one step. A bare address returns a nil token. Everything
    /// `parseOrigin` refuses (another scheme, a path, credentials, a fragment) stays refused; the only query allowed is
    /// one `t` that `extractToken` accepts.
    static func splitDeckLink(_ input: String) -> (origin: URL, token: String?)? {
        if let origin = parseOrigin(input) { return (origin, nil) }
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty, !text.contains("://") { text = "https://" + text }
        guard var components = URLComponents(string: text), components.fragment == nil,
              let items = components.queryItems, items.count == 1, items[0].name == "t",
              let raw = items[0].value, let token = extractToken(raw) else { return nil }
        components.queryItems = nil
        guard let address = components.string, let origin = parseOrigin(address) else { return nil }
        return (origin, token)
    }

    static func isDeckOrigin(_ url: URL, origin: URL) -> Bool {
        guard url.scheme?.lowercased() == "https", url.user == nil, url.password == nil,
              let host = url.host else { return false }
        return host.lowercased() == origin.host?.lowercased()
            && (url.port ?? 443) == (origin.port ?? 443)
    }

    /// Reload deck keeps the page he is on. The web shell writes its route into the address (`/?p=surf`,
    /// `/?p=surf&spot=salt-creek`: pixel-deck `ShellRoute`, replaced in place inside the app's web view), so the deck's
    /// root with any query reloads itself. A server page such as Almanac goes back to `/` instead (I3), and an address
    /// that still carries a `t` bootstrap token is never replayed.
    static func reloadsInPlace(_ url: URL?, origin: URL) -> Bool {
        guard let url, isDeckOrigin(url, origin: origin), url.path.isEmpty || url.path == "/" else { return false }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        return !items.contains { $0.name == "t" }
    }

    /// The one definition of a live Deck session cookie. Both the app's readiness
    /// check and the watch action client must agree, or the watch offers actions the
    /// phone will reject.
    static func isSessionCookie(_ cookie: HTTPCookie, at origin: URL) -> Bool {
        cookie.name == "pdeck" &&
            cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased() == origin.host?.lowercased() &&
            (cookie.expiresDate.map { $0 > Date() } ?? true)
    }

    /// Accepts a bare token or a pasted deck URL that carries `?t=`. Returns nil if it does not look like a token.
    static func extractToken(_ raw: String) -> String? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.contains("="), let c = URLComponents(string: s),
           let t = c.queryItems?.first(where: { $0.name == "t" })?.value {
            s = t
        } else if s.hasPrefix("t="), s.count > 2 {
            s = String(s.dropFirst(2))
        }
        let ok = s.count >= 8 && s.count <= 256
            && s.utf8.allSatisfy { ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 90) || ($0 >= 97 && $0 <= 122) || $0 == 45 || $0 == 95 }
        return ok ? s : nil
    }

    /// Runs before page scripts in the main frame. The initial HTTP request still contains ?t=.
    /// Server/proxy logs can therefore still see the token; this is not a token-free handshake.
    static let bootstrapScrubScript = """
    (() => {
        const url = new URL(window.location.href);
        if (url.pathname !== "/" || !url.searchParams.has("t")) return;
        url.searchParams.delete("t");
        history.replaceState(null, "", url.pathname + url.search + url.hash);
    })();
    """

    /// The query bootstrap contract: the initial request URL contains the token, which is held only in this request,
    /// never in preferences. The page never sees it: `bootstrapScrubScript` removes it before page scripts run.
    static func bootstrapRequest(token: String, origin: URL) -> URLRequest? {
        guard var components = URLComponents(url: origin, resolvingAgainstBaseURL: false) else { return nil }
        components.queryItems = [URLQueryItem(name: "t", value: token)]
        guard let url = components.url else { return nil }
        var r = URLRequest(url: url)
        r.timeoutInterval = 15
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }

    static func rootRequest(origin: URL) -> URLRequest {
        var r = URLRequest(url: origin)
        r.timeoutInterval = 15
        // A cached dashboard must not hide an unreachable server. Reopen and probe always ask the host.
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }
}
