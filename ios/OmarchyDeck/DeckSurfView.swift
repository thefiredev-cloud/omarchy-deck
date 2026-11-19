import Charts
import SwiftUI

/// Surf (2026-11-14): Cabo San Lucas to the Columbia River from `GET /api/surf-coast`, with one region's hourly
/// series, tide curves and blend parts from `GET /api/surf-coast/region/<id>` when a spot opens. Page blueprint §6:
/// your regions' alerts (two at most), your spots, one line for the coast's other alerts, the coast strip, best right now, regions, spots, buoys and water
/// temperature by latitude. Ratings are pips plus a word, no hue. Model-only spots carry a hollow square, a low mark
/// and one line, never a reading made to look like a buoy.
struct DeckSurfContent: View {
    @ObservedObject var store: DeckFeedStore
    let retry: () -> Void

    @State private var region = SurfRegions.home
    /// Nil is the selected region; "all" is the whole coast; "pinned" is your spots.
    @State private var scope: String?
    @State private var goodOnly = false
    @State private var sort: SurfSort = .rating
    @State private var spotLimit = 30
    @State private var buoysExpanded = false
    @State private var openSpot: SurfSpot?
    @State private var openAlerts: SurfAlertList?

    var body: some View {
        FeedGate(feed: "surf-coast", state: store.state("surf-coast"), retry: retry) { page in
            if let surf = page.surf {
                ScrollViewReader { proxy in
                    VStack(alignment: .leading, spacing: DeckSpace.l) {
                        let plan = surf.alertPlan
                        alerts(plan)
                        yourSpots(surf)
                        coastAlerts(plan)
                        coast(surf, proxy: proxy)
                        bestNow(surf)
                        regions(surf, proxy: proxy)
                        spots(surf)
                        buoys(surf)
                        water(surf)
                    }
                }
            }
        }
        .sheet(item: $openSpot) { spot in
            SurfSpotSheet(spot: spot, store: store)
        }
        .sheet(item: $openAlerts) { list in
            SurfAlertsSheet(alerts: list.alerts)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("surf.content")
    }

    // MARK: Alerts

    /// Your regions' alerts above Your spots: two rows, most severe first, then "+N more".
    @ViewBuilder
    private func alerts(_ plan: SurfAlertPlan) -> some View {
        if !plan.top.isEmpty {
            VStack(alignment: .leading, spacing: DeckSpace.s) {
                FeedSectionTitle("Alerts")
                ForEach(Array(plan.top.enumerated()), id: \.element.id) { index, alert in
                    SurfAlertRow(alert: alert)
                        .accessibilityIdentifier("surf.alert.\(index)")
                }
                if let more = plan.moreHomeLine {
                    quietButton(more, identifier: "surf.alerts.more") { openAlerts = SurfAlertList(alerts: plan.all) }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("surf.alerts")
        }
    }

    /// Every other alert: one quiet line after Your spots that opens the full list.
    @ViewBuilder
    private func coastAlerts(_ plan: SurfAlertPlan) -> some View {
        if let line = plan.elsewhereLine {
            quietButton(line, identifier: "surf.alerts.coast") { openAlerts = SurfAlertList(alerts: plan.all) }
        }
    }

    private func quietButton(_ title: String, identifier: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: DeckSpace.xs) {
                Text(title).deckFont(.meta)
                Image(systemName: "chevron.right").imageScale(.small).accessibilityHidden(true)
            }
            .foregroundStyle(FeedPalette.text2)
            .frame(minHeight: DeckSpace.minTap)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens every alert")
        .accessibilityIdentifier(identifier)
    }

    // MARK: Your spots and best now

    private func yourSpots(_ surf: SurfOverview) -> some View {
        VStack(alignment: .leading, spacing: DeckSpace.s + 4) {
            FeedSectionTitle("Your spots")
            FeedGrid {
                ForEach(surf.pinned) { spot in
                    SurfSpotCard(spot: spot, showRegion: false) { openSpot = spot }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("surf.pinned")
    }

    private func bestNow(_ surf: SurfOverview) -> some View {
        VStack(alignment: .leading, spacing: DeckSpace.s + 4) {
            FeedSectionTitle("Best right now")
            FeedGrid {
                ForEach(surf.bestNow) { spot in
                    SurfSpotCard(spot: spot, showRegion: true) { openSpot = spot }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("surf.best")
    }

    // MARK: Coast strip

    private func coast(_ surf: SurfOverview, proxy: ScrollViewProxy) -> some View {
        VStack(alignment: .leading, spacing: DeckSpace.s) {
            FeedSectionTitle("Coast")
            SurfCoastStrip(surf: surf, selected: region) { id in
                region = id
                scope = nil
                spotLimit = 30
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("surf.spots", anchor: .top) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("surf.coast")
    }

    // MARK: Regions

    private func regions(_ surf: SurfOverview, proxy: ScrollViewProxy) -> some View {
        VStack(alignment: .leading, spacing: DeckSpace.s + 4) {
            FeedSectionTitle("Regions")
            FeedGrid {
                ForEach(surf.regions) { item in
                    Button {
                        region = item.id
                        scope = nil
                        spotLimit = 30
                        withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("surf.spots", anchor: .top) }
                    } label: {
                        SurfRegionCard(region: item, modelOnly: surf.isModelOnly(item.id))
                    }
                    .buttonStyle(FeedCardPressStyle())
                    .accessibilityHint("Shows the spots in \(item.name)")
                    .accessibilityIdentifier("surf.region.\(item.id)")
                }
            }
        }
    }

    // MARK: Spots

    private func listed(_ surf: SurfOverview) -> [SurfSpot] {
        let base: [SurfSpot]
        switch scope {
        case "all": base = surf.spots
        case "pinned": base = surf.pinned
        default: base = surf.spots(in: region)
        }
        return sort.apply(goodOnly ? base.filter(\.rating.isGoodOrBetter) : base)
    }

    private var scopeTitle: String {
        switch scope {
        case "all": return "All coast"
        case "pinned": return "Your spots"
        default: return SurfRegions.name(region)
        }
    }

    private func spots(_ surf: SurfOverview) -> some View {
        let list = listed(surf)
        return VStack(alignment: .leading, spacing: DeckSpace.s + 4) {
            FeedSectionTitle(scope == nil ? "Spots in \(SurfRegions.name(region))" : "Spots: \(scopeTitle)")
            RealEstateFlow(spacing: DeckSpace.s) {
                Menu {
                    Button("All coast") { scope = "all"; spotLimit = 30 }
                    Button("Your spots") { scope = "pinned"; spotLimit = 30 }
                    ForEach(surf.regions) { item in
                        Button(item.name) { region = item.id; scope = nil; spotLimit = 30 }
                    }
                } label: {
                    menuLabel(scopeTitle, symbol: "map")
                }
                .accessibilityLabel("Region")
                .accessibilityValue(scopeTitle)
                .accessibilityIdentifier("surf.scope")
                FeedChip(title: "Good or better", selected: goodOnly, identifier: "surf.good") { goodOnly.toggle() }
                Menu {
                    ForEach(SurfSort.allCases) { choice in
                        Button(choice.title) { sort = choice }
                    }
                } label: {
                    menuLabel("Sort: \(sort.title)", symbol: "arrow.up.arrow.down")
                }
                .accessibilityLabel("Sort")
                .accessibilityValue(sort.title)
                .accessibilityIdentifier("surf.sort")
            }
            if scope == nil, surf.isModelOnly(region) {
                SurfModelLine(text: SurfWords.modelRegionLine)
            }
            VStack(spacing: 0) {
                if list.isEmpty {
                    Text(goodOnly ? "No spot here is good or better right now." : SurfWords.noReading)
                        .deckFont(.body)
                        .foregroundStyle(FeedPalette.text2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, DeckSpace.s)
                }
                FeedGrid(spacing: 0) {
                    ForEach(Array(list.prefix(spotLimit).enumerated()), id: \.element.id) { index, spot in
                        VStack(spacing: 0) {
                            Button { openSpot = spot } label: { SurfSpotRow(spot: spot) }
                                .buttonStyle(FeedCardPressStyle())
                                .accessibilityIdentifier("surf.spot.\(index)")
                            Divider().overlay(FeedPalette.line)
                        }
                    }
                }
            }
            .feedPanel(padding: DeckSpace.s + 4)
            if list.count > spotLimit {
                Button("Show \(min(30, list.count - spotLimit)) more") { spotLimit += 30 }
                    .feedActionButtonStyle()
                    .accessibilityIdentifier("surf.spots.more")
            }
        }
        .id("surf.spots")
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("surf.spots")
    }

    private func menuLabel(_ title: String, symbol: String) -> some View {
        Label(title, systemImage: symbol)
            .deckFont(.meta, weight: 600)
            .foregroundStyle(FeedPalette.text1)
            .padding(.horizontal, DeckSpace.s + 6)
            .frame(minHeight: DeckSpace.minTap)
            .feedControlFace(selected: false, edge: FeedPalette.lineStrong)
    }

    // MARK: Buoys

    private func buoys(_ surf: SurfOverview) -> some View {
        let list = surf.buoysSouthToNorth.filter { $0.waveFt != nil || $0.waterF != nil }
        let shown = buoysExpanded ? list : Array(list.prefix(12))
        return VStack(alignment: .leading, spacing: DeckSpace.s + 4) {
            FeedSectionTitle("Buoys")
            Text(SurfWords.noBuoysSouth)
                .deckFont(.meta)
                .foregroundStyle(FeedPalette.text2)
            VStack(spacing: 0) {
                FeedGrid(spacing: 0) {
                    ForEach(shown) { buoy in
                        VStack(spacing: 0) {
                            SurfBuoyRow(buoy: buoy)
                            Divider().overlay(FeedPalette.line)
                        }
                    }
                }
            }
            .feedPanel(padding: DeckSpace.s + 4)
            if list.count > 12 {
                Button(buoysExpanded ? "Show fewer" : "Show all \(list.count)") { buoysExpanded.toggle() }
                    .buttonStyle(FeedQuietButtonStyle())
                    .accessibilityIdentifier("surf.buoys.more")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("surf.buoys")
    }

    // MARK: Water by latitude

    private func water(_ surf: SurfOverview) -> some View {
        VStack(alignment: .leading, spacing: DeckSpace.s + 4) {
            FeedSectionTitle("Water temperature by latitude")
            SurfWaterChart(surf: surf)
                .feedPanel()
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("surf.water")
    }
}

// MARK: Pieces

/// Five pips and the word. No hue: the word carries the state.
struct SurfPips: View {
    let rating: SurfRating

    var body: some View {
        HStack(spacing: DeckSpace.s) {
            HStack(spacing: 3) {
                ForEach(0..<5, id: \.self) { index in
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(index < rating.pips ? FeedPalette.text1 : Color.clear)
                        .overlay(RoundedRectangle(cornerRadius: 1.5).strokeBorder(FeedPalette.text2, lineWidth: 1))
                        .frame(width: 10, height: 10)
                }
            }
            Text(rating.text)
                .deckFont(.meta, weight: 600)
                .foregroundStyle(FeedPalette.text1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Rating \(rating.text)")
    }
}

/// The model mark: a hollow square before a height that comes from a forecast with no buoy nearby.
struct SurfModelMark: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 1)
            .strokeBorder(FeedPalette.text2, lineWidth: 1.2)
            .frame(width: 9, height: 9)
            .accessibilityLabel("Model forecast, no buoy nearby")
    }
}

struct SurfModelLine: View {
    let text: String

    var body: some View {
        HStack(spacing: DeckSpace.s) {
            SurfModelMark()
            Text(text)
                .deckFont(.meta)
                .foregroundStyle(FeedPalette.text2)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("surf.model.line")
    }
}

/// A spot as a card: Your spots and Best right now.
struct SurfSpotCard: View {
    let spot: SurfSpot
    let showRegion: Bool
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: DeckSpace.s) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(spot.name)
                            .deckFont(.heading)
                            .foregroundStyle(FeedPalette.text1)
                            .multilineTextAlignment(.leading)
                        if showRegion {
                            Text(SurfRegions.name(spot.region))
                                .deckFont(.meta)
                                .foregroundStyle(FeedPalette.text2)
                        }
                    }
                    Spacer(minLength: DeckSpace.s)
                    SurfPips(rating: spot.rating)
                }
                // No reason line on the card: the feed's sentence repeats this card's own height, period, direction, wind
                // and tide, and its rounding disagrees with them ("5 ft at 15 s" beside "5-6 ft", "calm" beside "2 kt").
                // The sheet keeps it, where there is room to read why.
                HStack(alignment: .top, spacing: DeckSpace.m) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            if spot.modelOnly { SurfModelMark() }
                            Text(SurfWords.height(spot.waveFt) ?? DeckMissing.sheet)
                                .deckFont(SurfWords.height(spot.waveFt) == nil ? .meta : .figure)
                                .foregroundStyle(FeedPalette.text1)
                                .confidenceMeter(SurfWords.height(spot.waveFt) == nil ? nil : spot.confidence)
                        }
                        Text([SurfWords.period(spot.periodS, model: spot.modelOnly), spot.dir].compactMap { $0 }.joined(separator: " "))
                            .deckFont(.data)
                            .foregroundStyle(FeedPalette.text2)
                    }
                    Spacer(minLength: 0)
                    VStack(alignment: .trailing, spacing: 2) {
                        if let water = SurfWords.water(spot.waterF) {
                            Text(water).deckFont(.figureRow).foregroundStyle(FeedPalette.text1)
                                .confidenceMeter(spot.confidence)
                        }
                        if let wind = SurfWords.wind(spot.wind) {
                            Text([wind, SurfWords.windWord(spot.wind)].compactMap { $0 }.joined(separator: ", "))
                                .deckFont(.data)
                                .foregroundStyle(FeedPalette.text2)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                }
                let foot = [SurfWords.best(spot.best).map { "Best \($0.prefix(1).lowercased() + $0.dropFirst())" },
                            SurfWords.tide(spot.tideNext)].compactMap { $0 }
                if !foot.isEmpty {
                    Text(foot.joined(separator: " · "))
                        .deckFont(.meta)
                        .foregroundStyle(FeedPalette.text2)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if spot.modelOnly { SurfModelLine(text: SurfWords.modelLine) }
            }
            .feedPanel()
            .contentShape(Rectangle())
        }
        .buttonStyle(FeedCardPressStyle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the spot")
        .accessibilityIdentifier("surf.card.\(spot.id)")
    }
}

/// A spot as a list row: name, pips, height, period, wind, water.
struct SurfSpotRow: View {
    let spot: SurfSpot

    var body: some View {
        HStack(alignment: .top, spacing: DeckSpace.s + 4) {
            VStack(alignment: .leading, spacing: 3) {
                Text(spot.name)
                    .deckFont(.body, weight: 500)
                    .foregroundStyle(FeedPalette.text1)
                    .multilineTextAlignment(.leading)
                SurfPips(rating: spot.rating)
            }
            Spacer(minLength: DeckSpace.s)
            VStack(alignment: .trailing, spacing: 3) {
                HStack(spacing: 6) {
                    if spot.modelOnly { SurfModelMark() }
                    Text(SurfWords.height(spot.waveFt) ?? DeckMissing.sheet)
                        .deckFont(.figureRow)
                        .foregroundStyle(FeedPalette.text1)
                }
                Text([SurfWords.period(spot.periodS, model: spot.modelOnly), SurfWords.wind(spot.wind),
                      SurfWords.water(spot.waterF)].compactMap { $0 }.joined(separator: " · "))
                    .deckFont(.data)
                    .foregroundStyle(FeedPalette.text2)
                    .multilineTextAlignment(.trailing)
            }
        }
        .padding(.vertical, DeckSpace.s)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

struct SurfRegionCard: View {
    let region: SurfRegion
    let modelOnly: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: DeckSpace.s) {
            HStack(alignment: .firstTextBaseline) {
                Text(region.name)
                    .deckFont(.heading)
                    .foregroundStyle(FeedPalette.text1)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: DeckSpace.s)
                SurfPips(rating: region.rating)
                    .confidenceMeter(region.confidence)
            }
            if let line = region.line {
                Text(line)
                    .deckFont(.meta)
                    .foregroundStyle(FeedPalette.text2)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(alignment: .firstTextBaseline, spacing: DeckSpace.m) {
                HStack(spacing: 6) {
                    if modelOnly { SurfModelMark() }
                    Text(SurfWords.height(region.waveFt) ?? DeckMissing.sheet)
                        .deckFont(.figureRow)
                        .foregroundStyle(FeedPalette.text1)
                }
                if let water = SurfWords.waterRange(region.waterMin, region.waterMax) {
                    Text(water).deckFont(.figureRow, weight: 400).foregroundStyle(FeedPalette.text1)
                }
                Spacer(minLength: 0)
                if let counts = SurfWords.counts(region.counts) {
                    Text(counts).deckFont(.data).foregroundStyle(FeedPalette.text2)
                }
            }
            if modelOnly { SurfModelLine(text: SurfWords.modelRegionLine) }
        }
        .feedPanel()
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

struct SurfBuoyRow: View {
    let buoy: SurfBuoy

    var body: some View {
        HStack(alignment: .top, spacing: DeckSpace.s + 4) {
            VStack(alignment: .leading, spacing: 3) {
                Text(buoy.name)
                    .deckFont(.body, weight: 500)
                    .foregroundStyle(FeedPalette.text1)
                    .multilineTextAlignment(.leading)
                Text([buoy.dir, SurfWords.water(buoy.waterF),
                      buoy.windKt.map { "\(DeckFeedParser.whole($0.rounded())) kt" + (buoy.windDir.map { " " + $0 } ?? "") }]
                    .compactMap { $0 }.joined(separator: " · "))
                    .deckFont(.data)
                    .foregroundStyle(FeedPalette.text2)
            }
            Spacer(minLength: DeckSpace.s)
            VStack(alignment: .trailing, spacing: 3) {
                Text(SurfWords.feet(buoy.waveFt) ?? "No waves")
                    .deckFont(buoy.waveFt == nil ? .meta : .figureRow)
                    .foregroundStyle(buoy.waveFt == nil ? FeedPalette.text3 : FeedPalette.text1)
                if let period = SurfWords.period(buoy.periodS, model: false) {
                    Text(period).deckFont(.data).foregroundStyle(FeedPalette.text2)
                }
            }
        }
        .padding(.vertical, DeckSpace.s)
        .accessibilityElement(children: .combine)
    }
}

/// Fourteen region segments, south (left) to north (right), shaded by rating; forecast-only regions are hatched.
struct SurfCoastStrip: View {
    let surf: SurfOverview
    let selected: String
    let select: (String) -> Void
    @Environment(\.feedColumns) private var columns
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// On a phone 14 segments squeezed into the width are about 23 pt wide, under the 44 pt minimum. When they cannot
    /// all keep 44 pt the strip scrolls sideways and keeps the selected segment in view; wide windows keep the full row.
    var body: some View {
        VStack(alignment: .leading, spacing: DeckSpace.s) {
            ViewThatFits(in: .horizontal) {
                segments
                ScrollViewReader { proxy in
                    ScrollView(.horizontal, showsIndicators: false) { segments }
                        .onAppear { proxy.scrollTo(selected, anchor: .center) }
                        .onChange(of: selected) { _, next in
                            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) {
                                proxy.scrollTo(next, anchor: .center)
                            }
                        }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("surf.strip")
            .accessibilityLabel("Coast regions, south to north")
            .frame(maxWidth: .infinity)
            HStack {
                Text("Cabo").deckFont(.micro).foregroundStyle(FeedPalette.text2)
                Spacer()
                if let region = surf.region(selected) {
                    Text([region.name, region.rating.text, SurfWords.height(region.waveFt)].compactMap { $0 }.joined(separator: " · "))
                        .deckFont(.micro, weight: 600)
                        .foregroundStyle(FeedPalette.text1)
                        .lineLimit(typeSize.isAccessibilitySize ? nil : 1)
                        .minimumScaleFactor(1)
                }
                Spacer()
                Text("Columbia River").deckFont(.micro).foregroundStyle(FeedPalette.text2)
            }
        }
    }

    private var segments: some View {
        HStack(spacing: 3) {
            ForEach(surf.regions) { region in
                Button { select(region.id) } label: {
                    VStack(spacing: 4) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 3)
                                .fill(FeedPalette.text1.opacity(0.1 + 0.16 * Double(region.rating.pips)))
                            if surf.isModelOnly(region.id) {
                                Hatch().stroke(FeedPalette.bg.opacity(0.7), lineWidth: 1)
                                    .clipShape(RoundedRectangle(cornerRadius: 3))
                            }
                            RoundedRectangle(cornerRadius: 3)
                                .strokeBorder(region.id == selected ? FeedPalette.signal : Color.clear, lineWidth: 2)
                        }
                        .frame(height: 44)
                        if columns > 1 {
                            Text(SurfWords.height(region.waveFt)?.replacingOccurrences(of: " ft", with: "") ?? "·")
                                .deckFont(.data)
                                .foregroundStyle(FeedPalette.text2)
                                .lineLimit(1)
                        }
                    }
                    // The 44 pt width sits inside the label: a frame outside a plain Button adds layout space, not hit area.
                    .frame(minWidth: DeckSpace.minTap, maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .id(region.id)
                .accessibilityLabel("\(region.name), \(region.rating.text), \(SurfWords.height(region.waveFt) ?? DeckMissing.sheet)")
                .accessibilityAddTraits(region.id == selected ? .isSelected : [])
                .accessibilityIdentifier("surf.strip.\(region.id)")
            }
        }
    }

    private struct Hatch: Shape {
        func path(in rect: CGRect) -> Path {
            var path = Path()
            var x = rect.minX - rect.height
            while x < rect.maxX {
                path.move(to: CGPoint(x: x, y: rect.maxY))
                path.addLine(to: CGPoint(x: x + rect.height, y: rect.minY))
                x += 5
            }
            return path
        }
    }
}

/// Readings as dots (buoy, pier, shore), the blended median per half degree as a line (dashed where only model and
/// satellite values exist, south of 32.4 N), and your spots in the signal color.
struct SurfWaterChart: View {
    let surf: SurfOverview
    /// The plot grows with the axis labels: a fixed 220 pt left three AX5 labels no room to stay apart.
    @ScaledMetric(relativeTo: .caption) private var chartHeight: CGFloat = 220

    private static let observedFrom = 32.4

    private var readings: [SurfWaterPoint] {
        surf.water.filter { $0.kind != "model" && $0.kind != "satellite" }
    }

    private var pinned: [(name: String, lat: Double, f: Double)] {
        surf.pinned.compactMap { spot in
            guard let lat = spot.lat, let f = spot.waterF else { return nil }
            return (spot.name, lat, f)
        }
    }

    var body: some View {
        let south = surf.bins.filter { $0.lat < Self.observedFrom }
        let north = surf.bins.filter { $0.lat >= Self.observedFrom }
        let all = surf.bins.map(\.f) + readings.map(\.f)
        let lo = (all.min() ?? 50).rounded(.down) - 2, hi = (all.max() ?? 80).rounded(.up) + 2
        VStack(alignment: .leading, spacing: DeckSpace.s) {
            Chart {
                ForEach(readings) { point in
                    PointMark(x: .value("Latitude", point.lat), y: .value("°F", point.f))
                        .foregroundStyle(FeedPalette.text3)
                        .symbolSize(14)
                }
                ForEach(south) { bin in
                    LineMark(x: .value("Latitude", bin.lat), y: .value("°F", bin.f), series: .value("Part", "model"))
                        .foregroundStyle(FeedPalette.text2)
                        .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                }
                ForEach(north) { bin in
                    LineMark(x: .value("Latitude", bin.lat), y: .value("°F", bin.f), series: .value("Part", "observed"))
                        .foregroundStyle(FeedPalette.text1)
                        .lineStyle(StrokeStyle(lineWidth: 2))
                }
                ForEach(pinned, id: \.name) { spot in
                    PointMark(x: .value("Latitude", spot.lat), y: .value("°F", spot.f))
                        .foregroundStyle(FeedPalette.signal)
                        .symbolSize(40)
                }
            }
            .chartXScale(domain: 22.5...46.5)
            .chartYScale(domain: lo...hi)
            .chartXAxis {
                AxisMarks(values: [23, 32.7, 37.8, 46.2]) { value in
                    AxisGridLine().foregroundStyle(FeedPalette.line)
                    AxisValueLabel {
                        if let lat = value.as(Double.self) {
                            // San Francisco and San Diego are one degree of label width apart on a phone, so that label
                            // stacks on two lines instead of running into its neighbour.
                            Text(lat < 25 ? "Cabo" : lat < 35 ? "San Diego" : lat < 40 ? "San\nFrancisco" : "Columbia")
                                .deckFont(.micro, weight: 400)
                                .multilineTextAlignment(.center)
                                .foregroundStyle(FeedPalette.text2)
                        }
                    }
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { value in
                    AxisGridLine().foregroundStyle(FeedPalette.line)
                    AxisValueLabel {
                        if let f = value.as(Double.self) {
                            Text("\(DeckFeedParser.whole(f))°").deckFont(.data).foregroundStyle(FeedPalette.text2)
                        }
                    }
                }
            }
            .frame(height: chartHeight)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(spoken(south: south, north: north))
            Text("Dots are buoy, pier and shore readings. Dashed: forecast only. Your spots in orange.")
                .deckFont(.micro, weight: 400)
                .foregroundStyle(FeedPalette.text2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func spoken(south: [SurfWaterBin], north: [SurfWaterBin]) -> String {
        let warmest = surf.bins.max { $0.f < $1.f }, coldest = surf.bins.min { $0.f < $1.f }
        guard let warmest, let coldest else { return "Water temperature by latitude: no readings" }
        return "Water temperature by latitude: warmest \(SurfWords.water(warmest.f) ?? "") near latitude "
            + "\(DeckFeedParser.whole(warmest.lat)), coldest \(SurfWords.water(coldest.f) ?? "") near latitude \(DeckFeedParser.whole(coldest.lat))"
    }
}

// MARK: Spot sheet

/// One spot: now, swell parts, the 7-day outlook, the tide curve, the nearest buoy, sun and alerts. The region file
/// loads when the sheet opens; until it answers, the overview's values show.
struct SurfSpotSheet: View {
    let spot: SurfSpot
    @ObservedObject var store: DeckFeedStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var data: FeedDataContent?

    private var feed: String { SurfRegions.feed(spot.region) }

    private var detail: SurfRegionDetail? {
        if case .loaded(let page) = store.state(feed) { return page.surfRegion }
        return nil
    }

    private var overview: SurfOverview? {
        if case .loaded(let page) = store.state("surf-coast") { return page.surf }
        return nil
    }

    private var full: SurfSpot { detail?.spots.first { $0.id == spot.id } ?? spot }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DeckSpace.m) {
                    now
                    swell
                    outlook
                    tide
                    buoy
                    sun
                    alerts
                    FeedDataLink { data = dataContent }
                }
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
                .padding(DeckSpace.m)
            }
            .background(FeedPalette.bg.ignoresSafeArea())
            .navigationTitle(spot.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("surf.sheet.done")
                }
            }
            .sheet(item: $data) { FeedDataSheet(content: $0) }
        }
        .task { await store.loadDetail(feed) }
        .accessibilityIdentifier("surf.sheet")
    }

    private var dataContent: FeedDataContent {
        var blends: [(title: String, parts: [DeckBlendPart])] = []
        if !full.parts.isEmpty { blends.append(("Wave height blend", full.parts)) }
        if !full.waterParts.isEmpty { blends.append(("Water temperature readings", full.waterParts)) }
        var notes = full.gaps
        if let station = full.tideStation, let name = detail?.tides.first(where: { $0.id == station })?.name {
            notes.append("Tide table: \(name).")
        }
        if let buoy = full.buoy { notes.append("Nearest buoy: \(buoy.name) (\(buoy.id)).") }
        let sources: [DeckSourceRow]
        if case .loaded(let page) = store.state("surf-coast") { sources = page.sources } else { sources = [] }
        return FeedDataContent(title: spot.name, sources: sources, notes: notes, blends: blends)
    }

    private var now: some View {
        let s = full
        return RealEstateBlock(title: "Now", trailing: [SurfRegions.name(s.region), s.facing.map { "faces \($0)" }]
            .compactMap { $0 }.joined(separator: ", "), identifier: "surf.sheet.now") {
            SurfPips(rating: s.rating)
            if let reason = s.reason {
                Text(reason).deckFont(.body).foregroundStyle(FeedPalette.text2).fixedSize(horizontal: false, vertical: true)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: DeckSpace.m, alignment: .top)],
                      alignment: .leading, spacing: DeckSpace.m) {
                FeedStat(label: "Height", value: SurfWords.height(s.waveFt), caption: SurfWords.feet(s.hsFt).map { "Significant \($0)" },
                         confidence: s.confidence, big: true, identifier: "surf.sheet.height")
                FeedStat(label: s.modelOnly ? "Period, mean" : "Period", value: SurfWords.period(s.periodS, model: s.modelOnly),
                         caption: s.dir, big: true, identifier: "surf.sheet.period")
                FeedStat(label: "Wind", value: SurfWords.wind(s.wind), caption: SurfWords.windWord(s.wind), big: true,
                         identifier: "surf.sheet.wind")
                FeedStat(label: "Water", value: SurfWords.water(s.waterF),
                         caption: s.waterReadings.map { $0 == 1 ? "1 reading" : "\($0) readings" },
                         confidence: s.confidence, big: true, identifier: "surf.sheet.water")
            }
            if s.modelOnly { SurfModelLine(text: SurfWords.modelLine) }
        }
    }

    @ViewBuilder
    private var swell: some View {
        if !full.swell.isEmpty {
            RealEstateBlock(title: "Swell parts", identifier: "surf.sheet.swell") {
                ForEach(full.swell) { part in
                    RealEstateRow(title: part.title, detail: part.dir,
                                  value: SurfWords.feet(part.ft) ?? DeckMissing.cell,
                                  valueCaption: SurfWords.period(part.periodS, model: full.modelOnly),
                                  identifier: "surf.sheet.swell.\(part.part)")
                }
            }
        }
    }

    @ViewBuilder
    private var outlook: some View {
        if !full.days.isEmpty {
            RealEstateBlock(title: "7-day outlook", identifier: "surf.sheet.outlook") {
                SurfOutlookChart(days: full.days)
            }
        }
    }

    @ViewBuilder
    private var tide: some View {
        let station = full.tideStation.flatMap { id in detail?.tides.first { $0.id == id } ?? overview?.tides.first { $0.id == id } }
        RealEstateBlock(title: "Tide", identifier: "surf.sheet.tide") {
            if let station {
                if !station.curve.isEmpty {
                    SurfTideChart(station: station)
                } else if case .loading = store.state(feed) {
                    ProgressView().tint(FeedPalette.text2)
                        .accessibilityLabel("Loading tide")
                }
                if station.kind == "model" {
                    SurfModelLine(text: SurfWords.approximateTide)
                }
                ForEach(station.next.prefix(4)) { next in
                    RealEstateRow(title: next.type == "H" ? "High" : "Low", value: SurfWords.feet(next.ft) ?? DeckMissing.cell,
                                  valueCaption: next.label, identifier: "surf.sheet.tide.\(next.id)")
                }
            } else {
                Text(SurfWords.noTide).deckFont(.body).foregroundStyle(FeedPalette.text2)
            }
        }
    }

    @ViewBuilder
    private var buoy: some View {
        RealEstateBlock(title: "Nearest buoy", identifier: "surf.sheet.buoy") {
            if let ref = full.buoy {
                let reading = overview?.buoys.first { $0.id == ref.id }
                RealEstateRow(title: ref.name, subtitle: ref.km.map { "\(DeckFeedParser.whole($0.rounded())) km away" },
                              detail: reading.flatMap { r in
                                  [r.dir, SurfWords.water(r.waterF), r.ageMin.map { DeckFreshness.short($0 * 60) + " ago" }]
                                      .compactMap { $0 }.joined(separator: " · ")
                              },
                              value: SurfWords.feet(reading?.waveFt), valueCaption: SurfWords.period(reading?.periodS, model: false),
                              identifier: "surf.sheet.buoy.row")
            } else {
                SurfModelLine(text: SurfWords.modelLine)
            }
        }
    }

    @ViewBuilder
    private var sun: some View {
        if !full.sun.isEmpty {
            RealEstateBlock(title: "Sun", identifier: "surf.sheet.sun") {
                // Sunrise, sunset and the rest share one row by default; at accessibility sizes they stack.
                let layout = typeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: DeckSpace.s))
                    : AnyLayout(HStackLayout(alignment: .top, spacing: DeckSpace.m))
                layout {
                    ForEach(full.sun, id: \.label) { item in
                        FeedStat(label: item.label, value: item.time, identifier: "surf.sheet.sun.\(item.label)")
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var alerts: some View {
        let list = (overview?.alerts ?? []).filter { $0.regions.contains(spot.region) }
        if !list.isEmpty {
            RealEstateBlock(title: "Alerts", identifier: "surf.sheet.alerts") {
                ForEach(list) { alert in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(SurfWords.alert(alert)).deckFont(.body, weight: 500).foregroundStyle(FeedPalette.text1)
                        if let text = alert.text {
                            Text(text).deckFont(.meta).foregroundStyle(FeedPalette.text2).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
    }
}

/// One alert on the Surf page: the warning mark, then event, place and end time.
struct SurfAlertRow: View {
    let alert: SurfAlert

    var body: some View {
        Label {
            Text(SurfWords.alert(alert))
                .deckFont(.body)
                .foregroundStyle(FeedPalette.text1)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(FeedPalette.warn)
                .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .feedPanel(padding: DeckSpace.s + 4)
        .accessibilityElement(children: .combine)
    }
}

struct SurfAlertList: Identifiable {
    let id = "surf.alerts"
    let alerts: [SurfAlert]
}

/// Every active alert, your regions first, each group most severe first, with the forecaster's text.
struct SurfAlertsSheet: View {
    let alerts: [SurfAlert]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DeckSpace.s) {
                    ForEach(Array(alerts.enumerated()), id: \.offset) { index, alert in
                        VStack(alignment: .leading, spacing: 4) {
                            SurfAlertRow(alert: alert)
                            if let text = alert.text {
                                Text(text)
                                    .deckFont(.meta)
                                    .foregroundStyle(FeedPalette.text2)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .padding(.horizontal, DeckSpace.s + 4)
                            }
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("surf.alerts.row.\(index)")
                    }
                }
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
                .padding(DeckSpace.m)
            }
            .background(FeedPalette.bg.ignoresSafeArea())
            .navigationTitle("Alerts")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("surf.alerts.done")
                }
            }
        }
        .accessibilityIdentifier("surf.alerts.sheet")
    }
}

/// Morning and afternoon bars per day: height is the top of the wave range, shade is the rating.
struct SurfOutlookChart: View {
    let days: [SurfDay]
    /// The plot grows with the axis labels: a fixed 180 pt left three AX5 labels no room to stay apart.
    @ScaledMetric(relativeTo: .caption) private var chartHeight: CGFloat = 180

    private struct Bar: Identifiable {
        let id: String
        let day: String
        let half: String
        let ft: Double
        let pips: Int
    }

    private var bars: [Bar] {
        days.flatMap { day -> [Bar] in
            [("am", day.am), ("pm", day.pm)].compactMap { half, value in
                guard let value, let ft = value.waveFt.last else { return nil }
                return Bar(id: day.date + half, day: day.label, half: half == "am" ? "Morning" : "Afternoon",
                           ft: ft, pips: value.rating.pips)
            }
        }
    }

    var body: some View {
        Chart(bars) { bar in
            BarMark(x: .value("Day", bar.day), y: .value("Feet", bar.ft))
                .position(by: .value("Half", bar.half))
                .foregroundStyle(FeedPalette.text1.opacity(0.2 + 0.16 * Double(bar.pips)))
                .cornerRadius(2)
        }
        .chartLegend(.hidden)
        .chartXAxis {
            AxisMarks { value in
                AxisValueLabel {
                    if let day = value.as(String.self) {
                        Text(day).deckFont(.micro, weight: 400).foregroundStyle(FeedPalette.text2)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { value in
                AxisGridLine().foregroundStyle(FeedPalette.line)
                AxisValueLabel {
                    if let ft = value.as(Double.self) {
                        Text("\(DeckFeedParser.whole(ft)) ft").deckFont(.data).foregroundStyle(FeedPalette.text2)
                    }
                }
            }
        }
        .frame(height: chartHeight)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("7-day outlook: " + days.map(SurfWords.outlookDay).joined(separator: ", "))
    }
}

/// The next 48 hours of tide with a now marker. A model tide (Baja) is dashed.
struct SurfTideChart: View {
    let station: SurfTideStation
    /// The plot grows with the axis labels: a fixed 160 pt left three AX5 labels no room to stay apart.
    @ScaledMetric(relativeTo: .caption) private var chartHeight: CGFloat = 160

    var body: some View {
        Chart {
            ForEach(station.curve, id: \.at) { point in
                LineMark(x: .value("Time", point.at), y: .value("Feet", point.ft))
                    .foregroundStyle(FeedPalette.text1)
                    .interpolationMethod(.monotone)
                    .lineStyle(StrokeStyle(lineWidth: 2, dash: station.kind == "model" ? [5, 4] : []))
            }
            RuleMark(x: .value("Now", Date()))
                .foregroundStyle(FeedPalette.signal)
                .lineStyle(StrokeStyle(lineWidth: 1.5))
        }
        .chartXAxis {
            AxisMarks(values: .stride(by: .hour, count: 12)) { value in
                AxisGridLine().foregroundStyle(FeedPalette.line)
                AxisValueLabel {
                    if let date = value.as(Date.self) {
                        Text(date, format: .dateTime.weekday(.abbreviated).hour())
                            .deckFont(.micro, weight: 400)
                            .foregroundStyle(FeedPalette.text2)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { value in
                AxisValueLabel {
                    if let ft = value.as(Double.self) {
                        Text(String(format: "%.0f ft", ft)).deckFont(.data).foregroundStyle(FeedPalette.text2)
                    }
                }
            }
        }
        .frame(height: chartHeight)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(SurfWords.tideChart(station.next))
    }
}
