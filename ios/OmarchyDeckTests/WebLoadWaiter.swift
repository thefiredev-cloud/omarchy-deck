import WebKit
import XCTest

/// Loads HTML into a real WKWebView and returns once the document has finished loading.
@MainActor
final class WebLoadWaiter: NSObject, WKNavigationDelegate {
    private var continuation: CheckedContinuation<Void, Never>?

    func load(html: String, in view: WKWebView, baseURL: URL = URL(string: "https://deck.test/")!) async {
        view.navigationDelegate = self
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            view.loadHTMLString(html, baseURL: baseURL)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finish() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish() }

    private func finish() {
        continuation?.resume()
        continuation = nil
    }
}

/// Polls a main-actor condition. Used where a message or task has to cross a process or actor boundary.
@MainActor
func waitUntil(timeout: TimeInterval = 5, _ condition: @MainActor () -> Bool) async -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if condition() { return true }
        try? await Task.sleep(nanoseconds: 20_000_000)
    }
    return condition()
}
