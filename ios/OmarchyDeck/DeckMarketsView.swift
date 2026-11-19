import SwiftUI

/// Real estate > Markets (owner order 2026-11-17), the native twin of the web deck's Markets page: a level (States,
/// Metros, Your markets), segment chips from the spec, a ranked list sorted by the segment's lead in its better
/// direction (a sort menu picks another field; the order button flips it), and a sheet with every segment for one state
/// or metro. A field too few places publish stays in the sheet only. Values only on the page; sources and method live in
/// the Markets Data sheet. Pure models in `DeckMarkets.swift`.
struct DeckMarketsContent: View {
    @ObservedObject var store: DeckFeedStore
    let openData: (FeedDataContent) -> Void
    /// Opens Best ZIPs for a state (a state's sheet offers it).
    let openState: (String) -> Void

    @AppStorage("deck.markets.level") private var levelRaw = MarketsLevel.states.rawValue
    @AppStorage("deck.markets.segment") private var segmentId = "residential"
    @State private var sorts: [String: MarketsSort] = [:]
    @State private var query = ""
    @State private var shown = Markets.page
    @State private var openRow: MarketsRowRef?
    @Environment(\.dynamicTypeSize) private var typeSize

    private var level: MarketsLevel { MarketsLevel(rawValue: levelRaw) ?? .states }

    private var spec: MarketsSpec? {
        if case .loaded(let page) = store.state(NationalRoutes.segments) { return page.marketsSpec }
        return nil
    }

    private var segment: MarketsSegment? { Markets.segment(spec, id: segmentId) }

    private var queries: [String] {
        segment.map { Markets.listQueries(level, $0).map(\.feed) } ?? []
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DeckSpace.m) {
            RealEstateSegmented(title: "Level",
                                options: MarketsLevel.allCases.map { RealEstateOption(id: $0.rawValue, title: $0.title) },
                                selected: level.rawValue, identifier: "markets.level") { raw in
                levelRaw = raw
                shown = Markets.page
            }
            FeedGate(feed: NationalRoutes.segments, state: store.state(NationalRoutes.segments),
                     retry: { Task { await store.loadDetail(NationalRoutes.segments) } }) { page in
                if let spec = page.marketsSpec { content(spec) }
            }
        }
        .task { await store.loadDetail(NationalRoutes.segments) }
        .task(id: queries) {
            for feed in queries { await store.loadDetail(feed) }
        }
        .sheet(item: $openRow) { ref in
            if let spec {
                MarketsRowSheet(ref: ref, spec: spec, store: store) { state in
                    openRow = nil
                    openState(state)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("markets.content")
    }

    @ViewBuilder
    private func content(_ spec: MarketsSpec) -> some View {
        if let segment = Markets.segment(spec, id: segmentId) {
            FeedChipRow {
                ForEach(spec.segments) { item in
                    FeedChip(title: item.label, selected: item.id == segment.id, identifier: "markets.segment.\(item.id)") {
                        segmentId = item.id
                        shown = Markets.page
                    }
                }
            }
            .accessibilityLabel("Segment")
            searchField
            list(spec, segment: segment)
        } else {
            Text(spec.reason ?? "No segments in the national data yet.")
                .deckFont(.body)
                .foregroundStyle(FeedPalette.text2)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("markets.empty")
        }
    }

    private var searchField: some View {
        HStack(spacing: DeckSpace.s) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(FeedPalette.text2)
                .accessibilityHidden(true)
            TextField("Find a state or metro", text: $query)
                .deckFont(.body)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .onChange(of: query) { _, _ in shown = Markets.page }
                .accessibilityLabel("Find a state or metro")
                .accessibilityIdentifier("markets.search")
            if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(FeedPalette.text3)
                        .frame(minWidth: DeckSpace.minTap, minHeight: DeckSpace.minTap)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.leading, DeckSpace.s + 4)
        .frame(minHeight: DeckSpace.minTap)
        .background(FeedPalette.raised2, in: RoundedRectangle(cornerRadius: DeckStyle.controlRadius))
        .overlay(RoundedRectangle(cornerRadius: DeckStyle.controlRadius).strokeBorder(FeedPalette.lineStrong, lineWidth: 1))
    }

    /// The lists this level needs, once all have answered; else the first one's state (loading or a failure).
    private func pending() -> String? {
        queries.first { feed in
            if case .loaded = store.state(feed) { return false }
            return true
        }
    }

    @ViewBuilder
    private func list(_ spec: MarketsSpec, segment: MarketsSegment) -> some View {
        if let waiting = pending() {
            FeedGate(feed: waiting, state: store.state(waiting), retry: { Task { await store.loadDetail(waiting) } }) { _ in EmptyView() }
        } else {
            let lists = queries.reduce(into: [String: [MarketsRow]]()) { out, feed in
                if case .loaded(let page) = store.state(feed), let part = NationalRoutes.listPart(feed) {
                    out[part] = page.marketRows ?? []
                }
            }
            let rows = Markets.rows(level, states: lists["states"] ?? [], metros: lists["metros"] ?? [])
            let table = Markets.table(level: level, segment: segment, fields: spec.fields, rows: rows, sort: sorts[segment.id],
                                      query: query, shown: shown)
            ranked(table, spec: spec, segment: segment)
        }
    }

    @ViewBuilder
    private func ranked(_ table: MarketsTable, spec: MarketsSpec, segment: MarketsSegment) -> some View {
        if table.cols.isEmpty {
            Text("No \(segment.label.lowercased()) values for these markets yet.")
                .deckFont(.body)
                .foregroundStyle(FeedPalette.text2)
                .accessibilityIdentifier("markets.none")
        } else {
            VStack(alignment: .leading, spacing: DeckSpace.s + 4) {
                FeedSectionTitle("\(segment.label) \u{00B7} \(level.title)")
                if let line = Markets.headLine(table, fields: spec.fields) {
                    Text(line)
                        .deckFont(.meta)
                        .foregroundStyle(FeedPalette.text2)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("markets.headline")
                }
                sortControls(table, spec: spec, segment: segment)
                if table.rows.isEmpty {
                    Text("Nothing matches \u{201C}\(table.query)\u{201D}.")
                        .deckFont(.body)
                        .foregroundStyle(FeedPalette.text2)
                } else {
                    FeedGrid {
                        ForEach(table.rows.prefix(table.shown)) { row in
                            Button {
                                openRow = MarketsRowRef(kind: row.kind, key: row.key, name: row.name, full: row.full, sub: row.sub)
                            } label: {
                                MarketsRowCard(row: row, table: table, fields: spec.fields)
                            }
                            .buttonStyle(FeedCardPressStyle())
                            .accessibilityIdentifier("markets.row.\(row.key)")
                        }
                    }
                    if table.total > table.shown {
                        Button("Show \(min(Markets.page, table.total - table.shown)) more") { shown += Markets.page }
                            .feedActionButtonStyle()
                            .accessibilityIdentifier("markets.more")
                    }
                }
                if !table.hidden.isEmpty {
                    let names = Markets.labels(table.hidden, spec.fields)
                    Text("Not reported here: " + table.hidden.map { names[$0] ?? $0 }.joined(separator: ", ") + ".")
                        .deckFont(.meta)
                        .foregroundStyle(FeedPalette.text3)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("markets.hidden")
                }
                FeedDataLink {
                    let data = Markets.data(fields: spec.fields, segment: segment, cols: table.cols, hidden: table.hidden,
                                            sparse: table.sparse, pairs: table.pairs)
                    openData(FeedDataContent(title: "Markets: \(segment.label)", sources: data.sources, notes: data.notes))
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("markets.list")
        }
    }

    /// The sort field (a menu of the columns on screen) and its order (one button that flips it).
    private func sortControls(_ table: MarketsTable, spec: MarketsSpec, segment: MarketsSegment) -> some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: DeckSpace.s))
            : AnyLayout(HStackLayout(alignment: .center, spacing: DeckSpace.s))
        let current = table.sort.key.map { table.labels[$0] ?? Markets.label(spec.fields, $0) } ?? ""
        return layout {
            Menu {
                ForEach(table.cols, id: \.self) { key in
                    Button {
                        sorts[segment.id] = Markets.nextSort(key == table.sort.key ? nil : table.sort, key: key, fields: spec.fields)
                    } label: {
                        if key == table.sort.key {
                            Label(table.labels[key] ?? key, systemImage: "checkmark")
                        } else {
                            Text(table.labels[key] ?? key)
                        }
                    }
                }
            } label: {
                Label("Rank by: \(current)", systemImage: "arrow.up.arrow.down")
                    .deckFont(.meta, weight: 600)
                    .foregroundStyle(FeedPalette.text1)
                    .lineLimit(typeSize.isAccessibilitySize ? nil : 1)
                    .padding(.horizontal, DeckSpace.s + 6)
                    .frame(minHeight: DeckSpace.minTap)
                    .feedControlFace(selected: true, edge: FeedPalette.lineStrong)
            }
            .accessibilityLabel("Rank by")
            .accessibilityValue(current)
            .accessibilityIdentifier("markets.sort")
            if let key = table.sort.key {
                Button {
                    sorts[segment.id] = Markets.nextSort(table.sort, key: key, fields: spec.fields)
                } label: {
                    Label(table.sort.ascending ? "Lowest first" : "Highest first",
                          systemImage: table.sort.ascending ? "arrow.up" : "arrow.down")
                        .deckFont(.meta, weight: 500)
                        .foregroundStyle(FeedPalette.text2)
                        .padding(.horizontal, DeckSpace.s + 6)
                        .frame(minHeight: DeckSpace.minTap)
                        .feedControlFace(selected: false)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Order")
                .accessibilityValue(Markets.directionWords(table.sort))
                .accessibilityHint("Flips the order")
                .accessibilityIdentifier("markets.order")
            }
        }
    }
}

struct MarketsRowRef: Identifiable, Equatable {
    var id: String { key }
    let kind: MarketsKind
    let key: String
    let name: String
    let full: String
    let sub: String
}

/// One state or metro: its rank, name and state codes, the sorted field large, then the next three columns.
struct MarketsRowCard: View {
    let row: MarketsRow
    let table: MarketsTable
    let fields: [String: MarketsField]
    @Environment(\.dynamicTypeSize) private var typeSize

    private func value(_ key: String) -> String? {
        Markets.format(fields[key], row.values[key], id: key)
    }

    private func label(_ key: String) -> String { table.labels[key] ?? Markets.label(fields, key) }

    private var more: [String] {
        Array(table.cols.filter { $0 != table.sort.key }.prefix(3))
    }

    private var spoken: String {
        var parts = [row.rank.map { "Rank \($0)" } ?? "No rank", row.name, row.sub]
        for key in [table.sort.key].compactMap({ $0 }) + more {
            parts.append(label(key) + ", " + (value(key) ?? DeckMissing.sheet))
        }
        return parts.filter { !$0.isEmpty }.joined(separator: ", ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DeckSpace.s + 4) {
            let head = typeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: DeckSpace.s))
                : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: DeckSpace.s))
            head {
                HStack(alignment: .firstTextBaseline, spacing: DeckSpace.s) {
                    Text(row.rank.map { "\($0)" } ?? BestZips.dash)
                        .deckFont(.data)
                        .foregroundStyle(FeedPalette.text2)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.name)
                            .deckFont(.body, weight: 600)
                            .foregroundStyle(FeedPalette.text1)
                            .fixedSize(horizontal: false, vertical: true)
                        if !row.sub.isEmpty, row.sub != row.name {
                            Text(row.kind == .metro ? row.sub + " metro" : row.sub)
                                .deckFont(.meta)
                                .foregroundStyle(FeedPalette.text2)
                        }
                    }
                }
                if !typeSize.isAccessibilitySize { Spacer(minLength: DeckSpace.s) }
                if let key = table.sort.key {
                    VStack(alignment: typeSize.isAccessibilitySize ? .leading : .trailing, spacing: 2) {
                        Text(value(key) ?? BestZips.dash)
                            .deckFont(.figureRow)
                            .foregroundStyle(value(key) == nil ? FeedPalette.text3 : FeedPalette.text1)
                        Text(label(key))
                            .deckFont(.micro, weight: 400)
                            .foregroundStyle(FeedPalette.text3)
                            .multilineTextAlignment(typeSize.isAccessibilitySize ? .leading : .trailing)
                            .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
                    }
                    .frame(maxWidth: typeSize.isAccessibilitySize ? .infinity : 170,
                           alignment: typeSize.isAccessibilitySize ? .leading : .trailing)
                }
            }
            if !more.isEmpty {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: DeckSpace.m, alignment: .topLeading),
                                         count: typeSize.isAccessibilitySize ? 1 : (typeSize >= .xxLarge ? 2 : 3)),
                          alignment: .leading, spacing: DeckSpace.s) {
                    ForEach(more, id: \.self) { key in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(label(key))
                                .deckFont(.micro, weight: 400)
                                .foregroundStyle(FeedPalette.text2)
                                .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
                                .fixedSize(horizontal: false, vertical: true)
                            Text(value(key) ?? BestZips.dash)
                                .deckFont(.data)
                                .foregroundStyle(value(key) == nil ? FeedPalette.text3 : FeedPalette.text1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .feedPanel()
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
        .accessibilityHint("Opens every segment for this market")
        .accessibilityAddTraits(.isButton)
    }
}

/// Every segment for one state or metro, read in the chunks the server takes and merged, each value formatted and the
/// missing ones named once per segment. A state offers Best ZIPs for that state.
struct MarketsRowSheet: View {
    let ref: MarketsRowRef
    let spec: MarketsSpec
    @ObservedObject var store: DeckFeedStore
    let openState: (String) -> Void
    @State private var data: FeedDataContent?
    @Environment(\.dismiss) private var dismiss

    private var feeds: [String] { Markets.sheetQueries(spec, kind: ref.kind, key: ref.key, name: ref.full) }

    var body: some View {
        NavigationStack {
            ScrollView {
                content
                    .frame(maxWidth: 760, alignment: .leading)
                    .frame(maxWidth: .infinity)
                    .padding(DeckSpace.m)
            }
            .background(FeedPalette.bg.ignoresSafeArea())
            .navigationTitle(ref.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("markets.sheet.done")
                }
            }
            .sheet(item: $data) { FeedDataSheet(content: $0) }
        }
        .task {
            for feed in feeds { await store.loadDetail(feed) }
        }
        .accessibilityIdentifier("markets.sheet")
    }

    private var waiting: String? {
        feeds.first { feed in
            if case .loaded = store.state(feed) { return false }
            return true
        }
    }

    @ViewBuilder
    private var content: some View {
        if let waiting {
            FeedGate(feed: waiting, state: store.state(waiting), retry: { Task { await store.loadDetail(waiting) } }) { _ in EmptyView() }
        } else {
            let answers = feeds.compactMap { feed -> [MarketsRow]? in
                if case .loaded(let page) = store.state(feed) { return page.marketRows }
                return nil
            }
            if let row = Markets.sheetRow(key: ref.key, answers: answers) {
                loaded(row)
            } else {
                Text("This market is not in the national data.")
                    .deckFont(.body)
                    .foregroundStyle(FeedPalette.text2)
                    .accessibilityIdentifier("markets.sheet.none")
            }
        }
    }

    private func loaded(_ row: MarketsRow) -> some View {
        let sections = Markets.sheet(spec, values: row.values, kind: ref.kind)
        return VStack(alignment: .leading, spacing: DeckSpace.m) {
            VStack(alignment: .leading, spacing: 4) {
                Text(ref.kind == .metro && !ref.full.isEmpty ? ref.full : ref.name)
                    .deckFont(.title)
                    .foregroundStyle(FeedPalette.text1)
                    .fixedSize(horizontal: false, vertical: true)
                Text(ref.kind == .metro ? (ref.sub.isEmpty ? "Metro" : ref.sub + " metro") : "State")
                    .deckFont(.meta)
                    .foregroundStyle(FeedPalette.text2)
            }
            if ref.kind == .state {
                Button("Best ZIPs in \(ref.name)") { openState(ref.key) }
                    .feedActionButtonStyle()
                    .accessibilityHint("Opens Residential for this state")
                    .accessibilityIdentifier("markets.sheet.residential")
            }
            FeedGrid {
                ForEach(sections) { section in
                    RealEstateBlock(title: section.label, identifier: "markets.sheet.section.\(section.id)") {
                        if section.items.isEmpty {
                            Text("No values for this segment.")
                                .deckFont(.body)
                                .foregroundStyle(FeedPalette.text2)
                        }
                        ForEach(section.items) { item in
                            HStack(alignment: .firstTextBaseline) {
                                Text(item.label)
                                    .deckFont(.body)
                                    .foregroundStyle(FeedPalette.text1)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: DeckSpace.s)
                                Text(item.value)
                                    .deckFont(.figureRow, weight: 400)
                                    .foregroundStyle(FeedPalette.text1)
                            }
                            .accessibilityElement(children: .combine)
                        }
                        if !section.missing.isEmpty {
                            Text("No data: " + section.missing.joined(separator: ", ") + ".")
                                .deckFont(.meta)
                                .foregroundStyle(FeedPalette.text3)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            FeedDataLink {
                let keys = sections.flatMap { $0.items.map(\.key) }
                let content = Markets.data(fields: spec.fields, segment: nil, cols: keys)
                data = FeedDataContent(title: ref.name, sources: content.sources, notes: content.notes)
            }
        }
    }
}
