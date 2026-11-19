import Foundation
import WebKit

/// Uses the selected Pro connection's isolated WebKit cookie store; credentials stay on the phone.
@MainActor
final class DeckActionClient: DeckActionExecuting {
    private let model: DeckModel
    /// Ephemeral and cookieless: URLSession.shared would merge HTTPCookieStorage.shared cookies next to
    /// the hand-set Cookie header and a stale shared cookie could override the deck session.
    let session: URLSession

    init(model: DeckModel) {
        self.model = model
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        self.session = URLSession(configuration: config, delegate: DeckNoRedirect.shared, delegateQueue: nil)
    }

    func runAction(id: String) async throws {
        guard model.phase == .ready, let origin = model.selectedOrigin, let webView = model.webView else {
            throw WatchActionError.message(WatchActionMessage.openDeck)
        }
        let cookies = await webView.configuration.websiteDataStore.httpCookieStore.allCookies()
        guard model.selectedOrigin == origin, model.webView === webView,
              let cookie = cookies.first(where: { DeckConfig.isSessionCookie($0, at: origin) }) else {
            throw WatchActionError.message(WatchActionMessage.signIn)
        }
        guard let endpoint = WatchActionEndpoint.forAction(id) else {
            throw WatchActionError.message(WatchActionMessage.notAvailable)
        }
        // A stale watch list may still offer Lock to a guest; the deck would refuse it, so do not ask.
        if model.role == .guest, WatchAction.ownerOnlyIDs.contains(id) {
            throw WatchActionError.message(WatchActionMessage.notAllowed)
        }
        guard var url = URLComponents(url: origin, resolvingAgainstBaseURL: false) else {
            throw WatchActionError.message(WatchActionMessage.desktopUnavailable)
        }
        url.path = endpoint.path
        url.queryItems = endpoint.query.isEmpty ? nil : endpoint.query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let requestURL = url.url else {
            throw WatchActionError.message(WatchActionMessage.desktopUnavailable)
        }
        var request = URLRequest(url: requestURL)
        request.httpMethod = "POST"
        request.timeoutInterval = 12
        request.setValue("\(cookie.name)=\(cookie.value)", forHTTPHeaderField: "Cookie")
        let (body, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw WatchActionError.message(WatchActionMessage.desktopNoResponse)
        }
        guard http.statusCode == 200 else {
            throw WatchActionError.message(WatchActionMessage.failure(status: http.statusCode))
        }
        guard let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
              json["error"] == nil else { throw WatchActionError.message(WatchActionMessage.desktopFailed) }
        if json["ok"] as? Bool == false || (id == "play-pause" && json["player"] is NSNull) {
            throw WatchActionError.message("That action is not available on your desktop. Try again later.")
        }
    }
}

/// Never forward the session cookie to a redirect target.
private final class DeckNoRedirect: NSObject, URLSessionTaskDelegate {
    static let shared = DeckNoRedirect()

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
