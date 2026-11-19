import XCTest
@testable import OmarchyDeck

/// The app and the web print one form per value. `Shared/Fixtures/formats.json` is a byte copy of the web repo's
/// `tests/fixtures/formats.json` (the kit's `formats-drift` compares the two); every case runs through the app's own
/// formatters here, so a change on either side that the other has not made fails a test.
final class DeckFormatsFixtureTests: XCTestCase {
    private struct Case {
        let fn: String
        let input: Any?
        let opt: [String: Any]
        let out: String?
    }

    private func cases() throws -> [Case] {
        let root = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: root.appendingPathComponent("Shared/Fixtures/formats.json"))
        let doc = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(DeckFeedParser.number(doc["version"]), 1)
        let rows = try XCTUnwrap(doc["cases"] as? [[String: Any]])
        return rows.map { row in
            Case(fn: row["fn"] as? String ?? "", input: row["in"] is NSNull ? nil : row["in"],
                 opt: row["opt"] as? [String: Any] ?? [:], out: row["out"] as? String)
        }
    }

    private func flag(_ opt: [String: Any], _ key: String) -> Bool {
        (opt[key] as? Bool) ?? false
    }

    /// One case through the app's formatter for its kind. Nil is "no value": the page prints `DeckMissing` there.
    private func run(_ c: Case) throws -> String? {
        let number = DeckFeedParser.number(c.input)
        switch c.fn {
        case "money":
            guard let n = number else { return nil }
            if flag(c.opt, "masked") { return DeckMoney.masked }
            if let to = DeckFeedParser.number(c.opt["to"]) { return DeckMoney.range(n, to) }
            if flag(c.opt, "plus") { return DeckMoney.plus(n) }
            return DeckMoney.short(n, cents: flag(c.opt, "cents"))
        case "age":
            return DeckFormat.age(number)
        case "time":
            return (c.input as? String).flatMap { DeckFormat.parse($0) }.map { DeckFormat.time($0) }
        case "date":
            guard let date = (c.input as? String).flatMap({ DeckFormat.parse($0) }) else { return nil }
            if flag(c.opt, "month") { return DeckFormat.month(date) }
            return DeckFormat.date(date, year: flag(c.opt, "year"), weekday: flag(c.opt, "weekday"))
        case "change":
            guard let n = number else { return nil }
            let places = DeckFeedParser.number(c.opt["d"]).map { DeckFeedParser.whole($0) } ?? 1
            return DeckFormat.change(n, places: places, kind: c.opt["kind"] as? String == "pt" ? .points : .percent)
        case "missing":
            return c.opt["mode"] as? String == "sheet" ? DeckMissing.sheet : DeckMissing.cell
        default:
            throw XCTSkip("unknown formatter \(c.fn)")
        }
    }

    func testEveryFixtureCaseReadsAsTheWebPrintsIt() throws {
        let all = try cases()
        XCTAssertGreaterThanOrEqual(all.count, 58)
        for kind in ["money", "age", "time", "date", "change", "missing"] {
            XCTAssertTrue(all.contains { $0.fn == kind }, "the fixture covers \(kind)")
        }
        for c in all {
            XCTAssertEqual(try run(c), c.out, "\(c.fn) \(String(describing: c.input)) \(c.opt)")
        }
    }

    /// The section mark's age is the fixture's age, clamped at zero and never trapping on a huge stamp.
    func testFreshnessMarkUsesTheFixtureAge() throws {
        for c in try cases() where c.fn == "age" {
            guard let seconds = DeckFeedParser.number(c.input), let out = c.out else { continue }
            XCTAssertEqual(DeckFreshness.short(seconds), out)
        }
        XCTAssertEqual(DeckFreshness.short(-30), "1 min", "a clock ahead of the feed reads as new, never as nothing")
    }

    /// `String(format:)` rounds an exact tie to even; the web rounds it up. Both sides must print "$1.13M".
    func testExactTiesRoundUpAsTheWebDoes() {
        XCTAssertEqual(DeckFormat.fixed(1.125, 2), "1.13")
        XCTAssertEqual(DeckFormat.fixed(1.625, 2), "1.63")
        XCTAssertEqual(DeckFormat.fixed(9.995, 2), "9.99", "9.995 is stored under the tie")
        XCTAssertEqual(DeckFormat.fixed(99.5, 0), "100")
        XCTAssertEqual(DeckFormat.fixed(0.95, 1), "0.9", "0.95 is stored under the tie")
        XCTAssertEqual(DeckMoney.short(2_625_000), "$2.63M")
    }

    /// Invalid precision used to make the formatter slice past its digit buffer.
    func testInvalidPrecisionDoesNotTrap() {
        XCTAssertEqual(DeckFormat.fixed(12.34, -1), "0")
        XCTAssertEqual(DeckFormat.fixed(12.34, Int.min), "0")
        XCTAssertEqual(DeckFormat.fixed(12.34, Int.max), "0")
    }


    func testNonFiniteAgesHaveNoValue() {
        XCTAssertNil(DeckFormat.age(.nan))
        XCTAssertNil(DeckFormat.age(.infinity))
        XCTAssertNil(DeckFormat.age(-.infinity))
    }
    func testAgeSwitchesUnitsAtRoundedBoundaries() {
        XCTAssertEqual(DeckFormat.age(59 * 60 + 29), "59 min")
        XCTAssertEqual(DeckFormat.age(59 * 60 + 30), "1 h")
        XCTAssertEqual(DeckFormat.age(47 * 3600 + 29 * 60), "47 h")
        XCTAssertEqual(DeckFormat.age(47 * 3600 + 30 * 60), "2 days")
    }


    /// Money and age words already read a non-finite value as no value. Rates and changes must too: `fixed` would print
    /// the digits of "nan" or "inf", so a NaN share would read as a sign and "nan.0%".
    func testNonFiniteRatesAndChangesHaveNoValue() {
        XCTAssertEqual(DeckFormat.percent(.nan), DeckMissing.cell)
        XCTAssertEqual(DeckFormat.percent(.infinity), DeckMissing.cell)
        XCTAssertEqual(DeckFormat.change(.nan), DeckMissing.cell)
        XCTAssertEqual(DeckFormat.change(-.infinity, kind: .points), DeckMissing.cell)
    }

    /// A stray feed number never traps a formatter.
    func testHugeAndOddNumbersDoNotTrap() {
        XCTAssertTrue(DeckMoney.short(-1e30).hasPrefix("\u{2212}$"))
        XCTAssertTrue(DeckMoney.short(1e300).hasSuffix("B"))
        XCTAssertEqual(DeckMoney.short(Double.nan), DeckMissing.cell, "no value is the missing mark, never $0")
        XCTAssertEqual(DeckMoney.short(Double.infinity), DeckMissing.cell)
        XCTAssertEqual(DeckMoney.price(-Double.infinity), DeckMissing.cell)
        XCTAssertEqual(DeckFormat.change(-1e30), "\u{2212}" + DeckFormat.fixed(1e30, 1) + "%")
    }

    /// Rates and shares round a tie away from zero as the web's `toFixed` does; `String(format:)` rounds 0.25 to 0.2.
    func testPercentsRoundLikeTheWeb() {
        XCTAssertEqual(DeckFormat.percent(0.25), "0.3%")
        XCTAssertEqual(DeckFormat.percent(-2.25), "\u{2212}2.3%")
        XCTAssertEqual(DeckFormat.percent(7.115, places: 2), "7.12%", "7.115 is stored above the tie")
        XCTAssertEqual(DeckFormat.percent(-0.04), "0.0%", "no sign once it rounds to zero")
        XCTAssertEqual(RealEstateWords.percent(0.125, digits: 2), "0.13%")
        XCTAssertEqual(NationalWords.format(17.25, unit: "pct"), "17.3%", "an exact tie rounds up, as the web prints it")
    }

    /// Month and weekday names come from a fixed Gregorian calendar: a device on a 13-month calendar never indexes
    /// past December, and a calendar handed in that has a 13th month reads a name, never traps.
    func testDateNamesAreGregorianWhateverTheDeviceCalendar() throws {

        XCTAssertEqual(DeckFormat.gregorian.identifier, .gregorian)
        var hebrew = Calendar(identifier: .hebrew)
        hebrew.timeZone = TimeZone(identifier: "UTC")!
        let start = try XCTUnwrap(DeckFormat.parse("2026-01-01"))
        for day in 0..<400 {
            let date = start.addingTimeInterval(Double(day) * 86_400)
            XCTAssertFalse(DeckFormat.month(date, calendar: hebrew).isEmpty)
            XCTAssertFalse(DeckFormat.date(date, weekday: true, calendar: hebrew).isEmpty)
        }
        XCTAssertEqual(DeckFormat.month(try XCTUnwrap(DeckFormat.parse("2026-09"))), "Sep 2026")
    }
    func testCalendarDatesRejectInvalidDays() {
        XCTAssertNil(DeckFormat.parse("2026-02-30"))
        XCTAssertNil(DeckFormat.parse("2026-04-31"))
        XCTAssertNotNil(DeckFormat.parse("2024-02-29"))
    }

    func testLocalTimestampsRejectInvalidCalendarDatesAndTrailingText() {
        XCTAssertNil(DeckFormat.parse("2026-02-30T16:10:00"))
        XCTAssertNil(DeckFormat.parse("2026-11-15T16:10:00garbage"))
    }

    /// Date-only feed values stay on their calendar day, local timestamps keep wall-clock time, and zoned stamps
    /// display as the same instant in the selected calendar's zone.
    func testDateParsingDistinguishesLocalValuesFromZonedInstants() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(secondsFromGMT: -8 * 60 * 60))

        let day = try XCTUnwrap(DeckFormat.parse("2026-11-15", calendar: calendar))
        XCTAssertEqual(DeckFormat.date(day, calendar: calendar), "Nov 15")

        let local = try XCTUnwrap(DeckFormat.parse("2026-11-15T16:10:00", calendar: calendar))
        XCTAssertEqual(DeckFormat.time(local, calendar: calendar), "4:10 pm")

        let zoned = try XCTUnwrap(DeckFormat.parse("2026-11-15T16:10:00Z", calendar: calendar))
        XCTAssertEqual(DeckFormat.time(zoned, calendar: calendar), "8:10 am")
    }

}
