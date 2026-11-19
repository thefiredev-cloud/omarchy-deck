import Foundation
import XCTest
@testable import OmarchyDeck

/// Best ZIPs columns (owner order 2026-11-17): the nine data points, the Multifamily lens, the catalog-checked `cols=`
/// and the county/metro fallback tags. Fixtures `housing-fields.json` and `housing-rank-cols.json` were captured from the
/// live deck API on 2026-11-17 (catalog entries cut to the columns used; rank rows unchanged).
final class DeckBestZipsTests: XCTestCase {
    private func fixture(_ name: String) throws -> [String: Any] {
        let root = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: root.appendingPathComponent("scripts/fixtures/feeds/\(name).json"))
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func json(_ text: String) throws -> [String: Any] {
        try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
    }

    private func catalog() throws -> NationalCatalog {
        guard case .loaded(let page) = DeckFeedParser.state(feed: NationalRoutes.fields, json: try fixture("housing-fields")),
              let catalog = page.nationalCatalog else {
            throw XCTSkip("the catalog must load")
        }
        return catalog
    }

    private func rank() throws -> NationalRank {
        DeckNationalParser.rank(try fixture("housing-rank-cols"))
    }

    func testRoutesTakeCheckedColsDirectionAndMarketsLists() throws {
        let scope = NationalRoutes.Scope(state: "CA", sort: "days_on_market", dir: "desc")
        let feed = NationalRoutes.rank(scope, cols: ["city", "days_on_market", "affordability"])
        XCTAssertTrue(DeckFeedNames.isAllowed(feed))
        XCTAssertEqual(Set(DeckFeedNames.query(feed).map { "\($0.name)=\($0.value ?? "")" }),
                       ["kind=housing", "sort=days_on_market", "dir=desc", "limit=50", "state=CA", "cols=city,days_on_market,affordability"])
        XCTAssertEqual(NationalRoutes.rank(NationalRoutes.Scope(), cols: []), NationalRoutes.rank(NationalRoutes.Scope()),
                       "no columns asks for the server's default row")
        XCTAssertTrue(DeckFeedNames.isAllowed(NationalRoutes.fields))
        XCTAssertEqual(DeckFeedNames.path(NationalRoutes.fields), "/api/housing/fields")
        XCTAssertTrue(DeckFeedNames.isAllowed(NationalRoutes.segments))
        let list = NationalRoutes.list(part: "metros", keys: ["cbsa", "name", "gross_yield"], state: "CA")
        XCTAssertTrue(DeckFeedNames.isAllowed(list))
        XCTAssertEqual(DeckFeedNames.path(list), "/api/housing/national")
        XCTAssertEqual(Set(DeckFeedNames.query(list).map { "\($0.name)=\($0.value ?? "")" }),
                       ["part=metros", "state=CA", "fields=cbsa,name,gross_yield"])
        let tooMany = (0...100).map { "f\($0)" }
        let tooManyCols = (0...200).map { "c\($0)" }
        for bad in ["housing/rank?kind=housing&sort=score&limit=50&cols=City",
                    "housing/rank?kind=housing&sort=score&limit=50&cols=a,a",
                    "housing/rank?kind=housing&sort=score&limit=50&cols=",
                    "housing/rank?kind=housing&sort=score&limit=50&cols=" + tooManyCols.joined(separator: ","),
                    "housing/rank?kind=housing&sort=score&limit=50&dir=up",
                    "housing/rank?kind=housing&sort=yield&limit=50",
                    "housing/rank?kind=housing&sort=acs_units_2_4_share&limit=50",
                    "housing/national?part=states", "housing/national?part=states&fields=state,../x",
                    "housing/national?part=metros&fields=" + tooMany.joined(separator: ","),
                    "housing/national?part=states&state=ZZ&fields=state", "housing/national?part=segments&state=CA",
                    "housing/national?part=metrics", "housing/fields?x=1", "housing/national?part=states&fields=a&fields=b"] {
            XCTAssertFalse(DeckFeedNames.isAllowed(bad), bad)
        }
    }

    /// The rank route refuses any `cols=` name its ZIP table lacks (400 bad cols): the app asks only for columns the
    /// catalog marks `in_zips`, and asks for none on v1 data.
    func testCatalogDecidesWhichColumnsTheRankReadAsksFor() throws {
        let catalog = try catalog()
        XCTAssertTrue(catalog.isV2)
        let cols = try XCTUnwrap(BestZips.rankCols(catalog))
        XCTAssertEqual(Array(cols.prefix(5)), ["city", "state", "area_grade", "h_score", "h_conf"])
        for wanted in ["home_value", "value_trend_1y", "typical_rent", "gross_yield", "days_on_market", "price_cuts", "inventory",
                       "affordability", "multifamily_score", "multifamily_conf", "rent_trend_1y", "acsmf_renter_5plus_share",
                       "acs_units_5plus_share", "acs_units_2_4_share", "acs_vacant_for_rent_share", "bps_units_5plus_12m",
                       "cap_spread_multifamily", "home_value_conf", "typical_rent_conf"] {
            XCTAssertTrue(cols.contains(wanted), wanted)
        }
        for refused in ["gross_yield_conf", "days_on_market_conf", "value_trend_1y_conf", "zm_zori_mf_yoy"] {
            XCTAssertFalse(cols.contains(refused), "\(refused) is in the catalog but not in the ZIP table")
        }
        XCTAssertTrue(cols.allSatisfy(catalog.inZips.contains))
        XCTAssertEqual(Set(cols).count, cols.count)
        XCTAssertTrue(DeckFeedNames.isAllowed(NationalRoutes.rank(NationalRoutes.Scope(), cols: cols)))
        let v1 = DeckNationalParser.catalog(try json(#"{"dataset":"v1","fields":[],"reason":"still v1"}"#))
        XCTAssertNil(BestZips.rankCols(v1), "v1 data takes no cols")
        XCTAssertNil(BestZips.rankCols(nil), "a deck without the catalog takes no cols")
    }

    func testResidentialLensShowsTheOwnersDataPointsInOrder() throws {
        let rank = try rank()
        XCTAssertTrue(rank.isV2)
        let columns = BestZips.columns(.residential, isV2: true, have: rank.have)
        XCTAssertEqual(columns.map(\.label), ["Home value", "1-yr change", "Rent", "Gross yield", "Days to sell", "Price cuts",
                                              "Inventory", "Payment to income"])
        let row = try XCTUnwrap(rank.rows.first { $0.zip == "79607" })
        let cells = Dictionary(uniqueKeysWithValues: columns.map { ($0.key, BestZips.cell(row, $0, isV2: true)) })
        XCTAssertEqual(cells["value"]?.text, "$256K")
        XCTAssertNotNil(cells["value"]?.confidence, "a blended value carries its meter")
        XCTAssertEqual(cells["rent"]?.text, "$2,556/mo")
        XCTAssertEqual(cells["yield"]?.text, "11.99%", "a yield reads with two places, as the web's rate")
        XCTAssertEqual(cells["days"]?.text, "22\u{00A0}days")
        XCTAssertEqual(cells["cuts"]?.text, "25.2%")
        XCTAssertEqual(cells["afford"]?.text, "23.6%")
        XCTAssertNil(cells["inv"]?.text, "no inventory: a dash, never 0 homes")
        XCTAssertEqual(cells["inv"]?.spoken, "Inventory: not reported for this ZIP. Open the ZIP to see why.")
        XCTAssertFalse(columns.contains { $0.label == "30-yr rate" }, "the national rate is not a ZIP column")

        guard case .loaded(let summaryPage) = DeckFeedParser.state(feed: NationalRoutes.summary,
                                                                   json: try fixture("housing-national-summary")) else {
            return XCTFail("the summary must load")
        }
        XCTAssertEqual(BestZips.rateLine(summaryPage.national), "30-yr rate 7.11% \u{00B7} Nov 12, 2026", "once, in the header")
        XCTAssertNil(BestZips.rateLine(nil))
    }

    /// The county or metro figure that stands in for a ZIP's own is tagged from the rank row's `from` map, never shown
    /// as the ZIP's own figure; a missing value carries no tag.
    func testFallbackValuesAreTaggedCountyOrMetro() throws {
        let rank = try rank()
        let columns = BestZips.columns(.residential, isV2: true, have: rank.have)
        let row = try XCTUnwrap(rank.rows.first { $0.zip == "79607" })
        let days = try XCTUnwrap(columns.first { $0.key == "days" })
        XCTAssertEqual(BestZips.cell(row, days, isV2: true).from, "county")
        XCTAssertEqual(BestZips.fromTag("county"), "county value")
        XCTAssertTrue(BestZips.cell(row, days, isV2: true).spoken.contains("county value, not this ZIP's own figure"))
        let value = try XCTUnwrap(columns.first { $0.key == "value" })
        XCTAssertNil(BestZips.cell(row, value, isV2: true).from, "the ZIP's own value carries no tag")

        let synthetic = DeckNationalParser.rank(try json(#"""
        {"dataset":"v2","cols":["zip","inventory","price_cuts","home_value","affordability"],"rows":[
          {"zip":"92629","inventory":77,"price_cuts":null,"home_value":1794052,"affordability":79.86,
           "from":{"inventory":"metro","price_cuts":"county","home_value":"state","affordability":7}}]}
        """#))
        let mixed = try XCTUnwrap(synthetic.rows.first)
        let all = BestZips.columns(.residential, isV2: true, have: synthetic.have)
        func cell(_ key: String) throws -> BestZipCell { BestZips.cell(mixed, try XCTUnwrap(all.first { $0.key == key }), isV2: true) }
        XCTAssertEqual(try cell("inv").from, "metro")
        XCTAssertEqual(try cell("inv").text, "77\u{00A0}homes")
        XCTAssertNil(try cell("cuts").text, "a missing value is a dash")
        XCTAssertNil(try cell("cuts").from, "a dash carries no tag")
        XCTAssertNil(try cell("value").from, "only county and metro are area values")
        XCTAssertNil(try cell("afford").from)
        XCTAssertEqual(all.map(\.key), ["value", "cuts", "inv", "afford"], "columns the answer lacks are left out")

        // The ZIP sheet reads the same mark from `m[key].from` (live ZIP 79607, 2026-11-17); anything else is ignored.
        let zip = try XCTUnwrap(DeckNationalParser.zip(try json(#"""
        {"zip":"79607","m":{"days_on_market":{"v":22.0,"c":0.4,"from":"county"},"price_cuts":{"v":25.18,"from":"metro"},
         "home_value":{"v":255859,"c":0.57},"gross_yield":{"v":null,"reason":"placeholder","from":"home_value"}}}
        """#)))
        let market = try XCTUnwrap(zip.sections.first { $0.title == "Market" })
        XCTAssertEqual(market.facts.first { $0.key == "days_on_market" }?.from, "county")
        XCTAssertEqual(market.facts.first { $0.key == "price_cuts" }?.from, "metro")
        XCTAssertNil(zip.tiles.first { $0.key == "home_value" }?.from)
        XCTAssertNil(zip.tiles.first { $0.key == "gross_yield" }?.from, "a rejected value names no area")
    }

    func testMultifamilyLensReadsRentersUnitMixVacancyPermitsAndCapSpread() throws {
        let rank = try rank()
        let columns = BestZips.columns(.multifamily, isV2: true, have: rank.have)
        XCTAssertEqual(columns.map(\.label), ["Multifamily score", "Rent", "Rent 1-yr", "Renters in 5+ unit buildings",
                                              "2-4 unit share", "Vacant for rent", "Units permitted 5+", "MF cap spread"])
        let dana = try XCTUnwrap(rank.rows.first { $0.zip == "92629" })
        let cells = columns.map { BestZips.cell(dana, $0, isV2: true).text }
        XCTAssertEqual(cells, ["56", "$4,113/mo", "+5.5%", "37.9%", "18.3%", "1.7%", "24\u{00A0}units", nil],
                       "no asking cap spread for Dana Point: a dash")
        let dyess = try XCTUnwrap(rank.rows.first { $0.zip == "79607" })
        let vacant = try XCTUnwrap(columns.first { $0.key == "vac" })
        XCTAssertEqual(BestZips.cell(dyess, vacant, isV2: true).text, "0.0%", "a reported zero is a value, not a dash")
        let score = try XCTUnwrap(columns.first { $0.key == "mf" })
        XCTAssertNil(BestZips.cell(dyess, score, isV2: true).text)

        // A deck whose ZIP table has no renter share falls back to all homes in 5+ unit buildings, relabelled, and a
        // column the table lacks is hidden, never drawn empty.
        let narrow = BestZips.columns(.multifamily, isV2: true,
                                      have: ["zip", "multifamily_score", "typical_rent", "acs_units_5plus_share"])
        XCTAssertEqual(narrow.map(\.label), ["Multifamily score", "Rent", "Homes in 5+ unit buildings"])
        XCTAssertEqual(narrow.last?.field, "acs_units_5plus_share")
        XCTAssertEqual(narrow.last?.help, "All homes in buildings with 5 or more units.")
    }

    func testSortsFollowTheCatalogAndTheLens() throws {
        let catalog = try catalog()
        XCTAssertEqual(BestZips.sorts(.residential, catalog: catalog).map(\.key),
                       ["score", "price", "change_1y", "rent", "gross_yield", "days_on_market", "price_cuts", "inventory", "affordability"])
        XCTAssertEqual(BestZips.sorts(.multifamily, catalog: catalog).map(\.key), ["multifamily_score", "rent", "rent_trend_1y"],
                       "shares, permits and the cap spread are not rankable: they do not sort")
        XCTAssertEqual(BestZips.sorts(.residential, catalog: nil).map(\.key), ["score", "price", "change_1y", "rent", "gross_yield"],
                       "without the catalog only the server's aliases sort")
        XCTAssertEqual(BestZips.lensSort(.multifamily, sort: "days_on_market", catalog: catalog), "multifamily_score")
        XCTAssertEqual(BestZips.lensSort(.multifamily, sort: "rent", catalog: catalog), "rent", "a sort both lenses have stays")
        XCTAssertEqual(BestZips.lensSort(.residential, sort: "multifamily_score", catalog: catalog), "score")
        XCTAssertEqual(BestZips.sortLine("days_on_market", direction: "asc"), "Sorted by days to sell, lowest first")
        XCTAssertEqual(BestZips.sortLine("price", direction: BestZips.direction(nil, sort: "price")),
                       "Sorted by home value, lowest first")
        XCTAssertEqual(BestZips.direction(nil, sort: "score"), "desc")
        let echoed = DeckNationalParser.rank(try json(#"{"dataset":"v2","sort":"days_on_market","sort_dir":"desc","rows":[]}"#))
        XCTAssertEqual(BestZips.direction(echoed, sort: "days_on_market"), "desc", "the server's echo wins")
        for sort in BestZips.sorts(.residential, catalog: catalog).map(\.key) {
            XCTAssertTrue(DeckFeedNames.isAllowed(NationalRoutes.rank(NationalRoutes.Scope(sort: sort, dir: "asc"))), sort)
        }
    }

    /// A v1 answer (no `cols`) fills the columns from its own columns; a v2 column a row carries as null is a value the
    /// build rejected and stays a dash, never the raw v1 column.
    func testV1AnswerFillsColumnsFromItsOwnColumns() throws {
        let rank = DeckNationalParser.rank(try json(#"""
        {"total":2,"rows":[
          {"zip":"10001","zhvi":800000,"zhvi_yoy":2.5,"rent":2100,"yield_gross":3.1,"dom":44,"price_cut_share":12.5,"active":31},
          {"zip":"62927","home_value":null,"zhvi":1,"yield_gross":754800.0,"gross_yield":null,"dom":41,"active":2}]}
        """#))
        XCTAssertFalse(rank.isV2)
        let columns = BestZips.columns(.residential, isV2: false, have: rank.have)
        XCTAssertEqual(columns.map(\.label), ["Home value", "1-yr change", "Rent", "Gross yield", "Days to sell", "Price cuts", "Inventory"],
                       "Payment to income has no v1 column")
        let v1 = try XCTUnwrap(rank.rows.first)
        XCTAssertEqual(columns.map { BestZips.cell(v1, $0, isV2: false).text },
                       ["$800K", "+2.5%", "$2,100/mo", "3.10%", "44\u{00A0}days", "12.5%", "31\u{00A0}homes"])
        let rejected = try XCTUnwrap(rank.rows.last)
        let value = try XCTUnwrap(columns.first { $0.key == "value" })
        let yield = try XCTUnwrap(columns.first { $0.key == "yield" })
        XCTAssertNil(BestZips.cell(rejected, value, isV2: false).text, "never the $1 placeholder")
        XCTAssertNil(BestZips.cell(rejected, yield, isV2: false).text, "never 754,800%")
        XCTAssertNil(BestZips.cell(v1, value, isV2: false).confidence, "a v1 answer carries no meter")
    }

    func testFormatsMatchTheWeb() {
        XCTAssertEqual(BestZips.format(1, .homes), "1\u{00A0}home")
        XCTAssertEqual(BestZips.format(12_400, .units), "12.4K\u{00A0}units")
        XCTAssertEqual(BestZips.format(0.75, .points), "+0.8 pt")
        XCTAssertEqual(BestZips.format(-2.25, .change), "\u{2212}2.3%")
        XCTAssertEqual(BestZips.format(56.4, .score), "56")
        XCTAssertEqual(NationalWords.count(1_000_000), "1.0M")
        XCTAssertEqual(NationalWords.count(9_999), "9,999")
        XCTAssertEqual(NationalWords.count(0), "0")
        XCTAssertEqual(BestZips.dash, "-")
        XCTAssertEqual(Array(BestZips.help(BestZips.residential, rate: true).map(\.term).suffix(4)),
                       ["30-yr rate", "Meter after a value", "A dash", "County or metro value"])
    }
}
