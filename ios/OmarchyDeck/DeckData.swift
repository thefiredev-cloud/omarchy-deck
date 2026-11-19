import Foundation

/// Provenance lives one tap away, never on the page (owner order 2026-11-14). Every section shows one freshness mark;
/// its Data sheet lists the sources, their dates and states, and the method notes the page used to print under cards.
/// Foundation only, so the Linux harness checks the wording.

/// One source row in the Data sheet.
struct DeckSourceRow: Identifiable, Equatable {
    enum State: String, Equatable {
        case ok, stale, needsKey, blocked, notReporting

        /// Status words from the page blueprint.
        var word: String {
            switch self {
            case .ok: return "OK"
            case .stale: return "Out of date"
            case .needsKey: return "Needs a key"
            case .blocked: return "Blocked"
            case .notReporting: return "Not reporting"
            }
        }

        init(feedStatus: String?) {
            switch feedStatus?.lowercased() {
            case "stale": self = .stale
            case "needs_key", "needs-key": self = .needsKey
            case "refused", "blocked", "paid": self = .blocked
            case "unavailable", "error", "failed", "not_reporting", "missing": self = .notReporting
            default: self = .ok
            }
        }
    }

    let id: String
    let name: String
    /// Who publishes it, or what it gives.
    let detail: String?
    /// The publisher's own period, in plain words: "Nov 14", "Oct 2026", "Q2 2026".
    let asOf: String?
    let state: State
    /// Why a source is not OK, or a short coverage note.
    let note: String?
    /// Named in this run's `errors[]`: it failed now, as opposed to a source the feed reports as long unavailable.
    var failedThisRun = false
}

/// A blended number's parts, for the Data sheet of one detail (a spot, a watch, a category).
struct DeckBlendPart: Identifiable, Equatable {
    var id: String { label + "|" + value }
    let label: String
    let value: String
    /// "weight 0.64" or nil.
    let weight: String?
}

enum DeckSources {
    /// `sources` (strings or objects), the realestate feed's `src` strings, and this run's `errors`, as Data rows.
    /// A source that failed this run reads Not reporting with its reason, never as zero items.
    static func rows(_ json: [String: Any], now: Date = Date()) -> [DeckSourceRow] {
        var out: [DeckSourceRow] = []
        var seen = Set<String>()
        let raw = (json["sources"] as? [Any]) ?? []
        let strings = raw.isEmpty ? ((json["src"] as? [Any]) ?? []) : raw
        for (index, item) in strings.enumerated() {
            if let name = DeckFeedParser.text(item) {
                guard !name.hasPrefix("~/"), !name.hasPrefix("/"), seen.insert(name.lowercased()).inserted else { continue }
                out.append(DeckSourceRow(id: "s\(index)-\(name)", name: name, detail: nil, asOf: nil, state: .ok, note: nil))
            } else if let row = item as? [String: Any] {
                let id = DeckFeedParser.text(row["id"]) ?? "s\(index)"
                let name = DeckFeedParser.text(row["name"]) ?? DeckFeedParser.text(row["publisher"]) ?? id
                guard seen.insert(id.lowercased()).inserted else { continue }
                seen.insert(name.lowercased())
                let state = DeckSourceRow.State(feedStatus: DeckFeedParser.text(row["status"]))
                let detail = DeckFeedParser.text(row["publisher"]).flatMap { $0 == name ? nil : $0 }
                let note = DeckFeedParser.text(row["reason"]) ?? DeckFeedParser.text(row["note"])
                out.append(DeckSourceRow(id: id, name: name, detail: detail,
                                         asOf: period(row["as_of"], now: now), state: state, note: note))
            }
        }
        for (index, error) in DeckFeedParser.rows(json["errors"]).enumerated() {
            let source = DeckFeedParser.text(error["source"]) ?? "A source"
            let reason = DeckFeedParser.text(error["reason"]) ?? DeckFeedParser.text(error["error"])
            if let existing = out.firstIndex(where: { $0.id.lowercased() == source.lowercased() || $0.name.lowercased() == source.lowercased() }) {
                // A row already out of date keeps its state and note; it still failed this run.
                let row = out[existing]
                out[existing] = DeckSourceRow(id: row.id, name: row.name, detail: row.detail, asOf: row.asOf,
                                              state: row.state == .ok ? .notReporting : row.state,
                                              note: row.state == .ok ? (reason ?? row.note) : row.note,
                                              failedThisRun: true)
            } else {
                out.append(DeckSourceRow(id: "e\(index)-\(source)", name: source, detail: nil, asOf: nil,
                                         state: .notReporting, note: reason, failedThisRun: true))
            }
        }
        return out
    }

    /// A publisher period in plain words. Epoch seconds read as "4:10 pm" today and "Nov 14" before.
    static func period(_ value: Any?, now: Date = Date()) -> String? {
        if let epoch = DeckFeedParser.number(value) {
            let date = Date(timeIntervalSince1970: epoch)
            if now.timeIntervalSince(date) < 20 * 3600 && now.timeIntervalSince(date) >= -3600 {
                return DeckFormat.time(date)
            }
            return DeckFormat.date(date)
        }
        guard let text = DeckFeedParser.text(value) else { return nil }
        return periodWords(text)
    }

    private static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    /// "2026-Q2" -> "Q2 2026", "2026-10" -> "Oct 2026", "2026-11-14..." -> "Nov 14", anything else as it came.
    static func periodWords(_ text: String) -> String {
        let parts = text.prefix(10).split(separator: "-").map(String.init)
        if parts.count == 2, parts[1].hasPrefix("Q") { return "\(parts[1]) \(parts[0])" }
        if parts.count == 2, let m = Int(parts[1]), (1...12).contains(m), parts[0].count == 4 { return "\(months[m - 1]) \(parts[0])" }
        if parts.count == 3, let m = Int(parts[1]), let d = Int(parts[2]), (1...12).contains(m), parts[0].count == 4 {
            return "\(months[m - 1]) \(d)"
        }
        return text
    }
}

/// The one freshness mark per section: an age, or a status when something is stale, missing or not built yet.
struct DeckFreshness: Equatable {
    enum Kind: Equatable { case fresh, stale, missing, building }
    let kind: Kind
    let text: String

    /// `missing` counts the parts the deck could not give: whole feeds that failed, and the sources that failed this
    /// run (`DeckSectionData.failedParts`). `building` counts whole feeds not collected yet: the card under the mark
    /// says "No data yet", so the mark says "Building", never "Not reporting" (only a failure says that). Nil while
    /// nothing has answered yet. The age is the oldest of the feeds that date data (`DeckSectionData.dates`): a section
    /// is only as fresh as its oldest part, and a per-request stamp (the budget's `t`) never makes hours-old data new.
    static func mark(pages: [DeckFeedPage], missing: Int, building: Int = 0, now: Date = Date()) -> DeckFreshness? {
        if pages.isEmpty {
            if missing > 0 { return DeckFreshness(kind: .missing, text: "Not reporting") }
            if building > 0 { return DeckFreshness(kind: .building, text: "Building") }
            return nil
        }
        if missing > 0 {
            return DeckFreshness(kind: .missing, text: missing == 1 ? "1 part not reporting" : "\(missing) parts not reporting")
        }
        let oldest = pages.filter { DeckSectionData.dates($0.feed) }.compactMap(\.updated).min()
        let age = oldest.map { short(now.timeIntervalSince($0)) }
        if pages.contains(where: { $0.stale }) {
            return DeckFreshness(kind: .stale, text: "Out of date" + (age.map { " · " + $0 } ?? ""))
        }
        return DeckFreshness(kind: .fresh, text: age ?? "Time unknown")
    }

    /// The web's age words (`DeckFormat.age`): "5 min" (never under 1), "3 h" under 48 hours, "2 days". A clock
    /// ahead of the feed reads as new.
    static func short(_ seconds: TimeInterval) -> String {
        if seconds == .infinity { return "0 days" }
        return DeckFormat.age(max(0, seconds)) ?? "1 min"
    }
}

/// What one section's mark and Data sheet read from its loaded pages. Housing and Commercial share the `realestate`
/// feed and the budget, so each takes only its own part of them.
enum DeckSectionData {
    /// Feeds whose answer is stamped when the deck answers, not when the data was built: the budget (`t` is now on
    /// every answer) and the national sources list (the summary carries the build's age). They never date a section.
    static func dates(_ feed: String) -> Bool {
        feed != "housing-profile" && feed != NationalRoutes.sources
    }

    /// The section's own sources and notes. Housing: the market feed's sources and its housing notes. Commercial: the
    /// desk's sources and notes plus the national CRE series lines of the market feed, never the 55+ list or the
    /// market-row dates. Every other section: all of its pages.
    static func sheet(_ section: DeckFeedSection, pages: [DeckFeedPage]) -> (sources: [DeckSourceRow], notes: [String]) {
        var sources: [DeckSourceRow] = []
        var notes: [String] = []
        var seen = Set<String>()
        for page in pages {
            var pageSources = page.sources
            var pageNotes = page.notes
            if section == .commercial, page.feed == "realestate" {
                pageSources = []
                pageNotes = page.housing.map(DeckHousingParser.commercialNotes) ?? []
            }
            sources += pageSources.filter { seen.insert($0.id + "|" + $0.name).inserted }
            notes += pageNotes
        }
        return (sources, notes)
    }

    /// Sources in the section's own Data sheet that failed this run: each is a part not reporting, so one blocked store
    /// turns the mark into a status instead of reading as a fresh section.
    static func failedParts(_ section: DeckFeedSection, pages: [DeckFeedPage]) -> Int {
        sheet(section, pages: pages).sources.filter(\.failedThisRun).count
    }
}
