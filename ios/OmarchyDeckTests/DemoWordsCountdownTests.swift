import Foundation
import XCTest
@testable import OmarchyDeck

/// Countdown arithmetic behind the demo timer: where minute and second counts roll over, and how a partial
/// second rounds. Foundation only, so it also runs in the Linux harness.
final class DemoWordsCountdownTests: XCTestCase {
    func testPartialSecondsRoundUpSoTheClockNeverShowsZeroWithTimeLeft() {
        XCTAssertEqual(DemoWords.clock(0.001), "0:01")
        XCTAssertEqual(DemoWords.clock(59.5), "1:00")
        XCTAssertEqual(DemoWords.clock(60), "1:00")
        XCTAssertEqual(DemoWords.clock(60.5), "1:01")
        XCTAssertEqual(DemoWords.spokenDuration(59.5), "1 minute")
    }

    func testMinutesAndSecondsPluralizeIndependently() {
        XCTAssertEqual(DemoWords.spokenDuration(120), "2 minutes")
        XCTAssertEqual(DemoWords.spokenDuration(121), "2 minutes 1 second")
        XCTAssertEqual(DemoWords.spokenDuration(122), "2 minutes 2 seconds")
        XCTAssertEqual(DemoWords.spokenDuration(3600), "60 minutes")
        XCTAssertEqual(DemoWords.spokenDuration(3601), "60 minutes 1 second")
    }

    func testClockKeepsCountingMinutesPastNineAndFiftyNineWithoutWrapping() {
        XCTAssertEqual(DemoWords.clock(599), "9:59")
        XCTAssertEqual(DemoWords.clock(600), "10:00")
        XCTAssertEqual(DemoWords.clock(3599.2), "60:00")
        XCTAssertEqual(DemoWords.clock(3600), "60:00")
        XCTAssertEqual(DemoWords.clock(3601), "60:01")
    }

    /// `Int(_:)` traps outside its range; a huge or non-finite remaining time must read as a clamped or zero clock.
    func testHugeOrNonFiniteRemainingTimeDoesNotTrap() {
        XCTAssertEqual(DemoWords.clock(.nan), "0:00")
        XCTAssertEqual(DemoWords.clock(-.infinity), "0:00")
        XCTAssertEqual(DemoWords.clock(.infinity), "0:00")
        XCTAssertEqual(DemoWords.clock(1e300), "16666666666666:40")
        XCTAssertEqual(DemoWords.spokenDuration(.greatestFiniteMagnitude), "16666666666666 minutes 40 seconds")
    }
}
