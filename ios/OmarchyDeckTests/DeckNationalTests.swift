import Foundation
import XCTest
@testable import OmarchyDeck

/// Real estate reads the national routes of NationalApi.md. Fixtures are cut from NationalCore's staged v2 dataset of
/// 2026-11-14 in the route shapes (rows and keys dropped, values unchanged). Only checked queries reach the URL, blended
/// metrics carry their confidence and parts, and raw columns carry none.
final class DeckNationalTests: XCTestCase {
    private func fixture(_ name: String) throws -> [String: Any] {
        let root = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: root.appendingPathComponent("scripts/fixtures/feeds/\(name).json"))
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testRoutesAreFixedAndChecked() {
        XCTAssertEqual(DeckFeedSection.realestate.feeds, ["housing/national?part=summary", "housing/national?part=sources"])
        XCTAssertEqual(DeckFeedNames.path(NationalRoutes.summary), "/api/housing/national")
        XCTAssertEqual(DeckFeedNames.query(NationalRoutes.summary), [URLQueryItem(name: "part", value: "summary")])
        let rank = NationalRoutes.rank(NationalRoutes.Scope(state: "CA", query: "Dana Point", sort: "gross_yield"))
        XCTAssertTrue(DeckFeedNames.isAllowed(rank))
        XCTAssertEqual(DeckFeedNames.path(rank), "/api/housing/rank")
        XCTAssertEqual(Set(DeckFeedNames.query(rank).map { "\($0.name)=\($0.value ?? "")" }),
                       ["kind=housing", "sort=gross_yield", "limit=50", "state=CA", "q=Dana Point"])
        XCTAssertFalse(DeckFeedNames.isAllowed("housing/rank?kind=housing&sort=yield&limit=50"),
                       "the v1 alias reads the raw yield column: the app never sends it")
        XCTAssertTrue(DeckFeedNames.isAllowed(NationalRoutes.zip("92629")))
        XCTAssertEqual(DeckFeedNames.path(NationalRoutes.zip("92629")), "/api/housing/zip/92629")
        for bad in ["housing/zip/9262", "housing/zip/92629/hist", "housing/zip/../../lock", "housing/national?part=fields",
                    "housing/rank?kind=commercial&sort=score&limit=50", "housing/rank?kind=housing&sort=bogus&limit=50",
                    "housing/rank?kind=housing&sort=score&limit=500", "housing/rank?kind=housing&sort=score&limit=50&state=ZZ",
                    "housing/rank?kind=housing&sort=score&limit=50&q=%3Cscript%3E", "housing/profile"] {
            XCTAssertFalse(DeckFeedNames.isAllowed(bad), bad)
        }
        XCTAssertNil(NationalRoutes.cleanQuery(String(repeating: "a", count: 41)))
        XCTAssertEqual(NationalRoutes.cleanQuery("  San Clemente "), "San Clemente")
        XCTAssertTrue(NationalRoutes.isZip("92629"))
        XCTAssertFalse(NationalRoutes.isZip("9262a"))
    }

    func testSummaryGivesTheUSStripAndMethodNotes() throws {
        guard case .loaded(let page) = DeckFeedParser.state(feed: NationalRoutes.summary, json: try fixture("housing-national-summary")),
              let summary = page.national else {
            return XCTFail("the summary must load")
        }
        XCTAssertEqual(summary.homeValue, 367_798)
        XCTAssertEqual(summary.homeValue.map { DeckMoney.short($0) }, "$368K")
        XCTAssertEqual(summary.valueChange1y, 1.63)
        XCTAssertEqual(summary.rent, 1715)
        XCTAssertEqual(summary.rate30, 7.11)
        XCTAssertEqual(summary.zipsTotal, 39_228)
        XCTAssertTrue(page.notes.contains { $0.hasPrefix("39,228 ZIPs") }, "coverage goes to the Data sheet")
        XCTAssertTrue(page.notes.contains { $0.hasPrefix("Score weights: Gross rent yield 25%") })
    }

    /// Each US figure stands alone in its tile, so one the feed lacks is nil and the tile prints "No data": never the dot
    /// that marks a gap among a row's figures, never zero, never "$0" for a value that is not a number.
    func testUSStripTilesReadNoDataWhenAFigureIsMissing() throws {
        guard case .loaded(let page) = DeckFeedParser.state(feed: NationalRoutes.summary, json: try fixture("housing-national-summary")),
              let summary = page.national else {
            return XCTFail("the summary must load")
        }
        XCTAssertEqual(summary.tiles.map(\.label), ["Home value", "1-yr change", "Rent", "Gross yield", "Days to sell", "30-yr rate"])
        XCTAssertEqual(summary.tiles.map(\.id).first, "national.us.value")
        XCTAssertEqual(summary.tiles[0].value, "$368K")
        XCTAssertEqual(summary.tiles[1].value, "+1.6%")
        XCTAssertEqual(summary.tiles[2].value, "$1,715/mo")
        XCTAssertEqual(summary.tiles[5].value, "7.11%")

        var json = try fixture("housing-national-summary")
        var us = try XCTUnwrap(json["us"] as? [String: Any])
        us["zhvi"] = NSNull()
        json["us"] = us
        guard case .loaded(let gap) = DeckFeedParser.state(feed: NationalRoutes.summary, json: json),
              let partial = gap.national else {
            return XCTFail("a summary without the home value still loads")
        }
        XCTAssertNil(partial.tiles[0].value, "the home value tile reads No data")
        XCTAssertEqual(partial.tiles[2].value, "$1,715/mo", "the other figures stay")

        let empty = NationalSummary(homeValue: .nan, valueChange1y: nil, rent: .infinity, grossYield: nil, daysToSell: nil,
                                    priceCuts: nil, rate30: nil, zipsTotal: nil, graded: nil, notes: [])
        XCTAssertEqual(empty.tiles.count, 6)
        for tile in empty.tiles {
            XCTAssertNil(tile.value, "\(tile.label) has no figure, so its tile reads No data")
        }
    }

    func testSourcesListFillsTheDataSheet() throws {
        guard case .loaded(let page) = DeckFeedParser.state(feed: NationalRoutes.sources, json: try fixture("housing-national-sources")) else {
            return XCTFail("the sources list must load")
        }
        XCTAssertEqual(page.sources.count, 67)
        XCTAssertEqual(page.sources.first?.detail, "US Census Bureau")
        XCTAssertEqual(page.sources.first?.asOf, "2020-2024", "a range of years stays as published")
    }

    /// "Out of date" is the server's `stale` on the summary (NationalServer #230), never a cadence the app guesses: a
    /// month-old build the server calls fresh stays fresh, and the page is dated by the server's `age`.
    func testFreshnessComesFromTheServersAgeAndStale() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        func summary(_ keys: [String: Any]) throws -> DeckFeedPage {
            var json = try fixture("housing-national-summary")
            json.merge(keys) { $1 }
            guard case .loaded(let page) = DeckFeedParser.state(feed: NationalRoutes.summary, json: json, now: now) else {
                throw XCTSkip("the summary must load")
            }
            return page
        }
        let old = try summary(["age": 1_300_000, "refresh": 604_800, "stale": true])
        XCTAssertTrue(old.stale)
        XCTAssertEqual(old.updated, now.addingTimeInterval(-1_300_000), "dated by the server's age, not the device clock")
        let sources = DeckFeedParser.state(feed: NationalRoutes.sources, json: try fixture("housing-national-sources"), now: now)
        guard case .loaded(let sourcesPage) = sources else { return XCTFail("the sources list must load") }
        XCTAssertFalse(sourcesPage.stale, "the sources part carries no freshness and never marks the section")
        XCTAssertEqual(DeckFreshness.mark(pages: [old, sourcesPage], missing: 0, now: now)?.text, "Out of date · 15 days")

        let fresh = try summary(["generated_at": 1_790_000_000, "age": 3_600, "refresh": 604_800, "stale": false])
        XCTAssertFalse(fresh.stale, "a build months older than the device clock is fresh when the server says so")
        XCTAssertEqual(DeckFreshness.mark(pages: [fresh, sourcesPage], missing: 0, now: now), DeckFreshness(kind: .fresh, text: "1 h"))
        let unflagged = try summary([:])
        XCTAssertFalse(unflagged.stale, "a deck that predates the keys is never called out of date by a guess")
        let built = try XCTUnwrap((try fixture("housing-national-summary")["generated_at"] as? NSNumber)?.doubleValue)
        XCTAssertEqual(unflagged.updated, Date(timeIntervalSince1970: built))
        XCTAssertEqual(DeckFeedParser.state(feed: NationalRoutes.summary, json: ["status": "not_reporting"], now: now), .notCollected)
    }

    func testRankRowsPreferBlendedValuesWithTheirConfidence() throws {
        let json = try fixture("housing-rank-rows")
        let rank = DeckNationalParser.rank(json)
        XCTAssertEqual(rank.zipsTotal, 39_228)
        let dana = try XCTUnwrap(rank.rows.first { $0.zip == "92629" })
        XCTAssertEqual(dana.place, "Dana Point, CA")
        XCTAssertEqual(dana.value, 1_790_155)
        XCTAssertEqual(dana.value.map { DeckMoney.short($0) }, "$1.79M")
        XCTAssertNotNil(dana.valueConfidence, "a blended value carries its mark")
        XCTAssertEqual(dana.grossYield, 2.84)
        XCTAssertEqual(dana.grade, "D")
        let first = try XCTUnwrap(rank.rows.first)
        XCTAssertEqual(first.zip, "79607")
        XCTAssertEqual(first.value, 255_859, "the blended home value stands in where the value index has none")
        XCTAssertEqual(first.valueConfidence?.dots, 2)
        let empty = try XCTUnwrap(rank.rows.first { $0.zip == "92623" })
        XCTAssertNil(empty.value, "a ZIP with no value stays nil, never $0")
        XCTAssertNil(empty.valueConfidence, "no value, no mark")
    }

    func testZipSheetBlendsCarryConfidenceAndParts() throws {
        let json = try fixture("housing-zip-92629")
        guard case .loaded(let page) = DeckFeedParser.state(feed: NationalRoutes.zip("92629"), json: json),
              let zip = page.nationalZip else {
            return XCTFail("the ZIP body must load")
        }
        XCTAssertEqual(zip.place, "Dana Point, CA")
        XCTAssertEqual(zip.metro, "Los Angeles-Long Beach-Anaheim, CA")
        XCTAssertEqual(zip.tiles.map(\.label), ["Home value", "Rent", "Gross yield", "1-yr change"])
        XCTAssertEqual(zip.tiles[0].value, "$1.79M")
        XCTAssertEqual(zip.tiles[0].confidence?.dots, 2)
        XCTAssertEqual(zip.tiles[0].parts.first?.label, "Zhvi")
        XCTAssertEqual(zip.tiles[1].value, "$4,234/mo")
        XCTAssertEqual(zip.tiles[3].value, "+7.1%")
        XCTAssertEqual(zip.sections.map(\.title), ["Value and rent", "Market", "People", "Jobs", "Schools", "Risk", "Costs"])
        let market = try XCTUnwrap(zip.sections.first { $0.title == "Market" })
        XCTAssertEqual(market.facts.first { $0.key == "days_on_market" }?.value, "39 days")
        let people = try XCTUnwrap(zip.sections.first { $0.title == "People" })
        let age = try XCTUnwrap(people.facts.first { $0.key == "median_age" })
        XCTAssertNil(age.confidence, "a raw census reading carries no mark")
        XCTAssertFalse(zip.valueHistory.isEmpty)
    }

    /// pixel-deck #351: a value the validity table rejected arrives as `m[key] = {v: null, reason, from}`. The sheet
    /// prints "No data" with the reason and never falls back to the raw v1 column (ZIP 62927: a $1 home value and a
    /// 754,800% yield), and draws no chart of the rejected series.
    func testARejectedValueReadsNoDataWithItsReasonNeverTheRawColumn() throws {
        let json = try fixture("housing-zip-62927")
        guard case .loaded(let page) = DeckFeedParser.state(feed: NationalRoutes.zip("62927"), json: json),
              let zip = page.nationalZip else {
            return XCTFail("the ZIP body must load")
        }
        let tiles = Dictionary(uniqueKeysWithValues: zip.tiles.map { ($0.key, $0) })
        XCTAssertEqual(tiles["home_value"]?.value, DeckMissing.sheet)
        XCTAssertEqual(tiles["home_value"]?.note, "placeholder")
        XCTAssertNil(tiles["home_value"]?.confidence)
        XCTAssertEqual(tiles["gross_yield"]?.value, DeckMissing.sheet, "a yield from a rejected value is rejected too")
        XCTAssertEqual(tiles["gross_yield"]?.note, "placeholder")
        XCTAssertEqual(tiles["typical_rent"]?.value, "$629/mo")
        XCTAssertEqual(zip.tiles.first { $0.label == "1-yr change" }?.value, "0.0%", "a metric m does not name still reads its raw column")
        XCTAssertFalse(zip.tiles.contains { $0.value.contains("$1") && $0.key == "home_value" })
        XCTAssertFalse(zip.tiles.contains { $0.value.contains("754") }, "the raw 754,800% never prints")
        let market = try XCTUnwrap(zip.sections.first { $0.title == "Market" })
        XCTAssertEqual(market.facts.first { $0.key == "price_cuts" }?.note, "too few listings")
        XCTAssertEqual(market.facts.first { $0.key == "days_on_market" }?.value, "41 days")
        XCTAssertTrue(zip.valueHistory.isEmpty, "no chart of a rejected home value")
    }

    /// A v2 rank row that carries a blended column as null (rejected) keeps it null: the raw v1 column never stands in.
    func testRankRowsNeverFallBackToARawColumnTheBuildRejected() throws {
        let rank = DeckNationalParser.rank(try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(#"""
        {"total":2,"rows":[
          {"zip":"62927","city":"Dowell","state":"IL","home_value":null,"zhvi":1,"gross_yield":null,"yield_gross":754800.0,
           "typical_rent":629,"rent":629,"value_trend_1y":null,"zhvi_yoy":0.0},
          {"zip":"10001","zhvi":800000,"yield_gross":3.1,"rent":2100}]}
        """#.utf8)) as? [String: Any]))
        let dowell = try XCTUnwrap(rank.rows.first { $0.zip == "62927" })
        XCTAssertNil(dowell.value, "a rejected home value is never the $1 placeholder")
        XCTAssertNil(dowell.grossYield, "a rejected yield is never 754,800%")
        XCTAssertNil(dowell.change1y)
        XCTAssertEqual(dowell.rent, 629)
        let v1 = try XCTUnwrap(rank.rows.first { $0.zip == "10001" })
        XCTAssertEqual(v1.value, 800_000, "a v1 row without the v2 keys still reads its own columns")
        XCTAssertEqual(v1.grossYield, 3.1)
    }

    func testUnknownZipAndBadSearchAreAnswersNotAnOldDeck() {
        let unknown = DeckFeedParser.state(feed: NationalRoutes.zip("00000"), status: 404, body: Data(#"{"error":"unknown zip"}"#.utf8))
        XCTAssertEqual(unknown, .noRecord, "an unknown ZIP is an answer, not a feed that failed")
        XCTAssertEqual(DeckFeedParser.state(feed: NationalRoutes.summary, status: 404, body: Data()), .notServed)
        let rank = NationalRoutes.rank(NationalRoutes.Scope())
        XCTAssertEqual(DeckFeedParser.state(feed: rank, status: 400, body: Data(#"{"error":"bad sort"}"#.utf8)),
                       .failed("Your deck did not accept this search."))
        XCTAssertEqual(DeckFeedParser.state(feed: rank, status: 200, body: Data(#"{"status":"not_reporting","reason":"x"}"#.utf8)),
                       .notCollected)
    }
}
