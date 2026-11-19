import SwiftUI
import UIKit
import XCTest
@testable import OmarchyDeck

/// Counts every request the process starts while installed, so a test can prove the demo stays offline.
private final class RequestSpy: URLProtocol {
    nonisolated(unsafe) static var urls: [URL] = []

    override class func canInit(with request: URLRequest) -> Bool {
        if let url = request.url { urls.append(url) }
        return false
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {}
    override func stopLoading() {}
}

final class DemoDeckTests: XCTestCase {
    private let reference = Date(timeIntervalSinceReferenceDate: 800_000_000)

    // MARK: Content

    @MainActor
    func testSampleContentIsInventedAndPrivate() {
        let model = DemoDeck(now: reference)
        var strings = [model.desktopName]
        strings += model.events.flatMap { [$0.title, $0.detail] }
        strings += model.cameras.flatMap { [$0.name, $0.place] }
        strings += model.switches.flatMap { [$0.title, $0.onDetail, $0.offDetail] }
        strings += model.links.flatMap { [$0.title, $0.detail] + $0.paragraphs }
        strings += model.watchlist.flatMap { [$0.title, $0.store] }
        strings += model.stores.flatMap { [$0.name, DemoWords.storeStatus($0.state)] }
        strings += [DemoWords.watchlistFooter, DemoWords.coverageFooter]
        strings += DemoDeck.Tab.allCases.map(\.title)
        let forbidden = ["tanner", "meshvault", "osterkamp", "morgan", "quill", "bauer", "tailscale",
                         ".ts.net", "/home/", "/users/", "http", "@", "password", "token"]
        for string in strings {
            for term in forbidden {
                XCTAssertFalse(string.lowercased().contains(term), "\"\(string)\" contains \"\(term)\"")
            }
        }
        XCTAssertEqual(model.activeTab, .today)
        XCTAssertEqual(DemoDeck.Tab.allCases.map(\.title), ["Today", "Home", "Shop", "Links", "Pad"])
        XCTAssertEqual(model.links.map(\.title), ["Sample notes", "Example project", "Reading list"])
    }

    @MainActor
    func testEventsAreUpcomingOrderedAndOnFiveMinuteMarks() {
        let events = DemoDeck.makeEvents(now: reference)
        XCTAssertEqual(events.count, 3)
        XCTAssertEqual(events.map(\.start), events.map(\.start).sorted())
        for event in events {
            XCTAssertGreaterThan(event.start, reference)
            XCTAssertEqual(event.start.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 300), 0)
        }
    }

    // MARK: Controls respond

    @MainActor
    func testEveryControlChangesStateAndFiresExactlyOneHaptic() {
        let model = DemoDeck(now: reference)
        func total() -> Int { model.selectionCount + model.impactCount + model.successCount }

        var before = total()
        model.toggleReminder(model.events[0])
        XCTAssertTrue(model.remindedEventIDs.contains("design-review"))
        XCTAssertEqual(total(), before + 1)

        before = total()
        model.toggleTimer(now: reference)
        XCTAssertTrue(model.timerRunning)
        XCTAssertEqual(total(), before + 1)

        before = total()
        model.resetTimer()
        XCTAssertFalse(model.timerRunning)
        XCTAssertEqual(total(), before + 1)

        before = total()
        model.setSwitch("porch", on: true)
        XCTAssertTrue(model.isOn("porch"))
        XCTAssertEqual(total(), before + 1)

        before = total()
        model.refreshSnapshot(model.cameras[0])
        XCTAssertEqual(model.light(for: model.cameras[0]), .dusk)
        XCTAssertEqual(model.updatedLabel(for: model.cameras[0]), "Updated just now")
        XCTAssertEqual(total(), before + 1)

        before = total()
        model.togglePin(model.links[2])
        XCTAssertEqual(model.orderedLinks.first?.id, "reading-list")
        XCTAssertEqual(total(), before + 1)

        before = total()
        let alerted = model.hasAlert(model.watchlist[1])
        model.toggleAlert(model.watchlist[1])
        XCTAssertNotEqual(model.hasAlert(model.watchlist[1]), alerted)
        XCTAssertEqual(total(), before + 1)

        before = total()
        model.openLink(model.links[0])
        XCTAssertEqual(model.openedLinkID, "sample-notes")
        XCTAssertEqual(total(), before + 1)

        before = total()
        model.click(.left)
        XCTAssertEqual(model.padStatus, .leftClick)
        model.click(.right)
        XCTAssertEqual(model.padStatus, .rightClick)
        XCTAssertEqual(total(), before + 2)

        before = total()
        XCTAssertTrue(model.sendText("  Hello from the sample  "))
        XCTAssertEqual(model.sentMessages, ["Hello from the sample"])
        XCTAssertEqual(model.padStatus, .sent)
        XCTAssertEqual(total(), before + 1)
    }

    @MainActor
    func testRefreshedCameraCaptionAgesPastJustNow() {
        let model = DemoDeck(now: reference)
        model.refreshSnapshot(model.cameras[0], now: reference)
        XCTAssertEqual(model.updatedLabel(for: model.cameras[0], now: reference), "Updated just now")
        XCTAssertEqual(model.updatedLabel(for: model.cameras[0], now: reference.addingTimeInterval(59)), "Updated just now")
        XCTAssertEqual(model.updatedLabel(for: model.cameras[0], now: reference.addingTimeInterval(61)), "Updated 1 min ago")
        XCTAssertEqual(model.updatedLabel(for: model.cameras[0], now: reference.addingTimeInterval(12 * 60)), "Updated 12 min ago")
        XCTAssertEqual(model.updatedLabel(for: model.cameras[1], now: reference), "Updated 2 min ago")
    }

    @MainActor
    func testInertInputDoesNotFireAHaptic() {
        let model = DemoDeck(now: reference)
        XCTAssertFalse(model.sendText("   \n"))
        model.setSwitch("front-door-lock", on: true)   // already locked
        XCTAssertEqual(model.selectionCount + model.impactCount + model.successCount, 0)
        XCTAssertNil(model.padStatus)
    }

    @MainActor
    func testTimerCountsDownPausesAndRestarts() {
        let model = DemoDeck(now: reference)
        XCTAssertEqual(model.timerRemaining(at: reference), 180)
        model.toggleTimer(now: reference)
        XCTAssertEqual(model.timerRemaining(at: reference.addingTimeInterval(60)), 120, accuracy: 0.001)
        model.toggleTimer(now: reference.addingTimeInterval(60))   // pause
        XCTAssertFalse(model.timerRunning)
        XCTAssertEqual(model.timerRemaining(at: reference.addingTimeInterval(500)), 120, accuracy: 0.001)
        model.toggleTimer(now: reference.addingTimeInterval(500))  // resume
        XCTAssertFalse(model.timerFinished(at: reference.addingTimeInterval(500)))
        let end = reference.addingTimeInterval(500 + 120)
        XCTAssertTrue(model.timerFinished(at: end))
        XCTAssertEqual(model.timerRemaining(at: end.addingTimeInterval(30)), 0)
        model.toggleTimer(now: end.addingTimeInterval(30))         // restart after done
        XCTAssertFalse(model.timerRunning)
        XCTAssertEqual(model.timerRemaining(at: end.addingTimeInterval(30)), 180)
    }

    @MainActor
    func testFinishedTimerSettlesToDoneOnceAndRestartsFromFull() {
        let model = DemoDeck(now: reference)
        model.toggleTimer(now: reference)
        model.settleFinishedTimer(now: reference.addingTimeInterval(60))
        XCTAssertTrue(model.timerRunning, "still counting down")
        XCTAssertEqual(model.successCount, 0)
        model.settleFinishedTimer(now: reference.addingTimeInterval(181))
        model.settleFinishedTimer(now: reference.addingTimeInterval(182))
        XCTAssertFalse(model.timerRunning, "a finished timer stops ticking")
        XCTAssertTrue(model.timerDone)
        XCTAssertEqual(model.successCount, 1)
        model.toggleTimer(now: reference.addingTimeInterval(200))
        XCTAssertTrue(model.timerRunning)
        XCTAssertFalse(model.timerDone)
        XCTAssertEqual(model.timerRemaining(at: reference.addingTimeInterval(200)), 180, accuracy: 0.001)
    }

    @MainActor
    func testPointerMovesRelativelyAndStaysOnTheDesktop() {
        let model = DemoDeck(now: reference)
        model.movePointer(dx: 0.2, dy: -0.1)
        XCTAssertEqual(model.pointer.x, 0.7, accuracy: 0.0001)
        XCTAssertEqual(model.pointer.y, 0.4, accuracy: 0.0001)
        XCTAssertEqual(model.padStatus, .moved)
        model.movePointer(dx: 9, dy: -9)
        XCTAssertEqual(model.pointer, CGPoint(x: 1, y: 0))
        XCTAssertEqual(model.selectionCount + model.impactCount + model.successCount, 0, "dragging is continuous, not a haptic")
    }

    @MainActor
    func testNonFiniteDragLeavesThePointerAndItsSpokenPositionIntact() {
        let model = DemoDeck(now: reference)
        model.movePointer(dx: .nan, dy: 0.1)
        model.movePointer(dx: 0.1, dy: .infinity)
        XCTAssertEqual(model.pointer, CGPoint(x: 0.5, y: 0.5))
        XCTAssertEqual(DemoWords.padPosition(model.pointer), "Example pointer 50 percent right, 50 percent down.")
        XCTAssertEqual(DemoWords.padPosition(CGPoint(x: CGFloat.nan, y: CGFloat.infinity)),
                       "Example pointer 0 percent right, 0 percent down.")
    }

    // MARK: Shared native presentation

    func testDemoUsesTheShellLegalLinksAndMetrics() {
        XCTAssertEqual(DeckLinks.privacy?.absoluteString, "https://kodros.ai/privacy/deck")
        XCTAssertEqual(DeckLinks.support?.absoluteString, "https://kodros.ai/deck/support")
        // The web deck's radii (tokens.css `--r-panel` 6 px, `--r-ctl` 4 px): the demo and the shell share them.
        XCTAssertEqual(DeckStyle.cardRadius, 6)
        XCTAssertEqual(DeckStyle.controlRadius, 4)
    }

    // MARK: Native stills

    @MainActor
    func testEverySampleStillRendersNativeAndDaylightDiffersFromDusk() throws {
        var brightness: [DemoLight: Double] = [:]
        for light in DemoLight.allCases {
            var total = 0.0
            for scene in DemoScene.allCases {
                let renderer = ImageRenderer(content: DemoStill(scene: scene, light: light).frame(width: 320, height: 200))
                renderer.scale = 1
                let image = try XCTUnwrap(renderer.cgImage, "\(scene) \(light) did not render")
                XCTAssertEqual(image.width, 320)
                XCTAssertEqual(image.height, 200)
                let stats = Self.pixelStats(image)
                XCTAssertGreaterThan(stats.distinct, 60, "\(scene) \(light) looks flat")
                total += stats.brightness
            }
            brightness[light] = total / Double(DemoScene.allCases.count)
        }
        XCTAssertGreaterThan(try XCTUnwrap(brightness[.day]), try XCTUnwrap(brightness[.dusk]) + 0.05)
    }

    private static func pixelStats(_ image: CGImage) -> (distinct: Int, brightness: Double) {
        let width = image.width, height = image.height
        var data = [UInt8](repeating: 0, count: width * height * 4)
        let space = CGColorSpaceCreateDeviceRGB()
        data.withUnsafeMutableBytes { buffer in
            let context = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                                    bytesPerRow: width * 4, space: space,
                                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            context?.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        }
        var seen = Set<UInt32>()
        var sum = 0.0
        for index in stride(from: 0, to: data.count, by: 4) {
            let r = data[index], g = data[index + 1], b = data[index + 2]
            seen.insert(UInt32(r >> 3) << 10 | UInt32(g >> 3) << 5 | UInt32(b >> 3))
            sum += (0.299 * Double(r) + 0.587 * Double(g) + 0.114 * Double(b)) / 255
        }
        return (seen.count, sum / Double(width * height))
    }

    // MARK: No network

    @MainActor
    func testDemoLoadsAndEveryControlRunsWithoutANetworkRequestOrWebView() throws {
        let suite = "DemoDeckTests.offline.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let model = DeckModel(defaults: defaults, startsAutomatically: false,
                              pro: ProEntitlement(startsAutomatically: false))
        model.beginDemo()

        RequestSpy.urls = []
        URLProtocol.registerClass(RequestSpy.self)
        defer { URLProtocol.unregisterClass(RequestSpy.self) }

        let sample = DemoDeck(now: reference)
        let host = UIHostingController(rootView: DemoDeckView().environmentObject(model))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 440, height: 956))
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.layoutIfNeeded()
        for tab in DemoDeck.Tab.allCases { sample.activeTab = tab }
        sample.toggleReminder(sample.events[0])
        sample.toggleTimer(now: reference)
        sample.setSwitch("porch", on: true)
        sample.refreshSnapshot(sample.cameras[1])
        sample.togglePin(sample.links[1])
        sample.click(.left)
        sample.sendText("Hello")
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        host.view.layoutIfNeeded()

        XCTAssertTrue(RequestSpy.urls.isEmpty, "demo started requests: \(RequestSpy.urls)")
        XCTAssertNil(model.webView, "the demo must never instantiate a WKWebView")
        XCTAssertGreaterThan(host.view.subviews.count, 0)
        window.isHidden = true
    }

    @MainActor
    func testDemoExitKeepsSavedRealConnectionsUntouched() throws {
        let suite = "DemoDeckTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let real = URL(string: "https://example.org/")!
        defaults.set([real.absoluteString], forKey: "deck.savedOrigins.v1")
        let model = DeckModel(defaults: defaults, startsAutomatically: false,
                              pro: ProEntitlement(startsAutomatically: false))
        model.beginDemo()
        XCTAssertTrue(model.isDemo)
        XCTAssertEqual(model.selectedOrigin, real)
        model.endDemo()
        XCTAssertFalse(model.isDemo)
        XCTAssertEqual(model.selectedOrigin, real)
        XCTAssertEqual(defaults.stringArray(forKey: "deck.savedOrigins.v1"), [real.absoluteString])
    }
}
