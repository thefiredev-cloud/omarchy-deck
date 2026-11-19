import Foundation

/// Surf (2026-11-14): Cabo San Lucas to the Columbia River, read from `GET /api/surf-coast` (overview) and
/// `GET /api/surf-coast/region/<id>` (one region's hourly series, tide curves and blend parts). Contract: SurfFeed.md v1.
/// Foundation only, so the Linux harness checks the parsing and the words. A missing value stays nil and is never
/// drawn as zero. Model-only spots are marked as forecasts and never dressed up as buoy readings.

enum SurfRegions {
    /// South to north.
    static let ids = ["baja-sur", "baja-norte", "san-diego", "orange-county", "los-angeles", "ventura", "santa-barbara",
                      "san-luis-obispo", "monterey-santa-cruz", "san-francisco-marin", "sonoma-del-norte",
                      "oregon-south", "oregon-central", "oregon-north"]

    private static let names = ["baja-sur": "Baja Sur", "baja-norte": "Baja Norte", "san-diego": "San Diego",
                                "orange-county": "Orange County", "los-angeles": "Los Angeles", "ventura": "Ventura",
                                "santa-barbara": "Santa Barbara", "san-luis-obispo": "San Luis Obispo",
                                "monterey-santa-cruz": "Monterey and Santa Cruz",
                                "san-francisco-marin": "San Francisco and Marin", "sonoma-del-norte": "Sonoma to Del Norte",
                                "oregon-south": "Oregon South", "oregon-central": "Oregon Central",
                                "oregon-north": "Oregon North"]

    static func name(_ id: String) -> String { names[id] ?? DeckFeedParser.label(id) }

    static func isMexico(_ id: String) -> Bool { id.hasPrefix("baja") }

    static let feedPrefix = "surf-coast/region/"

    static func feed(_ id: String) -> String { feedPrefix + id }

    /// The region id of a detail feed name, only when it is one of the 14 fixed ids.
    static func id(fromFeed feed: String) -> String? {
        guard feed.hasPrefix(feedPrefix) else { return nil }
        let id = String(feed.dropFirst(feedPrefix.count))
        return ids.contains(id) ? id : nil
    }

    /// The default spot list: the owner's home region.
    static let home = "orange-county"
}

/// Blended-number confidence: the meter fills one segment per step (`dots`).
struct DeckConfidence: Equatable {
    /// 0 to 1.
    let score: Double?
    let label: String?

    /// 3 high (0.75 or more), 2 medium (0.5 to 0.75), 1 low.
    var dots: Int {
        if let score { return score >= 0.75 ? 3 : (score >= 0.5 ? 2 : 1) }
        switch label?.lowercased() {
        case "high": return 3
        case "medium": return 2
        default: return 1
        }
    }

    var spoken: String {
        switch dots {
        case 3: return "High confidence"
        case 2: return "Medium confidence"
        default: return "Low confidence"
        }
    }

    static let low = DeckConfidence(score: 0.2, label: "low")

    init(score: Double?, label: String?) {
        self.score = score
        self.label = label
    }

    init?(_ value: Any?) {
        guard let row = value as? [String: Any] else { return nil }
        let score = DeckFeedParser.number(row["score"])
        let label = DeckFeedParser.text(row["level"]) ?? DeckFeedParser.text(row["label"])
        guard score != nil || label != nil else { return nil }
        self.init(score: score, label: label)
    }
}

struct SurfRating: Equatable {
    /// 0 to 10.
    let score: Double?
    let word: String?

    /// Flat, Poor, Fair, Good, Great as one to five pips. No hue: the word carries the state.
    var pips: Int {
        switch word?.lowercased() {
        case "flat": return 1
        case "poor": return 2
        case "fair": return 3
        case "good": return 4
        case "great": return 5
        default:
            guard let score else { return 0 }
            return min(5, max(1, DeckFeedParser.whole((score / 2).rounded(.up))))
        }
    }

    var text: String { word ?? (score.map { "\(DeckFeedParser.whole($0.rounded())) of 10" } ?? "No rating") }

    var isGoodOrBetter: Bool { pips >= 4 }
}

struct SurfSwellPart: Equatable, Identifiable {
    var id: String { part }
    let part: String
    let ft: Double?
    let periodS: Double?
    let dir: String?

    var title: String {
        switch part {
        case "primary": return "Primary swell"
        case "secondary": return "Secondary swell"
        case "wind": return "Wind chop"
        default: return DeckFeedParser.label(part)
        }
    }
}

struct SurfWind: Equatable {
    let kt: Double?
    let gustKt: Double?
    let dir: String?
    /// offshore, cross-shore, onshore.
    let quality: String?
    /// "light offshore", "calm".
    let word: String?
}

struct SurfTideNext: Equatable, Identifiable {
    var id: String { (type ?? "") + (label ?? "") + (at.map { "\($0.timeIntervalSince1970)" } ?? "") }
    /// H or L.
    let type: String?
    let at: Date?
    let ft: Double?
    let label: String?
}

struct SurfBest: Equatable {
    let spotName: String?
    let label: String?
    /// today or tomorrow.
    let day: String?
    let rating: Double?
    let reason: String?
}

struct SurfHalfDay: Equatable {
    let waveFt: [Double]
    let periodS: Double?
    let windKt: Double?
    let wind: String?
    let rating: SurfRating
}

struct SurfDay: Equatable, Identifiable {
    var id: String { date }
    let date: String
    let label: String
    let am: SurfHalfDay?
    let pm: SurfHalfDay?
}

struct SurfBuoyRef: Equatable {
    let id: String
    let name: String
    let km: Double?
}

struct SurfSpot: Equatable, Identifiable {
    let id: String
    let name: String
    let region: String
    let sub: String?
    let lat: Double?
    let lon: Double?
    let facing: String?
    /// 1 to 7 for the owner's home spots, in owner order.
    let pinned: Int?
    let tz: String?
    let waveFt: [Double]
    let hsFt: Double?
    let periodS: Double?
    let dir: String?
    let swell: [SurfSwellPart]
    let wind: SurfWind?
    let waterF: Double?
    let waterSpread: Double?
    let waterReadings: Int?
    let tideState: String?
    let tideNext: SurfTideNext?
    let rating: SurfRating
    let reason: String?
    let confidence: DeckConfidence?
    let modelOnly: Bool
    let days: [SurfDay]
    let best: SurfBest?
    let buoy: SurfBuoyRef?
    let tideStation: String?
    let gaps: [String]
    /// Region file only.
    var hours: SurfHours?
    var parts: [DeckBlendPart] = []
    var waterParts: [DeckBlendPart] = []
    /// Region file only: first light, sunrise, sunset, last light, as local labels.
    var sun: [(label: String, time: String)] = []

    static func == (a: SurfSpot, b: SurfSpot) -> Bool {
        a.id == b.id && a.rating == b.rating && a.waveFt == b.waveFt && a.hsFt == b.hsFt && a.days == b.days
            && a.hours == b.hours && a.parts == b.parts && a.waterParts == b.waterParts && a.modelOnly == b.modelOnly
            && a.sun.map(\.time) == b.sun.map(\.time)
    }
}

struct SurfHours: Equatable {
    let start: Date
    let step: TimeInterval
    let hsFt: [Double?]
    let rating: [Double?]
    let tideFt: [Double?]
}

struct SurfRegion: Equatable, Identifiable {
    let id: String
    let name: String
    let order: Int
    let latMin: Double?
    let latMax: Double?
    let rating: SurfRating
    let waveFt: [Double]
    let hsFt: Double?
    let swellFt: Double?
    let swellPeriodS: Double?
    let swellDir: String?
    let wind: SurfWind?
    let waterF: Double?
    let waterMin: Double?
    let waterMax: Double?
    let best: SurfBest?
    let line: String?
    let spotCount: Int?
    /// great, good, fair, poor, flat.
    let counts: [String: Int]
    let alerts: Int
    let confidence: DeckConfidence?
    let gaps: [String]
    let tideNext: SurfTideNext?
}

struct SurfBuoy: Equatable, Identifiable {
    let id: String
    let name: String
    let region: String?
    let lat: Double?
    let at: Date?
    let ageMin: Double?
    let waveFt: Double?
    let periodS: Double?
    let dir: String?
    let waterF: Double?
    let windKt: Double?
    let windDir: String?
    let nearestSpot: String?
    let nearestKm: Double?
}

struct SurfWaterPoint: Equatable, Identifiable {
    var id: String { "\(lat)|\(f)|\(name ?? "")" }
    let lat: Double
    let f: Double
    let kind: String
    let name: String?
    let region: String?
}

struct SurfWaterBin: Equatable, Identifiable {
    var id: Double { lat }
    let lat: Double
    let f: Double
    let n: Int?
}

struct SurfTideStation: Equatable, Identifiable {
    let id: String
    let name: String
    /// prediction or model.
    let kind: String
    let state: String?
    let regions: [String]
    let next: [SurfTideNext]
    /// Region file only: hourly heights for 48 h.
    var curve: [(at: Date, ft: Double)] = []

    static func == (a: SurfTideStation, b: SurfTideStation) -> Bool {
        a.id == b.id && a.kind == b.kind && a.next == b.next && a.curve.map(\.at) == b.curve.map(\.at)
            && a.curve.map(\.ft) == b.curve.map(\.ft)
    }
}

struct SurfAlert: Equatable, Identifiable {
    let id: String
    let event: String
    let severity: String?
    let text: String?
    let regions: [String]
    let untilLabel: String?
}

struct SurfOverview: Equatable {
    let regions: [SurfRegion]
    /// Pinned first in owner order, then south to north, as the feed sends them.
    let spots: [SurfSpot]
    let buoys: [SurfBuoy]
    let water: [SurfWaterPoint]
    let bins: [SurfWaterBin]
    let tides: [SurfTideStation]
    let alerts: [SurfAlert]
    let gaps: [String]
    let notes: [String]

    var pinned: [SurfSpot] {
        spots.filter { $0.pinned != nil }.sorted { ($0.pinned ?? 0) < ($1.pinned ?? 0) }
    }

    /// Top five coast-wide by rating, then size.
    var bestNow: [SurfSpot] {
        Array(spots.filter { $0.rating.score != nil }.sorted { a, b in
            let ra = a.rating.score ?? 0, rb = b.rating.score ?? 0
            if ra != rb { return ra > rb }
            return (a.hsFt ?? 0) > (b.hsFt ?? 0)
        }.prefix(5))
    }

    func spots(in region: String) -> [SurfSpot] { spots.filter { $0.region == region } }

    func region(_ id: String) -> SurfRegion? { regions.first { $0.id == id } }

    /// A region where every spot is model-only.
    func isModelOnly(_ region: String) -> Bool {
        let list = spots(in: region)
        return !list.isEmpty && list.allSatisfy(\.modelOnly)
    }

    /// Buoys south to north, reporting stations only.
    var buoysSouthToNorth: [SurfBuoy] {
        buoys.sorted { ($0.lat ?? 0) < ($1.lat ?? 0) }
    }

    /// The regions your spots are in.
    var homeRegions: Set<String> { Set(pinned.map(\.region)) }

    var alertPlan: SurfAlertPlan { SurfAlertPlan(alerts: alerts, homeRegions: homeRegions) }
}

/// Where Surf puts its alerts (Main's rule 2026-11-14, the same on the web). Above Your spots: only alerts whose regions
/// include a region of your spots, most severe first, at most two rows, then "+N more". Every other alert is one quiet
/// line after Your spots. Both open the full list: your regions first, each group most severe first.
struct SurfAlertPlan: Equatable {
    static let topLimit = 2

    /// At most two home-region alerts, most severe first.
    let top: [SurfAlert]
    /// Home-region alerts beyond the two rows ("+N more").
    let moreHome: Int
    /// Alerts outside your regions ("N more alerts along the coast").
    let elsewhere: Int
    /// Every alert for the full list.
    let all: [SurfAlert]

    init(alerts: [SurfAlert], homeRegions: Set<String>) {
        let home = Self.bySeverity(alerts.filter { !homeRegions.isDisjoint(with: $0.regions) })
        let away = Self.bySeverity(alerts.filter { homeRegions.isDisjoint(with: $0.regions) })
        top = Array(home.prefix(Self.topLimit))
        moreHome = max(0, home.count - Self.topLimit)
        elsewhere = away.count
        all = home + away
    }

    /// NWS severity, worst first; unknown last. Equal severities keep the feed's order.
    static func rank(_ severity: String?) -> Int {
        switch severity?.lowercased() {
        case "extreme": return 0
        case "severe": return 1
        case "moderate": return 2
        case "minor": return 3
        default: return 4
        }
    }

    private static func bySeverity(_ alerts: [SurfAlert]) -> [SurfAlert] {
        alerts.enumerated().sorted { a, b in
            let ra = rank(a.element.severity), rb = rank(b.element.severity)
            return ra != rb ? ra < rb : a.offset < b.offset
        }.map(\.element)
    }

    /// "+2 more" under the home rows.
    var moreHomeLine: String? { moreHome > 0 ? "+\(moreHome) more" : nil }

    /// "20 more alerts along the coast" after Your spots.
    var elsewhereLine: String? {
        switch elsewhere {
        case 0: return nil
        case 1: return "1 more alert along the coast"
        default: return "\(elsewhere) more alerts along the coast"
        }
    }
}

struct SurfRegionDetail: Equatable {
    let region: SurfRegion?
    let spots: [SurfSpot]
    let tides: [SurfTideStation]
    let buoys: [SurfBuoy]
    let alerts: [SurfAlert]
}

enum SurfSort: String, CaseIterable, Identifiable {
    case rating, height, northToSouth
    var id: String { rawValue }
    var title: String {
        switch self {
        case .rating: return "Rating"
        case .height: return "Height"
        case .northToSouth: return "North to south"
        }
    }

    func apply(_ spots: [SurfSpot]) -> [SurfSpot] {
        switch self {
        case .rating: return spots.sorted { ($0.rating.score ?? -1) > ($1.rating.score ?? -1) }
        case .height: return spots.sorted { ($0.hsFt ?? -1) > ($1.hsFt ?? -1) }
        case .northToSouth: return spots.sorted { ($0.lat ?? 0) > ($1.lat ?? 0) }
        }
    }
}

// MARK: Words

enum SurfWords {
    /// [4, 6] -> "4-6 ft", [5, 5] -> "5 ft". Nil when the feed had no height.
    static func height(_ range: [Double]) -> String? {
        guard let lo = range.first else { return nil }
        let hi = range.count > 1 ? range[1] : lo
        let a = DeckFeedParser.whole(lo.rounded()), b = DeckFeedParser.whole(hi.rounded())
        return a == b ? "\(a) ft" : "\(a)-\(b) ft"
    }

    static func feet(_ value: Double?) -> String? {
        value.map { String(format: "%.1f ft", $0) }
    }

    /// "14 s", or "about 14 s" for a model's mean period.
    static func period(_ seconds: Double?, model: Bool) -> String? {
        guard let seconds else { return nil }
        let s = "\(DeckFeedParser.whole(seconds.rounded())) s"
        return model ? "about " + s : s
    }

    static func water(_ f: Double?) -> String? {
        f.map { "\(DeckFeedParser.whole($0.rounded()))°F" }
    }

    static func waterRange(_ lo: Double?, _ hi: Double?) -> String? {
        guard let lo, let hi else { return nil }
        let a = DeckFeedParser.whole(lo.rounded()), b = DeckFeedParser.whole(hi.rounded())
        return a == b ? "\(a)°F" : "\(a)-\(b)°F"
    }

    /// "8 kt NW".
    static func wind(_ wind: SurfWind?) -> String? {
        guard let wind, let kt = wind.kt else { return nil }
        return "\(DeckFeedParser.whole(kt.rounded())) kt" + (wind.dir.map { " " + $0 } ?? "")
    }

    /// "Light offshore", "Glassy" for calm, else the quality word.
    static func windWord(_ wind: SurfWind?) -> String? {
        guard let wind else { return nil }
        if let word = wind.word {
            return word.lowercased() == "calm" ? "Glassy" : DeckFeedParser.capitalized(word)
        }
        return wind.quality.map { DeckFeedParser.capitalized($0) }
    }

    /// "Today 7-9 am", "Tomorrow 7-9 am".
    static func best(_ best: SurfBest?) -> String? {
        guard let best, let label = best.label else { return nil }
        switch best.day?.lowercased() {
        case "tomorrow": return "Tomorrow \(label)"
        case "today": return "Today \(label)"
        default: return label
        }
    }

    /// "Mon morning 3-4 ft Fair, afternoon 4-5 ft Good". The outlook chart draws a bar for each half day, so VoiceOver
    /// names both. A half with no reading is left out; a day with neither reads as no data.
    static func outlookDay(_ day: SurfDay) -> String {
        let halves = [("morning", day.am), ("afternoon", day.pm)].compactMap { name, half -> String? in
            guard let half, let size = height(half.waveFt) else { return nil }
            return "\(name) \(size) \(half.rating.text)"
        }
        return "\(day.label) " + (halves.isEmpty ? DeckMissing.sheet : halves.joined(separator: ", "))
    }

    /// "Tide for the next 48 hours: high 2:10 pm, low 8:02 pm". A tide with no type is named by its time alone, never
    /// guessed low; with no times at all the label says so instead of ending on a colon.
    static func tideChart(_ next: [SurfTideNext]) -> String {
        let parts = next.prefix(4).compactMap { tide -> String? in
            guard let label = tide.label else { return nil }
            switch tide.type {
            case "H": return "high \(label)"
            case "L": return "low \(label)"
            default: return label
            }
        }
        return "Tide for the next 48 hours: " + (parts.isEmpty ? "no high or low times" : parts.joined(separator: ", "))
    }

    /// "Next high tide 2:10 pm".
    static func tide(_ next: SurfTideNext?) -> String? {
        guard let next, let label = next.label else { return nil }
        let kind = next.type == "H" ? "high" : (next.type == "L" ? "low" : nil)
        return kind.map { "Next \($0) tide \(label)" } ?? "Next tide \(label)"
    }

    /// "High surf advisory · San Diego · until Sat 6 pm". Baja gets offshore seas warnings only, worded so.
    static func alert(_ alert: SurfAlert) -> String {
        let bajaOnly = !alert.regions.isEmpty && alert.regions.allSatisfy(SurfRegions.isMexico)
        let event = bajaOnly ? "Offshore seas" : DeckFeedParser.capitalized(alert.event.lowercased())
        let place: String?
        switch alert.regions.count {
        case 0: place = nil
        case 1: place = SurfRegions.name(alert.regions[0])
        case 2: place = SurfRegions.name(alert.regions[0]) + " and " + SurfRegions.name(alert.regions[1])
        default: place = SurfRegions.name(alert.regions[0]) + " and \(alert.regions.count - 1) more"
        }
        return [event, place, alert.untilLabel.map { "until " + $0 }].compactMap { $0 }.joined(separator: " · ")
    }

    /// "4 good · 6 fair".
    static func counts(_ counts: [String: Int]) -> String? {
        let order = ["great", "good", "fair", "poor", "flat"]
        let parts = order.compactMap { key -> String? in
            guard let n = counts[key], n > 0 else { return nil }
            return "\(n) \(key)"
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    static let modelLine = "Forecast only. No buoy nearby."
    static let modelRegionLine = "Forecast only. No buoys in this region."
    static let noBuoysSouth = "No public buoys south of San Diego."
    static let approximateTide = "Approximate tide. No tide table here."
    static let noTide = "No tide table for this spot."
    static let noReading = "No wave reading here right now."
}

// MARK: Parser

enum DeckSurfParser {
    private typealias P = DeckFeedParser

    static func overview(_ json: [String: Any], now: Date = Date()) -> SurfOverview {
        let regions = P.rows(json["regions"]).compactMap(regionRow).sorted { $0.order < $1.order }
        let spots = P.rows(json["spots"]).compactMap(spot)
        let water = json["water"] as? [String: Any] ?? [:]
        let gaps = (json["gaps"] as? [Any] ?? []).compactMap(P.text)
        var notes = gaps
        if let coverage = json["coverage"] as? [String: Any] {
            func n(_ key: String) -> String { RealEstateWords.count(P.number(coverage[key])) }
            notes.append("\(n("spots")) spots, \(n("spots_with_data")) with data, \(n("spots_buoy_50km")) within 50 km of a wave buoy, "
                         + "\(n("spots_model_only")) from models only.")
            notes.append("\(n("stations_reporting")) stations reporting, \(n("buoys_waves")) with waves, "
                         + "\(n("water_rows")) water readings, \(n("alerts")) alerts.")
        }
        notes.append("Ratings run 0 to 10: size 0 to 4, period 0 to 2, wind 0 to 3, tide 0 to 1, capped at 4 in strong onshore wind.")
        notes.append("Wave heights are a blend of the nearest buoy, a nearshore model and a global wave model. Buoy rows are raw readings.")
        return SurfOverview(
            regions: regions,
            spots: spots,
            buoys: P.rows(json["buoys"]).compactMap(buoy),
            water: P.rows(water["rows"]).compactMap { row in
                guard let lat = P.number(row["lat"]), let f = P.number(row["f"]) else { return nil }
                return SurfWaterPoint(lat: lat, f: f, kind: P.text(row["kind"]) ?? "reading", name: P.text(row["name"]),
                                      region: P.text(row["region"]))
            },
            bins: P.rows(water["bins"]).compactMap { row in
                guard let lat = P.number(row["lat"]), let f = P.number(row["f"]) else { return nil }
                return SurfWaterBin(lat: lat, f: f, n: P.number(row["n"]).map { P.whole($0) })
            }.sorted { $0.lat < $1.lat },
            tides: P.rows(json["tides"]).compactMap(tideStation),
            alerts: P.rows(json["alerts"]).compactMap(alert),
            gaps: gaps,
            notes: notes)
    }

    static func region(_ json: [String: Any], now: Date = Date()) -> SurfRegionDetail {
        SurfRegionDetail(region: (json["region"] as? [String: Any]).flatMap(regionRow),
                         spots: P.rows(json["spots"]).compactMap(spot),
                         tides: P.rows(json["tides"]).compactMap(tideStation),
                         buoys: P.rows(json["buoys"]).compactMap(buoy),
                         alerts: P.rows(json["alerts"]).compactMap(alert))
    }

    // MARK: Rows

    private static func range(_ value: Any?) -> [Double] {
        (value as? [Any] ?? []).compactMap(P.number).prefix(2).map { $0 }
    }

    private static func wind(_ value: Any?) -> SurfWind? {
        guard let row = value as? [String: Any] else { return nil }
        return SurfWind(kt: P.number(row["kt"]), gustKt: P.number(row["gust_kt"]), dir: P.text(row["dir"]),
                        quality: P.text(row["quality"]), word: P.text(row["word"]))
    }

    private static func tideNext(_ value: Any?) -> SurfTideNext? {
        guard let row = value as? [String: Any] else { return nil }
        return SurfTideNext(type: P.text(row["type"]), at: P.number(row["at"]).map { Date(timeIntervalSince1970: $0) },
                            ft: P.number(row["ft"]), label: P.text(row["label"]))
    }

    private static func best(_ value: Any?) -> SurfBest? {
        guard let row = value as? [String: Any] else { return nil }
        return SurfBest(spotName: P.text(row["name"]), label: P.text(row["label"]), day: P.text(row["day"]),
                        rating: P.number(row["rating"]), reason: P.text(row["reason"]))
    }

    private static func rating(_ row: [String: Any]) -> SurfRating {
        SurfRating(score: P.number(row["rating"]), word: P.text(row["word"]))
    }

    private static func regionRow(_ row: [String: Any]) -> SurfRegion? {
        guard let id = P.text(row["id"]) else { return nil }
        let swell = row["swell"] as? [String: Any]
        let water = row["water_f"] as? [String: Any]
        let tide = row["tide"] as? [String: Any]
        var counts: [String: Int] = [:]
        for (key, value) in row["counts"] as? [String: Any] ?? [:] {
            if let n = P.number(value) { counts[key] = P.whole(n) }
        }
        return SurfRegion(id: id, name: P.text(row["name"]) ?? SurfRegions.name(id),
                          order: P.number(row["order"]).map { P.whole($0) } ?? (SurfRegions.ids.firstIndex(of: id) ?? 99) + 1,
                          latMin: P.number(row["lat_min"]), latMax: P.number(row["lat_max"]),
                          rating: rating(row), waveFt: range(row["wave_ft"]), hsFt: P.number(row["hs_ft"]),
                          swellFt: swell.flatMap { P.number($0["ft"]) }, swellPeriodS: swell.flatMap { P.number($0["period_s"]) },
                          swellDir: swell.flatMap { P.text($0["dir"]) }, wind: wind(row["wind"]),
                          waterF: water.flatMap { P.number($0["value"]) }, waterMin: water.flatMap { P.number($0["min"]) },
                          waterMax: water.flatMap { P.number($0["max"]) },
                          best: best(row["best"]), line: P.text(row["line"]),
                          spotCount: P.number(row["spots"]).map { P.whole($0) }, counts: counts,
                          alerts: P.number(row["alerts"]).map { P.whole($0) } ?? 0,
                          confidence: DeckConfidence(row["confidence"]),
                          gaps: (row["gaps"] as? [Any] ?? []).compactMap(P.text),
                          tideNext: tide.flatMap { tideNext($0["next"]) })
    }

    private static func half(_ value: Any?) -> SurfHalfDay? {
        guard let row = value as? [String: Any] else { return nil }
        return SurfHalfDay(waveFt: range(row["wave_ft"]), periodS: P.number(row["period_s"]), windKt: P.number(row["wind_kt"]),
                           wind: P.text(row["wind"]), rating: rating(row))
    }

    static func spot(_ row: [String: Any]) -> SurfSpot? {
        guard let id = P.text(row["id"]), let name = P.text(row["name"]) else { return nil }
        let now = row["now"] as? [String: Any] ?? [:]
        let water = now["water_f"] as? [String: Any]
        let tide = now["tide"] as? [String: Any]
        let confidence = DeckConfidence(now["confidence"])
        let modelOnly = ((now["confidence"] as? [String: Any])?["model_only"] as? Bool) ?? false
        let buoy = (row["buoy"] as? [String: Any]).flatMap { b -> SurfBuoyRef? in
            guard let id = P.text(b["id"]) else { return nil }
            return SurfBuoyRef(id: id, name: P.text(b["name"]) ?? id, km: P.number(b["km"]))
        }
        var spot = SurfSpot(
            id: id, name: name, region: P.text(row["region"]) ?? "", sub: P.text(row["sub"]),
            lat: P.number(row["lat"]), lon: P.number(row["lon"]), facing: P.text(row["facing"]),
            pinned: P.number(row["pinned"]).map { P.whole($0) }, tz: P.text(row["tz"]),
            waveFt: range(now["wave_ft"]), hsFt: P.number(now["hs_ft"]), periodS: P.number(now["period_s"]),
            dir: P.text(now["dir"]),
            swell: P.rows(now["swell"]).compactMap { part in
                guard let kind = P.text(part["part"]) else { return nil }
                return SurfSwellPart(part: kind, ft: P.number(part["ft"]), periodS: P.number(part["period_s"]), dir: P.text(part["dir"]))
            },
            wind: wind(now["wind"]),
            waterF: water.flatMap { P.number($0["value"]) }, waterSpread: water.flatMap { P.number($0["spread"]) },
            waterReadings: water.flatMap { P.number($0["n"]) }.map { P.whole($0) },
            tideState: tide.flatMap { P.text($0["state"]) }, tideNext: tide.flatMap { tideNext($0["next"]) },
            rating: rating(now), reason: P.text(now["reason"]),
            confidence: modelOnly ? .low : confidence, modelOnly: modelOnly,
            days: P.rows(row["days"]).compactMap { day in
                guard let date = P.text(day["date"]) else { return nil }
                return SurfDay(date: date, label: P.text(day["label"]) ?? date, am: half(day["am"]), pm: half(day["pm"]))
            },
            best: best(row["best"]), buoy: modelOnly ? nil : buoy, tideStation: P.text(row["tide_station"]),
            gaps: (row["gaps"] as? [Any] ?? []).compactMap(P.text))
        if let hours = row["hours"] as? [String: Any], let start = P.number(hours["start"]) {
            func series(_ key: String) -> [Double?] { (hours[key] as? [Any] ?? []).map { P.number($0) } }
            spot.hours = SurfHours(start: Date(timeIntervalSince1970: start), step: P.number(hours["step"]) ?? 3600,
                                   hsFt: series("hs_ft"), rating: series("rating"), tideFt: series("tide_ft"))
        }
        if let sun = row["sun"] as? [String: Any] {
            spot.sun = [("first_light", "First light"), ("sunrise", "Sunrise"), ("sunset", "Sunset"), ("last_light", "Last light")]
                .compactMap { key, label in
                    (sun[key] as? [String: Any]).flatMap { P.text($0["label"]) }.map { (label, $0) }
                }
        }
        if let parts = row["parts"] as? [String: Any] {
            spot.parts = P.rows(parts["hs"]).compactMap { part in
                guard let kind = P.text(part["kind"]), let ft = P.number(part["ft"]) else { return nil }
                let label = [DeckFeedParser.capitalized(kind), P.number(part["km"]).map { "\(P.whole($0.rounded())) km" }]
                    .compactMap { $0 }.joined(separator: ", ")
                return DeckBlendPart(label: label, value: String(format: "%.1f ft", ft),
                                     weight: P.number(part["weight"]).map { String(format: "weight %.2f", $0) })
            }
            spot.waterParts = P.rows(parts["water"]).compactMap { part in
                guard let kind = P.text(part["kind"]), let f = P.number(part["f"]) else { return nil }
                return DeckBlendPart(label: DeckFeedParser.capitalized(kind), value: String(format: "%.1f°F", f), weight: nil)
            }
        }
        return spot
    }

    private static func buoy(_ row: [String: Any]) -> SurfBuoy? {
        guard let id = P.text(row["id"]) else { return nil }
        let wind = row["wind"] as? [String: Any]
        let near = row["nearest_spot"] as? [String: Any]
        return SurfBuoy(id: id, name: P.text(row["name"]) ?? id, region: P.text(row["region"]), lat: P.number(row["lat"]),
                        at: P.number(row["at"]).map { Date(timeIntervalSince1970: $0) }, ageMin: P.number(row["age_min"]),
                        waveFt: P.number(row["wave_ft"]), periodS: P.number(row["dpd_s"]),
                        dir: P.text(row["mwd"]), waterF: P.number(row["water_f"]),
                        windKt: wind.flatMap { P.number($0["kt"]) }, windDir: wind.flatMap { P.text($0["dir"]) },
                        nearestSpot: near.flatMap { P.text($0["name"]) }, nearestKm: near.flatMap { P.number($0["km"]) })
    }

    private static func tideStation(_ row: [String: Any]) -> SurfTideStation? {
        guard let id = P.text(row["id"]) else { return nil }
        var station = SurfTideStation(id: id, name: P.text(row["name"]) ?? id, kind: P.text(row["kind"]) ?? "prediction",
                                      state: P.text(row["state"]),
                                      regions: (row["regions"] as? [Any] ?? []).compactMap(P.text),
                                      next: P.rows(row["next"]).compactMap { tideNext($0) })
        if let curve = row["curve"] as? [String: Any], let start = P.number(curve["start"]) {
            let step = P.number(curve["step"]) ?? 3600
            station.curve = (curve["ft"] as? [Any] ?? []).enumerated().compactMap { index, value in
                P.number(value).map { (Date(timeIntervalSince1970: start + Double(index) * step), $0) }
            }
        }
        return station
    }

    private static func alert(_ row: [String: Any]) -> SurfAlert? {
        guard let event = P.text(row["event"]) else { return nil }
        return SurfAlert(id: P.text(row["id"]) ?? event, event: event, severity: P.text(row["severity"]), text: P.text(row["text"]),
                         regions: (row["regions"] as? [Any] ?? []).compactMap(P.text), untilLabel: P.text(row["until_label"]))
    }
}
