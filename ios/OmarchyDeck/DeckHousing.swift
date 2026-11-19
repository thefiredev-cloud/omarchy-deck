import Foundation

/// Housing (2026-11-13): the native twin of the web deck's Markets > Housing page. It reads `GET /api/realestate`
/// (owner markets, mortgage rates, for-sale homes, the 55+ hide note) and the owner-only budget from
/// `GET /api/housing/profile`. Foundation only, so the Linux harness checks the numbers without SwiftUI.
///
/// Rules carried over from the web page: an unknown value prints the one missing mark (`DeckMissing`) and is never
/// zero, 55+ homes are hidden by the collector and counted in a note, and every figure names its source and date.
/// Money is `DeckMoney.short`, the web's one form.
enum RealEstateWords {
    /// 1,234. Unknown is the missing mark.
    static func count(_ value: Double?) -> String {
        guard let n = value else { return DeckMissing.cell }
        let whole = DeckFeedParser.whole(n.rounded())
        return (whole < 0 ? "-" : "") + DeckFormat.grouped(String(abs(whole)))
    }

    static func count(_ value: Int) -> String { count(Double(value)) }

    /// 6.6%: the web's rounding (`DeckFormat.percent`). Unknown is the missing mark.
    static func percent(_ value: Double?, digits: Int = 1) -> String {
        guard let n = value else { return DeckMissing.cell }
        return DeckFormat.percent(n, places: digits)
    }

    /// +7.1%, \u{2212}2.2%: the web's change form. A change in percent points of a year.
    static func signed(_ value: Double?, digits: Int = 1) -> String {
        guard let n = value else { return DeckMissing.cell }
        return DeckFormat.change(n, places: digits)
    }

    /// 1.99x. Unknown is the missing mark.
    static func multiple(_ value: Double?) -> String {
        guard let n = value else { return DeckMissing.cell }
        return String(format: "%.2f", n) + "x"
    }

    /// Epoch seconds as the UTC day the sources print, "2026-11-13". Empty when unknown.
    static func day(_ epoch: Double?) -> String {
        guard let epoch else { return "" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date(timeIntervalSince1970: epoch))
    }
}

// MARK: Housing

/// One owner market: a ZIP, a county or the United States.
struct HousingMarketRow: Identifiable, Equatable {
    let id: String
    let name: String
    /// "Home ZIP 90001", "South OC", "Orange County", "United States".
    let tier: String
    /// The Zillow home value index, "$1.79M". Nil reads the missing mark.
    let value: String?
    /// "+7.1% 1-yr".
    let change: String?
    /// "79 homes for sale · list price $2.23M · sale price $1.86M · 55 days to sell": the words of `NationalWords`.
    let detail: String
    let asOf: String?
}

/// One reading with its publisher and date, such as the 30-year fixed rate.
struct HousingReading: Identifiable, Equatable {
    var id: String { label }
    let label: String
    /// Nil reads "No data".
    let value: String?
    let source: String
}

struct HousingHome: Identifiable, Equatable {
    let id: String
    let title: String
    let subtitle: String
    let city: String?
    let type: String?
    let price: Double?
    let source: String?
    let listed: Date?
    let link: URL?
}

struct AgeRestrictedHome: Identifiable, Equatable {
    let id: String
    let line: String
}

/// 55+ homes the collector hid from every residential list (owner order 2026-11-12), with the reason counts.
struct AgeRestrictedNote: Equatable {
    let hidden: Int
    /// "35 on the 55+ list, 2 listing text".
    let why: String?
    let rows: [AgeRestrictedHome]
    /// "List: 81 communities ... Checked 2026-11-13."
    let footnote: String?

    var headline: String {
        "\(hidden) age-restricted \(hidden == 1 ? "home" : "homes") hidden (55+, 62+ and senior communities)"
            + (why.map { ": " + $0 } ?? "") + "."
    }
}

/// A national commercial series from the realestate feed (FRED), with its publisher and date.
struct CREIndicator: Identifiable, Equatable {
    var id: String { label }
    let label: String
    let value: String?
    let source: String
}

struct HousingBudget: Equatable {
    let amount: Double
    /// "income" or "cash", as the deck's budget method names it.
    let basis: String?

    var summary: String {
        DeckMoney.short(amount) + (basis.map { " (\($0))" } ?? "")
    }
}

/// The Housing page opens with eight homes and can reveal at most twenty.
enum HousingHomeList {
    static let initialLimit = 8
    static let expandedLimit = 20

    static func visibleCount(total: Int, expanded: Bool) -> Int {
        min(max(total, 0), expanded ? expandedLimit : initialLimit)
    }

    static func additionalCount(total: Int) -> Int {
        max(0, min(total, expandedLimit) - initialLimit)
    }
}

struct HousingPage: Equatable {
    let area: String?
    let markets: [HousingMarketRow]
    let rates: [HousingReading]
    let indicators: [CREIndicator]
    /// Series the feed marks unavailable, "Office and industrial vacancy: No free public metro series."
    let unavailable: [String]
    let ageNote: AgeRestrictedNote?
    /// Newest first, a repeated listing counted once.
    let homes: [HousingHome]
    let commercialCount: Int
    let checked: Date?

    /// Homes inside a price ceiling and an optional city; an unknown price never passes a ceiling.
    func homes(within ceiling: Double?, city: String?) -> [HousingHome] {
        homes.filter { home in
            if let ceiling { guard let price = home.price, price <= ceiling else { return false } }
            if let city, home.city != city { return false }
            return true
        }
    }

    var cities: [String] {
        var counts: [String: Int] = [:]
        for home in homes { if let city = home.city { counts[city, default: 0] += 1 } }
        return counts.sorted { $0.value == $1.value ? $0.key < $1.key : $0.value > $1.value }.map(\.key)
    }
}

enum DeckHousingParser {
    private static let tierWords = ["home": "Home ZIP", "south_oc": "South OC", "oc": "Orange County",
                                    "la": "LA County", "sd": "San Diego", "us": "United States"]

    static func page(from json: [String: Any], now: Date = Date()) -> HousingPage {
        let market = json["market"] as? [String: Any] ?? [:]
        let homes = homeRows(json["homes"])
        return HousingPage(
            area: DeckFeedParser.text(market["area"]),
            markets: markets(market),
            rates: rates(market),
            indicators: indicators(market),
            unavailable: unavailable(market),
            ageNote: ageNote(market["age_restricted"]),
            homes: homes,
            commercialCount: (json["commercial"] as? [Any])?.count ?? 0,
            checked: DeckFeedParser.number(market["listings_checked_at"]).map { Date(timeIntervalSince1970: $0) })
    }

    static func budget(from json: [String: Any]) -> HousingBudget? {
        guard let block = json["budget"] as? [String: Any], let amount = DeckFeedParser.number(block["budget"]),
              amount > 0 else { return nil }
        let basis = DeckFeedParser.text(block["basis"]).map { String($0.prefix(30)) }
        return HousingBudget(amount: amount, basis: basis)
    }

    /// What the Housing page used to print under its blocks, for its Data sheet: dates and publishers of the market
    /// rows, the rates, and the 55+ note with its list. The national CRE series belong to Commercial (`commercialNotes`).
    static func notes(_ page: HousingPage) -> [String] {
        var out: [String] = []
        if let asOf = page.markets.compactMap(\.asOf).first {
            out.append("Market rows: \(asOf). Inventory, list and sale prices from Zillow Research; days on market from Realtor.com.")
        }
        out += page.rates.map { "\($0.label) rate: \($0.source)." }
        if let note = page.ageNote {
            out.append(note.headline)
            out += note.rows.map(\.line)
            if let footnote = note.footnote { out.append(footnote) }
        }
        return out
    }

    /// The national CRE series lines of the same feed, for Commercial's Data sheet: each series' source and date, and
    /// the series that are not published.
    static func commercialNotes(_ page: HousingPage) -> [String] {
        page.indicators.map { "\($0.label): \($0.source)." } + page.unavailable
    }

    // MARK: Markets and rates

    private static func markets(_ market: [String: Any]) -> [HousingMarketRow] {
        let residential = market["residential"] as? [String: Any] ?? [:]
        let areas = DeckFeedParser.rows(residential["areas"])
        if areas.isEmpty { return legacy(market) }
        return areas.enumerated().map { index, area in
            let zhvi = area["zhvi"] as? [String: Any]
            func value(_ key: String) -> Double? {
                (area[key] as? [String: Any]).flatMap { DeckFeedParser.number($0["value"]) }
            }
            let forSale = value("inventory") ?? DeckFeedParser.number(area["active_listings"])
            let list = value("list_price") ?? DeckFeedParser.number(area["realtor_list_price"])
            // A county carries days to pending; a ZIP's second source carries days on market, which the web calls days to sell.
            let days: (key: String, value: Double)? = value("days_to_pending").map { ("days_to_pending", $0) }
                ?? DeckFeedParser.number(area["days_on_market"]).map { ("days_on_market", $0) }
            let parts = [forSale.flatMap { NationalWords.phrase("inventory", $0) },
                         list.flatMap { NationalWords.phrase("list_price", $0) },
                         value("sale_price").flatMap { NationalWords.phrase("sale_price", $0) },
                         days.flatMap { NationalWords.phrase($0.key, $0.value) }].compactMap { $0 }
            let key = DeckFeedParser.text(area["tier"]) ?? ""
            let zip = DeckFeedParser.text(area["zip"])
            let tier = [tierWords[key], zip].compactMap { $0 }.joined(separator: " ")
            let valueNumber = zhvi.flatMap { DeckFeedParser.number($0["value"]) }
            let yoy = zhvi.flatMap { DeckFeedParser.number($0["yoy_pct"]) }
            return HousingMarketRow(
                id: DeckFeedParser.text(area["slug"]) ?? "area-\(index)",
                name: DeckFeedParser.text(area["name"]) ?? "Area",
                tier: tier,
                value: valueNumber.map { DeckMoney.short($0) },
                change: yoy.map { RealEstateWords.signed($0) + " " + NationalWords.oneYear },
                detail: parts.isEmpty ? "no public numbers for this area" : parts.joined(separator: " · "),
                asOf: zhvi.flatMap { DeckFeedParser.text($0["as_of"]) }.map { "Zillow ZHVI as of " + String($0.prefix(10)) })
        }
    }

    /// A feed written before the area series existed carries one headline median for the owner's area.
    private static func legacy(_ market: [String: Any]) -> [HousingMarketRow] {
        guard let median = DeckFeedParser.number(market["median_list_price"]) else { return [] }
        let area = DeckFeedParser.text(market["area"]) ?? "Median price"
        let at = DeckFeedParser.number(market["at"]).map { "as of " + RealEstateWords.day($0) }
        return [HousingMarketRow(id: "legacy", name: area, tier: "", value: DeckMoney.short(median),
                                 change: nil,
                                 detail: [area, "median " + (NationalWords.phrase("list_price", median) ?? ""),
                                          DeckFeedParser.text(market["source"])].compactMap { $0 }.joined(separator: " · "),
                                 asOf: at)]
    }

    private static func rates(_ market: [String: Any]) -> [HousingReading] {
        let mortgage = market["mortgage"] as? [String: Any] ?? [:]
        return [("30-year fixed", "rate_30y"), ("15-year fixed", "rate_15y")].map { label, key in
            let series = mortgage[key] as? [String: Any]
            let value = series.flatMap { DeckFeedParser.number($0["value"]) }
            let as_of = series.flatMap { DeckFeedParser.text($0["as_of"]) }.map { String($0.prefix(10)) } ?? "no date"
            return HousingReading(label: label, value: value.map { RealEstateWords.percent($0, digits: 2) },
                                  source: "FRED " + as_of)
        }
    }

    // MARK: National CRE series

    private static let series: [(key: String, label: String, source: String, format: (Double) -> String)] = [
        ("price_growth", "CRE price growth", "CoStar via FRED", { RealEstateWords.percent($0) + " /yr" }),
        ("loan_balance_bn", "CRE bank loans", "All US banks, FRED", { "$" + String(format: "%.2f", $0 / 1000) + "T" }),
        ("delinquency", "CRE delinquency", "Federal Reserve via FRED", { RealEstateWords.percent($0, digits: 2) }),
        ("chargeoff", "CRE charge-offs", "Federal Reserve via FRED", { RealEstateWords.percent($0, digits: 2) }),
        ("rental_vacancy", "Rental vacancy", "Census HVS via FRED", { RealEstateWords.percent($0) }),
        ("homeowner_vacancy", "Homeowner vacancy", "Census HVS via FRED", { RealEstateWords.percent($0) }),
        ("multifamily_starts", "Starts, 5+ units", "Census via FRED", { RealEstateWords.count($0) + "K /yr" }),
        ("treasury_10y", "10-year Treasury", "FRED DGS10", { RealEstateWords.percent($0, digits: 2) }),
    ]

    private static func indicators(_ market: [String: Any]) -> [CREIndicator] {
        let block = market["commercial_indicators"] as? [String: Any] ?? [:]
        return series.map { item in
            let entry = block[item.key] as? [String: Any]
            let value = entry.flatMap { DeckFeedParser.number($0["value"]) }
            let when = entry.flatMap { DeckFeedParser.text($0["as_of"]) }.map { String($0.prefix(10)) } ?? "not reported"
            return CREIndicator(label: item.label, value: value.map(item.format), source: item.source + " · " + when)
        }
    }

    private static func unavailable(_ market: [String: Any]) -> [String] {
        let block = market["commercial_indicators"] as? [String: Any] ?? [:]
        return [("vacancy", "Office and industrial vacancy"), ("cap_rate", "Cap rate series")].compactMap { key, label in
            guard let entry = block[key] as? [String: Any], DeckFeedParser.text(entry["status"]) == "unavailable" else { return nil }
            let reason = DeckFeedParser.text(entry["reason"]).map(firstSentence) ?? "not published"
            return "\(label): \(reason)"
        }
    }

    /// The first sentence of a reason, so an unavailable series is one short line.
    static func firstSentence(_ text: String) -> String {
        var sentence = ""
        let characters = Array(text)
        for (index, character) in characters.enumerated() {
            sentence.append(character)
            if ".!?".contains(character), index + 1 == characters.count || characters[index + 1] == " " { break }
        }
        return String(sentence.trimmingCharacters(in: .whitespaces).prefix(140))
    }

    // MARK: 55+ note

    private static let whyWords: [(key: String, words: String)] = [("list", "on the 55+ list"), ("text", "listing text"),
                                                                   ("page", "listing page")]

    private static func ageNote(_ value: Any?) -> AgeRestrictedNote? {
        guard let block = value as? [String: Any] else { return nil }
        let hidden = DeckFeedParser.whole(DeckFeedParser.number(block["hidden"]) ?? 0)
        let counts = block["by_reason"] as? [String: Any] ?? [:]
        let why = whyWords.compactMap { item -> String? in
            guard let n = DeckFeedParser.number(counts[item.key]), n > 0 else { return nil }
            return "\(DeckFeedParser.whole(n)) \(item.words)"
        }.joined(separator: ", ")
        let rows = DeckFeedParser.rows(block["rows"]).prefix(10).enumerated().map { index, row -> AgeRestrictedHome in
            let address = DeckFeedParser.text(row["addr"]) ?? "address withheld"
            let detail = DeckFeedParser.text(row["detail"]) ?? ""
            return AgeRestrictedHome(id: "age-\(index)-\(address)", line: "\(address). \(detail)")
        }
        var footnote: String?
        if let list = block["list"] as? [String: Any] {
            let communities = RealEstateWords.count(DeckFeedParser.number(list["communities"]))
            let learned = RealEstateWords.count(DeckFeedParser.number(list["learned"]))
            let checked = DeckFeedParser.text(block["as_of"]).map { String($0.prefix(10)) } ?? "date unknown"
            footnote = "List: \(communities) communities from the OC Office on Aging park and senior apartment lists "
                + "and named 55+ communities, plus \(learned) learned from listing pages. Checked \(checked)."
        }
        return AgeRestrictedNote(hidden: hidden, why: why.isEmpty ? nil : why, rows: rows, footnote: footnote)
    }

    // MARK: Homes

    private static func homeRows(_ value: Any?) -> [HousingHome] {
        var seen = Set<String>()
        var out: [(home: HousingHome, order: Int)] = []
        for (order, row) in DeckFeedParser.rows(value).enumerated() {
            let price = DeckFeedParser.number(row["price"])
            let address = DeckFeedParser.text(row["addr"])
            let city = DeckFeedParser.text(row["city"])
            let beds = DeckFeedParser.number(row["beds"])
            let baths = DeckFeedParser.number(row["baths"])
            let sqft = DeckFeedParser.number(row["sqft"])
            let key = [address ?? "", price.map { String($0) } ?? "", city ?? "", beds.map { String($0) } ?? "",
                       sqft.map { String($0) } ?? ""].joined(separator: "|")
            guard seen.insert(key).inserted else { continue }
            let bathText = baths.map { $0.truncatingRemainder(dividingBy: 1) == 0 ? RealEstateWords.count($0)
                : String(format: "%.1f", $0) }
            // The web's listing words: "3 BR", "2 BA", "1,500 SF", "Price not listed".
            let facts = [city, beds.map { RealEstateWords.count($0) + " BR" }, bathText.map { $0 + " BA" },
                         sqft.map { RealEstateWords.count($0) + " SF" }].compactMap { $0 }
            let home = HousingHome(
                id: "home-\(order)",
                title: (price.map { DeckMoney.short($0) } ?? "Price not listed") + " · "
                    + (address.map { String($0.prefix(50)) } ?? "address withheld"),
                subtitle: facts.joined(separator: " · "),
                city: city, type: DeckFeedParser.text(row["type"]), price: price,
                source: DeckFeedParser.text(row["source"]),
                listed: DeckFeedParser.number(row["listed_at"]).map { Date(timeIntervalSince1970: $0) },
                link: DeckFeedParser.url(row["url"]))
            out.append((home, order))
        }
        // Newest first; a listing with no date keeps its feed order after the dated ones.
        return out.sorted { a, b in
            switch (a.home.listed, b.home.listed) {
            case let (x?, y?): return x == y ? a.order < b.order : x > y
            case (_?, nil): return true
            case (nil, _?): return false
            case (nil, nil): return a.order < b.order
            }
        }.map(\.home)
    }
}
