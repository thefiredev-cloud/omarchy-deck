import Charts
import SwiftUI

/// Real estate (2026-11-14): every US ZIP from the national routes (NationalApi.md). Page blueprint §3, native cut:
/// the scope bar (United States or a state, plus "ZIP or city"), the US market strip, best ZIPs for the scope with a
/// sort, and a ZIP sheet with its blended metrics. Blended numbers carry the confidence meter; raw readings carry none.
/// No source text on the page: sources, coverage and score weights live in the Data sheet.
/// 2026-11-17 (web parity): two pages, Residential and Markets. Best ZIPs shows the owner's data points per ZIP
/// (`BestZips`), the 30-yr rate once in its header, a Residential and a Multifamily lens, sorts the deck can rank on
/// (a second tap flips the direction), a dash for a missing value and a county or metro tag on an area value.
struct DeckNationalContent: View {
    @ObservedObject var store: DeckFeedStore
    let retry: () -> Void
    let openData: (FeedDataContent) -> Void

    @AppStorage("deck.realestate.page") private var pageRaw = RealEstatePage.residential.rawValue
    @AppStorage("deck.realestate.lens") private var lensRaw = BestZipsLens.residential.rawValue
    @State private var scope = NationalRoutes.Scope()
    @State private var search = ""
    @State private var openZip: NationalZipRef?
    @Environment(\.feedColumns) private var columns
    @Environment(\.dynamicTypeSize) private var typeSize

    private var page: RealEstatePage { RealEstatePage(rawValue: pageRaw) ?? .residential }

    private var catalogState: DeckFeedState { store.state(NationalRoutes.fields) }

    private var catalog: NationalCatalog? {
        if case .loaded(let page) = catalogState { return page.nationalCatalog }
        return nil
    }

    /// The catalog answered one way or another: a deck without it (404, v1) ranks with the server's default columns.
    private var catalogSettled: Bool {
        if case .loading = catalogState { return false }
        return true
    }

    /// The lens needs v2 data: on v1 only the Residential columns exist.
    private var lens: BestZipsLens {
        catalog?.isV2 == true ? (BestZipsLens(rawValue: lensRaw) ?? .residential) : .residential
    }

    /// The scope as asked, with a sort the lens has (a saved Multifamily lens never ranks by Score).
    private var effectiveScope: NationalRoutes.Scope {
        var s = scope
        let sort = BestZips.lensSort(lens, sort: s.sort, catalog: catalog)
        if sort != s.sort {
            s.sort = sort
            s.dir = nil
        }
        return s
    }

    private var rankFeed: String { NationalRoutes.rank(effectiveScope, cols: BestZips.rankCols(catalog)) }

    private var currentRank: NationalRank? {
        if case .loaded(let page) = store.state(rankFeed) { return page.nationalRank }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DeckSpace.l) {
            RealEstateSegmented(title: "Real estate page",
                                options: RealEstatePage.allCases.map { RealEstateOption(id: $0.rawValue, title: $0.title) },
                                selected: page.rawValue, identifier: "realestate.page") { pageRaw = $0 }
            switch page {
            case .residential:
                residential
            case .markets:
                DeckMarketsContent(store: store, openData: openData) { state in
                    // A state's sheet opens Best ZIPs for that state.
                    search = ""
                    scope.query = nil
                    scope.state = state
                    scope.limit = NationalRoutes.pageSize
                    pageRaw = RealEstatePage.residential.rawValue
                }
            }
        }
        .sheet(item: $openZip) { ref in
            NationalZipSheet(zip: ref.zip, store: store)
        }
    }

    private var residential: some View {
        FeedGate(feed: NationalRoutes.summary, state: store.state(NationalRoutes.summary), retry: retry) { page in
            VStack(alignment: .leading, spacing: DeckSpace.l) {
                scopeBar
                if let summary = page.national { strip(summary) }
                bestZips(page.national)
            }
        }
        .task { await store.loadDetail(NationalRoutes.fields) }
        .task(id: catalogSettled ? rankFeed : "") {
            if catalogSettled { await store.loadDetail(rankFeed) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("national.content")
    }

    // MARK: Scope

    private var scopeBar: some View {
        VStack(alignment: .leading, spacing: DeckSpace.s + 4) {
            HStack(spacing: DeckSpace.s) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(FeedPalette.text2)
                    .accessibilityHidden(true)
                TextField("ZIP or city", text: $search)
                    .deckFont(.body)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .onSubmit(submit)
                    .accessibilityLabel("ZIP or city")
                    .accessibilityIdentifier("national.search")
                if !search.isEmpty || scope.query != nil {
                    Button {
                        search = ""
                        scope.query = nil
                        scope.limit = NationalRoutes.pageSize
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(FeedPalette.text3)
                            .frame(minWidth: DeckSpace.minTap, minHeight: DeckSpace.minTap)
                            .contentShape(.rect)
                    }
                    // The 44 pt frame sits inside the label: a frame outside a plain Button adds layout space, not hit area.
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear search")
                }
            }
            .padding(.leading, DeckSpace.s + 4)
            .frame(minHeight: DeckSpace.minTap)
            .background(FeedPalette.raised2, in: RoundedRectangle(cornerRadius: DeckStyle.controlRadius))
            .overlay(RoundedRectangle(cornerRadius: DeckStyle.controlRadius).strokeBorder(FeedPalette.lineStrong, lineWidth: 1))
            RealEstateFlow(spacing: DeckSpace.s) {
                FeedChip(title: "United States", selected: scope.state == nil, identifier: "national.scope.us") {
                    scope.state = nil
                    scope.limit = NationalRoutes.pageSize
                }
                Menu {
                    ForEach(NationalRoutes.states, id: \.self) { state in
                        Button(state) {
                            scope.state = state
                            scope.limit = NationalRoutes.pageSize
                        }
                    }
                } label: {
                    Label(scope.state.map { "State: \($0)" } ?? "State", systemImage: "map")
                        .deckFont(.meta, weight: 600)
                        .foregroundStyle(FeedPalette.text1)
                        .padding(.horizontal, DeckSpace.s + 6)
                        .frame(minHeight: DeckSpace.minTap)
                        .feedControlFace(selected: scope.state != nil, edge: FeedPalette.lineStrong)
                }
                .accessibilityLabel("State")
                .accessibilityValue(scope.state ?? "None")
                .accessibilityIdentifier("national.scope.state")
            }
        }
    }

    /// Five digits open that ZIP; words search cities, counties and metros in the scope.
    private func submit() {
        let text = search.trimmingCharacters(in: .whitespaces)
        if NationalRoutes.isZip(text) {
            openZip = NationalZipRef(zip: text)
        } else if let query = NationalRoutes.cleanQuery(text) {
            scope.query = query
            scope.limit = NationalRoutes.pageSize
        }
    }

    // MARK: Strip

    private func strip(_ summary: NationalSummary) -> some View {
        VStack(alignment: .leading, spacing: DeckSpace.s + 4) {
            FeedSectionTitle("United States")
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: DeckSpace.s + 4, alignment: .top),
                                     count: DeckLayout.tileColumns(wanted: columns > 1 ? 3 : 2,
                                                                   accessibilityText: typeSize.isAccessibilitySize)),
                      alignment: .leading, spacing: DeckSpace.s + 4) {
                // A figure alone: a missing one reads "No data" (FeedStat), never the dot.
                ForEach(summary.tiles) { tile in
                    FeedStat(label: tile.label, value: tile.value, identifier: tile.id)
                        .feedPanel(padding: DeckSpace.s + 4)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("national.strip")
    }

    // MARK: Best ZIPs

    private func setLens(_ raw: String) {
        guard raw != lens.rawValue, let next = BestZipsLens(rawValue: raw) else { return }
        lensRaw = next.rawValue
        let sort = BestZips.lensSort(next, sort: scope.sort, catalog: catalog)
        if sort != scope.sort {
            scope.sort = sort
            scope.dir = nil
            scope.limit = NationalRoutes.pageSize
        }
    }

    /// A new sort ranks best first; a second tap on the sorted chip flips the direction the server used (v2 only).
    private func pickSort(_ key: String) {
        let current = effectiveScope
        if key == current.sort {
            guard catalog?.isV2 == true else { return }
            scope.sort = key
            scope.dir = BestZips.direction(currentRank, sort: key) == "asc" ? "desc" : "asc"
        } else {
            scope.sort = key
            scope.dir = nil
        }
        scope.limit = NationalRoutes.pageSize
    }

    private func bestZips(_ summary: NationalSummary?) -> some View {
        let current = effectiveScope
        let feed = rankFeed
        let rate = BestZips.rateLine(summary)
        return VStack(alignment: .leading, spacing: DeckSpace.s + 4) {
            VStack(alignment: .leading, spacing: 2) {
                FeedSectionTitle("Best ZIPs: \(current.title)")
                // The 30-yr rate is national: once here, never in a ZIP's row.
                if let rate {
                    Text(rate)
                        .deckFont(.meta)
                        .foregroundStyle(FeedPalette.text2)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("national.rate")
                }
            }
            if catalog?.isV2 == true {
                RealEstateSegmented(title: "Lens",
                                    options: BestZipsLens.allCases.map { RealEstateOption(id: $0.rawValue, title: $0.title) },
                                    selected: lens.rawValue, identifier: "national.lens") { setLens($0) }
            }
            FeedChipRow {
                ForEach(BestZips.sorts(lens, catalog: catalog), id: \.key) { sort in
                    let on = current.sort == sort.key
                    FeedChip(title: sort.title, selected: on, identifier: "national.sort.\(sort.key)") { pickSort(sort.key) }
                        .accessibilityValue(on ? (BestZips.direction(currentRank, sort: sort.key) == "asc" ? "Lowest first" : "Highest first") : "")
                        .accessibilityHint(on && catalog?.isV2 == true ? "Tap again to flip the order" : "Ranks the ZIPs by this")
                }
            }
            if !catalogSettled {
                FeedGate(feed: NationalRoutes.fields, state: .loading, retry: {}) { _ in EmptyView() }
            } else {
                FeedGate(feed: feed, state: store.state(feed), retry: { Task { await store.loadDetail(feed) } }) { page in
                    if let rank = page.nationalRank {
                        bestList(rank, scope: current, rate: rate != nil)
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("national.best")
    }

    @ViewBuilder
    private func bestList(_ rank: NationalRank, scope current: NationalRoutes.Scope, rate: Bool) -> some View {
        let columns = BestZips.columns(lens, isV2: rank.isV2, have: rank.have)
        Text(BestZips.sortLine(current.sort, direction: BestZips.direction(rank, sort: current.sort)))
            .deckFont(.meta)
            .foregroundStyle(FeedPalette.text2)
            .accessibilityIdentifier("national.sortline")
        if rank.rows.isEmpty {
            Text("No ZIPs match. Loosen a filter.")
                .deckFont(.body)
                .foregroundStyle(FeedPalette.text2)
        } else {
            FeedGrid {
                ForEach(rank.rows) { row in
                    Button { openZip = NationalZipRef(zip: row.zip) } label: {
                        NationalZipCard(row: row, columns: columns, isV2: rank.isV2, lens: lens)
                    }
                    .buttonStyle(FeedCardPressStyle())
                    .accessibilityIdentifier("national.zip.\(row.zip)")
                }
            }
            if let total = rank.total, total > rank.rows.count, scope.limit < 200 {
                Button("Show \(min(NationalRoutes.pageSize, total - rank.rows.count)) more") {
                    scope.limit = min(200, scope.limit + NationalRoutes.pageSize)
                }
                .feedActionButtonStyle()
                .accessibilityIdentifier("national.more")
            }
            BestZipsHelp(columns: columns, rate: rate)
        }
    }
}

/// The two Real estate pages, as on the web deck.
enum RealEstatePage: String, CaseIterable {
    case residential, markets

    var title: String {
        switch self {
        case .residential: return "Residential"
        case .markets: return "Markets"
        }
    }
}

struct RealEstateOption: Identifiable, Equatable {
    let id: String
    let title: String
}

/// A segmented choice (page, lens, level): each option a 44 pt control, the picked one bone on panel with the selected
/// trait, never by hue. At accessibility text sizes the options stack.
struct RealEstateSegmented: View {
    let title: String
    let options: [RealEstateOption]
    let selected: String
    let identifier: String
    let pick: (String) -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: DeckSpace.xs))
            : AnyLayout(HStackLayout(spacing: DeckSpace.xs))
        layout {
            ForEach(options) { option in
                let on = option.id == selected
                Button { pick(option.id) } label: {
                    Text(option.title)
                        .deckFont(.meta, weight: on ? 600 : 500)
                        .foregroundStyle(on ? FeedPalette.text1 : FeedPalette.text2)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, DeckSpace.s)
                        .frame(maxWidth: .infinity, minHeight: DeckSpace.minTap)
                        .feedControlFace(selected: on)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(option.title)
                .accessibilityAddTraits(on ? [.isSelected] : [])
                .accessibilityIdentifier("\(identifier).\(option.id)")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title)
        .accessibilityIdentifier(identifier)
    }
}

/// What the columns mean: one plain line per column, the 30-yr rate, the meter, the dash and the area tags.
struct BestZipsHelp: View {
    let columns: [BestZipColumn]
    let rate: Bool
    @State private var open = false

    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: DeckSpace.s) {
                ForEach(Array(BestZips.help(columns, rate: rate).enumerated()), id: \.offset) { _, row in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.term).deckFont(.meta, weight: 600).foregroundStyle(FeedPalette.text1)
                        Text(row.meaning).deckFont(.meta).foregroundStyle(FeedPalette.text2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(.top, DeckSpace.s)
        } label: {
            Text("What the columns mean")
                .deckFont(.meta, weight: 600)
                .foregroundStyle(FeedPalette.signalText)
                .frame(minHeight: DeckSpace.minTap, alignment: .leading)
        }
        .tint(FeedPalette.text2)
        .accessibilityIdentifier("national.help")
    }
}

struct NationalZipRef: Identifiable, Equatable {
    var id: String { zip }
    let zip: String
}

/// One ZIP of Best ZIPs: rank, ZIP and place (with the overall score and rental grade on the Residential lens), then
/// the lens's columns. A missing value is a dash VoiceOver reads as not reported; an area value carries its tag.
struct NationalZipCard: View {
    let row: NationalZipRow
    let columns: [BestZipColumn]
    let isV2: Bool
    let lens: BestZipsLens
    @Environment(\.dynamicTypeSize) private var typeSize

    private var grid: [GridItem] {
        let count = typeSize.isAccessibilitySize ? 1 : (typeSize >= .xxLarge ? 2 : 3)
        return Array(repeating: GridItem(.flexible(), spacing: DeckSpace.m, alignment: .topLeading), count: count)
    }

    /// One spoken summary: VoiceOver meets every column in order, a dash read as not reported, a tag as an area value.
    private var spoken: String {
        var parts = [row.rank.map { "\($0)" }, row.zip, row.place.isEmpty ? nil : row.place].compactMap { $0 }
        if lens == .residential {
            parts.append("Score " + (NationalWords.score(row.score) ?? DeckMissing.sheet) + (row.grade.map { ", rental grade \($0)" } ?? ""))
        }
        parts += columns.map { BestZips.cell(row, $0, isV2: isV2).spoken }
        return parts.joined(separator: ", ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DeckSpace.s + 4) {
            HStack(alignment: .firstTextBaseline, spacing: DeckSpace.s) {
                if let rank = row.rank {
                    Text("\(rank)").deckFont(.data).foregroundStyle(FeedPalette.text2)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.zip).deckFont(.figureRow).foregroundStyle(FeedPalette.text1)
                    if !row.place.isEmpty {
                        Text(row.place).deckFont(.meta).foregroundStyle(FeedPalette.text2)
                            .lineLimit(typeSize.isAccessibilitySize ? nil : 1)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: DeckSpace.s)
                if lens == .residential {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(NationalWords.score(row.score) ?? "No score")
                            .deckFont(row.score == nil ? .meta : .figure)
                            .foregroundStyle(FeedPalette.text1)
                            .confidenceMeter(row.score == nil ? nil : row.scoreConfidence)
                        if let grade = row.grade {
                            Text("Grade \(grade)").deckFont(.micro).foregroundStyle(FeedPalette.text2)
                        }
                    }
                    .accessibilityHidden(true)
                }
            }
            LazyVGrid(columns: grid, alignment: .leading, spacing: DeckSpace.s + 4) {
                ForEach(columns) { column in
                    fact(column)
                }
            }
        }
        .feedPanel()
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
        .accessibilityHint("Opens the ZIP")
    }

    private func fact(_ column: BestZipColumn) -> some View {
        let cell = BestZips.cell(row, column, isV2: isV2)
        return VStack(alignment: .leading, spacing: 2) {
            Text(column.label)
                .deckFont(.micro, weight: 400)
                .foregroundStyle(FeedPalette.text2)
                .fixedSize(horizontal: false, vertical: true)
            Text(cell.text ?? BestZips.dash)
                .deckFont(.data)
                .foregroundStyle(cell.text == nil ? FeedPalette.text3 : FeedPalette.text1)
                .lineLimit(typeSize.isAccessibilitySize ? nil : 1)
                .minimumScaleFactor(typeSize.isAccessibilitySize ? 1 : 0.8)
                .confidenceMeter(cell.confidence)
            if let from = cell.from {
                Text(BestZips.fromTag(from))
                    .deckFont(.micro, weight: 400)
                    .foregroundStyle(FeedPalette.text3)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityHidden(true)
    }
}

/// One ZIP: head, score and grade, the four tiles, then each section of blended metrics and raw readings.
struct NationalZipSheet: View {
    let zip: String
    @ObservedObject var store: DeckFeedStore
    @State private var data: FeedDataContent?
    @Environment(\.dismiss) private var dismiss
    /// The plot grows with the axis labels: a fixed 140 pt left three AX5 labels no room to stay apart.
    @ScaledMetric(relativeTo: .caption) private var chartHeight: CGFloat = 140

    private var feed: String { NationalRoutes.zip(zip) }

    var body: some View {
        NavigationStack {
            ScrollView {
                FeedGate(feed: feed, state: store.state(feed), retry: { Task { await store.loadDetail(feed) } }) { page in
                    if let detail = page.nationalZip { content(detail) }
                }
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
                .padding(DeckSpace.m)
            }
            .background(FeedPalette.bg.ignoresSafeArea())
            .navigationTitle("ZIP \(zip)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("national.sheet.done")
                }
            }
            .sheet(item: $data) { FeedDataSheet(content: $0) }
        }
        .task { await store.loadDetail(feed) }
        .accessibilityIdentifier("national.sheet")
    }

    private func content(_ detail: NationalZip) -> some View {
        VStack(alignment: .leading, spacing: DeckSpace.m) {
            VStack(alignment: .leading, spacing: 4) {
                Text(detail.place.isEmpty ? detail.zip : detail.place)
                    .deckFont(.title)
                    .foregroundStyle(FeedPalette.text1)
                Text([detail.county, detail.metro].compactMap { $0 }.joined(separator: " · "))
                    .deckFont(.meta)
                    .foregroundStyle(FeedPalette.text2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            RealEstateBlock(title: "Score", identifier: "national.sheet.score") {
                HStack(alignment: .firstTextBaseline, spacing: DeckSpace.s) {
                    Text(NationalWords.score(detail.score) ?? "Not enough data to score this ZIP.")
                        .deckFont(detail.score == nil ? .body : .figure)
                        .foregroundStyle(FeedPalette.text1)
                        .confidenceMeter(detail.score == nil ? nil : detail.scoreConfidence)
                    Spacer()
                    if let grade = detail.grade {
                        Text("Rental grade \(grade)").deckFont(.body, weight: 500).foregroundStyle(FeedPalette.text1)
                    }
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: DeckSpace.m, alignment: .top)],
                          alignment: .leading, spacing: DeckSpace.m) {
                    ForEach(detail.tiles) { fact in
                        // A value the build rejected draws as missing ("No data") with its reason under it; an area
                        // value carries its "county value" or "metro value" tag.
                        FeedStat(label: fact.label, value: fact.note == nil ? fact.value : nil,
                                 caption: fact.note ?? fact.from.map { BestZips.fromTag($0) },
                                 confidence: fact.confidence, big: true,
                                 identifier: "national.sheet.tile.\(fact.key)")
                    }
                }
                if detail.valueHistory.count >= 2 {
                    Chart(detail.valueHistory) { point in
                        LineMark(x: .value("Month", point.period), y: .value("Value", point.value))
                            .foregroundStyle(FeedPalette.text1)
                            .interpolationMethod(.monotone)
                    }
                    .chartXAxis(.hidden)
                    .chartYAxis {
                        AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { value in
                            AxisGridLine().foregroundStyle(FeedPalette.line)
                            AxisValueLabel {
                                if let v = value.as(Double.self) {
                                    Text(DeckMoney.short(v)).deckFont(.data).foregroundStyle(FeedPalette.text2)
                                }
                            }
                        }
                    }
                    .frame(height: chartHeight)
                    .accessibilityLabel("Home value from \(detail.valueHistory.first.map { DeckMoney.short($0.value) } ?? DeckMissing.sheet) in \(detail.valueHistory.first?.period ?? "") to \(detail.valueHistory.last.map { DeckMoney.short($0.value) } ?? DeckMissing.sheet) in \(detail.valueHistory.last?.period ?? "")")
                }
            }
            FeedGrid {
                ForEach(detail.sections) { section in
                    RealEstateBlock(title: section.title, identifier: "national.sheet.section.\(section.title)") {
                        ForEach(section.facts) { fact in
                            HStack(alignment: .firstTextBaseline) {
                                Text(fact.label).deckFont(.body).foregroundStyle(FeedPalette.text1)
                                Spacer(minLength: DeckSpace.s)
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text(fact.note.map { "\(fact.value), \($0)" } ?? fact.value)
                                        .deckFont(fact.note == nil ? .figureRow : .meta, weight: 400)
                                        .foregroundStyle(fact.note == nil ? FeedPalette.text1 : FeedPalette.text3)
                                        .confidenceMeter(fact.confidence)
                                    if let from = fact.from {
                                        Text(BestZips.fromTag(from))
                                            .deckFont(.micro, weight: 400)
                                            .foregroundStyle(FeedPalette.text3)
                                    }
                                }
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
            }
            FeedDataLink {
                let blends = (detail.tiles + detail.sections.flatMap(\.facts)).filter { !$0.parts.isEmpty }
                    .map { (title: $0.label, parts: $0.parts) }
                var sources: [DeckSourceRow] = []
                if case .loaded(let page) = store.state(NationalRoutes.sources) { sources = page.sources }
                data = FeedDataContent(title: "ZIP \(detail.zip)", sources: sources, notes: [], blends: blends)
            }
        }
    }
}
