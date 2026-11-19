import Foundation

/// One form per value (round "Better", PlanDesign section 5): the strings the web deck's `DeckFmt` prints, so a figure
/// reads the same in the app and on the page behind it. `Shared/Fixtures/formats.json` is a byte copy of the web's
/// `tests/fixtures/formats.json`; `DeckFormatsFixtureTests` runs every case through these functions. Foundation only, so
/// the Linux harness checks them.

/// The one word for a value the feed did not carry. Never "--", "n/a", "Unknown" or zero.
enum DeckMissing {
    /// A row or table cell: a muted dot. Its spoken name is `sheet`.
    static let cell = "\u{00B7}"
    /// A sheet line, a figure standing alone, and the spoken name of `cell`.
    static let sheet = "No data"
}

enum DeckMoney {
    /// A hidden amount: never a digit.
    static let masked = "$\u{2022}\u{2022}\u{2022}"

    /// "$1.24M" (the trailing zero kept: "$1.70M"), "$845K", "$9,450" under $10K, "$1.2B", a true minus. `cents` keeps
    /// two places under $10K ("$79.00"), as Shop prints a price under $100. A non-finite number is no value: the
    /// missing mark, never "$0".
    static func short(_ value: Double, cents: Bool = false) -> String {
        guard value.isFinite else { return DeckMissing.cell }
        let a = abs(value)
        let text: String
        if a >= 999.95e6 {
            text = DeckFormat.fixed(a / 1e9, 1) + "B"
        } else if a >= 999.5e3 {
            text = DeckFormat.fixed(a / 1e6, 2) + "M"
        } else if a >= 9999.5 {
            text = DeckFormat.grouped(DeckFormat.fixed(a / 1e3, 0)) + "K"
        } else if cents {
            let parts = DeckFormat.fixed(a, 2).split(separator: ".")
            text = DeckFormat.grouped(String(parts[0])) + "." + parts[1]
        } else {
            text = DeckFormat.grouped(DeckFormat.fixed(a, 0))
        }
        return (value < 0 ? "\u{2212}$" : "$") + text
    }

    /// A shop price: cents under $100, else the short form ("$79.99", "$880", "$1,200").
    static func price(_ value: Double) -> String {
        short(value, cents: value < 100)
    }

    /// An open end: "$100K+".
    static func plus(_ value: Double) -> String { short(value) + "+" }

    /// A range of money: "$150K to $200K". One amount when both ends print the same.
    static func range(_ low: Double, _ high: Double, cents: Bool = false) -> String {
        let a = short(low, cents: cents), b = short(high, cents: cents)
        return a == b ? a : a + " to " + b
    }
}

enum DeckFormat {
    // MARK: Numbers

    /// JavaScript's `toFixed(places)` for a value of zero or more: the decimal nearest the double's exact value, a tie
    /// rounding up. `String(format:)` rounds a tie to even (1.125 to "1.12" where the web prints "1.13"), so the
    /// digits come from the exact expansion and are rounded here.
    /// Invalid precision can make the digit slices below go out of bounds or allocate an unbounded result.
    static func fixed(_ value: Double, _ places: Int) -> String {
        guard (0...60).contains(places) else { return "0" }
        let exact = String(format: "%.60f", abs(value)).split(separator: ".", omittingEmptySubsequences: false)
        let whole = exact[0], fraction = exact.count > 1 ? exact[1] : ""
        var digits = Array(whole) + Array(fraction.prefix(places))
        while digits.count < whole.count + places { digits.append("0") }
        if let next = fraction.dropFirst(places).first, next >= "5" {
            var index = digits.count - 1
            while index >= 0 {
                if digits[index] == "9" {
                    digits[index] = "0"
                    index -= 1
                } else {
                    guard let digit = digits[index].wholeNumberValue else { break }
                    digits[index] = Character(String(digit + 1))
                    break
                }
            }
            if index < 0 { digits.insert("1", at: 0) }
        }
        let intCount = digits.count - places
        let head = String(digits[0..<intCount])
        return places == 0 ? head : head + "." + String(digits[intCount...])
    }

    /// "1234567" to "1,234,567".
    static func grouped(_ digits: String) -> String {
        var out = ""
        for (index, character) in digits.reversed().enumerated() {
            if index > 0, index % 3 == 0 { out.append(",") }
            out.append(character)
        }
        return String(out.reversed())
    }

    enum ChangeKind { case percent, points }

    /// "+1.2%", "\u{2212}0.36%", "+0.8 pt": a sign, a true minus, and no sign once the value rounds to zero ("0.0%").
    static func change(_ value: Double, places: Int = 1, kind: ChangeKind = .percent) -> String {
        guard value.isFinite else { return DeckMissing.cell }
        let text = fixed(value, places)
        let zero = !text.contains { $0 != "0" && $0 != "." }
        let sign = zero ? "" : (value > 0 ? "+" : "\u{2212}")
        return sign + text + (kind == .percent ? "%" : " pt")
    }

    /// A rate or a share, "7.11%", "17.1%", "\u{2212}2.3%": `toFixed` rounding (a tie rounds away from zero, as on the
    /// web; `String(format:)` rounds 0.25 to "0.2"), a true minus, no sign once it rounds to zero.
    static func percent(_ value: Double, places: Int = 1) -> String {
        guard value.isFinite else { return DeckMissing.cell }
        let text = fixed(value, places)
        let zero = !text.contains { $0 != "0" && $0 != "." }
        return (zero || value >= 0 ? "" : "\u{2212}") + text + "%"
    }

    // MARK: Ages

    /// "5 min" (at least 1), "3 h" under 48 hours, "2 days". Nil for no age or a negative one.
    static func age(_ seconds: Double?) -> String? {
        guard let s = seconds, s.isFinite, s >= 0 else { return nil }
        let minutes = (s / 60).rounded()
        if minutes < 60 { return "\(max(1, Int(minutes))) min" }
        let hours = (s / 3600).rounded()
        if hours < 48 { return "\(Int(hours)) h" }
        return "\(DeckFeedParser.whole((s / 86_400).rounded())) days"
    }

    // MARK: Clock and dates

    private static let monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    private static let dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    /// Month and weekday names are Gregorian whatever calendar the device uses (a 13-month calendar would index past
    /// December); only the time zone is the device's.
    static var gregorian: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        return calendar
    }

    private static func name(_ names: [String], _ index: Int?) -> String {
        names[min(max(index ?? 1, 1), names.count) - 1]
    }

    /// "4:10 pm" in the device's time zone.
    static func time(_ date: Date, calendar: Calendar = gregorian) -> String {
        let c = calendar.dateComponents([.hour, .minute], from: date)
        let hour = c.hour ?? 0, minute = c.minute ?? 0
        let twelve = hour % 12 == 0 ? 12 : hour % 12
        return "\(twelve):" + (minute < 10 ? "0" : "") + "\(minute) " + (hour < 12 ? "am" : "pm")
    }

    /// "Nov 14", "Nov 14, 2026" with `year`, "Tue, Nov 17" with `weekday`.
    static func date(_ date: Date, year: Bool = false, weekday: Bool = false, calendar: Calendar = gregorian) -> String {
        let c = calendar.dateComponents([.year, .month, .day, .weekday], from: date)
        let day = name(monthNames, c.month) + " \(c.day ?? 1)"
        let head = weekday ? name(dayNames, c.weekday) + ", " : ""
        return head + day + (year ? ", \(c.year ?? 0)" : "")
    }

    /// "Sep 2026".
    static func month(_ date: Date, calendar: Calendar = gregorian) -> String {
        let c = calendar.dateComponents([.year, .month], from: date)
        return name(monthNames, c.month) + " \(c.year ?? 0)"
    }

    /// The web's date reading: "2026-11-14" and "2026-11" are calendar days in the device's zone (no shift),
    /// "2026-11-15T16:10:00" is a local wall clock, and a stamp with a zone is that instant.
    static func parse(_ text: String, calendar: Calendar = gregorian) -> Date? {
        let t = text.trimmingCharacters(in: .whitespaces)
        let parts = t.split(separator: "-", omittingEmptySubsequences: false)
        if t.count <= 10, parts.count == 2 || parts.count == 3, parts[0].count == 4,
           let y = Int(parts[0]), let m = Int(parts[1]), (1...12).contains(m) {
            let d = parts.count == 3 ? Int(parts[2]) : 1
            guard let d, (1...31).contains(d) else { return nil }
            guard let date = calendar.date(from: DateComponents(year: y, month: m, day: d)),
                  calendar.component(.year, from: date) == y,
                  calendar.component(.month, from: date) == m,
                  calendar.component(.day, from: date) == d else { return nil }
            return date
        }
        let local = DateFormatter()
        local.locale = Locale(identifier: "en_US_POSIX")
        local.calendar = calendar
        local.timeZone = calendar.timeZone
        local.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        if let date = local.date(from: t), local.string(from: date) == t { return date }
        let hasZone = t.hasSuffix("Z") || t.range(of: #"[+-]\d{2}:\d{2}$"#, options: .regularExpression) != nil
        if t.contains("T"), !hasZone { return nil }
        return DeckFeedParser.date(t)
    }
}
