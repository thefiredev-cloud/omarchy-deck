import Foundation
import XCTest
@testable import OmarchyDeck

/// Real estate > Markets (owner order 2026-11-17), the native twin of the web's `markets.js` pure block. Fixtures were
/// captured from the live deck API on 2026-11-17: `housing-national-segments.json` (the spec, unchanged),
/// `housing-national-states.json` (all 51 rows, every state-fitting segment field) and `housing-national-metros.json`
/// (77 of 387 metros: the 60 most populous and every California metro, every metro-fitting field).
final class DeckMarketsTests: XCTestCase {
    private func fixture(_ name: String) throws -> [String: Any] {
        let root = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: root.appendingPathComponent("scripts/fixtures/feeds/\(name).json"))
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func json(_ text: String) throws -> [String: Any] {
        try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
    }

    private func spec() throws -> MarketsSpec { Markets.spec(try fixture("housing-national-segments")) }
    private func states() throws -> [MarketsRow] { Markets.rows(part: "states", json: try fixture("housing-national-states")) }
    private func metros() throws -> [MarketsRow] { Markets.rows(part: "metros", json: try fixture("housing-national-metros")) }

    func testSpecDecodesSegmentsAndFieldsLeniently() throws {
        let spec = try spec()
        XCTAssertEqual(spec.segments.map(\.id), ["residential", "multifamily", "retail", "office", "industrial", "economy"])
        XCTAssertEqual(spec.segments.map(\.label).last, "People and jobs")
        let residential = try XCTUnwrap(Markets.segment(spec, id: "residential"))
        XCTAssertEqual(residential.lead, "gross_yield")
        XCTAssertEqual(residential.fields.prefix(4), ["home_value", "value_trend_1y", "typical_rent", "gross_yield"])
        XCTAssertEqual(spec.fields["gross_yield"]?.better, "higher")
        XCTAssertEqual(spec.fields["days_on_market"]?.better, "lower")
        XCTAssertEqual(spec.fields["rdm_dom"]?.level, "cbsa")
        XCTAssertFalse(spec.fields["gross_yield"]?.sources.isEmpty ?? true)
        XCTAssertEqual(Markets.segment(spec, id: "bogus")?.id, "residential", "an unknown segment falls back to the first")

        // A deck without segments (v1 data) or with odd entries: nothing to show, nothing that crashes.
        let empty = Markets.spec(try json(#"{"dataset":"v1","part":"segments","reason":"The national data is still the v1 set"}"#))
        XCTAssertTrue(empty.segments.isEmpty)
        XCTAssertEqual(empty.reason, "The national data is still the v1 set")
        XCTAssertNil(Markets.segment(empty, id: "residential"))
        XCTAssertNil(Markets.segment(nil, id: "residential"))
        let odd = Markets.spec(try json(#"""
        {"segments":[{"label":"No id"},{"id":"Bad Id","fields":["a"]},{"id":"ok","fields":["a",7,"b"],"extra":true}],
         "fields":{"a":{"label":"A","unit":"usd","sources":[{"id":"s1","as_of":2024}]},"b":"not an object"},"new_key":1}
        """#))
        XCTAssertEqual(odd.segments.map(\.id), ["ok"])
        XCTAssertEqual(odd.segments.first?.fields, ["a", "b"])
        XCTAssertEqual(odd.segments.first?.label, "ok")
        XCTAssertEqual(odd.fields["a"]?.sources.first?.asOf, "2024")
        XCTAssertNil(odd.fields["b"])
    }

    func testParserRoutesTheMarketsFeeds() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        var segments = try fixture("housing-national-segments")
        segments["age"] = 900
        guard case .loaded(let specPage) = DeckFeedParser.state(feed: NationalRoutes.segments, json: segments, now: now) else {
            return XCTFail("the spec must load")
        }
        XCTAssertEqual(specPage.marketsSpec?.segments.count, 6)
        XCTAssertEqual(specPage.updated, now.addingTimeInterval(-900), "dated by the server's age")
        XCTAssertTrue(specPage.sources.isEmpty, "field sources go to the Markets Data sheet, not the section's")
        let list = NationalRoutes.list(part: "states", keys: ["state", "name", "gross_yield"])
        guard case .loaded(let listPage) = DeckFeedParser.state(feed: list, json: try fixture("housing-national-states"), now: now) else {
            return XCTFail("the list must load")
        }
        XCTAssertEqual(listPage.marketRows?.count, 51)
        XCTAssertEqual(DeckFeedParser.state(feed: list, status: 400, body: Data(#"{"error":"bad fields"}"#.utf8)),
                       .failed("Your deck did not accept this list of markets."))
        XCTAssertEqual(DeckFeedParser.state(feed: NationalRoutes.segments, status: 404, body: Data()), .notServed)
    }

    func testListQueriesAndRows() throws {
        let spec = try spec()
        let residential = Markets.segment(spec, id: "residential")
        let one = Markets.listQueries(.states, residential)
        XCTAssertEqual(one.map(\.part), ["states"])
        XCTAssertTrue(one[0].feed.hasPrefix("housing/national?part=states&fields=state,name,home_value,value_trend_1y"))
        let mine = Markets.listQueries(.mine, residential)
        XCTAssertEqual(mine.map(\.part), ["states", "metros"])
        XCTAssertTrue(mine.allSatisfy { $0.feed.contains("&state=CA&") })
        for segment in spec.segments {
            for level in MarketsLevel.allCases {
                for query in Markets.listQueries(level, segment) {
                    XCTAssertTrue(DeckFeedNames.isAllowed(query.feed), "\(segment.id) \(level) \(query.feed)")
                }
            }
        }

        let states = try states()
        XCTAssertEqual(states.count, 51)
        let ca = try XCTUnwrap(states.first { $0.key == "CA" })
        XCTAssertEqual([ca.kind.rawValue, ca.name, ca.sub], ["state", "California", "CA"])
        XCTAssertEqual(ca.values["gross_yield"], 4.15)
        let metros = try metros()
        XCTAssertEqual(metros.count, 77)
        let la = try XCTUnwrap(metros.first { $0.key == "31080" })
        XCTAssertEqual([la.kind.rawValue, la.name, la.sub], ["metro", "Los Angeles-Long Beach-Anaheim", "CA"])
        XCTAssertEqual(Markets.rows(.mine, states: states, metros: metros).map(\.key), ["CA", "31080", "41740", "40140"])
        let rows = Markets.rows(part: "metros", json: try json(#"""
        {"metros":[{"cbsa":35620,"name":"New York-Newark-Jersey City, NY-NJ-PA","pop":19.5e6},{"cbsa":"12","name":"x"},
                   {"name":"no key"},{"cbsa":"99999"}]}
        """#))
        XCTAssertEqual(rows.map(\.key), ["35620", "99999"], "a numeric CBSA reads as five digits; a bad one is dropped")
        XCTAssertEqual(rows.first?.sub, "NY-NJ-PA")
        XCTAssertEqual(rows.last?.name, "99999", "a metro with no name reads by its code")
    }

    /// Rows rank by the segment's lead in its better direction over the whole level; a row with no value has no rank
    /// and sits last; a search cuts the ranked list.
    func testRankedBySegmentLeadInItsBetterDirection() throws {
        let spec = try spec()
        let table = Markets.table(level: .states, segment: Markets.segment(spec, id: "residential"), fields: spec.fields,
                                  rows: try states(), sort: nil)
        XCTAssertEqual(table.cols.first, "gross_yield")
        XCTAssertEqual(table.sort, MarketsSort(key: "gross_yield", ascending: false))
        XCTAssertEqual(table.rows.prefix(3).map(\.key), ["MS", "WV", "LA"])
        XCTAssertEqual(table.rows.prefix(3).map(\.rank), [1, 2, 3])
        XCTAssertEqual(Markets.headLine(table, fields: spec.fields), "Ranked by gross rent yield, highest first \u{00B7} 51 states")
        XCTAssertEqual(Markets.format(spec.fields["gross_yield"], table.rows[0].values["gross_yield"], id: "gross_yield"), "8.03%")

        let days = Markets.nextSort(nil, key: "days_on_market", fields: spec.fields)
        XCTAssertEqual(days, MarketsSort(key: "days_on_market", ascending: true), "days to sell starts lowest first")
        XCTAssertEqual(Markets.nextSort(days, key: "days_on_market", fields: spec.fields).ascending, false, "a second tap flips")
        let byDays = Markets.table(level: .states, segment: Markets.segment(spec, id: "residential"), fields: spec.fields,
                                   rows: try states(), sort: days)
        let values = byDays.rows.compactMap { $0.values["days_on_market"] }
        XCTAssertEqual(values, values.sorted())

        let found = Markets.table(level: .states, segment: Markets.segment(spec, id: "residential"), fields: spec.fields,
                                  rows: try states(), sort: nil, query: "cal")
        XCTAssertEqual(found.rows.map(\.key), ["CA"])
        XCTAssertEqual(found.rows.first?.rank, table.rows.first { $0.key == "CA" }?.rank, "rank is over the whole level")
        XCTAssertEqual(Markets.headLine(found, fields: spec.fields), "Ranked by gross rent yield, highest first \u{00B7} 1 of 51 states")

        let gaps = [MarketsRow(key: "AA", kind: .state, name: "A", sub: "AA", full: "A", values: [:]),
                    MarketsRow(key: "BB", kind: .state, name: "B", sub: "BB", full: "B", values: ["x": 1]),
                    MarketsRow(key: "CC", kind: .state, name: "C", sub: "CC", full: "C", values: ["x": 3])]
        XCTAssertEqual(Markets.sorted(gaps, by: "x", ascending: true).map(\.key), ["BB", "CC", "AA"])
        XCTAssertEqual(Markets.sorted(gaps, by: "x", ascending: false).map(\.key), ["CC", "BB", "AA"], "no value sits last either way")
    }

    /// A column needs values in at least 3 rows and a tenth of a 20+ row list; a field only a few places publish stays in
    /// the row sheet, and one no row carries is named once as not reported.
    func testSparseFieldsStayInTheRowSheet() throws {
        let spec = try spec()
        let multifamily = Markets.segment(spec, id: "multifamily")
        let metros = Markets.columns(multifamily, rows: try metros(), level: .metros, fields: spec.fields)
        XCTAssertEqual(metros.cols.first, "zm_zori_mf_yoy", "the segment lead leads")
        XCTAssertEqual(metros.sparse, ["crel_cap_multifamily"], "5 of 77 metros publish asking cap rates: not enough for a list")
        XCTAssertEqual(metros.hidden, ["vip_multifamily_yoy"])
        XCTAssertFalse(metros.cols.contains("crel_cap_multifamily"))
        let states = Markets.columns(multifamily, rows: try states(), level: .states, fields: spec.fields)
        XCTAssertEqual(states.cols.first, "typical_rent", "a metro-only lead never leads a state list")
        XCTAssertFalse(states.cols.contains { Markets.levelOf(spec.fields, $0) == "metro" }, "no metro-only column on States")
        XCTAssertEqual(Set(states.sparse), ["crel_cap_multifamily", "cap_spread_multifamily"])

        func rows(_ total: Int, filled: Int) -> [MarketsRow] {
            (0..<total).map { i in
                MarketsRow(key: "R\(i)", kind: .state, name: "R\(i)", sub: "", full: "", values: i < filled ? ["f": Double(i)] : [:])
            }
        }
        XCTAssertTrue(Markets.enough(rows(5, filled: 1), "f"), "a short list needs one value")
        XCTAssertFalse(Markets.enough(rows(5, filled: 0), "f"))
        XCTAssertFalse(Markets.enough(rows(20, filled: 2), "f"), "a long list needs at least 3")
        XCTAssertTrue(Markets.enough(rows(20, filled: 3), "f"))
        XCTAssertTrue(Markets.enough(rows(30, filled: 3), "f"))
        XCTAssertFalse(Markets.enough(rows(31, filled: 3), "f"), "and a tenth of the list: 4 of 31")
        XCTAssertTrue(Markets.enough(rows(31, filled: 4), "f"))
    }

    /// Your markets mixes the California row with metro rows: a metro field and the state field of the same measure share
    /// one column, the state row reading its own state figure.
    func testYourMarketsSharesMetroAndStateColumns() throws {
        let spec = try spec()
        let residential = Markets.segment(spec, id: "residential")
        let rows = Markets.rows(.mine, states: try states(), metros: try metros())
        let columns = Markets.columns(residential, rows: rows, level: .mine, fields: spec.fields)
        XCTAssertEqual(columns.pairs["rdm_dom"], "rds_dom")
        XCTAssertFalse(columns.cols.contains("rds_dom"), "the state field folds into the metro column")
        let ca = try XCTUnwrap(columns.rows.first { $0.key == "CA" })
        XCTAssertEqual(ca.values["rdm_dom"], 57, "California reads its state days listed in the shared column")
        let labels = Markets.labels(columns.cols, spec.fields, pairs: columns.pairs)
        XCTAssertEqual(labels["rdm_dom"], "Median days listed (Realtor.com)", "a shared column names its measure")
        let table = Markets.table(level: .mine, segment: residential, fields: spec.fields, rows: rows, sort: nil)
        XCTAssertEqual(table.all, 4)
        XCTAssertEqual(Markets.headLine(table, fields: spec.fields), "Ranked by gross rent yield, highest first \u{00B7} 4 markets")
        XCTAssertEqual(table.rows.first?.key, "40140", "Riverside-San Bernardino has the highest yield of the four")

        // Two fields with one label take their level word, else their publisher.
        let same = ["a": MarketsField(label: "Rent", unit: "usd", level: "zip"), "b": MarketsField(label: "Rent", unit: "usd", level: "county")]
        XCTAssertEqual(Markets.labels(["a", "b"], same), ["a": "Rent (ZIP data)", "b": "Rent (county data)"])
        let byPublisher = ["a": MarketsField(label: "Rent", sources: [MarketsSource(id: "x", name: nil, publisher: "Zillow", asOf: nil)]),
                           "b": MarketsField(label: "Rent", sources: [MarketsSource(id: "y", name: nil, publisher: "Census", asOf: nil)])]
        XCTAssertEqual(Markets.labels(["a", "b"], byPublisher), ["a": "Rent (Zillow)", "b": "Rent (Census)"])
    }

    func testFormatsFollowTheCatalogUnit() throws {
        let spec = try spec()
        func f(_ id: String, _ v: Double?) -> String? { Markets.format(spec.fields[id], v, id: id) }
        XCTAssertEqual(f("value_trend_1y", 0.91), "+0.9%", "a change carries its sign")
        XCTAssertEqual(f("gross_yield", 4.15), "4.15%", "a yield reads with two places")
        XCTAssertEqual(f("price_cuts", 22.75), "22.8%", "a share with one")
        XCTAssertEqual(f("home_value", 775_150), "$775K")
        XCTAssertEqual(f("typical_rent", 2681), "$2,681/mo")
        XCTAssertEqual(f("pop", 3_322_512), "3.3M")
        XCTAssertEqual(f("days_on_market", 41.4), "41")
        XCTAssertEqual(f("cap_spread_multifamily", 0.75), "+0.75 pt")
        XCTAssertNil(f("gross_yield", nil), "a missing value is the dash, never 0")
        XCTAssertNil(f("gross_yield", .nan))
        XCTAssertEqual(Markets.format(MarketsField(unit: "ratio"), 1.234, id: "x"), "1.2")
        XCTAssertEqual(Markets.format(MarketsField(unit: "score"), 61.6, id: "x"), "62")
        XCTAssertEqual(Markets.format(MarketsField(unit: "kwh_cents"), 21.04, id: "x"), "21.0\u{00A2}")
        XCTAssertEqual(Markets.format(MarketsField(unit: "sqft"), 12_000, id: "x"), "12.0K\u{00A0}SF")
        XCTAssertEqual(Markets.format(MarketsField(unit: "usd_sqft"), 42.5, id: "x"), "$42.50/SF")
        XCTAssertEqual(Markets.format(nil, 2.50, id: "x"), "2.5", "an unknown unit trims its zeros")
        XCTAssertEqual(Markets.format(MarketsField(unit: "pct"), 7.1, id: "mortgage_rate"), "7.10%")
        XCTAssertEqual(Markets.format(MarketsField(unit: "pct"), 6.2, id: "crel_cap_multifamily"), "6.20%")
    }

    /// A row's sheet shows every segment for that geography, read in chunks the server takes and merged.
    func testRowSheetShowsEverySegmentFromChunkedReads() throws {
        let spec = try spec()
        let queries = Markets.sheetQueries(spec, kind: .metro, key: "41740", name: "San Diego-Chula Vista-Carlsbad, CA")
        XCTAssertEqual(queries.count, 2, "124 metro fields in two reads of at most 96")
        for query in queries {
            XCTAssertTrue(DeckFeedNames.isAllowed(query), query)
            XCTAssertTrue(query.contains("&state=CA&"))
        }
        let stateQueries = Markets.sheetQueries(spec, kind: .state, key: "CA", name: "California")
        XCTAssertTrue(stateQueries.allSatisfy { $0.hasPrefix("housing/national?part=states&state=CA&fields=state,name,") })

        // Two answers, each with part of the row: merged into one.
        let all = try metros()
        let full = try XCTUnwrap(all.first { $0.key == "41740" })
        var first = full, second = full
        first.values = full.values.filter { $0.key < "m" }
        second.values = full.values.filter { $0.key >= "m" }
        let merged = try XCTUnwrap(Markets.sheetRow(key: "41740", answers: [[first], [], [second]]))
        XCTAssertEqual(merged.values, full.values)
        XCTAssertNil(Markets.sheetRow(key: "00000", answers: [[first]]))

        let sections = Markets.sheet(spec, values: merged.values, kind: .metro)
        XCTAssertEqual(sections.map(\.id), ["residential", "multifamily", "retail", "office", "industrial", "economy"])
        let residential = try XCTUnwrap(sections.first)
        XCTAssertEqual(residential.items.first { $0.key == "gross_yield" }?.value, "3.71%")
        XCTAssertEqual(residential.items.first { $0.key == "home_value" }?.value, "$892K")
        let fields = sections.flatMap { $0.items.map(\.key) }
        XCTAssertFalse(fields.contains { Markets.levelOf(spec.fields, $0) == "state" }, "no state-only field on a metro sheet")
        XCTAssertTrue(sections.allSatisfy { Set($0.items.map(\.label)).count == $0.items.count }, "labels unique per segment")
        let empty = Markets.sheet(spec, values: [:], kind: .state)
        XCTAssertTrue(empty.allSatisfy { $0.items.isEmpty && !$0.missing.isEmpty }, "a market with no values names what is missing")
    }

    func testDataSheetNamesSourcesAndWhatIsMissing() throws {
        let spec = try spec()
        let multifamily = Markets.segment(spec, id: "multifamily")
        let table = Markets.table(level: .metros, segment: multifamily, fields: spec.fields, rows: try metros(), sort: nil)
        let data = Markets.data(fields: spec.fields, segment: multifamily, cols: table.cols, hidden: table.hidden,
                                sparse: table.sparse, pairs: table.pairs)
        XCTAssertFalse(data.sources.isEmpty)
        XCTAssertTrue(data.sources.allSatisfy { $0.detail?.isEmpty == false }, "each source says what it gives")
        XCTAssertTrue(data.notes.contains { $0.hasPrefix("In row sheets only:") && $0.contains("Median asking cap, multifamily") })
        XCTAssertTrue(data.notes.contains { $0.hasPrefix("No values here:") })
        XCTAssertTrue(data.notes.contains { $0.hasPrefix("Your markets: California") })
    }
}
