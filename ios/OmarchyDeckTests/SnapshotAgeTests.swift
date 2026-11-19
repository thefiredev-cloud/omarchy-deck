import Foundation
import XCTest
@testable import OmarchyDeck

/// The loading screen's picture is never live. Its age must read right at every boundary. A file dated in the
/// future (the clock moved back) reads as just now rather than a negative or huge age.
final class SnapshotAgeTests: XCTestCase {
    private let now = Date(timeIntervalSinceReferenceDate: 800_000_000)

    private func ago(_ seconds: TimeInterval) -> Date { now.addingTimeInterval(-seconds) }

    func testChipWordsAtEachBoundary() {
        let cases: [(TimeInterval, String)] = [
            (0, "Picture from just now"),
            (59, "Picture from just now"),
            (60, "Picture from 1 min ago"),
            (59 * 60 + 59, "Picture from 59 min ago"),
            (3600, "Picture from 1 h ago"),
            (23 * 3600 + 3599, "Picture from 23 h ago"),
            (24 * 3600, "Picture from 1 day ago"),
            (46 * 3600, "Picture from 2 days ago"),
            (48 * 3600 - 1, "Picture from 2 days ago"),
            (48 * 3600, "Picture from 2 days ago"),
            (30 * 86400, "Picture from 30 days ago"),
        ]
        for (seconds, expected) in cases {
            XCTAssertEqual(SnapshotAge.label(savedAt: ago(seconds), now: now), expected, "\(seconds) s")
        }
    }

    func testSpokenWordsHaveNoAbbreviationsAndSayNotLive() {
        XCTAssertEqual(SnapshotAge.spoken(savedAt: ago(60), now: now), "Last saved picture, from 1 minute ago, not live")
        XCTAssertEqual(SnapshotAge.spoken(savedAt: ago(5 * 60), now: now), "Last saved picture, from 5 minutes ago, not live")
        XCTAssertEqual(SnapshotAge.spoken(savedAt: ago(3600), now: now), "Last saved picture, from 1 hour ago, not live")
        XCTAssertEqual(SnapshotAge.spoken(savedAt: ago(5 * 3600), now: now), "Last saved picture, from 5 hours ago, not live")
        XCTAssertEqual(SnapshotAge.spoken(savedAt: ago(3 * 86400), now: now), "Last saved picture, from 3 days ago, not live")
    }

    /// A clock moved back makes the file look newer than now. It must not read as a negative or huge age.
    func testFutureDateReadsAsJustNow() {
        let future = now.addingTimeInterval(7200)
        XCTAssertEqual(SnapshotAge.label(savedAt: future, now: now), "Picture from just now")
        XCTAssertEqual(SnapshotAge.spoken(savedAt: future, now: now), "Last saved picture, from just now, not live")
    }
 
    /// A finite but out-of-range file date must not trap while converting elapsed minutes to Int.
    func testExtremePastDateDoesNotTrap() {
        let savedAt = ago(Double(Int.max) * 120)
        XCTAssertTrue(SnapshotAge.label(savedAt: savedAt, now: now).hasSuffix("days ago"))
        XCTAssertTrue(SnapshotAge.spoken(savedAt: savedAt, now: now).hasSuffix("days ago, not live"))
    }
}
