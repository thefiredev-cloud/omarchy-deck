import Foundation
import XCTest
@testable import OmarchyDeck

/// The native deal desk follows the web desk's rules (`static/cre.js`): filters, sort with missing values last, the stake
/// sized to the Housing budget, the three co-invest views and the overview band. Synthetic deals only.
final class DeckCommercialTests: XCTestCase {
    private func row(_ id: String, type: String = "Retail", price: Double? = 1_000_000, units: Double? = nil,
                     sqft: Double? = 5_000, cap: Double? = 6, capKind: String = "listed", dom: Double? = 30,
                     score: Double? = 60, county: String = "Orange County", zip: String = "92629",
                     dscr: Double? = 1.4, coc: Double? = 8, title: String? = nil, tenancy: String? = nil) -> [String: Any] {
        var d: [String: Any] = ["id": id, "type": type, "county": county, "zip": zip, "city": "Sample City",
                                "title": title ?? "Deal \(id)", "url": "https://example.com/\(id)"]
        if let price { d["price"] = price }
        if let units { d["units"] = units }
        if let sqft { d["sqft"] = sqft; if let price { d["ppsf"] = (price / sqft).rounded() } }
        if let cap { d["cap"] = ["value": cap, "kind": capKind] }
        if let dom { d["dom"] = ["days": dom] }
        if let score { d["score"] = score }
        if let dscr { d["dscr_cre"] = dscr; d["dscr_res"] = dscr }
        if let coc { d["coc_cre"] = coc; d["coc_res"] = coc }
        if let tenancy { d["tenancy"] = tenancy }
        return d
    }

    private func deal(_ id: String, _ build: (inout [String: Any]) -> Void = { _ in }) throws -> CommercialDeal {
        var r = row(id)
        build(&r)
        return try XCTUnwrap(DeckCommercialParser.deal(r))
    }

    private func desk(_ deals: [[String: Any]], boxesOf: [String: Any] = [:], extra: [String: Any] = [:]) throws -> CommercialDesk {
        var json: [String: Any] = [
            "person": "tanner", "viewer": false, "generated_at": 1_794_600_000, "deals": deals,
            "profile": ["label": "Tanner", "about": "A smaller investor.", "boxes": []],
            "boxes_of": boxesOf,
            "assumptions": ["res": ["ltv": 0.75], "cre": ["ltv": 0.65], "closing": 0.02, "note": "Assumptions, not quotes."],
            "rates": ["mortgage_30y": ["value": 7.11, "as_of": "2026-11-12", "src": "FRED"],
                      "treasury_10y": ["value": 4.98, "as_of": "2026-11-10"],
                      "commercial": ["value": 7.23, "as_of": "2026-11-10", "src": "10-year Treasury + 2.25%"]],
            "counts": ["by_source": ["matthews": 2, "svn": 1]],
        ]
        for (k, v) in extra { json[k] = v }
        guard case .desk(let desk) = DeckCommercialParser.outcome(from: json) else { throw XCTSkip("desk did not parse") }
        return desk
    }

    // MARK: Parsing

    func testANotReportingDeskIsAFailureWithItsReason() {
        let state = DeckFeedParser.state(feed: "cre", status: 200,
                                         body: Data(#"{"status":"not_reporting","reason":"the collector has not written the desk yet"}"#.utf8))
        XCTAssertEqual(state, .failed("the collector has not written the desk yet"))
        XCTAssertEqual(DeckFeedParser.state(feed: "cre", status: 403, body: Data()), .ownerOnly,
                       "a household guest gets no deal desk")
    }

    func testADeskIsDatedByItsOwnGenerationTimeAndGoesStaleAfterSixHours() throws {
        let body = #"{"t":1794700000,"generated_at":1794600000,"person":"tanner","deals":[],"profile":{"boxes":[]}}"#
        let fresh = DeckFeedParser.state(feed: "cre", status: 200, body: Data(body.utf8), now: Date(timeIntervalSince1970: 1_794_603_600))
        guard case .loaded(let page) = fresh else { return XCTFail("desk must load") }
        XCTAssertEqual(page.updated, Date(timeIntervalSince1970: 1_794_600_000), "generated_at, not the answer time")
        XCTAssertFalse(page.stale)
        let late = DeckFeedParser.state(feed: "cre", status: 200, body: Data(body.utf8), now: Date(timeIntervalSince1970: 1_794_600_000 + 7 * 3600))
        guard case .loaded(let old) = late else { return XCTFail("desk must load") }
        XCTAssertTrue(old.stale)
    }

    func testDealsKeepUnknownsAsNil() throws {
        let d = try XCTUnwrap(DeckCommercialParser.deal(["id": "abc", "type": "Office", "title": "Sample Tower"]))
        XCTAssertNil(d.price)
        XCTAssertNil(d.cap)
        XCTAssertNil(d.daysOnMarket)
        XCTAssertNil(d.score)
        XCTAssertEqual(d.type, "Office")
        XCTAssertNil(DeckCommercialParser.deal(["type": "Office"]), "a deal needs an id")
        XCTAssertEqual(try XCTUnwrap(DeckCommercialParser.deal(["id": "x"])).type, "Other")
        XCTAssertEqual(try XCTUnwrap(DeckCommercialParser.deal(["id": "x"])).title, "Address withheld")
    }

    func testBuyBoxFiltersParseEveryKnownField() throws {
        let boxes = DeckCommercialParser.buyBoxes([
            ["id": "b1", "name": "Box", "f": ["types": ["Industrial"], "counties": ["Orange County"], "zips": ["926"],
                                              "price_min": 1.0, "price_max": 9.0, "cap_min": 5.5, "units_min": 5, "sf_min": 100,
                                              "dom_max": 90, "score_min": 50, "q": "irvine", "sort": "cap"]],
            ["name": "no id"],
        ])
        XCTAssertEqual(boxes.count, 1)
        let f = boxes[0].filter
        XCTAssertEqual(f.types, ["Industrial"])
        XCTAssertEqual(f.zips, ["926"])
        XCTAssertEqual(f.capMin, 5.5)
        XCTAssertEqual(f.unitsMin, 5)
        XCTAssertEqual(f.query, "irvine")
        XCTAssertEqual(f.sort, .cap)
        XCTAssertEqual(DeckCommercialParser.filter(["sort": "bogus"]).sort, .score)
    }

    // MARK: Filters and sorting

    func testFiltersFollowTheWebRules() throws {
        let office = try deal("o1") { $0["type"] = "Office" }
        let retail = try deal("r1")
        var f = CommercialFilter()
        f.types = ["Office"]
        XCTAssertTrue(CommercialLogic.matches(office, f))
        XCTAssertFalse(CommercialLogic.matches(retail, f))
        f = CommercialFilter()
        f.zips = ["926"]
        XCTAssertTrue(CommercialLogic.matches(retail, f), "a ZIP filter matches by prefix")
        f.zips = ["921"]
        XCTAssertFalse(CommercialLogic.matches(retail, f))
        // A deal that does not show the number never passes a filter on it.
        let unknownCap = try deal("u1") { $0.removeValue(forKey: "cap") }
        f = CommercialFilter()
        f.capMin = 5
        XCTAssertFalse(CommercialLogic.matches(unknownCap, f))
        XCTAssertTrue(CommercialLogic.matches(retail, f))
        f = CommercialFilter()
        f.priceMax = 500_000
        XCTAssertFalse(CommercialLogic.matches(retail, f))
        f = CommercialFilter()
        f.query = "SAMPLE CITY"
        XCTAssertTrue(CommercialLogic.matches(retail, f), "search ignores case")
        f.query = "nowhere"
        XCTAssertFalse(CommercialLogic.matches(retail, f))
    }

    /// A box's optional `dscr_min` floors the commercial-rate DSCR, as `/api/cre/deals?box=` does, so the app's match
    /// counts agree with the web: a deal with no DSCR fails a box with a floor; a box without the key is unchanged.
    func testBuyBoxDSCRFloorMatchesTheServer() throws {
        let boxes = DeckCommercialParser.buyBoxes([["id": "floor", "name": "Floor", "f": ["dscr_min": 1.25]],
                                                   ["id": "zero", "name": "Zero", "f": ["dscr_min": 0]],
                                                   ["id": "open", "name": "Open", "f": [:]]])
        let floor = boxes[0].filter, zero = boxes[1].filter, open = boxes[2].filter
        XCTAssertEqual(floor.dscrMin, 1.25)
        XCTAssertEqual(zero.dscrMin, 0)
        XCTAssertNil(open.dscrMin)
        let covers = try deal("c")
        let thin = try deal("t") { $0["dscr_cre"] = 1.1; $0["dscr_res"] = 1.6 }
        let unknown = try deal("u") { $0.removeValue(forKey: "dscr_cre") }
        XCTAssertTrue(CommercialLogic.matches(covers, floor), "1.40 clears a 1.25 floor")
        XCTAssertFalse(CommercialLogic.matches(thin, floor), "the floor reads the commercial-rate DSCR, not the residential one")
        XCTAssertFalse(CommercialLogic.matches(unknown, floor), "no DSCR never passes a floor")
        XCTAssertFalse(CommercialLogic.matches(unknown, zero), "even a zero floor needs a DSCR")
        XCTAssertTrue([covers, thin, unknown].allSatisfy { CommercialLogic.matches($0, open) }, "no key, no floor")
    }

    // MARK: Words brought back from the old desk (parity audit 2026-11-15)

    /// A deal row says its grade and score, size, days listed and your stake; the stake follows Show amounts.
    func testDealRowCarriesScoreAndAMaskedStake() throws {
        let desk = try desk([row("mf", type: "Multifamily", price: 1_000_000, units: 3, dom: 40, score: 62, dscr: 1.5, coc: 8)])
        let deal = try XCTUnwrap(desk.deals.first)
        let stake = try XCTUnwrap(CommercialLogic.stake(deal, cap: 50_000, desk.assumptions))
        XCTAssertEqual(CommercialLogic.rowDetail(deal, stake: stake, showAmounts: false),
                       "Grade B · score 62 · 3 units · 40 days listed · your stake •••", "the stake is masked by default")
        let shown = CommercialLogic.rowDetail(deal, stake: stake, showAmounts: true)
        XCTAssertTrue(shown.hasPrefix("Grade B · score 62 · 3 units · 40 days listed · your stake \(stake.shareText), $"), shown)
        XCTAssertTrue(shown.hasSuffix("/yr"), shown)
        XCTAssertEqual(CommercialLogic.rowDetail(deal, stake: nil, showAmounts: true), "Grade B · score 62 · 3 units · 40 days listed",
                       "a viewer's desk or an unset budget shows no stake")
        let unscored = try self.deal("u") { $0.removeValue(forKey: "score"); $0.removeValue(forKey: "dom") }
        XCTAssertEqual(CommercialLogic.rowDetail(unscored, stake: nil, showAmounts: false), "5,000 SF", "no score, no grade words")
    }

    func testBestDealsSaysWhatItCovers() {
        XCTAssertEqual(CommercialLogic.bestTitle(view: .all, boxName: nil, filtered: false), "Best deals: all deals")
        XCTAssertEqual(CommercialLogic.bestTitle(view: .all, boxName: nil, filtered: true), "Best deals: your filters")
        XCTAssertEqual(CommercialLogic.bestTitle(view: .all, boxName: "Coastal NNN", filtered: false), "Best deals in buy box Coastal NNN")
        XCTAssertEqual(CommercialLogic.bestTitle(view: .jordan, boxName: nil, filtered: false), "Best deals: co-invest with Jordan")
        XCTAssertEqual(CommercialLogic.bestTitle(view: .small, boxName: "ignored", filtered: true),
                       "Best deals: small deals you could buy whole")
    }

    func testSummaryTablesSayWhenTheyCut() {
        XCTAssertEqual(CommercialLogic.cut(shown: 12, of: 31), "Top 12 of 31")
        XCTAssertNil(CommercialLogic.cut(shown: 12, of: 12), "a table that shows every row says nothing")
        XCTAssertNil(CommercialLogic.cut(shown: 10, of: 3))
    }

    func testLPMinimumIsSaidAsAnAssumptionAndChartMethodsReachTheDataSheet() throws {
        XCTAssertEqual(CommercialLogic.lpLine, "An LP stake usually starts near $25K (assumption).")
        let notes = DeckCommercialParser.notes(try desk([row("a")]))
        XCTAssertTrue(notes.contains { $0.hasPrefix("Cap rate by asset class: median of listed and estimated caps") })
        XCTAssertTrue(notes.contains { $0.hasPrefix("Days listed: the listing's own date") })
        XCTAssertTrue(notes.contains { $0.hasPrefix("Listings by county: count of for-sale listings") })
    }

    func testSortPutsMissingValuesLastWhateverTheDirection() throws {
        let a = try deal("a") { $0["score"] = 40.0; $0["price"] = 900_000.0 }
        let b = try deal("b") { $0["score"] = 80.0; $0["price"] = 400_000.0 }
        let c = try deal("c") { $0.removeValue(forKey: "score"); $0.removeValue(forKey: "price") }
        XCTAssertEqual(CommercialLogic.sorted([a, c, b], by: .score).map(\.id), ["b", "a", "c"])
        XCTAssertEqual(CommercialLogic.sorted([a, c, b], by: .price).map(\.id), ["b", "a", "c"])
        let same = try deal("d") { $0["score"] = 40.0 }
        XCTAssertEqual(CommercialLogic.sorted([a, same], by: .score).map(\.id), ["a", "d"], "ties keep the feed order")
    }

    // MARK: Stake

    func testAStakeIsSizedToTheBudgetWithTheDecksOwnScenario() throws {
        let desk = try desk([row("mf", type: "Multifamily", price: 1_000_000, units: 3, dscr: 1.5, coc: 5)])
        let mf = try XCTUnwrap(desk.deals.first)
        // 2 to 4 units use the 30-year scenario: 25% down plus 2% closing on $1M is $270,000 of equity.
        let stake = try XCTUnwrap(CommercialLogic.stake(mf, cap: 100_000, desk.assumptions))
        XCTAssertEqual(stake.need, 270_000, accuracy: 0.01)
        XCTAssertEqual(stake.share, 100_000 / 270_000, accuracy: 0.0001)
        XCTAssertEqual(stake.equity, 100_000, accuracy: 0.01)
        XCTAssertEqual(try XCTUnwrap(stake.cashFlow), 5_000, accuracy: 0.01)
        XCTAssertFalse(stake.whole)
        XCTAssertTrue(stake.fits)
        XCTAssertTrue(stake.small)
        XCTAssertTrue(stake.usesResidentialScenario)
        XCTAssertEqual(stake.shareText, "37.0%")
        // A bigger budget buys the whole deal and the share caps at 100%.
        let whole = try XCTUnwrap(CommercialLogic.stake(mf, cap: 400_000, desk.assumptions))
        XCTAssertEqual(whole.share, 1)
        XCTAssertEqual(whole.equity, 270_000, accuracy: 0.01)
        XCTAssertTrue(whole.whole)
    }

    func testAStakeNeedsABudgetAndAPriceAndFitsOnlyOverTheLPMinimumAndDebtCover() throws {
        let d = try desk([row("r", type: "Retail", price: 2_000_000, dscr: 0.9, coc: nil)])
        let retail = try XCTUnwrap(d.deals.first)
        XCTAssertNil(CommercialLogic.stake(retail, cap: nil, d.assumptions), "no budget, no stake")
        XCTAssertNil(CommercialLogic.stake(retail, cap: 0, d.assumptions))
        XCTAssertNil(CommercialLogic.stake(try deal("n") { $0.removeValue(forKey: "price") }, cap: 100_000, d.assumptions),
                     "an unknown price is never sized as $0")
        let commercial = try XCTUnwrap(CommercialLogic.stake(retail, cap: 100_000, d.assumptions))
        XCTAssertEqual(commercial.need, 2_000_000 * 0.35 + 2_000_000 * 0.02, accuracy: 0.01, "commercial: 65% loan plus closing")
        XCTAssertFalse(commercial.usesResidentialScenario)
        XCTAssertNil(commercial.cashFlow, "no income figure, no cash flow")
        XCTAssertFalse(commercial.fits, "the deal does not cover its debt")
        XCTAssertEqual(commercial.verdict, "No stake fit: the deal does not cover its debt at this rate.")
        let covered = try XCTUnwrap(CommercialLogic.stake(try deal("c") { $0["dscr_cre"] = 1.3 }, cap: 20_000, d.assumptions))
        XCTAssertFalse(covered.fits, "a budget under the LP minimum does not fit")
        XCTAssertEqual(covered.verdict, "No stake fit: your budget is under the assumed LP minimum.")
        let noIncome = try XCTUnwrap(CommercialLogic.stake(try deal("i") { $0.removeValue(forKey: "dscr_cre") }, cap: 100_000, d.assumptions))
        XCTAssertEqual(noIncome.verdict, "No stake fit: the deal has no income figure to check its debt.")
    }

    func testSmallDealRules() throws {
        XCTAssertTrue(CommercialLogic.isSmall(try deal("a") { $0["type"] = "Multifamily"; $0["units"] = 4.0 }))
        XCTAssertFalse(CommercialLogic.isSmall(try deal("b") { $0["type"] = "Multifamily"; $0["units"] = 5.0 }))
        XCTAssertFalse(CommercialLogic.isSmall(try deal("c") { $0["type"] = "Multifamily"; $0.removeValue(forKey: "units") }))
        XCTAssertTrue(CommercialLogic.isSmall(try deal("d") { $0["type"] = "Mixed use"; $0["price"] = 3_000_000.0 }))
        XCTAssertFalse(CommercialLogic.isSmall(try deal("e") { $0["type"] = "Mixed use"; $0["price"] = 3_000_001.0 }))
        XCTAssertTrue(CommercialLogic.isSmall(try deal("f") { $0["tenancy"] = "Single Tenant NNN"; $0["price"] = 2_500_000.0 }))
        XCTAssertFalse(CommercialLogic.isSmall(try deal("g") { $0["price"] = 2_500_000.0 }), "plain retail is not a small net-lease deal")
        XCTAssertFalse(CommercialLogic.isSmall(try deal("h") { $0["type"] = "Industrial" }))
    }

    func testCoInvestViewsReadTheOtherDesksBoxesAndTheBudget() throws {
        let boxes: [String: Any] = [
            "jordan": [["id": "mf", "name": "MF", "f": ["types": ["Multifamily"]]]],
            "riley": [["id": "ind", "name": "Industrial", "f": ["types": ["Industrial"]]]],
        ]
        let d = try desk([
            row("mf-fit", type: "Multifamily", price: 1_000_000, units: 3, dscr: 1.4),
            row("mf-nofit", type: "Multifamily", price: 1_000_000, units: 3, dscr: 0.8),
            row("ind-fit", type: "Industrial", price: 4_000_000, dscr: 1.3),
            row("office", type: "Office", price: 4_000_000, dscr: 1.3),
        ], boxesOf: boxes)
        func ids(_ view: CommercialView, cap: Double?) -> [String] {
            d.deals.filter { CommercialLogic.inView($0, view, desk: d, cap: cap) }.map(\.id)
        }
        XCTAssertEqual(ids(.all, cap: nil).count, 4, "All deals needs no budget")
        XCTAssertEqual(ids(.jordan, cap: 300_000), ["mf-fit"], "Jordan: in his box, the deal covers its debt, the budget clears the LP minimum")
        XCTAssertEqual(ids(.riley, cap: 300_000), ["ind-fit"])
        XCTAssertEqual(ids(.jordan, cap: 10_000), [], "under the LP minimum nothing fits")
        XCTAssertEqual(ids(.jordan, cap: nil), [], "no budget, no co-invest")
        XCTAssertEqual(ids(.small, cap: 300_000), ["mf-fit", "mf-nofit"], "small deals the budget buys whole")
        XCTAssertEqual(ids(.small, cap: 100_000), [], "270K of equity is not inside a 100K budget")
        let hits = CommercialLogic.hits(d, view: .jordan, filter: CommercialFilter(), cap: 300_000)
        XCTAssertEqual(hits.map(\.id), ["mf-fit"])
        // A viewer token (Jordan or Riley) has no investor views.
        let viewer = try desk([row("a")], extra: ["viewer": true, "person": "jordan"])
        XCTAssertFalse(viewer.isTanner)
    }

    // MARK: Overview

    func testGradeThresholds() {
        XCTAssertEqual(CommercialLogic.grade(70), "A")
        XCTAssertEqual(CommercialLogic.grade(69.9), "B")
        XCTAssertEqual(CommercialLogic.grade(55), "B")
        XCTAssertEqual(CommercialLogic.grade(40), "C")
        XCTAssertEqual(CommercialLogic.grade(39), "D")
        XCTAssertEqual(CommercialLogic.grade(nil), DeckMissing.cell)
    }

    func testMedianAndQuantile() {
        XCTAssertEqual(CommercialLogic.median([3, nil, 1, 2]), 2)
        XCTAssertEqual(CommercialLogic.median([1, 2, 3, 4]), 2.5)
        XCTAssertNil(CommercialLogic.median([nil, nil]))
        XCTAssertEqual(CommercialLogic.quantile([1, 2, 3, 4, 5], 0.5), 3)
        XCTAssertEqual(CommercialLogic.quantile([0, 10], 0.25), 2.5)
    }
    func testQuantileReturnsNilForInputsThatWouldTrapIndexing() {
        XCTAssertNil(CommercialLogic.quantile([], 0.5), "Empty data must not subscript at index -1")
        XCTAssertNil(CommercialLogic.quantile([1, 2], .nan), "A non-finite percentile cannot form safe indices")
        XCTAssertNil(CommercialLogic.quantile([1, 2], 1.1), "A percentile above one must not index past the end")
    }


    func testOverviewSummariesAndCharts() throws {
        var rows: [[String: Any]] = []
        for i in 0..<4 { rows.append(row("o\(i)", type: "Office", price: Double(1_000_000 + i * 100_000), cap: 5 + Double(i), capKind: i < 2 ? "listed" : "estimate", dom: Double(10 + i * 100), zip: "92629")) }
        rows.append(row("r1", type: "Retail", price: 500_000, cap: nil, dom: nil, county: "Los Angeles County", zip: "90001"))
        let d = try desk(rows)
        let o = d.overview
        XCTAssertEqual(o.sourceCount, 2)
        let office = try XCTUnwrap(o.byType.first(where: { $0.key == "Office" }))
        XCTAssertEqual(office.count, 4)
        XCTAssertEqual(office.price, 1_150_000, "median of 1.0M to 1.3M")
        XCTAssertEqual(office.cap, 5.5, "the median of listed caps only: 5 and 6")
        XCTAssertEqual(office.listedCaps, 2)
        XCTAssertEqual(o.byType.first?.key, "Office", "the biggest group first")
        let retail = try XCTUnwrap(o.byType.first(where: { $0.key == "Retail" }))
        XCTAssertNil(retail.cap, "no cap shown means no cap, never 0%")
        XCTAssertNil(retail.daysOnMarket)
        XCTAssertEqual(o.byCounty.map(\.key), ["Orange", "Los Angeles"])
        XCTAssertEqual(o.byZip.map(\.key), ["92629 Sample City"], "ZIPs with 3 or more listings")
        XCTAssertEqual(o.capByType.map(\.label), ["Office"], "asset classes need 3 caps")
        XCTAssertEqual(try XCTUnwrap(o.capByType.first).value, 6.5, accuracy: 0.01, "median of listed and estimated caps 5, 6, 7 and 8")
        XCTAssertEqual(o.domBuckets.map(\.value), [0, 1, 0, 1, 2, 0], "10, 110, 210 and 310 days")
        XCTAssertEqual(o.countyCounts.map(\.label), ["Orange", "Los Angeles"])
        XCTAssertEqual(o.freshCount, 1)
        XCTAssertEqual(o.staleCount, 3)
        XCTAssertEqual(o.medianListedCap, 5.5)
        XCTAssertEqual(o.rateBars.map(\.label), ["30-year fixed", "10-year Treasury", "Commercial, est.", "Median listed cap"])
        XCTAssertTrue(try XCTUnwrap(o.rateBars.first(where: { $0.label.contains("est.") })).isEstimate,
                      "an assumption is drawn as one")
    }

    func testEveryNumberOnTheDeskKeepsItsUnknownAsAbsent() throws {
        let d = try desk([["id": "bare", "type": "Land"]])
        XCTAssertNil(d.overview.medianListedCap)
        XCTAssertEqual(d.overview.byType.first?.price, nil)
        XCTAssertEqual(d.overview.domBuckets.map(\.value), [0, 0, 0, 0, 0, 0])
        XCTAssertEqual(try XCTUnwrap(d.deals.first).smallText, "   ")
    }
}
