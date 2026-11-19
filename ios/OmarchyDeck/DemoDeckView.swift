import SwiftUI

/// The offline sample deck. It is native SwiftUI: it never instantiates the real server WebView,
/// never follows a link and never opens a network connection of its own. Camera stills and the
/// desktop are drawn on this device. The only outside call is the App Store price in the Connect sheet.
struct DemoDeckView: View {
    @EnvironmentObject private var deck: DeckModel
    @State private var sample = DemoDeck()
    @State private var showingConnect = false
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.verticalSizeClass) private var verticalSize
    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @State private var detailWidth: CGFloat = 0

    var body: some View {
        Group {
            if DeckLayout.demoUsesSidebar(regularWidth: sizeClass == .regular, compactHeight: verticalSize == .compact) {
                NavigationSplitView(columnVisibility: $columnVisibility) {
                    List {
                        ForEach(DemoDeck.Tab.allCases) { tab in
                            Button { sample.activeTab = tab } label: {
                                Label(tab.title, systemImage: tab.symbol)
                                    .foregroundStyle(DeckColors.fg)
                                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .listRowBackground(sample.activeTab == tab ? DeckColors.line : DeckColors.panel)
                            .accessibilityIdentifier("demo.tab.\(tab.rawValue)")
                            .accessibilityAddTraits(sample.activeTab == tab ? .isSelected : [])
                        }
                    }
                    .listStyle(.plain)
                    .tint(DeckColors.line)
                    .scrollContentBackground(.hidden)
                    // The panel colour continues below the last row, so the column reads as one sidebar
                    // instead of a short block with a hard edge on a tall iPad.
                    .background(DeckColors.panel)
                    // The detail bar already carries the Demo badge beside this column's toggle; a second
                    // "Demo" here read as a doubled header on iPad.
                    .navigationTitle("Pages")
                    .navigationSplitViewColumnWidth(min: 180, ideal: 210, max: 250)
                    .accessibilityIdentifier("demo.sidebar")
                } detail: {
                    NavigationStack { page(sample.activeTab) }
                        .demoWidthReader($detailWidth)
                        .environment(\.demoDetailWidth, detailWidth)
                }
                .navigationSplitViewStyle(.balanced)
            } else {
                TabView(selection: $sample.activeTab) {
                    ForEach(DemoDeck.Tab.allCases) { tab in
                        Tab(tab.title, systemImage: tab.symbol, value: tab) {
                            NavigationStack { page(tab) }
                        }
                    }
                }
                .tabViewStyle(.tabBarOnly)
            }
        }
        .tint(DemoPalette.tint)
        .background(DemoPalette.bg.ignoresSafeArea())
        .demoFeedback(sample)
        .background {
            // Command 1 to 5 pick a sample page and Command N opens Connect, listed while Command is held on iPad.
            if !showingConnect {
                ForEach(Array(DemoDeck.Tab.allCases.enumerated()), id: \.element) { index, tab in
                    KeyboardShortcutButton(title: "Show \(tab.title)",
                                           key: KeyEquivalent(Character(String(index + 1)))) {
                        sample.activeTab = tab
                    }
                }
                KeyboardShortcutButton(title: "Connect Your Deck", key: "n", action: connect)
            }
        }
        .sheet(isPresented: $showingConnect) {
            DemoConnectSheet {
                showingConnect = false
                deck.endDemo()
            }
        }
        .preferredColorScheme(.dark)
    }

    @ViewBuilder
    private func page(_ tab: DemoDeck.Tab) -> some View {
        switch tab {
        case .today: DemoTodayPage(sample: sample, onConnect: connect)
        case .home: DemoHomePage(sample: sample, onConnect: connect)
        case .shop: DemoShopPage(sample: sample, onConnect: connect)
        case .links: DemoLinksPage(sample: sample, onConnect: connect)
        case .pad: DemoPadPage(sample: sample, onConnect: connect)
        }
    }

    private func connect() { showingConnect = true }
}

/// The width of the sample deck's detail column, so a page can choose one or two columns.
private struct DemoDetailWidthKey: EnvironmentKey {
    /// Zero until the detail column reports its width, so the first frame is one column, never a squeezed pair.
    static let defaultValue: CGFloat = 0
}

extension EnvironmentValues {
    var demoDetailWidth: CGFloat {
        get { self[DemoDetailWidthKey.self] }
        set { self[DemoDetailWidthKey.self] = newValue }
    }
}

/// Reports the detail column's width without touching its layout.
private struct DemoWidthReader: ViewModifier {
    @Binding var width: CGFloat

    func body(content: Content) -> some View {
        content.background {
            GeometryReader { geo in
                Color.clear.onAppear { width = geo.size.width }
                    .onChange(of: geo.size.width) { _, next in width = next }
            }
        }
    }
}

extension View {
    func demoWidthReader(_ width: Binding<CGFloat>) -> some View { modifier(DemoWidthReader(width: width)) }
}

/// One shared top bar: a quiet Demo badge on the left, the way out on the right.
private struct DemoChrome: ViewModifier {
    let title: String
    let inline: Bool
    let onConnect: () -> Void

    func body(content: Content) -> some View {
        content
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(inline ? .inline : .large)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { DemoBadge() }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Connect", action: onConnect)
                        .frame(minHeight: 44)
                        .accessibilityLabel("Connect your deck")
                        .accessibilityHint(DemoWords.connectHint)
                        .accessibilityIdentifier("demo.connect.open")
                }
            }
            .background(DemoPalette.bg)
    }
}

/// Haptics for sample controls: selection for toggles and pins, a light impact for clicks and the timer, success for a send.
private struct DemoFeedback: ViewModifier {
    let sample: DemoDeck

    func body(content: Content) -> some View {
        content
            .sensoryFeedback(.selection, trigger: sample.selectionCount)
            .sensoryFeedback(.impact(weight: .light), trigger: sample.impactCount)
            .sensoryFeedback(.success, trigger: sample.successCount)
    }
}

extension View {
    func demoChrome(title: String, inline: Bool = false, onConnect: @escaping () -> Void) -> some View {
        modifier(DemoChrome(title: title, inline: inline, onConnect: onConnect))
    }

    func demoFeedback(_ sample: DemoDeck) -> some View {
        modifier(DemoFeedback(sample: sample))
    }

    /// The grouped, tinted-neutral list every demo screen shares.
    func demoList() -> some View {
        listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(DemoPalette.bg)
            .listRowSeparatorTint(DemoPalette.line)
    }
}

struct DemoSectionHeader: View {
    let title: String
    init(_ title: String) { self.title = title }

    var body: some View {
        Text(title)
            .font(DemoType.bodyStrong)
            .foregroundStyle(DemoPalette.text2)
            .textCase(nil)
            .accessibilityAddTraits(.isHeader)
    }
}

struct DemoSectionFooter: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(DemoType.meta)
            .foregroundStyle(DemoPalette.text3)
    }
}

/// One plain line at the top of a sample page that says what the page is for.
struct DemoPurposeSection: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Section {
            Text(text)
                .font(DemoType.body)
                .foregroundStyle(DemoPalette.text2)
                .fixedSize(horizontal: false, vertical: true)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 4, bottom: 4, trailing: 4))
                .accessibilityIdentifier("demo.purpose")
        }
    }
}
