import SwiftUI

/// Housing (2026-11-13, restyled 2026-11-14): your markets, mortgage rates and the homes for sale, read from the
/// selected deck's `GET /api/realestate` and, for the budget, `GET /api/housing/profile`. No source text on the page:
/// dates, publishers and the 55+ note live in the Data sheet. The budget amount stays hidden until Show amounts.
struct DeckHousingContent: View {
    @ObservedObject var store: DeckFeedStore
    let openURL: (URL) -> Void
    let retry: () -> Void

    /// HousingHomeList owns the initial and expanded row limits used by this page.

    @State private var expanded = false
    @State private var withinBudget = false
    @State private var city: String?
    @State private var showAmounts = false
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        FeedGate(feed: "realestate", state: store.state("realestate"), retry: retry) { page in
            if let housing = page.housing {
                VStack(alignment: .leading, spacing: DeckSpace.m) {
                    FeedGrid {
                        markets(housing)
                        rates(housing)
                    }
                    forSale(housing)
                }
            }
        }
        .accessibilityIdentifier("housing.content")
    }

    private var budget: HousingBudget? {
        if case .loaded(let page) = store.state("housing-profile") { return page.budget }
        return nil
    }

    // MARK: Markets

    private func markets(_ housing: HousingPage) -> some View {
        RealEstateBlock(title: "Your markets", trailing: housing.area, identifier: "housing.markets") {
            if housing.markets.isEmpty {
                Text("No market numbers yet.")
                    .deckFont(.body)
                    .foregroundStyle(FeedPalette.text2)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(housing.markets) { market in
                        RealEstateRow(title: market.name, subtitle: market.tier.isEmpty ? nil : market.tier,
                                      detail: market.detail,
                                      value: market.value ?? DeckMissing.cell, valueCaption: market.change,
                                      identifier: "housing.market.\(market.id)")
                        if market.id != housing.markets.last?.id { Divider().overlay(FeedPalette.line) }
                    }
                }
            }
        }
    }

    private func rates(_ housing: HousingPage) -> some View {
        RealEstateBlock(title: "Mortgage rates", identifier: "housing.rates") {
            // Side by side each rate gets a third of the width: at accessibility sizes they stack one per line.
            let layout = typeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: DeckSpace.s))
                : AnyLayout(HStackLayout(alignment: .top, spacing: DeckSpace.m))
            layout {
                ForEach(housing.rates) { rate in
                    FeedStat(label: rate.label, value: rate.value, big: true, identifier: "housing.rate.\(rate.label)")
                }
            }
        }
    }

    // MARK: For sale

    private func forSale(_ housing: HousingPage) -> some View {
        let ceiling = withinBudget ? budget?.amount : nil
        let all = housing.homes(within: ceiling, city: city)
        let shown = Array(all.prefix(HousingHomeList.visibleCount(total: all.count, expanded: expanded)))
        return RealEstateBlock(title: "Homes for sale",
                               trailing: all.isEmpty ? nil : RealEstateWords.count(all.count),
                               identifier: "housing.forsale") {
            filters(housing)
            if all.isEmpty {
                Text(city == nil && ceiling == nil ? "No homes for sale tracked here yet." : "No homes match. Loosen a filter.")
                    .deckFont(.body)
                    .foregroundStyle(FeedPalette.text2)
            } else {
                FeedGrid(spacing: DeckSpace.xs) {
                    ForEach(Array(shown.enumerated()), id: \.element.id) { index, home in
                        VStack(spacing: 0) {
                            RealEstateRow(title: home.title, subtitle: home.subtitle.isEmpty ? nil : home.subtitle,
                                          detail: home.listed.map { "Listed " + DeckFeedAge.ago($0) }, link: home.link,
                                          identifier: "housing.home.\(index)", open: openURL)
                            Divider().overlay(FeedPalette.line)
                        }
                    }
                }
                footer(total: all.count)
            }
        }
    }

    private func filters(_ housing: HousingPage) -> some View {
        RealEstateFlow(spacing: DeckSpace.s) {
            Menu {
                Button("Any city") { city = nil; expanded = false }
                ForEach(housing.cities.prefix(14), id: \.self) { name in
                    Button(name) { city = name; expanded = false }
                }
            } label: {
                Label(city ?? "Any city", systemImage: "mappin.and.ellipse")
                    .deckFont(.meta, weight: 600)
                    .foregroundStyle(FeedPalette.text1)
                    .padding(.horizontal, DeckSpace.s + 6)
                    .frame(minHeight: DeckSpace.minTap)
                    .feedControlFace(selected: city != nil, edge: FeedPalette.lineStrong)
            }
            .accessibilityLabel("City")
            .accessibilityValue(city ?? "Any city")
            .accessibilityIdentifier("housing.city")
            if let budget {
                FeedChip(title: "Within budget", count: FeedMask.money(budget.summary, shown: showAmounts),
                         selected: withinBudget, identifier: "housing.budget") {
                    withinBudget.toggle()
                    expanded = false
                }
                FeedAmountsToggle(shown: $showAmounts)
            }
        }
    }

    @ViewBuilder
    private func footer(total: Int) -> some View {
        if !expanded, total > HousingHomeList.initialLimit {
            Button("Show \(HousingHomeList.additionalCount(total: total)) more") { expanded = true }
                .feedActionButtonStyle()
                .accessibilityIdentifier("housing.more")
        } else if expanded {
            Button("Show fewer") { expanded = false }
                .buttonStyle(FeedQuietButtonStyle())
                .accessibilityIdentifier("housing.fewer")
        }
    }
}
