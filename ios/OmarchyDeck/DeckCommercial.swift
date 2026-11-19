import Foundation

/// Commercial (2026-11-13): the native twin of the web deck's Markets > Commercial deal desk (`static/cre.js`). It reads
/// `GET /api/cre?person=tanner`: scored for-sale deals, the person's buy boxes and the other desks' boxes. The overview
/// band (summary tables, charts, best deals), the three co-invest views and the stake sizing follow the web desk's rules
/// one for one. Read only: the app never saves a buy box or marks matches seen.
///
/// Every number names its source, an estimate says it is one, and an unknown prints the missing mark instead of zero.
enum CommercialCounty {
    static let short: [String: String] = [
        "Los Angeles County": "Los Angeles", "Orange County": "Orange", "San Diego County": "San Diego",
        "Riverside County": "Riverside", "San Bernardino County": "San Bernardino", "Ventura County": "Ventura",
    ]
    static let all = ["Los Angeles County", "Orange County", "San Diego County", "Riverside County",
                      "San Bernardino County", "Ventura County"]

    static func name(_ county: String?) -> String? {
        guard let county, !county.isEmpty else { return nil }
        return short[county] ?? county
    }
}

enum CommercialSort: String, CaseIterable, Identifiable {
    case score, cap, price, ppsf, dom, newest

    var id: String { rawValue }

    var title: String {
        switch self {
        case .score: return "Best score"
        case .cap: return "Highest cap rate"
        case .price: return "Lowest price"
        case .ppsf: return "Lowest $/SF"
        case .dom: return "Longest on market"
        case .newest: return "Newest"
        }
    }
}

/// One scored for-sale deal from the realestate collector's deal desk.
struct CommercialDeal: Identifiable, Equatable {
    let id: String
    let title: String
    let address: String?
    let city: String?
    let county: String?
    let zip: String?
    let metro: String?
    let type: String
    let subtype: String?
    let broker: String?
    let source: String?
    let link: URL?
    let price: Double?
    let sqft: Double?
    let units: Double?
    let ppsf: Double?
    let ppu: Double?
    let cap: Double?
    /// "listed" when the listing shows the cap rate, anything else is an estimate from public rents.
    let capKind: String?
    let daysOnMarket: Double?
    let listed: Double?
    let score: Double?
    let dscrCre: Double?
    let dscrRes: Double?
    let cocCre: Double?
    let cocRes: Double?
    /// Lowercased subtype, title, tenancy and description: what the small-deal rule reads.
    let smallText: String
    /// Lowercased address, title and place words: what the search box reads.
    let searchText: String

    var isListedCap: Bool { capKind == "listed" }
}

/// A buy box's filter, as `cre.rs` validates it. An unset field matches anything.
struct CommercialFilter: Equatable {
    var types: [String] = []
    var counties: [String] = []
    var zips: [String] = []
    var priceMin: Double?
    var priceMax: Double?
    var capMin: Double?
    var unitsMin: Double?
    var sfMin: Double?
    var domMax: Double?
    var scoreMin: Double?
    /// Floor on the deal's DSCR at the assumed commercial rate (`dscr_cre`, the desk's DSCR column). A deal with no
    /// DSCR fails a box that sets it, as the server's `/api/cre/deals?box=` does.
    var dscrMin: Double?
    var query = ""
    var sort: CommercialSort = .score
}

struct CommercialBuyBox: Identifiable, Equatable {
    let id: String
    let name: String
    let filter: CommercialFilter
}

/// The deck's financing assumptions. They are assumptions, not quotes, and the desk says so.
struct CommercialAssumptions: Equatable {
    var resLTV = 0.75
    var creLTV = 0.65
    var closing = 0.02
    var resLabel = ""
    var creLabel = ""
    var note = ""
}

struct CommercialRate: Equatable {
    let label: String
    let value: Double
    let asOf: String?
    let source: String
}

struct CommercialSummaryRow: Identifiable, Equatable {
    var id: String { key }
    let key: String
    let count: Int
    let price: Double?
    let ppsf: Double?
    let ppu: Double?
    let cap: Double?
    /// How many of the rows show a cap rate the listing itself printed.
    let listedCaps: Int
    let daysOnMarket: Double?
    /// Percent of the rows with a price cut.
    let cuts: Double?
}

struct CommercialBar: Identifiable, Equatable {
    var id: String { label }
    let label: String
    let value: Double
    let isEstimate: Bool
}

/// The overview band, computed once from all of the desk's rows (the web desk does the same).
struct CommercialOverview: Equatable {
    let byType: [CommercialSummaryRow]
    let byCounty: [CommercialSummaryRow]
    let byZip: [CommercialSummaryRow]
    let capByType: [CommercialBar]
    let domBuckets: [CommercialBar]
    let countyCounts: [CommercialBar]
    let rateBars: [CommercialBar]
    let medianListedCap: Double?
    let freshCount: Int
    let staleCount: Int
    let sourceCount: Int
}

/// What a Tanner stake in one deal looks like, sized to the Housing budget.
struct CommercialStake: Equatable {
    let need: Double
    let share: Double
    let equity: Double
    let cashFlow: Double?
    let coc: Double?
    let dscr: Double?
    let whole: Bool
    let small: Bool
    let usesResidentialScenario: Bool
    let fits: Bool

    var shareText: String { RealEstateWords.percent(share * 100, digits: share < 0.1 ? 2 : 1) }

    var scenario: String {
        usesResidentialScenario ? "30-year scenario, 25% down plus closing" : "commercial scenario, 35% down plus closing"
    }

    var verdict: String {
        if fits { return "A stake fits: your budget clears the assumed LP minimum and the deal covers its debt." }
        guard let dscr else { return "No stake fit: the deal has no income figure to check its debt." }
        return dscr < 1 ? "No stake fit: the deal does not cover its debt at this rate."
                        : "No stake fit: your budget is under the assumed LP minimum."
    }
}

enum CommercialView: String, CaseIterable, Identifiable {
    case all, jordan, riley, small

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "All deals"
        case .jordan: return "Co-invest with Jordan"
        case .riley: return "Co-invest with Riley"
        case .small: return "Small deals you could buy whole"
        }
    }
}

struct CommercialDesk: Equatable {
    let person: String
    let label: String
    let about: String
    /// A viewer token sees only its own desk and no investor views.
    let viewer: Bool
    let generated: Double?
    let deals: [CommercialDeal]
    let boxes: [CommercialBuyBox]
    /// Jordan's and Riley's boxes, which the owner's co-invest views read. Empty for a viewer.
    let boxesOf: [String: [CommercialBuyBox]]
    let assumptions: CommercialAssumptions
    let rates: [CommercialRate]
    let overview: CommercialOverview
    let types: [String]
    let sourcesNote: String?
    let methodNote: String?

    var isTanner: Bool { person == "tanner" && !viewer }
}

// MARK: Rules (ported from static/cre.js)

enum CommercialLogic {
    /// An LP stake usually starts near this (an assumption the desk states).
    static let lpMinimum = 25_000.0

    // MARK: Filters

    static func matches(_ deal: CommercialDeal, _ filter: CommercialFilter) -> Bool {
        if !filter.types.isEmpty, !filter.types.contains(deal.type) { return false }
        if !filter.counties.isEmpty, !filter.counties.contains(deal.county ?? "") { return false }
        if !filter.zips.isEmpty {
            let zip = deal.zip ?? ""
            if !filter.zips.contains(where: { zip.hasPrefix($0) }) { return false }
        }
        if let min = filter.priceMin { guard let price = deal.price, price >= min else { return false } }
        if let max = filter.priceMax { guard let price = deal.price, price <= max else { return false } }
        if let min = filter.capMin { guard let cap = deal.cap, cap >= min else { return false } }
        if let min = filter.unitsMin { guard let units = deal.units, units >= min else { return false } }
        if let min = filter.sfMin { guard let sqft = deal.sqft, sqft >= min else { return false } }
        if let max = filter.domMax { guard let days = deal.daysOnMarket, days <= max else { return false } }
        if let min = filter.scoreMin { guard let score = deal.score, score >= min else { return false } }
        if let min = filter.dscrMin { guard let dscr = deal.dscrCre, dscr >= min else { return false } }
        let query = filter.query.trimmingCharacters(in: .whitespaces).lowercased()
        if !query.isEmpty, !deal.searchText.contains(query) { return false }
        return true
    }

    /// Missing values sort last whatever the direction; ties keep the feed's order.
    static func sorted(_ deals: [CommercialDeal], by sort: CommercialSort) -> [CommercialDeal] {
        func key(_ d: CommercialDeal) -> Double? {
            switch sort {
            case .score: return d.score
            case .cap: return d.cap
            case .price: return d.price
            case .ppsf: return d.ppsf
            case .dom: return d.daysOnMarket
            case .newest: return d.listed ?? d.daysOnMarket.map { -$0 } ?? -1e9
            }
        }
        let direction: Double = (sort == .price || sort == .ppsf) ? 1 : -1
        return deals.enumerated().map { (index: $0.offset, deal: $0.element, value: key($0.element)) }
            .sorted { a, b in
                switch (a.value, b.value) {
                case (nil, nil): return a.index < b.index
                case (nil, _): return false
                case (_, nil): return true
                case let (x?, y?): return x == y ? a.index < b.index : (x - y) * direction < 0
                }
            }.map(\.deal)
    }

    // MARK: Tanner as a smaller investor

    /// 2-4 unit multifamily, mixed use to $3M, and small single-tenant net-lease retail.
    static func isSmall(_ deal: CommercialDeal) -> Bool {
        switch deal.type {
        case "Multifamily":
            guard let units = deal.units else { return false }
            return units >= 2 && units <= 4
        case "Mixed use":
            return (deal.price ?? .infinity) <= 3_000_000
        case "Retail":
            guard let price = deal.price, price <= 3_000_000 else { return false }
            return ["net lease", "nnn", "single tenant", "absolute"].contains { deal.smallText.contains($0) }
        default:
            return false
        }
    }

    /// A stake sized to the equity cap (the Housing budget). Deal equity is price x (1 - loan to value) plus closing,
    /// at the 30-year scenario for 2-4 units and the commercial one otherwise.
    static func stake(_ deal: CommercialDeal, cap: Double?, _ assumptions: CommercialAssumptions) -> CommercialStake? {
        guard let cap, cap > 0, let price = deal.price else { return nil }
        let residential = deal.type == "Multifamily" && (deal.units.map { $0 <= 4 } ?? false)
        let ltv = residential ? assumptions.resLTV : assumptions.creLTV
        let need = price * (1 - ltv) + price * assumptions.closing
        let share = min(1, cap / need)
        let equity = share * need
        let coc = residential ? deal.cocRes : deal.cocCre
        let dscr = residential ? deal.dscrRes : deal.dscrCre
        return CommercialStake(need: need, share: share, equity: equity, cashFlow: coc.map { equity * $0 / 100 },
                               coc: coc, dscr: dscr, whole: need <= cap, small: isSmall(deal),
                               usesResidentialScenario: residential,
                               fits: cap >= lpMinimum && (dscr.map { $0 >= 1 } ?? false))
    }

    /// Views on Tanner's desk: every deal, deals in Jordan's or Riley's boxes that a stake fits, small deals to buy whole.
    static func inView(_ deal: CommercialDeal, _ view: CommercialView, desk: CommercialDesk, cap: Double?) -> Bool {
        if view == .all { return true }
        guard let stake = stake(deal, cap: cap, desk.assumptions) else { return false }
        if view == .small { return stake.small && stake.whole }
        let boxes = desk.boxesOf[view.rawValue] ?? []
        return stake.fits && boxes.contains { matches(deal, $0.filter) }
    }

    /// The deals on screen: a co-invest view, else the active filter, sorted.
    static func hits(_ desk: CommercialDesk, view: CommercialView, filter: CommercialFilter, cap: Double?) -> [CommercialDeal] {
        let rows = view == .all ? desk.deals.filter { matches($0, filter) }
                                : desk.deals.filter { inView($0, view, desk: desk, cap: cap) }
        return sorted(rows, by: filter.sort)
    }

    // MARK: Overview

    /// A letter from the desk score: A 70+, B 55+, C 40+, else D.
    static func grade(_ score: Double?) -> String {
        guard let score else { return DeckMissing.cell }
        return score >= 70 ? "A" : score >= 55 ? "B" : score >= 40 ? "C" : "D"
    }

    // MARK: Words the desk prints

    /// How the charts are built, for the Data sheet (the page prints no method text).
    static let chartNotes = [
        "Cap rate by asset class: median of listed and estimated caps, classes with 3 or more. Estimates use public rents.",
        "Days listed: the listing's own date when it gives one, else the first day this feed saw it.",
        "Listings by county: count of for-sale listings in the desk.",
    ]

    /// The LP minimum the stake rule assumes, said as an assumption.
    static var lpLine: String {
        "An LP stake usually starts near \(DeckMoney.short(lpMinimum)) (assumption)."
    }

    /// "Top 12 of 31" when a summary table cuts its rows, else nil.
    static func cut(shown limit: Int, of count: Int) -> String? {
        count > limit ? "Top \(limit) of \(count)" : nil
    }

    /// What "Best deals" covers: a co-invest or small view, a saved buy box, your own filters, or every deal.
    static func bestTitle(view: CommercialView, boxName: String?, filtered: Bool) -> String {
        switch view {
        case .jordan, .riley: return "Best deals: \(view.title.prefix(1).lowercased() + view.title.dropFirst())"
        case .small: return "Best deals: small deals you could buy whole"
        case .all:
            if let boxName { return "Best deals in buy box \(boxName)" }
            return filtered ? "Best deals: your filters" : "Best deals: all deals"
        }
    }

    /// A deal row's detail line: grade and score, size, days listed, and your stake share with its yearly cash flow.
    /// The stake is sized to your budget, so it stays masked until Show amounts, as in the deal sheet. An unscored
    /// deal says nothing of a grade, as the web's row leaves out a value it does not have.
    static func rowDetail(_ deal: CommercialDeal, stake: CommercialStake?, showAmounts: Bool) -> String {
        var parts = deal.score.map { ["Grade \(grade($0)) · score \(RealEstateWords.count($0))"] } ?? []
        if let units = deal.units { parts.append(RealEstateWords.count(units) + " units") }
        else if let sqft = deal.sqft { parts.append(RealEstateWords.count(sqft) + " SF") }
        if let days = deal.daysOnMarket { parts.append(RealEstateWords.count(days) + " days listed") }
        if let stake {
            parts.append(showAmounts
                ? "your stake \(stake.shareText)" + (stake.cashFlow.map { ", \(DeckMoney.short($0))/yr" } ?? "")
                : "your stake •••")
        }
        return parts.joined(separator: " · ")
    }

    static func median(_ values: [Double?]) -> Double? {
        let v = values.compactMap { $0 }.sorted()
        guard !v.isEmpty else { return nil }
        let mid = v.count / 2
        return v.count % 2 == 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2
    }

    static func quantile(_ sorted: [Double], _ p: Double) -> Double? {
        guard !sorted.isEmpty, p.isFinite, (0...1).contains(p) else { return nil }
        let index = Double(sorted.count - 1) * p
        let lo = Int(index.rounded(.down)), hi = Int(index.rounded(.up))
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - Double(lo))
    }

    static func summarize(_ deals: [CommercialDeal], key: (CommercialDeal) -> String?) -> [CommercialSummaryRow] {
        var groups: [String: [CommercialDeal]] = [:]
        var order: [String] = []
        for deal in deals {
            guard let k = key(deal), !k.isEmpty else { continue }
            if groups[k] == nil { order.append(k) }
            groups[k, default: []].append(deal)
        }
        return order.map { k in
            let rows = groups[k] ?? []
            let listed = rows.filter(\.isListedCap)
            return CommercialSummaryRow(
                key: k, count: rows.count, price: median(rows.map(\.price)), ppsf: median(rows.map(\.ppsf)),
                ppu: median(rows.map(\.ppu)), cap: median(listed.map(\.cap)), listedCaps: listed.count,
                daysOnMarket: median(rows.map(\.daysOnMarket)), cuts: nil)
        }.sorted { $0.count == $1.count ? $0.key < $1.key : $0.count > $1.count }
    }

    private static let domBuckets: [(low: Double, high: Double, label: String)] = [
        (0, 7, "0-7 d"), (8, 30, "8-30 d"), (31, 90, "31-90 d"), (91, 180, "91-180 d"),
        (181, 365, "181-365 d"), (366, .infinity, "Over a year"),
    ]

    static func overview(_ deals: [CommercialDeal], rates: [CommercialRate], sourceCount: Int) -> CommercialOverview {
        let byZip = summarize(deals) { d in
            guard let zip = d.zip, !zip.isEmpty else { return nil }
            return d.city.map { "\(zip) \(String($0.prefix(20)))" } ?? zip
        }.filter { $0.count >= 3 }
        var caps: [String: [Double]] = [:]
        for deal in deals { if let cap = deal.cap { caps[deal.type, default: []].append(cap) } }
        let capBars = caps.filter { $0.value.count >= 3 }.sorted { $0.value.count > $1.value.count }.prefix(7).compactMap { (type, values) -> CommercialBar? in
            guard let value = quantile(values.sorted(), 0.5) else { return nil }
            return CommercialBar(label: type, value: value, isEstimate: false)
        }
        let days = deals.compactMap(\.daysOnMarket)
        let dom = domBuckets.map { bucket in
            CommercialBar(label: bucket.label, value: Double(days.filter { $0 >= bucket.low && $0 <= bucket.high }.count),
                          isEstimate: false)
        }
        var counties: [String: Int] = [:]
        for deal in deals { if let name = CommercialCounty.name(deal.county)?.replacingOccurrences(of: " County", with: "") {
            counties[name, default: 0] += 1 } }
        let countyBars = counties.sorted { $0.value == $1.value ? $0.key < $1.key : $0.value > $1.value }.prefix(7)
            .map { CommercialBar(label: $0.key, value: Double($0.value), isEstimate: false) }
        let medianCap = median(deals.filter(\.isListedCap).map(\.cap))
        var bars = rates.map { CommercialBar(label: $0.label, value: $0.value, isEstimate: $0.label.contains("est.")) }
        if let medianCap { bars.append(CommercialBar(label: "Median listed cap", value: medianCap, isEstimate: false)) }
        return CommercialOverview(
            byType: summarize(deals) { $0.type }, byCounty: summarize(deals) { CommercialCounty.name($0.county) },
            byZip: byZip, capByType: Array(capBars), domBuckets: dom, countyCounts: Array(countyBars),
            rateBars: bars, medianListedCap: medianCap,
            freshCount: days.filter { $0 < 30 }.count, staleCount: days.filter { $0 >= 90 }.count,
            sourceCount: sourceCount)
    }
}

// MARK: Parser

enum DeckCommercialParser {
    /// A desk answer, or the reason it is not reporting.
    enum Outcome: Equatable {
        case desk(CommercialDesk)
        case notReporting(String)
    }

    static func outcome(from json: [String: Any]) -> Outcome {
        if let status = DeckFeedParser.text(json["status"]), status == "not_reporting" || json["deals"] == nil {
            return .notReporting(DeckFeedParser.text(json["reason"]) ?? "The deal desk did not answer.")
        }
        guard let rawDeals = json["deals"] as? [Any] else {
            return .notReporting(DeckFeedParser.text(json["reason"]) ?? "The deal desk did not answer.")
        }
        let deals = rawDeals.compactMap { $0 as? [String: Any] }.compactMap(deal)
        let profile = json["profile"] as? [String: Any] ?? [:]
        let assumptions = self.assumptions(json["assumptions"])
        let rates = self.rates(json["rates"])
        let counts = json["counts"] as? [String: Any] ?? [:]
        let sourceCount = (counts["by_source"] as? [String: Any])?.count ?? 0
        var boxesOf: [String: [CommercialBuyBox]] = [:]
        for (person, value) in (json["boxes_of"] as? [String: Any] ?? [:]) { boxesOf[person] = buyBoxes(value) }
        let method = json["method"] as? [String: Any]
        return .desk(CommercialDesk(
            person: DeckFeedParser.text(json["person"]) ?? "tanner",
            label: DeckFeedParser.text(profile["label"]) ?? "Deal desk",
            about: DeckFeedParser.text(profile["about"]) ?? "",
            viewer: (json["viewer"] as? Bool) == true,
            generated: DeckFeedParser.number(json["generated_at"]),
            deals: deals,
            boxes: buyBoxes(profile["boxes"]),
            boxesOf: boxesOf,
            assumptions: assumptions,
            rates: rates,
            overview: CommercialLogic.overview(deals, rates: rates, sourceCount: sourceCount),
            types: (json["types"] as? [Any] ?? []).compactMap { $0 as? String }.filter { $0 != "Other" },
            sourcesNote: DeckFeedParser.text(json["sources_note"]),
            methodNote: method.flatMap { DeckFeedParser.text($0["note"]) }))
    }

    /// The desk's provenance and method lines, for the Data sheet. The page itself prints none of them.
    static func notes(_ desk: CommercialDesk) -> [String] {
        var out: [String] = []
        let built = RealEstateWords.day(desk.generated)
        out.append("\(RealEstateWords.count(desk.deals.count)) listings from \(desk.overview.sourceCount) public sources"
                   + (built.isEmpty ? "." : ", desk built \(built).") + " Asking prices, not closed sales.")
        out += desk.rates.map { rate in
            "\(rate.label): \(rate.source)" + (rate.asOf.map { ", \($0)" } ?? "") + "."
        }
        out.append("Grade from the desk score: A 70+, B 55+, C 40+, else D. DSCR at the assumed commercial rate.")
        out += CommercialLogic.chartNotes
        if !desk.assumptions.note.isEmpty { out.append(desk.assumptions.note) }
        if let method = desk.methodNote { out.append(method) }
        if let sources = desk.sourcesNote { out.append(sources) }
        return out
    }

    // MARK: Deals

    static func deal(_ row: [String: Any]) -> CommercialDeal? {
        guard let id = DeckFeedParser.text(row["id"]) else { return nil }
        let number = DeckFeedParser.number
        let cap = row["cap"] as? [String: Any]
        let dom = row["dom"] as? [String: Any]
        let address = DeckFeedParser.text(row["addr"])
        let title = DeckFeedParser.text(row["title"]) ?? address ?? "Address withheld"
        let subtype = DeckFeedParser.text(row["subtype"])
        let lower: (String?) -> String = { String(($0 ?? "").prefix(300)).lowercased() }
        let smallText = [subtype, DeckFeedParser.text(row["title"]), DeckFeedParser.text(row["tenancy"]),
                         DeckFeedParser.text(row["desc"])].map(lower).joined(separator: " ")
        let searchText = ["zip", "city", "county", "metro", "addr", "title", "subtype", "broker"]
            .map { String((DeckFeedParser.text(row[$0]) ?? "").prefix(200)).lowercased() }.joined(separator: " ")
        return CommercialDeal(
            id: id, title: String(title.prefix(70)), address: address, city: DeckFeedParser.text(row["city"]),
            county: DeckFeedParser.text(row["county"]), zip: DeckFeedParser.text(row["zip"]),
            metro: DeckFeedParser.text(row["metro"]), type: DeckFeedParser.text(row["type"]) ?? "Other",
            subtype: subtype, broker: DeckFeedParser.text(row["broker"]), source: DeckFeedParser.text(row["source"]),
            link: DeckFeedParser.url(row["url"]), price: number(row["price"]), sqft: number(row["sqft"]),
            units: number(row["units"]), ppsf: number(row["ppsf"]), ppu: number(row["ppu"]),
            cap: cap.flatMap { number($0["value"]) }, capKind: cap.flatMap { DeckFeedParser.text($0["kind"]) },
            daysOnMarket: dom.flatMap { number($0["days"]) }, listed: number(row["listed_at"]),
            score: number(row["score"]), dscrCre: number(row["dscr_cre"]), dscrRes: number(row["dscr_res"]),
            cocCre: number(row["coc_cre"]), cocRes: number(row["coc_res"]),
            smallText: smallText, searchText: searchText)
    }

    // MARK: Boxes, assumptions, rates

    static func buyBoxes(_ value: Any?) -> [CommercialBuyBox] {
        DeckFeedParser.rows(value).compactMap { row in
            guard let id = DeckFeedParser.text(row["id"]) else { return nil }
            return CommercialBuyBox(id: id, name: DeckFeedParser.text(row["name"]) ?? id,
                                    filter: filter(row["f"] as? [String: Any] ?? [:]))
        }
    }

    static func filter(_ f: [String: Any]) -> CommercialFilter {
        func strings(_ key: String) -> [String] { (f[key] as? [Any] ?? []).compactMap { $0 as? String } }
        var out = CommercialFilter()
        out.types = strings("types")
        out.counties = strings("counties")
        out.zips = strings("zips")
        out.priceMin = DeckFeedParser.number(f["price_min"])
        out.priceMax = DeckFeedParser.number(f["price_max"])
        out.capMin = DeckFeedParser.number(f["cap_min"])
        out.unitsMin = DeckFeedParser.number(f["units_min"])
        out.sfMin = DeckFeedParser.number(f["sf_min"])
        out.domMax = DeckFeedParser.number(f["dom_max"])
        out.scoreMin = DeckFeedParser.number(f["score_min"])
        out.dscrMin = DeckFeedParser.number(f["dscr_min"])
        out.query = DeckFeedParser.text(f["q"]) ?? ""
        out.sort = (DeckFeedParser.text(f["sort"]).flatMap(CommercialSort.init(rawValue:))) ?? .score
        return out
    }

    static func assumptions(_ value: Any?) -> CommercialAssumptions {
        let block = value as? [String: Any] ?? [:]
        var out = CommercialAssumptions()
        let res = block["res"] as? [String: Any]
        let cre = block["cre"] as? [String: Any]
        if let ltv = res.flatMap({ DeckFeedParser.number($0["ltv"]) }), ltv > 0 { out.resLTV = ltv }
        if let ltv = cre.flatMap({ DeckFeedParser.number($0["ltv"]) }), ltv > 0 { out.creLTV = ltv }
        if let closing = DeckFeedParser.number(block["closing"]) { out.closing = closing }
        out.resLabel = res.flatMap { DeckFeedParser.text($0["label"]) } ?? ""
        out.creLabel = cre.flatMap { DeckFeedParser.text($0["label"]) } ?? ""
        out.note = DeckFeedParser.text(block["note"]) ?? ""
        return out
    }

    static func rates(_ value: Any?) -> [CommercialRate] {
        let block = value as? [String: Any] ?? [:]
        return [("30-year fixed", "mortgage_30y"), ("10-year Treasury", "treasury_10y"), ("Commercial, est.", "commercial")]
            .compactMap { label, key in
                guard let entry = block[key] as? [String: Any], let rate = DeckFeedParser.number(entry["value"]) else { return nil }
                return CommercialRate(label: label, value: rate, asOf: DeckFeedParser.text(entry["as_of"]).map { String($0.prefix(10)) },
                                      source: DeckFeedParser.text(entry["src"]) ?? "")
            }
    }
}
