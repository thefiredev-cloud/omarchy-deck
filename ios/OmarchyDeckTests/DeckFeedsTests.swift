import Foundation
import XCTest
@testable import OmarchyDeck

/// The native Deck sections read the deck server's `GET /api/<feed>` answers. An unknown is never shown as zero, a
/// missing file reads as "not collected yet", and each HTTP refusal maps to its own state.
final class DeckFeedsTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_793_376_000)

    private func json(_ text: String) -> Data { Data(text.utf8) }

    func testSectionsReadTheirFeeds() {
        XCTAssertEqual(DeckFeedSection.allCases.map(\.title),
                       ["Surf", "Shop", "Real estate", "Housing", "Commercial", "Deals", "Travel", "Outdoors", "Life"])
        XCTAssertEqual(DeckFeedSection.surf.feeds, ["surf-coast"])
        XCTAssertEqual(DeckFeedSection.shop.feeds, ["ecom-market"])
        XCTAssertEqual(DeckFeedSection.deals.feeds, ["ecom"])
        XCTAssertEqual(DeckFeedSection.life.feeds, ["life", "history-goodnews"])
    }

    /// Only the fixed routes are ever requested: the section feeds and one of the 14 surf regions, nothing a feed names.
    func testOnlyFixedRoutesAreAllowed() {
        XCTAssertTrue(DeckFeedNames.isAllowed("surf-coast"))
        XCTAssertTrue(DeckFeedNames.isAllowed("surf-coast/region/orange-county"))
        XCTAssertEqual(DeckFeedNames.path("surf-coast/region/baja-sur"), "/api/surf-coast/region/baja-sur")
        XCTAssertEqual(DeckFeedNames.path("ecom-market"), "/api/ecom-market")
        XCTAssertFalse(DeckFeedNames.isAllowed("surf-coast/region/../../api/lock"))
        XCTAssertFalse(DeckFeedNames.isAllowed("surf-coast/region/hawaii"))
        XCTAssertFalse(DeckFeedNames.isAllowed("lock"))
        XCTAssertEqual(DeckFeedNames.heading("surf-coast/region/monterey-santa-cruz"), "Monterey and Santa Cruz")
    }

    /// A deck whose server predates a route answers 404; a surf file the writer has not made yet answers a status.
    func testNewRoutesNotServedAndNotReporting() {
        XCTAssertEqual(DeckFeedParser.state(feed: "surf-coast", status: 404, body: Data()), .notServed)
        XCTAssertEqual(DeckFeedParser.state(feed: "ecom-market", status: 404, body: Data()), .notServed)
        XCTAssertEqual(DeckFeedParser.state(feed: "surf-coast", status: 200,
                                            body: json(#"{"status":"not_reporting","error":"no file yet"}"#)),
                       .failed("no file yet"))
        XCTAssertEqual(DeckFeedParser.state(feed: "surf-coast", status: 200, body: json(#"{"status":"not_reporting"}"#)),
                       .notCollected)
    }

    func testHttpAnswersMapToStates() {
        XCTAssertEqual(DeckFeedParser.state(feed: "life", status: 401, body: Data()), .signedOut)
        XCTAssertEqual(DeckFeedParser.state(feed: "life", status: 403, body: Data()), .ownerOnly)
        XCTAssertEqual(DeckFeedParser.state(feed: "life", status: 404, body: Data()), .notServed)
        XCTAssertEqual(DeckFeedParser.state(feed: "life", status: 200, body: json(#"{"error":"file missing","stale":true}"#)),
                       .notCollected)
        XCTAssertEqual(DeckFeedParser.state(feed: "life", status: 200, body: json(#"{"error":"bad json"}"#)),
                       .failed("The saved data for this section on your deck is damaged."))
        XCTAssertEqual(DeckFeedParser.state(feed: "life", status: 200, body: json("[]")),
                       .failed("Your deck answered, but this app could not read the answer."))
    }

    func testTravelCardsKeepNullsAndShowRisk() throws {
        let body = #"""
        {"t":1793375100,"stale":false,"sources":["Google Flights"],"errors":[{"source":"kayak","reason":"blocked"}],
         "items":[{"id":"f-1","kind":"flight","category":"positioning","title":"LAX to Athens","subtitle":"2 tickets",
                   "price":627,"currency":"USD","savings_pct":19.8,"route":"LAX-ATH","protected":false,"risk":"Separate tickets",
                   "source_url":"https://www.google.com/travel/flights","as_of":"2026-10-30T15:00:00Z"},
                  {"id":"h-1","kind":"hotel","title":"Tokyo","price":null,"savings_pct":null,"source_url":"javascript:alert(1)"}]}
        """#
        guard case .loaded(let page) = DeckFeedParser.state(feed: "travel-deals", status: 200, body: json(body), now: now) else {
            return XCTFail("a feed with items must load")
        }
        XCTAssertEqual(page.sources.map(\.name), ["Google Flights", "kayak"])
        XCTAssertEqual(page.sources.map(\.state), [.ok, .notReporting], "a failed source is a Data row, never zero items")
        XCTAssertEqual(page.sources[1].note, "blocked")
        XCTAssertFalse(page.stale)
        let flight = page.cards[0]
        XCTAssertEqual(flight.price, "$627")
        XCTAssertEqual(flight.badge, "Save 20%")
        XCTAssertEqual(flight.place, "LAX → ATH")
        XCTAssertEqual(flight.note, "Separate tickets")
        XCTAssertEqual(flight.eyebrow, "Positioning")
        XCTAssertEqual(flight.source, "google.com")
        XCTAssertNotNil(flight.asOf)
        let hotel = page.cards[1]
        XCTAssertNil(hotel.price, "an unknown price is not $0")
        XCTAssertNil(hotel.badge)
        XCTAssertNil(hotel.link, "only http and https links open")
    }

    func testDealsAndMoversFromTheShopFeed() throws {
        let body = #"""
        {"t":1793375100,"stale":false,"sources":["shoptrends"],"errors":[],
         "deals":[{"slug":"x","title":"Headphones","site":"bestbuy","price":198.0,"median":248.0,"vs_median":-0.2016,
                   "url":"https://www.bestbuy.com/x","condition":"new"}],
         "movers":[{"query":"sony oled tv","category":"electronics","median":489.0,"chg7":-0.081},
                   {"query":"ipad air","median":549.0,"chg7":0.034}]}
        """#
        guard case .loaded(let page) = DeckFeedParser.state(feed: "ecom", status: 200, body: json(body)) else {
            return XCTFail("deals must load")
        }
        XCTAssertEqual(page.cards.count, 3)
        XCTAssertEqual(page.cards[0].badge, "20% below the usual price")
        XCTAssertEqual(page.cards[0].source, "Best Buy")
        XCTAssertEqual(page.cards[0].place, "At Best Buy", "the store with the price is content, not provenance")
        XCTAssertNil(page.cards[1].source, "a mover has no store")
        XCTAssertEqual(page.cards[0].subtitle, "New · Usually $248")
        XCTAssertEqual(page.cards[1].badge, "Down 8%")
        XCTAssertEqual(page.cards[1].badgeTone, .good)
        XCTAssertEqual(page.cards[2].badge, "Up 3%")
        XCTAssertEqual(page.cards[2].badgeTone, .caution)
        XCTAssertEqual(page.cards[1].title, "Sony OLED TV")
        XCTAssertEqual(page.cards[2].title, "iPad Air")
    }

    func testLifeJobsTrendsAndHistory() throws {
        let life = #"""
        {"t":1793375100,"items":[
          {"kind":"job","title":"Platform Engineer","pay_min":150000,"pay_max":185000,"org":"Acme","price":null},
          {"kind":"trend","title":"Mortgage rate","value":6.21,"delta_7d_pct":-1.4},
          {"kind":"gas","title":"California regular","price":4.91,"currency":"USD","place":"California","as_of":"2026-10-26"}]}
        """#
        guard case .loaded(let page) = DeckFeedParser.state(feed: "life", status: 200, body: json(life)) else {
            return XCTFail("life must load")
        }
        XCTAssertEqual(page.cards[0].badge, "$150K to $185K", "the web's pay range words")
        XCTAssertEqual(page.cards[0].source, "Acme")
        XCTAssertEqual(page.cards[1].price, "6.21")
        XCTAssertEqual(page.cards[1].badge, "Down 1% in 7 days")
        XCTAssertEqual(page.cards[2].price, "$4.91")
        XCTAssertEqual(page.cards[2].place, "California")
        XCTAssertNotNil(page.cards[2].asOf, "a date-only as_of still parses")
        XCTAssertFalse(page.stale, "staleness is the server's own flag; a timed page it did not flag is not out of date")

        let history = #"""
        {"t":1793375100,"stale":false,"items":[
          {"section":"on_this_day","title":"Radio drama","year":1938,"source":"Wikipedia"},
          {"section":"good_news","title":"Kelp returns","source":"Positive News","published":"2026-10-29T08:00:00Z"},
          {"section":"trend","title":"Child mortality","latest_value":3.7,"unit":"%"}]}
        """#
        guard case .loaded(let news) = DeckFeedParser.state(feed: "history-goodnews", status: 200, body: json(history)) else {
            return XCTFail("history must load")
        }
        XCTAssertEqual(news.cards.map(\.eyebrow), ["On this day, 1938", "Good news", "Trend"])
        XCTAssertEqual(news.cards[1].source, "Positive News")
        XCTAssertEqual(news.cards[2].price, "3.7 %")
    }

    func testBooleansAreNotNumbers() {
        XCTAssertNil(DeckFeedParser.number(true))
        XCTAssertEqual(DeckFeedParser.number(NSNumber(value: 0)), 0, "a measured 0 stays 0")
    }

    func testUpdatedWords() {
        XCTAssertEqual(DeckFeedAge.updated(nil, now: now), "Update time unknown")
        XCTAssertEqual(DeckFeedAge.updated(now.addingTimeInterval(-30), now: now), "Updated just now")
        XCTAssertEqual(DeckFeedAge.updated(now.addingTimeInterval(-900), now: now), "Updated 15 min ago")
        XCTAssertEqual(DeckFeedAge.updated(now.addingTimeInterval(-7200), now: now), "Updated 2 h ago")
    }

    /// Linux JSONSerialization hands back NSNumber for 0 and 1, which Swift also casts to Bool. Real JSON numbers must survive.
    func testJSONZeroAndOneAreNumbersWhileJSONBooleansAreNot() throws {
        let values = try JSONSerialization.jsonObject(with: json("[true,false,0,1,2.5]")) as? [Any]
        let items = try XCTUnwrap(values)
        XCTAssertNil(DeckFeedParser.number(items[0]))
        XCTAssertNil(DeckFeedParser.number(items[1]))
        XCTAssertEqual(DeckFeedParser.number(items[2]), 0)
        XCTAssertEqual(DeckFeedParser.number(items[3]), 1)
        XCTAssertEqual(DeckFeedParser.number(items[4]), 2.5)
    }

    func testMoneyAndPercentWordsOnCards() {
        XCTAssertEqual(DeckMoney.range(120_000, 1_500_000), "$120K to $1.50M", "a pay range in the web's words")
        XCTAssertEqual(DeckMoney.plus(100_000), "$100K+")
        XCTAssertEqual(DeckMoney.range(999, 999), "$999", "one amount when both ends print the same")
        XCTAssertEqual(DeckMoney.short(12.5), "$13", "no cents outside Shop prices")
        XCTAssertEqual(DeckFeedParser.percent(0.2016), "20%")
        XCTAssertEqual(DeckFeedParser.percent(0), "0%")
    }

    /// `Int(1e30)` traps. A feed number is only checked finite, so a huge value must not crash a card.
    func testHugeFeedNumbersDoNotCrashCardBuilding() throws {
        let body = #"""
        {"t":1793375100,"items":[{"id":"a","title":"A","savings_pct":1e30},{"id":"b","title":"B","value":1e300},
                                 {"id":"c","title":"C","delta_7d_pct":-1e300}]}
        """#
        guard case .loaded(let page) = DeckFeedParser.state(feed: "travel-deals", status: 200, body: json(body), now: now) else {
            return XCTFail("a feed with items must load")
        }
        XCTAssertEqual(page.cards.count, 3)
        XCTAssertEqual(page.cards[0].badge, "Save 1000000000000000%")
        let history = #"""
        {"t":1793375100,"items":[{"title":"Y","section":"on_this_day","year":1e30,"latest_value":-1e30}]}
        """#
        guard case .loaded(let past) = DeckFeedParser.state(feed: "history-goodnews", status: 200, body: json(history), now: now) else {
            return XCTFail("a history feed with items must load")
        }
        XCTAssertEqual(past.cards.first?.eyebrow, "On this day, 1000000000000000")
    }

    func testWholeClampsOutOfRangeAndNonFiniteValues() {
        XCTAssertEqual(DeckFeedParser.whole(19.8.rounded()), 20)
        XCTAssertEqual(DeckFeedParser.whole(-3), -3)
        XCTAssertEqual(DeckFeedParser.whole(1e30), 1_000_000_000_000_000)
        XCTAssertEqual(DeckFeedParser.whole(-1e30), -1_000_000_000_000_000)
        XCTAssertEqual(DeckFeedParser.whole(.infinity), 0)
        XCTAssertEqual(DeckFeedParser.whole(.nan), 0)
        XCTAssertEqual(DeckFeedParser.percent(1e30), "1000000000000000%")
    }

    func testSlugsHostsAndStoreNamesReadAsWords() {
        XCTAssertEqual(DeckFeedParser.label("good_news"), "Good news")
        XCTAssertEqual(DeckFeedParser.host("www.google.com"), "google.com")
        XCTAssertEqual(DeckFeedParser.host("deck.example.com"), "deck.example.com")
        XCTAssertEqual(DeckFeedParser.storeName("macys"), "Macy's")
        XCTAssertEqual(DeckFeedParser.storeName("backmarket"), "Back Market")
        XCTAssertEqual(DeckFeedParser.storeName("new_shop"), "New shop")
    }

    func testShopSearchesBecomeProductNamesKeepingBrandCasing() {
        XCTAssertEqual(DeckFeedParser.productName("sony oled tv"), "Sony OLED TV")
        XCTAssertEqual(DeckFeedParser.productName("iphone 16 pro"), "iPhone 16 Pro")
        XCTAssertEqual(DeckFeedParser.productName("kitchenaid mixer"), "KitchenAid Mixer")
    }

    func testTextTrimsAndRejectsBlankOrNonStrings() {
        XCTAssertEqual(DeckFeedParser.text("  Deck \n"), "Deck")
        XCTAssertNil(DeckFeedParser.text(" \n\t "))
        XCTAssertNil(DeckFeedParser.text(""))
        XCTAssertNil(DeckFeedParser.text(42))
        XCTAssertNil(DeckFeedParser.text(nil))
    }

    func testRowsKeepOnlyObjectsFromAList() {
        let mixed: Any = [["id": "a"], "stray", 3, ["id": "b"]] as [Any]
        XCTAssertEqual(DeckFeedParser.rows(mixed).compactMap { $0["id"] as? String }, ["a", "b"])
        XCTAssertTrue(DeckFeedParser.rows(["id": "a"]).isEmpty, "an object is not a list of rows")
        XCTAssertTrue(DeckFeedParser.rows(nil).isEmpty)
    }

    /// A card link opens only http or https. A scheme-less, script, file or host-less value is not a link.
    func testURLsAcceptOnlyWebLinks() {
        XCTAssertEqual(DeckFeedParser.url(" https://example.com/deal ")?.absoluteString, "https://example.com/deal")
        XCTAssertNotNil(DeckFeedParser.url("HTTP://example.com"))
        for bad in ["javascript:alert(1)", "file:///etc/passwd", "ftp://example.com", "example.com", "https://", "  "] {
            XCTAssertNil(DeckFeedParser.url(bad), bad)
        }
        XCTAssertNil(DeckFeedParser.url(nil))
        XCTAssertNil(DeckFeedParser.url(7))
    }

    /// A feed stamps a time as epoch seconds, an ISO time with or without fractions, or a calendar day (UTC midnight).
    func testDatesReadEpochISOAndDayStamps() {
        let afternoon = Date(timeIntervalSince1970: 1_794_672_600)
        XCTAssertEqual(DeckFeedParser.date(1_794_672_600), afternoon)
        XCTAssertEqual(DeckFeedParser.date("2026-11-14T16:10:00Z"), afternoon)
        XCTAssertEqual(DeckFeedParser.date("2026-11-14T16:10:00.250Z"), afternoon.addingTimeInterval(0.25))
        XCTAssertEqual(DeckFeedParser.date("2026-11-14"), Date(timeIntervalSince1970: 1_794_614_400))
        XCTAssertNil(DeckFeedParser.date("not a date"))
        XCTAssertNil(DeckFeedParser.date(nil))
    }

    func testMoneyDropsCentsOnWholeOrLargeAmounts() {
        XCTAssertEqual(DeckFeedParser.money(1_240_000, currency: "USD"), "$1,240,000")
        XCTAssertEqual(DeckFeedParser.money(12, currency: "USD"), "$12")
        XCTAssertEqual(DeckFeedParser.money(79.5, currency: "USD"), "$79.50")
    }

    func testFeedGroupsHaveHeadingsAndCadence() {
        XCTAssertEqual(DeckFeedNames.heading("travel-deals"), "Travel deals")
        XCTAssertEqual(DeckFeedNames.heading("unknown-feed"), "unknown-feed")
        XCTAssertEqual(DeckFeedNames.cadence("ecom"), "every hour")
        XCTAssertEqual(DeckFeedNames.cadence("history-goodnews"), "once a day")
        XCTAssertEqual(DeckFeedNames.cadence("unknown-feed"), "on its own schedule")
    }

    /// On a phone the page no longer prints a section's tagline under a title (the tab names the section); it opens the
    /// Data sheet instead, so every section keeps one plain line: a capital first letter, no em dash, no line break.
    func testEverySectionHasOnePlainLineForItsDataSheet() {
        for section in DeckFeedSection.allCases {
            let line = section.tagline
            XCTAssertFalse(line.isEmpty, section.title)
            XCTAssertEqual(line.first.map { String($0) }, line.first.map { String($0).uppercased() }, line)
            XCTAssertFalse(line.contains("\u{2014}"), line)
            XCTAssertFalse(line.contains("\n"), line)
        }
    }
}
