import XCTest

/// Scrolls the token form until controls are hittable, fully inside the window, and clear of
/// both the software keyboard frame and the Done toolbar. Hittable alone is not enough.
enum TokenScreenVisibility {
    static func keyboardFrame(in app: XCUIApplication, window: CGRect) -> CGRect? {
        let keyboard = app.keyboards.firstMatch
        guard keyboard.exists else { return nil }
        let frame = keyboard.frame
        guard frame.width > 1, frame.height > 1, !frame.isNull, !frame.isEmpty else { return nil }
        guard frame.intersects(window) else { return nil }
        return frame
    }

    static func doneFrame(in app: XCUIApplication) -> CGRect? {
        let done = app.buttons["keyboard.done"]
        guard done.exists else { return nil }
        let frame = done.frame
        guard frame.width > 1, frame.height > 1 else { return nil }
        return frame
    }

    static func isClear(_ element: XCUIElement, window: CGRect, keyboard: CGRect, done: CGRect?) -> Bool {
        guard element.exists, element.isHittable else { return false }
        let frame = element.frame
        guard frame.width > 1, frame.height > 1 else { return false }
        guard frame.minX >= window.minX, frame.minY >= window.minY,
              frame.maxX <= window.maxX, frame.maxY <= window.maxY else { return false }
        if frame.intersects(keyboard) { return false }
        if let done, frame.intersects(done) { return false }
        return true
    }

    /// The drag that scrolled the form in the passing run (21f66b5). The slow, held 0.32 to 0.23 drag
    /// never moved the form: after 12 drags Open deck still sat at y=606 under the keyboard.
    private static func dragFormUp(_ form: XCUIElement) {
        let start = form.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2))
        let end = form.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.05))
        start.press(forDuration: 0.05, thenDragTo: end)
    }

    /// Legit short scrolls. Stops only when every element is clear of the keyboard and Done. -1 if spent.
    static func scrollUntilClear(_ app: XCUIApplication, elements: [XCUIElement], limit: Int = 12) -> Int {
        let form = app.scrollViews["screen.token"]
        for swipes in 0...limit {
            let window = app.windows.firstMatch.frame
            let done = doneFrame(in: app)
            if let keyboard = keyboardFrame(in: app, window: window),
               elements.allSatisfy({ isClear($0, window: window, keyboard: keyboard, done: done) }) {
                return swipes
            }
            if swipes == limit { break }
            if form.exists { dragFormUp(form) } else { app.swipeUp() }
        }
        return -1
    }

    /// The visible band for the token controls: from the window top down to whichever of the keyboard top
    /// and the Done toolbar top is higher. Nil when no software keyboard frame is on screen.
    static func visibleBand(in app: XCUIApplication) -> (window: CGRect, keyboard: CGRect, done: CGRect?, top: CGFloat, bottom: CGFloat)? {
        let window = app.windows.firstMatch.frame
        guard let keyboard = keyboardFrame(in: app, window: window) else { return nil }
        let done = doneFrame(in: app)
        let bottom = min(keyboard.minY, done?.minY ?? keyboard.minY, window.maxY)
        return (window, keyboard, done, window.minY, bottom)
    }

    /// The form's scroll view: the token screen's identifier when present, otherwise the first scroll view.
    static func scrollView(in app: XCUIApplication) -> XCUIElement {
        let token = app.scrollViews["screen.token"]
        return token.exists ? token : app.scrollViews.firstMatch
    }

    /// x for drags: the empty margin to the right of every control (Open deck, Paste and help end at x 378 of
    /// 402 on iPhone and 752 of 1032 on iPad), so the press never lands on the field, help text or a button.
    private static func dragX(_ scroll: CGRect, controls: [CGRect]) -> CGFloat {
        let right = controls.map { $0.maxX }.max() ?? scroll.midX
        return min(scroll.maxX - 4, max(right + (scroll.maxX - right) / 2, scroll.minX + 4))
    }

    /// A slow, held drag anchored on the scroll view, starting mid-band in the empty right margin.
    /// `up` moves the content up by about `distance` pt. The hold stops inertia, so it cannot fling.
    private static func slowDrag(_ scroll: XCUIElement, up: Bool, distance: CGFloat,
                                 band: (top: CGFloat, bottom: CGFloat), controls: [CGRect]) -> String {
        let frame = scroll.frame
        let x = dragX(frame, controls: controls)
        let mid = (band.top + band.bottom) / 2
        let half = max(10, min(distance, band.bottom - band.top - 40) / 2)
        let startY = up ? mid + half : mid - half
        let endY = up ? mid - half : mid + half
        let origin = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
        let start = origin.withOffset(CGVector(dx: x - frame.minX, dy: startY - frame.minY))
        let end = origin.withOffset(CGVector(dx: x - frame.minX, dy: endY - frame.minY))
        start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.3)
        return "drag(x=\(Int(x)) y=\(Int(startY))->\(Int(endY)))"
    }

    struct ScrollResult {
        let steps: Int
        let failure: String?
        var ok: Bool { failure == nil }
    }

    static func describe(_ app: XCUIApplication) -> String {
        func frame(_ element: XCUIElement) -> CGRect { element.exists ? element.frame : .null }
        let open = frame(app.buttons["token.open"])
        let paste = frame(app.buttons["token.paste"])
        let help = frame(app.staticTexts["token.help"])
        let keyboard = frame(app.keyboards.firstMatch)
        let done = frame(app.buttons["keyboard.done"])
        let window = frame(app.windows.firstMatch)
        return "open=\(open) paste=\(paste) help=\(help) keyboard=\(keyboard) done=\(done) window=\(window)"
    }

    /// Bounded step scroll until every one of `elements` is hittable and its frame sits fully inside the visible
    /// band (top edge at or below the window top, bottom edge above the keyboard and Done). Frames are read after
    /// each step and each step's delta is logged. An overshoot past the top gets a reverse drag, never a pass.
    /// A drag that moves under 5 pt falls back to a 300 pt/s swipe; if that also moves under 5 pt, it fails fast.
    static func scrollIntoBand(_ app: XCUIApplication, _ elements: [XCUIElement], label: String, limit: Int = 12) -> ScrollResult {
        let controls = [app.buttons["token.open"], app.buttons["token.paste"], app.staticTexts["token.help"]]
        func targetFrame() -> CGRect {
            let frames = elements.map { $0.frame }
            return frames.dropFirst().reduce(frames.first ?? .null) { $0.union($1) }
        }
        var directions: [String] = []
        for steps in 0...limit {
            let band = visibleBand(in: app)
            let target = targetFrame()
            let inBand = band.map { target.minY >= $0.top && target.maxY <= $0.bottom } ?? false
            let hittable = elements.allSatisfy { $0.exists && $0.isHittable }
            NSLog("DECK_TOKEN_SCROLL label=\(label) step=\(steps) dirs=\(directions.joined(separator: ",")) target=\(target) bandTop=\(band?.top ?? -1) bandBottom=\(band?.bottom ?? -1) inBand=\(inBand) hittable=\(hittable) \(describe(app))")
            if inBand && hittable { return ScrollResult(steps: steps, failure: nil) }
            if steps == limit { break }
            guard let band else {
                return ScrollResult(steps: steps, failure: "\(label): no software keyboard frame on screen at step \(steps)")
            }
            let scroll = scrollView(in: app)
            guard scroll.exists else {
                return ScrollResult(steps: steps, failure: "\(label): no scroll view for the token form at step \(steps)")
            }
            // Past the window top (overshoot) reverses. Below the band scrolls up.
            // In the band but not hittable (under a bar): move toward the band's middle.
            let up: Bool
            let distance: CGFloat
            if target.minY < band.top {
                up = false
                distance = band.top - target.minY + 12
            } else if target.maxY > band.bottom {
                up = true
                distance = target.maxY - band.bottom + 12
            } else {
                up = target.midY > (band.top + band.bottom) / 2
                distance = 40
            }
            let before = target.minY
            let controlFrames = controls.filter { $0.exists }.map { $0.frame }
            var method = slowDrag(scroll, up: up, distance: distance, band: (top: band.top, bottom: band.bottom), controls: controlFrames)
            var delta = targetFrame().minY - before
            NSLog("DECK_TOKEN_STEP label=\(label) step=\(steps + 1) dir=\(up ? "up" : "down") method=\(method) wanted=\(Int(distance)) delta=\(delta)")
            if abs(delta) < 5 {
                if up { scroll.swipeUp(velocity: XCUIGestureVelocity(300)) } else { scroll.swipeDown(velocity: XCUIGestureVelocity(300)) }
                method = up ? "swipeUp(300)" : "swipeDown(300)"
                delta = targetFrame().minY - before
                NSLog("DECK_TOKEN_STEP label=\(label) step=\(steps + 1) dir=\(up ? "up" : "down") method=\(method) fallback=true delta=\(delta)")
                if abs(delta) < 5 {
                    directions.append("\(up ? "up" : "down"):dead")
                    NSLog("DECK_TOKEN_SCROLL label=\(label) dead step=\(steps + 1) \(describe(app))")
                    return ScrollResult(steps: steps + 1, failure: "\(label): step \(steps + 1) \(up ? "up" : "down") moved \(delta) pt by drag and by swipe (under 5 pt); the token form did not scroll")
                }
            }
            directions.append("\(up ? "up" : "down"):\(method.hasPrefix("swipe") ? "swipe" : "drag"):\(Int(delta.rounded()))")
        }
        return ScrollResult(steps: -1, failure: "\(label): not inside the visible band after \(limit) steps")
    }
}

/// Hosted proof that TokenView controls stay fully visible above the software keyboard
/// at an accessibility text size. No purchase, no fixture sign-in, no live gateway.
/// An unanswered loopback address opens the token form. A fresh simulator has no Pro session,
/// so this class does not open a StoreKit test session.
final class TokenKeyboardUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }

    func testTokenControlsStayVisibleAboveSoftwareKeyboard() throws {
        let app = UITestLaunch.freshApp([
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityXXXL"
        ])
        XCUIDevice.shared.orientation = .portrait
        openTokenScreen(app)

        let field = app.secureTextFields["token.field"]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "The token field must be on the token screen")
        let title = app.staticTexts["token.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        let open = app.buttons["token.open"]
        let paste = app.buttons["token.paste"]
        let help = app.staticTexts["token.help"]
        XCTAssertTrue(open.waitForExistence(timeout: 5))
        XCTAssertTrue(paste.waitForExistence(timeout: 5))
        XCTAssertTrue(help.waitForExistence(timeout: 5))
        let keyboard = app.keyboards.firstMatch
        let keyboardShown = keyboard.waitForExistence(timeout: 8)
        let keyCount = keyboard.keys.count
        attachScreen("token-keyboard-screen-before")
        XCTAssertTrue(keyboardShown, "The software keyboard must be in the app keyboard query")
        XCTAssertGreaterThan(keyboard.frame.height, 1, "The software keyboard must have a visible frame")
        XCTAssertGreaterThan(keyCount, 0, "The software keyboard must expose keys, not only a focus proxy")
        XCTAssertGreaterThanOrEqual(title.frame.height, 50,
                                    "The token title must scale with the accessibility text size, got \(title.frame.height)")

        XCTAssertTrue(keyboard.frame.intersects(app.windows.firstMatch.frame), "The keyboard frame must intersect the window")
        XCTAssertTrue(app.buttons["keyboard.done"].exists, "Done must be present while the software keyboard is up")
        XCTAssertLessThanOrEqual(paste.frame.maxY, open.frame.minY + 1, "Paste must sit above Open deck at an accessibility text size")

        // All three together when they fit in the band; otherwise each control on its own, same bounded loop.
        let together = TokenScreenVisibility.scrollIntoBand(app, [help, paste, open], label: "all")
        attachScreen("token-keyboard-screen-all")
        NSLog("DECK_TOKEN_KEYBOARD mode=all swipes=\(together.steps) failure=\(together.failure ?? "none") keys=\(keyboard.keys.count) \(TokenScreenVisibility.describe(app))")
        if together.ok {
            for (element, name) in [(help, "The token help"), (paste, "Paste"), (open, "Open deck")] {
                assertInBand(app, element, name: name)
            }
        } else {
            for (element, name, label) in [(open, "Open deck", "open"), (paste, "Paste", "paste"), (help, "The token help", "help")] {
                let swipes = TokenScreenVisibility.scrollIntoBand(app, [element], label: label)
                attachScreen("token-keyboard-screen-\(label)")
                NSLog("DECK_TOKEN_KEYBOARD mode=\(label) swipes=\(swipes.steps) failure=\(swipes.failure ?? "none") keys=\(keyboard.keys.count) \(TokenScreenVisibility.describe(app))")
                XCTAssertNil(swipes.failure, "\(name) must scroll fully inside the window, clear of the keyboard and Done, within 12 steps: \(swipes.failure ?? "")")
                assertInBand(app, element, name: name)
            }
        }
    }

    /// The control is hittable, its top edge is on screen, and it is clear of the keyboard frame and Done.
    private func assertInBand(_ app: XCUIApplication, _ element: XCUIElement, name: String) {
        let window = app.windows.firstMatch.frame
        let keyboard = app.keyboards.firstMatch.frame
        let done = app.buttons["keyboard.done"]
        let frame = element.frame
        XCTAssertTrue(element.isHittable, "\(name) must stay hittable while the keyboard is up")
        XCTAssertGreaterThanOrEqual(frame.minY, window.minY, "\(name) must start inside the window, minY \(frame.minY)")
        XCTAssertLessThanOrEqual(frame.maxY, window.maxY, "\(name) must end inside the window, maxY \(frame.maxY) of \(window.maxY)")
        XCTAssertLessThanOrEqual(frame.maxY, keyboard.minY, "\(name) must end above the keyboard, maxY \(frame.maxY) keyboard \(keyboard.minY)")
        XCTAssertFalse(frame.intersects(keyboard), "\(name) must not intersect the keyboard frame")
        XCTAssertTrue(done.exists, "Done must be present while the software keyboard is up")
        XCTAssertFalse(frame.intersects(done.frame), "Done must not cover \(name)")
    }

    private func openTokenScreen(_ app: XCUIApplication) {
        UITestLaunch.openDecks(app)
        let origin = app.textFields["connection.origin"]
        if !origin.exists {
            let add = app.buttons["connection.add"]
            XCTAssertTrue(add.waitForExistence(timeout: 10), "Decks must offer Add deck")
            add.tap()
        }
        XCTAssertTrue(origin.waitForExistence(timeout: 10))
        origin.tap()
        origin.typeText("https://127.0.0.1:59999/")
        app.buttons["connection.save"].tap()
        XCTAssertTrue(app.scrollViews["screen.token"].waitForExistence(timeout: 10))
    }

    private func attachScreen(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
