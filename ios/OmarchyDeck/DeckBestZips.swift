import Foundation

/// Best ZIPs columns (owner order 2026-11-17), the native twin of the web's `bestCols` in `static/pages/realestate.js`:
/// the owner's data points in his order (Home value, 1-yr change, Rent, Gross yield, Days to sell, Price cuts,
/// Inventory, Payment to income; the 30-yr rate is national, so it prints once in the section header) and the
/// Multifamily lens. A column whose field the deck's ZIP table lacks is left out, never drawn empty. A missing value is
/// a dash that says why to VoiceOver, never zero. A county's or metro's figure standing in for the ZIP's own carries a
/// "county value" or "metro value" tag (the rank row's `from` map). Foundation only, so the Linux harness checks it.

enum BestZipsLens: String, CaseIterable, Identifiable {
    case residential = "res", multifamily = "mf"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .residential: return "Residential"
        case .multifamily: return "Multifamily"
        }
    }
}

/// How a column prints its value: the web's `fmtVal` kinds.
enum BestZipFormat: Equatable {
    case money, rent, change, rate, share, score, days, homes, units, points
}

/// The label and help a fallback field gives its column ("Homes in 5+ unit buildings" for all homes, when the renter
/// share is not in the table).
struct BestZipLabel: Equatable {
    let label: String
    let help: String
}

struct BestZipColumn: Equatable, Identifiable {
    var id: String { key }
    let key: String
    var label: String
    var help: String
    /// The fields the column reads, the first one the answer carries wins.
    let fields: [String]
    /// The column a v1 answer carries instead.
    var v1: String? = nil
    let format: BestZipFormat
    /// The rank route's sort key for this column, when it sorts.
    var sort: String? = nil
    var alt: [String: BestZipLabel] = [:]
    /// The field this answer fills the column from (`BestZips.columns`).
    var field: String? = nil
}

/// One cell: the value with its unit, its confidence (v2 blends) and the area tag, or nil text for a missing value.
struct BestZipCell: Equatable {
    let text: String?
    let confidence: DeckConfidence?
    /// "county" or "metro": the ZIP has no figure of its own, so its county's or metro's stands in.
    let from: String?
    /// What VoiceOver reads for the cell.
    let spoken: String
}

enum BestZips {
    /// The missing mark in a Best ZIPs or Markets cell: the web tables' quiet dash (`.na`). Its spoken name says why.
    static let dash = "-"

    static let residential: [BestZipColumn] = [
        BestZipColumn(key: "value", label: "Home value", help: "Typical home value in this ZIP.", fields: ["home_value"],
                      v1: "zhvi", format: .money, sort: "price"),
        BestZipColumn(key: "chg", label: "1-yr change", help: "Change in home value over the last 12 months.",
                      fields: ["value_trend_1y"], v1: "zhvi_yoy", format: .change, sort: "change_1y"),
        rent,
        BestZipColumn(key: "yield", label: "Gross yield", help: "A year of rent divided by the home value, before costs.",
                      fields: ["gross_yield"], v1: "yield_gross", format: .rate, sort: "gross_yield"),
        BestZipColumn(key: "days", label: "Days to sell", help: "Typical days from listing to sale.", fields: ["days_on_market"],
                      v1: "dom", format: .days, sort: "days_on_market"),
        BestZipColumn(key: "cuts", label: "Price cuts", help: "Share of homes for sale with a price cut.", fields: ["price_cuts"],
                      v1: "price_cut_share", format: .share, sort: "price_cuts"),
        BestZipColumn(key: "inv", label: "Inventory", help: "Homes for sale now.", fields: ["inventory"], v1: "active",
                      format: .homes, sort: "inventory"),
        BestZipColumn(key: "afford", label: "Payment to income",
                      help: "Monthly payment on a typical home as a share of typical income.", fields: ["affordability"],
                      format: .share, sort: "affordability"),
    ]

    private static let rent = BestZipColumn(key: "rent", label: "Rent", help: "Typical rent per month.", fields: ["typical_rent"],
                                            v1: "rent", format: .rent, sort: "rent")

    static let multifamily: [BestZipColumn] = [
        BestZipColumn(key: "mf", label: "Multifamily score", help: "Score for apartment buildings, 0 to 100.",
                      fields: ["multifamily_score"], format: .score, sort: "multifamily_score"),
        rent,
        BestZipColumn(key: "rent1y", label: "Rent 1-yr", help: "Change in typical rent over the last 12 months.",
                      fields: ["rent_trend_1y"], format: .change, sort: "rent_trend_1y"),
        BestZipColumn(key: "r5", label: "Renters in 5+ unit buildings", help: "Renter homes in buildings with 5 or more units.",
                      fields: ["acsmf_renter_5plus_share", "acs_units_5plus_share"], format: .share,
                      alt: ["acs_units_5plus_share": BestZipLabel(label: "Homes in 5+ unit buildings",
                                                                  help: "All homes in buildings with 5 or more units.")]),
        BestZipColumn(key: "u24", label: "2-4 unit share", help: "Homes in buildings with 2 to 4 units.",
                      fields: ["acs_units_2_4_share"], format: .share),
        BestZipColumn(key: "vac", label: "Vacant for rent", help: "Homes empty and offered for rent.",
                      fields: ["acs_vacant_for_rent_share"], format: .share),
        BestZipColumn(key: "p5", label: "Units permitted 5+", help: "Units in 5+ unit buildings permitted in the last 12 months.",
                      fields: ["bps_units_5plus_12m"], format: .units),
        BestZipColumn(key: "cap", label: "MF cap spread", help: "Asking apartment cap rate minus the 10-year Treasury.",
                      fields: ["cap_spread_multifamily"], format: .points),
    ]

    static func definitions(_ lens: BestZipsLens) -> [BestZipColumn] {
        lens == .multifamily ? multifamily : residential
    }

    /// Row keys every rank read asks for besides the columns: place, grade and the overall score with its confidence.
    static let baseCols = ["city", "state", "area_grade", "h_score", "h_conf"]

    /// The confidence column of a field: `<field>_conf`, or `<x>_conf` for `<x>_score` (`multifamily_conf`).
    static func confName(_ field: String) -> String {
        field.hasSuffix("_score") ? String(field.dropLast("_score".count)) + "_conf" : field + "_conf"
    }

    /// The `cols=` of a rank read: every column of both lenses plus each one's confidence, only where the catalog says
    /// the ZIP table carries it (any other name answers 400 "bad cols"). Nil on v1 data or without the catalog: the
    /// read then takes the server's default columns.
    static func rankCols(_ catalog: NationalCatalog?) -> [String]? {
        guard let catalog, catalog.isV2 else { return nil }
        var out: [String] = []
        func add(_ name: String) {
            if catalog.inZips.contains(name), !out.contains(name) { out.append(name) }
        }
        baseCols.forEach(add)
        for column in residential + multifamily {
            for field in column.fields {
                add(field)
                add(confName(field))
            }
        }
        return out.isEmpty ? nil : Array(out.prefix(NationalRoutes.maxRankCols))
    }

    /// The columns one answer can fill, in the lens's order. `have`: the answer's columns (`NationalRank.have`). A v2
    /// answer fills a column from the first of its fields it names; a v1 answer from a v2 field its rows carry, else
    /// the old column.
    static func columns(_ lens: BestZipsLens, isV2: Bool, have: Set<String>) -> [BestZipColumn] {
        definitions(lens).compactMap { def in
            let candidates = isV2 ? def.fields : def.fields + [def.v1].compactMap { $0 }
            guard let field = candidates.first(where: have.contains) else { return nil }
            var column = def
            column.field = field
            if let alt = def.alt[field] {
                column.label = alt.label
                column.help = alt.help
            }
            return column
        }
    }

    // MARK: Sorting

    /// A sort key the deck can rank on: the aliases always, a column sort when the catalog marks its column rankable.
    static func canSort(_ key: String, catalog: NationalCatalog?) -> Bool {
        if NationalRoutes.aliasSorts.contains(key) { return true }
        guard NationalRoutes.columnSorts.contains(key), let catalog, catalog.isV2 else { return false }
        return catalog.rankable.contains(key)
    }

    /// The sort chips of a lens, in column order: Score leads the Residential lens (its card head shows the score).
    static func sorts(_ lens: BestZipsLens, catalog: NationalCatalog?) -> [(key: String, title: String)] {
        var out: [(key: String, title: String)] = lens == .residential ? [("score", "Score")] : []
        for column in definitions(lens) {
            if let sort = column.sort, canSort(sort, catalog: catalog), !out.contains(where: { $0.key == sort }) {
                out.append((sort, column.label))
            }
        }
        return out
    }

    /// The sort a lens ranks by: the current one when the lens has it, else the lens's lead (Score, Multifamily score).
    static func lensSort(_ lens: BestZipsLens, sort: String, catalog: NationalCatalog?) -> String {
        let keys = sorts(lens, catalog: catalog).map(\.key)
        if keys.contains(sort) { return sort }
        return keys.first ?? "score"
    }

    /// The direction the server ranked in: its echo on v2, else the alias's own (the home value lowest first).
    static func direction(_ rank: NationalRank?, sort: String) -> String {
        rank?.sortDir ?? (sort == "price" ? "asc" : "desc")
    }

    static func sortTitle(_ key: String) -> String {
        if key == "score" { return "Score" }
        return (residential + multifamily).first { $0.sort == key }?.label ?? DeckFeedParser.label(key)
    }

    /// "Sorted by days to sell, lowest first".
    static func sortLine(_ key: String, direction: String) -> String {
        "Sorted by " + NationalWords.lowerFirst(sortTitle(key)) + (direction == "asc" ? ", lowest first" : ", highest first")
    }

    // MARK: Cells

    /// The field a row fills a column from: the answer's own on v2; on v1 a v2 field the row carries (even null: a
    /// value the build rejected never falls back to its raw column), else the old column.
    static func field(_ row: NationalZipRow, _ column: BestZipColumn, isV2: Bool) -> String? {
        if isV2 { return column.field }
        return column.fields.first(where: row.keys.contains) ?? column.v1
    }

    static func confidence(_ row: NationalZipRow, field: String) -> DeckConfidence? {
        row.values[confName(field)].map { DeckConfidence(score: $0, label: nil) }
    }

    static func cell(_ row: NationalZipRow, _ column: BestZipColumn, isV2: Bool) -> BestZipCell {
        guard let field = field(row, column, isV2: isV2), let value = row.values[field] else {
            return BestZipCell(text: nil, confidence: nil, from: nil, spoken: missingSpoken(column.label))
        }
        let text = format(value, column.format)
        let from = isV2 ? row.from[field] : nil
        let spoken = [column.label + ", " + text, from.map { fromSpoken($0) }].compactMap { $0 }.joined(separator: ", ")
        return BestZipCell(text: text, confidence: isV2 ? confidence(row, field: field) : nil, from: from, spoken: spoken)
    }

    static func missingSpoken(_ label: String) -> String {
        label + ": not reported for this ZIP. Open the ZIP to see why."
    }

    /// The tag after a value that is not the ZIP's own: "county value", "metro value".
    static func fromTag(_ area: String) -> String { area + " value" }

    static func fromSpoken(_ area: String) -> String {
        "\(area) value, not this ZIP's own figure"
    }

    static func format(_ value: Double, _ kind: BestZipFormat) -> String {
        func counted(_ word: String, _ n: Double) -> String {
            NationalWords.count(n) + "\u{00A0}" + (n == 1 ? word : word + "s")
        }
        switch kind {
        case .money: return DeckMoney.short(value)
        case .rent: return DeckMoney.short(value) + "/mo"
        case .change: return DeckFormat.change(value)
        case .rate: return DeckFormat.percent(value, places: 2)
        case .share: return DeckFormat.percent(value)
        case .score: return "\(DeckFeedParser.whole(value.rounded()))"
        case .days: return counted("day", value.rounded())
        case .homes: return counted("home", value)
        case .units: return counted("unit", value)
        case .points: return DeckFormat.change(value, kind: .points)
        }
    }

    // MARK: Header and help

    /// The 30-yr rate is national: once, in the section header, with its date. "30-yr rate 7.11% · Nov 12, 2026".
    static func rateLine(_ summary: NationalSummary?) -> String? {
        guard let rate = summary?.rate30, rate.isFinite else { return nil }
        let date = summary?.rate30AsOf.flatMap { text -> String? in
            guard text.count == 10, let day = DeckFormat.parse(text) else { return nil }
            return DeckFormat.date(day, year: true)
        }
        return "30-yr rate " + DeckFormat.percent(rate, places: 2) + (date.map { " \u{00B7} " + $0 } ?? "")
    }

    /// One plain line per column, then the marks: what the columns mean.
    static func help(_ columns: [BestZipColumn], rate: Bool) -> [(term: String, meaning: String)] {
        var rows = columns.map { ($0.label, $0.help) }
        if rate { rows.append(("30-yr rate", "National average for a 30-year fixed loan. The same for every ZIP.")) }
        rows.append(("Meter after a value", "How sure the value is: three segments high, one low."))
        rows.append(("A dash", "Not reported for this ZIP. Never counted as zero. Open the ZIP to see why."))
        rows.append(("County or metro value", "The ZIP has no figure of its own, so its county's or metro's stands in."))
        return rows.map { (term: $0.0, meaning: $0.1) }
    }
}
