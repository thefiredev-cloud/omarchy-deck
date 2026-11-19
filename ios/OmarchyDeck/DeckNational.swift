import Foundation

/// Real estate (2026-11-14): every US ZIP, from the national routes in NationalApi.md. `GET /api/housing/national?
/// part=summary` (the US strip), `?part=sources` (the Data sheet), `GET /api/housing/rank` (best ZIPs for a scope) and
/// `GET /api/housing/zip/<zip>` (one ZIP with its blended metrics `m`: value, confidence, parts). 2026-11-17: the Best
/// ZIPs columns read `GET /api/housing/fields` (the catalog: which columns the ZIP table carries) and ask the rank route
/// for exactly those (`cols=`), and Markets reads `?part=segments` and `?part=states|metros&fields=...`. Decoded leniently:
/// unknown keys are ignored and every key is optional, because values come from staging until the data half lands.
/// Foundation only, so the Linux harness checks the routes, the parsing and the words.

enum NationalRoutes {
    static let summary = "housing/national?part=summary"
    static let sources = "housing/national?part=sources"
    /// The v2 field catalog (`housing.rs` `fields`): each field's `in_zips` and `rankable`, so the app asks the rank route
    /// only for columns its ZIP table has (any other `cols=` name answers 400 "bad cols").
    static let fields = "housing/fields"
    /// The Markets spec: segments, their fields and each field's label, unit, better direction, level and sources.
    static let segments = "housing/national?part=segments"
    static let pageSize = 50
    /// `part=states|metros` takes at most 100 keys in `fields=` (`MAX_LIST_FIELDS`); the rank route at most 200 `cols`.
    static let maxListFields = 100
    static let maxRankCols = 200

    /// Sort keys the app may send for `kind=housing`. `score`, `price`, `change_1y` and `rent` are the server's aliases
    /// (on v2 data they rank on the blended column: `price` is the home value, lowest first). The rest are v2 columns the
    /// catalog marks rankable, ranked best first by the catalog's direction. Gross yield sorts on the blended
    /// `gross_yield` (nulls last): the v1 alias `yield` reads the raw `yield_gross`, which a $1 placeholder home value
    /// turns into 754,800%, so it is never sent.
    static let aliasSorts: Set<String> = ["score", "price", "change_1y", "rent", "gross_yield"]
    static let columnSorts: Set<String> = ["days_on_market", "price_cuts", "inventory", "affordability", "multifamily_score",
                                           "rent_trend_1y"]

    static let states = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
                         "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
                         "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"]

    /// What the Best ZIPs list shows: the United States or one state, an optional city or ZIP prefix, a sort with an
    /// optional direction (`dir`, v2 only: a second tap on the sorted chip flips it) and a page.
    struct Scope: Equatable, Hashable {
        var state: String?
        var query: String?
        var sort = "score"
        var dir: String?
        var limit = NationalRoutes.pageSize

        var title: String {
            if let query { return "\u{201C}\(query)\u{201D}" }
            return state ?? "United States"
        }
    }

    /// `cols`: the columns to ask for (`BestZips.rankCols`), nil on v1 data or a deck without the catalog.
    static func rank(_ scope: Scope, cols: [String]? = nil) -> String {
        var items = [URLQueryItem(name: "kind", value: "housing"), URLQueryItem(name: "sort", value: scope.sort)]
        if let dir = scope.dir { items.append(URLQueryItem(name: "dir", value: dir)) }
        items.append(URLQueryItem(name: "limit", value: String(scope.limit)))
        if let state = scope.state { items.append(URLQueryItem(name: "state", value: state)) }
        if let query = scope.query { items.append(URLQueryItem(name: "q", value: query)) }
        if let cols, !cols.isEmpty { items.append(URLQueryItem(name: "cols", value: cols.joined(separator: ","))) }
        var parts = URLComponents()
        parts.queryItems = items
        return "housing/rank?" + (parts.percentEncodedQuery ?? "")
    }

    /// One Markets list: `part` states or metros, the row keys and fields to keep, optionally cut to one state.
    static func list(part: String, keys: [String], state: String? = nil) -> String {
        "housing/national?part=" + part + (state.map { "&state=" + $0 } ?? "") + "&fields=" + keys.joined(separator: ",")
    }

    static func zip(_ zip: String) -> String { "housing/zip/" + zip }

    static func isZip(_ text: String) -> Bool {
        text.count == 5 && text.allSatisfy { $0.isASCII && $0.isNumber }
    }

    /// A field or column name the server takes: 1 to 40 of a-z, 0-9 and underscore.
    static func isFieldName(_ text: String) -> Bool {
        (1...40).contains(text.count) && text.allSatisfy { $0.isASCII && ($0.isLowercase || $0.isNumber || $0 == "_") }
    }

    /// A search the rank route can take: letters, digits, spaces, dots, hyphens and apostrophes, at most 40.
    static func cleanQuery(_ text: String) -> String? {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, t.count <= 40,
              t.allSatisfy({ ($0.isASCII && ($0.isLetter || $0.isNumber)) || " .-'".contains($0) }) else { return nil }
        return t
    }

    /// A comma list of distinct field names, at most `max`.
    private static func names(_ text: String?, max: Int) -> [String]? {
        guard let text else { return nil }
        let list = text.split(separator: ",", omittingEmptySubsequences: false).map(String.init)
        guard !list.isEmpty, list.count <= max, list.allSatisfy(isFieldName), Set(list).count == list.count else { return nil }
        return list
    }

    /// The route path and query of a national feed name, or nil when the name is not one of the fixed routes with
    /// valid values. Nothing a feed or a user types reaches the URL unchecked.
    static func split(_ feed: String) -> (path: String, query: [URLQueryItem])? {
        guard let parts = URLComponents(string: "/api/" + feed) else { return nil }
        let items = parts.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        guard Set(items.map(\.name)).count == items.count else { return nil }
        switch parts.path {
        case "/api/housing/national":
            guard let part = value("part") else { return nil }
            switch part {
            case "summary", "sources", "segments":
                guard items.count == 1 else { return nil }
            case "states", "metros":
                let allowed: Set<String> = ["part", "state", "fields"]
                guard items.allSatisfy({ allowed.contains($0.name) }), names(value("fields"), max: maxListFields) != nil else { return nil }
                if let state = value("state"), !states.contains(state) { return nil }
            default:
                return nil
            }
            return (parts.path, items)
        case "/api/housing/fields":
            guard items.isEmpty else { return nil }
            return (parts.path, [])
        case "/api/housing/rank":
            let allowed: Set<String> = ["kind", "sort", "dir", "limit", "state", "q", "offset", "cols"]
            guard items.allSatisfy({ allowed.contains($0.name) }),
                  value("kind") == "housing", let sort = value("sort"), aliasSorts.contains(sort) || columnSorts.contains(sort),
                  let limit = value("limit").flatMap(Int.init), (1...200).contains(limit) else { return nil }
            if let state = value("state"), !states.contains(state) { return nil }
            if let q = value("q"), cleanQuery(q) != q { return nil }
            if let offset = value("offset"), Int(offset).map({ $0 >= 0 }) != true { return nil }
            if let dir = value("dir"), !["asc", "desc"].contains(dir) { return nil }
            if items.contains(where: { $0.name == "cols" }), names(value("cols"), max: maxRankCols) == nil { return nil }
            return (parts.path, items)
        default:
            let prefix = "/api/housing/zip/"
            guard items.isEmpty, parts.path.hasPrefix(prefix), isZip(String(parts.path.dropFirst(prefix.count))) else { return nil }
            return (parts.path, [])
        }
    }

    static func isRank(_ feed: String) -> Bool { feed.hasPrefix("housing/rank?") }
    static func isZipFeed(_ feed: String) -> Bool { feed.hasPrefix("housing/zip/") }
    /// A Markets list (`part=states|metros`), and which of the two.
    static func listPart(_ feed: String) -> String? {
        if feed.hasPrefix("housing/national?part=states") { return "states" }
        if feed.hasPrefix("housing/national?part=metros") { return "metros" }
        return nil
    }
}

// MARK: Models

struct NationalSummary: Equatable {
    let homeValue: Double?
    let valueChange1y: Double?
    let rent: Double?
    let grossYield: Double?
    let daysToSell: Double?
    let priceCuts: Double?
    let rate30: Double?
    let zipsTotal: Int?
    let graded: Int?
    let notes: [String]
    /// The 30-yr rate's own date ("2026-11-12"), for the Best ZIPs header line.
    var rate30AsOf: String? = nil
}

/// One figure of the United States strip. It stands alone in its tile, so a value the feed did not carry is nil and the
/// tile reads "No data" (`FeedStat`); the dot (`DeckMissing.cell`) marks only a gap among other figures in one row.
struct NationalTile: Equatable, Identifiable {
    let id: String
    let label: String
    let value: String?
}

extension NationalSummary {
    /// Home value, 1-yr change, rent, gross yield, days to sell and the 30-yr rate.
    var tiles: [NationalTile] {
        func figure(_ value: Double?, _ format: (Double) -> String) -> String? {
            value.flatMap { $0.isFinite ? format($0) : nil }
        }
        return [
            NationalTile(id: "national.us.value", label: "Home value", value: figure(homeValue) { DeckMoney.short($0) }),
            NationalTile(id: "national.us.change", label: "1-yr change",
                         value: figure(valueChange1y) { ShopWords.change($0, unit: "pct") }),
            NationalTile(id: "national.us.rent", label: "Rent", value: figure(rent) { DeckMoney.short($0) + "/mo" }),
            NationalTile(id: "national.us.yield", label: "Gross yield", value: figure(grossYield) { DeckFormat.percent($0) }),
            NationalTile(id: "national.us.dom", label: "Days to sell",
                         value: figure(daysToSell) { "\(DeckFeedParser.whole($0.rounded())) days" }),
            NationalTile(id: "national.us.rate", label: "30-yr rate", value: figure(rate30) { DeckFormat.percent($0, places: 2) }),
        ]
    }
}

struct NationalZipRow: Equatable, Identifiable {
    var id: String { zip }
    let zip: String
    let rank: Int?
    let city: String?
    let state: String?
    let county: String?
    let score: Double?
    let scoreConfidence: DeckConfidence?
    let grade: String?
    let value: Double?
    let valueConfidence: DeckConfidence?
    let rent: Double?
    let rentConfidence: DeckConfidence?
    let grossYield: Double?
    let change1y: Double?
    let population: Double?
    /// Every numeric column of the row by name (blends, confidences, raw readings), for the Best ZIPs columns.
    var values: [String: Double] = [:]
    /// Every column name the row carries, a null one included: a v2 column present as null is a value the build
    /// rejected, and the v1 column never stands in for it.
    var keys: Set<String> = []
    /// Columns whose value is the ZIP's county or metro figure (`from: {days_on_market: "county"}`), never its own.
    var from: [String: String] = [:]

    var place: String { [city, state].compactMap { $0 }.joined(separator: ", ") }
}

struct NationalRank: Equatable {
    let total: Int?
    let zipsTotal: Int?
    let rows: [NationalZipRow]
    /// "v2" when the answer names its columns (`cols`), else nil (a v1 answer: every row carries every column).
    var dataset: String? = nil
    var cols: [String]? = nil
    /// The sort the server used, as asked, and its direction ("asc", "desc"; v2 only).
    var sort: String? = nil
    var sortDir: String? = nil

    var isV2: Bool { dataset == "v2" }

    /// The columns this answer can fill: a v2 answer names them, a v1 answer carries its columns on each row.
    var have: Set<String> {
        if isV2, let cols { return Set(cols) }
        return rows.reduce(into: Set<String>()) { $0.formUnion($1.keys) }
    }
}

/// The v2 field catalog, cut to what the app needs: the columns the ZIP table carries (`in_zips`, the only names the
/// rank route's `cols=` accepts) and those it can sort on (`rankable`).
struct NationalCatalog: Equatable {
    let isV2: Bool
    let inZips: Set<String>
    let rankable: Set<String>
}

/// One figure in the ZIP sheet: a blended metric (with its confidence and parts), a raw reading (no mark), or a value
/// the national build rejected (`m[key] = {v: null, reason}`): "No data" with the reason, never the raw column.
struct NationalFact: Equatable, Identifiable {
    var id: String { key }
    let key: String
    let label: String
    let value: String
    let confidence: DeckConfidence?
    let parts: [DeckBlendPart]
    /// Why a rejected value is missing: "too few listings", "placeholder".
    var note: String? = nil
    /// "county" or "metro": the ZIP has no figure of its own, so its county's or metro's stands in (`m[key].from`).
    var from: String? = nil
}

struct NationalSection: Equatable, Identifiable {
    var id: String { title }
    let title: String
    let facts: [NationalFact]
}

struct NationalZip: Equatable {
    let zip: String
    let city: String?
    let state: String?
    let county: String?
    let metro: String?
    let score: Double?
    let scoreConfidence: DeckConfidence?
    let grade: String?
    /// Value, rent, gross yield, 1-yr: the four head tiles.
    let tiles: [NationalFact]
    let sections: [NationalSection]
    /// Monthly typical home value, oldest first.
    let valueHistory: [ShopSeriesPoint]

    var place: String { [city, state].compactMap { $0 }.joined(separator: ", ") }
}

// MARK: Words

enum NationalWords {
    /// Labels and units of the blended metrics this app shows (plan/metrics.json), and the one wording table Housing's
    /// market rows read too ("Homes for sale", "Days to sell", "Days to pending", "List price"), as the web page says them.
    static let metrics: [String: (label: String, unit: String)] = [
        "home_value": ("Home value", "usd"), "value_trend_1y": ("1-yr change", "pct_change"),
        "value_trend_5y": ("5-yr change", "pct_change"), "value_forecast_1y": ("12-mo outlook", "pct_change"),
        "typical_rent": ("Rent", "usd_month"), "rent_trend_1y": ("Rent 1-yr", "pct_change"),
        "gross_yield": ("Gross yield", "pct"), "inventory": ("Homes for sale", "count"),
        "days_on_market": ("Days to sell", "days"), "sale_to_list": ("Sale to list", "pct"),
        "price_cuts": ("Price cuts", "pct"), "market_heat": ("Market heat", "score"),
        "affordability": ("Payment to income", "pct"), "property_tax_rate": ("Property tax rate", "pct2"),
        "vacancy_rate": ("Vacant homes", "pct"), "population": ("Population", "count"),
        "pop_trend": ("Population change since 2020", "pct_change"), "migration": ("People moving in", "score"),
        "income": ("Household income", "usd"), "income_trend": ("Income change per year", "pct_change"),
        "jobs_trend": ("Jobs 1-yr", "pct_change"), "wages": ("Average wage", "usd"),
        "unemployment": ("Unemployment", "pct"), "schools": ("School quality", "score"), "safety": ("Safety", "score"),
        "health": ("Community health", "score"), "broadband": ("Homes with broadband", "pct"),
        "walkability": ("Walkability", "score"), "new_supply": ("Homes permitted per 1,000", "plain"),
        "business_base": ("Businesses", "count"), "jobs_total": ("Jobs here", "count"),
        "climate_risk": ("Natural hazard risk", "score"), "flood_risk": ("Flood risk", "score"),
        "insurance_cost": ("Insurance cost pressure", "score"),
        "list_price": ("List price", "usd"), "sale_price": ("Sale price", "usd"),
        "days_to_pending": ("Days to pending", "days"),
    ]

    /// The span word after a one-year change, as the web's rows and table heads print it: "+7.1% 1-yr".
    static let oneYear = "1-yr"

    /// One fact in a row's plain words, from the table above: "77 homes for sale", "list price $2.23M",
    /// "68 days to sell" (the web's "Your markets" rows). Nil for a key the table does not name.
    static func phrase(_ key: String, _ value: Double) -> String? {
        guard let info = metrics[key] else { return nil }
        let words = info.label.lowercased()
        switch info.unit {
        case "count": return RealEstateWords.count(value) + " " + words
        case "days": return "\(DeckFeedParser.whole(value.rounded())) " + words
        default: return words + " " + format(value, unit: info.unit)
        }
    }

    static func format(_ value: Double, unit: String) -> String {
        switch unit {
        case "usd": return DeckMoney.short(value)
        case "usd_month": return DeckMoney.short(value) + "/mo"
        case "pct": return DeckFormat.percent(value)
        case "pct2": return DeckFormat.percent(value, places: 2)
        case "pct_change": return ShopWords.change(value, unit: "pct")
        case "days": return "\(DeckFeedParser.whole(value.rounded())) days"
        case "score": return "\(DeckFeedParser.whole(value.rounded())) of 100"
        case "count": return ShopWords.compact(value)
        default: return value.rounded() == value ? RealEstateWords.count(value) : String(format: "%.1f", value)
        }
    }

    static func score(_ value: Double?) -> String? {
        value.map { "\(DeckFeedParser.whole($0.rounded()))" }
    }

    /// The web's count (`DeckFmt.count`): exact with commas under 10,000, then "12.4K", "1.2M", "1.0B" with one place.
    static func count(_ value: Double) -> String {
        let a = abs(value)
        let sign = value < 0 ? "\u{2212}" : ""
        if a >= 999.95e6 { return sign + DeckFormat.fixed(a / 1e9, 1) + "B" }
        if a >= 999.95e3 { return sign + DeckFormat.fixed(a / 1e6, 1) + "M" }
        if a >= 9999.5 { return sign + DeckFormat.fixed(a / 1e3, 1) + "K" }
        let whole = DeckFeedParser.whole(a.rounded())
        return (whole == 0 ? "" : sign) + DeckFormat.grouped(String(whole))
    }

    /// A label inside a sentence: "Gross yield" reads "gross yield"; an acronym (CMBS) or a figure keeps its case.
    static func lowerFirst(_ text: String) -> String {
        let chars = Array(text)
        guard chars.count > 1, chars[0].isUppercase, chars[1].isLowercase else { return text }
        return chars[0].lowercased() + String(chars.dropFirst())
    }
}

// MARK: Parser

enum DeckNationalParser {
    private typealias P = DeckFeedParser

    static func summary(_ json: [String: Any]) -> NationalSummary {
        let us = json["us"] as? [String: Any] ?? [:]
        let mortgage = json["mortgage"] as? [String: Any] ?? [:]
        let coverage = json["coverage"] as? [String: Any] ?? [:]
        var notes: [String] = []
        if let total = P.number(coverage["zips_total"]) {
            notes.append("\(RealEstateWords.count(total)) ZIPs; \(RealEstateWords.count(P.number(coverage["with_zhvi"]))) with a home value index, "
                         + "\(RealEstateWords.count(P.number(coverage["graded"]))) graded.")
        }
        if let rate = P.number(mortgage["rate_30y"]) {
            notes.append("30-year rate " + DeckFormat.percent(rate, places: 2) + (P.text(mortgage["as_of"]).map { ", \(DeckSources.periodWords($0))" } ?? "")
                         + (P.text(mortgage["source"]).map { ". \($0)." } ?? "."))
        }
        notes.append("United States values are population-weighted medians over the ZIPs that report each field.")
        notes.append("Confidence: number of sources, how far they agree, how fresh they are and how close the geography is (0 to 1).")
        if let method = json["score_method"] as? [String: Any] {
            let parts = P.rows(method["h"]).compactMap { row -> String? in
                guard let label = P.text(row["label"]), let weight = P.number(row["weight"]) else { return nil }
                return "\(label) \(DeckFeedParser.whole((weight * 100).rounded()))%"
            }
            if !parts.isEmpty { notes.append("Score weights: " + parts.joined(separator: ", ") + ".") }
        }
        return NationalSummary(homeValue: P.number(us["zhvi"]), valueChange1y: P.number(us["zhvi_yoy"]), rent: P.number(us["rent"]),
                               grossYield: P.number(us["yield_gross"]), daysToSell: P.number(us["dom"]),
                               priceCuts: P.number(us["price_cut_share"]), rate30: P.number(mortgage["rate_30y"]),
                               zipsTotal: P.number(coverage["zips_total"]).map { P.whole($0) },
                               graded: P.number(coverage["graded"]).map { P.whole($0) }, notes: notes,
                               rate30AsOf: P.text(mortgage["as_of"]))
    }

    /// `GET /api/housing/fields`: v2 when the answer says so and lists fields; a v1 deck answers an empty list.
    static func catalog(_ json: [String: Any]) -> NationalCatalog {
        let fields = P.rows(json["fields"])
        var inZips = Set<String>(), rankable = Set<String>()
        for field in fields {
            guard let name = P.text(field["name"]), NationalRoutes.isFieldName(name) else { continue }
            if field["in_zips"] as? Bool == true { inZips.insert(name) }
            if field["rankable"] as? Bool == true { rankable.insert(name) }
        }
        return NationalCatalog(isV2: P.text(json["dataset"]) == "v2" && !fields.isEmpty, inZips: inZips, rankable: rankable)
    }

    private static func conf(_ value: Any?) -> DeckConfidence? {
        P.number(value).map { DeckConfidence(score: $0, label: nil) }
    }

    /// A v2 column when the row carries it, even as null (a value the build rejected); the v1 column only on a v1 row.
    /// A rejected blend never falls back to its raw column.
    private static func column(_ row: [String: Any], _ v2: String, _ v1: String) -> Double? {
        row.keys.contains(v2) ? P.number(row[v2]) : P.number(row[v1])
    }

    static func row(_ row: [String: Any]) -> NationalZipRow? {
        guard let zip = P.text(row["zip"]), NationalRoutes.isZip(zip) else { return nil }
        let value = column(row, "home_value", "zhvi"), rent = column(row, "typical_rent", "rent")
        return NationalZipRow(zip: zip, rank: P.number(row["rank"]).map { P.whole($0) }, city: P.text(row["city"]),
                              state: P.text(row["state"]), county: P.text(row["county"]),
                              score: P.number(row["h_score"]), scoreConfidence: conf(row["h_conf"]),
                              grade: P.text(row["area_grade"]),
                              value: value,
                              valueConfidence: P.number(row["home_value"]) == nil ? nil : conf(row["home_value_conf"]),
                              rent: rent,
                              rentConfidence: P.number(row["typical_rent"]) == nil ? nil : conf(row["typical_rent_conf"]),
                              grossYield: column(row, "gross_yield", "yield_gross"),
                              change1y: column(row, "value_trend_1y", "zhvi_yoy"),
                              population: P.number(row["pop"]),
                              values: row.reduce(into: [:]) { out, pair in
                                  if pair.key != "zip", let v = P.number(pair.value) { out[pair.key] = v }
                              },
                              keys: Set(row.keys),
                              from: (row["from"] as? [String: Any] ?? [:]).reduce(into: [:]) { out, pair in
                                  if let area = P.text(pair.value), ["county", "metro"].contains(area) { out[pair.key] = area }
                              })
    }

    static func rank(_ json: [String: Any]) -> NationalRank {
        let cols = (json["cols"] as? [Any])?.compactMap { P.text($0) }
        let dir = P.text(json["sort_dir"])
        return NationalRank(total: P.number(json["total"]).map { P.whole($0) },
                            zipsTotal: P.number(json["zips_total"]).map { P.whole($0) },
                            rows: P.rows(json["rows"]).compactMap(row),
                            dataset: P.text(json["dataset"]), cols: cols, sort: P.text(json["sort"]),
                            sortDir: dir == "asc" || dir == "desc" ? dir : nil)
    }

    /// A blended metric from `m`, else nothing: raw columns are added by the caller without a mark. Parts arrive as
    /// `[field, weight, tier]`; the Data sheet lists each field with its weight. A value the build rejected
    /// (`{v: null, reason}`) reads "No data" with its reason.
    private static func metric(_ m: [String: Any], _ key: String) -> NationalFact? {
        guard let entry = m[key] as? [String: Any], let info = NationalWords.metrics[key] else { return nil }
        guard let v = P.number(entry["v"]) else {
            guard let reason = P.text(entry["reason"]) else { return nil }
            return NationalFact(key: key, label: info.label, value: DeckMissing.sheet, confidence: nil, parts: [],
                                note: String(reason.prefix(80)))
        }
        let parts = (entry["p"] as? [Any] ?? []).compactMap { part -> DeckBlendPart? in
            guard let items = part as? [Any], items.count >= 2, let field = P.text(items[0]), let weight = P.number(items[1]) else { return nil }
            return DeckBlendPart(label: DeckFeedParser.label(field), value: String(format: "weight %.2f", weight), weight: nil)
        }
        let area = P.text(entry["from"]).flatMap { ["county", "metro"].contains($0) ? $0 : nil }
        return NationalFact(key: key, label: info.label, value: NationalWords.format(v, unit: info.unit),
                            confidence: conf(entry["c"]), parts: parts, from: area)
    }

    private static func raw(_ json: [String: Any], _ key: String, _ label: String, _ unit: String) -> NationalFact? {
        P.number(json[key]).map { NationalFact(key: key, label: label, value: NationalWords.format($0, unit: unit), confidence: nil, parts: []) }
    }

    static func zip(_ json: [String: Any]) -> NationalZip? {
        guard let zip = P.text(json["zip"]), NationalRoutes.isZip(zip) else { return nil }
        let m = json["m"] as? [String: Any] ?? [:]
        func blend(_ keys: [String]) -> [NationalFact] { keys.compactMap { metric(m, $0) } }
        /// The blend, or a rejected value with its reason; the raw v1 column only when `m` does not name the metric.
        func tile(_ key: String, fallback: String, unit: String) -> NationalFact? {
            if m[key] != nil { return metric(m, key) }
            return raw(json, fallback, NationalWords.metrics[key]?.label ?? fallback, unit)
        }
        let tiles = [tile("home_value", fallback: "zhvi", unit: "usd"), tile("typical_rent", fallback: "rent", unit: "usd_month"),
                     tile("gross_yield", fallback: "yield_gross", unit: "pct"), tile("value_trend_1y", fallback: "zhvi_yoy", unit: "pct_change")]
            .compactMap { $0 }
        let sections: [NationalSection] = [
            NationalSection(title: "Value and rent", facts: blend(["value_trend_5y", "value_forecast_1y", "rent_trend_1y"])),
            NationalSection(title: "Market", facts: blend(["inventory", "days_on_market", "sale_to_list", "price_cuts", "market_heat",
                                                           "vacancy_rate", "new_supply"])),
            NationalSection(title: "People", facts: blend(["population", "pop_trend", "migration", "income", "income_trend"])
                + [raw(json, "median_age", "Median age", "plain"), raw(json, "renter_share", "Renters", "pct"),
                   raw(json, "acs_moved_1y_share", "Moved in last year", "pct"),
                   raw(json, "acs_bachelor_plus", "Bachelor's or higher", "pct")].compactMap { $0 }),
            NationalSection(title: "Jobs", facts: blend(["unemployment", "jobs_trend", "wages", "jobs_total", "business_base"])),
            NationalSection(title: "Schools", facts: blend(["schools"])
                + [raw(json, "schools_5mi", "Public schools within 5 mi", "count"), raw(json, "colleges_5mi", "Colleges within 5 mi", "count"),
                   raw(json, "college_enroll_10mi", "College students within 10 mi", "count")].compactMap { $0 }),
            NationalSection(title: "Risk", facts: blend(["safety", "health", "climate_risk", "flood_risk", "insurance_cost"])),
            NationalSection(title: "Costs", facts: blend(["affordability", "property_tax_rate", "broadband", "walkability"])
                + [raw(json, "acs_owner_cost_pct_income", "Owner costs, share of income", "pct")].compactMap { $0 }),
        ].filter { !$0.facts.isEmpty }
        // A home value the build rejected (a placeholder) draws no chart of the same raw series.
        let rejected = (m["home_value"] as? [String: Any]).map { P.number($0["v"]) == nil && P.text($0["reason"]) != nil } ?? false
        let history: [ShopSeriesPoint] = rejected ? [] : ((json["hist"] as? [String: Any])?["zhvi"] as? [Any] ?? []).compactMap { pair -> ShopSeriesPoint? in
            guard let items = pair as? [Any], items.count >= 2, let period = P.text(items[0]), let v = P.number(items[1]) else { return nil }
            return ShopSeriesPoint(period: period, value: v)
        }
        return NationalZip(zip: zip, city: P.text(json["city"]), state: P.text(json["state"]), county: P.text(json["county"]),
                           metro: P.text(json["metro"]), score: P.number(json["h_score"]), scoreConfidence: conf(json["h_conf"]),
                           grade: P.text(json["area_grade"]), tiles: tiles, sections: sections, valueHistory: history)
    }
}
