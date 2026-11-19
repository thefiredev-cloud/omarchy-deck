import SwiftUI

@main
struct OmarchyDeckApp: App {
    /// Every preference the app persists. A clean install has none of them, and the
    /// DEBUG launch argument must clear exactly this list so a UI test starts from
    /// the same state a first-run user sees.
    /// Mirrors OmarchyDeckUITests/UITestLaunch.swift `persistedDefaultKeys`.
    static let cleanInstallDefaultKeys = [
        "deck.savedOrigins.v1",
        "deck.selectedOrigin.v1",
        "deck.originStoreIDs.v1",
        "deck.legacyCookieMigration.v1",
        "deck.pendingStoreRemovals.v1",
        "deck.decksTipSeen",
        "deck.feeds.section",
        "deck.feeds.appearance",
        "deck.realestate.page",
        "deck.realestate.lens",
        "deck.markets.level",
        "deck.markets.segment",
    ]

    @StateObject private var deck: DeckModel
    /// The Feeds sections (Surf, Shop, Real estate, Housing, Commercial, Deals, Travel, Outdoors, Life), read from the selected deck with its own session.
    @StateObject private var feeds: DeckFeedStore
    private let watchBridge: WatchBridge
    @Environment(\.scenePhase) private var scenePhase

    init() {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-deck-demo-clean-install") {
            // Every key DeckModel or ContentView persists. A clean install has none of
            // them, and OmarchyDeckUITests/UITestLaunch.swift clears the same list.
            for key in Self.cleanInstallDefaultKeys {
                UserDefaults.standard.removeObject(forKey: key)
            }
            // The migration flag is per origin: every "deck.legacyCookieMigration.v1.<origin>" must go too.
            for key in UserDefaults.standard.dictionaryRepresentation().keys
            where key.hasPrefix("deck.legacyCookieMigration.v1") {
                UserDefaults.standard.removeObject(forKey: key)
            }
        }
        #endif
        let model = DeckModel()
        _deck = StateObject(wrappedValue: model)
        _feeds = StateObject(wrappedValue: DeckFeedStore(model: model))
        let bridge = WatchBridge(client: DeckActionClient(model: model),
                                 actions: { [weak model] in WatchAction.available(guest: model?.role == .guest) })
        // A guest never sees Lock on the watch: republish whenever the signed-in role becomes known or changes.
        model.onRoleChange = { [weak bridge] _ in bridge?.publishActions() }
        watchBridge = bridge
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(deck)
                .environmentObject(deck.pro)
                .environmentObject(feeds)
                .background(DeckPrivacyCover())
                .overlay {
                    if scenePhase != .active {
                        Color.black.ignoresSafeArea()
                            .accessibilityLabel("Omarchy Deck privacy cover")
                    }
                }
                .preferredColorScheme(.dark)
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
                .onAppear {
                    UIApplication.shared.isIdleTimerDisabled = (scenePhase == .active)
                }
                .onChange(of: scenePhase) { _, phase in
                    // The deck is glanceable: keep the screen awake only while it is on screen.
                    UIApplication.shared.isIdleTimerDisabled = (phase == .active)
                    if phase == .active {
                        deck.chrome.reveal()
                        deck.didBecomeActive()
                    } else {
                        deck.didResignActive()
                        // Keep the deck's last picture while it is still on screen, for the next launch.
                        Task { await deck.captureSnapshot() }
                    }
                }
        }
    }
}
