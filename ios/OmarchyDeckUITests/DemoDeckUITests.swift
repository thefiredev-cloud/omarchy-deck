import XCTest
import StoreKitTest

final class DemoDeckUITests: XCTestCase {
    /// The Test action must use the local OmarchyDeck.storekit file; without a session the app asks the
    /// live catalog and `pro.buy` never appears. Held so a prior suite's purchase cannot hide the button.
    private var store: SKTestSession?

    override func setUpWithError() throws {
        continueAfterFailure = false
        store = try UITestLaunch.resetPersistedState()
    }

    override func tearDown() {
        UITestLaunch.finishPersistedState(store)
        store = nil
        super.tearDown()
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// Compact width uses the tab bar; regular width keeps a native sidebar in both iPad orientations.
    private func tab(_ app: XCUIApplication, _ name: String) -> XCUIElement {
        let sidebar = app.buttons["demo.tab.\(name.lowercased())"]
        if sidebar.exists { return sidebar }
        let bar = app.tabBars.buttons[name]
        return bar.exists ? bar : app.buttons[name].firstMatch
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    /// Lists build rows lazily, so a row below the fold is not in the hierarchy until it scrolls in.
    private func scrollIntoView(_ app: XCUIApplication, _ target: XCUIElement, attempts: Int = 6) {
        var tries = 0
        while (!target.exists || !target.isHittable) && tries < attempts {
            app.swipeUp()
            tries += 1
        }
    }

    @discardableResult
    private func launchDemo(_ extra: [String] = []) -> XCUIApplication {
        let app = UITestLaunch.freshApp(extra)
        XCTAssertTrue(app.buttons["demo.try"].waitForExistence(timeout: 15))
        app.buttons["demo.try"].tap()
        XCTAssertTrue(element(app, "demo.badge").waitForExistence(timeout: 5))
        return app
    }

    /// Regular width keeps a selection in the Links list; VoiceOver must hear it.
    func testDemoLinksSelectedRowCarriesTheSelectedTrait() throws {
        let app = launchDemo()
        let sidebar = app.buttons["demo.tab.links"]
        guard sidebar.exists else { throw XCTSkip("Compact width pushes a page instead of selecting a row") }
        sidebar.tap()
        let row = element(app, "demo.link.sample-notes")
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        XCTAssertTrue(element(app, "demo.link.detail.title").waitForExistence(timeout: 5))
        XCTAssertTrue(row.isSelected, "The shown row must expose the selected trait to VoiceOver")
    }

    /// Landscape phone is a short window: the Pad must scroll so its send row stays on screen.
    /// Send is disabled until there is a line to send, so the test asserts reachability of the row and that state;
    /// typing into the sample field cannot be driven on this simulator (the field never reports focus).
    func testDemoPadSendStaysReachableInLandscape() {
        XCUIDevice.shared.orientation = .portrait
        let app = launchDemo()
        tab(app, "Pad").tap()
        XCTAssertTrue(element(app, "demo.pad.surface").waitForExistence(timeout: 5))

        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }

        let send = element(app, "demo.text.send")
        scrollIntoView(app, send)
        XCTAssertTrue(send.waitForExistence(timeout: 5), "The send row must be in the hierarchy in landscape")
        XCTAssertTrue(app.frame.contains(send.frame), "The send row must be inside the window: \(send.frame) in \(app.frame)")
        XCTAssertFalse(send.isEnabled, "Send waits for a line to send, which the demo field cannot take here")
        XCTAssertTrue(element(app, "demo.text.input").exists)
    }

    /// Reproduces the reported portrait -> landscape -> portrait idle stall with actual taps after every turn.
    /// Run unchanged on phone and iPad. A stuck animation, collapsed sidebar or dead control fails the next tap.
    func testDemoRotationLoopKeepsEveryPageInteractive() {
        XCUIDevice.shared.orientation = .portrait
        let app = launchDemo()
        let rotations: [UIDeviceOrientation] = [.landscapeLeft, .portrait, .landscapeRight, .portrait]
        for lap in 0..<2 {
            for (step, orientation) in rotations.enumerated() {
                XCUIDevice.shared.orientation = orientation
                for name in ["Today", "Home", "Shop", "Links", "Pad"] {
                    let control = tab(app, name)
                    XCTAssertTrue(control.waitForExistence(timeout: 10))
                    XCTAssertTrue(control.isHittable, "\(name) must stay reachable after rotation")
                    control.tap()
                    XCTAssertTrue(element(app, "demo.badge").exists)
                    if lap == 0 && step == 0 { capture("\(name.lowercased())-landscape") }
                }
                app.buttons["demo.pad.left"].tap()
                XCTAssertEqual(element(app, "demo.pad.status").label, "Example · Left click")
                capture("rotation-\(lap)-\(step)")
            }
        }
        XCTAssertFalse(app.webViews.firstMatch.exists)
    }

    /// Today, Home, Shop and Links each open with one plain line on what the tab is for.
    func testEveryDemoTabOpensWithAPurposeLine() {
        let app = launchDemo()
        let expected = ["Today": "Your day at a glance",
                        "Home": "Your cameras",
                        "Shop": "Prices on the items you watch",
                        "Links": "Pages you saved"]
        for name in ["Today", "Home", "Shop", "Links"] {
            tab(app, name).tap()
            let line = element(app, "demo.purpose")
            XCTAssertTrue(line.waitForExistence(timeout: 5), "\(name) needs its purpose line")
            XCTAssertTrue(line.label.hasPrefix(expected[name] ?? ""), "\(name): \(line.label)")
        }
        tab(app, "Pad").tap()
        let status = element(app, "demo.pad.status")
        XCTAssertTrue(status.waitForExistence(timeout: 5))
        XCTAssertTrue(status.label.hasPrefix("Your phone as a trackpad"), status.label)
    }

    func testFreshInstallExploresEveryTabWithoutServer() {
        let app = launchDemo()
        XCTAssertTrue(app.navigationBars["Today"].exists)
        XCTAssertTrue(element(app, "demo.today.weather").exists)
        XCTAssertFalse(app.webViews.firstMatch.exists)
        capture("02-today")

        tab(app, "Home").tap()
        XCTAssertTrue(app.navigationBars["Home"].waitForExistence(timeout: 5))
        XCTAssertTrue(element(app, "demo.camera.front-door").exists)
        capture("home-camera-captions")
        scrollIntoView(app, element(app, "demo.desktop.frame"))
        XCTAssertTrue(element(app, "demo.desktop.frame").exists)
        capture("03-home")

        tab(app, "Shop").tap()
        XCTAssertTrue(app.navigationBars["Shop"].waitForExistence(timeout: 5))
        XCTAssertTrue(element(app, "demo.shop.item.headphones").exists)
        capture("04-shop")

        tab(app, "Links").tap()
        XCTAssertTrue(app.navigationBars["Links"].waitForExistence(timeout: 5))
        XCTAssertTrue(element(app, "demo.link.sample-notes").exists)
        capture("05-links")

        tab(app, "Pad").tap()
        XCTAssertTrue(element(app, "demo.pad.surface").waitForExistence(timeout: 5))
        capture("06-pad")
        XCTAssertFalse(app.webViews.firstMatch.exists)
    }

    func testTodayControlsRespond() {
        let app = launchDemo()
        let bell = app.buttons["demo.event.design-review.remind"]
        XCTAssertTrue(bell.waitForExistence(timeout: 5))
        XCTAssertEqual(bell.value as? String, "Off")
        bell.tap()
        XCTAssertEqual(bell.value as? String, "On")

        let toggle = app.buttons["demo.timer.toggle"]
        XCTAssertEqual(toggle.label, "Start")
        toggle.tap()
        XCTAssertEqual(toggle.label, "Pause")
        let remaining = element(app, "demo.timer.remaining")
        XCTAssertTrue(remaining.exists)
        app.buttons["demo.timer.reset"].tap()
        XCTAssertEqual(toggle.label, "Start")
        XCTAssertEqual(remaining.label, "3 minutes remaining")
    }

    func testHomeCameraSwitchesAndRefresh() {
        let app = launchDemo()
        tab(app, "Home").tap()
        let tile = app.buttons["demo.camera.front-door"]
        XCTAssertTrue(tile.waitForExistence(timeout: 5))
        tile.tap()
        XCTAssertTrue(element(app, "demo.camera.title").waitForExistence(timeout: 5))
        capture("04-camera")
        app.buttons["demo.camera.refresh"].tap()
        XCTAssertTrue(app.staticTexts["Entry · Example still · Updated just now"].waitForExistence(timeout: 3))
        app.buttons["demo.camera.close"].tap()
        XCTAssertTrue(app.navigationBars["Home"].waitForExistence(timeout: 5))

        let porch = app.switches["demo.switch.porch"]
        scrollIntoView(app, porch)
        XCTAssertTrue(porch.waitForExistence(timeout: 5))
        XCTAssertEqual(porch.value as? String, "0")
        porch.tap()
        XCTAssertEqual(porch.value as? String, "1")
    }

    func testHapticTouchCameraMenuUsesSampleActions() {
        let app = launchDemo()
        tab(app, "Home").tap()
        let tile = app.buttons["demo.camera.front-door"]
        XCTAssertTrue(tile.waitForExistence(timeout: 5))
        tile.press(forDuration: 1)
        let refresh = app.buttons["Refresh sample still"]
        XCTAssertTrue(refresh.waitForExistence(timeout: 5))
        capture("haptic-touch-camera-menu")
        refresh.tap()
        tile.press(forDuration: 1)
        let view = app.buttons["View sample still"]
        XCTAssertTrue(view.waitForExistence(timeout: 5))
        view.tap()
        XCTAssertTrue(element(app, "demo.camera.title").waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Entry · Example still · Updated just now"].exists)
        XCTAssertFalse(app.webViews.firstMatch.exists)
    }

    func testLinksOpenAPreviewAndPin() {
        let app = launchDemo()
        tab(app, "Links").tap()
        let row = app.buttons["demo.link.sample-notes"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        XCTAssertEqual(element(app, "demo.link.detail.title").label, "Sample notes")
        let pin = app.buttons["demo.link.pin"]
        XCTAssertTrue(pin.exists)
        XCTAssertEqual(pin.label, "Pin to top")
        pin.tap()
        XCTAssertEqual(pin.label, "Pinned")
        XCTAssertFalse(app.webViews.firstMatch.exists)
    }

    /// The Shop sample mirrors the deck's calm Coverage: skipped and setup stores never count against answering.
    func testShopAlertTogglesAndCoverageStaysCalm() {
        let app = launchDemo()
        tab(app, "Shop").tap()
        let bell = app.buttons["demo.shop.grinder.alert"]
        XCTAssertTrue(bell.waitForExistence(timeout: 5))
        XCTAssertEqual(bell.value as? String, "Off")
        bell.tap()
        XCTAssertEqual(bell.value as? String, "On")

        let coverage = element(app, "demo.shop.coverage")
        scrollIntoView(app, coverage)
        XCTAssertTrue(coverage.label.contains("4 of 4 stores answering"), coverage.label)
        XCTAssertTrue(coverage.label.contains("1 skipped · 1 needs setup"), coverage.label)
        let skipped = element(app, "demo.shop.store.warehouse")
        scrollIntoView(app, skipped)
        XCTAssertTrue(skipped.label.contains("blocks automated search"), skipped.label)
        capture("shop-coverage")
        XCTAssertFalse(app.webViews.firstMatch.exists)
    }

    func testShopReadsAtAccessibilityTextSize() {
        let app = launchDemo(["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        tab(app, "Shop").tap()
        let bell = app.buttons["demo.shop.headphones.alert"]
        XCTAssertTrue(bell.waitForExistence(timeout: 5))
        XCTAssertTrue(bell.isHittable)
        XCTAssertEqual(bell.value as? String, "On")
        capture("shop-axxxl")
    }

    func testPadDragClickAndTypeWork() {
        let app = launchDemo()
        tab(app, "Pad").tap()
        let surface = element(app, "demo.pad.surface")
        XCTAssertTrue(surface.waitForExistence(timeout: 5))
        let status = element(app, "demo.pad.status")
        XCTAssertEqual(status.label, "Your phone as a trackpad and keyboard for your computer. Drag to move, tap to click")

        let start = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.3))
        let end = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.7))
        start.press(forDuration: 0.1, thenDragTo: end)
        XCTAssertEqual(status.label, "Example · Moving the pointer")

        surface.tap()
        XCTAssertEqual(status.label, "Example · Left click")
        app.buttons["demo.pad.right"].tap()
        XCTAssertEqual(status.label, "Example · Right click")

        let input = app.textFields["demo.text.input"]
        input.tap()
        // Return is the field's .send submit action. The software keyboard covers the
        // Send button at this size, so tapping it here tested the keyboard, not the app.
        input.typeText("Hello\n")
        XCTAssertEqual(status.label, "Example · Text shown on the sample desktop")
    }

    func testPadStillWorksAtAccessibilityTextSize() {
        let app = launchDemo(["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        tab(app, "Pad").tap()
        let surface = element(app, "demo.pad.surface")
        XCTAssertTrue(surface.waitForExistence(timeout: 5))
        let status = element(app, "demo.pad.status")
        let start = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.3))
        let end = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.7))
        start.press(forDuration: 0.1, thenDragTo: end)
        XCTAssertEqual(status.label, "Example · Moving the pointer")
        capture("pad-axxxl")
    }

    func testProOfferAndPriceAreReachableFromTheDemo() {
        let app = launchDemo()
        app.buttons["demo.connect.open"].tap()
        XCTAssertTrue(app.buttons["demo.connect"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["connection.origin"].exists, "Connect takes the address in the sheet itself")
        capture("07-connect")
        // AddressEntry made the first section taller, so the lazy Pro row is often below the fold.
        scrollIntoView(app, element(app, "pro.title"))
        let buy = app.buttons["pro.buy"]
        XCTAssertTrue(buy.waitForExistence(timeout: 30))
        let loaded = NSPredicate(format: "label CONTAINS 'Unlock Pro' AND label CONTAINS '$'")
        expectation(for: loaded, evaluatedWith: buy)
        waitForExpectations(timeout: 15)
        XCTAssertTrue(buy.isEnabled)
        XCTAssertTrue(app.buttons["pro.restore"].exists)
        // The form sheet is short on iPad and builds rows lazily: scroll the legal links in.
        scrollIntoView(app, element(app, "link.privacy"))
        XCTAssertTrue(element(app, "link.privacy").exists)
        scrollIntoView(app, element(app, "link.support"))
        XCTAssertTrue(element(app, "link.support").exists)
        capture("08-connect-pro")
        XCTAssertFalse(app.webViews.firstMatch.exists)
    }

    /// App Review path (from main's former demo test): the demo needs no server or token, and Connect leads
    /// back to the server form with the demo still on offer.
    func testConnectLeavesTheDemoForTheServerForm() {
        let app = launchDemo()
        XCTAssertFalse(app.webViews.firstMatch.exists)
        XCTAssertFalse(app.secureTextFields["token.field"].exists)
        app.buttons["demo.connect.open"].tap()
        app.buttons["demo.connect"].tap()
        XCTAssertTrue(app.textFields["connection.origin"].waitForExistence(timeout: 5))
        XCTAssertFalse(element(app, "demo.badge").exists)
        XCTAssertTrue(app.buttons["demo.try"].exists)
        XCTAssertFalse(app.webViews.firstMatch.exists)
    }
}
