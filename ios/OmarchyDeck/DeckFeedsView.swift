import SwiftUI

/// The Feeds sheet: Surf, Shop, Real estate, Housing, Commercial, Deals, Travel, Outdoors and Life over the deck's own routes.
/// On a phone, a tab strip above one column. On a wide window (every iPad full screen and wide Split View), a sidebar
/// of sections beside a page of up to two readable columns. Each section has one freshness mark that opens its Data
/// sheet; pages print no source text.
struct DeckFeedsView: View {
    @ObservedObject var store: DeckFeedStore
    @Binding var section: DeckFeedSection
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    /// The sidebar's icon column grows with the symbol it holds, so large text does not spill into the title.
    @ScaledMetric(relativeTo: .body) private var sidebarIconColumn: CGFloat = 24
    @AppStorage("deck.feeds.appearance") private var appearanceRaw = FeedAppearance.dark.rawValue
    @State private var windowWidth: CGFloat = 0
    @State private var contentWidth: CGFloat = 0
    @State private var data: FeedDataContent?

    private var appearance: FeedAppearance { FeedAppearance(rawValue: appearanceRaw) ?? .dark }
    private var scheme: ColorScheme { appearance.scheme }
    private var usesSidebar: Bool {
        DeckLayout.feedsUsesSidebar(regularWidth: sizeClass == .regular, windowWidth: windowWidth)
    }

    var body: some View {
        HStack(spacing: 0) {
            if usesSidebar {
                sidebar
                Rectangle().fill(FeedPalette.line).frame(width: 1).ignoresSafeArea()
            }
            page
        }
        .background(FeedPalette.bg.ignoresSafeArea())
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { windowWidth = $0 }
        .tint(FeedPalette.signal)
        // The environment, not `preferredColorScheme`, so only this screen changes: the deck behind it stays dark.
        .environment(\.colorScheme, scheme)
        .presentationBackground(FeedPalette.bg)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: section)
        .task(id: section) { await store.load(section) }
        .sensoryFeedback(.selection, trigger: section)
        .sheet(item: $data) { content in
            FeedDataSheet(content: content).environment(\.colorScheme, scheme)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("feeds.screen")
    }

    // MARK: Sidebar (wide windows)

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: DeckSpace.xs) {
            HStack {
                Text("Feeds")
                    .deckFont(.title)
                    .foregroundStyle(FeedPalette.text1)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                appearanceToggle
            }
            .padding(.horizontal, DeckSpace.m)
            .padding(.top, DeckSpace.m)
            .padding(.bottom, DeckSpace.s)
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(DeckFeedSection.allCases) { item in
                        sidebarRow(item)
                    }
                }
                .padding(.horizontal, DeckSpace.s)
            }
            Spacer(minLength: 0)
        }
        .frame(width: DeckLayout.feedsSidebarWidth)
        .background(FeedPalette.bar.ignoresSafeArea())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("feeds.sidebar")
    }

    private func sidebarRow(_ item: DeckFeedSection) -> some View {
        let selected = item == section
        return Button { section = item } label: {
            HStack(spacing: DeckSpace.s + 4) {
                Image(systemName: item.symbol)
                    .font(.body.weight(selected ? .semibold : .regular))
                    .foregroundStyle(selected ? FeedPalette.signal : FeedPalette.text2)
                    .frame(width: sidebarIconColumn)
                    .accessibilityHidden(true)
                Text(item.title)
                    .deckFont(.body, weight: selected ? 600 : 400)
                    .foregroundStyle(selected ? FeedPalette.text1 : FeedPalette.text2)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, DeckSpace.s + 4)
            .frame(minHeight: DeckSpace.minTap)
            .background(selected ? FeedPalette.raised2 : Color.clear, in: RoundedRectangle(cornerRadius: DeckStyle.controlRadius))
            .overlay(alignment: .leading) {
                if selected {
                    Capsule().fill(FeedPalette.signal).frame(width: 3, height: 20).padding(.leading, 2)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(item.title)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("feeds.tab.\(item.rawValue)")
    }

    // MARK: Page

    private var page: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DeckSpace.m) {
                if !usesSidebar { tabStrip }
                header
                content
                    .id(section)
                    .transition(.opacity)
            }
            .frame(maxWidth: DeckLayout.feedsContentMax)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { contentWidth = $0 }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, usesSidebar ? DeckSpace.l : DeckSpace.m)
            .padding(.bottom, DeckSpace.xl)
            .environment(\.feedColumns, DeckLayout.feedsColumns(contentWidth: contentWidth))
        }
        .refreshable { await store.load(section, force: true) }
        .safeAreaInset(edge: .top, spacing: 0) { topBar }
    }

    /// Appearance (phone only: the sidebar holds it on wide windows) and Done.
    private var topBar: some View {
        HStack {
            if !usesSidebar { appearanceToggle }
            Spacer()
            Button("Done") { dismiss() }
                .deckFont(.body, weight: 600)
                .keyboardShortcut(.cancelAction)
                .feedGlassButton()
                .accessibilityIdentifier("feeds.done")
        }
        .padding(.horizontal, DeckSpace.m)
        .padding(.top, DeckSpace.s)
        .padding(.bottom, DeckSpace.xs)
        .background(FeedPalette.bg.opacity(0.94).ignoresSafeArea(edges: .top))
    }

    /// One tap flips Light and Dark.
    private var appearanceToggle: some View {
        Button {
            appearanceRaw = (appearance == .light ? FeedAppearance.dark : .light).rawValue
        } label: {
            Image(systemName: scheme == .light ? "sun.max" : "moon")
                .font(.body.weight(.semibold))
                .foregroundStyle(FeedPalette.text1)
                .contentTransition(.symbolEffect(.replace))
                .frame(width: DeckSpace.minTap, height: DeckSpace.minTap)
                .feedCircleGlass()
                .contentShape(Circle())
        }
        .buttonStyle(FeedCardPressStyle())
        .sensoryFeedback(.selection, trigger: appearanceRaw)
        .accessibilityLabel("Appearance")
        // The glyph sits in a fixed 44 pt circle and does not grow with text, so large text sizes get the Large Content Viewer.
        .accessibilityShowsLargeContentViewer { Label("Appearance", systemImage: scheme == .light ? "sun.max" : "moon") }
        .accessibilityValue(appearance.title)
        .accessibilityHint(appearance == .light ? "Switches this screen to dark" : "Switches this screen to light")
        .accessibilityIdentifier("feeds.appearance")
    }

    /// Phone: all nine sections in one sideways strip, the picked one kept in view. The strip runs past the right edge, so
    /// it fades there and the next section peeks in: a tab is never sliced mid-word with no cue that more exist.
    private var tabStrip: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: DeckSpace.xs) {
                    ForEach(DeckFeedSection.allCases) { item in
                        tab(item).id(item)
                    }
                }
                .padding(.trailing, DeckSpace.m)
            }
            .overlay(alignment: .trailing) {
                LinearGradient(colors: [FeedPalette.bg.opacity(0), FeedPalette.bg],
                               startPoint: .leading, endPoint: .trailing)
                    .frame(width: DeckSpace.m + DeckSpace.s)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            .onAppear { proxy.scrollTo(section, anchor: .center) }
            .onChange(of: section) { _, next in
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { proxy.scrollTo(next, anchor: .center) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("feeds.tabs")
    }

    private func tab(_ item: DeckFeedSection) -> some View {
        let selected = item == section
        return Button { section = item } label: {
            VStack(spacing: 4) {
                Image(systemName: item.symbol)
                    .font(.body.weight(selected ? .semibold : .regular))
                    .foregroundStyle(selected ? FeedPalette.signal : FeedPalette.text2)
                    .accessibilityHidden(true)
                Text(item.title)
                    .deckFont(.micro, weight: selected ? 600 : 500)
                    .lineLimit(typeSize.isAccessibilitySize ? nil : 1)
                    .foregroundStyle(selected ? FeedPalette.text1 : FeedPalette.text2)
                Capsule()
                    .fill(selected ? FeedPalette.signal : Color.clear)
                    .frame(width: 20, height: 2)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, DeckSpace.xs + 2)
            .frame(minWidth: 76, minHeight: 60)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityShowsLargeContentViewer { Label(item.title, systemImage: item.symbol) }
        .accessibilityLabel(item.title)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("feeds.tab.\(item.rawValue)")
    }

    // MARK: Header

    /// Wide windows: the title with its mark and Data, the tagline under it. Phone: the selected tab already names the
    /// section, so the row holds only the mark and Data and the tagline moves into the Data sheet (SeeIos I3: title and
    /// tagline took 35-43% of the first screen). VoiceOver still meets the section's name as the page heading.
    private var header: some View {
        VStack(alignment: .leading, spacing: DeckSpace.xs) {
            HStack(alignment: .firstTextBaseline, spacing: DeckSpace.s) {
                if usesSidebar {
                    Text(section.title)
                        .deckFont(.display)
                        .foregroundStyle(FeedPalette.text1)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("feeds.title")
                    Spacer(minLength: DeckSpace.s)
                }
                if let mark = freshness {
                    FeedFreshnessMark(mark: mark) { data = dataContent }
                }
                if !usesSidebar { Spacer(minLength: DeckSpace.s) }
                Button { data = dataContent } label: {
                    // The 44 pt frame and hit shape sit inside the label: a frame outside a plain Button adds no hit area.
                    Text("Data")
                        .frame(minWidth: DeckSpace.minTap, minHeight: DeckSpace.minTap)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .deckFont(.meta, weight: 600)
                .foregroundStyle(FeedPalette.signalText)
                .accessibilityHint("Sources, dates and method for \(section.title)")
                .accessibilityIdentifier("feeds.data")
            }
            .frame(minHeight: DeckSpace.minTap)
            .background(alignment: .leading) {
                if !usesSidebar {
                    // Not drawn (clear text, no hit area), read first by VoiceOver as the page heading.
                    Text(section.title)
                        .deckFont(.meta)
                        .lineLimit(1)
                        .foregroundStyle(Color.clear)
                        .allowsHitTesting(false)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("feeds.title")
                }
            }
            if usesSidebar {
                Text(section.tagline)
                    .deckFont(.body)
                    .foregroundStyle(FeedPalette.text2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.top, usesSidebar ? DeckSpace.s : 0)
    }

    private var loadedPages: [DeckFeedPage] {
        section.feeds.compactMap { feed -> DeckFeedPage? in
            if case .loaded(let page) = store.state(feed) { return page }
            return nil
        }
    }

    /// Parts the deck could not give: whole feeds that failed, plus the sources in this section's own Data sheet that
    /// failed this run. A feed not collected yet is not a failure (`building`), and a deck that predates a route (404)
    /// is not "missing" either: the page says so plainly.
    private var missing: Int {
        let failedFeeds = section.feeds.filter { feed in
            if case .failed = store.state(feed) { return true }
            return false
        }.count
        return failedFeeds + DeckSectionData.failedParts(section, pages: loadedPages)
    }

    /// Whole feeds the deck has not collected yet: the card says "No data yet", the mark "Building".
    private var building: Int {
        section.feeds.filter { store.state($0) == .notCollected }.count
    }

    private var freshness: DeckFreshness? {
        DeckFreshness.mark(pages: loadedPages, missing: missing, building: building)
    }

    /// This section's own sources and notes: Housing and Commercial never carry each other's lines. On a phone the
    /// section's one line about itself opens the sheet, since the page no longer prints it.
    private var dataContent: FeedDataContent {
        let sheet = DeckSectionData.sheet(section, pages: loadedPages)
        return FeedDataContent(title: section.title, sources: sheet.sources, notes: sheet.notes,
                               about: usesSidebar ? nil : section.tagline)
    }

    // MARK: Content

    private func reload() {
        Task { await store.load(section, force: true) }
    }

    @ViewBuilder
    private var content: some View {
        switch section {
        case .surf:
            DeckSurfContent(store: store, retry: reload)
        case .shop:
            DeckShopContent(store: store, openURL: { openURL($0) }, retry: reload, openData: { data = $0 })
        case .realestate:
            DeckNationalContent(store: store, retry: reload, openData: { data = $0 })
        case .housing:
            DeckHousingContent(store: store, openURL: { openURL($0) }, retry: reload)
        case .commercial:
            DeckCommercialContent(store: store, openURL: { openURL($0) }, retry: reload)
        default:
            cardContent
        }
    }

    @ViewBuilder
    private var cardContent: some View {
        let multiple = section.feeds.count > 1
        VStack(alignment: .leading, spacing: DeckSpace.l) {
            ForEach(section.feeds, id: \.self) { feed in
                VStack(alignment: .leading, spacing: DeckSpace.s + 4) {
                    if multiple { FeedSectionTitle(DeckFeedNames.heading(feed)) }
                    FeedGate(feed: feed, state: store.state(feed), retry: reload) { page in
                        if page.cards.isEmpty {
                            FeedMessageCard(symbol: "checkmark.circle", title: "Nothing here right now",
                                            message: "Your deck's last check found no items. It checks again \(DeckFeedNames.cadence(feed)).",
                                            identifier: "feeds.state.empty")
                        } else {
                            FeedGrid(spacing: DeckSpace.s + 4) {
                                ForEach(Array(page.cards.prefix(60).enumerated()), id: \.element.id) { index, card in
                                    FeedCardView(card: card) { url in openURL(url) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// One item. Tappable cards open their link in Safari; the shell never opens a page of its own. No source line.
private struct FeedCardView: View {
    let card: DeckFeedCard
    var open: ((URL) -> Void)?
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Group {
            if let link = card.link, let open {
                Button { open(link) } label: { face }
                    .buttonStyle(FeedCardPressStyle())
                    .accessibilityHint(card.source.map { "Opens \($0) in Safari" } ?? "Opens the page in Safari")
            } else {
                face
            }
        }
        .accessibilityIdentifier("feeds.card")
    }

    private var face: some View {
        VStack(alignment: .leading, spacing: DeckSpace.s) {
            VStack(alignment: .leading, spacing: DeckSpace.xs) {
                if let eyebrow = card.eyebrow {
                    Text(eyebrow)
                        .deckFont(.micro, weight: 600)
                        .foregroundStyle(FeedPalette.text2)
                }
                Text(card.title)
                    .deckFont(.heading)
                    .foregroundStyle(FeedPalette.text1)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("feeds.card.title.\(card.id)")
                if let subtitle = card.subtitle {
                    Text(subtitle)
                        .deckFont(.body)
                        .foregroundStyle(FeedPalette.text2)
                        .multilineTextAlignment(.leading)
                        .lineLimit(4)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("feeds.card.subtitle.\(card.id)")
                }
            }
            if card.price != nil || card.badge != nil {
                VStack(alignment: .leading, spacing: DeckSpace.xs) {
                    if let price = card.price {
                        Text(price)
                            .deckFont(.figure)
                            .foregroundStyle(FeedPalette.text1)
                            .lineLimit(typeSize.isAccessibilitySize ? nil : 1)
                            .minimumScaleFactor(typeSize.isAccessibilitySize ? 1 : 0.7)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("feeds.card.price.\(card.id)")
                    }
                    if let badge = card.badge {
                        Text(badge)
                            .deckFont(.micro, weight: 600)
                            .foregroundStyle(tone)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            if let place = card.place {
                Label(place, systemImage: "mappin.and.ellipse")
                    .deckFont(.meta)
                    .foregroundStyle(FeedPalette.text2)
            }
            if let note = card.note {
                Label(note, systemImage: "exclamationmark.triangle")
                    .deckFont(.meta)
                    .foregroundStyle(FeedPalette.warn)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if card.link != nil {
                HStack {
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.up.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(FeedPalette.text3)
                        .accessibilityHidden(true)
                }
            }
        }
        .feedPanel()
        .accessibilityElement(children: .contain)
    }

    private var tone: Color {
        switch card.badgeTone {
        case .good: return FeedPalette.ok
        case .caution: return FeedPalette.warn
        case .plain: return FeedPalette.text2
        }
    }
}
