import Foundation

/// Real estate > Markets (owner order 2026-11-17), the native twin of the web's `static/pages/markets.js` pure block:
/// compare states and metros by property segment (Residential, Multifamily, Retail, Office, Industrial, People and jobs).
/// `GET /api/housing/national?part=segments` is the spec (each segment's fields best first, and each field's label,
/// unit, better direction, level and sources); `?part=states|metros&fields=<row keys + segment fields>` the rows (Your
/// markets cuts both to California). A missing value prints the table's dash, never 0. A field only a few places
/// publish stays in the row sheet instead of an empty-looking column. Decoded leniently: unknown keys are ignored and a
/// deck without segments gives an empty spec. Foundation only, so the Linux harness checks it.

enum MarketsLevel: String, CaseIterable, Identifiable {
    case states, metros, mine

    var id: String { rawValue }

    var title: String {
        switch self {
        case .states: return "States"
        case .metros: return "Metros"
        case .mine: return "Your markets"
        }
    }

    /// The place column's head and a row's kind in words.
    var placeHead: String {
        switch self {
        case .states: return "State"
        case .metros: return "Metro"
        case .mine: return "Market"
        }
    }

    var plural: String {
        switch self {
        case .states: return "states"
        case .metros: return "metros"
        case .mine: return "markets"
        }
    }
}

struct MarketsSource: Equatable {
    let id: String
    let name: String?
    let publisher: String?
    let asOf: String?
}

/// One field of the spec: how it reads (label, unit), which way is better, its geography and its sources.
struct MarketsField: Equatable {
    var label: String?
    var unit: String?
    var better: String?
    var level: String?
    var sources: [MarketsSource] = []
}

struct MarketsSegment: Equatable, Identifiable {
    let id: String
    let label: String
    /// The field the segment ranks by first.
    let lead: String?
    /// The fields this build produces, best first.
    let fields: [String]
    /// Fields of the spec this build does not produce yet.
    let skipped: [String]
}

struct MarketsSpec: Equatable {
    let segments: [MarketsSegment]
    let fields: [String: MarketsField]
    /// Why the spec is empty ("The national data is still the v1 set ...").
    let reason: String?
}

enum MarketsKind: String, Equatable {
    case state, metro
}

/// One state or metro: its key (a state code, a 5-digit CBSA), its name split into place and state codes, and every
/// numeric field it carries. `rank` is set by the table: its place in the sort over the whole level.
struct MarketsRow: Equatable, Identifiable {
    var id: String { key }
    let key: String
    let kind: MarketsKind
    let name: String
    /// A state row's code; a metro row's state codes ("CA", "NY-NJ-PA").
    let sub: String
    /// A metro's full name ("San Diego-Chula Vista-Carlsbad, CA"); a state's name.
    let full: String
    var values: [String: Double]
    var rank: Int? = nil
}

struct MarketsSort: Equatable, Hashable {
    var key: String?
    var ascending: Bool
}

struct MarketsColumns: Equatable {
    /// Columns on screen, the lead first.
    let cols: [String]
    /// Fields with no value in any row: named once as not reported here.
    let hidden: [String]
    /// Fields only a few rows carry: in the row sheet only.
    let sparse: [String]
    let lead: String?
    /// Your markets: a metro field's column also holds the state row's matching state field (metro id -> state id).
    let pairs: [String: String]
    /// The rows with each shared column filled from the state row's own field.
    let rows: [MarketsRow]
}

struct MarketsTable: Equatable {
    let level: MarketsLevel
    let segment: MarketsSegment?
    let cols: [String]
    let hidden: [String]
    let sparse: [String]
    let pairs: [String: String]
    /// Each column's label, unique on this screen.
    let labels: [String: String]
    let sort: MarketsSort
    /// Ranked over the whole level, then cut to the search.
    let rows: [MarketsRow]
    let total: Int
    let all: Int
    let shown: Int
    let query: String
}

struct MarketsSheetItem: Equatable, Identifiable {
    var id: String { key }
    let key: String
    let label: String
    let value: String
}

struct MarketsSheetSection: Equatable, Identifiable {
    let id: String
    let label: String
    let items: [MarketsSheetItem]
    /// Labels of the segment's fields this market has no value for, named once.
    let missing: [String]
}

enum Markets {
    private typealias P = DeckFeedParser

    /// Your markets: California and the three home metros (Los Angeles-Long Beach-Anaheim, San Diego,
    /// Riverside-San Bernardino), in this order.
    static let homeState = "CA"
    static let homeMetros = ["31080", "41740", "40140"]
    static let page = 50
    /// `fields=` takes 100 keys; the web asks for at most 98: two row keys and 96 fields.
    static let maxKeys = 98

    // MARK: Spec and rows

    static func spec(_ json: [String: Any]) -> MarketsSpec {
        let segments = P.rows(json["segments"]).compactMap { s -> MarketsSegment? in
            guard let id = P.text(s["id"]), NationalRoutes.isFieldName(id) else { return nil }
            let fields = (s["fields"] as? [Any] ?? []).compactMap { P.text($0) }
            let skipped = (s["skipped"] as? [Any] ?? []).compactMap { P.text($0) }
            return MarketsSegment(id: id, label: P.text(s["label"]) ?? id, lead: P.text(s["lead"]), fields: fields, skipped: skipped)
        }
        var fields: [String: MarketsField] = [:]
        for (id, value) in json["fields"] as? [String: Any] ?? [:] {
            guard let meta = value as? [String: Any] else { continue }
            let sources = P.rows(meta["sources"]).compactMap { s -> MarketsSource? in
                guard let sid = P.text(s["id"]) else { return nil }
                let asOf = P.text(s["as_of"]) ?? P.number(s["as_of"]).map { "\(P.whole($0))" }
                return MarketsSource(id: sid, name: P.text(s["name"]), publisher: P.text(s["publisher"]), asOf: asOf)
            }
            fields[id] = MarketsField(label: P.text(meta["label"]), unit: P.text(meta["unit"]), better: P.text(meta["better"]),
                                      level: P.text(meta["level"]), sources: sources)
        }
        return MarketsSpec(segments: segments, fields: fields, reason: P.text(json["reason"]))
    }

    /// The segment with this id, else the first.
    static func segment(_ spec: MarketsSpec?, id: String) -> MarketsSegment? {
        guard let spec else { return nil }
        return spec.segments.first { $0.id == id } ?? spec.segments.first
    }

    static func fieldsOf(_ segment: MarketsSegment?) -> [String] {
        Array((segment?.fields ?? []).filter(NationalRoutes.isFieldName).prefix(maxKeys - 2))
    }

    /// The reads a level and segment need: one list (states or metros), or both cut to California for Your markets.
    static func listQueries(_ level: MarketsLevel, _ segment: MarketsSegment?) -> [(part: String, feed: String)] {
        let f = fieldsOf(segment)
        switch level {
        case .mine:
            return [("states", NationalRoutes.list(part: "states", keys: ["state", "name"] + f, state: homeState)),
                    ("metros", NationalRoutes.list(part: "metros", keys: ["cbsa", "name"] + f, state: homeState))]
        case .states:
            return [("states", NationalRoutes.list(part: "states", keys: ["state", "name"] + f))]
        case .metros:
            return [("metros", NationalRoutes.list(part: "metros", keys: ["cbsa", "name"] + f))]
        }
    }

    /// "San Diego-Chula Vista-Carlsbad, CA" splits into its place and its state codes.
    static func metroParts(_ name: String) -> (place: String, states: String) {
        guard let range = name.range(of: ", ", options: .backwards) else { return (name, "") }
        return (String(name[..<range.lowerBound]), String(name[range.upperBound...]))
    }

    static func row(part: String, _ json: [String: Any]) -> MarketsRow? {
        var values: [String: Double] = [:]
        for (key, value) in json where key != "cbsa" && key != "state" {
            if let v = P.number(value) { values[key] = v }
        }
        if part == "states" {
            guard let code = P.text(json["state"])?.uppercased(), code.count == 2,
                  code.allSatisfy({ $0.isASCII && $0.isLetter }) else { return nil }
            let name = P.text(json["name"]) ?? code
            return MarketsRow(key: code, kind: .state, name: name, sub: code, full: name, values: values)
        }
        let cbsa = P.text(json["cbsa"]) ?? P.number(json["cbsa"]).map { String(format: "%05d", P.whole($0)) }
        guard let cbsa, NationalRoutes.isZip(cbsa) else { return nil }
        let full = P.text(json["name"]) ?? ""
        let parts = metroParts(full)
        return MarketsRow(key: cbsa, kind: .metro, name: parts.place.isEmpty ? cbsa : parts.place, sub: parts.states,
                          full: full, values: values)
    }

    static func rows(part: String, json: [String: Any]) -> [MarketsRow] {
        P.rows(json[part]).compactMap { row(part: part, $0) }
    }

    /// The rows of a level from the lists read. Your markets: the California row, then the home metros in order.
    static func rows(_ level: MarketsLevel, states: [MarketsRow], metros: [MarketsRow]) -> [MarketsRow] {
        switch level {
        case .states: return states
        case .metros: return metros
        case .mine:
            return states.filter { $0.key == homeState } + homeMetros.compactMap { code in metros.first { $0.key == code } }
        }
    }

    // MARK: Formats

    /// The web's `fmtField`, by the catalog's unit. A percent that is a change carries its sign; an interest rate, cap
    /// rate or yield reads with two places; other shares with one.
    static func format(_ meta: MarketsField?, _ value: Double?, id: String) -> String? {
        guard let x = value, x.isFinite else { return nil }
        func one(_ v: Double) -> String { (v < 0 ? "\u{2212}" : "") + DeckFormat.fixed(abs(v), 1) }
        switch meta?.unit {
        case "usd": return DeckMoney.short(x)
        case "usd_month": return DeckMoney.short(x) + "/mo"
        case "usd_sqft": return DeckMoney.short(x, cents: x < 100) + "/SF"
        case "pct":
            if isChange(id) { return DeckFormat.change(x) }
            if isRate(id) { return DeckFormat.percent(x, places: 2) }
            return DeckFormat.percent(x)
        case "pct_pts": return DeckFormat.change(x, places: 2, kind: .points)
        case "count": return NationalWords.count(x)
        case "days": return NationalWords.count(x.rounded())
        case "sqft": return NationalWords.count(x) + "\u{00A0}SF"
        case "score", "years", "year": return "\(P.whole(x.rounded()))"
        case "kwh_cents": return one(x) + "\u{00A2}"
        case "ratio", "per_1k", "per_100k", "index": return one(x)
        default:
            var s = (x < 0 ? "\u{2212}" : "") + DeckFormat.fixed(abs(x), 2)
            if s.contains(".") {
                while s.hasSuffix("0") { s.removeLast() }
                if s.hasSuffix(".") { s.removeLast() }
            }
            return s == "\u{2212}0" ? "0" : s
        }
    }

    /// `(_yoy|_trend|trend_|change|growth|forecast)`.
    static func isChange(_ id: String) -> Bool {
        ["_yoy", "_trend", "trend_", "change", "growth", "forecast"].contains { id.contains($0) }
    }

    /// `^(mortgage_rate|gross_yield)$|treasury|_cap$|^crel_cap_`.
    static func isRate(_ id: String) -> Bool {
        id == "mortgage_rate" || id == "gross_yield" || id.contains("treasury") || id.hasSuffix("_cap") || id.hasPrefix("crel_cap_")
    }

    static func label(_ fields: [String: MarketsField], _ id: String) -> String {
        fields[id]?.label ?? id.replacingOccurrences(of: "_", with: " ")
    }

    static func lowerBetter(_ fields: [String: MarketsField], _ id: String) -> Bool {
        fields[id]?.better == "lower"
    }

    // MARK: Columns

    static func count(_ rows: [MarketsRow], _ id: String) -> Int {
        rows.reduce(0) { $0 + ($1.values[id] == nil ? 0 : 1) }
    }

    /// A column needs values in at least 3 rows and a tenth of a long list (20 rows or more); a shorter list needs one.
    static func enough(_ rows: [MarketsRow], _ id: String) -> Bool {
        let n = count(rows, id)
        return rows.count < 20 ? n > 0 : n >= max(3, Int((Double(rows.count) / 10).rounded(.up)))
    }

    /// A field's geography from the catalog: "metro", "state", or nil (a ZIP, tract or county field rolled up, or a blend).
    static func levelOf(_ fields: [String: MarketsField], _ id: String) -> String? {
        switch fields[id]?.level {
        case "cbsa", "metro": return "metro"
        case "state": return "state"
        default: return nil
        }
    }

    /// States show no metro-only field and Metros no state-only field: such a column could never hold a value there.
    static func fitsLevel(_ fields: [String: MarketsField], _ id: String, _ level: MarketsLevel) -> Bool {
        let v = levelOf(fields, id)
        return !(level == .states && v == "metro" || level == .metros && v == "state")
    }

    /// The measure behind a level word: "Metro homes for sale (Redfin)" and "State homes for sale (Redfin)" are one.
    static func measure(_ label: String) -> String {
        var s = label
        for word in ["Metro ", "State "] where s.hasPrefix(word) { s.removeFirst(word.count) }
        return s.prefix(1).uppercased() + s.dropFirst()
    }

    /// Your markets mixes the state row with metro rows: a metro field and a state field of the same measure and unit
    /// share one column (the metro field's id), the state row reading its state field. Metro id -> state id.
    static func pairs(_ ids: [String], _ fields: [String: MarketsField]) -> [String: String] {
        var out: [String: String] = [:]
        var taken = Set<String>()
        for id in ids where levelOf(fields, id) == "metro" {
            let k = measure(label(fields, id)), unit = fields[id]?.unit
            if let s = ids.first(where: { !taken.contains($0) && levelOf(fields, $0) == "state" && measure(label(fields, $0)) == k
                && fields[$0]?.unit == unit }) {
                out[id] = s
                taken.insert(s)
            }
        }
        return out
    }

    private static let levelWord = ["cbsa": "metro", "metro": "metro", "state": "state", "zip": "ZIP data", "tract": "ZIP data",
                                    "county": "county data", "us": "US"]

    /// The labels of the fields on one screen, unique: a label two fields share takes their level word, else their
    /// publisher; a shared column names its measure without the level word.
    static func labels(_ ids: [String], _ fields: [String: MarketsField], pairs: [String: String] = [:]) -> [String: String] {
        var base: [String: String] = [:]
        var groups: [(label: String, ids: [String])] = []
        for id in ids {
            let l = pairs[id] != nil ? measure(label(fields, id)) : label(fields, id)
            base[id] = l
            if let i = groups.firstIndex(where: { $0.label == l }) { groups[i].ids.append(id) } else { groups.append((l, [id])) }
        }
        func word(_ id: String) -> String { fields[id]?.level.flatMap { levelWord[$0] } ?? "" }
        func publisher(_ id: String) -> String {
            guard let s = fields[id]?.sources.first else { return "" }
            return s.publisher ?? s.name ?? ""
        }
        var out: [String: String] = [:]
        for group in groups {
            guard group.ids.count > 1 else {
                out[group.ids[0]] = group.label
                continue
            }
            let tags = [word, publisher].map { fn in group.ids.map(fn) }
                .first { t in t.allSatisfy { !$0.isEmpty } && Set(t).count == group.ids.count }
            for (i, id) in group.ids.enumerated() {
                let tag = tags?[i] ?? ([word(id), publisher(id)].first { !$0.isEmpty } ?? "field") + " \(i + 1)"
                out[id] = group.label + " (" + tag + ")"
            }
        }
        return out
    }

    /// The columns: the segment's fields that fit the level and hold enough values in these rows, the lead first; the
    /// rest are named once (no value anywhere) or kept for the row sheet (too few values).
    static func columns(_ segment: MarketsSegment?, rows: [MarketsRow], level: MarketsLevel,
                        fields: [String: MarketsField]) -> MarketsColumns {
        let all = fieldsOf(segment).filter { fitsLevel(fields, $0, level) }
        let pairs = level == .mine ? self.pairs(all, fields) : [:]
        let paired = Set(pairs.values)
        let f = all.filter { !paired.contains($0) }
        let pairedLead = pairs.first { $0.value == segment?.lead }?.key
        let lead = segment?.lead.flatMap { f.contains($0) ? $0 : nil } ?? pairedLead ?? f.first
        let filled = pairs.isEmpty ? rows : rows.map { row -> MarketsRow in
            guard row.kind == .state else { return row }
            var copy = row
            for (metro, state) in pairs { copy.values[metro] = row.values[state] }
            return copy
        }
        let shown = f.filter { enough(filled, $0) }
        let hidden = f.filter { count(filled, $0) == 0 }
        let sparse = f.filter { count(filled, $0) > 0 && !enough(filled, $0) }
        let cols = lead.map { l in shown.contains(l) ? [l] + shown.filter { $0 != l } : shown } ?? shown
        return MarketsColumns(cols: cols, hidden: hidden, sparse: sparse, lead: cols.first, pairs: pairs, rows: filled)
    }

    // MARK: Sorting

    /// The sort: a column the reader picked while it is on screen, else the lead; direction from the catalog's better.
    static func sortOf(_ fields: [String: MarketsField], cols: [String], want: MarketsSort?) -> MarketsSort {
        if let want, let key = want.key, cols.contains(key) { return want }
        guard let key = cols.first else { return MarketsSort(key: nil, ascending: false) }
        return MarketsSort(key: key, ascending: lowerBetter(fields, key))
    }

    /// The next sort after a tap on a column: the same column flips, a new one starts at its better end.
    static func nextSort(_ current: MarketsSort?, key: String, fields: [String: MarketsField]) -> MarketsSort {
        if let current, current.key == key { return MarketsSort(key: key, ascending: !current.ascending) }
        return MarketsSort(key: key, ascending: lowerBetter(fields, key))
    }

    /// Rows by one field, a row with no value last whatever the direction; ties keep their order.
    static func sorted(_ rows: [MarketsRow], by key: String, ascending: Bool) -> [MarketsRow] {
        rows.enumerated().sorted { a, b in
            switch (a.element.values[key], b.element.values[key]) {
            case let (x?, y?) where x != y: return ascending ? x < y : x > y
            case (nil, _?): return false
            case (_?, nil): return true
            default: return a.offset < b.offset
            }
        }.map(\.element)
    }

    static func matches(_ row: MarketsRow, _ query: String) -> Bool {
        let t = query.trimmingCharacters(in: .whitespaces).lowercased()
        if t.isEmpty { return true }
        return row.name.lowercased().contains(t) || row.full.lowercased().contains(t) || (row.kind == .state && row.key.lowercased() == t)
    }

    /// The table: rows ranked by the sort column over the whole level (a row with no value there has no rank and sits
    /// last), then cut to the search.
    static func table(level: MarketsLevel, segment: MarketsSegment?, fields: [String: MarketsField], rows: [MarketsRow],
                      sort want: MarketsSort?, query: String = "", shown: Int = page) -> MarketsTable {
        let c = columns(segment, rows: rows, level: level, fields: fields)
        let sort = sortOf(fields, cols: c.cols, want: want)
        let ordered = sort.key.map { sorted(c.rows, by: $0, ascending: sort.ascending) } ?? c.rows
        var n = 0
        let ranked = ordered.map { row -> MarketsRow in
            var copy = row
            if let key = sort.key, row.values[key] != nil {
                n += 1
                copy.rank = n
            }
            return copy
        }
        let found = ranked.filter { matches($0, query) }
        let q = query.trimmingCharacters(in: .whitespaces)
        return MarketsTable(level: level, segment: segment, cols: c.cols, hidden: c.hidden, sparse: c.sparse, pairs: c.pairs,
                            labels: labels(c.cols, fields, pairs: c.pairs), sort: sort, rows: found, total: found.count,
                            all: ranked.count, shown: min(max(page, shown), found.count), query: q)
    }

    /// "Ranked by gross yield, highest first · 51 states"; with a search "3 of 51 states".
    static func headLine(_ table: MarketsTable, fields: [String: MarketsField]) -> String? {
        guard let key = table.sort.key else { return nil }
        let count: String = table.query.isEmpty ? "\(table.all)" : "\(table.total) of \(table.all)"
        let name: String = NationalWords.lowerFirst(table.labels[key] ?? label(fields, key))
        let direction: String = table.sort.ascending ? "lowest first" : "highest first"
        return "Ranked by \(name), \(direction) \u{00B7} \(count) \(table.level.plural)"
    }

    /// What VoiceOver reads for a sort chip's direction.
    static func directionWords(_ sort: MarketsSort) -> String {
        sort.ascending ? "lowest first" : "highest first"
    }

    // MARK: Row sheet

    static func kindLevel(_ kind: MarketsKind) -> MarketsLevel {
        kind == .metro ? .metros : .states
    }

    /// Every segment for one geography (only the fields that fit it), each field labelled uniquely within its
    /// segment, values formatted, missing ones named once per segment.
    static func sheet(_ spec: MarketsSpec, values: [String: Double], kind: MarketsKind) -> [MarketsSheetSection] {
        spec.segments.compactMap { segment -> MarketsSheetSection? in
            let ids = fieldsOf(segment).filter { fitsLevel(spec.fields, $0, kindLevel(kind)) }
            let names = labels(ids, spec.fields)
            var items: [MarketsSheetItem] = []
            var missing: [String] = []
            for id in ids {
                let label = names[id] ?? id
                if let v = format(spec.fields[id], values[id], id: id) {
                    items.append(MarketsSheetItem(key: id, label: label, value: v))
                } else {
                    missing.append(label)
                }
            }
            if items.isEmpty && missing.isEmpty { return nil }
            return MarketsSheetSection(id: segment.id, label: segment.label, items: items, missing: missing)
        }
    }

    /// The reads behind a row sheet: every segment's fields (no repeats, only those that fit the kind) in chunks the
    /// server takes, cut to the row's state.
    static func sheetQueries(_ spec: MarketsSpec, kind: MarketsKind, key: String, name: String) -> [String] {
        var all: [String] = []
        for segment in spec.segments {
            for f in fieldsOf(segment) where !all.contains(f) && fitsLevel(spec.fields, f, kindLevel(kind)) { all.append(f) }
        }
        let part = kind == .metro ? "metros" : "states"
        let keys = kind == .metro ? ["cbsa", "name"] : ["state", "name"]
        let code = (kind == .metro ? metroParts(name).states.split(separator: "-").first.map(String.init) ?? "" : key).uppercased()
        let state = NationalRoutes.states.contains(code) ? code : nil
        let size = maxKeys - 2
        var out: [String] = []
        var i = 0
        while i < all.count {
            out.append(NationalRoutes.list(part: part, keys: keys + all[i..<min(i + size, all.count)], state: state))
            i += size
        }
        return out.isEmpty ? [NationalRoutes.list(part: part, keys: keys, state: state)] : out
    }

    /// One row from the chunked reads: the matching row of each answer merged.
    static func sheetRow(key: String, answers: [[MarketsRow]]) -> MarketsRow? {
        var merged: MarketsRow?
        for rows in answers {
            guard let row = rows.first(where: { $0.key.uppercased() == key.uppercased() }) else { continue }
            if var m = merged {
                m.values.merge(row.values) { _, new in new }
                merged = m
            } else {
                merged = row
            }
        }
        return merged
    }

    // MARK: Data sheet

    /// Sources of the fields on screen (publisher, period, what they give), the method, and what this build lacks.
    static func data(fields: [String: MarketsField], segment: MarketsSegment?, cols: [String], hidden: [String] = [],
                     sparse: [String] = [], pairs: [String: String] = [:]) -> (sources: [DeckSourceRow], notes: [String]) {
        let names = labels(cols, fields, pairs: pairs)
        var order: [String] = []
        var by: [String: (name: String, asOf: String?, labels: [String])] = [:]
        for id in cols {
            for fid in [id] + [pairs[id]].compactMap({ $0 }) {
                for s in fields[fid]?.sources ?? [] {
                    var entry = by[s.id] ?? (name: s.name ?? (s.id == "derived" ? "Computed in the national build from other fields" : s.id),
                                             asOf: s.asOf, labels: [])
                    if by[s.id] == nil { order.append(s.id) }
                    let l = names[id] ?? id
                    if !entry.labels.contains(l) { entry.labels.append(l) }
                    by[s.id] = entry
                }
            }
        }
        let sources = order.compactMap { id -> DeckSourceRow? in
            guard let e = by[id] else { return nil }
            let gives = e.labels.prefix(3).joined(separator: ", ") + (e.labels.count > 3 ? " and \(e.labels.count - 3) more" : "")
            return DeckSourceRow(id: id, name: e.name, detail: gives, asOf: e.asOf.map { DeckSources.periodWords($0) }, state: .ok, note: nil)
        }
        var notes = [
            "Segments: each segment lists its fields best first. A field this build does not produce is left out, never shown as zero.",
            "Rank: rows rank by the sorted field over the whole list. A row without that value has no rank and sits last. Tap a sort to rank by it; tap it again to flip it.",
            "Your markets: California and the Los Angeles-Long Beach-Anaheim, San Diego and Riverside-San Bernardino metros.",
            "Levels: state rows are the published state figures or the median of the state\u{2019}s ZIPs; metro rows the same for the metro\u{2019}s ZIPs.",
        ]
        if let segment, !segment.skipped.isEmpty {
            let n = segment.skipped.count
            notes.append("Not in this build: \(n) \(n == 1 ? "field" : "fields") of the \(segment.label) spec are not produced yet.")
        }
        if !hidden.isEmpty {
            let l = labels(hidden, fields)
            notes.append("No values here: " + hidden.map { l[$0] ?? $0 }.joined(separator: ", ") + ".")
        }
        if !sparse.isEmpty {
            let l = labels(sparse, fields)
            notes.append("In row sheets only: too few places publish these for a list; open a row to see them: "
                         + sparse.map { l[$0] ?? $0 }.joined(separator: ", ") + ".")
        }
        return (sources, notes)
    }
}
