import Charts
import SwiftUI

/// Shared pieces of every Feeds section (2026-11-14): flat panels on the token ramp with one hairline (no shadows),
/// section titles, stat tiles, the confidence meter, sparklines, the freshness mark and the Data sheet.

/// How many content columns the current page has room for. Set by DeckFeedsView from the measured content width.
private struct FeedColumnsKey: EnvironmentKey {
    static let defaultValue = 1
}

extension EnvironmentValues {
    var feedColumns: Int {
        get { self[FeedColumnsKey.self] }
        set { self[FeedColumnsKey.self] = newValue }
    }
}

extension View {
    /// A card: the raised step with a hairline. Interactive cards get the same face; press feedback comes from the button.
    func feedPanel(padding: CGFloat = DeckSpace.m) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FeedPalette.raised, in: RoundedRectangle(cornerRadius: DeckStyle.cardRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: DeckStyle.cardRadius, style: .continuous)
                .strokeBorder(FeedPalette.line, lineWidth: 1))
    }

    @ViewBuilder
    func feedGlassButton() -> some View {
        if #available(iOS 26.0, *) {
            buttonStyle(.glass).controlSize(.large)
        } else {
            buttonStyle(.bordered).controlSize(.large)
        }
    }

    @ViewBuilder
    func feedCircleGlass() -> some View {
        if #available(iOS 26.0, *) {
            glassEffect(.regular.interactive(), in: Circle())
        } else {
            background(FeedPalette.raised, in: Circle())
                .overlay(Circle().strokeBorder(FeedPalette.line, lineWidth: 1))
        }
    }

    /// A filter control's face, for chips and filter menus: control corners and a hairline. The selected one is bone on
    /// panel (the raised step with a text-1 hairline), as the web's `.fchip.on`: signal marks where you are, never a pick.
    func feedControlFace(selected: Bool, edge: Color = FeedPalette.line) -> some View {
        let shape = RoundedRectangle(cornerRadius: DeckStyle.controlRadius, style: .continuous)
        return background(selected ? FeedPalette.raised2 : FeedPalette.raised, in: shape)
            .overlay(shape.strokeBorder(selected ? FeedPalette.text1 : edge, lineWidth: 1))
            .contentShape(shape)
    }

    /// The one primary action on a card: signal fill, carbon label.
    func feedActionButtonStyle() -> some View {
        buttonStyle(FeedPrimaryButtonStyle())
    }
}

struct FeedPrimaryButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .deckFont(.meta, weight: 600)
            .foregroundStyle(FeedPalette.onSignal)
            .padding(.horizontal, DeckSpace.m)
            .frame(minHeight: DeckSpace.minTap)
            .background(FeedPalette.signal, in: RoundedRectangle(cornerRadius: DeckStyle.controlRadius, style: .continuous))
            .opacity(configuration.isPressed ? 0.85 : 1)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// Outlined second choice, 44 pt.
struct FeedQuietButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .deckFont(.meta, weight: 600)
            .foregroundStyle(FeedPalette.text1)
            .padding(.horizontal, DeckSpace.m)
            .frame(minHeight: DeckSpace.minTap)
            .background(FeedPalette.raised2.opacity(configuration.isPressed ? 1 : 0.6),
                        in: RoundedRectangle(cornerRadius: DeckStyle.controlRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: DeckStyle.controlRadius, style: .continuous)
                .strokeBorder(FeedPalette.lineStrong, lineWidth: 1))
    }
}

/// Press feedback for a tappable card: a short scale, none under Reduce Motion.
struct FeedCardPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.985 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// A section title inside a page. A heading for VoiceOver's rotor; no counts or dates beside it.
struct FeedSectionTitle: View {
    let title: String
    var trailing: AnyView?

    init(_ title: String, trailing: AnyView? = nil) {
        self.title = title
        self.trailing = trailing
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .deckFont(.title)
                .foregroundStyle(FeedPalette.text1)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: DeckSpace.s)
            if let trailing { trailing }
        }
        .padding(.top, DeckSpace.s)
    }
}

/// Lays children out in the page's columns: one on a phone, two on a wide window.
struct FeedGrid<Content: View>: View {
    var spacing: CGFloat = DeckSpace.m
    var maxColumns = 2
    @ViewBuilder let content: Content
    @Environment(\.feedColumns) private var columns

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: spacing, alignment: .top),
                                 count: max(1, min(columns, maxColumns))),
                  alignment: .leading, spacing: spacing) {
            content
        }
    }
}

/// The confidence mark for blended numbers, one mark for web and iOS (DesignSystem ruling 2026-11-14): a capsule meter,
/// 1 pt stroke in line-strong, three equal segments with 1 pt gaps; low fills one, medium two, high three in text 2,
/// empty segments see-through. 20x7 pt at the default size, scaled with `.caption`. No hue, no word; the label is
/// spoken. Place it with `confidenceMeter(_:)`, which keeps it clear of the figure.
struct ConfidenceMeter: View {
    let confidence: DeckConfidence
    var reasons: [String] = []
    @ScaledMetric(relativeTo: .caption) private var width: CGFloat = 20
    @ScaledMetric(relativeTo: .caption) private var height: CGFloat = 7

    var body: some View {
        HStack(spacing: 1) {
            ForEach(0..<3, id: \.self) { index in
                Rectangle().fill(index < confidence.dots ? FeedPalette.text2 : Color.clear)
            }
        }
        .padding(1)
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder(FeedPalette.lineStrong, lineWidth: 1))
        .frame(width: width, height: height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(([confidence.spoken] + reasons.prefix(2)).joined(separator: ", "))
        .accessibilityIdentifier("feeds.confidence")
    }
}

/// A figure followed by its confidence meter, 7 pt clear of the last digit (scaled with `.caption`) and centred on it.
private struct ConfidenceFigure<Figure: View>: View {
    let figure: Figure
    let confidence: DeckConfidence?
    let reasons: [String]
    @ScaledMetric(relativeTo: .caption) private var gap: CGFloat = 7

    var body: some View {
        HStack(alignment: .center, spacing: gap) {
            figure
            if let confidence { ConfidenceMeter(confidence: confidence, reasons: reasons) }
        }
    }
}

extension View {
    /// Puts the confidence meter after this figure and its unit. Nil draws the figure alone.
    func confidenceMeter(_ confidence: DeckConfidence?, reasons: [String] = []) -> some View {
        ConfidenceFigure(figure: self, confidence: confidence, reasons: reasons)
    }
}

/// A number with its label: the label on top, the figure in Geist Mono, then an optional line.
struct FeedStat: View {
    let label: String
    let value: String?
    var caption: String?
    var confidence: DeckConfidence?
    var big = false
    /// Lines the figure may take before it shrinks. A range ("$1,100 to $1,300") needs two: at the figure step it is
    /// 288 pt of Geist Mono, 202 pt at the 0.7 floor, wider than a 164 pt cell, so one line would cut it.
    var lines = 1
    var identifier: String
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .deckFont(.micro)
                .foregroundStyle(FeedPalette.text2)
                .fixedSize(horizontal: false, vertical: true)
            Text(value ?? DeckMissing.sheet)
                .deckFont(value == nil ? .meta : (big ? .figure : .figureRow))
                .foregroundStyle(value == nil ? FeedPalette.text3 : FeedPalette.text1)
                .lineLimit(typeSize.isAccessibilitySize ? nil : lines)
                .fixedSize(horizontal: false, vertical: lines > 1)
                .minimumScaleFactor(typeSize.isAccessibilitySize ? 1 : 0.7)
                .confidenceMeter(value == nil ? nil : confidence)
            if let caption {
                Text(caption)
                    .deckFont(.micro, weight: 400)
                    .foregroundStyle(FeedPalette.text3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(identifier)
    }
}

/// A line chart with no axes, for strips and cards. Gaps in the series are skipped, not drawn as zero.
struct FeedSparkline: View {
    let values: [Double]
    var height: CGFloat = 28

    var body: some View {
        if values.count >= 2 {
            Chart(Array(values.enumerated()), id: \.offset) { item in
                LineMark(x: .value("Step", item.offset), y: .value("Value", item.element))
                    .foregroundStyle(FeedPalette.text2)
                    .interpolationMethod(.monotone)
                if item.offset == values.count - 1 {
                    PointMark(x: .value("Step", item.offset), y: .value("Value", item.element))
                        .foregroundStyle(FeedPalette.signal)
                        .symbolSize(24)
                }
            }
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .chartYScale(domain: (values.min() ?? 0)...(max(values.max() ?? 1, (values.min() ?? 0) + 0.0001)))
            .frame(height: height)
            .accessibilityHidden(true)
        }
    }
}

/// A filter chip, at least 44 pt tall. The selected one is bone on panel, bolder, and carries the selected trait: the
/// pick reads by fill, edge and weight, never by hue.
struct FeedChip: View {
    let title: String
    var count: String?
    let selected: Bool
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: DeckSpace.xs) {
                Text(title)
                    .deckFont(.meta, weight: selected ? 600 : 500)
                    .foregroundStyle(selected ? FeedPalette.text1 : FeedPalette.text2)
                    .multilineTextAlignment(.leading)
                if let count {
                    Text(count)
                        .deckFont(.data)
                        .foregroundStyle(selected ? FeedPalette.text1 : FeedPalette.text3)
                }
            }
            .padding(.horizontal, DeckSpace.s + 6)
            .frame(minWidth: DeckSpace.minTap, minHeight: DeckSpace.minTap)
            .feedControlFace(selected: selected)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityLabel(count.map { "\(title), \($0)" } ?? title)
        .accessibilityIdentifier(identifier)
    }
}

/// Chips in one sideways row with an edge fade, for long category lists on a phone. A row that runs past the edge fades
/// there, so the last chip is never sliced in half with no cue that the row scrolls.
struct FeedChipRow<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: DeckSpace.s) { content }
                .padding(.vertical, 2)
                .padding(.trailing, DeckSpace.m)
        }
        .overlay(alignment: .trailing) {
            LinearGradient(colors: [FeedPalette.bg.opacity(0), FeedPalette.bg],
                           startPoint: .leading, endPoint: .trailing)
                .frame(width: DeckSpace.m + DeckSpace.s)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chips.row")
    }
}

/// Empty, missing and failure states: one panel with one optional action.
struct FeedMessageCard: View {
    let symbol: String
    let title: String
    let message: String
    let identifier: String
    var action: (String, () -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: DeckSpace.s) {
            Label {
                Text(title)
                    .deckFont(.heading)
                    .foregroundStyle(FeedPalette.text1)
            } icon: {
                Image(systemName: symbol)
                    .foregroundStyle(FeedPalette.text2)
                    .accessibilityHidden(true)
            }
            .accessibilityAddTraits(.isHeader)
            Text(message)
                .deckFont(.body)
                .foregroundStyle(FeedPalette.text2)
                .fixedSize(horizontal: false, vertical: true)
            if let action {
                Button(action.0, action: action.1)
                    .feedActionButtonStyle()
                    .padding(.top, DeckSpace.xs)
                    .accessibilityIdentifier("feeds.retry")
            }
        }
        .feedPanel()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
    }
}

/// A deck server that predates a route: one plain line and what to do about it, never an error card.
struct FeedNotServedLine: View {
    var body: some View {
        VStack(alignment: .leading, spacing: DeckSpace.xs) {
            Text("This deck does not have this page yet")
                .deckFont(.body)
                .foregroundStyle(FeedPalette.text2)
            Text("Update the deck server to show it here.")
                .deckFont(.meta)
                .foregroundStyle(FeedPalette.text3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, DeckSpace.m)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("feeds.state.notServed")
    }
}

/// Turns one feed's state into the shared messages, and calls `loaded` only with a loaded page.
struct FeedGate<Loaded: View>: View {
    let feed: String
    let state: DeckFeedState
    let retry: () -> Void
    @ViewBuilder let loaded: (DeckFeedPage) -> Loaded

    var body: some View {
        switch state {
        case .loading:
            HStack(spacing: DeckSpace.s) {
                ProgressView().tint(FeedPalette.text2)
                Text("Loading")
                    .deckFont(.body)
                    .foregroundStyle(FeedPalette.text2)
            }
            .frame(maxWidth: .infinity, minHeight: 120, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("feeds.state.loading")
        case .loaded(let page):
            loaded(page)
        case .notCollected:
            FeedMessageCard(symbol: "tray", title: "No data yet",
                            message: "Your deck has nothing for \(DeckFeedNames.heading(feed)) so far. It checks \(DeckFeedNames.cadence(feed)), so this fills in after the first check.",
                            identifier: "feeds.state.notCollected", action: ("Check again", retry))
        case .notServed:
            FeedNotServedLine()
        case .noRecord:
            Text("No record for this ZIP.")
                .deckFont(.body)
                .foregroundStyle(FeedPalette.text2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, DeckSpace.m)
                .accessibilityIdentifier("feeds.state.noRecord")
        case .ownerOnly:
            FeedMessageCard(symbol: "person.crop.circle.badge.exclamationmark", title: "Owner only",
                            message: "This deck shares \(DeckFeedNames.heading(feed)) with its owner's sign-in only.",
                            identifier: "feeds.state.ownerOnly")
        case .signedOut:
            FeedMessageCard(symbol: "key", title: "Sign in to your deck",
                            message: "Open your deck once, then come back here.", identifier: "feeds.state.signedOut")
        case .failed(let reason):
            FeedMessageCard(symbol: "exclamationmark.triangle", title: "\(DeckFeedNames.heading(feed)) is not reporting",
                            message: reason, identifier: "feeds.state.failed", action: ("Try again", retry))
        }
    }
}

/// "Show amounts" for money the deck hides by default (budget and stake figures). Held 30 s, then hidden again.
struct FeedAmountsToggle: View {
    @Binding var shown: Bool

    var body: some View {
        Button(shown ? "Hide" : "Show amounts") { shown.toggle() }
            .buttonStyle(FeedQuietButtonStyle())
            .accessibilityLabel(shown ? "Hide amounts" : "Show amounts")
            .accessibilityHint(shown ? "Hides budget and stake figures now." : "Shows budget and stake figures for 30 seconds.")
            .accessibilityIdentifier("feeds.amounts")
            .task(id: shown) {
                guard shown else { return }
                try? await Task.sleep(for: .seconds(30))
                if !Task.isCancelled { shown = false }
            }
    }
}


// MARK: Freshness and Data

/// The one freshness mark per section. It opens the Data sheet; it turns into a warning only when stale or a part
/// failed. A feed not collected yet reads "Building" in the quiet colour, like the card under it: new is not an alarm.
struct FeedFreshnessMark: View {
    let mark: DeckFreshness
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            Label {
                Text(mark.text)
                    .deckFont(.micro)
            } icon: {
                Image(systemName: Self.symbol(mark.kind))
                    .accessibilityHidden(true)
            }
            .foregroundStyle(mark.kind == .fresh || mark.kind == .building ? FeedPalette.text2 : FeedPalette.warn)
            .padding(.horizontal, DeckSpace.s + 2)
            .frame(minHeight: DeckSpace.minTap)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(mark.kind == .fresh ? "Updated \(mark.text) ago" : mark.text)
        .accessibilityHint("Opens the Data sheet")
        .accessibilityIdentifier("feeds.status")
    }
}

extension FeedFreshnessMark {
    static func symbol(_ kind: DeckFreshness.Kind) -> String {
        switch kind {
        case .fresh: return "clock"
        case .building: return "hourglass"
        case .stale, .missing: return "exclamationmark.triangle.fill"
        }
    }
}

/// What the Data sheet lists for one section or one detail.
struct FeedDataContent: Identifiable {
    let id = UUID()
    let title: String
    let sources: [DeckSourceRow]
    let notes: [String]
    var blends: [(title: String, parts: [DeckBlendPart])] = []
    /// What the section is for, in one line: on a phone the page no longer prints it under a title.
    var about: String? = nil
}

/// What the section is for, sources with their dates and states, then the blends and method notes the pages no longer print.
struct FeedDataSheet: View {
    let content: FeedDataContent
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if let about = content.about {
                    Text(about)
                        .deckFont(.body)
                        .foregroundStyle(FeedPalette.text2)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(FeedPalette.raised)
                        .accessibilityIdentifier("feeds.data.about")
                }
                if !content.sources.isEmpty {
                    Section {
                        ForEach(content.sources) { row in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(alignment: .firstTextBaseline) {
                                    Text(row.name)
                                        .deckFont(.body, weight: 500)
                                        .foregroundStyle(FeedPalette.text1)
                                    Spacer(minLength: DeckSpace.s)
                                    stateLabel(row.state)
                                }
                                let line = [row.detail, row.asOf.map { "As of \($0)" }].compactMap { $0 }.joined(separator: " · ")
                                if !line.isEmpty {
                                    Text(line)
                                        .deckFont(.meta)
                                        .foregroundStyle(FeedPalette.text2)
                                }
                                if let note = row.note {
                                    Text(note)
                                        .deckFont(.meta)
                                        .foregroundStyle(FeedPalette.text3)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                            .padding(.vertical, 2)
                            .accessibilityElement(children: .combine)
                            .listRowBackground(FeedPalette.raised)
                        }
                    } header: { header("Sources") }
                }
                ForEach(Array(content.blends.enumerated()), id: \.offset) { _, blend in
                    Section {
                        ForEach(blend.parts) { part in
                            HStack(alignment: .firstTextBaseline) {
                                Text(part.label)
                                    .deckFont(.body)
                                    .foregroundStyle(FeedPalette.text1)
                                Spacer(minLength: DeckSpace.s)
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text(part.value).deckFont(.figureRow, weight: 400).foregroundStyle(FeedPalette.text1)
                                    if let weight = part.weight {
                                        Text(weight).deckFont(.data).foregroundStyle(FeedPalette.text3)
                                    }
                                }
                            }
                            .accessibilityElement(children: .combine)
                            .listRowBackground(FeedPalette.raised)
                        }
                    } header: { header(blend.title) }
                }
                if !content.notes.isEmpty {
                    Section {
                        ForEach(Array(content.notes.enumerated()), id: \.offset) { _, note in
                            Text(note)
                                .deckFont(.meta)
                                .foregroundStyle(FeedPalette.text2)
                                .fixedSize(horizontal: false, vertical: true)
                                .listRowBackground(FeedPalette.raised)
                        }
                    } header: { header("Method") }
                }
                if content.sources.isEmpty && content.notes.isEmpty && content.blends.isEmpty {
                    Text("Nothing has loaded for this section yet.")
                        .deckFont(.body)
                        .foregroundStyle(FeedPalette.text2)
                        .listRowBackground(FeedPalette.raised)
                }
            }
            .scrollContentBackground(.hidden)
            .background(FeedPalette.bg.ignoresSafeArea())
            .navigationTitle("Data: \(content.title)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("feeds.data.done")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .accessibilityIdentifier("feeds.data.sheet")
    }

    private func header(_ text: String) -> some View {
        Text(text)
            .deckFont(.meta, weight: 600)
            .foregroundStyle(FeedPalette.text2)
            .textCase(nil)
    }

    private func stateLabel(_ state: DeckSourceRow.State) -> some View {
        Label {
            Text(state.word).deckFont(.micro)
        } icon: {
            Image(systemName: state == .ok ? "checkmark.circle" : "exclamationmark.triangle")
                .accessibilityHidden(true)
        }
        .foregroundStyle(state == .ok ? FeedPalette.ok : FeedPalette.warn)
        .labelStyle(.titleAndIcon)
    }
}

/// A "Data" text button at the foot of a detail sheet, scoped to that detail.
struct FeedDataLink: View {
    let open: () -> Void

    var body: some View {
        Button("Data", action: open)
            .buttonStyle(FeedQuietButtonStyle())
            .accessibilityLabel("Data sources")
            .accessibilityHint("Opens the sources, dates and method for this detail.")
            .accessibilityIdentifier("feeds.data.link")
    }
}
