import XCTest
@testable import OmarchyDeck

final class DemoThemeTests: XCTestCase {
    func testTimerHintsAndAnnouncementsDescribeExampleOnlyTransitions() {
        XCTAssertEqual(DemoWords.timerToggleHint(phase: .ready, duration: 180),
                       "Starts the example timer. It runs in this demo only.")
        XCTAssertEqual(DemoWords.timerToggleHint(phase: .running, duration: 180),
                       "Pauses the example timer.")
        XCTAssertEqual(DemoWords.timerToggleHint(phase: .done, duration: 180),
                       "Restarts the example timer from 3 minutes.")
        XCTAssertEqual(DemoWords.timerAnnouncement(.started, remaining: 59.5),
                       "Example timer started. 1 minute left.")
        XCTAssertEqual(DemoWords.timerAnnouncement(.paused, remaining: 1),
                       "Example timer paused. 1 second left.")
        XCTAssertEqual(DemoWords.timerAnnouncement(.reset, remaining: 0),
                       "Example timer reset to 0 seconds.")
        XCTAssertEqual(DemoWords.timerAnnouncement(.finished, remaining: 0),
                       "Example timer done.")
    }

    func testPadNudgePositionIsSpokenAsPercentages() {
        XCTAssertEqual(DemoWords.padPosition(CGPoint(x: 0, y: 0)),
                       "Example pointer 0 percent right, 0 percent down.")
        XCTAssertEqual(DemoWords.padPosition(CGPoint(x: 0.5, y: 0.25)),
                       "Example pointer 50 percent right, 25 percent down.")
        XCTAssertEqual(DemoWords.padPosition(CGPoint(x: 1, y: 1)),
                       "Example pointer 100 percent right, 100 percent down.")
    }

    func testPriceAlertHintMatchesCurrentToggleState() {
        XCTAssertEqual(DemoWords.alertHint(on: false), "Turns on an example price drop alert. Nothing is sent from this demo.")
        XCTAssertEqual(DemoWords.alertHint(on: true), "Turns off the example price drop alert.")
    }

    func testCameraCaptionNamesOnlyAKnownPlaceAndAlwaysSaysExample() {
        XCTAssertEqual(DemoWords.cameraCaption(place: "Entry", updated: "Updated just now"),
                       "Entry · Example still · Updated just now")
        XCTAssertEqual(DemoWords.cameraCaption(updated: "Updated just now"),
                       "Example still · Updated just now")
    }

    func testCameraSpokenSaysTheStillIsDrawnNotLive() {
        XCTAssertEqual(DemoWords.cameraSpoken(name: "Front door", updated: "Updated 2 min ago"),
                       "Example camera still: Front door. Updated 2 min ago. Drawn on this device, not a live camera.")
    }

    func testDesktopStatusAndSpokenLabelCountTheSampleWindows() {
        XCTAssertEqual(DemoWords.desktopStatus(windows: 3), "Example · 3 sample windows")
        XCTAssertEqual(DemoWords.desktopSpoken(name: "Sample desktop", windows: 3),
                       "Example desktop: Sample desktop. 3 sample windows.")
    }
}
