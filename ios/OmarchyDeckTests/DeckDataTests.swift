import Foundation
import XCTest
@testable import OmarchyDeck

/// Pages show no source text (owner order 2026-11-14). Each section has one freshness mark that turns into a status
/// only when something is stale or missing, and a Data sheet that lists sources, dates and states.
final class DeckDataTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_793_376_000)

    private func page(feed: String = "life", updated: Date?, stale: Bool = false) -> DeckFeedPage {
        DeckFeedPage(feed: feed, cards: [], updated: updated, stale: stale, sources: [])
    }

    func testNothingLoadedShowsNoMark() {
        XCTAssertNil(DeckFreshness.mark(pages: [], missing: 0, now: now))
    }

    /// A section is only as fresh as its oldest part: Life's 2-hour-old feed is not hidden by a 15-minute-old one.
    func testFreshSectionShowsItsOldestAge() {
        let pages = [page(updated: now.addingTimeInterval(-7200)), page(feed: "history-goodnews", updated: now.addingTimeInterval(-900))]
        XCTAssertEqual(DeckFreshness.mark(pages: pages, missing: 0, now: now), DeckFreshness(kind: .fresh, text: "2 h"))
        XCTAssertEqual(DeckFreshness.mark(pages: [page(updated: now.addingTimeInterval(-30))], missing: 0, now: now)?.text, "1 min",
                       "the web's age words: never under 1 min")
        XCTAssertEqual(DeckFreshness.mark(pages: [page(updated: now.addingTimeInterval(-30 * 3600))], missing: 0, now: now)?.text, "30 h",
                       "hours up to 47, as the web page behind the app says")
        XCTAssertEqual(DeckFreshness.mark(pages: [page(updated: now.addingTimeInterval(-3 * 86_400))], missing: 0, now: now)?.text, "3 days")
    }

    /// `/api/housing/profile` stamps `t` with the moment it answers. Housing and Commercial must show the age of their
    /// data, never a minute-old age from the budget's stamp.
    func testThePerRequestBudgetStampNeverDatesASection() {
        let market = page(feed: "realestate", updated: now.addingTimeInterval(-5 * 3600))
        let budget = page(feed: "housing-profile", updated: now)
        XCTAssertEqual(DeckFreshness.mark(pages: [market, budget], missing: 0, now: now)?.text, "5 h")
        let desk = page(feed: "cre", updated: now.addingTimeInterval(-3 * 3600))
        XCTAssertEqual(DeckFreshness.mark(pages: [desk, budget, page(feed: "realestate", updated: now.addingTimeInterval(-600))],
                                          missing: 0, now: now)?.text, "3 h", "the deal desk's age, not the market feed's 10 min")
        XCTAssertEqual(DeckFreshness.mark(pages: [budget], missing: 0, now: now)?.text, "Time unknown",
                       "the budget alone dates nothing")
        XCTAssertFalse(DeckSectionData.dates("housing-profile"))
        XCTAssertFalse(DeckSectionData.dates(NationalRoutes.sources))
        XCTAssertTrue(DeckSectionData.dates("realestate"))
    }

    /// One store in `errors[]` is a part not reporting: the mark says so, and the Data sheet names it. A source the feed
    /// lists as long unavailable is not counted as failing this run.
    func testOneFailedStoreTurnsTheMarkIntoAStatus() {
        let json: [String: Any] = ["t": 1_793_375_100, "stale": false,
                                   "sources": [["id": "cpi", "name": "CPI", "status": "unavailable"],
                                               ["id": "ok", "name": "Census", "status": "ok"]],
                                   "errors": [["source": "reverb_api", "reason": "HTTP 403"]], "items": []]
        guard case .loaded(let deals) = DeckFeedParser.state(feed: "ecom", json: json, now: now) else {
            return XCTFail("the feed must load")
        }
        XCTAssertEqual(DeckSectionData.failedParts(.deals, pages: [deals]), 1)
        XCTAssertEqual(DeckFreshness.mark(pages: [deals], missing: DeckSectionData.failedParts(.deals, pages: [deals]), now: now),
                       DeckFreshness(kind: .missing, text: "1 part not reporting"))
        XCTAssertEqual(DeckSectionData.sheet(.deals, pages: [deals]).sources.first { $0.failedThisRun }?.name, "reverb_api")
        XCTAssertEqual(DeckSectionData.failedParts(.deals, pages: [page(feed: "ecom", updated: now)]), 0)
    }

    /// Housing and Commercial read the same market feed: each Data sheet lists only its own lines.
    func testHousingAndCommercialDataSheetsKeepTheirOwnLines() throws {
        let root = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath().deletingLastPathComponent().deletingLastPathComponent()
        func load(_ name: String, feed: String) throws -> DeckFeedPage {
            let data = try Data(contentsOf: root.appendingPathComponent("scripts/fixtures/feeds/\(name).json"))
            let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
            guard case .loaded(let page) = DeckFeedParser.state(feed: feed, json: json, now: now) else {
                throw XCTSkip("\(name) must load")
            }
            return page
        }
        let market = try load("realestate", feed: "realestate")
        let desk = try load("cre", feed: "cre")
        let budget = page(feed: "housing-profile", updated: now)
        let housing = DeckSectionData.sheet(.housing, pages: [market, budget])
        let commercial = DeckSectionData.sheet(.commercial, pages: [desk, budget, market])
        XCTAssertTrue(housing.notes.contains { $0.contains("age-restricted") }, "the 55+ list is Housing's")
        XCTAssertFalse(housing.notes.contains { $0.hasPrefix("CRE ") }, "no national CRE series in Housing")
        XCTAssertTrue(commercial.notes.contains { $0.hasPrefix("CRE price growth: ") }, "the CRE series are Commercial's")
        XCTAssertFalse(commercial.notes.contains { $0.contains("age-restricted") }, "no 55+ list in Commercial")
        XCTAssertFalse(commercial.notes.contains { $0.hasPrefix("Market rows:") }, "no market-row dates in Commercial")
        XCTAssertFalse(commercial.notes.contains { $0.hasPrefix("30-year fixed rate:") }, "no mortgage rate dates in Commercial")
        XCTAssertTrue(commercial.notes.contains { $0.hasPrefix("Cap rate by asset class: median") }, "chart method notes")
        XCTAssertEqual(Set(commercial.sources.map(\.name)).intersection(market.sources.map(\.name)), [],
                       "the market feed's sources are Housing's")
    }

    func testStaleOrMissingTurnsTheMarkIntoAStatus() {
        let stale = [page(updated: now.addingTimeInterval(-7200), stale: true)]
        XCTAssertEqual(DeckFreshness.mark(pages: stale, missing: 0, now: now), DeckFreshness(kind: .stale, text: "Out of date · 2 h"))
        XCTAssertEqual(DeckFreshness.mark(pages: [page(updated: now)], missing: 1, now: now),
                       DeckFreshness(kind: .missing, text: "1 part not reporting"))
        XCTAssertEqual(DeckFreshness.mark(pages: [page(updated: now)], missing: 2, now: now)?.text, "2 parts not reporting")
        XCTAssertEqual(DeckFreshness.mark(pages: [], missing: 1, now: now), DeckFreshness(kind: .missing, text: "Not reporting"))
        XCTAssertEqual(DeckFreshness.mark(pages: [page(updated: nil)], missing: 0, now: now)?.text, "Time unknown")
    }

    /// A feed the deck has not collected yet is new, not broken: the card says "No data yet", so the mark says
    /// "Building" in the quiet colour. Only a failure says "Not reporting" (SeeIos I8).
    func testNotCollectedYetIsBuildingNotAFailure() {
        XCTAssertEqual(DeckFreshness.mark(pages: [], missing: 0, building: 1, now: now), DeckFreshness(kind: .building, text: "Building"))
        XCTAssertEqual(DeckFreshness.mark(pages: [], missing: 1, building: 1, now: now), DeckFreshness(kind: .missing, text: "Not reporting"),
                       "a failure next to a new feed still says so")
        XCTAssertEqual(DeckFreshness.mark(pages: [page(updated: now.addingTimeInterval(-600))], missing: 0, building: 1, now: now),
                       DeckFreshness(kind: .fresh, text: "10 min"), "a section with data and one new feed shows its age")
    }

    /// `Int(_:)` traps outside its range. A feed `t` of -1e30 makes the age 1e30 seconds, which must read as days, not crash.
    func testAHugeAgeDoesNotTrapTheFreshnessText() {
        XCTAssertEqual(DeckFreshness.short(1e30), "1000000000000000 days")
        XCTAssertEqual(DeckFreshness.short(.greatestFiniteMagnitude), "1000000000000000 days")
        XCTAssertEqual(DeckFreshness.short(.infinity), "0 days", "a non-finite age reads as zero, never traps")
        XCTAssertEqual(DeckFreshness.short(2 * 86_400), "2 days")
    }

    func testSourceRowsFromStringsObjectsAndErrors() {
        let json: [String: Any] = [
            "sources": [["id": "census_ecom", "name": "Quarterly e-commerce retail sales", "publisher": "US Census Bureau",
                         "status": "ok", "as_of": "2026-Q2"],
                        ["id": "ebay_browse", "name": "eBay Browse API", "publisher": "eBay", "status": "needs_key",
                         "reason": "needs EBAY_CLIENT_ID"],
                        ["id": "amazon_web", "name": "Amazon store pages", "status": "refused", "reason": "terms"],
                        ["id": "bls", "name": "CPI", "status": "stale", "as_of": "2026-10"]],
            "errors": [["source": "bls", "reason": "timed out"], ["source": "reverb_api", "reason": "HTTP 403"]],
        ]
        let rows = DeckSources.rows(json, now: now)
        XCTAssertEqual(rows.map(\.state), [.ok, .needsKey, .blocked, .stale, .notReporting])
        XCTAssertEqual(rows.map(\.state.word), ["OK", "Needs a key", "Blocked", "Out of date", "Not reporting"])
        XCTAssertEqual(rows[0].asOf, "Q2 2026")
        XCTAssertEqual(rows[0].detail, "US Census Bureau")
        XCTAssertEqual(rows[3].asOf, "Oct 2026")
        XCTAssertEqual(rows[3].note, nil, "a stale row keeps its own state; only an OK row turns Not reporting")
        XCTAssertEqual(rows.map(\.failedThisRun), [false, false, false, true, true], "errors[] marks what failed this run")
        XCTAssertEqual(rows[4].name, "reverb_api")
        XCTAssertEqual(rows[4].note, "HTTP 403")
    }

    func testPlainSourceNamesDropFilePathsAndRepeats() {
        let rows = DeckSources.rows(["src": ["Zillow Research", "~/.meshvault/status/house-feeds/realestate.json", "zillow research", "FRED"]])
        XCTAssertEqual(rows.map(\.name), ["Zillow Research", "FRED"], "a file path is never a source name")
    }

    func testPeriodWords() {
        XCTAssertEqual(DeckSources.periodWords("2026-11-14"), "Nov 14")
        XCTAssertEqual(DeckSources.periodWords("2026-11-14T18:40:00-08:00"), "Nov 14")
        XCTAssertEqual(DeckSources.periodWords("2026-09"), "Sep 2026")
        XCTAssertEqual(DeckSources.periodWords("2026-Q2"), "Q2 2026")
        XCTAssertEqual(DeckSources.periodWords("weekly"), "weekly")
        XCTAssertEqual(DeckSources.period(1_792_692_000, now: now), "Oct 22", "an epoch more than a day old reads as a date")
    }

    /// The method lines the Housing and Commercial pages used to print land in the Data sheet instead.
    func testHousingAndDeskNotesCarryWhatThePagesDropped() throws {
        let root = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: root.appendingPathComponent("scripts/fixtures/feeds/realestate.json"))
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        guard case .loaded(let page) = DeckFeedParser.state(feed: "realestate", json: json) else {
            return XCTFail("realestate must load")
        }
        XCTAssertTrue(page.notes.contains { $0.hasPrefix("30-year fixed rate: FRED") })
        XCTAssertTrue(page.notes.contains { $0.contains("age-restricted") }, "the 55+ note moves to the Data sheet")
    }
}
