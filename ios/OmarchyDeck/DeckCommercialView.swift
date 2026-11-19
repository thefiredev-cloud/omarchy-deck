import SwiftUI

/// Commercial (2026-11-13, restyled 2026-11-14): the market band, your stake as a smaller investor (the three co-invest
/// views and the small deals you could buy whole) and the deal list, from `GET /api/cre?person=tanner`, the national
/// series from `GET /api/realestate` and the budget from `GET /api/housing/profile`. Same rules as the web deal desk.
/// Read only. No source or method text on the page (Data sheet). Budget-driven amounts stay hidden until Show amounts.
struct DeckCommercialContent: View {
    @ObservedObject var store: DeckFeedStore
    let openURL: (URL) -> Void
    let retry: () -> Void

    private static let pageStep = 25

    @State private var view: CommercialView = .all
    @State private var boxId: String?
    @State private var types: Set<String> = []
    @State private var counties: Set<String> = []
    @State private var query = ""
    @State private var sortChoice: CommercialSort?
    @State private var shown = DeckCommercialContent.pageStep
    @State private var detail: CommercialDeal?
    @State private var showAmounts = false

    var body: some View {
        FeedGate(feed: "cre", state: store.state("cre"), retry: retry) { page in
            if let desk = page.desk {
                content(desk)
            }
        }
        .sheet(item: $detail) { deal in
            if case .loaded(let page) = store.state("cre"), let desk = page.desk {
                CommercialDealSheet(deal: deal, desk: desk, cap: cap, showAmounts: $showAmounts, openURL: openURL)
            }
        }
    }

    // MARK: Inputs

    /// The equity cap: the Housing budget. Held in memory only, never saved by the app.
    private var budget: HousingBudget? {
        if case .loaded(let page) = store.state("housing-profile") { return page.budget }
        return nil
    }

    private var cap: Double? { budget?.amount }

    private var indicators: [CREIndicator]? {
        if case .loaded(let page) = store.state("realestate") { return page.housing?.indicators }
        return nil
    }

    private func filter(_ desk: CommercialDesk) -> CommercialFilter {
        var f: CommercialFilter
        if let box = desk.boxes.first(where: { $0.id == boxId }) {
            f = box.filter
        } else {
            f = CommercialFilter()
            f.types = Array(types)
            f.counties = Array(counties)
            f.query = query
        }
        if let sortChoice { f.sort = sortChoice }
        return f
    }

    // MARK: Layout

    private func content(_ desk: CommercialDesk) -> some View {
        let f = filter(desk)
        let activeView = desk.isTanner ? view : .all
        let hits = CommercialLogic.hits(desk, view: activeView, filter: f, cap: cap)
        return VStack(alignment: .leading, spacing: DeckSpace.m) {
            overview(desk)
            best(desk, hits: hits, view: activeView, filter: f)
            if desk.isTanner { investor(desk) }
            filters(desk, filter: f)
            results(desk, hits: hits)
        }
    }

    // MARK: Market band

    private func overview(_ desk: CommercialDesk) -> some View {
        let o = desk.overview
        return VStack(alignment: .leading, spacing: DeckSpace.m) {
            RealEstateBlock(title: desk.label.isEmpty ? "Deal desk" : desk.label, identifier: "commercial.overview") {
                if !desk.about.isEmpty {
                    Text(desk.about)
                        .deckFont(.body)
                        .foregroundStyle(FeedPalette.text2)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("commercial.about")
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: DeckSpace.m, alignment: .top)],
                          alignment: .leading, spacing: DeckSpace.m) {
                    FeedStat(label: "Listings", value: RealEstateWords.count(desk.deals.count), big: true,
                             identifier: "commercial.stat.listings")
                    FeedStat(label: "Median listed cap", value: o.medianListedCap.map { RealEstateWords.percent($0, digits: 2) },
                             big: true, identifier: "commercial.stat.cap")
                    FeedStat(label: "New this month", value: RealEstateWords.count(o.freshCount), big: true,
                             identifier: "commercial.stat.fresh")
                    FeedStat(label: "On the market 90 days or more", value: RealEstateWords.count(o.staleCount), big: true,
                             identifier: "commercial.stat.stale")
                }
            }
            FeedGrid {
                summary("By asset class", rows: o.byType, limit: 12, identifier: "type")
                summary("By county", rows: o.byCounty, limit: 12, identifier: "county")
                summary("By ZIP", rows: o.byZip, limit: 10, identifier: "zip")
                charts(desk)
            }
            if let indicators { nationalSeries(indicators) }
        }
    }

    private func summary(_ title: String, rows: [CommercialSummaryRow], limit: Int, identifier: String) -> some View {
        RealEstateBlock(title: title, trailing: CommercialLogic.cut(shown: limit, of: rows.count),
                        identifier: "commercial.summary.\(identifier)") {
            if rows.isEmpty {
                Text("Not enough listings.")
                    .deckFont(.body)
                    .foregroundStyle(FeedPalette.text2)
            }
            ForEach(Array(rows.prefix(limit).enumerated()), id: \.element.id) { index, row in
                RealEstateRow(title: row.key, subtitle: "\(RealEstateWords.count(row.count)) listings",
                              detail: summaryDetail(row), value: row.price.map { DeckMoney.short($0) } ?? DeckMissing.cell,
                              valueCaption: "median price", captionIsWords: true,
                              identifier: "commercial.summary.\(identifier).\(index)")
                if index < min(rows.count, limit) - 1 { Divider().overlay(FeedPalette.line) }
            }
        }
    }

    private func summaryDetail(_ row: CommercialSummaryRow) -> String? {
        var parts: [String] = []
        if let ppsf = row.ppsf { parts.append(DeckMoney.short(ppsf) + "/SF") }
        else if let ppu = row.ppu { parts.append(DeckMoney.short(ppu) + "/unit") }
        if let cap = row.cap { parts.append("cap " + RealEstateWords.percent(cap, digits: 2)) }
        if let dom = row.daysOnMarket { parts.append(RealEstateWords.count(dom) + " days listed") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func charts(_ desk: CommercialDesk) -> some View {
        let o = desk.overview
        return RealEstateBlock(title: "Charts", identifier: "commercial.charts") {
            VStack(alignment: .leading, spacing: DeckSpace.l) {
                RealEstateBarChart(title: "Cap rate by asset class", bars: o.capByType,
                                   format: { RealEstateWords.percent($0) }, identifier: "commercial.chart.cap")
                RealEstateBarChart(title: "Days listed", bars: o.domBuckets, format: { RealEstateWords.count($0) },
                                   identifier: "commercial.chart.dom")
                RealEstateBarChart(title: "Listings by county", bars: o.countyCounts, format: { RealEstateWords.count($0) },
                                   identifier: "commercial.chart.county")
                RealEstateBarChart(title: "Rates against cap rates", bars: o.rateBars,
                                   format: { RealEstateWords.percent($0, digits: 2) }, identifier: "commercial.chart.rates")
            }
        }
    }

    private func nationalSeries(_ indicators: [CREIndicator]) -> some View {
        RealEstateBlock(title: "United States", identifier: "commercial.national") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: DeckSpace.m, alignment: .top)],
                      alignment: .leading, spacing: DeckSpace.m) {
                ForEach(indicators) { item in
                    FeedStat(label: item.label, value: item.value, caption: item.value == nil ? "Not published" : nil,
                             identifier: "commercial.series.\(item.label)")
                }
            }
        }
    }

    private func best(_ desk: CommercialDesk, hits: [CommercialDeal], view: CommercialView, filter f: CommercialFilter) -> some View {
        let top = CommercialLogic.sorted(hits, by: .score).prefix(12)
        let box = desk.boxes.first(where: { $0.id == boxId })?.name
        let filtered = !f.types.isEmpty || !f.counties.isEmpty || !f.query.trimmingCharacters(in: .whitespaces).isEmpty
        return RealEstateBlock(title: CommercialLogic.bestTitle(view: view, boxName: box, filtered: filtered),
                               identifier: "commercial.best") {
            if top.isEmpty {
                Text("No deals match this buy box.")
                    .deckFont(.body)
                    .foregroundStyle(FeedPalette.text2)
            }
            ForEach(Array(top.enumerated()), id: \.element.id) { index, deal in
                dealRow(deal, desk: desk, prefix: "commercial.best.\(index)")
                if index < top.count - 1 { Divider().overlay(FeedPalette.line) }
            }
        }
    }

    // MARK: Investor

    private func investor(_ desk: CommercialDesk) -> some View {
        let cap = self.cap
        let amount = FeedMask.money(cap.map { DeckMoney.short($0) } ?? DeckMissing.cell, shown: showAmounts)
        let basis = budget?.basis.map { " (\($0))" } ?? ""
        let sized = "Stakes are sized to your Housing budget, \(amount)\(basis). \(CommercialLogic.lpLine) "
            + "Co-invest lists deals in Jordan\u{2019}s or Riley\u{2019}s buy boxes that cover their debt."
        let unset = "Set a budget on the deck to size stakes."
        return RealEstateBlock(title: "You as a smaller investor", identifier: "commercial.investor") {
            Text(cap == nil ? unset : sized)
                .deckFont(.body)
                .foregroundStyle(FeedPalette.text2)
                .fixedSize(horizontal: false, vertical: true)
            RealEstateFlow(spacing: DeckSpace.s) {
                ForEach(CommercialView.allCases) { item in
                    let count = item == .all ? desk.deals.count
                        : (cap == nil ? 0 : desk.deals.filter { CommercialLogic.inView($0, item, desk: desk, cap: cap) }.count)
                    FeedChip(title: item.title, count: RealEstateWords.count(count), selected: view == item,
                             identifier: "commercial.view.\(item.rawValue)") {
                        view = item
                        shown = Self.pageStep
                    }
                }
                if cap != nil { FeedAmountsToggle(shown: $showAmounts) }
            }
        }
    }

    // MARK: Filters

    private func filters(_ desk: CommercialDesk, filter f: CommercialFilter) -> some View {
        RealEstateBlock(title: "Buy boxes and filters", identifier: "commercial.filters") {
            if desk.isTanner && view != .all {
                Text("A co-invest view shows its own deals. Pick All deals to use the filters.")
                    .deckFont(.meta)
                    .foregroundStyle(FeedPalette.text2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !desk.boxes.isEmpty {
                RealEstateFlow(spacing: DeckSpace.s) {
                    ForEach(desk.boxes) { box in
                        FeedChip(title: box.name,
                                 count: "\(desk.deals.filter { CommercialLogic.matches($0, box.filter) }.count)",
                                 selected: boxId == box.id, identifier: "commercial.box.\(box.id)") {
                            boxId = box.id
                            sortChoice = nil
                            reset()
                        }
                    }
                    FeedChip(title: "Custom", selected: boxId == nil, identifier: "commercial.box.custom") {
                        boxId = nil
                        reset()
                    }
                }
            }
            RealEstateFlow(spacing: DeckSpace.s) {
                ForEach(desk.types, id: \.self) { type in
                    FeedChip(title: type, selected: boxId == nil ? types.contains(type) : f.types.contains(type),
                             identifier: "commercial.type.\(type)") {
                        customize()
                        if types.contains(type) { types.remove(type) } else { types.insert(type) }
                        reset()
                    }
                }
            }
            RealEstateFlow(spacing: DeckSpace.s) {
                ForEach(CommercialCounty.all, id: \.self) { county in
                    FeedChip(title: CommercialCounty.short[county] ?? county,
                             selected: boxId == nil ? counties.contains(county) : f.counties.contains(county),
                             identifier: "commercial.county.\(county)") {
                        customize()
                        if counties.contains(county) { counties.remove(county) } else { counties.insert(county) }
                        reset()
                    }
                }
            }
            HStack(spacing: DeckSpace.s) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(FeedPalette.text2)
                    .accessibilityHidden(true)
                TextField("ZIP, city or metro", text: $query)
                    .deckFont(.body)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .onChange(of: query) { _, _ in
                        if boxId != nil { customize() }
                        reset()
                    }
                    .accessibilityLabel("ZIP, city or metro")
                    .accessibilityIdentifier("commercial.query")
            }
            .padding(.horizontal, DeckSpace.s + 4)
            .frame(minHeight: DeckSpace.minTap)
            .background(FeedPalette.raised2, in: RoundedRectangle(cornerRadius: DeckStyle.controlRadius))
            .overlay(RoundedRectangle(cornerRadius: DeckStyle.controlRadius).strokeBorder(FeedPalette.lineStrong, lineWidth: 1))
            Menu {
                ForEach(CommercialSort.allCases) { choice in
                    Button(choice.title) { sortChoice = choice; reset() }
                }
            } label: {
                Label("Sort: \(f.sort.title)", systemImage: "arrow.up.arrow.down")
                    .deckFont(.meta, weight: 600)
                    .foregroundStyle(FeedPalette.text1)
                    .padding(.horizontal, DeckSpace.s + 6)
                    .frame(minHeight: DeckSpace.minTap)
                    .feedControlFace(selected: false, edge: FeedPalette.lineStrong)
            }
            .accessibilityLabel("Sort")
            .accessibilityValue(f.sort.title)
            .accessibilityIdentifier("commercial.sort")
        }
    }

    /// Editing a filter leaves the saved buy box and starts from what it showed, as the web desk does.
    private func customize() {
        guard let desk = deskNow, let box = desk.boxes.first(where: { $0.id == boxId }) else { return }
        types = Set(box.filter.types)
        counties = Set(box.filter.counties)
        query = box.filter.query
        sortChoice = sortChoice ?? box.filter.sort
        boxId = nil
    }

    private var deskNow: CommercialDesk? {
        if case .loaded(let page) = store.state("cre") { return page.desk }
        return nil
    }

    private func reset() { shown = Self.pageStep }

    // MARK: Results

    private func results(_ desk: CommercialDesk, hits: [CommercialDeal]) -> some View {
        let page = Array(hits.prefix(shown))
        return RealEstateBlock(title: "Deals", trailing: RealEstateWords.count(hits.count), identifier: "commercial.results") {
            if hits.isEmpty {
                Text("No deals match this buy box.")
                    .deckFont(.body)
                    .foregroundStyle(FeedPalette.text2)
            }
            FeedGrid(spacing: DeckSpace.xs) {
                ForEach(Array(page.enumerated()), id: \.element.id) { index, deal in
                    VStack(spacing: 0) {
                        dealRow(deal, desk: desk, prefix: "commercial.deal.\(index)")
                        Divider().overlay(FeedPalette.line)
                    }
                }
            }
            if hits.count > page.count {
                Button("Show \(min(Self.pageStep, hits.count - page.count)) more") { shown += Self.pageStep }
                    .feedActionButtonStyle()
                    .accessibilityIdentifier("commercial.more")
            }
        }
    }

    private func dealRow(_ deal: CommercialDeal, desk: CommercialDesk, prefix: String) -> some View {
        let stake = desk.isTanner ? CommercialLogic.stake(deal, cap: cap, desk.assumptions) : nil
        let place = [deal.type, deal.city, CommercialCounty.name(deal.county)].compactMap { $0 }.joined(separator: ", ")
        let perUnit = deal.ppsf.map { DeckMoney.short($0) + "/SF" } ?? deal.ppu.map { DeckMoney.short($0) + "/unit" }
        let capText = deal.cap.map { RealEstateWords.percent($0, digits: 2) + (deal.isListedCap ? " cap" : " cap, est.") }
        return RealEstateRow(title: deal.title, subtitle: place,
                             detail: CommercialLogic.rowDetail(deal, stake: stake, showAmounts: showAmounts),
                             value: deal.price.map { DeckMoney.short($0) } ?? DeckMissing.cell,
                             valueCaption: [perUnit, capText].compactMap { $0 }.joined(separator: " · "),
                             identifier: prefix, select: { detail = deal })
    }
}

/// One deal: its numbers, your stake sized to the Housing budget, and the listing.
private struct CommercialDealSheet: View {
    let deal: CommercialDeal
    let desk: CommercialDesk
    let cap: Double?
    @Binding var showAmounts: Bool
    let openURL: (URL) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var data: FeedDataContent?

    private func masked(_ text: String) -> String { FeedMask.money(text, shown: showAmounts) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DeckSpace.m) {
                    facts
                    if desk.isTanner { stakeBlock }
                    if let link = deal.link {
                        Button { openURL(link) } label: {
                            Label("Open listing", systemImage: "arrow.up.right")
                                .frame(maxWidth: .infinity)
                        }
                        .feedActionButtonStyle()
                        .accessibilityHint("Opens the listing in Safari")
                        .accessibilityIdentifier("commercial.detail.open")
                    }
                    Text("Asking prices. Confirm every number with the offering memo.")
                        .deckFont(.meta)
                        .foregroundStyle(FeedPalette.text3)
                    FeedDataLink {
                        data = FeedDataContent(title: deal.title, sources: [],
                                               notes: [deal.source.map { "Listing from \($0)." }, deal.broker.map { "Broker: \($0)." }]
                                                   .compactMap { $0 } + DeckCommercialParser.notes(desk))
                    }
                }
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
                .padding(DeckSpace.m)
            }
            .background(FeedPalette.bg.ignoresSafeArea())
            .navigationTitle(deal.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("commercial.detail.done")
                }
            }
            .sheet(item: $data) { FeedDataSheet(content: $0) }
        }
        .presentationDetents([.medium, .large])
        .accessibilityIdentifier("commercial.detail")
    }

    private var facts: some View {
        RealEstateBlock(title: [deal.type, deal.city].compactMap { $0 }.joined(separator: ", "),
                        identifier: "commercial.detail.facts") {
            if let address = deal.address {
                Text(address)
                    .deckFont(.body)
                    .foregroundStyle(FeedPalette.text2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: DeckSpace.m, alignment: .top)],
                      alignment: .leading, spacing: DeckSpace.m) {
                FeedStat(label: "Asking price", value: deal.price.map { DeckMoney.short($0) }, big: true,
                         identifier: "commercial.detail.price")
                FeedStat(label: "Score", value: deal.score.map { RealEstateWords.count($0) },
                         caption: deal.score == nil ? nil : "Grade \(CommercialLogic.grade(deal.score))", big: true, identifier: "commercial.detail.score")
                FeedStat(label: deal.isListedCap ? "Cap rate, listed" : "Cap rate, estimated",
                         value: deal.cap.map { RealEstateWords.percent($0, digits: 2) }, big: true,
                         identifier: "commercial.detail.cap")
                FeedStat(label: "DSCR", value: deal.dscrCre.map { RealEstateWords.multiple($0) }, big: true,
                         identifier: "commercial.detail.dscr")
                FeedStat(label: "Building", value: deal.units.map { RealEstateWords.count($0) + " units" }
                         ?? deal.sqft.map { RealEstateWords.count($0) + " SF" },
                         caption: deal.ppsf.map { DeckMoney.short($0) + "/SF" }, big: true,
                         identifier: "commercial.detail.size")
                FeedStat(label: "Days listed", value: deal.daysOnMarket.map { RealEstateWords.count($0) }, big: true,
                         identifier: "commercial.detail.dom")
            }
        }
    }

    @ViewBuilder
    private var stakeBlock: some View {
        if let stake = CommercialLogic.stake(deal, cap: cap, desk.assumptions) {
            RealEstateBlock(title: "Your stake", identifier: "commercial.detail.stake") {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: DeckSpace.m, alignment: .top)],
                          alignment: .leading, spacing: DeckSpace.m) {
                    FeedStat(label: "Deal equity needed", value: DeckMoney.short(stake.need), caption: stake.scenario,
                             identifier: "commercial.stake.need")
                    FeedStat(label: "Your share", value: showAmounts ? stake.shareText : "•••",
                             identifier: "commercial.stake.share")
                    FeedStat(label: "Your equity", value: masked(DeckMoney.short(stake.equity)),
                             identifier: "commercial.stake.equity")
                    FeedStat(label: "Your cash flow, yearly", value: stake.cashFlow.map { masked(DeckMoney.short($0)) },
                             identifier: "commercial.stake.cash")
                    FeedStat(label: "Cash-on-cash", value: stake.coc.map { RealEstateWords.percent($0) },
                             identifier: "commercial.stake.coc")
                    FeedStat(label: "Whole deal inside your budget", value: stake.whole ? "Yes" : "No",
                             caption: stake.small ? "A small-ticket deal" : nil, identifier: "commercial.stake.whole")
                }
                Text(stake.verdict)
                    .deckFont(.body)
                    .foregroundStyle(FeedPalette.text2)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("commercial.stake.verdict")
                FeedAmountsToggle(shown: $showAmounts)
            }
        } else {
            RealEstateBlock(title: "Your stake", identifier: "commercial.detail.stake") {
                Text(cap == nil ? "Set a budget on the deck to size a stake." : "This deal shows no price, so a stake cannot be sized.")
                    .deckFont(.body)
                    .foregroundStyle(FeedPalette.text2)
            }
        }
    }
}
