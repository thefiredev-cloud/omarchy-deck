import Foundation

/// The native Deck sections. Surf and Shop (2026-11-14) read the coast-wide surf feed and the e-commerce market feed;
/// Housing and Commercial (2026-11-13); Deals, Travel, Outdoors and Life (2026-10-30). Each reads one to three of the
/// deck server's read-only routes (`GET /api/<feed>`), the same files the web deck reads. Foundation only, so the Linux
/// harness checks the parsing without SwiftUI or WebKit.
enum DeckFeedSection: String, CaseIterable, Identifiable, Hashable {
    case surf, shop, realestate, housing, commercial, deals, travel, outdoors, life

    var id: String { rawValue }

    var title: String {
        switch self {
        case .surf: return "Surf"
        case .shop: return "Shop"
        case .realestate: return "Real estate"
        case .housing: return "Housing"
        case .commercial: return "Commercial"
        case .deals: return "Deals"
        case .travel: return "Travel"
        case .outdoors: return "Outdoors"
        case .life: return "Life"
        }
    }

    var symbol: String {
        switch self {
        case .surf: return "water.waves"
        case .shop: return "cart"
        case .realestate: return "map"
        case .housing: return "house"
        case .commercial: return "building.2"
        case .deals: return "tag"
        case .travel: return "airplane"
        case .outdoors: return "mountain.2"
        case .life: return "leaf"
        }
    }

    /// Feed routes this section reads, in display order.
    var feeds: [String] {
        switch self {
        case .surf: return ["surf-coast"]
        case .shop: return ["ecom-market"]
        case .realestate: return [NationalRoutes.summary, NationalRoutes.sources]
        case .housing: return ["realestate", "housing-profile"]
        case .commercial: return ["cre", "housing-profile", "realestate"]
        case .deals: return ["ecom"]
        case .travel: return ["travel-deals"]
        case .outdoors: return ["outdoors"]
        case .life: return ["life", "history-goodnews"]
        }
    }

    /// The feed whose absence means the section has nothing to show. Supporting feeds (the budget) can be missing.
    var primaryFeed: String { feeds[0] }

    /// One line under the title: what the section is for.
    var tagline: String {
        switch self {
        case .surf: return "Cabo to the Columbia River. Your spots first."
        case .shop: return "Where online prices and platforms are moving, and your watches."
        case .realestate: return "Every US ZIP: the best places to buy a home or a rental."
        case .housing: return "Your markets, mortgage rates and homes for sale."
        case .commercial: return "For-sale deals, the market and your stake as a smaller investor."
        case .deals: return "Prices below their usual level, for the items your deck watches."
        case .travel: return "Flights, hotels and sales worth a look."
        case .outdoors: return "Surf, snow, fishing and passes near you."
        case .life: return "Gas, homes, jobs, and good news from history."
        }
    }
}

enum DeckFeedNames {
    /// Group heading when a section reads more than one feed, and the name in state messages.
    static func heading(_ feed: String) -> String {
        switch feed {
        case "surf-coast": return "Surf"
        case "ecom-market": return "Shop data"
        case "ecom": return "Shop deals"
        case "travel-deals": return "Travel deals"
        case "outdoors": return "Outdoors"
        case "life": return "Around you"
        case "history-goodnews": return "History and good news"
        case "realestate": return "Real estate data"
        case NationalRoutes.summary: return "Real estate data"
        case NationalRoutes.sources: return "Real estate sources"
        case NationalRoutes.fields: return "Real estate columns"
        case NationalRoutes.segments: return "Markets"
        case _ where NationalRoutes.listPart(feed) != nil: return "Markets"
        case "housing-profile": return "Your housing budget"
        case "cre": return "Deal desk"
        case _ where NationalRoutes.isRank(feed): return "Best ZIPs"
        case _ where NationalRoutes.isZipFeed(feed): return "ZIP " + feed.dropFirst("housing/zip/".count)
        default: return SurfRegions.id(fromFeed: feed).map { SurfRegions.name($0) } ?? feed
        }
    }

    /// How often the deck refreshes each feed, in plain words.
    static func cadence(_ feed: String) -> String {
        switch feed {
        case "surf-coast": return "every 30 minutes"
        case "ecom", "ecom-market", "realestate", "cre": return "every hour"
        case NationalRoutes.summary, NationalRoutes.sources, NationalRoutes.fields, NationalRoutes.segments: return "once a week"
        case _ where NationalRoutes.listPart(feed) != nil: return "once a week"
        case "travel-deals": return "every 6 hours"
        case "outdoors": return "every 2 hours"
        case "life", "history-goodnews": return "once a day"
        case "housing-profile": return "whenever you change it on the deck"
        default: return "on its own schedule"
        }
    }

    /// The server path a feed is read from. Every path is read only; nothing is ever written.
    static func path(_ feed: String) -> String {
        if feed == "housing-profile" { return "/api/housing/profile" }
        if let national = NationalRoutes.split(feed) { return national.path }
        return "/api/\(feed)"
    }

    /// The fixed query a feed is read with: the owner's own desk, never another person's; the national routes carry
    /// their own checked query.
    static func query(_ feed: String) -> [URLQueryItem] {
        if feed == "cre" { return [URLQueryItem(name: "person", value: "tanner")] }
        return NationalRoutes.split(feed)?.query ?? []
    }

    /// Big files (the listings feeds are several MB) get more time on a slow link.
    static func timeout(_ feed: String) -> TimeInterval {
        if ["realestate", "cre", NationalRoutes.fields].contains(feed) || NationalRoutes.listPart(feed) == "metros" { return 30 }
        if ["surf-coast", "ecom-market"].contains(feed) || SurfRegions.id(fromFeed: feed) != nil
            || NationalRoutes.split(feed) != nil { return 20 }
        return 12
    }

    /// Only the fixed section routes and the fixed detail routes (one of the 14 surf regions, a checked national rank
    /// query, one five-digit ZIP) are ever requested.
    static func isAllowed(_ feed: String) -> Bool {
        DeckFeedSection.allCases.contains { $0.feeds.contains(feed) } || SurfRegions.id(fromFeed: feed) != nil
            || NationalRoutes.split(feed) != nil
    }
}

/// One card. Every field the feed did not carry stays nil and draws nothing; an unknown is never shown as 0.
struct DeckFeedCard: Identifiable, Equatable {
    enum Tone: Equatable { case plain, good, caution }

    let id: String
    /// Small label above the title (flight, surf, Good news, Price drop).
    let eyebrow: String?
    let title: String
    let subtitle: String?
    /// The big number on the trailing edge.
    let price: String?
    /// Short pill under the price: "Save 20%", "20% under median".
    let badge: String?
    let badgeTone: Tone
    /// Where: a route, a place, a city or the store that has the price.
    let place: String?
    /// A caution line, for example a separate-tickets risk.
    let note: String?
    /// The outlet or store the item came from, else the link's host. Never printed on the card: VoiceOver names it in
    /// the link hint, and the Data sheet carries the feed's sources.
    let source: String?
    let link: URL?
    /// When this item's data was true, from its own `as_of`.
    let asOf: Date?
}

/// What the deck answered for one feed.
struct DeckFeedPage: Equatable {
    let feed: String
    let cards: [DeckFeedCard]
    /// When the collector wrote the file (`t`).
    let updated: Date?
    /// Older than twice its refresh interval, by the server's own rule.
    let stale: Bool
    /// Data sheet rows: the feed's sources with their dates and states, and every source that failed this run.
    let sources: [DeckSourceRow]
    /// Method and coverage lines for the Data sheet: what the page used to print under its cards.
    var notes: [String] = []
    /// Typed payloads for the sections that are not card lists.
    var housing: HousingPage?
    var desk: CommercialDesk?
    var budget: HousingBudget?
    var surf: SurfOverview?
    var surfRegion: SurfRegionDetail?
    var shop: ShopMarket?
    var national: NationalSummary?
    var nationalRank: NationalRank?
    var nationalZip: NationalZip?
    var nationalCatalog: NationalCatalog?
    var marketsSpec: MarketsSpec?
    /// The rows of one Markets list (`part=states|metros`).
    var marketRows: [MarketsRow]?
}

enum DeckFeedState: Equatable {
    case loading
    case loaded(DeckFeedPage)
    /// The file does not exist yet on the deck: the collector has not run.
    case notCollected
    /// The deck answered 404: its server predates this route.
    case notServed
    /// The deck refuses feeds for a guest sign-in.
    case ownerOnly
    /// The session cookie was rejected.
    case signedOut
    /// The ZIP route has no record of this ZIP (404 unknown zip): an answer, not a failure to retry.
    case noRecord
    case failed(String)
}

enum DeckFeedParser {
    /// Classify one HTTP answer from `GET /api/<feed>`.
    static func state(feed: String, status: Int, body: Data, now: Date = Date()) -> DeckFeedState {
        switch status {
        case 200: break
        case 401: return .signedOut
        case 403: return .ownerOnly
        case 404:
            // The ZIP route answers 404 for a ZIP it has no record of: that is an answer, not an old deck.
            if NationalRoutes.isZipFeed(feed), String(decoding: body, as: UTF8.self).contains("unknown zip") {
                return .noRecord
            }
            return .notServed
        case 400 where NationalRoutes.listPart(feed) != nil:
            return .failed("Your deck did not accept this list of markets.")
        case 400 where NationalRoutes.isRank(feed):
            return .failed("Your deck did not accept this search.")
        default: return .failed("Your deck answered with error \(status).")
        }
        guard let object = try? JSONSerialization.jsonObject(with: body), let json = object as? [String: Any] else {
            return .failed("Your deck answered, but this app could not read the answer.")
        }
        return state(feed: feed, json: json, now: now)
    }

    static func state(feed: String, json: [String: Any], now: Date = Date()) -> DeckFeedState {
        if let error = json["error"] as? String {
            return error == "file missing" ? .notCollected : .failed(readable(error))
        }
        // The surf writer answers 200 with a status when its file is missing.
        if feed != "cre", text(json["status"]) == "not_reporting" { return .notCollected }
        if NationalRoutes.split(feed) != nil { return national(feed: feed, json: json, now: now) }
        // The deal desk dates itself by the collector's `generated_at`; the server's `t` is only when it answered.
        let updated = (feed == "cre" ? number(json["generated_at"]) : nil).map { Date(timeIntervalSince1970: $0) }
            ?? number(json["t"]).map { Date(timeIntervalSince1970: $0) }
        let stale = json["stale"] as? Bool ?? (feed == "cre" ? updated.map { now.timeIntervalSince($0) > 6 * 3600 } ?? true
                                                              : updated == nil)
        let sources = DeckSources.rows(json, now: now)
        func page(cards: [DeckFeedCard] = []) -> DeckFeedPage {
            DeckFeedPage(feed: feed, cards: cards, updated: updated, stale: stale, sources: sources)
        }
        switch feed {
        case "ecom": return .loaded(page(cards: ecomCards(json)))
        case "history-goodnews": return .loaded(page(cards: rows(json["items"]).enumerated().map { historyCard($1, index: $0) }))
        case "realestate":
            var p = page()
            let housing = DeckHousingParser.page(from: json, now: now)
            p.housing = housing
            p.notes = DeckHousingParser.notes(housing)
            return .loaded(p)
        case "housing-profile":
            var p = page()
            p.budget = DeckHousingParser.budget(from: json)
            return .loaded(p)
        case "cre":
            switch DeckCommercialParser.outcome(from: json) {
            case .desk(let desk):
                var p = DeckFeedPage(feed: feed, cards: [], updated: updated, stale: stale, sources: [])
                p.desk = desk
                p.notes = DeckCommercialParser.notes(desk)
                return .loaded(p)
            case .notReporting(let reason): return .failed(reason)
            }
        case "surf-coast":
            var p = page()
            let surf = DeckSurfParser.overview(json, now: now)
            p.surf = surf
            p.notes = surf.notes
            return .loaded(p)
        case "ecom-market":
            var p = page()
            let shop = DeckShopParser.market(json)
            p.shop = shop
            p.notes = shop.notes
            return .loaded(p)
        default:
            if SurfRegions.id(fromFeed: feed) != nil {
                var p = page()
                p.surfRegion = DeckSurfParser.region(json, now: now)
                return .loaded(p)
            }
            return .loaded(page(cards: rows(json["items"]).enumerated().map { itemCard($1, feed: feed, index: $0) }))
        }
    }

    /// The national routes (NationalApi.md, 2026-11-14). The summary and the Markets spec carry the server's own
    /// freshness: `age` dates the page (seconds since the manifest's build, by the server's clock) and `stale` alone says
    /// "Out of date"; the app never guesses from a cadence. The sources part, the field catalog, rank pages, Markets lists
    /// and ZIP bodies carry no freshness of their own: they are dated by `generated_at` and never mark the section out of
    /// date. Only the summary and the sources part fill the Data sheet's source rows.
    private static func national(feed: String, json: [String: Any], now: Date) -> DeckFeedState {
        let isSummary = feed == NationalRoutes.summary
        let dated = isSummary || feed == NationalRoutes.segments
        let updated = (dated ? number(json["age"]).map { now.addingTimeInterval(-$0) } : nil)
            ?? number(json["generated_at"]).map { Date(timeIntervalSince1970: $0) }
        let stale = dated && json["stale"] as? Bool == true
        let listsSources = isSummary || feed == NationalRoutes.sources
        var p = DeckFeedPage(feed: feed, cards: [], updated: updated, stale: stale,
                             sources: listsSources ? DeckSources.rows(json, now: now) : [])
        if isSummary {
            let summary = DeckNationalParser.summary(json)
            p.national = summary
            p.notes = summary.notes
        } else if feed == NationalRoutes.fields {
            p.nationalCatalog = DeckNationalParser.catalog(json)
        } else if feed == NationalRoutes.segments {
            p.marketsSpec = Markets.spec(json)
        } else if let part = NationalRoutes.listPart(feed) {
            p.marketRows = Markets.rows(part: part, json: json)
        } else if NationalRoutes.isRank(feed) {
            p.nationalRank = DeckNationalParser.rank(json)
        } else if NationalRoutes.isZipFeed(feed) {
            guard let zip = DeckNationalParser.zip(json) else { return .failed("This ZIP has no record on your deck.") }
            p.nationalZip = zip
        }
        return .loaded(p)
    }

    /// File-reader words the server passes through, said plainly.
    private static func readable(_ error: String) -> String {
        switch error {
        case "bad json": return "The saved data for this section on your deck is damaged."
        case "file unreadable": return "Your deck could not read its saved data for this section."
        case "read timed out": return "Your deck took too long to read its saved data for this section."
        default: return error
        }
    }

    // MARK: Cards

    private static func ecomCards(_ json: [String: Any]) -> [DeckFeedCard] {
        let asOf = number(json["as_of"]).map { Date(timeIntervalSince1970: $0) }
            ?? number(json["t"]).map { Date(timeIntervalSince1970: $0) }
        let deals = rows(json["deals"]).enumerated().compactMap { index, deal -> DeckFeedCard? in
            guard let title = text(deal["title"]) ?? text(deal["query"]) else { return nil }
            let link = url(deal["url"])
            let under = number(deal["vs_median"]).map { -$0 }
            let median = number(deal["median"]).map { "Usually \(money($0, currency: "USD"))" }
            let store = text(deal["site"]).map(storeName)
            return DeckFeedCard(id: "deal-\(index)-\(text(deal["slug"]) ?? title)",
                                eyebrow: "Price drop", title: title,
                                subtitle: [text(deal["condition"]).map(capitalized), median].compactMap { $0 }.joined(separator: " · ").nonEmpty,
                                price: number(deal["price"]).map { money($0, currency: "USD") },
                                badge: under.flatMap { $0 > 0 ? "\(percent($0)) below the usual price" : nil },
                                badgeTone: .good, place: store.map { "At \($0)" }, note: nil,
                                source: store ?? link?.host, link: link, asOf: asOf)
        }
        let movers = rows(json["movers"]).enumerated().compactMap { index, mover -> DeckFeedCard? in
            guard let title = text(mover["query"]) ?? text(mover["slug"]) else { return nil }
            let change = number(mover["chg7"])
            return DeckFeedCard(id: "mover-\(index)-\(title)", eyebrow: "This week", title: productName(title),
                                subtitle: text(mover["category"]).map(capitalized),
                                price: number(mover["median"]).map { money($0, currency: "USD") },
                                badge: change.map { $0 < 0 ? "Down \(percent(-$0))" : "Up \(percent($0))" },
                                badgeTone: (change ?? 0) < 0 ? .good : .caution,
                                place: nil, note: nil, source: nil, link: nil, asOf: asOf)
        }
        return deals + movers
    }

    private static func itemCard(_ item: [String: Any], feed: String, index: Int) -> DeckFeedCard {
        let link = url(item["source_url"])
        let title = text(item["title"]) ?? text(item["name"]) ?? text(item["headline"]) ?? "Untitled"
        let currency = text(item["currency"]) ?? "USD"
        var badge: String?
        var tone = DeckFeedCard.Tone.good
        if let pct = number(item["savings_pct"]), pct > 0 {
            badge = "Save \(whole(pct.rounded()))%"
        } else if let savings = number(item["savings"]), savings > 0 {
            badge = "Save \(money(savings, currency: currency))"
        } else if let low = number(item["pay_min"]), let high = number(item["pay_max"]) {
            badge = DeckMoney.range(low, high)
            tone = .plain
        } else if let low = number(item["pay_min"]) {
            badge = DeckMoney.plus(low)
            tone = .plain
        } else if let high = number(item["pay_max"]) {
            badge = "up to " + DeckMoney.short(high)
            tone = .plain
        } else if let delta = number(item["delta_7d_pct"]) {
            badge = delta < 0 ? "Down \(percent(-delta / 100)) in 7 days" : "Up \(percent(delta / 100)) in 7 days"
            tone = delta < 0 ? .good : .caution
        }
        var price = number(item["price"]).map { money($0, currency: currency) }
        if price == nil, let value = number(item["value"]) {
            price = value.rounded() == value ? String(whole(value)) : String(format: "%.2f", value)
        }
        let separate = (item["protected"] as? Bool) == false
        let note = text(item["risk"]) ?? (separate ? "Separate tickets: a missed connection is yours to fix." : nil)
        let place = text(item["route"]).map { $0.replacingOccurrences(of: "-", with: " → ") }
            ?? text(item["location"]) ?? text(item["place"])
        let kind = text(item["category"]).map(label) ?? text(item["kind"]).map(label)
        return DeckFeedCard(id: text(item["id"]) ?? "\(feed)-\(index)",
                            eyebrow: kind, title: title,
                            subtitle: text(item["subtitle"]) ?? text(item["summary"]) ?? text(item["detail"]),
                            price: price, badge: badge, badgeTone: tone, place: place,
                            note: note, source: text(item["source"]) ?? text(item["org"]) ?? link?.host.map(host),
                            link: link, asOf: date(item["as_of"]))
    }

    private static func historyCard(_ item: [String: Any], index: Int) -> DeckFeedCard {
        let link = url(item["source_url"])
        let section = text(item["section"])
        var eyebrow = section.map(label)
        if section == "on_this_day", let year = number(item["year"]) { eyebrow = "On this day, \(whole(year))" }
        var price: String?
        if let value = number(item["latest_value"]) {
            let unit = text(item["unit"]).map { " \($0)" } ?? ""
            price = (value.rounded() == value ? String(whole(value)) : String(format: "%.1f", value)) + unit
        }
        return DeckFeedCard(id: "history-\(index)-\(text(item["title"]) ?? "")",
                            eyebrow: eyebrow, title: text(item["title"]) ?? "Untitled",
                            subtitle: text(item["summary"]), price: price, badge: nil, badgeTone: .plain,
                            place: nil, note: nil, source: text(item["source"]) ?? link?.host.map(host), link: link,
                            asOf: date(item["published"]) ?? date(item["as_of"]))
    }

    // MARK: Values

    static func rows(_ value: Any?) -> [[String: Any]] {
        (value as? [Any] ?? []).compactMap { $0 as? [String: Any] }
    }

    static func text(_ value: Any?) -> String? {
        guard let s = value as? String else { return nil }
        let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// A JSON number, never a Bool (JSONSerialization bridges both to NSNumber on Apple platforms).
    static func number(_ value: Any?) -> Double? {
        #if canImport(Darwin)
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        let d = n.doubleValue
        #else
        // swift-corelibs also casts NSNumber 0 and 1 to Bool. JSON true and false carry the "c" (char) type.
        if let n = value as? NSNumber, String(cString: n.objCType) == "c" { return nil }
        guard let d = (value as? Double) ?? (value as? Int).map(Double.init) ?? (value as? NSNumber)?.doubleValue else { return nil }
        #endif
        return d.isFinite ? d : nil
    }

    /// http and https only; anything else is not a link.
    static func url(_ value: Any?) -> URL? {
        guard let s = text(value), let u = URL(string: s), let scheme = u.scheme?.lowercased(),
              scheme == "https" || scheme == "http", u.host != nil else { return nil }
        return u
    }

    static func date(_ value: Any?) -> Date? {
        if let epoch = number(value) { return Date(timeIntervalSince1970: epoch) }
        guard let s = text(value) else { return nil }
        let full = ISO8601DateFormatter()
        if let d = full.date(from: s) { return d }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = fractional.date(from: s) { return d }
        let day = ISO8601DateFormatter()
        day.formatOptions = [.withFullDate]
        return day.date(from: String(s.prefix(10)))
    }

    static func money(_ amount: Double, currency: String) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = currency
        f.locale = Locale(identifier: "en_US")
        f.maximumFractionDigits = amount.rounded() == amount || amount >= 100 ? 0 : 2
        f.minimumFractionDigits = f.maximumFractionDigits
        return f.string(from: NSNumber(value: amount)) ?? "\(amount) \(currency)"
    }

    /// 0.2016 -> "20%".
    static func percent(_ fraction: Double) -> String {
        "\(whole((fraction * 100).rounded()))%"
    }

    /// `Int(_:)` traps on a value outside `Int`'s range and on NaN. A feed number is only checked finite, so a
    /// stray `1e30` would crash the app while a card is built. Clamped to ±1e15 (exact in a `Double`), which no real
    /// price, year or percent reaches; a non-finite value reads as 0.
    static func whole(_ value: Double) -> Int {
        guard value.isFinite else { return 0 }
        return Int(min(max(value, -1e15), 1e15))
    }

    /// `good_news` -> "Good news", `positioning` -> "Positioning".
    static func label(_ slug: String) -> String {
        capitalized(slug.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: "-", with: " "))
    }

    static func capitalized(_ s: String) -> String {
        s.prefix(1).uppercased() + s.dropFirst()
    }

    static func host(_ h: String) -> String {
        h.hasPrefix("www.") ? String(h.dropFirst(4)) : h
    }

    /// A shop-watch search ("sony oled tv") as a product name ("Sony OLED TV"). Brand words keep their own casing.
    static func productName(_ query: String) -> String {
        let brands = ["ipad": "iPad", "iphone": "iPhone", "airpods": "AirPods", "macbook": "MacBook", "imac": "iMac",
                      "oled": "OLED", "tv": "TV", "gpu": "GPU", "ssd": "SSD",
                      "kitchenaid": "KitchenAid", "gopro": "GoPro", "dji": "DJI", "rtx": "RTX", "dgx": "DGX"]
        return query.split(separator: " ").map { word in
            let lower = word.lowercased()
            return brands[lower] ?? (word == lower ? capitalized(String(word)) : String(word))
        }.joined(separator: " ")
    }

    static func storeName(_ site: String) -> String {
        switch site {
        case "bestbuy": return "Best Buy"
        case "backmarket": return "Back Market"
        case "facebook-marketplace": return "Facebook Marketplace"
        case "offerup": return "OfferUp"
        case "microcenter": return "Micro Center"
        case "gamestop": return "GameStop"
        case "ebay": return "eBay"
        case "macys": return "Macy's"
        default: return label(site)
        }
    }
}

/// "Updated 12 min ago", "Updated 3 h ago", "Updated Oct 26".
enum DeckFeedAge {
    static func updated(_ date: Date?, now: Date = Date()) -> String {
        guard let date else { return "Update time unknown" }
        return "Updated " + ago(date, now: now)
    }

    static func ago(_ date: Date, now: Date = Date()) -> String {
        let s = max(0, now.timeIntervalSince(date))
        if s < 90 { return "just now" }
        if s < 3600 { return "\(Int(s / 60)) min ago" }
        if s < 86_400 { return "\(Int(s / 3600)) h ago" }
        if s < 7 * 86_400 { return "\(Int(s / 86_400)) d ago" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.setLocalizedDateFormatFromTemplate("MMM d")
        return f.string(from: date)
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
