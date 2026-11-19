import Foundation

/// Shop (2026-11-14): the e-commerce market, read from `GET /api/ecom-market` (contract EcomFeed.md v1). The macro strip,
/// the owner's watches, best sellers and movers, category prices and the platform board. Foundation only, so the Linux
/// harness checks the numbers and words. A missing value stays nil; store names on the platform board are the subject,
/// not provenance, and every other source name lives in the Data sheet.

struct ShopSeriesPoint: Equatable, Identifiable {
    var id: String { period }
    let period: String
    let value: Double
}

struct ShopMacro: Equatable, Identifiable {
    var id: String { key }
    let key: String
    let label: String
    let group: String?
    let unit: String
    let value: Double?
    let period: String?
    let change: Double?
    let changeUnit: String?
    let yoy: Double?
    let yoyUnit: String?
    let hist: [ShopSeriesPoint]
    let note: String?

    var valueText: String { ShopWords.value(value, unit: unit) }
    var periodText: String? { period.map(DeckSources.periodWords) }

    /// The year-over-year move when the publisher gives one, else the change from the prior period.
    var changeText: String? {
        if let yoy { return ShopWords.change(yoy, unit: yoyUnit) + " 1-yr" }
        if let change { return ShopWords.change(change, unit: changeUnit) }
        return nil
    }
}

struct ShopConfidence: Equatable {
    let confidence: DeckConfidence
    let reasons: [String]
}

struct ShopWatch: Equatable, Identifiable {
    var id: String { slug }
    let slug: String
    let label: String
    let category: String?
    let median: Double?
    let low: Double?
    let high: Double?
    let newMedian: Double?
    let listings: Int?
    let sitesOk: Int?
    let sitesExpected: Int?
    let change7: Double?
    let change30: Double?
    let bestPrice: Double?
    let bestPlatform: String?
    let period: String?
    let confidence: ShopConfidence?
    let hist: [ShopSeriesPoint]
    let byPlatform: [ShopStorePrice]

    var name: String { DeckFeedParser.productName(label) }
}

struct ShopStorePrice: Equatable, Identifiable {
    var id: String { platform }
    let platform: String
    let median: Double
    let listings: Int?
}

struct ShopOffer: Equatable, Identifiable {
    var id: String { platform + (url?.absoluteString ?? "") }
    let platform: String
    let price: Double?
    let regular: Double?
    let discountPct: Double?
    let rank: Int?
    let url: URL?
}

struct ShopProduct: Equatable, Identifiable {
    let id: String
    let title: String
    let brand: String?
    let category: String?
    let kind: String
    let rank: Int?
    let rankChange: Int?
    let median: Double?
    let low: Double?
    let high: Double?
    let platforms: Int
    let changePct: Double?
    let period: String?
    let offers: [ShopOffer]

    /// Best seller, Rank up, Price drop, Under median, On sale, Price up.
    var kindWord: String { ShopWords.kind(kind) }

    var cheapest: ShopOffer? {
        offers.filter { $0.price != nil }.min { ($0.price ?? 0) < ($1.price ?? 0) }
    }

    /// A median across two or more stores is a blend and carries the mark; one store's price is a raw reading.
    var isBlended: Bool { platforms > 1 }
}

struct ShopCategory: Equatable, Identifiable {
    var id: String { key }
    let key: String
    let label: String
    let value: Double?
    let period: String?
    /// What carries `value`: `platforms` (the store change over 7 or 30 days), `official_mom` (the official month
    /// alone), `blend` (an older feed) or nil.
    let basis: String?
    let parts: [DeckBlendPart]
    let confidence: ShopConfidence?
    let indexValue: Double?
    let indexChange7: Double?
    let indexChange30: Double?
    let indexDays: Int?
    let indexHist: [ShopSeriesPoint]
    let officialLabel: String?
    let officialYoY: Double?
    let officialHist: [ShopSeriesPoint]

    /// The platform index needs 14 days of prices before it counts as published.
    var building: String? {
        guard indexValue == nil || (indexDays ?? 0) < 14 else { return nil }
        return "Building · \(min(indexDays ?? 0, 14)) of 14 days"
    }

    /// The confidence mark the value carries: only a store change (or an older feed's blend). The official month
    /// alone is one publisher's number, so it carries no mark, as on the web page.
    var mark: DeckConfidence? {
        guard value != nil, basis == "platforms" || basis == "blend" else { return nil }
        return confidence?.confidence
    }
}

struct ShopPlatform: Equatable, Identifiable {
    var id: String { name }
    let rank: Int
    let name: String
    let kind: String?
    let score: Double?
    let appRank: Int?
    let webRank: Int?
    let webChange30: Int?
    let appChange7: Int?
    /// ok, blocked, needs_key, none.
    let priceCoverage: String?

    var kindWord: String { kind.map(DeckFeedParser.label) ?? "Store" }
    var pricesTracked: Bool { priceCoverage == "ok" }
}

struct ShopMarket: Equatable {
    let macro: [ShopMacro]
    let platforms: [ShopPlatform]
    let bestsellers: [ShopProduct]
    let movers: [ShopProduct]
    let categories: [ShopCategory]
    let watches: [ShopWatch]
    let trending: [String]
    /// Sources that would open with a free key.
    let needsSetup: Int
    let notes: [String]

    /// The strip from the blueprint, in order: share, online sales, retail sales, core goods, shipping, diesel, then the
    /// two that wide windows add.
    static let stripKeys = ["ecom_share", "ecom_sales", "retail_sales", "cpi_core_goods", "container_wci", "diesel",
                            "fedex_ground_fuel", "port_la_imports"]

    func strip(wide: Bool) -> [ShopMacro] {
        let keys = Array(Self.stripKeys.prefix(wide ? 8 : 6))
        return keys.compactMap { key in macro.first { $0.key == key } }
    }

    /// Every series not in the strip, for the "More market numbers" list.
    var otherMacro: [ShopMacro] { macro.filter { !Self.stripKeys.contains($0.key) } }

    /// Best sellers and movers in one list, merged by product id, optionally one category.
    func products(category: String?) -> [ShopProduct] {
        var seen = Set<String>()
        return (movers.filter { $0.kind != "on_sale" } + bestsellers + movers.filter { $0.kind == "on_sale" }).filter { product in
            guard category == nil || product.category == category else { return false }
            return seen.insert(product.id).inserted
        }
    }

    /// Category chips that have products: All plus each category key in the blueprint order.
    var categoryChips: [String] {
        let order = ["computers", "home", "outdoors", "grocery", "games", "music", "apparel", "electronics", "phones",
                     "beauty", "collectibles"]
        let present = Set((bestsellers + movers).compactMap(\.category))
        return order.filter { present.contains($0) }
    }
}

// MARK: Words

enum ShopWords {
    private static func trim(_ s: String) -> String {
        var t = s
        while t.contains("."), t.hasSuffix("0") { t.removeLast() }
        if t.hasSuffix(".") { t.removeLast() }
        return t
    }

    /// A macro value in its unit.
    static func value(_ value: Double?, unit: String) -> String {
        guard let n = value else { return "No data" }
        switch unit {
        case "pct": return DeckFormat.percent(n)
        case "usd": return DeckMoney.short(n, cents: true)
        case "usd_m":
            return n >= 1e6 ? trim(String(format: "$%.2f", n / 1e6)) + "T" : trim(String(format: "$%.1f", n / 1e3)) + "B"
        case "usd_b": return n >= 1e3 ? trim(String(format: "$%.2f", n / 1e3)) + "T" : trim(String(format: "$%.1f", n)) + "B"
        case "usd_gal": return String(format: "$%.2f/gal", n)
        case "usd_feu": return "$" + RealEstateWords.count(n) + "/box"
        case "teu": return compact(n) + " TEU"
        case "index": return String(format: n >= 100 ? "%.1f" : "%.2f", n)
        default: return compact(n)
        }
    }

    /// 12.4K, 1.2M, exact under 10,000.
    static func compact(_ n: Double) -> String {
        if abs(n) >= 1e6 { return trim(String(format: "%.1f", n / 1e6)) + "M" }
        if abs(n) >= 1e4 { return trim(String(format: "%.1f", n / 1e3)) + "K" }
        return RealEstateWords.count(n)
    }

    /// "+0.2 pt" for percent points, "+3.8%" for a percent change: the web's change form (`DeckFormat.change`).
    static func change(_ value: Double, unit: String?) -> String {
        DeckFormat.change(value, kind: unit == "pct_pts" ? .points : .percent)
    }

    static func percent(_ value: Double?) -> String? {
        value.map { change($0, unit: "pct") }
    }

    static func kind(_ kind: String) -> String {
        switch kind {
        case "bestseller": return "Best seller"
        case "rank_gain": return "Rank up"
        case "price_drop": return "Price drop"
        case "under_median": return "Under median"
        case "on_sale": return "On sale"
        case "price_rise": return "Price up"
        default: return DeckFeedParser.label(kind)
        }
    }

    static func category(_ key: String) -> String {
        switch key {
        case "computers": return "Computers"
        case "electronics": return "Electronics"
        case "phones": return "Phones"
        case "home": return "Home"
        case "apparel": return "Apparel"
        case "beauty": return "Beauty"
        case "games": return "Games"
        case "music": return "Music"
        case "collectibles": return "Collectibles"
        case "outdoors": return "Outdoors"
        case "grocery": return "Grocery"
        default: return DeckFeedParser.label(key)
        }
    }

    /// "#7" with "up 2" or "down 1".
    static func rank(_ rank: Int?, change: Int?) -> String? {
        guard let rank else { return nil }
        guard let change, change != 0 else { return "#\(rank)" }
        return "#\(rank), " + (change > 0 ? "up \(change)" : "down \(-change)")
    }
}

// MARK: Parser

enum DeckShopParser {
    private typealias P = DeckFeedParser

    static func market(_ json: [String: Any]) -> ShopMarket {
        let watches = json["watches"] as? [String: Any] ?? [:]
        let sources = P.rows(json["sources"])
        var notes: [String] = []
        if let c = json["coverage"] as? [String: Any] {
            func n(_ key: String) -> String { RealEstateWords.count(P.number(c[key])) }
            notes.append("\(n("ok")) of \(n("sources_total")) sources answering, \(n("needs_key")) need a free key, "
                         + "\(n("refused")) blocked by terms or a paywall, \(n("stale")) out of date.")
            notes.append("\(n("products_tracked")) products tracked on \(n("platforms_priced")) priced sites; "
                         + "\(n("merged_products")) seen on two or more sites.")
        }
        notes.append("Watch prices are asking prices, not sold prices: the median of each site's median over \(P.whole(P.number(watches["window_days"]) ?? 7)) days.")
        notes.append("Each category change covers one period: the store change over 7 or 30 days, or the official month alone. The two are never blended.")
        notes.append("Platform rank blends App Store shopping rank and web rank.")
        notes += sources.compactMap { row -> String? in
            guard P.text(row["status"]) == "needs_key", let name = P.text(row["name"]) else { return nil }
            return "\(name) needs a free key" + (P.text(row["reason"]).map { ": \($0)." } ?? ".")
        }
        return ShopMarket(
            macro: P.rows(json["macro"]).compactMap(macro),
            platforms: P.rows(json["platforms"]).compactMap(platform).sorted { $0.rank < $1.rank },
            bestsellers: P.rows(json["bestsellers"]).compactMap { product($0, defaultKind: "bestseller") },
            movers: P.rows(json["movers"]).compactMap { product($0, defaultKind: "price_drop") },
            categories: P.rows(json["categories"]).compactMap(category),
            watches: P.rows(watches["items"]).compactMap(watch),
            // Only searches the writer flags as shopping (EcomFeed change 2026-11-14 (2)); everything else is noise here.
            trending: P.rows(json["trending"]).filter { ($0["shopping"] as? Bool) == true }.compactMap { P.text($0["title"]) },
            needsSetup: sources.filter { P.text($0["status"]) == "needs_key" }.count,
            notes: notes)
    }

    private static func hist(_ value: Any?) -> [ShopSeriesPoint] {
        (value as? [Any] ?? []).compactMap { pair in
            guard let items = pair as? [Any], items.count >= 2, let period = P.text(items[0]), let v = P.number(items[1]) else { return nil }
            return ShopSeriesPoint(period: period, value: v)
        }
    }

    private static func int(_ value: Any?) -> Int? { P.number(value).map { P.whole($0) } }

    private static func confidence(_ value: Any?) -> ShopConfidence? {
        guard let c = DeckConfidence(value) else { return nil }
        let reasons = ((value as? [String: Any])?["reasons"] as? [Any] ?? []).compactMap(P.text)
        return ShopConfidence(confidence: c, reasons: reasons)
    }

    private static func macro(_ row: [String: Any]) -> ShopMacro? {
        guard let key = P.text(row["key"]), let label = P.text(row["label"]) else { return nil }
        return ShopMacro(key: key, label: label, group: P.text(row["group"]), unit: P.text(row["unit"]) ?? "",
                         value: P.number(row["value"]), period: P.text(row["period"]), change: P.number(row["change"]),
                         changeUnit: P.text(row["change_unit"]), yoy: P.number(row["yoy"]), yoyUnit: P.text(row["yoy_unit"]),
                         hist: hist(row["hist"]), note: P.text(row["note"]))
    }

    private static func platform(_ row: [String: Any]) -> ShopPlatform? {
        guard let name = P.text(row["name"]), let rank = int(row["rank"]) else { return nil }
        let signals = row["signals"] as? [String: Any] ?? [:]
        return ShopPlatform(rank: rank, name: name, kind: P.text(row["kind"]), score: P.number(row["score"]),
                            appRank: int(signals["app_rank"]), webRank: int(signals["tranco_rank"]),
                            webChange30: int(signals["tranco_change_30d"]), appChange7: int(signals["app_change_7d"]),
                            priceCoverage: P.text(row["price_coverage"]))
    }

    private static func product(_ row: [String: Any], defaultKind: String) -> ShopProduct? {
        guard let title = P.text(row["title"]) else { return nil }
        let price = row["price"] as? [String: Any] ?? [:]
        let offers = P.rows((row["detail"] as? [String: Any])?["offers"]).compactMap { offer -> ShopOffer? in
            guard let platform = P.text(offer["platform"]) else { return nil }
            return ShopOffer(platform: platform, price: P.number(offer["price"]),
                             regular: P.number(offer["regular"]) ?? P.number(offer["reference"]),
                             discountPct: P.number(offer["discount_pct"]), rank: int(offer["rank"]), url: P.url(offer["url"]))
        }
        return ShopProduct(id: P.text(row["gid"]) ?? title, title: String(title.prefix(140)), brand: P.text(row["brand"]),
                           category: P.text(row["category"]), kind: P.text(row["kind"]) ?? defaultKind,
                           rank: int(row["rank"]), rankChange: int(row["rank_change"]),
                           median: P.number(price["median"]), low: P.number(price["low"]), high: P.number(price["high"]),
                           platforms: int(row["platforms_n"]) ?? max(1, offers.count), changePct: P.number(row["change_pct"]),
                           period: P.text(row["period"]), offers: offers)
    }

    private static func category(_ row: [String: Any]) -> ShopCategory? {
        guard let key = P.text(row["key"]) else { return nil }
        let index = row["platform_index"] as? [String: Any]
        let official = row["official"] as? [String: Any]
        return ShopCategory(
            key: key, label: P.text(row["label"]) ?? ShopWords.category(key), value: P.number(row["value"]),
            period: P.text(row["period"]), basis: P.text(row["basis"]),
            parts: P.rows(row["parts"]).compactMap { part in
                guard let kind = P.text(part["kind"]), let v = P.number(part["value"]) else { return nil }
                let label = kind == "platforms" ? "Cross-site price index" : (kind == "official" ? "Official consumer prices" : DeckFeedParser.label(kind))
                return DeckBlendPart(label: label + (P.text(part["period"]).map { ", " + $0 } ?? ""),
                                     value: ShopWords.change(v, unit: "pct"),
                                     weight: P.number(part["weight"]).map { String(format: "weight %.2f", $0) })
            },
            confidence: confidence(row["confidence"]),
            indexValue: index.flatMap { P.number($0["value"]) }, indexChange7: index.flatMap { P.number($0["change_7d"]) },
            indexChange30: index.flatMap { P.number($0["change_30d"]) },
            indexDays: index.flatMap { int($0["span_days"]) } ?? index.map { hist($0["hist"]).count },
            indexHist: hist(index?["hist"]),
            officialLabel: official.flatMap { P.text($0["label"]) }, officialYoY: official.flatMap { P.number($0["yoy"]) },
            officialHist: hist(official?["hist"]))
    }

    private static func watch(_ row: [String: Any]) -> ShopWatch? {
        guard let slug = P.text(row["slug"]) else { return nil }
        let ci = row["ci"] as? [String: Any]
        let best = row["best"] as? [String: Any]
        return ShopWatch(
            slug: slug, label: P.text(row["label"]) ?? slug, category: P.text(row["category"]),
            median: P.number(row["median"]), low: ci.flatMap { P.number($0["lo"]) }, high: ci.flatMap { P.number($0["hi"]) },
            newMedian: P.number(row["new_median"]), listings: int(row["n"]), sitesOk: int(row["sites_ok"]),
            sitesExpected: int(row["sites_expected"]), change7: P.number(row["change_7d"]), change30: P.number(row["change_30d"]),
            bestPrice: best.flatMap { P.number($0["price"]) }, bestPlatform: best.flatMap { P.text($0["platform"]) },
            period: P.text(row["period"]), confidence: confidence(row["confidence"]), hist: hist(row["hist"]),
            byPlatform: P.rows((row["detail"] as? [String: Any])?["by_platform"]).compactMap { item in
                guard let platform = P.text(item["platform"]), let median = P.number(item["median"]) else { return nil }
                return ShopStorePrice(platform: platform, median: median, listings: int(item["n"]))
            }.sorted { $0.median < $1.median })
    }
}
