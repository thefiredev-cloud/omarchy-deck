import Foundation
import XCTest
@testable import OmarchyDeck

/// Surf reads `GET /api/surf-coast` and `GET /api/surf-coast/region/<id>`. The fixtures are cut from the SurfCoast
/// lane's staged feed of 2026-11-14 (rows dropped, values unchanged): pinned spots come first in owner order, model-only
/// Baja spots are marked as forecasts with low confidence and no buoy, and words follow the page blueprint.
final class DeckSurfTests: XCTestCase {
    private func fixture(_ name: String) throws -> [String: Any] {
        let root = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: root.appendingPathComponent("scripts/fixtures/feeds/\(name).json"))
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func overview() throws -> SurfOverview {
        guard case .loaded(let page) = DeckFeedParser.state(feed: "surf-coast", json: try fixture("surf-coast")),
              let surf = page.surf else {
            throw XCTSkip("the surf fixture must load")
        }
        return surf
    }

    func testRegionsRunSouthToNorthAndPinnedSpotsComeFirstInOwnerOrder() throws {
        let surf = try overview()
        XCTAssertEqual(surf.regions.map(\.id), SurfRegions.ids, "14 regions, Baja Sur to Oregon North")
        XCTAssertEqual(surf.pinned.map(\.name), ["Salt Creek", "Strands", "Doheny State Beach", "San Clemente Pier",
                                                 "Trestles (Lowers)", "San Onofre (Old Mans)", "Huntington Beach Pier"])
        let oc = try XCTUnwrap(surf.region("orange-county"))
        XCTAssertEqual(oc.rating.word, "Great")
        XCTAssertEqual(oc.rating.pips, 5)
        XCTAssertEqual(SurfWords.height(oc.waveFt), "5-6 ft")
        XCTAssertEqual(SurfWords.waterRange(oc.waterMin, oc.waterMax), "74-75°F")
        XCTAssertEqual(SurfWords.best(oc.best), "Tomorrow 6-8 am", "after dark the best window is tomorrow")
        XCTAssertEqual(oc.confidence?.dots, 3)
    }

    func testSaltCreekNowCarriesItsSwellPartsBuoyAndTide() throws {
        let surf = try overview()
        let salt = try XCTUnwrap(surf.spots.first { $0.id == "salt-creek" })
        XCTAssertEqual(salt.pinned, 1)
        XCTAssertFalse(salt.modelOnly)
        XCTAssertEqual(SurfWords.height(salt.waveFt), "5-6 ft")
        XCTAssertEqual(SurfWords.period(salt.periodS, model: salt.modelOnly), "15 s")
        XCTAssertEqual(salt.swell.map(\.title), ["Primary swell", "Secondary swell", "Wind chop"])
        XCTAssertEqual(SurfWords.wind(salt.wind), "2 kt SW")
        XCTAssertEqual(SurfWords.windWord(salt.wind), "Glassy", "calm wind reads Glassy")
        XCTAssertEqual(SurfWords.water(salt.waterF), "75°F")
        XCTAssertEqual(salt.buoy?.name, "Capistrano Beach Nearshore")
        XCTAssertEqual(salt.days.count, 7)
        XCTAssertEqual(salt.days.first?.label, "Today")
        XCTAssertNotNil(SurfWords.tide(salt.tideNext))
    }

    /// Baja Sur has no wave buoys: the spot reads as a forecast, about its period, with a low mark and no buoy row.
    func testModelOnlySpotsNeverLookLikeBuoyReadings() throws {
        let surf = try overview()
        let cabo = try XCTUnwrap(surf.spots.first { $0.id == "cabo-falso" })
        XCTAssertTrue(cabo.modelOnly)
        XCTAssertNil(cabo.buoy, "no nearest buoy for a model-only spot")
        XCTAssertEqual(cabo.confidence?.dots, 1)
        XCTAssertEqual(SurfWords.period(cabo.periodS, model: true), "about 14 s")
        XCTAssertTrue(surf.isModelOnly("baja-sur"))
        XCTAssertFalse(surf.isModelOnly("orange-county"))
    }

    func testBestNowIsTopFiveByRatingThenSize() throws {
        let surf = try overview()
        let best = surf.bestNow
        XCTAssertEqual(best.count, 5)
        for (a, b) in zip(best, best.dropFirst()) {
            let ra = a.rating.score ?? 0, rb = b.rating.score ?? 0
            XCTAssertTrue(ra > rb || (ra == rb && (a.hsFt ?? 0) >= (b.hsFt ?? 0)), "\(a.name) before \(b.name)")
        }
    }

    func testBuoysAlertsWaterAndDataNotes() throws {
        let surf = try overview()
        XCTAssertEqual(surf.buoys.count, 74)
        let sorted = surf.buoysSouthToNorth.compactMap(\.lat)
        XCTAssertEqual(sorted, sorted.sorted())
        let tanner = try XCTUnwrap(surf.buoys.first { $0.id == "46047" })
        XCTAssertNil(tanner.waveFt, "a station without a wave sensor keeps a nil height, never 0")
        XCTAssertEqual(tanner.waterF, 67.6)
        XCTAssertEqual(surf.alerts.count, 21)
        XCTAssertEqual(SurfWords.alert(surf.alerts[0]), "High surf advisory · San Diego and Orange County · until Sun 10 am")
        XCTAssertFalse(surf.bins.isEmpty)
        XCTAssertEqual(surf.bins.map(\.lat), surf.bins.map(\.lat).sorted())
        XCTAssertTrue(surf.notes.contains { $0.hasPrefix("Baja has no public wave buoys") }, "feed gaps go to the Data sheet")
        XCTAssertTrue(surf.notes.contains { $0.contains("246 spots") })
    }

    /// Parses the surf fixture with its alerts replaced, the way the page would receive them.
    private func overview(alerts: [[String: Any]]) throws -> SurfOverview {
        var json = try fixture("surf-coast")
        json["alerts"] = alerts
        guard case .loaded(let page) = DeckFeedParser.state(feed: "surf-coast", json: json), let surf = page.surf else {
            throw XCTSkip("the surf fixture must load")
        }
        return surf
    }

    private func alertRows(where keep: ([String: Any]) -> Bool) throws -> [[String: Any]] {
        try XCTUnwrap(try fixture("surf-coast")["alerts"] as? [[String: Any]]).filter(keep)
    }

    /// The staged feed: one advisory touches Orange County (your spots), twenty are elsewhere on the coast.
    func testOnlyYourRegionsAlertsGoAboveYourSpots() throws {
        let plan = try overview().alertPlan
        XCTAssertEqual(try overview().homeRegions, ["orange-county"])
        XCTAssertEqual(plan.top.map(SurfWords.alert), ["High surf advisory · San Diego and Orange County · until Sun 10 am"])
        XCTAssertNil(plan.moreHomeLine)
        XCTAssertEqual(plan.elsewhereLine, "20 more alerts along the coast")
        XCTAssertEqual(plan.all.count, 21, "the full list holds every alert")
        XCTAssertEqual(plan.all.first?.regions, ["san-diego", "orange-county"], "your regions lead the full list")
        XCTAssertEqual(plan.all.dropFirst().first?.severity, "Severe", "then the coast, most severe first")
    }

    /// Alerts only in far regions: nothing above your spots, one quiet line after them.
    func testFarAlertsNeverGoAboveYourSpots() throws {
        let far = try alertRows { !(($0["regions"] as? [String]) ?? []).contains("orange-county") }
        let plan = try overview(alerts: far).alertPlan
        XCTAssertTrue(plan.top.isEmpty, "no far alert may sit above your spots")
        XCTAssertNil(plan.moreHomeLine)
        XCTAssertEqual(plan.elsewhere, 20)
        XCTAssertEqual(plan.elsewhereLine, "20 more alerts along the coast")
        XCTAssertEqual(try overview(alerts: Array(far.prefix(1))).alertPlan.elsewhereLine, "1 more alert along the coast")
        XCTAssertNil(try overview(alerts: []).alertPlan.elsewhereLine, "no alerts, no line")
    }

    /// Four alerts on your region: the two most severe show, then "+2 more"; feed order breaks ties.
    func testFourHomeAlertsShowTheTwoMostSevereThenACount() throws {
        func row(_ id: String, _ event: String, _ severity: String, _ regions: [String]) -> [String: Any] {
            ["id": id, "event": event, "severity": severity, "regions": regions, "until_label": "Sun 10 am"]
        }
        let alerts = [row("a", "Beach Hazards Statement", "Minor", ["orange-county"]),
                      row("b", "Rip Current Statement", "Moderate", ["orange-county"]),
                      row("c", "Gale Warning", "Severe", ["oregon-north"]),
                      row("d", "High Surf Warning", "Severe", ["san-diego", "orange-county"]),
                      row("e", "Coastal Flood Warning", "Extreme", ["orange-county"])]
        let plan = try overview(alerts: alerts).alertPlan
        XCTAssertEqual(plan.top.map(\.id), ["e", "d"], "most severe first, at most two rows")
        XCTAssertEqual(plan.moreHome, 2)
        XCTAssertEqual(plan.moreHomeLine, "+2 more")
        XCTAssertEqual(plan.elsewhereLine, "1 more alert along the coast")
        XCTAssertEqual(plan.all.map(\.id), ["e", "d", "b", "a", "c"])
        XCTAssertEqual(SurfAlertPlan.rank("Unknown"), 4)
        let ties = SurfAlertPlan(alerts: [SurfAlert(id: "x", event: "A", severity: "Minor", text: nil, regions: ["r"], untilLabel: nil),
                                          SurfAlert(id: "y", event: "B", severity: "Minor", text: nil, regions: ["r"], untilLabel: nil)],
                                 homeRegions: ["r"])
        XCTAssertEqual(ties.top.map(\.id), ["x", "y"], "equal severities keep the feed's order")
    }

    func testDataRowsCarrySourceStatesAndThisRunsFailure() throws {
        guard case .loaded(let page) = DeckFeedParser.state(feed: "surf-coast", json: try fixture("surf-coast")) else {
            return XCTFail("surf must load")
        }
        XCTAssertEqual(page.sources.count, 10, "this run's failure marks its own row, not a second one")
        XCTAssertEqual(page.sources.first?.name, "Buoy and shore station readings")
        XCTAssertEqual(page.sources.first?.detail, "NOAA NDBC")
        let failed = try XCTUnwrap(page.sources.first { $0.state == .notReporting })
        XCTAssertEqual(failed.name, "Satellite water temperature")
        XCTAssertNotNil(failed.note)
        XCTAssertFalse(page.stale)
    }

    func testRegionFileAddsHoursTideCurvePartsAndSun() throws {
        let json = try fixture("surf-coast-region-orange-county")
        guard case .loaded(let page) = DeckFeedParser.state(feed: SurfRegions.feed("orange-county"), json: json),
              let detail = page.surfRegion else {
            return XCTFail("the region file must load")
        }
        XCTAssertEqual(detail.region?.id, "orange-county")
        let salt = try XCTUnwrap(detail.spots.first)
        XCTAssertEqual(salt.hours?.hsFt.count, 72)
        XCTAssertEqual(salt.parts.first?.label, "Buoy, 5 km")
        XCTAssertEqual(salt.parts.first?.weight, "weight 0.88")
        XCTAssertEqual(salt.sun.map(\.label), ["First light", "Sunrise", "Sunset", "Last light"])
        let tide = try XCTUnwrap(detail.tides.first { $0.id == salt.tideStation })
        XCTAssertEqual(tide.kind, "prediction")
        XCTAssertEqual(tide.curve.count, 48)
    }

    func testBajaRegionFileHasModelTideCurves() throws {
        let json = try fixture("surf-coast-region-baja-sur")
        guard case .loaded(let page) = DeckFeedParser.state(feed: SurfRegions.feed("baja-sur"), json: json),
              let detail = page.surfRegion else {
            return XCTFail("the Baja region file must load")
        }
        let spot = try XCTUnwrap(detail.spots.first)
        XCTAssertTrue(spot.modelOnly)
        let tide = try XCTUnwrap(detail.tides.first { $0.id == spot.tideStation })
        XCTAssertEqual(tide.kind, "model", "Baja tides are approximate and say so")
    }

    func testWordsForRatingsHeightsAndAlerts() {
        XCTAssertEqual(SurfRating(score: 6, word: "Good").pips, 4)
        XCTAssertEqual(SurfRating(score: 9, word: nil).pips, 5)
        XCTAssertEqual(SurfRating(score: nil, word: nil).pips, 0)
        XCTAssertEqual(SurfRating(score: 1e30, word: nil).pips, 5, "a huge score must clamp to five pips, not trap Int(_:)")
        XCTAssertEqual(SurfRating(score: -1e300, word: nil).pips, 1)
        XCTAssertEqual(SurfRating(score: nil, word: nil).text, "No rating")
        XCTAssertEqual(SurfWords.height([5, 5]), "5 ft")
        XCTAssertNil(SurfWords.height([]), "no height is never 0 ft")
        XCTAssertEqual(SurfWords.best(SurfBest(spotName: nil, label: "7-9 am", day: "today", rating: 7, reason: nil)), "Today 7-9 am")
        let baja = SurfAlert(id: "a", event: "Gale Warning", severity: nil, text: nil, regions: ["baja-norte"], untilLabel: "Sun 6 pm")
        XCTAssertEqual(SurfWords.alert(baja), "Offshore seas · Baja Norte · until Sun 6 pm",
                       "Baja gets offshore warnings only, never worded as surf-zone advice")
        XCTAssertEqual(SurfWords.counts(["good": 4, "fair": 6, "flat": 0]), "4 good · 6 fair")
        XCTAssertEqual(DeckConfidence(score: 0.75, label: nil).dots, 3)
        XCTAssertEqual(DeckConfidence(score: 0.5, label: nil).dots, 2)
        XCTAssertEqual(DeckConfidence(score: 0.49, label: nil).dots, 1)
    }

    /// Missing, partial and edge values print a plain word or nothing, never "0" or a guessed kind.
    func testWordsForMissingPartialAndEdgeValues() {
        XCTAssertNil(SurfWords.feet(nil), "no feet is no word, never 0 ft")
        XCTAssertEqual(SurfWords.feet(5), "5.0 ft")
        XCTAssertEqual(SurfWords.feet(2.34), "2.3 ft")
        XCTAssertNil(SurfWords.wind(nil))
        XCTAssertNil(SurfWords.wind(SurfWind(kt: nil, gustKt: 12, dir: "NW", quality: nil, word: nil)), "a gust alone prints no wind")
        XCTAssertEqual(SurfWords.wind(SurfWind(kt: 8.4, gustKt: nil, dir: nil, quality: nil, word: nil)), "8 kt")
        XCTAssertEqual(SurfWords.wind(SurfWind(kt: 8.4, gustKt: nil, dir: "NW", quality: nil, word: nil)), "8 kt NW")
        XCTAssertEqual(SurfWords.windWord(SurfWind(kt: nil, gustKt: nil, dir: nil, quality: "offshore", word: nil)), "Offshore",
                       "with no word, the quality names the wind")
        XCTAssertEqual(SurfWords.windWord(SurfWind(kt: nil, gustKt: nil, dir: nil, quality: nil, word: "light offshore")), "Light offshore")
        XCTAssertNil(SurfWords.windWord(SurfWind(kt: nil, gustKt: nil, dir: nil, quality: nil, word: nil)))
        XCTAssertEqual(SurfWords.tide(SurfTideNext(type: "H", at: nil, ft: nil, label: "2:10 pm")), "Next high tide 2:10 pm")
        XCTAssertEqual(SurfWords.tide(SurfTideNext(type: "L", at: nil, ft: nil, label: "8:02 am")), "Next low tide 8:02 am")
        XCTAssertEqual(SurfWords.tide(SurfTideNext(type: nil, at: nil, ft: nil, label: "8:02 am")), "Next tide 8:02 am",
                       "an unknown kind does not guess high or low")
        XCTAssertNil(SurfWords.tide(SurfTideNext(type: "H", at: nil, ft: nil, label: nil)))
        XCTAssertEqual(SurfWords.best(SurfBest(spotName: nil, label: "7-9 am", day: nil, rating: nil, reason: nil)), "7-9 am",
                       "no day, no day word")
        XCTAssertNil(SurfWords.best(SurfBest(spotName: nil, label: nil, day: "today", rating: 7, reason: nil)))
        XCTAssertEqual(SurfWords.waterRange(74.2, 74.4), "74°F", "one degree when both ends round the same")
        XCTAssertEqual(SurfWords.waterRange(73.6, 75.1), "74-75°F")
        XCTAssertNil(SurfWords.waterRange(nil, 75))
        XCTAssertEqual(SurfWords.counts(["poor": 2, "great": 1]), "1 great · 2 poor", "great to flat, never dictionary order")
        XCTAssertNil(SurfWords.counts(["great": 0]))
        XCTAssertNil(SurfWords.counts([:]))
        let three = SurfAlert(id: "t", event: "High Surf Advisory", severity: nil, text: nil,
                              regions: ["san-diego", "orange-county", "oregon-north"], untilLabel: nil)
        XCTAssertEqual(SurfWords.alert(three), "High surf advisory · San Diego and 2 more")
        let none = SurfAlert(id: "n", event: "High Surf Advisory", severity: nil, text: nil, regions: [], untilLabel: nil)
        XCTAssertEqual(SurfWords.alert(none), "High surf advisory", "no region and no until adds nothing")
    }

    /// The outlook chart draws a morning and an afternoon bar, so the spoken label names both and never invents a missing half.
    func testOutlookDayNamesBothHalvesAndSkipsAMissingOne() {
        func half(_ ft: [Double], _ word: String) -> SurfHalfDay {
            SurfHalfDay(waveFt: ft, periodS: nil, windKt: nil, wind: nil, rating: SurfRating(score: nil, word: word))
        }
        let both = SurfDay(date: "2026-11-17", label: "Tue", am: half([3, 4], "Fair"), pm: half([4, 5], "Good"))
        XCTAssertEqual(SurfWords.outlookDay(both), "Tue morning 3-4 ft Fair, afternoon 4-5 ft Good")
        let pmOnly = SurfDay(date: "2026-11-18", label: "Wed", am: nil, pm: half([2, 2], "Poor"))
        XCTAssertEqual(SurfWords.outlookDay(pmOnly), "Wed afternoon 2 ft Poor")
        let none = SurfDay(date: "2026-11-19", label: "Thu", am: nil, pm: half([], "Fair"))
        XCTAssertEqual(SurfWords.outlookDay(none), "Thu No data", "a half with no height is no reading, never 0 ft")
    }

    func testTideChartLabelNeverGuessesLowOrEndsOnAColon() {
        let next = [SurfTideNext(type: "H", at: nil, ft: nil, label: "2:10 pm"),
                    SurfTideNext(type: nil, at: nil, ft: nil, label: "5:00 pm"),
                    SurfTideNext(type: "L", at: nil, ft: nil, label: "8:02 pm"),
                    SurfTideNext(type: "L", at: nil, ft: nil, label: nil)]
        XCTAssertEqual(SurfWords.tideChart(next), "Tide for the next 48 hours: high 2:10 pm, 5:00 pm, low 8:02 pm")
        XCTAssertEqual(SurfWords.tideChart([]), "Tide for the next 48 hours: no high or low times")
    }

    func testSortsAndRegionIds() throws {
        let surf = try overview()
        let oc = surf.spots(in: "orange-county")
        XCTAssertEqual(SurfSort.rating.apply(oc).map { $0.rating.score ?? -1 }, oc.map { $0.rating.score ?? -1 }.sorted(by: >))
        XCTAssertEqual(SurfSort.northToSouth.apply(oc).compactMap(\.lat), oc.compactMap(\.lat).sorted(by: >))
        XCTAssertEqual(SurfRegions.id(fromFeed: "surf-coast/region/oregon-north"), "oregon-north")
        XCTAssertNil(SurfRegions.id(fromFeed: "surf-coast/region/"))
    }
}
