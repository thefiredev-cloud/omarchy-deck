import Charts
import SwiftUI

/// Shop (2026-11-14): the e-commerce market from `GET /api/ecom-market`. Page blueprint §5: the macro strip, your
/// watches, best sellers and movers, category prices and the platform board, with sheets for a watch and a product.
/// Store names appear only where they are the subject (the board, the cheapest store); every source lives in the Data
/// sheet. Blended medians and indexes carry the confidence meter; single prices and official series carry none.
struct DeckShopContent: View {
    @ObservedObject var store: DeckFeedStore
    let openURL: (URL) -> Void
    let retry: () -> Void
    let openData: (FeedDataContent) -> Void

    @State private var category: String?
    @State private var productLimit = 12
    @State private var platformLimit = 15
    @State private var moreMacro = false
    @State private var watch: ShopWatch?
    @State private var product: ShopProduct?
    @Environment(\.feedColumns) private var columns
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        FeedGate(feed: "ecom-market", state: store.state("ecom-market"), retry: retry) { page in
            if let shop = page.shop {
                VStack(alignment: .leading, spacing: DeckSpace.l) {
                    strip(shop)
                    watches(shop)
                    products(shop)
                    categories(shop)
                    platforms(shop)
                    if !shop.trending.isEmpty { trending(shop) }
                    if shop.needsSetup > 0 {
                        Button {
                            openData(FeedDataContent(title: "Shop", sources: page.sources.filter { $0.state == .needsKey },
                                                     notes: []))
                        } label: {
                            // The 44 pt height and hit shape sit inside the label: a frame outside a plain Button adds no hit area.
                            Text("\(shop.needsSetup) stores need setup")
                                .frame(minHeight: DeckSpace.minTap)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .deckFont(.meta)
                        .foregroundStyle(FeedPalette.text2)
                        .accessibilityHint("Opens the Data sheet with the stores that need a key")
                        .accessibilityIdentifier("shop.setup")
                    }
                }
            }
        }
        .sheet(item: $watch) { item in
            ShopWatchSheet(watch: item)
        }
        .sheet(item: $product) { item in
            ShopProductSheet(product: item, openURL: openURL)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("shop.content")
    }

    // MARK: Strip

    private func strip(_ shop: ShopMarket) -> some View {
        let items = shop.strip(wide: columns > 1)
        return VStack(alignment: .leading, spacing: DeckSpace.s + 4) {
            FeedSectionTitle("Market")
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: DeckSpace.s + 4, alignment: .top),
                                     count: DeckLayout.tileColumns(wanted: columns > 1 ? 4 : 2,
                                                                   accessibilityText: typeSize.isAccessibilitySize)),
                      alignment: .leading, spacing: DeckSpace.s + 4) {
                ForEach(items) { item in macroTile(item) }
            }
            if !shop.otherMacro.isEmpty {
                DisclosureGroup(isExpanded: $moreMacro) {
                    VStack(spacing: 0) {
                        ForEach(shop.otherMacro) { item in
                            RealEstateRow(title: item.label, subtitle: item.periodText, value: item.valueText,
                                          valueCaption: item.changeText, identifier: "shop.macro.\(item.key)")
                            Divider().overlay(FeedPalette.line)
                        }
                    }
                    .padding(.top, DeckSpace.s)
                } label: {
                    Text("More market numbers")
                        .deckFont(.body, weight: 500)
                        .foregroundStyle(FeedPalette.text1)
                }
                .tint(FeedPalette.text2)
                .feedPanel(padding: DeckSpace.s + 6)
                .accessibilityIdentifier("shop.macro.more")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("shop.strip")
    }

    private func macroTile(_ item: ShopMacro) -> some View {
        VStack(alignment: .leading, spacing: DeckSpace.xs) {
            Text(item.label)
                .deckFont(.micro)
                .foregroundStyle(FeedPalette.text2)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Text(item.valueText)
                .deckFont(item.value == nil ? .meta : .figureRow)
                .foregroundStyle(item.value == nil ? FeedPalette.text3 : FeedPalette.text1)
                .lineLimit(typeSize.isAccessibilitySize ? nil : 1)
                .minimumScaleFactor(typeSize.isAccessibilitySize ? 1 : 0.8)
            FeedSparkline(values: item.hist.map(\.value), height: 24)
            Text([item.changeText, item.periodText].compactMap { $0 }.joined(separator: " · "))
                .deckFont(.data)
                .foregroundStyle(FeedPalette.text2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .feedPanel(padding: DeckSpace.s + 4)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("shop.macro.\(item.key)")
    }

    // MARK: Watches

    private func watches(_ shop: ShopMarket) -> some View {
        VStack(alignment: .leading, spacing: DeckSpace.s + 4) {
            FeedSectionTitle("Your watches")
            if shop.watches.isEmpty {
                Text("No watches yet. Add one from Hermes.")
                    .deckFont(.body)
                    .foregroundStyle(FeedPalette.text2)
            }
            FeedGrid {
                ForEach(shop.watches) { item in
                    Button { watch = item } label: { ShopWatchCard(watch: item) }
                        .buttonStyle(FeedCardPressStyle())
                        .accessibilityHint("Opens the price range and stores")
                        .accessibilityIdentifier("shop.watch.\(item.slug)")
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("shop.watches")
    }

    // MARK: Products

    private func products(_ shop: ShopMarket) -> some View {
        let list = shop.products(category: category)
        return VStack(alignment: .leading, spacing: DeckSpace.s + 4) {
            FeedSectionTitle("Best sellers and movers")
            FeedChipRow {
                FeedChip(title: "All", selected: category == nil, identifier: "shop.category.all") {
                    category = nil
                    productLimit = 12
                }
                ForEach(shop.categoryChips, id: \.self) { key in
                    FeedChip(title: ShopWords.category(key), selected: category == key, identifier: "shop.category.\(key)") {
                        category = key
                        productLimit = 12
                    }
                }
            }
            if list.isEmpty {
                Text("Nothing in this category right now.")
                    .deckFont(.body)
                    .foregroundStyle(FeedPalette.text2)
            }
            FeedGrid {
                ForEach(Array(list.prefix(productLimit).enumerated()), id: \.element.id) { index, item in
                    Button { product = item } label: { ShopProductCard(product: item) }
                        .buttonStyle(FeedCardPressStyle())
                        .accessibilityIdentifier("shop.product.\(index)")
                }
            }
            if list.count > productLimit {
                Button("Show \(min(12, list.count - productLimit)) more") { productLimit += 12 }
                    .feedActionButtonStyle()
                    .accessibilityIdentifier("shop.products.more")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("shop.products")
    }

    // MARK: Categories

    private func categories(_ shop: ShopMarket) -> some View {
        VStack(alignment: .leading, spacing: DeckSpace.s + 4) {
            FeedSectionTitle("Category prices")
            FeedGrid {
                ForEach(shop.categories) { item in
                    ShopCategoryCard(category: item) {
                        openData(FeedDataContent(title: item.label, sources: [],
                                                 notes: item.confidence?.reasons ?? [],
                                                 blends: item.parts.isEmpty ? [] : [("Trend parts", item.parts)]))
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("shop.categories")
    }

    // MARK: Platforms

    private func platforms(_ shop: ShopMarket) -> some View {
        let list = Array(shop.platforms.prefix(platformLimit))
        return VStack(alignment: .leading, spacing: DeckSpace.s + 4) {
            FeedSectionTitle("Platforms")
            VStack(spacing: 0) {
                FeedGrid(spacing: 0) {
                    ForEach(list) { item in
                        VStack(spacing: 0) {
                            ShopPlatformRow(platform: item)
                            Divider().overlay(FeedPalette.line)
                        }
                    }
                }
            }
            .feedPanel(padding: DeckSpace.s + 4)
            if shop.platforms.count > platformLimit {
                Button("Show \(min(15, shop.platforms.count - platformLimit)) more") { platformLimit += 15 }
                    .buttonStyle(FeedQuietButtonStyle())
                    .accessibilityIdentifier("shop.platforms.more")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("shop.platforms")
    }

    private func trending(_ shop: ShopMarket) -> some View {
        VStack(alignment: .leading, spacing: DeckSpace.s + 4) {
            FeedSectionTitle("Shopping searches now")
            RealEstateFlow(spacing: DeckSpace.s) {
                ForEach(shop.trending, id: \.self) { term in
                    Text(term)
                        .deckFont(.meta)
                        .foregroundStyle(FeedPalette.text1)
                        .padding(.horizontal, DeckSpace.s + 4)
                        .frame(minHeight: 36)
                        .feedControlFace(selected: false)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("shop.trending")
    }
}

// MARK: Cards and rows

struct ShopWatchCard: View {
    let watch: ShopWatch

    var body: some View {
        VStack(alignment: .leading, spacing: DeckSpace.s) {
            HStack(alignment: .firstTextBaseline) {
                Text(watch.name)
                    .deckFont(.heading)
                    .foregroundStyle(FeedPalette.text1)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: DeckSpace.s)
                if let change = ShopWords.percent(watch.change7) {
                    Text(change + " 7d")
                        .deckFont(.data)
                        .foregroundStyle(FeedPalette.text2)
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(watch.median.map { DeckMoney.price($0) } ?? DeckMissing.sheet)
                    .deckFont(watch.median == nil ? .meta : .figure)
                    .foregroundStyle(FeedPalette.text1)
                    .confidenceMeter(watch.median == nil ? nil : watch.confidence?.confidence,
                                     reasons: watch.confidence?.reasons ?? [])
                Text("typical")
                    .deckFont(.meta)
                    .foregroundStyle(FeedPalette.text2)
            }
            FeedSparkline(values: watch.hist.map(\.value))
            if let best = watch.bestPrice {
                HStack(spacing: DeckSpace.xs) {
                    Text("Best \(DeckMoney.price(best))" + (watch.bestPlatform.map { " at \($0)" } ?? ""))
                        .deckFont(.meta, weight: 500)
                        .foregroundStyle(FeedPalette.text1)
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(FeedPalette.text3)
                        .accessibilityHidden(true)
                }
            }
        }
        .feedPanel()
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

struct ShopProductCard: View {
    let product: ShopProduct

    var body: some View {
        VStack(alignment: .leading, spacing: DeckSpace.s) {
            HStack(spacing: DeckSpace.s) {
                Text(product.kindWord)
                    .deckFont(.micro, weight: 600)
                    .foregroundStyle(FeedPalette.text1)
                    .padding(.horizontal, DeckSpace.s)
                    .padding(.vertical, 3)
                    .background(FeedPalette.raised2, in: Capsule())
                if let category = product.category {
                    Text(ShopWords.category(category))
                        .deckFont(.micro, weight: 400)
                        .foregroundStyle(FeedPalette.text2)
                }
                Spacer(minLength: 0)
                if let rank = ShopWords.rank(product.rank, change: product.rankChange) {
                    Text(rank).deckFont(.data).foregroundStyle(FeedPalette.text2)
                }
            }
            Text(product.title)
                .deckFont(.body, weight: 500)
                .foregroundStyle(FeedPalette.text1)
                .multilineTextAlignment(.leading)
                .lineLimit(3)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                if let cheapest = product.cheapest, let price = cheapest.price {
                    Text(DeckMoney.price(price))
                        .deckFont(.figureRow)
                        .foregroundStyle(FeedPalette.text1)
                    Text("at \(cheapest.platform)")
                        .deckFont(.meta)
                        .foregroundStyle(FeedPalette.text2)
                } else {
                    Text(product.median.map { DeckMoney.price($0) } ?? DeckMissing.sheet).deckFont(.figureRow).foregroundStyle(FeedPalette.text1)
                }
                Spacer(minLength: 0)
                if let change = ShopWords.percent(product.changePct) {
                    Text(change).deckFont(.data).foregroundStyle(FeedPalette.text2)
                }
            }
            // The feed carries no confidence for a product median, so none is drawn: a mark is never made up.
            if product.isBlended, let median = product.median {
                Text("Typical \(DeckMoney.price(median)) across \(product.platforms) stores")
                    .deckFont(.meta)
                    .foregroundStyle(FeedPalette.text2)
            }
        }
        .feedPanel()
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

struct ShopCategoryCard: View {
    let category: ShopCategory
    let openData: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DeckSpace.s) {
            HStack(alignment: .firstTextBaseline) {
                Text(category.label)
                    .deckFont(.heading)
                    .foregroundStyle(FeedPalette.text1)
                Spacer(minLength: DeckSpace.s)
                Text(ShopWords.percent(category.value) ?? DeckMissing.sheet)
                    .deckFont(category.value == nil ? .meta : .figureRow)
                    .foregroundStyle(category.value == nil ? FeedPalette.text3 : FeedPalette.text1)
                    .confidenceMeter(category.mark, reasons: category.mark == nil ? [] : category.confidence?.reasons ?? [])
            }
            if let period = category.period {
                Text(period).deckFont(.data).foregroundStyle(FeedPalette.text2)
            }
            if !category.indexHist.isEmpty {
                FeedSparkline(values: category.indexHist.map(\.value))
            }
            let changes = [category.indexChange7.map { "7d " + ShopWords.change($0, unit: "pct") },
                           category.indexChange30.map { "30d " + ShopWords.change($0, unit: "pct") },
                           category.indexValue.map { String(format: "Index %.1f", $0) }].compactMap { $0 }
            if !changes.isEmpty {
                Text(changes.joined(separator: " · ")).deckFont(.data).foregroundStyle(FeedPalette.text2)
            }
            if let building = category.building {
                Text(building).deckFont(.meta).foregroundStyle(FeedPalette.text2)
            }
            if !category.parts.isEmpty {
                Button(action: openData) {
                    // Frame and hit shape inside the label: a frame outside a plain Button adds no hit area.
                    Text("Data")
                        .frame(minWidth: DeckSpace.minTap, minHeight: DeckSpace.minTap, alignment: .leading)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .deckFont(.meta, weight: 600)
                .foregroundStyle(FeedPalette.signalText)
                .accessibilityLabel("Data for \(category.label)")
            }
        }
        .feedPanel()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("shop.category.card.\(category.key)")
    }
}

struct ShopPlatformRow: View {
    let platform: ShopPlatform

    var body: some View {
        HStack(alignment: .top, spacing: DeckSpace.s + 4) {
            Text("\(platform.rank)")
                .deckFont(.figureRow, weight: 400)
                .foregroundStyle(FeedPalette.text2)
                .frame(minWidth: 28, alignment: .trailing)
            VStack(alignment: .leading, spacing: 3) {
                Text(platform.name)
                    .deckFont(.body, weight: 500)
                    .foregroundStyle(FeedPalette.text1)
                Text([platform.kindWord, platform.appRank.map { "App #\($0)" }, platform.webRank.map { "Web #\(ShopWords.compact(Double($0)))" }]
                    .compactMap { $0 }.joined(separator: " · "))
                    .deckFont(.data)
                    .foregroundStyle(FeedPalette.text2)
            }
            Spacer(minLength: DeckSpace.s)
            Image(systemName: platform.pricesTracked ? "checkmark" : "minus")
                .font(.body.weight(.semibold))
                .foregroundStyle(platform.pricesTracked ? FeedPalette.text1 : FeedPalette.text3)
                .frame(minWidth: 24)
                .accessibilityLabel(platform.pricesTracked ? "Prices tracked" : "Prices not tracked")
        }
        .padding(.vertical, DeckSpace.s)
        .accessibilityElement(children: .combine)
    }
}

// MARK: Sheets

/// One watch: the median with its range, the new-only median, the 7 and 30 day moves, the price line and every store
/// cheapest first. Asking prices, not sold prices.
struct ShopWatchSheet: View {
    let watch: ShopWatch
    @State private var data: FeedDataContent?
    @Environment(\.dismiss) private var dismiss
    /// The plot grows with the axis labels: a fixed 160 pt left three AX5 labels no room to stay apart.
    @ScaledMetric(relativeTo: .caption) private var chartHeight: CGFloat = 160

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DeckSpace.m) {
                    RealEstateBlock(title: "Price range", identifier: "shop.watch.range") {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: DeckSpace.m, alignment: .top)],
                                  alignment: .leading, spacing: DeckSpace.m) {
                            FeedStat(label: "Typical", value: watch.median.map { DeckMoney.price($0) },
                                     confidence: watch.confidence?.confidence, big: true, identifier: "shop.watch.median")
                            FeedStat(label: "Typical, new", value: watch.newMedian.map { DeckMoney.price($0) }, big: true,
                                     identifier: "shop.watch.new")
                            FeedStat(label: "Middle half", value: rangeText, big: true, lines: 2, identifier: "shop.watch.ci")
                            FeedStat(label: "Best price", value: watch.bestPrice.map { DeckMoney.price($0) },
                                     caption: watch.bestPlatform, big: true, identifier: "shop.watch.best")
                            FeedStat(label: "7 days", value: ShopWords.percent(watch.change7), identifier: "shop.watch.7d")
                            FeedStat(label: "30 days", value: ShopWords.percent(watch.change30), identifier: "shop.watch.30d")
                        }
                    }
                    if watch.hist.count >= 2 {
                        RealEstateBlock(title: "Last 30 days", identifier: "shop.watch.line") {
                            Chart(watch.hist) { point in
                                LineMark(x: .value("Day", point.period), y: .value("Price", point.value))
                                    .foregroundStyle(FeedPalette.text1)
                                    .interpolationMethod(.monotone)
                            }
                            .chartXAxis(.hidden)
                            .chartYAxis {
                                AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { value in
                                    AxisGridLine().foregroundStyle(FeedPalette.line)
                                    AxisValueLabel {
                                        if let v = value.as(Double.self) {
                                            Text(DeckMoney.price(v)).deckFont(.data).foregroundStyle(FeedPalette.text2)
                                        }
                                    }
                                }
                            }
                            .frame(height: chartHeight)
                            .accessibilityLabel("Typical price over the last days, from \(watch.hist.first.map { DeckMoney.price($0.value) } ?? DeckMissing.sheet) to \(watch.hist.last.map { DeckMoney.price($0.value) } ?? DeckMissing.sheet)")
                        }
                    }
                    if !watch.byPlatform.isEmpty {
                        RealEstateBlock(title: "By store", identifier: "shop.watch.stores") {
                            ForEach(watch.byPlatform) { item in
                                RealEstateRow(title: item.platform, subtitle: item.listings.map { "\($0) listings" },
                                              value: DeckMoney.price(item.median), identifier: "shop.watch.store.\(item.platform)")
                            }
                        }
                    }
                    Text("Asking prices, not sold prices.")
                        .deckFont(.meta)
                        .foregroundStyle(FeedPalette.text3)
                    FeedDataLink {
                        data = FeedDataContent(title: watch.name, sources: [],
                                               notes: (watch.confidence?.reasons ?? []) + [watch.period.map { "Window: \($0)." },
                                                       watch.sitesOk.map { "\($0) of \(watch.sitesExpected ?? $0) stores answered." },
                                                       watch.listings.map { "\($0) listings read." }].compactMap { $0 })
                    }
                }
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
                .padding(DeckSpace.m)
            }
            .background(FeedPalette.bg.ignoresSafeArea())
            .navigationTitle(watch.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("shop.sheet.done")
                }
            }
            .sheet(item: $data) { FeedDataSheet(content: $0) }
        }
        .accessibilityIdentifier("shop.watch.sheet")
    }

    private var rangeText: String? {
        guard let lo = watch.low, let hi = watch.high else { return nil }
        return "\(DeckMoney.price(lo)) to \(DeckMoney.price(hi))"
    }
}

/// One product: every store with its price and rank, and the link out.
struct ShopProductSheet: View {
    let product: ShopProduct
    let openURL: (URL) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DeckSpace.m) {
                    RealEstateBlock(title: product.kindWord, identifier: "shop.product.facts") {
                        Text(product.title)
                            .deckFont(.body, weight: 500)
                            .foregroundStyle(FeedPalette.text1)
                            .fixedSize(horizontal: false, vertical: true)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: DeckSpace.m, alignment: .top)],
                                  alignment: .leading, spacing: DeckSpace.m) {
                            FeedStat(label: product.isBlended ? "Typical" : "Price", value: product.median.map { DeckMoney.price($0) },
                                     big: true, identifier: "shop.product.median")
                            FeedStat(label: "Change", value: ShopWords.percent(product.changePct), caption: product.period,
                                     identifier: "shop.product.change")
                            FeedStat(label: "Rank", value: ShopWords.rank(product.rank, change: product.rankChange),
                                     identifier: "shop.product.rank")
                            FeedStat(label: "Stores", value: "\(product.platforms)", identifier: "shop.product.stores")
                        }
                    }
                    RealEstateBlock(title: "Stores", identifier: "shop.product.offers") {
                        ForEach(product.offers) { offer in
                            RealEstateRow(title: offer.platform,
                                          subtitle: [offer.regular.map { "Regular \(DeckMoney.price($0))" },
                                                     offer.rank.map { "Rank #\($0)" }].compactMap { $0 }.joined(separator: " · "),
                                          value: offer.price.map { DeckMoney.price($0) } ?? DeckMissing.cell,
                                          valueCaption: offer.url == nil ? nil : "Open", captionIsWords: true,
                                          link: offer.url, identifier: "shop.product.offer.\(offer.platform)", open: openURL)
                        }
                    }
                }
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
                .padding(DeckSpace.m)
            }
            .background(FeedPalette.bg.ignoresSafeArea())
            .navigationTitle(product.brand ?? product.kindWord)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("shop.sheet.done")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .accessibilityIdentifier("shop.product.sheet")
    }
}
