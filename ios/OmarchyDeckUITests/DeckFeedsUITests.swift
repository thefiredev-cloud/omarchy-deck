import UIKit
import StoreKitTest
import XCTest

/// Accepts the simulator fixture certificate for 127.0.0.1 only, for fixture controls from the test runner.
private final class FeedsFixtureTrust: NSObject, URLSessionDelegate {
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        let host = challenge.protectionSpace.host
        guard host == "127.0.0.1" || host == "localhost",
              challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
}

/// Deals, Travel, Outdoors and Life (2026-10-30), then Housing and Commercial (2026-11-13), against `scripts/mock_deck.py`, which serves the contract fixture files
/// in `scripts/fixtures/feeds/` through the same reshaping as the deck server's feed route.
///
/// Fixture: `python3 scripts/mock_deck.py 28448 CERT KEY feeds-token-0000 "MOCK FEEDS DECK (not the real deck)"`, with
/// the certificate trusted in the owned simulator. `OMARCHY_DECK_FEEDS_ORIGIN` names another port. Set
/// `TEST_RUNNER_DECK_SHOT_DIR` to also write each screenshot as a PNG there.
///
/// The sections open dark, like the deck; the Appearance button switches the screen to light and the choice is kept.
final class DeckFeedsUITests: XCTestCase {
    private lazy var origin = ProcessInfo.processInfo.environment["OMARCHY_DECK_FEEDS_ORIGIN"] ?? "https://127.0.0.1:28448/"
    private let token = "feeds-token-0000"
    private let banner = "MOCK FEEDS DECK (not the real deck)"
    private let sections = ["deals", "travel", "outdoors", "life"]
    private var store: SKTestSession?

    override func setUpWithError() throws {
        continueAfterFailure = false
        store = try UITestLaunch.resetPersistedState()
    }

    override func tearDown() {
        _ = fixture("release")
        UITestLaunch.finishPersistedState(store)
        store = nil
        super.tearDown()
    }

    /// Every section loads its glass cards from the deck in dark, then in light; light is kept after Done; Done closes.
    func testEverySectionInDarkAndLight() {
        let app = signIn()
        openFeeds(app, section: "deals")
        for mode in ["dark", "light"] {
            if mode == "light" { toggleAppearance(app) }
            for section in sections {
                let tab = app.buttons["feeds.tab.\(section)"]
                XCTAssertTrue(tab.waitForExistence(timeout: 10), "the \(section) tab must be on screen")
                tab.tap()
                XCTAssertTrue(app.descendants(matching: .any)["feeds.card"].firstMatch.waitForExistence(timeout: 15),
                              "\(section) must show cards from the deck")
                XCTAssertTrue(app.buttons["feeds.status"].waitForExistence(timeout: 5),
                              "\(section) must say when it was updated")
                XCTAssertFalse(app.descendants(matching: .any)["feeds.state.loading"].exists)
                // Let the spring settle so the picture shows the resting layout.
                sleep(1)
                assertBackdrop(shoot("\(section)-\(mode)"), light: mode == "light", "\(section) in \(mode)")
            }
        }
        let screen = app.descendants(matching: .any)["feeds.screen"].firstMatch
        let done = app.buttons["feeds.done"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 5), "Done must be on screen")
        done.tap()
        XCTAssertTrue(screen.waitForNonExistence(timeout: 5), "Done closes the sections")
        // The light choice is kept: the next open is light without touching the button.
        openFeeds(app, section: "outdoors")
        XCTAssertTrue(app.descendants(matching: .any)["feeds.card"].firstMatch.waitForExistence(timeout: 15))
        sleep(1)
        assertBackdrop(XCUIScreen.main.screenshot(), light: true, "reopened after choosing light")
    }
    /// The Life housing card keeps its detail text clear of the headline value on a phone-width screen.
    func testLifeHousingCardStacksDetailsAboveValue() {
        let app = signIn()
        openFeeds(app, section: "life")

        let title = app.staticTexts["feeds.card.title.life-1"]
        let subtitle = app.staticTexts["feeds.card.subtitle.life-1"]
        let price = app.staticTexts["feeds.card.price.life-1"]
        XCTAssertTrue(title.waitForExistence(timeout: 15), "the housing headline must be visible")
        XCTAssertTrue(subtitle.waitForExistence(timeout: 5), "the housing detail must be visible")
        XCTAssertTrue(price.waitForExistence(timeout: 5), "the home value must be visible")
        XCTAssertLessThanOrEqual(title.frame.maxY, subtitle.frame.minY + 1,
                                 "housing detail must sit below its headline")
        XCTAssertLessThanOrEqual(subtitle.frame.maxY, price.frame.minY + 1,
                                 "the home value must not overlap detail text")
    }

    /// A feed the deck has not saved yet says so, with a way to check again, never an empty list.
    func testMissingFeedSaysNoDataYet() {
        XCTAssertEqual(fixture("feeds-missing"), 200, "the fixture must accept feeds-missing")
        let app = signIn()
        openFeeds(app, section: "travel")
        for mode in ["dark", "light"] {
            if mode == "light" { toggleAppearance(app) }
            let missing = app.descendants(matching: .any)["feeds.state.notCollected"].firstMatch
            XCTAssertTrue(missing.waitForExistence(timeout: 15), "a missing feed must read No data yet")
            XCTAssertTrue(app.staticTexts["No data yet"].exists)
            XCTAssertFalse(app.descendants(matching: .any)["feeds.card"].exists, "no card may stand in for missing data")
            sleep(1)
            assertBackdrop(shoot("travel-not-collected-\(mode)"), light: mode == "light", "not collected in \(mode)")
        }
        // The feed arrives: Check again reads it without leaving the screen.
        XCTAssertEqual(fixture("release"), 200)
        let retry = app.buttons["feeds.retry"].firstMatch
        XCTAssertTrue(retry.waitForExistence(timeout: 5))
        retry.tap()
        XCTAssertTrue(app.descendants(matching: .any)["feeds.card"].firstMatch.waitForExistence(timeout: 15),
                      "Check again must load the feed once it exists")
    }

    /// Housing shows the owner's markets, the mortgage rates and the homes for sale, newest first, opening with eight and
    /// reaching twenty. The 55+ note moved to the Data sheet (no source or method text on the page). The budget chip
    /// narrows the list by the deck's own budget, whose amount stays hidden until Show amounts.
    func testHousingShowsMarketsRatesAgeNoteAndHomes() {
        let app = signIn()
        openFeeds(app, section: "housing")
        let any = app.descendants(matching: .any)
        XCTAssertTrue(any["housing.markets"].firstMatch.waitForExistence(timeout: 20), "the owner's markets must load")
        XCTAssertTrue(any["housing.market.zip-90001"].firstMatch.exists, "the home ZIP row must be listed")
        XCTAssertTrue(app.buttons["feeds.status"].waitForExistence(timeout: 5), "Housing must carry its freshness mark")
        XCTAssertTrue(any["housing.rates"].firstMatch.exists, "the mortgage rates must be on screen")
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Zillow")).firstMatch.exists,
                       "no source names on the page")
        openData(app)
        let note = app.staticTexts["4 age-restricted homes hidden (55+, 62+ and senior communities): 3 on the 55+ list, 1 listing text."]
        for _ in 0..<8 where !note.exists { app.swipeUp() }
        XCTAssertTrue(note.exists, "the Data sheet must count the hidden 55+ homes and say why")
        closeData(app)
        scrollTo(app, any["housing.home.0"].firstMatch)
        XCTAssertFalse(any["housing.home.8"].firstMatch.exists, "the list opens short, with eight homes")
        let more = app.buttons["housing.more"]
        scrollTo(app, more)
        more.tap()
        scrollTo(app, any["housing.home.19"].firstMatch)
        XCTAssertTrue(app.buttons["housing.fewer"].waitForExistence(timeout: 5), "Show more must offer Show fewer")
        let budget = app.buttons["housing.budget"]
        scrollTo(app, budget)
        budget.tap()
        XCTAssertTrue(budget.isSelected || budget.value as? String == "1", "the budget chip must show it is on")
        shoot("housing")
    }

    /// Selecting a city returns the listing grid to its initial page and keeps the filtered count.
    func testHousingCityFilterResetsExpandedList() {
        let app = signIn()
        openFeeds(app, section: "housing")
        let any = app.descendants(matching: .any)
        XCTAssertTrue(any["housing.markets"].firstMatch.waitForExistence(timeout: 20))

        // "Show N more", as on the web deck and every other Feeds section (the word "homes" was dropped in #147).
        let more = app.buttons["housing.more"]
        scrollTo(app, more)
        XCTAssertEqual(more.label, "Show 12 more")
        more.tap()
        XCTAssertTrue(any["housing.home.19"].waitForExistence(timeout: 5))

        let city = app.buttons["housing.city"]
        scrollTo(app, city)
        city.tap()
        let exampleBay = app.buttons["Example Bay"]
        XCTAssertTrue(exampleBay.waitForExistence(timeout: 5))
        exampleBay.tap()
        XCTAssertEqual(city.value as? String, "Example Bay")

        scrollTo(app, more)
        XCTAssertEqual(more.label, "Show 2 more")
        XCTAssertFalse(any["housing.home.8"].exists,
                       "Changing city must reset the expanded list to its first eight results")
        more.tap()
        XCTAssertTrue(any["housing.home.9"].waitForExistence(timeout: 5))
    }


    /// Commercial shows the overview band, your stake as a smaller investor, the filters and the deal list, and one deal
    /// opens its stake sheet.
    func testCommercialShowsOverviewInvestorViewsAndStake() {
        let app = signIn()
        openFeeds(app, section: "commercial")
        let any = app.descendants(matching: .any)
        if !any["commercial.overview"].firstMatch.waitForExistence(timeout: 25) { shoot("commercial-overview-missing") }
        XCTAssertTrue(any["commercial.overview"].firstMatch.exists, "the overview band must load")
        XCTAssertTrue(any["commercial.summary.type.0"].firstMatch.exists, "the asset class table must have rows")
        scrollTo(app, any["commercial.chart.cap"].firstMatch)
        XCTAssertTrue(any["commercial.chart.rates"].firstMatch.exists, "the rates chart must be drawn")
        scrollTo(app, any["commercial.investor"].firstMatch)
        let masked = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Stakes are sized to your Housing budget, $••• (income)."))
        XCTAssertTrue(masked.firstMatch.exists, "the budget amount is hidden by default, as on the web")
        let amounts = app.buttons["feeds.amounts"].firstMatch
        scrollTo(app, amounts)
        amounts.tap()
        let sized = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Stakes are sized to your Housing budget, $1M (income)."))
        XCTAssertTrue(sized.firstMatch.waitForExistence(timeout: 5), "Show amounts reveals the budget it sizes stakes to")
        for view in ["jordan", "riley", "small", "all"] {
            let chip = app.buttons["commercial.view.\(view)"]
            scrollTo(app, chip)
            chip.tap()
            XCTAssertTrue(any["commercial.results"].firstMatch.waitForExistence(timeout: 5), "\(view) must still list its deals")
        }
        scrollTo(app, any["commercial.deal.0"].firstMatch)
        any["commercial.deal.0"].firstMatch.tap()
        XCTAssertTrue(any["commercial.detail"].firstMatch.waitForExistence(timeout: 10), "a deal must open its sheet")
        XCTAssertTrue(any["commercial.stake.verdict"].firstMatch.waitForExistence(timeout: 5), "the sheet must size your stake")
        shoot("commercial-deal")
        app.buttons["commercial.detail.done"].firstMatch.tap()
        XCTAssertTrue(any["commercial.detail"].firstMatch.waitForNonExistence(timeout: 5), "Done closes the deal")
    }
    /// The commercial result list reveals the next page, then removes pagination at the end.
    func testCommercialShowsMoreDealsInBatches() {
        let app = signIn()
        openFeeds(app, section: "commercial")
        let any = app.descendants(matching: .any)
        XCTAssertTrue(any["commercial.overview"].firstMatch.waitForExistence(timeout: 25))

        let more = app.buttons["commercial.more"].firstMatch
        scrollTo(app, more)
        XCTAssertTrue(more.exists, "the 48-deal fixture must offer another page")
        more.tap()

        let twentySixth = any["commercial.deal.25"].firstMatch
        XCTAssertTrue(twentySixth.waitForExistence(timeout: 5), "Show more must reveal the next deal")
        scrollTo(app, twentySixth)
        XCTAssertFalse(more.exists, "all fixture deals are visible after the second page")
    }

    /// Surf opens on your pinned spots, draws the coast strip and the regions, and a spot opens its sheet with the region
    /// file's tide curve. A model-only Baja spot says it is a forecast.
    func testSurfShowsPinnedSpotsCoastRegionsAndSpotSheet() {
        let app = signIn()
        openFeeds(app, section: "surf")
        let any = app.descendants(matching: .any)
        XCTAssertTrue(any["surf.card.salt-creek"].firstMatch.waitForExistence(timeout: 20), "your first pinned spot must load")
        XCTAssertTrue(app.buttons["feeds.status"].exists, "Surf must carry its freshness mark")
        XCTAssertTrue(any["surf.alerts"].firstMatch.exists, "active alerts lead the page")
        scrollTo(app, any["surf.strip.orange-county"].firstMatch)
        XCTAssertTrue(any["surf.strip.baja-sur"].firstMatch.exists && any["surf.strip.oregon-north"].firstMatch.exists,
                      "the strip runs Cabo to the Columbia River")
        let baja = any["surf.region.baja-sur"].firstMatch
        scrollTo(app, baja)
        baja.tap()
        let spots = any["surf.spots"].firstMatch
        XCTAssertTrue(spots.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Spots in Baja Sur"].waitForExistence(timeout: 5), "a region card picks the spot list")
        XCTAssertTrue(app.staticTexts["Forecast only. No buoys in this region."].exists, "Baja Sur reads as forecast only")
        let first = any["surf.spot.0"].firstMatch
        scrollTo(app, first)
        first.tap()
        XCTAssertTrue(any["surf.sheet"].firstMatch.waitForExistence(timeout: 10), "a spot opens its sheet")
        XCTAssertTrue(app.staticTexts["Forecast only. No buoy nearby."].waitForExistence(timeout: 5),
                      "a model-only spot says so instead of a buoy reading")
        app.buttons["surf.sheet.done"].firstMatch.tap()
        XCTAssertTrue(any["surf.sheet"].firstMatch.waitForNonExistence(timeout: 5))
        let salt = any["surf.card.salt-creek"].firstMatch
        for _ in 0..<14 where !(salt.exists && salt.isHittable) { app.swipeDown() }
        XCTAssertTrue(salt.isHittable, "your first pinned spot must be on screen")
        // The swipe loop can end mid-deceleration; a tap sent then is swallowed and the sheet never opens.
        sleep(1)
        salt.tap()
        XCTAssertTrue(any["surf.sheet.tide"].firstMatch.waitForExistence(timeout: 10))
        scrollTo(app, any["surf.sheet.sun"].firstMatch)
        XCTAssertTrue(app.staticTexts["Sunrise"].exists, "the region file adds sun times")
    }

    /// Every coast segment stays a full touch target on a phone, and both ends remain reachable.
    func testSurfCoastSegmentsKeepMinimumTargetsAndScrollToBothEnds() {
        XCUIDevice.shared.orientation = .portrait
        let app = signIn()
        openFeeds(app, section: "surf")
        let orange = app.buttons["surf.strip.orange-county"].firstMatch
        scrollTo(app, orange)
        let regions = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "surf.strip."))
        XCTAssertEqual(regions.count, 14, "all coast regions must remain available")
        for region in regions.allElementsBoundByIndex {
            XCTAssertGreaterThanOrEqual(region.frame.width, 44, "\(region.identifier) must not squeeze below 44 pt")
            XCTAssertGreaterThanOrEqual(region.frame.height, 44, "\(region.identifier) must keep its 44 pt height")
        }
        let strip = app.descendants(matching: .any)["surf.strip"].firstMatch
        XCTAssertTrue(strip.exists, "VoiceOver must have a labelled coast group")
        for (id, north) in [("baja-sur", false), ("oregon-north", true)] {
            let region = app.buttons["surf.strip.\(id)"].firstMatch
            for _ in 0..<8 where !region.isHittable {
                if north { strip.swipeLeft() } else { strip.swipeRight() }
            }
            XCTAssertTrue(region.isHittable, "\(id) must be reachable without shrinking its target")
            region.tap()
            XCTAssertTrue(region.isSelected, "\(id) must remain the selected coast region")
        }
    }

    /// The section bar runs past the phone's edge: it scrolls to its last section, which opens. Nine sections do not fit
    /// 402 pt, so this is the proof that none is stranded off the right edge.
    func testSectionBarReachesItsLastSection() {
        let app = signIn()
        openFeeds(app, section: "surf")
        let strip = app.descendants(matching: .any)["feeds.tabs"].firstMatch
        XCTAssertTrue(strip.waitForExistence(timeout: 5), "the section bar must be on screen")
        let life = app.buttons["feeds.tab.life"].firstMatch
        for _ in 0..<8 where !(life.exists && life.isHittable) { strip.swipeLeft() }
        XCTAssertTrue(life.isHittable, "the last section must be reachable by scrolling the bar")
        life.tap()
        XCTAssertTrue(app.staticTexts["Life"].waitForExistence(timeout: 10), "the last section opens")
        XCTAssertTrue(app.buttons["feeds.data"].firstMatch.waitForExistence(timeout: 5))
    }

    func testSurfFarAlertsStayBelowYourSpots() {
        XCTAssertEqual(fixture("surf-alerts-far"), 200, "the fixture must accept surf-alerts-far")
        let app = signIn()
        openFeeds(app, section: "surf")
        let any = app.descendants(matching: .any)
        let salt = any["surf.card.salt-creek"].firstMatch
        XCTAssertTrue(salt.waitForExistence(timeout: 20), "your first pinned spot must load")
        XCTAssertFalse(any["surf.alerts"].firstMatch.exists, "no far alert may sit above your spots")
        XCTAssertFalse(any["surf.alert.0"].firstMatch.exists)
        let coast = app.buttons["surf.alerts.coast"].firstMatch
        // Compare positions while both are in the first snapshot: reading a frame again after scrolling resolves a
        // stale element and fails on the accessibility tree, not on the page.
        XCTAssertTrue(coast.waitForExistence(timeout: 5), "the coast line must be on the page")
        XCTAssertEqual(coast.label, "20 more alerts along the coast")
        XCTAssertGreaterThan(coast.frame.minY, salt.frame.maxY, "the coast line comes after your spots")
        scrollTo(app, coast)
        coast.tap()
        XCTAssertTrue(any["surf.alerts.sheet"].firstMatch.waitForExistence(timeout: 5), "the line opens every alert")
        let first = any["surf.alerts.row.0"].firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 5))
        XCTAssertTrue(first.label.hasPrefix("Storm warning"), "the full list starts with the most severe: \(first.label)")
        app.buttons["surf.alerts.done"].firstMatch.tap()
        XCTAssertTrue(any["surf.alerts.sheet"].firstMatch.waitForNonExistence(timeout: 5))
    }

    /// Four alerts on your region: the two most severe above your spots, then "+2 more"; the coast's others stay below.
    func testSurfHomeAlertsShowTheTwoMostSevere() {
        XCTAssertEqual(fixture("surf-alerts-home"), 200, "the fixture must accept surf-alerts-home")
        let app = signIn()
        openFeeds(app, section: "surf")
        let any = app.descendants(matching: .any)
        let salt = any["surf.card.salt-creek"].firstMatch
        XCTAssertTrue(salt.waitForExistence(timeout: 20), "your first pinned spot must load")
        let first = any["surf.alert.0"].firstMatch, second = any["surf.alert.1"].firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 5) && second.exists, "two rows lead the page")
        XCTAssertTrue(first.label.hasPrefix("Coastal flood warning · Orange County"), first.label)
        XCTAssertTrue(second.label.hasPrefix("High surf warning · Orange County"), second.label)
        XCTAssertFalse(any["surf.alert.2"].firstMatch.exists, "at most two rows above your spots")
        let more = app.buttons["surf.alerts.more"].firstMatch
        XCTAssertEqual(more.label, "+2 more")
        XCTAssertLessThan(more.frame.maxY, salt.frame.minY, "the count sits with the rows, above your spots")
        shoot("surf-home-alerts")
        let coast = app.buttons["surf.alerts.coast"].firstMatch
        scrollTo(app, coast)
        XCTAssertEqual(coast.label, "20 more alerts along the coast")
        coast.tap()
        XCTAssertTrue(any["surf.alerts.row.3"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(any["surf.alerts.row.3"].firstMatch.label.hasPrefix("Beach hazards statement"),
                      "your four alerts lead the full list, most severe first")
        app.buttons["surf.alerts.done"].firstMatch.tap()
    }

    /// Shop draws the market strip, your watches, best sellers and movers, category prices and the platform board; a
    /// watch opens its range and stores.
    func testShopShowsStripWatchesProductsAndWatchSheet() {
        let app = signIn()
        openFeeds(app, section: "shop")
        let any = app.descendants(matching: .any)
        XCTAssertTrue(any["shop.macro.ecom_share"].firstMatch.waitForExistence(timeout: 20), "the market strip must load")
        XCTAssertTrue(app.staticTexts["17.1%"].exists, "online share of retail")
        let watch = any["shop.watch.rtx-4080"].firstMatch
        scrollTo(app, watch)
        watch.tap()
        XCTAssertTrue(any["shop.watch.sheet"].firstMatch.waitForExistence(timeout: 10), "a watch opens its sheet")
        XCTAssertTrue(any["shop.watch.stores"].firstMatch.waitForExistence(timeout: 5), "the sheet lists stores")
        app.buttons["shop.sheet.done"].firstMatch.tap()
        let outdoors = app.buttons["shop.category.outdoors"].firstMatch
        scrollTo(app, outdoors)
        outdoors.tap()
        XCTAssertTrue(any["shop.product.0"].firstMatch.waitForExistence(timeout: 5), "a category keeps its products")
        // The category row runs past the phone edge: it scrolls to its last chip, which is never stranded off screen.
        // Swipe the row that holds the chips, while it is on screen (it sits above the platform board, and `scrollTo`
        // only moves down the page).
        // Chips are the categories that have products (`ShopMarket.categoryChips`); on the fixture the last is Beauty.
        let chips = any.matching(identifier: "chips.row").containing(.button, identifier: "shop.category.outdoors").firstMatch
        let last = app.buttons["shop.category.beauty"].firstMatch
        XCTAssertTrue(chips.isHittable, "the category row must be on screen after picking a category")
        for _ in 0..<8 where !(last.exists && last.isHittable) { chips.swipeLeft() }
        XCTAssertTrue(last.isHittable, "the last category chip must be reachable by scrolling the row")
        last.tap()
        XCTAssertTrue(any["shop.product.0"].firstMatch.waitForExistence(timeout: 5), "the last category keeps its products")
        scrollTo(app, any["shop.platforms"].firstMatch)
        XCTAssertTrue(app.staticTexts["Walmart"].exists, "the platform board names the stores it ranks")
    }

    /// Real estate draws the US strip and the best ZIPs, dated by the server's own freshness keys; a ZIP opens its sheet
    /// with blended metrics, and a ZIP the deck has no record of says so in one line.
    func testRealEstateShowsUSStripBestZipsAndZipSheet() {
        let app = signIn()
        openFeeds(app, section: "realestate")
        let any = app.descendants(matching: .any)
        XCTAssertTrue(any["national.strip"].firstMatch.waitForExistence(timeout: 20), "the US strip must load")
        XCTAssertTrue(any["national.zip.79607"].firstMatch.waitForExistence(timeout: 20), "best ZIPs must load")
        let status = app.buttons["feeds.status"].firstMatch
        XCTAssertTrue(status.waitForExistence(timeout: 5))
        XCTAssertFalse(status.label.contains("Out of date"), "the server says fresh: \(status.label)")
        let search = app.textFields["national.search"].firstMatch
        search.tap()
        search.typeText("92647\n")
        XCTAssertTrue(any["national.sheet"].firstMatch.waitForExistence(timeout: 10), "five digits open the ZIP")
        XCTAssertTrue(app.staticTexts["Huntington Beach, CA"].waitForExistence(timeout: 10))
        shoot("realestate-zip")
        app.buttons["national.sheet.done"].firstMatch.tap()
        XCTAssertTrue(any["national.sheet"].firstMatch.waitForNonExistence(timeout: 5))
        app.buttons["Clear search"].firstMatch.tap()
        search.tap()
        search.typeText("10001\n")
        XCTAssertTrue(any["feeds.state.noRecord"].firstMatch.waitForExistence(timeout: 10), "an unknown ZIP says so")
        XCTAssertFalse(any["feeds.state.failed"].firstMatch.exists, "an unknown ZIP is not a failure to retry")
        app.buttons["national.sheet.done"].firstMatch.tap()
    }

    /// Best ZIPs shows the owner's data points with the 30-yr rate once in its header and a county tag on an area value,
    /// then the Multifamily lens; Markets ranks the states by the segment lead and a metro opens every segment. Values are
    /// the live deck API's, captured 2026-11-17 into the fixtures. Screenshots go to DECK_SHOT_DIR when it is set.
    func testRealEstateLensesAndMarkets() {
        let app = signIn()
        openFeeds(app, section: "realestate")
        let any = app.descendants(matching: .any)
        let card = any["national.zip.79607"].firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 30), "best ZIPs must load with their columns")
        let rate = app.staticTexts["national.rate"].firstMatch
        bringToTop(app, rate)
        shoot("realestate-bestzips-residential")
        XCTAssertTrue(app.staticTexts["national.rate"].firstMatch.label.hasPrefix("30-yr rate 7.11%"), "the rate prints once, in the header")
        XCTAssertTrue(card.label.contains("Payment to income, 23.6%"), "the owner's data points: \(card.label)")
        XCTAssertTrue(card.label.contains("Days to sell, 22"), card.label)
        XCTAssertTrue(card.label.contains("county value"), "an area value is tagged: \(card.label)")
        XCTAssertTrue(card.label.contains("Inventory: not reported for this ZIP"), "a missing value says so: \(card.label)")

        let mf = app.buttons["national.lens.mf"].firstMatch
        XCTAssertTrue(mf.waitForExistence(timeout: 10), "the Multifamily lens shows on v2 data")
        mf.tap()
        XCTAssertTrue(app.buttons["national.sort.multifamily_score"].firstMatch.waitForExistence(timeout: 10))
        let ranked = NSPredicate(format: "identifier BEGINSWITH 'national.zip.' AND label CONTAINS 'Multifamily score' AND label CONTAINS 'Renters in 5+ unit buildings'")
        let first = any.matching(ranked).firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 20), "the Multifamily lens columns")
        bringToTop(app, rate)
        shoot("realestate-bestzips-multifamily")

        let markets = app.buttons["realestate.page.markets"].firstMatch
        for _ in 0..<12 where !(markets.exists && markets.isHittable) { app.swipeDown() }
        markets.tap()
        let ms = any["markets.row.MS"].firstMatch
        XCTAssertTrue(ms.waitForExistence(timeout: 30), "States rank by gross rent yield, highest first")
        XCTAssertTrue(ms.label.hasPrefix("Rank 1, Mississippi"), ms.label)
        XCTAssertEqual(app.staticTexts["markets.headline"].firstMatch.label,
                       "Ranked by gross rent yield, highest first \u{00B7} 51 states")
        sleep(1)
        shoot("realestate-markets-states")

        app.buttons["markets.level.metros"].firstMatch.tap()
        let metrosLine = app.staticTexts.matching(NSPredicate(format: "identifier == 'markets.headline' AND label ENDSWITH ' metros'")).firstMatch
        XCTAssertTrue(metrosLine.waitForExistence(timeout: 30), "Metros rank by the same lead")
        let metro = any.matching(NSPredicate(format: "identifier BEGINSWITH 'markets.row.'")).firstMatch
        XCTAssertTrue(metro.waitForExistence(timeout: 10))
        sleep(1)
        shoot("realestate-markets-metros")
        metro.tap()
        XCTAssertTrue(any["markets.sheet.section.residential"].firstMatch.waitForExistence(timeout: 30), "the sheet shows every segment")
        XCTAssertTrue(any["markets.sheet.section.multifamily"].firstMatch.exists)
        sleep(1)
        shoot("realestate-markets-metro-sheet")
        app.swipeUp()
        sleep(1)
        shoot("realestate-markets-metro-sheet-2")
        app.buttons["markets.sheet.done"].firstMatch.tap()
        XCTAssertTrue(any["markets.sheet"].firstMatch.waitForNonExistence(timeout: 5))
    }

    /// Drags the page in short steps until the element sits just under the top bar, so the cards under that header
    /// fill the picture. A short drag never flings, so the page settles where it stops.
    private func bringToTop(_ app: XCUIApplication, _ element: XCUIElement) {
        let height = app.frame.height
        for _ in 0..<20 {
            guard element.exists else { app.swipeDown(); continue }
            let y = element.frame.minY
            if y > height * 0.18 && y < height * 0.3 { break }
            let (from, to): (CGFloat, CGFloat) = y >= height * 0.3 ? (0.7, 0.55) : (0.45, 0.6)
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: from))
                .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: to)))
        }
        sleep(1)
    }

    /// A deck server that predates the Surf and Shop routes answers 404: one plain line, never an error card.
    func testOldDeckSaysThePageIsNotThereYet() {
        XCTAssertEqual(fixture("old-deck"), 200, "the fixture must accept old-deck")
        let app = signIn()
        openFeeds(app, section: "surf")
        XCTAssertTrue(app.staticTexts["This deck does not have this page yet"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.descendants(matching: .any)["feeds.state.failed"].exists, "a 404 is not an error wall")
        app.buttons["feeds.tab.shop"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["This deck does not have this page yet"].waitForExistence(timeout: 15))
    }

    /// The Data sheet lists each source with its state; the page itself names none.
    func testDataSheetListsSourcesAndStates() {
        let app = signIn()
        openFeeds(app, section: "surf")
        XCTAssertTrue(app.descendants(matching: .any)["surf.card.salt-creek"].firstMatch.waitForExistence(timeout: 20))
        XCTAssertFalse(app.staticTexts["NOAA NDBC"].exists, "no publisher names on the page")
        openData(app)
        XCTAssertTrue(app.staticTexts["Buoy and shore station readings"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "NOAA NDBC")).firstMatch.exists)
        closeData(app)
    }

    /// Screenshots of each new section for review (DECK_SHOT_DIR). Runs on the iPhone and the iPad pool simulators.
    func testShotTourOfNewSections() {
        let app = signIn()
        let device = UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone"
        let any = app.descendants(matching: .any)
        openFeeds(app, section: "surf")
        let sidebar = any["feeds.sidebar"].firstMatch
        let tabs = any["feeds.tabs"].firstMatch
        if UIDevice.current.userInterfaceIdiom == .pad {
            XCTAssertTrue(sidebar.waitForExistence(timeout: 5), "wide iPad feeds use the section sidebar")
            XCTAssertFalse(tabs.exists, "wide iPad feeds do not show the phone tab strip")
            XCTAssertTrue(app.staticTexts["Cabo to the Columbia River. Your spots first."].exists,
                          "the wide page shows its section tagline")
        } else {
            XCTAssertTrue(tabs.waitForExistence(timeout: 5), "phone feeds use the tab strip")
            XCTAssertFalse(sidebar.exists, "phone feeds do not show the section sidebar")
            XCTAssertFalse(app.staticTexts["Cabo to the Columbia River. Your spots first."].exists,
                           "the phone moves its tagline into Data")
        }
        XCTAssertTrue(any["surf.card.salt-creek"].firstMatch.waitForExistence(timeout: 20))
        sleep(1)
        shoot("\(device)-surf-1-top")
        scrollTo(app, any["surf.strip.orange-county"].firstMatch)
        shoot("\(device)-surf-2-coast")
        scrollTo(app, any["surf.region.orange-county"].firstMatch)
        shoot("\(device)-surf-3-regions")
        scrollTo(app, any["surf.buoys"].firstMatch)
        shoot("\(device)-surf-4-buoys")
        scrollTo(app, any["surf.water"].firstMatch)
        app.swipeUp()
        shoot("\(device)-surf-5-water")
        let first = any["surf.spot.0"].firstMatch
        for _ in 0..<14 where !(first.exists && first.isHittable) { app.swipeDown() }
        first.tap()
        XCTAssertTrue(any["surf.sheet.tide"].firstMatch.waitForExistence(timeout: 10))
        sleep(2)
        shoot("\(device)-surf-6-spot")
        app.swipeUp()
        shoot("\(device)-surf-7-spot-tide")
        app.buttons["surf.sheet.done"].firstMatch.tap()
        app.buttons["feeds.tab.shop"].firstMatch.tap()
        XCTAssertTrue(any["shop.macro.ecom_share"].firstMatch.waitForExistence(timeout: 20))
        sleep(1)
        shoot("\(device)-shop-1-top")
        scrollTo(app, any["shop.products"].firstMatch)
        shoot("\(device)-shop-2-products")
        scrollTo(app, any["shop.categories"].firstMatch)
        shoot("\(device)-shop-3-categories")
        scrollTo(app, any["shop.platforms"].firstMatch)
        shoot("\(device)-shop-4-platforms")
        openData(app)
        shoot("\(device)-shop-5-data")
        closeData(app)
        // A tap right after the sheet's dismissal is swallowed: tap the tab until the Real estate page is the one shown.
        let realestate = app.buttons["feeds.tab.realestate"].firstMatch
        for _ in 0..<3 where !any["national.strip"].firstMatch.exists {
            sleep(1)
            realestate.tap()
            _ = any["national.strip"].firstMatch.waitForExistence(timeout: 5)
        }
        XCTAssertTrue(any["national.zip.79607"].firstMatch.waitForExistence(timeout: 20))
        sleep(1)
        shoot("\(device)-realestate")
        any["national.zip.79607"].firstMatch.tap()
        XCTAssertTrue(any["national.sheet.score"].firstMatch.waitForExistence(timeout: 10))
        sleep(1)
        shoot("\(device)-realestate-zip")
        app.buttons["national.sheet.done"].firstMatch.tap()
        app.buttons["feeds.tab.housing"].firstMatch.tap()
        XCTAssertTrue(any["housing.markets"].firstMatch.waitForExistence(timeout: 20))
        sleep(1)
        shoot("\(device)-housing")
        app.buttons["feeds.tab.commercial"].firstMatch.tap()
        XCTAssertTrue(any["commercial.overview"].firstMatch.waitForExistence(timeout: 25))
        sleep(1)
        shoot("\(device)-commercial")
        app.buttons["feeds.tab.deals"].firstMatch.tap()
        XCTAssertTrue(any["feeds.card"].firstMatch.waitForExistence(timeout: 15))
        shoot("\(device)-deals")
        toggleAppearance(app)
        app.buttons["feeds.tab.surf"].firstMatch.tap()
        XCTAssertTrue(any["surf.card.salt-creek"].firstMatch.waitForExistence(timeout: 20))
        sleep(1)
        shoot("\(device)-surf-light")
    }

    /// The Data button sits in the section header. From the foot of a long page (Shop runs about 30 screens on a phone)
    /// swipe back up as far as `scrollTo` swipes down, and never tap it blind: a tap on an element off screen makes
    /// XCUITest drag the sheet, which can dismiss it.
    private func openData(_ app: XCUIApplication) {
        let data = app.buttons["feeds.data"].firstMatch
        for _ in 0..<40 where !(data.exists && data.isHittable) { app.swipeDown() }
        XCTAssertTrue(data.isHittable, "the Data button must be on screen after scrolling back to the header")
        data.tap()
        XCTAssertTrue(app.descendants(matching: .any)["feeds.data.sheet"].firstMatch.waitForExistence(timeout: 5),
                      "Data opens the Data sheet")
    }

    private func closeData(_ app: XCUIApplication) {
        let done = app.buttons["feeds.data.done"].firstMatch
        if done.waitForExistence(timeout: 3) { done.tap() }
        XCTAssertTrue(app.descendants(matching: .any)["feeds.data.sheet"].firstMatch.waitForNonExistence(timeout: 5))
    }

    /// Guest access to the commercial route must produce the owner-only state, not an empty market view.
    func testGuestCommercialGateExplainsOwnerOnlyAccess() {
        XCTAssertEqual(fixture("release"), 200, "the fixture must start from its normal state")
        let app = signIn(token: "guest-feeds-token-0000")
        openFeeds(app, section: "commercial")

        let ownerOnly = app.descendants(matching: .any)["feeds.state.ownerOnly"].firstMatch
        XCTAssertTrue(ownerOnly.waitForExistence(timeout: 20), "a guest must see the owner-only message")
        XCTAssertTrue(ownerOnly.staticTexts["Owner only"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["commercial.overview"].exists,
                       "a forbidden deal desk must not render an empty market overview")
    }

    /// A deal desk that is not reporting says why, with a way to try again, and draws no deal.
    func testCommercialNotReportingSaysWhy() {
        XCTAssertEqual(fixture("feeds-missing"), 200, "the fixture must accept feeds-missing")
        let app = signIn()
        openFeeds(app, section: "commercial")
        let failed = app.staticTexts["Deal desk is not reporting"]
        if !failed.waitForExistence(timeout: 20) { shoot("commercial-failed-missing") }
        XCTAssertTrue(failed.exists, "a desk that is not reporting must say so")
        XCTAssertTrue(app.buttons["feeds.retry"].firstMatch.exists, "the card must offer Try again")
        XCTAssertTrue(app.staticTexts["the realestate collector has not written the deal desk yet"].exists,
                      "the reason from the deck must be on screen")
        XCTAssertFalse(app.descendants(matching: .any)["commercial.results"].exists, "no deal may stand in for missing data")
    }

    /// Swipes the sheet up until the element is on screen, at most thirty times (Surf and Shop run many screens on a phone).
    private func scrollTo(_ app: XCUIApplication, _ element: XCUIElement) {
        for _ in 0..<30 {
            if element.exists && element.isHittable { return }
            app.swipeUp()
        }
        XCTAssertTrue(element.exists, "\(element.identifier) must exist after scrolling")
    }

    private func toggleAppearance(_ app: XCUIApplication) {
        let button = app.buttons["feeds.appearance"].firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 5), "the Appearance button must be on screen")
        XCTAssertEqual(button.value as? String, "Dark")
        button.tap()
        XCTAssertEqual(button.value as? String, "Light", "one tap switches the screen to light")
        sleep(1)
    }

    // MARK: Helpers

    private func signIn(token credential: String? = nil) -> XCUIApplication {
        let app = UITestLaunch.freshApp()
        let field = app.textFields["connection.origin"]
        XCTAssertTrue(field.waitForExistence(timeout: 20), "first run must offer the server form")
        focus(field, in: app)
        field.typeText(origin)
        app.buttons["connection.save"].tap()
        let tokenField = app.secureTextFields["token.field"]
        XCTAssertTrue(tokenField.waitForExistence(timeout: 20), "a first connection must ask for the token")
        focus(tokenField, in: app)
        tokenField.typeText(credential ?? token)
        app.buttons["token.open"].tap()
        XCTAssertTrue(app.webViews.firstMatch.staticTexts[banner].waitForExistence(timeout: 30), "the mock deck must load")
        return app
    }

    /// The first secure field on a fresh simulator can take a second tap before the keyboard comes up.
    private func focus(_ field: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<3 {
            field.tap()
            if app.keyboards.firstMatch.waitForExistence(timeout: 4) { return }
        }
        XCTFail("the keyboard must come up for \(field.identifier)")
    }

    /// One tap on Decks, one on the section tile.
    private func openFeeds(_ app: XCUIApplication, section: String) {
        let manage = app.buttons["connection.manage"]
        XCTAssertTrue(manage.waitForExistence(timeout: 10), "the ready deck must show the Decks control")
        manage.tap()
        let tile = app.buttons["feeds.open.\(section)"]
        XCTAssertTrue(tile.waitForExistence(timeout: 10), "Decks must offer the \(section) tile first")
        tile.tap()
        XCTAssertTrue(app.descendants(matching: .any)["feeds.screen"].firstMatch.waitForExistence(timeout: 10), "the tile must open the sections")
        // Eight tiles stand in four rows, so a tap can land on a neighbour: name the section through its tab.
        let tab = app.buttons["feeds.tab.\(section)"]
        if tab.waitForExistence(timeout: 5), !tab.isSelected {
            tab.tap()
            XCTAssertTrue(tab.waitForExistence(timeout: 5))
        }
    }

    @discardableResult
    private func shoot(_ name: String) -> XCUIScreenshot {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["DECK_SHOT_DIR"] {
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir + "/\(name).png"))
        }
        return shot
    }

    /// The sheet's backdrop in the left margin, beside the cards: bright in light, dark in dark. Proves the theme
    /// rendered, not just that a setting changed.
    private func assertBackdrop(_ shot: XCUIScreenshot, light: Bool, _ what: String) {
        guard let cg = shot.image.cgImage, let data = cg.dataProvider?.data, let p = CFDataGetBytePtr(data) else {
            return XCTFail("no screenshot pixels for \(what)")
        }
        let bpp = cg.bitsPerPixel / 8, bpr = cg.bytesPerRow
        var sum = 0.0, count = 0.0
        for y in stride(from: Int(Double(cg.height) * 0.35), to: Int(Double(cg.height) * 0.9), by: 9) {
            for x in stride(from: Int(Double(cg.width) * 0.012), to: Int(Double(cg.width) * 0.028), by: 3) {
                let o = y * bpr + x * bpp
                sum += (Double(p[o]) + Double(p[o + 1]) + Double(p[o + 2])) / (3 * 255)
                count += 1
            }
        }
        let luma = count > 0 ? sum / count : -1
        if light {
            XCTAssertGreaterThan(luma, 0.6, "\(what): the light backdrop must render light (mean \(luma))")
        } else {
            XCTAssertLessThan(luma, 0.35, "\(what): the dark backdrop must render dark (mean \(luma))")
        }
    }

    @discardableResult
    private func fixture(_ name: String) -> Int {
        guard let base = URL(string: origin), let url = URL(string: "__fixture/\(name)", relativeTo: base)?.absoluteURL else {
            return 0
        }
        let session = URLSession(configuration: .ephemeral, delegate: FeedsFixtureTrust(), delegateQueue: nil)
        let done = XCTestExpectation(description: "fixture \(name)")
        var status = 0
        session.dataTask(with: url) { _, response, _ in
            status = (response as? HTTPURLResponse)?.statusCode ?? 0
            done.fulfill()
        }.resume()
        _ = XCTWaiter().wait(for: [done], timeout: 10)
        session.finishTasksAndInvalidate()
        return status
    }
}
