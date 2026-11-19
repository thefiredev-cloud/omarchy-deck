import Foundation
import XCTest
@testable import OmarchyDeck

/// Shop reads `GET /api/ecom-market`. The fixture is cut from the EcomMarket lane's staged feed of 2026-11-14 (rows
/// dropped, values unchanged). Numbers keep their units and periods, nulls stay nil, and blended numbers carry a mark.
final class DeckShopTests: XCTestCase {
    private func market() throws -> (ShopMarket, DeckFeedPage) {
        let root = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: root.appendingPathComponent("scripts/fixtures/feeds/ecom-market.json"))
        guard case .loaded(let page) = DeckFeedParser.state(feed: "ecom-market", status: 200, body: data),
              let shop = page.shop else {
            throw XCTSkip("the shop fixture must load")
        }
        return (shop, page)
    }

    func testStripFollowsTheBlueprintOrderWithUnitsAndPeriods() throws {
        let (shop, _) = try market()
        XCTAssertEqual(shop.strip(wide: false).map(\.key),
                       ["ecom_share", "ecom_sales", "retail_sales", "cpi_core_goods", "container_wci", "diesel"])
        XCTAssertEqual(shop.strip(wide: true).count, 8)
        let share = try XCTUnwrap(shop.macro.first { $0.key == "ecom_share" })
        XCTAssertEqual(share.valueText, "17.1%")
        XCTAssertEqual(share.changeText, "+0.8 pt 1-yr")
        XCTAssertEqual(share.periodText, "Q2 2026")
        let sales = try XCTUnwrap(shop.macro.first { $0.key == "ecom_sales" })
        XCTAssertEqual(sales.valueText, "$340.2B", "usd_m is millions")
        XCTAssertEqual(sales.changeText, "+12.2% 1-yr")
        let diesel = try XCTUnwrap(shop.macro.first { $0.key == "diesel" })
        XCTAssertEqual(diesel.valueText, "$6.13/gal")
        XCTAssertEqual(diesel.periodText, "Nov 9")
        let box = try XCTUnwrap(shop.macro.first { $0.key == "container_wci" })
        XCTAssertEqual(box.valueText, "$4,305/box")
        XCTAssertEqual(box.changeText, "\u{2212}2.0%", "no year-over-year: the change from the prior week")
        XCTAssertEqual(shop.macro.count, 28)
        XCTAssertEqual(shop.otherMacro.count, 20)
    }

    func testWatchesKeepMedianRangeBestStoreAndConfidence() throws {
        let (shop, _) = try market()
        XCTAssertEqual(shop.watches.count, 13)
        let rtx = try XCTUnwrap(shop.watches.first { $0.slug == "rtx-4080" })
        XCTAssertEqual(rtx.name, "RTX 4080")
        XCTAssertEqual(rtx.median.map { DeckMoney.price($0) }, "$1,200")
        XCTAssertEqual(rtx.bestPrice.map { DeckMoney.price($0) }, "$880", "the web prints cents only under $100")
        XCTAssertEqual(rtx.bestPlatform, "Newegg")
        XCTAssertEqual(ShopWords.percent(rtx.change7), "\u{2212}14.3%")
        XCTAssertNil(rtx.change30, "a 30-day change the feed has not stored stays nil")
        XCTAssertEqual(rtx.confidence?.confidence.dots, 2)
        XCTAssertEqual(rtx.confidence?.reasons.first, "3 of 6 sites")
        XCTAssertFalse(rtx.hist.isEmpty)
        XCTAssertEqual(rtx.byPlatform.map(\.median), rtx.byPlatform.map(\.median).sorted(), "cheapest store first")
    }

    func testProductsMergeBestSellersAndMoversWithKindWords() throws {
        let (shop, _) = try market()
        let all = shop.products(category: nil)
        XCTAssertEqual(Set(all.map(\.id)).count, all.count, "a product shows once")
        XCTAssertEqual(all.first?.kindWord, "Price drop", "price moves lead, sales trail")
        XCTAssertEqual(Set(shop.movers.map(\.kindWord)), ["Price drop", "Price up", "On sale", "Under median"])
        let grill = try XCTUnwrap(shop.movers.first { $0.title.hasPrefix("Traeger") })
        XCTAssertEqual(ShopWords.percent(grill.changePct), "\u{2212}20.1%")
        XCTAssertEqual(grill.cheapest?.platform, "Walmart")
        XCTAssertEqual(grill.cheapest?.regular, 999.99, "the reference price stands in for a missing regular price")
        XCTAssertFalse(grill.isBlended, "one store's price is a raw reading and carries no mark")
        let games = shop.products(category: "games")
        XCTAssertFalse(games.isEmpty)
        XCTAssertTrue(games.allSatisfy { $0.category == "games" })
        XCTAssertTrue(shop.categoryChips.contains("games"))
    }

    func testCategoriesBlendPartsAndSayWhenTheIndexIsBuilding() throws {
        let (shop, _) = try market()
        XCTAssertEqual(shop.categories.count, 10)
        let computers = try XCTUnwrap(shop.categories.first { $0.key == "computers" })
        XCTAssertEqual(ShopWords.percent(computers.value), "+0.6%")
        XCTAssertEqual(computers.confidence?.confidence.dots, 2)
        XCTAssertEqual(computers.building, "Building · 6 of 14 days")
        XCTAssertEqual(computers.parts.first?.weight, "weight 1.00")
        let games = try XCTUnwrap(shop.categories.first { $0.key == "games" })
        XCTAssertNil(games.value, "a category with no trend stays nil")
        XCTAssertEqual(games.building, "Building · 0 of 14 days")
    }

    /// A category value covers one period. The store change carries the confidence mark; the official month alone is
    /// one publisher's number and carries none, as on the web page. The Data sheet no longer says "blend".
    func testOfficialMonthAloneCarriesNoConfidenceMark() throws {
        let shop = DeckShopParser.market(try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(#"""
        {"categories":[
          {"key":"home","label":"Home","value":0.22,"basis":"official_mom","period":"2026-10",
           "confidence":{"score":0.8,"label":"high","reasons":["no store panel"]}},
          {"key":"computers","label":"Computers","value":-1.4,"basis":"platforms","period":"30 days to 2026-11-14",
           "confidence":{"score":0.8,"label":"high","reasons":["12 products on 3 sites"]}},
          {"key":"games","label":"Games","value":null,"basis":null,"confidence":{"score":0.15}}]}
        """#.utf8)) as? [String: Any]))
        let home = try XCTUnwrap(shop.categories.first { $0.key == "home" })
        XCTAssertEqual(home.basis, "official_mom")
        XCTAssertNil(home.mark, "the official month alone carries no mark")
        XCTAssertEqual(try XCTUnwrap(shop.categories.first { $0.key == "computers" }).mark?.dots, 3)
        XCTAssertNil(try XCTUnwrap(shop.categories.first { $0.key == "games" }).mark, "no value, no mark")
        XCTAssertFalse(shop.notes.contains { $0.contains("blend our") }, "the old blend note is gone")
        XCTAssertTrue(shop.notes.contains { $0.hasPrefix("Each category change covers one period") })
    }

    func testPlatformsBoardAndDataSheet() throws {
        let (shop, page) = try market()
        XCTAssertEqual(shop.platforms.map(\.rank), Array(1...14))
        XCTAssertEqual(shop.platforms[1].name, "Walmart")
        XCTAssertTrue(shop.platforms[1].pricesTracked)
        XCTAssertFalse(shop.platforms[2].pricesTracked, "Amazon walls our reads")
        XCTAssertEqual(shop.needsSetup, 6)
        XCTAssertEqual(page.sources.count, 66)
        XCTAssertEqual(page.sources.filter { $0.state == .needsKey }.count, 6)
        XCTAssertEqual(page.sources.filter { $0.state == .blocked }.count, 29)
        let gamestop = try XCTUnwrap(page.sources.first { $0.id == "shop_gamestop" })
        XCTAssertEqual(gamestop.state, .stale, "a row already out of date keeps that state when this run also failed")
        XCTAssertEqual(page.sources.first?.asOf, "Q2 2026")
        XCTAssertTrue(page.notes.contains { $0.hasPrefix("30 of 66 sources answering") })
    }

    func testMoneyAndValueWords() {
        XCTAssertEqual(DeckMoney.price(1_240_000), "$1.24M")
        XCTAssertEqual(DeckMoney.price(845_000), "$845K")
        XCTAssertEqual(DeckMoney.price(9450), "$9,450")
        XCTAssertEqual(DeckMoney.price(79), "$79.00")
        XCTAssertEqual(DeckMoney.price(99.999), "$100.00", "cents follow the value, as the web's price helper does")
        XCTAssertEqual(ShopWords.value(nil, unit: "usd"), "No data")
        XCTAssertEqual(ShopWords.value(3.459, unit: "usd"), "$3.46")
        XCTAssertEqual(ShopWords.value(6978.7, unit: "usd_b"), "$6.98T")
        XCTAssertEqual(ShopWords.value(538_620, unit: "teu"), "538.6K TEU")
        XCTAssertEqual(ShopWords.value(168.631, unit: "index"), "168.6")
        XCTAssertEqual(ShopWords.change(-0.5, unit: "pct_pts"), "\u{2212}0.5 pt")
        XCTAssertEqual(ShopWords.rank(7, change: 2), "#7, up 2")
        XCTAssertEqual(ShopWords.rank(3, change: nil), "#3")
    }
}
