import Foundation
import XCTest
@testable import OmarchyDeck

/// Housing reads the deck's `GET /api/realestate` and `GET /api/housing/profile`. Same words and rules as the web page:
/// an unknown prints the missing mark, 55+ homes stay hidden behind a counted note, and a repeated listing counts once.
final class DeckHousingTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_794_600_000)

    private func object(_ text: String) throws -> [String: Any] {
        try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
    }

    private func housing(_ text: String) throws -> HousingPage {
        DeckHousingParser.page(from: try object(text), now: now)
    }

    func testMoneyWordsMatchTheWebDeck() {
        XCTAssertEqual(DeckMoney.short(1_790_154.98), "$1.79M")
        XCTAssertEqual(DeckMoney.short(927_400), "$927K")
        XCTAssertEqual(DeckMoney.short(850), "$850")
        XCTAssertEqual(DeckMoney.short(2_900_000), "$2.90M", "the trailing zero stays, as on the web")
        XCTAssertEqual(DeckMoney.short(1_000_000), "$1.00M")
        XCTAssertEqual(DeckMoney.short(12_000_000), "$12.00M")
        XCTAssertEqual(DeckMoney.short(350_400), "$350K")
        XCTAssertEqual(DeckMoney.short(-50), "\u{2212}$50")
        XCTAssertEqual(RealEstateWords.count(nil), DeckMissing.cell)
        XCTAssertEqual(RealEstateWords.count(1_406_624), "1,406,624")
        XCTAssertEqual(RealEstateWords.signed(7.06), "+7.1%")
        XCTAssertEqual(RealEstateWords.signed(-2.19), "\u{2212}2.2%")
        XCTAssertEqual(RealEstateWords.percent(nil), DeckMissing.cell)
        XCTAssertEqual(RealEstateWords.multiple(1.994), "1.99x")
        XCTAssertEqual(RealEstateWords.day(1_794_600_000), "2026-11-13")
        XCTAssertEqual(RealEstateWords.day(nil), "")
    }

    func testMarketRowsReadLikeTheWebList() throws {
        let page = try housing(#"""
        {"market":{"area":"South Orange County","residential":{"areas":[
          {"slug":"zip-90001","name":"Sample Cove","tier":"home","zip":"90001",
           "zhvi":{"value":1790154.98,"as_of":"2026-09-30","yoy_pct":7.06},
           "list_price":{"value":2230833},"sale_price":{"value":1856500},"active_listings":77,"days_on_market":68},
          {"slug":"united-states","name":"United States","tier":"us",
           "zhvi":{"value":366157,"as_of":"2026-09-30","yoy_pct":-2.19},
           "inventory":{"value":1406624},"list_price":{"value":403300},"sale_price":{"value":375000},
           "days_to_pending":{"value":27}},
          {"slug":"no-zhvi","name":"Empty Area","tier":"la"}]}}}
        """#)
        XCTAssertEqual(page.area, "South Orange County")
        XCTAssertEqual(page.markets.count, 3)
        let zip = page.markets[0]
        XCTAssertEqual(zip.name, "Sample Cove")
        XCTAssertEqual(zip.tier, "Home ZIP 90001")
        XCTAssertEqual(zip.value, "$1.79M")
        XCTAssertEqual(zip.change, "+7.1% 1-yr")
        XCTAssertEqual(zip.detail, "77 homes for sale · list price $2.23M · sale price $1.86M · 68 days to sell")
        XCTAssertEqual(zip.asOf, "Zillow ZHVI as of 2026-09-30")
        let us = page.markets[1]
        XCTAssertEqual(us.detail, "1,406,624 homes for sale · list price $403K · sale price $375K · 27 days to pending")
        XCTAssertEqual(us.change, "\u{2212}2.2% 1-yr")
        let empty = page.markets[2]
        XCTAssertNil(empty.value, "an area with no index never reads as $0")
        XCTAssertEqual(empty.detail, "no public numbers for this area")
        XCTAssertEqual(empty.tier, "LA County")
    }

    func testAFeedWithoutAreaSeriesFallsBackToOneMedianRow() throws {
        let page = try housing(#"{"market":{"area":"Sample County","median_list_price":1399000,"at":1794600000,"source":"auction.com"}}"#)
        XCTAssertEqual(page.markets.count, 1)
        XCTAssertEqual(page.markets[0].value, "$1.40M")
        XCTAssertEqual(page.markets[0].detail, "Sample County · median list price $1.40M · auction.com")
        XCTAssertEqual(page.markets[0].asOf, "as of 2026-11-13")
        XCTAssertTrue(try housing(#"{"market":{}}"#).markets.isEmpty)
    }

    func testRatesAndNationalSeriesKeepTheirSourcesAndUnknowns() throws {
        let page = try housing(#"""
        {"market":{"mortgage":{"rate_30y":{"value":7.11,"as_of":"2026-11-12"}},
         "commercial_indicators":{
           "price_growth":{"value":6.58,"as_of":"2026-01-01"},"loan_balance_bn":{"value":3140.24,"as_of":"2026-09-01"},
           "multifamily_starts":{"value":349,"as_of":"2026-09-01"},
           "vacancy":{"status":"unavailable","reason":"No free public metro series. Check back later."}}}}
        """#)
        XCTAssertEqual(page.rates.map(\.label), ["30-year fixed", "15-year fixed"])
        XCTAssertEqual(page.rates[0].value, "7.11%")
        XCTAssertEqual(page.rates[0].source, "FRED 2026-11-12")
        XCTAssertNil(page.rates[1].value, "a missing 15-year rate reads No data, not 0%")
        XCTAssertEqual(page.rates[1].source, "FRED no date")
        let byLabel = Dictionary(uniqueKeysWithValues: page.indicators.map { ($0.label, $0) })
        XCTAssertEqual(byLabel["CRE price growth"]?.value, "6.6% /yr")
        XCTAssertEqual(byLabel["CRE bank loans"]?.value, "$3.14T")
        XCTAssertEqual(byLabel["Starts, 5+ units"]?.value, "349K /yr")
        XCTAssertNil(byLabel["CRE delinquency"]?.value)
        XCTAssertEqual(byLabel["CRE delinquency"]?.source, "Federal Reserve via FRED · not reported")
        XCTAssertEqual(page.unavailable, ["Office and industrial vacancy: No free public metro series."])
    }

    func testFirstSentenceCutsAtTheFirstStop() {
        XCTAssertEqual(DeckHousingParser.firstSentence("One. Two."), "One.")
        XCTAssertEqual(DeckHousingParser.firstSentence("Version 1.5 is out. More"), "Version 1.5 is out.")
        XCTAssertEqual(DeckHousingParser.firstSentence("No stop here"), "No stop here")
    }

    func testAgeRestrictedHomesAreCountedAndExplained() throws {
        let rows = (0..<12).map { #"{"addr":"\#($0) Senior Way","detail":"Sample Villas (55+ community)"}"# }.joined(separator: ",")
        let page = try housing(#"""
        {"market":{"age_restricted":{"hidden":35,"by_reason":{"list":33,"text":2},"rows":[\#(rows)],
         "list":{"communities":81,"learned":5},"as_of":"2026-11-13"}}}
        """#)
        let note = try XCTUnwrap(page.ageNote)
        XCTAssertEqual(note.headline,
                       "35 age-restricted homes hidden (55+, 62+ and senior communities): 33 on the 55+ list, 2 listing text.")
        XCTAssertEqual(note.rows.count, 10, "the web page lists the first ten")
        XCTAssertEqual(note.rows[0].line, "0 Senior Way. Sample Villas (55+ community)")
        XCTAssertEqual(note.footnote,
                       "List: 81 communities from the OC Office on Aging park and senior apartment lists and named 55+ communities, plus 5 learned from listing pages. Checked 2026-11-13.")
        let one = try housing(#"{"market":{"age_restricted":{"hidden":1,"by_reason":{}}}}"#)
        XCTAssertEqual(one.ageNote?.headline, "1 age-restricted home hidden (55+, 62+ and senior communities).")
        XCTAssertNil(try housing(#"{"market":{}}"#).ageNote, "no note when the feed has no age data")
    }

    /// `Int(_:)` traps outside its range. A feed number is only checked finite, so 1e30 must print, not crash.
    func testHugeFeedNumbersDoNotTrapTheMoneyWordsOrTheAgeNote() throws {
        XCTAssertTrue(DeckMoney.short(-1e30).hasPrefix("\u{2212}$"))
        XCTAssertEqual(RealEstateWords.count(1e30), "1,000,000,000,000,000")
        let note = try housing(#"{"market":{"age_restricted":{"hidden":1e30,"by_reason":{"list":1e30}}}}"#)
        XCTAssertNotNil(note.ageNote, "a huge count still yields a note")
        XCTAssertEqual(note.ageNote?.headline.contains("1000000000000000 on the 55+ list"), true)
    }

    func testHomesAreNewestFirstDeduplicatedAndFilterable() throws {
        let page = try housing(#"""
        {"homes":[
          {"addr":"1 Old Rd","city":"Cove","price":400000,"beds":2,"baths":1.5,"sqft":900,"listed_at":1000,"source":"redfin","url":"https://example.com/1"},
          {"addr":"2 New Rd","city":"Bay","price":900000,"beds":3,"baths":2,"sqft":1500,"listed_at":2000,"source":"zillow"},
          {"addr":"1 Old Rd","city":"Cove","price":400000,"beds":2,"baths":1.5,"sqft":900,"listed_at":1000,"source":"zillow"},
          {"city":"Bay","price":null,"beds":1},
          {"addr":"3 Undated Rd","city":"Cove","price":300000}],
         "commercial":[{"id":"a"},{"id":"b"}]}
        """#)
        XCTAssertEqual(page.homes.count, 4, "a repeated listing counts once")
        XCTAssertEqual(page.commercialCount, 2)
        XCTAssertEqual(page.homes.first?.title, "$900K · 2 New Rd")
        XCTAssertEqual(page.homes.first?.subtitle, "Bay · 3 BR · 2 BA · 1,500 SF", "the web's listing words")
        XCTAssertEqual(page.homes[1].subtitle, "Cove · 2 BR · 1.5 BA · 900 SF")
        XCTAssertEqual(page.homes[1].link?.absoluteString, "https://example.com/1")
        XCTAssertEqual(page.homes.map(\.id).count, Set(page.homes.map(\.id)).count)
        XCTAssertEqual(page.homes[2].title, "Price not listed · address withheld", "an unknown price is never $0")
        XCTAssertEqual(page.homes.last?.title, "$300K · 3 Undated Rd", "undated listings follow the dated ones in feed order")
        // A price ceiling never passes an unknown price; the city filter is exact.
        XCTAssertEqual(page.homes(within: 500_000, city: nil).map(\.title), ["$400K · 1 Old Rd", "$300K · 3 Undated Rd"])
        XCTAssertEqual(page.homes(within: nil, city: "Bay").count, 2)
        XCTAssertEqual(page.cities, ["Bay", "Cove"], "equal counts sort by name")
    }

    func testHomeListStartsWithEightAndCapsExpandedRowsAtTwenty() {
        XCTAssertEqual(HousingHomeList.visibleCount(total: 0, expanded: false), 0)
        XCTAssertEqual(HousingHomeList.visibleCount(total: 8, expanded: false), 8)
        XCTAssertEqual(HousingHomeList.visibleCount(total: 25, expanded: false), 8)
        XCTAssertEqual(HousingHomeList.visibleCount(total: 8, expanded: true), 8)
        XCTAssertEqual(HousingHomeList.visibleCount(total: 25, expanded: true), 20)
    }

    func testHomeListOffersOnlyTheRowsThatCanBeShown() {
        XCTAssertEqual(HousingHomeList.additionalCount(total: 8), 0)
        XCTAssertEqual(HousingHomeList.additionalCount(total: 9), 1)
        XCTAssertEqual(HousingHomeList.additionalCount(total: 20), 12)
        XCTAssertEqual(HousingHomeList.additionalCount(total: 25), 12)
    }

    func testBudgetNeedsAPositiveNumber() throws {
        let budget = DeckHousingParser.budget(from: try object(#"{"budget":{"budget":1000000,"basis":"income"}}"#))
        XCTAssertEqual(budget, HousingBudget(amount: 1_000_000, basis: "income"))
        XCTAssertEqual(budget?.summary, "$1.00M (income)")
        XCTAssertNil(DeckHousingParser.budget(from: try object(#"{"budget":{"budget":null,"basis":null}}"#)))
        XCTAssertNil(DeckHousingParser.budget(from: try object(#"{"budget":{"budget":0}}"#)))
        XCTAssertNil(DeckHousingParser.budget(from: try object(#"{"profile":{}}"#)))
    }

    func testStateRoutesRealEstateAndProfileFeeds() throws {
        let realestate = DeckFeedParser.state(feed: "realestate", status: 200,
                                              body: Data(#"{"t":1794600000,"stale":false,"src":["A","B"],"homes":[],"market":{}}"#.utf8))
        guard case .loaded(let page) = realestate else { return XCTFail("realestate must load") }
        XCTAssertNotNil(page.housing)
        XCTAssertEqual(page.sources.map(\.name), ["A", "B"], "the realestate feed names its sources under src")
        XCTAssertFalse(page.stale)
        let profile = DeckFeedParser.state(feed: "housing-profile", status: 200,
                                           body: Data(#"{"t":1794600000,"budget":{"budget":850000,"basis":"cash"}}"#.utf8))
        guard case .loaded(let budgetPage) = profile else { return XCTFail("the budget must load") }
        XCTAssertEqual(budgetPage.budget?.amount, 850_000)
        XCTAssertEqual(DeckFeedParser.state(feed: "housing-profile", status: 403, body: Data()), .ownerOnly)
    }

    func testRoutesAreFixedAndReadOnly() {
        XCTAssertEqual(DeckFeedNames.path("realestate"), "/api/realestate")
        XCTAssertEqual(DeckFeedNames.path("housing-profile"), "/api/housing/profile")
        XCTAssertEqual(DeckFeedNames.path("cre"), "/api/cre")
        XCTAssertEqual(DeckFeedNames.path("life"), "/api/life")
        XCTAssertEqual(DeckFeedNames.query("cre"), [URLQueryItem(name: "person", value: "tanner")],
                       "the app only ever asks for the owner's own desk")
        XCTAssertTrue(DeckFeedNames.query("realestate").isEmpty)
        XCTAssertGreaterThan(DeckFeedNames.timeout("realestate"), DeckFeedNames.timeout("life"))
        XCTAssertEqual(DeckFeedSection.housing.feeds, ["realestate", "housing-profile"])
        XCTAssertEqual(DeckFeedSection.commercial.feeds, ["cre", "housing-profile", "realestate"])
    }
}
