import SwiftUI
import WebKit

struct DeckWebView: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

struct ContentView: View {
    @EnvironmentObject var deck: DeckModel
    @EnvironmentObject var pro: ProEntitlement
    @EnvironmentObject var feeds: DeckFeedStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showingConnections = false
    /// The Feeds sheet (every `DeckFeedSection`). The section last shown opens again.
    @State private var showingFeeds = false
    @AppStorage("deck.feeds.section") private var feedSectionRaw = DeckFeedSection.surf.rawValue
    /// A wide window gets Feeds full screen with its sidebar; a phone keeps the sheet.
    @Environment(\.horizontalSizeClass) private var sizeClass
    /// A section row in the Decks sheet asks for Feeds; it opens once Decks has gone away.
    @State private var pendingFeeds: DeckFeedSection?
    /// The Decks sheet opens on its add screen when Command N opened it.
    @State private var addingDeck = false
    /// One-time on-screen tip that names the Decks control. Guideline 5.6: the way into the
    /// menu must be taught, not discovered. Set once the sheet opens.
    @AppStorage("deck.decksTipSeen") private var decksTipSeen = false
    @AccessibilityFocusState private var loadingFocused: Bool

    /// The token field exists only on the token screen. A departing transition must not leave it tappable
    /// once the deck is showing, including while the Decks control is faded.
    private var tokenFieldIsReachable: Bool {
        if case .needsToken = deck.phase { return true }
        return false
    }

    private var shortcutState: DeckShortcutState {
        let screen: DeckShortcutState.Screen
        switch deck.phase {
        case .needsConnection: screen = .connect
        case .needsToken: screen = .token
        case .starting, .loading: screen = .loading
        case .offline: screen = .offline
        case .ready: screen = .ready
        }
        return DeckShortcutState(screen: screen, deckCount: deck.connections.count,
                                 isPro: pro.isPro, decksOpen: showingConnections)
    }

    private func perform(_ shortcut: DeckShortcut) {
        switch shortcut {
        case .addDeck: openDecks(adding: true)
        case .showDecks: openDecks(adding: false)
        case .findOnPage: deck.findOnPage()
        case .reload: deck.reload()
        case .previousDeck: deck.selectNeighbor(step: -1)
        case .nextDeck: deck.selectNeighbor(step: 1)
        case .previousPage: deck.stepPage(-1)
        case .nextPage: deck.stepPage(1)
        case .openDeck(let number): deck.openDeck(number: number)
        }
    }

    private func openDecks(adding: Bool) {
        addingDeck = adding
        decksTipSeen = true
        deck.chrome.reveal()
        showingConnections = true
    }

    private var feedSection: Binding<DeckFeedSection> {
        Binding(get: { DeckFeedSection(rawValue: feedSectionRaw) ?? .surf },
                set: { feedSectionRaw = $0.rawValue })
    }

    /// Feeds open from their tiles at the top of the Decks sheet. No second control floats over the page: the web deck
    /// reserves exactly one 56 pt corner for the shell (`ShellReserve`).
    private func openFeeds(_ section: DeckFeedSection) {
        feedSectionRaw = section.rawValue
        deck.chrome.reveal()
        showingFeeds = true
    }

    /// The tip shows on the first real deck, until Decks has been opened once.
    private var showsDecksTip: Bool {
        !decksTipSeen && !deck.isDemo && deck.phase == .ready && deck.chrome.isPresent
    }

    /// The page is on screen once ready, and stays on screen through an in-place reload or same-origin navigation
    /// (I15): only the 2 pt progress line shows then, never the dimmed picture.
    private var pageShowing: Bool {
        deck.phase == .ready || (deck.phase == .loading && deck.keepsPageVisible)
    }

    /// Back to deck sits beside Decks while a same-origin server page such as Almanac is showing (I3).
    private var showsBackToDeck: Bool {
        deck.showsBackToDeck && pageShowing && deck.chrome.isPresent
    }

    /// Phase changes are springs. Under Reduce Motion they are a short crossfade.
    private var phaseAnimation: Animation {
        reduceMotion ? .easeInOut(duration: 0.2) : .smooth(duration: 0.35)
    }

    private var phaseTransition: AnyTransition {
        reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.98))
    }

    var body: some View {
        ZStack {
            // Native screens sit inside the safe area. Only the deck itself and its backdrop go edge to edge.
            DeckColors.bg.ignoresSafeArea()
            if deck.isDemo {
                DemoDeckView().transition(.opacity)
            } else {
                if let webView = deck.webView {
                    // The page is only a page once it is ready. Before that, and while the offline screen is up, it is
                    // invisible, so VoiceOver must not read its controls and touches must not reach them. An in-place
                    // reload keeps it showing (`pageShowing`).
                    DeckWebView(webView: webView)
                        .id(ObjectIdentifier(webView))
                        .ignoresSafeArea()
                        .opacity(pageShowing ? 1 : 0)
                        .allowsHitTesting(pageShowing)
                        .accessibilityHidden(!pageShowing)
                        .accessibilityIdentifier("deck.web")
                }
                phaseLayer
            }
        }
        .animation(phaseAnimation, value: deck.phase)
        .animation(phaseAnimation, value: deck.isDemo)
        .overlay(alignment: .topTrailing) {
            VStack(alignment: .trailing, spacing: DeckSpace.xs) {
                HStack(spacing: 0) {
                    if showsBackToDeck {
                        BackToDeckControl { deck.backToDeck() }
                            .transition(.opacity)
                    }
                    DecksControl(chrome: deck.chrome) { openDecks(adding: false) }
                }
                if showsDecksTip {
                    DecksTip()
                        .padding(.trailing, 8)
                        .transition(.opacity)
                }
            }
            .animation(.easeOut(duration: 0.2), value: showsDecksTip)
            .animation(.easeOut(duration: 0.2), value: showsBackToDeck)
        }
        .background {
            // The demo has its own keys. Its sample pages are not decks.
            if !deck.isDemo {
                DeckShortcutLayer(state: shortcutState, connections: deck.connections, perform: perform)
            }
        }
        .sheet(isPresented: $showingConnections, onDismiss: {
            if let section = pendingFeeds {
                pendingFeeds = nil
                openFeeds(section)
            }
        }) {
            ConnectionsView(firstRun: false, startsAdding: addingDeck, onOpenFeeds: { section in
                pendingFeeds = section
                showingConnections = false
            })
        }
        .sheet(isPresented: Binding(get: { showingFeeds && sizeClass != .regular }, set: { showingFeeds = $0 })) {
            DeckFeedsView(store: feeds, section: feedSection)
                .presentationDragIndicator(.visible)
        }
        // On iPad a form sheet floats narrow in a wide window: Feeds takes the whole window there.
        .fullScreenCover(isPresented: Binding(get: { showingFeeds && sizeClass == .regular }, set: { showingFeeds = $0 })) {
            DeckFeedsView(store: feeds, section: feedSection)
        }
        .onChange(of: showingConnections) { _, open in
            deck.chrome.setSheetPresented(open || showingFeeds)
        }
        .onChange(of: showingFeeds) { _, open in
            deck.chrome.setSheetPresented(open || showingConnections)
        }
        .onChange(of: deck.selectedOrigin) { _, origin in
            if origin == nil {
                showingConnections = false
                showingFeeds = false
            }
        }
        .sensoryFeedback(.selection, trigger: showingConnections) { _, open in open }
        .sensoryFeedback(.success, trigger: deck.readyCount)
        .sensoryFeedback(.error, trigger: deck.offlineCount)
        // Each phase replaces the one before, taking VoiceOver focus with it. Hand focus to the next one: the
        // loading label after Retry, the page once it is ready. Offline and token screens place their own.
        .onChange(of: deck.phase) { _, phase in
            switch phase {
            case .starting, .loading:
                // An in-place reload keeps the page and its focus; only the backdrop takes VoiceOver focus.
                if !pageShowing { Task { @MainActor in loadingFocused = true } }
            case .ready:
                UIAccessibility.post(notification: .screenChanged, argument: nil)
            default:
                break
            }
        }
        .background(DeckColors.bg)
    }

    @ViewBuilder
    private var phaseLayer: some View {
        switch deck.phase {
        case .starting, .loading:
            if deck.phase == .loading && deck.keepsPageVisible {
                // In-place reload: the page stays; only the progress line shows on top of it.
                VStack(spacing: 0) {
                    LoadProgressLine(progress: deck.loadProgress)
                    Spacer(minLength: 0)
                }
                .allowsHitTesting(false)
                .accessibilityIdentifier("deck.refreshing")
            } else {
                // One backdrop for both phases so the picture is not swapped between them.
                let loading = deck.phase == .loading
                ZStack(alignment: .top) {
                    LaunchBackdrop(snapshots: deck.launchSnapshots,
                                   label: loading ? "Loading deck" : "Starting",
                                   identifier: loading ? "deck.loading" : "deck.starting",
                                   focus: $loadingFocused)
                        // Separate identity so a starting-to-loading flip rebuilds the accessibility element.
                        // Updating only the identifier string on the shared backdrop can leave `deck.loading` missing.
                        .id(loading ? "deck.loading" : "deck.starting")
                    if loading { LoadProgressLine(progress: deck.loadProgress) }
                }
                .transition(.opacity)
            }
        case .needsConnection:
            // No transition: an outgoing first-run view kept its own Replace alert and save
            // button in the tree next to Add deck, so confirm existed twice.
            ConnectionsView(firstRun: true)
                .transaction { $0.disablesAnimations = true }
        case .needsToken(let notice):
            TokenView(notice: notice)
                .transition(phaseTransition)
                .allowsHitTesting(tokenFieldIsReachable)
        case .offline(let reason):
            OfflineView(reason: reason).transition(phaseTransition)
        case .ready:
            EmptyView()
        }
    }
}

/// What the customer sees while the deck loads: the last picture of it, dimmed, or the mark when there is none.
/// Never a bare spinner. The determinate line (below) carries progress. A picture always says how old it is,
/// on screen and to VoiceOver, so a stale deck never reads as live.
private struct LaunchBackdrop: View {
    let snapshots: [DeckSnapshotStore.Shape: DeckSnapshotStore.Snapshot]
    let label: String
    let identifier: String
    var focus: AccessibilityFocusState<Bool>.Binding
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The orientation VoiceOver describes. The drawn picture reads the size directly, so no frame shows the wrong one.
    @State private var spokenShape: DeckSnapshotStore.Shape = .portrait

    var body: some View {
        // One clock for the chip and for VoiceOver, so neither keeps an age that has moved on.
        TimelineView(.everyMinute) { context in
            GeometryReader { proxy in
                let picture = snapshots[DeckSnapshotStore.shape(of: proxy.size)]
                ZStack {
                    if let picture {
                        Color.clear
                            .overlay { Image(uiImage: picture.image).resizable().scaledToFill() }
                            .clipped()
                            .overlay(DeckColors.bg.opacity(0.55))
                            .ignoresSafeArea()
                            .transition(.opacity)
                        if let saved = picture.savedAt {
                            SnapshotAgeChip(text: SnapshotAge.label(savedAt: saved, now: context.date))
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                                .padding(.bottom, DeckSpace.l)
                                .padding(.horizontal, DeckSpace.m)
                        }
                    } else {
                        Image(systemName: "rectangle.stack")
                            .font(.system(.largeTitle, weight: .light))
                            .foregroundStyle(DeckColors.signal)
                            .symbolEffect(.pulse, isActive: !reduceMotion)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
            }
            .onGeometryChange(for: DeckSnapshotStore.Shape.self) { proxy in
                DeckSnapshotStore.shape(of: proxy.size)
            } action: { spokenShape = $0 }
            .allowsHitTesting(false)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
            // The picture is the last one saved, never the deck as it is now. Say so, and how old, only when there is one.
            .accessibilityValue(spokenValue(snapshots[spokenShape], now: context.date))
            .accessibilityFocused(focus)
            .accessibilityIdentifier(identifier)
        }
    }

    private func spokenValue(_ picture: DeckSnapshotStore.Snapshot?, now: Date) -> String {
        guard let picture else { return "" }
        guard let saved = picture.savedAt else { return "Last saved picture, not live" }
        return SnapshotAge.spoken(savedAt: saved, now: now)
    }
}

/// The age of the cached picture, above the bottom edge. Grows with Dynamic Type and wraps.
private struct SnapshotAgeChip: View {
    let text: String

    var body: some View {
        Label {
            Text(text)
        } icon: {
            Image(systemName: "clock")
        }
        .font(DeckType.captionStrong)
        .foregroundStyle(DeckColors.fg)
        .multilineTextAlignment(.center)
        .padding(.horizontal, DeckSpace.m - DeckSpace.xs)
        .padding(.vertical, DeckSpace.s)
        .background(DeckColors.panel.opacity(0.92), in: .rect(cornerRadius: DeckStyle.cardRadius))
        .overlay(RoundedRectangle(cornerRadius: DeckStyle.cardRadius).strokeBorder(DeckColors.line, lineWidth: 1))
    }
}

/// WebKit's estimated progress as a 2 pt tint line on the top edge of the safe area.
private struct LoadProgressLine: View {
    let progress: Double

    var body: some View {
        GeometryReader { proxy in
            Rectangle()
                .fill(DeckColors.signal)
                .frame(width: proxy.size.width * min(max(progress, 0.08), 1), height: 2)
                .animation(.easeOut(duration: 0.2), value: progress)
        }
        .frame(height: 2)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private struct DeckButtonPressedKey: EnvironmentKey {
    static let defaultValue = false
}

private extension EnvironmentValues {
    /// Set by `DeckPressStyle` so the glyph can shrink without scaling the 44 pt hit target.
    var deckButtonPressed: Bool {
        get { self[DeckButtonPressedKey.self] }
        set { self[DeckButtonPressedKey.self] = newValue }
    }
}

/// Drawn glass only. Fade (0.9) and press (0.92) stay on this view. Scaling the button
/// made XCTest report 44 × 0.9 = 39.6 pt, under the 44 pt minimum.
private struct DeckControlGlyph: View {
    /// After the idle wait the glyph drops to a low but clearly visible opacity. It never reaches 0.
    let dimmed: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.deckButtonPressed) private var pressed

    /// The dimmed glyph still reads as a control, so a reviewer always sees a way into Decks.
    nonisolated static let dimmedOpacity: Double = 0.55

    private var scale: CGFloat {
        let idle: CGFloat = dimmed && !reduceMotion ? 0.9 : 1
        let press: CGFloat = pressed && !reduceMotion ? 0.92 : 1
        return idle * press
    }

    var body: some View {
        Image(systemName: "rectangle.stack")
            .font(.system(.body, weight: .semibold))
            // The circle is a fixed 44 pt hit target, so the glyph grows with Dynamic Type only while it still fits.
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .foregroundStyle(DeckColors.fg)
            .frame(width: DeckChrome.controlPoints, height: DeckChrome.controlPoints)
            .deckGlass()
            .scaleEffect(scale)
            .opacity(dimmed ? Self.dimmedOpacity : 1)
            .animation(.easeOut(duration: 0.12), value: pressed)
            .animation(.easeOut(duration: 0.3), value: dimmed)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// The Decks control: a 44 pt glass circle in the top-trailing corner of the safe area.
/// It is always tappable while a deck is showing. The idle wait only dims the glyph, so the
/// control is never invisible or unreachable (Guideline 5.6, build 21). The hit shape stays 44 pt.
private struct DecksControl: View {
    @ObservedObject var chrome: DeckChrome
    let open: () -> Void

    var body: some View {
        if chrome.isPresent {
            Button {
                // Always opens Decks. The dimmed state is cosmetic, so a tap here never
                // spends itself on a reveal and always lands on the menu.
                open()
            } label: {
                Color.clear
                    .frame(width: DeckChrome.controlPoints, height: DeckChrome.controlPoints)
                    .overlay { DeckControlGlyph(dimmed: chrome.isDimmed) }
                    .contentShape(Circle())
            }
            .buttonStyle(DeckPressStyle())
            // iPad pointer: the circle answers the cursor, the same way a fingertip answers with its press.
            .hoverEffect(.highlight)
            // Hit testing is not animated and the button itself is never faded, so the
            // control is tappable on the same frame it appears. The glyph carries the dim.
            .allowsHitTesting(chrome.isVisible)
            .padding(8)
            .accessibilityLabel("Decks")
            // The glyph stops growing at xxxLarge to fit its fixed 44 pt circle, so large text sizes get the Large Content Viewer.
            .accessibilityShowsLargeContentViewer { Label("Decks", systemImage: "rectangle.stack") }
            .accessibilityHint("Switch or add decks, reload the deck, or open Pro")
            .accessibilityIdentifier("connection.manage")
            .transition(.opacity)
        }
    }
}

/// A one-time caption under the Decks control. It never takes taps, so the page and the
/// control keep their behaviour while it is up. Guideline 5.6: nothing about the menu is hidden.
/// The backing is opaque (I17): page text and dividers under it must not show through the caption.
private struct DecksTip: View {
    var body: some View {
        Text("Tap here for feeds, decks, Pro and reload")
            .font(DeckType.caption)
            .foregroundStyle(DeckColors.fg)
            .multilineTextAlignment(.trailing)
            .padding(.horizontal, DeckSpace.s)
            .padding(.vertical, DeckSpace.xs)
            .background(DeckColors.panel, in: .rect(cornerRadius: DeckStyle.cardRadius))
            .shadow(color: .black.opacity(0.35), radius: 6, y: 2)
            .overlay(RoundedRectangle(cornerRadius: DeckStyle.cardRadius).strokeBorder(DeckColors.line, lineWidth: 1))
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .accessibilityIdentifier("deck.decks.tip")
    }
}

/// Reports the press. The glyph scales; the label's frame does not.
private struct DeckPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .environment(\.deckButtonPressed, configuration.isPressed)
    }
}

/// Back to deck (I3): a 44 pt glass capsule beside Decks while a same-origin server page (Almanac) is showing.
/// Back gestures are off in the shell and those pages have no link home, so this is the way back to `/`.
private struct BackToDeckControl: View {
    let back: () -> Void

    var body: some View {
        Button(action: back) {
            Label("Deck", systemImage: "chevron.backward")
                .font(DeckType.captionStrong)
                .foregroundStyle(DeckColors.fg)
                .padding(.horizontal, DeckSpace.m)
                .frame(minHeight: DeckChrome.controlPoints)
                .deckCapsuleGlass()
                .contentShape(Capsule())
        }
        .buttonStyle(DeckPressStyle())
        .hoverEffect(.highlight)
        .padding(.vertical, 8)
        .accessibilityLabel("Back to deck")
        .accessibilityHint("Leaves this page and opens the deck's home page")
        .accessibilityIdentifier("deck.back")
    }
}

private extension View {
    @ViewBuilder
    func deckGlass() -> some View {
        if #available(iOS 26.0, *) {
            glassEffect(.regular.interactive(), in: Circle())
        } else {
            background(.regularMaterial, in: Circle())
                .overlay(Circle().strokeBorder(DeckColors.line, lineWidth: 1))
        }
    }

    /// The same glass as the Decks circle, drawn as a capsule for a labelled control.
    @ViewBuilder
    func deckCapsuleGlass() -> some View {
        if #available(iOS 26.0, *) {
            glassEffect(.regular.interactive(), in: Capsule())
        } else {
            background(.regularMaterial, in: Capsule())
                .overlay(Capsule().strokeBorder(DeckColors.line, lineWidth: 1))
        }
    }
}
