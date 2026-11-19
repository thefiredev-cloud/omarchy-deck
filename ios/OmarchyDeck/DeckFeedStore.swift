import Foundation
import WebKit

/// Reads the native Deck sections from the selected deck. Same path as the watch actions (`DeckActionClient`):
/// a GET to the selected HTTPS origin with that origin's own `pdeck` session cookie, an ephemeral cookieless session
/// and no redirects. Only the fixed routes in `DeckFeedNames.isAllowed` are ever requested. Nothing is written to the deck.
@MainActor
final class DeckFeedStore: ObservableObject {
    @Published private(set) var states: [String: DeckFeedState] = [:]
    private weak var model: DeckModel?
    private let session: URLSession
    /// Answers belong to one origin. Switching decks drops them so a card never shows another server's data.
    private var origin: URL?
    private var inFlight: [String: Task<Void, Never>] = [:]

    init(model: DeckModel) {
        self.model = model
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.urlCache = nil
        session = URLSession(configuration: config, delegate: DeckFeedNoRedirect.shared, delegateQueue: nil)
    }

    func state(_ feed: String) -> DeckFeedState {
        states[feed] ?? .loading
    }

    /// Loads every feed of a section at once. `force` reloads feeds that already answered (pull to refresh).
    func load(_ section: DeckFeedSection, force: Bool = false) async {
        resetIfOriginChanged()
        let feeds = section.feeds.filter { feed in
            if force { return true }
            switch states[feed] {
            case .none, .failed, .notCollected, .signedOut: return true
            default: return false
            }
        }
        await withTaskGroup(of: Void.self) { group in
            for feed in feeds {
                group.addTask { await self.fetch(feed) }
            }
        }
    }

    /// Loads one fixed detail route (a surf region) once; a failed or missing answer is tried again on the next open.
    func loadDetail(_ feed: String) async {
        resetIfOriginChanged()
        guard DeckFeedNames.isAllowed(feed) else { return }
        switch states[feed] {
        case .none, .failed, .notCollected, .signedOut: await fetch(feed)
        default: return
        }
    }

    private func resetIfOriginChanged() {
        let current = model?.selectedOrigin
        if current != origin {
            origin = current
            states = [:]
            inFlight.values.forEach { $0.cancel() }
            inFlight = [:]
        }
    }

    private func fetch(_ feed: String) async {
        if let running = inFlight[feed] {
            await running.value
            return
        }
        let task = Task { await self.request(feed) }
        inFlight[feed] = task
        await task.value
        inFlight[feed] = nil
    }

    private func request(_ feed: String) async {
        guard DeckFeedNames.isAllowed(feed) else { return }
        guard let model, let origin = model.selectedOrigin, let webView = model.webView else {
            states[feed] = .signedOut
            return
        }
        if case .loaded = states[feed] {} else { states[feed] = .loading }
        let cookies = await webView.configuration.websiteDataStore.httpCookieStore.allCookies()
        guard model.selectedOrigin == origin, let cookie = cookies.first(where: { DeckConfig.isSessionCookie($0, at: origin) }) else {
            states[feed] = .signedOut
            return
        }
        guard var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false) else {
            states[feed] = .failed("The deck address is not valid.")
            return
        }
        parts.path = DeckFeedNames.path(feed)
        let query = DeckFeedNames.query(feed)
        parts.queryItems = query.isEmpty ? nil : query
        guard let url = parts.url else {
            states[feed] = .failed("The deck address is not valid.")
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = DeckFeedNames.timeout(feed)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("\(cookie.name)=\(cookie.value)", forHTTPHeaderField: "Cookie")
        let answer: DeckFeedState
        do {
            let (body, response) = try await session.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if (300..<400).contains(status) {
                // A 3xx is not followed (the cookie never goes to a redirect target): treat it as an answer we cannot read.
                answer = .failed("Your deck tried to send the app to a different address, so the app stopped.")
            } else {
                // The listings feeds are several MB: parse them off the main actor so the sheet keeps scrolling.
                answer = await Task.detached(priority: .userInitiated) {
                    DeckFeedParser.state(feed: feed, status: status, body: body)
                }.value
            }
        } catch is CancellationError {
            return
        } catch {
            answer = .failed("Could not reach your deck. Check your connection and try again.")
        }
        // The deck may have changed while the request was out.
        guard self.origin == origin else { return }
        states[feed] = answer
    }
}

/// Never forward the session cookie to a redirect target.
private final class DeckFeedNoRedirect: NSObject, URLSessionTaskDelegate {
    static let shared = DeckFeedNoRedirect()

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
