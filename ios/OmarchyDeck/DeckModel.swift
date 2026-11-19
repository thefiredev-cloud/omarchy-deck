import SwiftUI
import WebKit
import UIKit

enum DeckPhase: Equatable {
    case starting
    case needsConnection
    case needsToken(notice: String?)
    case loading
    case ready
    case offline(reason: String)
}

/// A probe only tests the saved host. Redirects must not contact another server.
private final class DeckProbeRedirectBlocker: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Coalesces estimatedProgress KVO ticks: WebKit fires many per second and each used to allocate a MainActor
/// task. The progress bar needs only the latest value, so ticks record into the box and at most one task is queued.
final class DeckProgressCoalescer: @unchecked Sendable {
    private let lock = NSLock()
    private var latest: Double?
    private var scheduled = false
    #if DEBUG
    /// Counts queued MainActor tasks; a load must not queue one per KVO tick.
    private(set) var scheduledTaskCount = 0
    #endif

    /// Records the newest value. True only when the caller must queue the apply task.
    func record(_ value: Double) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        latest = value
        guard !scheduled else { return false }
        scheduled = true
        #if DEBUG
        scheduledTaskCount += 1
        #endif
        return true
    }

    /// Hands the newest value to the queued task and opens the gate for the next tick.
    func take() -> Double? {
        lock.lock()
        defer { lock.unlock() }
        scheduled = false
        return latest
    }
}

/// Each HTTPS origin has its own persistent WebKit store; tokens are never saved in preferences.
@MainActor
final class DeckModel: NSObject, ObservableObject {
    @Published var phase: DeckPhase = .starting {
        didSet { phaseDidChange(from: oldValue) }
    }
    /// True after an offline probe gets an answer, until a later probe misses. While the scene is active the first
    /// answer of an outage reconnects by itself (`autoReconnectUsed`); otherwise the page waits for Reconnect.
    @Published private(set) var reconnectReady = false
    /// True while the page shows a same-origin path other than `/` (Almanac and other server pages). The shell then
    /// offers Back to deck beside the Decks control, because back gestures are off and the page has no way home.
    @Published private(set) var showsBackToDeck = false
    /// True while a reload, pull or page navigation runs from a showing page. The page stays visible under the
    /// 2 pt progress line instead of dropping to the dimmed picture.
    @Published private(set) var keepsPageVisible = false {
        didSet { if keepsPageVisible != oldValue { syncChrome() } }
    }
    /// Who the deck's token signs this device in as, read once per sign-in from `/api/whoami`. Nil until known.
    @Published private(set) var role: DeckRole? {
        didSet { if role != oldValue { onRoleChange?(role) } }
    }
    /// The watch bridge republishes its actions when the role changes (guests never see Lock).
    var onRoleChange: ((DeckRole?) -> Void)?
    @Published private(set) var connections: [URL] = []
    @Published private(set) var selectedOrigin: URL? {
        didSet { if selectedOrigin != oldValue { selectionDidChange() } }
    }
    @Published private(set) var isDemo = false {
        didSet { syncChrome() }
    }
    let pro: ProEntitlement
    @Published private(set) var webView: WKWebView?
    /// The Decks control and the reserved corner it publishes to the page.
    let chrome: DeckChrome
    /// Web to native haptics (`deckHaptic` message handler).
    let haptics: HapticBridge
    /// The last good picture of the selected deck, per orientation, with when it was saved. Shown dimmed while the
    /// next load runs, with its age on it.
    @Published private(set) var launchSnapshots: [DeckSnapshotStore.Shape: DeckSnapshotStore.Snapshot] = [:]
    /// WebKit's estimated load progress for the current navigation, 0...1.
    @Published private(set) var loadProgress: Double = 0
    /// Counts entries into `.ready` and into `.offline`; views play success and error feedback from them.
    @Published private(set) var readyCount = 0
    @Published private(set) var offlineCount = 0
    private let snapshots: DeckSnapshotStore
    private var snapshotTask: Task<Void, Never>?
    /// Off-main launch-picture read for the selected deck; cancelled when the pictures are discarded.
    private var snapshotPreload: Task<Void, Never>?
    private var progressObservation: NSKeyValueObservation?
    private var attemptedBootstrap = false
    /// Read-only internally so lifecycle tests can await the actual cancelled task.
    private(set) var probeTask: Task<Void, Never>?
    private var probeGeneration = 0
    private var probeFailures = 0
    /// True only when offline follows a request to the saved server. A local rule-list failure leaves this false.
    private var offlineProbesHost = false
    /// Consecutive web-content process deaths while a load was in flight. Reset once the page settles.
    private var processRestartsDuringLoad = 0
    private static let pendingRemovalsKey = "deck.pendingStoreRemovals.v1"
    private let probeSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.timeoutIntervalForRequest = 15
        return URLSession(configuration: config, delegate: DeckProbeRedirectBlocker(), delegateQueue: nil)
    }()
    /// Web to native pull to refresh (`deckRefresh` message handler). The page's root is locked, so the scroll view
    /// never overscrolls and a native refresh control on it would never fire.
    private lazy var pullRefresh = DeckPullRefreshBridge { [weak self] in self?.pullToRefresh() }
    private var urlObservation: NSKeyValueObservation?
    /// The scene is on screen. Only an active scene reconnects by itself.
    private var sceneIsActive = true
    /// One automatic Reconnect per outage. Cleared once the deck shows again, so a deck that answers the probe but
    /// keeps failing its load never loops.
    private var autoReconnectUsed = false
    private let autoReconnects: Bool
    private let whoamiResponse: (@MainActor (URLRequest) async throws -> (Data, URLResponse))?
    private var roleTask: Task<Void, Never>?
    /// The token a pasted deck link carried. Used once, on the first open of the deck it was saved with.
    private var pendingToken: (origin: URL, token: String)?
    private let savedKey = "deck.savedOrigins.v1"
    private let selectedKey = "deck.selectedOrigin.v1"
    /// Per origin: a deck added after the first migration must still get its own legacy cookie moved.
    static func legacyMigrationKey(for origin: URL) -> String {
        "deck.legacyCookieMigration.v1.\(origin.absoluteString)"
    }
    private static let storeIDsKey = "deck.originStoreIDs.v1"
    private let defaults: UserDefaults
    private let retryAction: (() -> Void)?
    private let refreshOnActivation: (() -> Void)?
    private let reconnectSleep: @MainActor (UInt64) async throws -> Void
    private let reconnectCookies: @MainActor (WKWebView?) async -> [HTTPCookie]?
    private let reconnectResponse: (@MainActor (URLRequest) async throws -> URLResponse)?
    private let sessionRemoval: @MainActor (WKWebsiteDataStore) async -> Void
    private var storeIDs: [String: String]
    private var webViewOrigin: URL?
    private var originRulesInstalled = false
    private let loadGeneration = W3DeckLoadGeneration()
    private let loadSleep: @MainActor (UInt64) async throws -> Void
    private let loadNavigation: @MainActor (WKWebView, URLRequest) -> WKNavigation?
    private var loadTimeoutNanoseconds: UInt64
    private var openGeneration: UInt64 = 0
    private var replacesWebViewOnOpen = false

    /// Defaults preserve app startup. Tests may disable the initial migration/load task,
    /// supply an inert ProEntitlement, and replace retry dispatch and activation refresh
    /// to exercise scene wiring without WebKit loads or StoreKit requests. Reconnect
    /// I/O seams step the real loop; defaults keep the timer, WebKit store and headers-only request.
    /// `whoamiResponse` replaces the `/api/whoami` transport; nil uses the cookieless probe session.
    init(defaults: UserDefaults = .standard, startsAutomatically: Bool = true,
         pro: ProEntitlement? = nil, retryAction: (() -> Void)? = nil,
         refreshOnActivation: (() -> Void)? = nil,
         snapshots: DeckSnapshotStore? = nil,
         chrome: DeckChrome? = nil,
         haptics: HapticBridge? = nil,
         reconnectSleep: @escaping @MainActor (UInt64) async throws -> Void = { try await Task.sleep(nanoseconds: $0) },
         reconnectCookies: @escaping @MainActor (WKWebView?) async -> [HTTPCookie]? = { view in
             guard let view else { return nil }
             return await view.configuration.websiteDataStore.httpCookieStore.allCookies()
         },
         reconnectResponse: (@MainActor (URLRequest) async throws -> URLResponse)? = nil,
         sessionRemoval: @escaping @MainActor (WKWebsiteDataStore) async -> Void = { store in
             await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
         },
         loadSleep: @escaping @MainActor (UInt64) async throws -> Void = { try await Task.sleep(nanoseconds: $0) },
         loadNavigation: @escaping @MainActor (WKWebView, URLRequest) -> WKNavigation? = { $0.load($1) },
         whoamiResponse: (@MainActor (URLRequest) async throws -> (Data, URLResponse))? = nil) {
        self.defaults = defaults
        self.pro = pro ?? ProEntitlement(startsAutomatically: false)
        self.retryAction = retryAction
        self.refreshOnActivation = refreshOnActivation
        self.reconnectSleep = reconnectSleep
        self.reconnectCookies = reconnectCookies
        self.reconnectResponse = reconnectResponse
        self.sessionRemoval = sessionRemoval
        self.loadSleep = loadSleep
        self.loadNavigation = loadNavigation
        self.whoamiResponse = whoamiResponse
        #if DEBUG
        // The Deck is back banner suite keeps the manual Reconnect path on screen; every other run reconnects by itself.
        autoReconnects = !ProcessInfo.processInfo.arguments.contains("-deck-no-auto-reconnect")
        #else
        autoReconnects = true
        #endif
        #if DEBUG
        // A one-second deadline is available only for the isolated simulator fixture flow. It covers the first
        // armed load of a launch (the stalled one); Retry then gets the production deadline.
        loadTimeoutNanoseconds = ProcessInfo.processInfo.arguments.contains("-deck-watchdog-short-deadline")
            ? 1_000_000_000 : W3DeckLoadGeneration.timeoutNanoseconds
        #else
        loadTimeoutNanoseconds = W3DeckLoadGeneration.timeoutNanoseconds
        #endif
        storeIDs = defaults.dictionary(forKey: DeckModel.storeIDsKey) as? [String: String] ?? [:]
        self.snapshots = snapshots ?? DeckSnapshotStore()
        self.chrome = chrome ?? DeckChrome()
        self.haptics = haptics ?? HapticBridge()
        super.init()
        self.chrome.onReserveChange = { [weak self] points in
            guard let self, let view = self.webView else { return }
            ShellReserve.install(points: points, in: view)
        }
        loadConnections()
        // A saved deck relaunches into `.loading` (`deck.loading`), not `.starting`. Starting and loading
        // share one backdrop view, so flipping the identifier after cookies/rules can leave XCTest seeing
        // neither; the first paint must already be the loading backdrop the delayed-503 test looks for.
        // Only when this instance will actually open the deck. A locked or test model that never
        // starts must not sit on "Loading deck" forever.
        if startsAutomatically, selectedOrigin != nil { phase = .loading }
        if startsAutomatically { Task { await start() } }
    }

    deinit {
        probeTask?.cancel()
        snapshotTask?.cancel()
        probeSession.invalidateAndCancel()
    }

    private func store(for origin: URL) -> WKWebsiteDataStore {
        let key = origin.absoluteString
        let identifier: UUID
        if let saved = storeIDs[key], let existing = UUID(uuidString: saved) {
            identifier = existing
        } else {
            identifier = UUID()
            storeIDs[key] = identifier.uuidString
            defaults.set(storeIDs, forKey: Self.storeIDsKey)
        }
        return WKWebsiteDataStore(forIdentifier: identifier)
    }

    /// A removed origin's WebKit store, still owed a data wipe.
    private struct DetachedStore {
        let store: WKWebsiteDataStore
        let identifier: String
    }

    /// Detach before awaiting deletion so re-adding the origin cannot inherit or lose its new session.
    /// The identifier is queued in preferences BEFORE the origin's store mapping is dropped and stays queued
    /// until the wipe finishes, so an app exit at any point cannot leave a removed deck's signed-in session
    /// on disk with no saved reference to it. A crash between the two writes leaves the id both queued and
    /// mapped; the launch purge then only dequeues it, and the origin (not yet unsaved) keeps its store.
    private func detachStore(for origin: URL) -> DetachedStore? {
        guard let saved = storeIDs[origin.absoluteString] else { return nil }
        guard let identifier = UUID(uuidString: saved) else {
            storeIDs.removeValue(forKey: origin.absoluteString)
            defaults.set(storeIDs, forKey: Self.storeIDsKey)
            return nil
        }
        var pending = defaults.stringArray(forKey: Self.pendingRemovalsKey) ?? []
        if !pending.contains(saved) {
            pending.append(saved)
            defaults.set(pending, forKey: Self.pendingRemovalsKey)
        }
        storeIDs.removeValue(forKey: origin.absoluteString)
        defaults.set(storeIDs, forKey: Self.storeIDsKey)
        if webViewOrigin == origin, let webView {
            return DetachedStore(store: webView.configuration.websiteDataStore, identifier: saved)
        }
        return DetachedStore(store: WKWebsiteDataStore(forIdentifier: identifier), identifier: saved)
    }

    private func dequeueRemoval(_ identifier: String) {
        let pending = (defaults.stringArray(forKey: Self.pendingRemovalsKey) ?? []).filter { $0 != identifier }
        if pending.isEmpty { defaults.removeObject(forKey: Self.pendingRemovalsKey) }
        else { defaults.set(pending, forKey: Self.pendingRemovalsKey) }
    }

    private func forgetRemoved(_ detached: DetachedStore) async {
        await sessionRemoval(detached.store)
        // The origin rules compiled for that store are of no further use.
        try? await WKContentRuleListStore.default().removeContentRuleList(forIdentifier: "deck-origin-\(detached.identifier)")
        dequeueRemoval(detached.identifier)
    }

    /// Finishes wipes a previous launch started and never completed. Identifiers still mapped to a saved
    /// origin are never wiped; they are only dropped from the queue.
    func purgePendingSessionRemovals() async {
        let pending = defaults.stringArray(forKey: Self.pendingRemovalsKey) ?? []
        for identifier in pending {
            guard !storeIDs.values.contains(identifier) else { dequeueRemoval(identifier); continue }
            if let uuid = UUID(uuidString: identifier) {
                await forgetRemoved(DetachedStore(store: WKWebsiteDataStore(forIdentifier: uuid), identifier: identifier))
            } else {
                dequeueRemoval(identifier)
            }
        }
    }

    private func discardWebView() {
        stopReconnectProbe()
        cancelUserLoad()
        openGeneration += 1
        progressObservation = nil
        urlObservation = nil
        showsBackToDeck = false
        loadProgress = 0
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        webView?.uiDelegate = nil
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: HapticBridge.handlerName)
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: DeckPullRefresh.handlerName)
        webView = nil
        webViewOrigin = nil
        originRulesInstalled = false
    }

    /// One background everywhere: page, scroll view, rubber band and the area under the page are the web `--bg`.
    /// The page owns the safe area: it reads env(safe-area-inset-*) under viewport-fit=cover, so WebKit's own
    /// inset adjustment stays off and ContentView lays the view out full-bleed.
    static func applyChrome(to view: WKWebView) {
        view.isOpaque = false
        view.backgroundColor = DeckColors.uiBackground
        view.underPageBackgroundColor = DeckColors.uiBackground
        view.scrollView.backgroundColor = DeckColors.uiBackground
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.scrollView.bounces = true
    }

    private func prepareWebView(for origin: URL) -> WKWebView {
        if webViewOrigin == origin, let webView { return webView }
        discardWebView()
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = store(for: origin)
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.defaultWebpagePreferences.allowsContentJavaScript = true
        cfg.applicationNameForUserAgent = "OmarchyDeck/\(AppVersion.marketingVersion)"
        // The one-time ?t= token is removed from the page URL before any page script can read it.
        cfg.userContentController.addUserScript(WKUserScript(
            source: DeckConfig.bootstrapScrubScript,
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.userContentController.addUserScript(WKUserScript(
            source: PadKeyboardFocus.script,
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // Pull to refresh lives in the page: its root is locked, so the scroll view never overscrolls (I2).
        cfg.userContentController.addUserScript(WKUserScript(
            source: DeckPullRefresh.script,
            injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        // WebKit holds its message handlers strongly; the proxy holds the bridge weakly.
        cfg.userContentController.add(WeakScriptMessageHandler(haptics), name: HapticBridge.handlerName)
        cfg.userContentController.add(WeakScriptMessageHandler(pullRefresh), name: DeckPullRefresh.handlerName)
        let view = WKWebView(frame: .zero, configuration: cfg)
        view.navigationDelegate = self
        view.uiDelegate = self
        view.allowsBackForwardNavigationGestures = false
        view.allowsLinkPreview = false
        // Command F and the page's own find bar both use the system find navigator.
        view.isFindInteractionEnabled = true
        Self.applyChrome(to: view)
        #if DEBUG
        view.isInspectable = true
        #endif
        // Back to deck follows every committed URL, including history.pushState inside the page.
        urlObservation = view.observe(\.url, options: [.new]) { [weak self] view, _ in
            Task { @MainActor in
                guard let self, self.webView === view else { return }
                let away = Self.isAwayFromDeckRoot(view.url, origin: self.selectedOrigin)
                if self.showsBackToDeck != away { self.showsBackToDeck = away }
            }
        }
        let two = UITapGestureRecognizer(target: self, action: #selector(twoFingerTap))
        two.numberOfTouchesRequired = 2
        two.numberOfTapsRequired = 2
        two.cancelsTouchesInView = false
        two.delegate = self
        view.addGestureRecognizer(two)
        let band = UITapGestureRecognizer(target: self, action: #selector(bandTapped(_:)))
        band.cancelsTouchesInView = false
        band.delegate = self
        view.addGestureRecognizer(band)
        ShellReserve.install(points: chrome.reservedPoints, in: view)
        webViewOrigin = origin
        webView = view
        return view
    }

    private func isCurrent(_ view: WKWebView, origin: URL) -> Bool {
        webView === view && selectedOrigin == origin
    }

    private func loadConnections() {
        let strings = defaults.stringArray(forKey: savedKey) ?? []
        connections = Array(Set(strings.compactMap(DeckConfig.parseOrigin))).sorted { $0.absoluteString < $1.absoluteString }
        if let saved = defaults.string(forKey: selectedKey),
           let origin = DeckConfig.parseOrigin(saved), connections.contains(origin) {
            selectedOrigin = origin
        } else {
            selectedOrigin = connections.first
        }
    }

    private func persistConnections() {
        defaults.set(connections.map(\.absoluteString), forKey: savedKey)
        defaults.set(selectedOrigin?.absoluteString, forKey: selectedKey)
    }

    private func start() async {
        await purgePendingSessionRemovals()
        await openSelected()
    }

    /// Move only the cookie for an origin the customer explicitly selected.
    /// Cookie domains do not encode ports, so discovery must never select a server for them.
    private func migrateLegacyCookie(for origin: URL) async {
        let flag = Self.legacyMigrationKey(for: origin)
        guard !defaults.bool(forKey: flag) else { return }
        let previous = WKWebsiteDataStore.default().httpCookieStore
        let cookies = await previous.allCookies()
        guard selectedOrigin == origin else { return }
        let matching = cookies.filter { isSessionCookie($0, at: origin) }
        guard !matching.isEmpty else { return }
        let destination = store(for: origin).httpCookieStore
        for cookie in matching {
            await destination.setCookie(cookie)
            await previous.deleteCookie(cookie)
        }
        defaults.set(true, forKey: flag)
    }

    func beginDemo() {
        guard !isDemo else { return }
        discardWebView()
        isDemo = true
        phase = selectedOrigin == nil ? .needsConnection : .starting
    }

    func endDemo() {
        guard isDemo else { return }
        isDemo = false
        if selectedOrigin == nil { phase = .needsConnection }
        else { Task { await openSelected() } }
    }

    func didBecomeActive() {
        sceneIsActive = true
        guard !isDemo else { return }
        if selectedOrigin != nil { pro.start() }
        if let refreshOnActivation {
            refreshOnActivation()
        } else if selectedOrigin != nil {
            Task {
                await pro.refresh()
                if pro.product == nil { await pro.loadProduct() }
            }
        }
        if Self.shouldRetryOnActivation(phase: phase) { retry() }
    }

    /// The scene left the screen (app switcher, lock, another app). A probe answer then waits for the next activation,
    /// which retries an offline deck by itself.
    func didResignActive() {
        sceneIsActive = false
    }

    /// INTENT (I1): a wall-mounted iPad must come back after a server restart with no tap. The first probe answer of
    /// an outage, while the scene is on screen, runs Reconnect once. A later answer in the same outage only shows the
    /// banner, so a deck that answers the probe but keeps failing its load never loops.
    nonisolated static func shouldAutoReconnect(answered: Bool, sceneIsActive: Bool, alreadyUsed: Bool,
                                                enabled: Bool) -> Bool {
        answered && sceneIsActive && !alreadyUsed && enabled
    }

    /// True for a same-origin page other than the deck's root, such as `/almanac/`. Query-only changes at `/` stay home.
    nonisolated static func isAwayFromDeckRoot(_ url: URL?, origin: URL?) -> Bool {
        guard let url, let origin, DeckConfig.isDeckOrigin(url, origin: origin) else { return false }
        return !(url.path.isEmpty || url.path == "/")
    }

    /// INTENT: the app retries by itself whenever the scene returns to active while offline (after Control Center,
    /// Notification Center, Settings or the app switcher covered it), so the dashboard may load without the
    /// Deck is back banner. The tester notes must say so. Only an offline phase retries; every other phase is left alone.
    nonisolated static func shouldRetryOnActivation(phase: DeckPhase) -> Bool {
        if case .offline = phase { return true }
        return false
    }

    private func isSessionCookie(_ cookie: HTTPCookie, at origin: URL) -> Bool {
        DeckConfig.isSessionCookie(cookie, at: origin)
    }

    private func hasSavedSession(in view: WKWebView, at origin: URL) async -> Bool {
        let cookies = await view.configuration.websiteDataStore.httpCookieStore.allCookies()
        return cookies.contains { isSessionCookie($0, at: origin) }
    }

    /// Default-deny all WebKit resources, then exempt the selected HTTPS authority.
    private func installOriginRules(for origin: URL, in view: WKWebView) async -> Bool {
        guard let storeID = storeIDs[origin.absoluteString] else { return false }
        let host = NSRegularExpression.escapedPattern(for: origin.host ?? "")
        let authority = origin.port.map { "\(host):\($0)" } ?? "\(host)(:443)?"
        let rules: [[String: [String: String]]] = [
            ["trigger": ["url-filter": ".*"], "action": ["type": "block"]],
            ["trigger": ["url-filter": "^https://\(authority)/"], "action": ["type": "ignore-previous-rules"]],
            ["trigger": ["url-filter": "^wss://\(authority)/"], "action": ["type": "ignore-previous-rules"]]
        ]
        do {
            let encoded = try JSONSerialization.data(withJSONObject: rules)
            let list = try await WKContentRuleListStore.default().compileContentRuleList(
                forIdentifier: "deck-origin-\(storeID)", encodedContentRuleList: String(decoding: encoded, as: UTF8.self))
            guard isCurrent(view, origin: origin) else { return false }
            guard let list else {
                showRuleInstallOffline()
                return false
            }
            view.configuration.userContentController.add(list)
            originRulesInstalled = true
            return true
        } catch {
            if isCurrent(view, origin: origin) { showRuleInstallOffline() }
            return false
        }
    }

    private func openSelected() async {
        openGeneration += 1
        cancelUserLoad()
        attemptedBootstrap = false
        guard let origin = selectedOrigin else {
            discardWebView()
            phase = .needsConnection
            return
        }
        guard !isDemo else {
            if phase == .loading { phase = .starting }
            return
        }
        if replacesWebViewOnOpen {
            // Response-policy callbacks carry no WKNavigation identity. A retry therefore gets a fresh
            // view, while retaining this origin's store, so an expired response cannot affect the retry.
            discardWebView()
            replacesWebViewOnOpen = false
        }
        let view = prepareWebView(for: origin)
        let generation = openGeneration
        await migrateLegacyCookie(for: origin)
        guard generation == openGeneration, isCurrent(view, origin: origin), !isDemo else { return }
        view.stopLoading()
        // Stay on `.loading` while rules and cookies are read so the backdrop keeps `deck.loading`.
        // `.starting` here reused that view under `deck.starting` and hid the loading identifier.
        phase = .loading
        if !originRulesInstalled {
            guard await installOriginRules(for: origin, in: view) else { return }
            guard generation == openGeneration, !isDemo else { return }
        }
        let authenticated = await hasSavedSession(in: view, at: origin)
        guard generation == openGeneration, isCurrent(view, origin: origin), !isDemo else { return }
        if let pending = pendingToken, pending.origin == origin {
            // A pasted deck link carried its token: open with it straight away, as if typed on the token screen.
            pendingToken = nil
            phase = .needsToken(notice: nil)
            submit(token: pending.token)
        } else if authenticated {
            phase = .loading
            beginUserLoad(DeckConfig.rootRequest(origin: origin), in: view)
        } else {
            phase = .needsToken(notice: nil)
        }
    }

    /// Free can replace its one connection. Only verified Pro can add another or switch.
    /// A full deck link (`https://host:port/?t=TOKEN`) saves the address and opens it with that token in one step;
    /// the token is held in memory for that one open and never written to preferences.
    @discardableResult
    func saveConnection(_ input: String, replacing: Bool = false) -> String? {
        guard let link = DeckConfig.splitDeckLink(input) else {
            return "Enter your server's HTTPS address, like https://deck.example.com:10443/, with no path or token."
        }
        let origin = link.origin
        var removed: URL?
        if !connections.contains(origin) {
            if replacing, let old = selectedOrigin {
                guard connections.count == 1 || pro.isPro else { return "Restore Pro to change your locked decks." }
                connections.removeAll { $0 == old }
                removed = old
            } else if !connections.isEmpty && !pro.isPro {
                return "Free includes one deck. Replace it, or unlock Pro to add another."
            }
            connections.append(origin)
            // loadConnections sorts by address; keep the in-memory order identical so rows do not reshuffle on relaunch.
            connections.sort { $0.absoluteString < $1.absoluteString }
        } else if origin != selectedOrigin && !pro.isPro {
            return "Restore Pro to switch decks."
        }
        let removedStore = removed.flatMap { detachStore(for: $0) }
        if let removed { snapshots.remove(origin: removed) }
        selectedOrigin = origin
        pendingToken = link.token.map { (origin, $0) }
        pro.start()
        if webViewOrigin != origin { discardWebView() }
        phase = .starting
        persistConnections()
        Task {
            if let removedStore { await forgetRemoved(removedStore) }
            await openSelected()
        }
        return nil
    }

    func removeConnection(_ origin: URL) {
        guard connections.contains(origin) else { return }
        let removedStore = detachStore(for: origin)
        snapshots.remove(origin: origin)
        let selected = selectedOrigin == origin
        connections.removeAll { $0 == origin }
        if selected {
            selectedOrigin = connections.first
            discardWebView()
            phase = selectedOrigin == nil ? .needsConnection : .starting
        }
        persistConnections()
        Task {
            if let removedStore { await forgetRemoved(removedStore) }
            if selected { await openSelected() }
        }
    }

    private func forgetSession(in store: WKWebsiteDataStore) async {
        await sessionRemoval(store)
    }

    func select(_ origin: URL) {
        guard connections.contains(origin),
              Self.mayActivate(origin, selected: selectedOrigin, isPro: pro.isPro) else { return }
        guard selectedOrigin != origin else { return }
        selectedOrigin = origin
        discardWebView()
        phase = .starting
        persistConnections()
        Task { await openSelected() }
    }

    /// Shift Command [ and ]: the saved deck before or after the current one, wrapping. `select` keeps the Pro rule.
    func selectNeighbor(step: Int) {
        guard let origin = DeckCycle.neighbor(of: selectedOrigin, in: connections, step: step) else { return }
        select(origin)
    }

    /// Command 1 to 9: the saved deck at that place in the Decks list.
    func openDeck(number: Int) {
        guard let origin = DeckCycle.deck(number: number, in: connections) else { return }
        select(origin)
    }

    /// Command F: the system find bar over the page. Only a shown page has anything to find.
    func findOnPage() {
        guard phase == .ready, !isDemo, let webView else { return }
        webView.findInteraction?.presentFindNavigator(showingReplace: false)
    }

    /// Command [ and ]: the deck page before or after the one showing, wrapping at the ends. The page holds its
    /// own list of pages, so the shell presses its next tab rather than keeping a copy that could drift.
    func stepPage(_ step: Int) {
        guard phase == .ready, !isDemo, step != 0, let webView else { return }
        webView.evaluateJavaScript(DeckPageNav.stepScript(step), completionHandler: nil)
    }

    /// The demo's Connect sheet saves the address and leaves the demo in one step. A refused address keeps the demo.
    /// `saveConnection` opens the deck from a task that runs after this returns, so it sees the demo already over.
    @discardableResult
    func saveConnectionLeavingDemo(_ input: String, replacing: Bool = false) -> String? {
        let notice = saveConnection(input, replacing: replacing)
        if notice == nil, isDemo { isDemo = false }
        return notice
    }

    /// INTENT (README "Free and Pro"): revocation locks the other saved decks and keeps the current one usable.
    /// One predicate decides it for the Decks row tap and for `select`, so the view and the model cannot drift.
    nonisolated static func mayActivate(_ origin: URL, selected: URL?, isPro: Bool) -> Bool {
        origin == selected || isPro
    }

    /// The lock sentence belongs to the row the tester tapped, only while that row is still locked.
    nonisolated static func showsLockNotice(tapped: URL?, row: URL, selected: URL?, isPro: Bool) -> Bool {
        tapped == row && !mayActivate(row, selected: selected, isPro: isPro)
    }

    func submit(token raw: String) {
        guard let origin = selectedOrigin, let webView, originRulesInstalled else {
            // Never swallow a submit: the token field was cleared, so say why nothing happened.
            if case .needsToken = phase { phase = .needsToken(notice: "The deck is not ready yet. Try again in a moment.") }
            return
        }
        guard let token = DeckConfig.extractToken(raw) else {
            phase = .needsToken(notice: "That does not look like a deck token. Check it for a missing character.")
            return
        }
        guard let request = DeckConfig.bootstrapRequest(token: token, origin: origin) else {
            phase = .needsToken(notice: "This deck's address could not be used. Check it in Decks.")
            return
        }
        // Set before the load starts: the 401 policy reads it to choose the notice.
        attemptedBootstrap = true
        // A new sign-in may carry another role (a guest token replaced by the owner's), so read it again once ready.
        resetRole()
        beginUserLoad(request, in: webView)
    }

    func retry() {
        if let retryAction {
            retryAction()
            return
        }
        guard !isDemo, phase != .starting, phase != .loading else { return }
        phase = .starting
        Task { await openSelected() }
    }

    func signOut() async {
        guard let origin = selectedOrigin else { return }
        let view = webView
        view?.stopLoading()
        cancelUserLoad()
        openGeneration += 1
        phase = .starting
        // Delete the captured origin's picture before yielding. A later switch must not bypass its cleanup,
        // nor let the old sign-out task clear the newly selected origin's picture.
        snapshots.remove(origin: origin)
        launchSnapshots = [:]
        // The session lives in the origin's own WebKit store, which exists even when no web view is alive.
        // This used to return early without a live view and left the signed-in cookie on disk.
        if let saved = storeIDs[origin.absoluteString], let identifier = UUID(uuidString: saved) {
            await forgetSession(in: WKWebsiteDataStore(forIdentifier: identifier))
        }
        guard selectedOrigin == origin, webView === view else { return }
        phase = .needsToken(notice: nil)
    }

    @objc private func twoFingerTap() { reload() }

    /// Reload deck, Command R, two-finger double tap and pull. The page stays on screen under the progress line.
    func reload() {
        guard phase == .ready else { retry(); return }
        guard let origin = selectedOrigin, let webView else { return }
        keepsPageVisible = true
        phase = .loading
        let ticket = armUserLoad(in: webView)
        let navigation: WKNavigation?
        // Reload deck means the page he is on: the deck's root with its route query (`/?p=surf`) reloads itself; a server
        // page such as Almanac, or an address that still holds a `t` token, goes back to `/` (I3, DeckConfig.reloadsInPlace).
        if DeckConfig.reloadsInPlace(webView.url, origin: origin) {
            navigation = webView.reload()
        } else {
            navigation = loadNavigation(webView, DeckConfig.rootRequest(origin: origin))
        }
        loadGeneration.bind(navigation: navigation, to: ticket)
    }

    /// Back to deck: from a same-origin server page (Almanac) to the deck's root, keeping the page on screen.
    func backToDeck() {
        guard phase == .ready, !isDemo, let origin = selectedOrigin, let webView else { return }
        beginUserLoad(DeckConfig.rootRequest(origin: origin), in: webView)
    }

    /// The page's own pull gesture (`deckRefresh`). Only a showing page reloads; a pull during a load is ignored.
    func pullToRefresh() {
        guard phase == .ready, !isDemo else { return }
        reload()
    }

    private func phaseDidChange(from old: DeckPhase) {
        if phase != .loading { cancelUserLoad() }
        if phase != .loading, keepsPageVisible { keepsPageVisible = false }
        syncChrome()
        // Only a load that never settles counts toward the crash-loop limit.
        if phase != .loading && phase != .starting { processRestartsDuringLoad = 0 }
        switch phase {
        case .ready:
            if old != .ready { readyCount += 1 }
            // The deck is showing again: the next outage gets its own automatic Reconnect.
            autoReconnectUsed = false
            scheduleSnapshot()
            fetchRoleIfNeeded()
        case .offline:
            if case .offline = old {} else { offlineCount += 1 }
            snapshotTask?.cancel()
        case .needsToken:
            // Signed out or never signed in: the last picture of the deck is no longer the customer's to see.
            snapshotTask?.cancel()
            discardSnapshots()
            resetRole()
        default:
            snapshotTask?.cancel()
        }
        switch phase {
        case .offline:
            // A later miss while already offline must not restart the probe. Restarting would reset the backoff.
            if case .offline = old { return }
            reconnectReady = false
            if offlineProbesHost {
                startReconnectProbe()
            } else {
                stopReconnectProbe()
            }
        default:
            if case .offline = old {
                stopReconnectProbe()
                reconnectReady = false
            }
        }
    }

    private func selectionDidChange() {
        cancelUserLoad()
        resetRole()
        openGeneration += 1
        let generation = openGeneration
        launchSnapshots = [:]
        snapshotPreload?.cancel()
        snapshotPreload = nil
        if let origin = selectedOrigin {
            // Reading and checking two JPEG files must not hitch the deck switch tap.
            snapshotPreload = Task.detached(priority: .userInitiated) { [weak self, snapshots] in
                let found = snapshots.snapshots(for: origin)
                await MainActor.run {
                    guard !Task.isCancelled, let self, self.openGeneration == generation,
                          self.selectedOrigin == origin else { return }
                    self.launchSnapshots = found
                }
            }
        }
        syncChrome()
    }

    private func syncChrome() {
        // An in-place reload keeps the page on screen, so the Decks control keeps its page behaviour too.
        chrome.update(present: selectedOrigin != nil && !isDemo, contentReady: phase == .ready || keepsPageVisible)
    }

    /// Forgets the role so the next ready reads `/api/whoami` again.
    private func resetRole() {
        roleTask?.cancel()
        roleTask = nil
        role = nil
    }

    /// Reads `/api/whoami` once per sign-in, with the origin's session cookie and nothing else (no redirects,
    /// no shared cookie jar). A failure leaves the role unknown; the Decks sheet then says nothing about it.
    private func fetchRoleIfNeeded() {
        guard role == nil, roleTask == nil, !isDemo, let origin = selectedOrigin, let view = webView else { return }
        let generation = openGeneration
        roleTask = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { if self.openGeneration == generation { self.roleTask = nil } }
            let cookies = await view.configuration.websiteDataStore.httpCookieStore.allCookies()
            guard !Task.isCancelled, self.openGeneration == generation, self.selectedOrigin == origin,
                  let session = cookies.first(where: { self.isSessionCookie($0, at: origin) }),
                  let request = DeckRole.whoamiRequest(origin: origin, cookie: session) else { return }
            let answer: (Data, URLResponse)
            do {
                if let whoamiResponse = self.whoamiResponse {
                    answer = try await whoamiResponse(request)
                } else {
                    answer = try await self.probeSession.data(for: request)
                }
            } catch { return }
            guard !Task.isCancelled, self.openGeneration == generation, self.selectedOrigin == origin else { return }
            self.role = DeckRole.parse(body: answer.0, response: answer.1)
        }
    }

    @objc private func bandTapped(_ gesture: UITapGestureRecognizer) {
        guard let view = gesture.view else { return }
        if DeckChrome.isRevealTouch(y: gesture.location(in: view).y, safeAreaTop: view.safeAreaInsets.top) {
            chrome.reveal()
        }
    }

    private func discardSnapshots() {
        snapshotPreload?.cancel()
        snapshotPreload = nil
        if let origin = selectedOrigin { snapshots.remove(origin: origin) }
        if !launchSnapshots.isEmpty { launchSnapshots = [:] }
    }

    /// Waits for the page to paint, then keeps a picture of it for the next launch.
    private func scheduleSnapshot() {
        snapshotTask?.cancel()
        snapshotTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            guard !Task.isCancelled else { return }
            await self?.captureSnapshot()
        }
    }

    /// Keeps a picture of the deck on screen. Called after the page settles and as the app leaves the foreground.
    func captureSnapshot() async {
        guard phase == .ready, !isDemo, let view = webView, let origin = selectedOrigin,
              isCurrent(view, origin: origin), view.window != nil, view.bounds.width > 0 else { return }
        let configuration = WKSnapshotConfiguration()
        // Full view width at the screen's scale, so an iPad's picture is sharp (I16); the policy caps the pixels.
        let scale = view.window?.screen.scale ?? view.traitCollection.displayScale
        let width = W3SnapshotPolicy.captureWidthPoints(viewWidth: Double(view.bounds.width),
                                                        viewHeight: Double(view.bounds.height), scale: Double(scale))
        configuration.snapshotWidth = NSNumber(value: width)
        let shape = DeckSnapshotStore.shape(of: view.bounds.size)
        guard let image = try? await view.takeSnapshot(configuration: configuration),
              let data = W3SnapshotPolicy.jpegQualities.lazy.compactMap({ image.jpegData(compressionQuality: CGFloat($0)) })
                .first(where: { $0.count <= W3SnapshotPolicy.maxByteCount }) else { return }
        // A sign-out, deck switch or reload may have happened while WebKit drew.
        guard phase == .ready, isCurrent(view, origin: origin) else { return }
        snapshots.save(jpeg: data, for: origin, shape: shape)
        launchSnapshots[shape] = DeckSnapshotStore.Snapshot(image: image, savedAt: Date())
    }

    /// Waits before each offline probe, in milliseconds. Index 0 is the first wait. A successful probe resets the count to 0;
    /// `reconnectWaitNanoseconds` holds the wait while the banner is up.
    /// A miss uses the next step. The last step repeats.
    nonisolated static let reconnectProbeDelayMilliseconds = [1_200, 2_000, 3_500, 5_000]

    nonisolated static func reconnectProbeDelayNanoseconds(afterFailures failures: Int) -> UInt64 {
        let steps = reconnectProbeDelayMilliseconds
        let index = min(max(failures, 0), steps.count - 1)
        return UInt64(steps[index]) * 1_000_000
    }

    /// The wait before the next probe. While the banner says the deck answered, it holds at the last step.
    /// Without that hold a reachable server gets a probe every 1.2s for as long as the offline screen stays up.
    /// A miss still clears the banner, within that last step.
    nonisolated static func reconnectWaitNanoseconds(afterFailures failures: Int, reconnectReady: Bool) -> UInt64 {
        reconnectProbeDelayNanoseconds(afterFailures: reconnectReady ? reconnectProbeDelayMilliseconds.count - 1 : failures)
    }

    /// INTENT: 688f4c1 refuses redirects, so a same-origin 3xx is the saved server's own answer.
    /// The public pdeck server returns 200 for an authenticated GET / and 401 without a cookie.
    /// Its notes say not to redirect to another host or port. The fixture returns 200 when up and 503 when held.
    /// A same-origin 3xx still proves that server answered. An off-origin Location or a 5xx stays a miss.
    /// The probe never follows the redirect.
    /// A successful probe passes 0 into the delay function. A miss adds one.
    nonisolated static func reconnectProbeFailures(after failures: Int, succeeded: Bool) -> Int {
        if succeeded { return 0 }
        return max(failures, 0) + 1
    }

    /// True when the saved server answered. 2xx and 4xx are answers. A 3xx is an answer only when
    /// Location stays on that origin. An off-origin Location is a miss. 5xx is a miss.
    /// The public pdeck server returns 200 or 401, never a 3xx, and its notes say not to redirect
    /// to another host or port. A 3xx with no Location is not a saved-server answer we can check,
    /// so it is a miss. That also covers a captive portal or proxy that answers 3xx without naming
    /// this origin.
    nonisolated static func probeAnswerIsAlive(statusCode: Int?, location: String?, origin: URL) -> Bool {
        guard let statusCode else { return false }
        if statusCode < 300 || (400..<500).contains(statusCode) { return true }
        guard (300..<400).contains(statusCode) else { return false }
        return redirectStaysOnOrigin(location, origin: origin)
    }

    /// Relative and absolute Locations must resolve to the saved HTTPS origin, including its port.
    /// An empty Location is a miss. A trailing-dot host is the same DNS name, but it is not the
    /// saved origin string, so it is a miss on purpose.
    nonisolated static func redirectStaysOnOrigin(_ location: String?, origin: URL) -> Bool {
        let raw = location?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if raw.isEmpty { return false }
        guard let target = URL(string: raw, relativeTo: origin)?.absoluteURL,
              target.scheme != nil, target.host != nil else { return false }
        return DeckConfig.isDeckOrigin(target, origin: origin)
    }

    /// Header read for the probe. Must use the case-insensitive Location lookup.
    /// A direct allHeaderFields["Location"] read would miss a lowercase location key.
    nonisolated static func probeHeaderFields(from response: HTTPURLResponse) -> (statusCode: Int, location: String?) {
        (response.statusCode, response.value(forHTTPHeaderField: "Location"))
    }

    /// The loop's response-classification boundary. Inject only the header read so tests can
    /// prove both fields reach the redirect policy without a live URLSession or WebView.
    nonisolated static func probeResponseIsAlive(
        _ response: URLResponse, origin: URL,
        readHeaders: (HTTPURLResponse) -> (statusCode: Int, location: String?) = DeckModel.probeHeaderFields
    ) -> Bool {
        guard let http = response as? HTTPURLResponse else { return false }
        let header = readHeaders(http)
        return probeAnswerIsAlive(statusCode: header.statusCode, location: header.location, origin: origin)
    }

    private func startReconnectProbe() {
        probeTask?.cancel()
        probeGeneration += 1
        let generation = probeGeneration
        probeFailures = 0
        probeTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let failures = self?.probeFailures, let ready = self?.reconnectReady else { return }
                // First wait is 1.2s, so a host that is already back can raise the banner within about a second.
                // Later misses wait 2s, 3.5s, then 5s. A successful probe resets that count. While the banner is up
                // the wait holds at 5s, so a reachable server is not polled every 1.2s for as long as the screen stays up.
                let wait = Self.reconnectWaitNanoseconds(afterFailures: failures, reconnectReady: ready)
                guard let sleep = self?.reconnectSleep else { return }
                try? await sleep(wait)
                guard let self, !Task.isCancelled else { return }
                // Keep probing while the banner is up so a later miss can hide it.
                guard case .offline = self.phase, let origin = self.selectedOrigin else { return }
                do {
                    guard let cookies = await self.reconnectCookies(self.webView) else { return }
                    guard !Task.isCancelled else { return }
                    var request = DeckConfig.rootRequest(origin: origin)
                    if let session = cookies.first(where: { self.isSessionCookie($0, at: origin) }) {
                        request.setValue(HTTPCookie.requestHeaderFields(with: [session])["Cookie"],
                                         forHTTPHeaderField: "Cookie")
                    }
                    // Only response headers are needed; never download or render the dashboard.
                    let response: URLResponse
                    if let reconnectResponse = self.reconnectResponse {
                        response = try await reconnectResponse(request)
                    } else {
                        let (bytes, headers) = try await self.probeSession.bytes(for: request)
                        bytes.task.cancel()
                        response = headers
                    }
                    guard !Task.isCancelled else { return }
                    let alive = Self.probeResponseIsAlive(response, origin: origin)
                    self.finishProbe(success: alive, generation: generation, origin: origin)
                } catch {
                    guard !Task.isCancelled else { return }
                    self.finishProbe(success: false, generation: generation, origin: origin)
                }
            }
        }
    }

    private func stopReconnectProbe() {
        probeTask?.cancel()
        probeTask = nil
        probeGeneration += 1
        probeFailures = 0
    }

    /// Shared failure entry point. Host failures probe; local rule failures do not.
    func showOffline(reason: String, probeHost: Bool) {
        replacesWebViewOnOpen = true
        offlineProbesHost = probeHost
        phase = .offline(reason: reason)
    }

    /// Rule installation fails locally before any load. Host availability cannot repair this failure;
    /// probing would falsely suggest that Reconnect, rather than Retry, fixes the missing rules.
    private func showRuleInstallOffline() {
        showOffline(reason: "Could not limit the app to this deck's address.", probeHost: false)
    }

    /// Neither a late response nor a connection switch may change the banner.
    nonisolated static func shouldApplyProbeResult(generation: Int, activeGeneration: Int,
                                                  phase: DeckPhase, origin: URL, selectedOrigin: URL?) -> Bool {
        guard generation == activeGeneration, origin == selectedOrigin else { return false }
        if case .offline = phase { return true }
        return false
    }

    private func finishProbe(success: Bool, generation: Int, origin: URL) {
        guard Self.shouldApplyProbeResult(
            generation: generation, activeGeneration: probeGeneration,
            phase: phase, origin: origin, selectedOrigin: selectedOrigin) else { return }
        probeFailures = Self.reconnectProbeFailures(after: probeFailures, succeeded: success)
        if reconnectReady != success { reconnectReady = success }
        if Self.shouldAutoReconnect(answered: success, sceneIsActive: sceneIsActive,
                                    alreadyUsed: autoReconnectUsed, enabled: autoReconnects) {
            autoReconnectUsed = true
            retry()
        }
    }

    private func cancelUserLoad() {
        loadGeneration.cancel()
        progressObservation = nil
    }

    private func armUserLoad(in view: WKWebView) -> W3DeckLoadGeneration.Ticket {
        loadProgress = 0
        let ticket = loadGeneration.begin(in: view, timeoutNanoseconds: loadTimeoutNanoseconds,
                                          sleep: loadSleep) { [weak self, weak view] _ in
            guard let self, let view, self.webView === view, !self.isDemo,
                  self.phase == .loading else { return }
            // Invalidate before stopLoading: its cancellation callback must not revive this load.
            self.showOffline(reason: W3DeckLoadGeneration.timeoutReason, probeHost: true)
            view.stopLoading()
        }
        #if DEBUG
        loadTimeoutNanoseconds = W3DeckLoadGeneration.timeoutNanoseconds
        #endif
        let progressBox = DeckProgressCoalescer()
        progressObservation = view.observe(\.estimatedProgress, options: [.new]) { [weak self] view, _ in
            let progress = view.estimatedProgress
            guard progressBox.record(progress) else { return }
            Task { @MainActor in
                guard let applied = progressBox.take() else { return }
                guard let self, self.webView === view, self.phase == .loading,
                      self.loadGeneration.accepts(ticket: ticket, in: view) else { return }
                self.loadProgress = applied
            }
        }
        return ticket
    }

    private func beginUserLoad(_ request: URLRequest, in view: WKWebView) {
        guard webView === view, originRulesInstalled, !isDemo else { return }
        // A link or Back to deck from a showing page keeps it on screen; a sign-in or first open shows the backdrop.
        let inPlace = phase == .ready
        cancelUserLoad()
        view.stopLoading()
        keepsPageVisible = inPlace
        phase = .loading
        let ticket = armUserLoad(in: view)
        loadGeneration.bind(navigation: loadNavigation(view, request), to: ticket)
    }

    /// Schemes a deck page may hand to the system when the user taps a link. Every other scheme is dropped, never loaded.
    nonisolated static func opensExternally(_ url: URL) -> Bool {
        ["https", "http", "tel", "sms", "mailto"].contains(url.scheme?.lowercased() ?? "")
    }

    private func open(external url: URL) {
        guard Self.opensExternally(url) else { return }
        UIApplication.shared.open(url)
    }

    private func describe(_ error: Error) -> String { Self.offlineReason(for: error, host: selectedOrigin?.host) }

    /// The one sentence the offline screen shows for a failed load. `OfflineCause` maps these sentences to
    /// titles and guidance, so each certificate failure keeps the words "secure connection" and each
    /// no-connectivity failure keeps "no network connection".
    nonisolated static func offlineReason(for error: Error, host: String? = nil) -> String {
        let e = error as NSError
        guard e.domain == NSURLErrorDomain else { return e.localizedDescription }
        switch e.code {
        case NSURLErrorNotConnectedToInternet, NSURLErrorDataNotAllowed,
             NSURLErrorInternationalRoamingOff, NSURLErrorCallIsActive:
            return "This device has no network connection."
        case NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed: return OfflineCause.nameDidNotResolveReason(host: host)
        case NSURLErrorTimedOut: return "The deck did not answer in time."
        case NSURLErrorCannotConnectToHost: return "The deck refused the connection."
        case NSURLErrorNetworkConnectionLost: return "The connection to the deck was lost."
        case NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted,
             NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateHasUnknownRoot,
             NSURLErrorServerCertificateNotYetValid, NSURLErrorClientCertificateRejected,
             NSURLErrorClientCertificateRequired:
            return "The secure connection to the deck failed."
        default: return "Network error \(e.code)."
        }
    }

    enum ProcessTerminationAction: Equatable {
        /// Same as the Retry button.
        case retry
        /// A load was running when the web content process died: start it again on a fresh view.
        case restartLoad
        /// The process keeps dying while loading: stop and show Retry instead of looping.
        case giveUp
    }

    nonisolated static let maxProcessRestartsDuringLoad = 2
    nonisolated static let processStoppedReason = "The deck page stopped unexpectedly. Tap Retry."

    /// Retry alone ignores a `.loading` phase, so a process that died mid-load left the spinner up until the
    /// 30 second watchdog. A load restarts at once, at most `maxProcessRestartsDuringLoad` times in a row.
    nonisolated static func processTerminationAction(phase: DeckPhase, restartsDuringLoad: Int) -> ProcessTerminationAction {
        guard phase == .loading else { return .retry }
        return restartsDuringLoad < maxProcessRestartsDuringLoad ? .restartLoad : .giveUp
    }

    func webContentProcessDidTerminate() {
        guard !isDemo else { return }
        switch Self.processTerminationAction(phase: phase, restartsDuringLoad: processRestartsDuringLoad) {
        case .retry:
            retry()
        case .restartLoad:
            processRestartsDuringLoad += 1
            if let retryAction { retryAction(); return }
            // A new view, as after any offline Retry; the origin's store and session stay.
            replacesWebViewOnOpen = true
            phase = .starting
            Task { await openSelected() }
        case .giveUp:
            processRestartsDuringLoad = 0
            showOffline(reason: Self.processStoppedReason, probeHost: false)
        }
    }
}

extension DeckModel: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard self.webView === webView, let url = action.request.url else { return .cancel }
        if url.absoluteString == "about:blank" { return .allow }
        // Fail closed: nothing loads until the exact-origin content rule is installed.
        guard originRulesInstalled else { return .cancel }
        if let origin = selectedOrigin, DeckConfig.isDeckOrigin(url, origin: origin) {
            if action.targetFrame?.isMainFrame == true, action.navigationType == .linkActivated {
                beginUserLoad(action.request, in: webView)
                return .cancel
            }
            return .allow
        }
        if action.targetFrame?.isMainFrame ?? true, action.navigationType == .linkActivated {
            open(external: url)
        }
        return .cancel
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        guard self.webView === webView, let url = response.response.url, let origin = selectedOrigin,
              DeckConfig.isDeckOrigin(url, origin: origin) else { return .cancel }
        guard response.isForMainFrame else { return .allow }
        guard phase == .loading, loadGeneration.active != nil else { return .cancel }
        guard let http = response.response as? HTTPURLResponse else { return .allow }
        if http.statusCode == 401 {
            let notice = attemptedBootstrap ? "The deck rejected that token. Check it and try again." : "Sign in again to open the deck."
            attemptedBootstrap = false
            phase = .needsToken(notice: notice)
            return .cancel
        }
        if http.statusCode >= 500 {
            showOffline(reason: "The deck server returned HTTP \(http.statusCode).", probeHost: true)
            return .cancel
        }
        return .allow
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        guard self.webView === webView, originRulesInstalled, !isDemo, phase == .ready else { return }
        // Page-initiated same-origin navigation uses the same bounded lifecycle, with the page left on screen.
        keepsPageVisible = true
        phase = .loading
        let ticket = armUserLoad(in: webView)
        loadGeneration.bind(navigation: navigation, to: ticket)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard self.webView === webView, phase == .loading,
              loadGeneration.accepts(navigation: navigation, in: webView) else { return }
        guard let url = webView.url, let origin = selectedOrigin,
              DeckConfig.isDeckOrigin(url, origin: origin) else { return }
        // Idempotent fallback; the primary scrub runs at document start before page scripts.
        webView.evaluateJavaScript(DeckConfig.bootstrapScrubScript, completionHandler: nil)
        attemptedBootstrap = false
        phase = .ready
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if self.webView === webView, loadGeneration.accepts(navigation: navigation, in: webView) { fail(error) }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if self.webView === webView, loadGeneration.accepts(navigation: navigation, in: webView) { fail(error) }
    }

    private func fail(_ error: Error) {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        if e.domain == "WebKitErrorDomain" && e.code == 102 { return }
        attemptedBootstrap = false
        showOffline(reason: describe(error), probeHost: true)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if self.webView === webView { webContentProcessDidTerminate() }
    }
}

extension DeckModel: WKUIDelegate {
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard self.webView === webView, originRulesInstalled, let url = action.request.url,
              action.navigationType == .linkActivated else { return nil }
        if let origin = selectedOrigin, DeckConfig.isDeckOrigin(url, origin: origin) {
            beginUserLoad(action.request, in: webView)
        } else {
            open(external: url)
        }
        return nil
    }

    /// Guideline 5.1.1: the app declares no camera or microphone purpose string, so a deck page must not be able
    /// to raise a capture prompt. Deny explicitly instead of leaving WebKit's default prompt to run without a purpose.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.deny)
    }

    /// Guideline 5.1.1: the Review Notes promise Local Network is the only system prompt. A deck page that reads
    /// device orientation would otherwise raise WebKit's motion and orientation prompt, which this app never explains.
    func webView(_ webView: WKWebView, requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.deny)
    }
}

extension DeckModel: UIGestureRecognizerDelegate {
    nonisolated func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
}
