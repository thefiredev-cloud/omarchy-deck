import Foundation
import XCTest
@testable import OmarchyDeck

/// Wave 3 lane 27: the offline demo says what is sample state, speaks the next action, and stays offline.
/// Foundation only, so it also runs in the Linux harness. Rendered layout at accessibility sizes is not covered here:
/// that needs the Mini's UI run.
final class W3L27DemoInteractionPolishTests: XCTestCase {
    // MARK: Timer words

    func testClockAndSpokenDurationDifferSoACountdownIsNotReadAsATimeOfDay() {
        XCTAssertEqual(DemoWords.clock(180), "3:00")
        XCTAssertEqual(DemoWords.spokenDuration(180), "3 minutes")
        XCTAssertEqual(DemoWords.clock(65), "1:05")
        XCTAssertEqual(DemoWords.spokenDuration(65), "1 minute 5 seconds")
        XCTAssertEqual(DemoWords.spokenDuration(60), "1 minute")
        XCTAssertEqual(DemoWords.spokenDuration(61), "1 minute 1 second")
        XCTAssertEqual(DemoWords.spokenDuration(59), "59 seconds")
        XCTAssertEqual(DemoWords.spokenDuration(1), "1 second")
        // Partial seconds round up, the same way the on-screen clock does.
        XCTAssertEqual(DemoWords.clock(0.2), "0:01")
        XCTAssertEqual(DemoWords.spokenDuration(0.2), "1 second")
    }

    func testDurationWordsSurviveFinishedAndNonFiniteInput() {
        for bad in [0, -5, .nan, .infinity, -.infinity] as [TimeInterval] {
            XCTAssertEqual(DemoWords.clock(bad), "0:00", "\(bad)")
            XCTAssertEqual(DemoWords.spokenDuration(bad), "0 seconds", "\(bad)")
        }
    }

    func testTimerIsSpokenAsAnExampleWithItsStateAndNextAction() {
        XCTAssertEqual(DemoWords.timerSpoken(name: "Tea", phase: .ready), "Example timer, Tea. Ready.")
        XCTAssertEqual(DemoWords.timerSpoken(name: "Tea", phase: .running), "Example timer, Tea. Running.")
        XCTAssertEqual(DemoWords.timerSpoken(name: "Tea", phase: .done), "Example timer, Tea. Done.")
        XCTAssertEqual(DemoWords.timerClockSpoken(180), "3 minutes remaining")
        XCTAssertEqual(DemoWords.timerClockSpoken(179), "2 minutes 59 seconds remaining")

        XCTAssertTrue(DemoWords.timerToggleHint(phase: .ready, duration: 180).hasPrefix("Starts the example timer"))
        XCTAssertTrue(DemoWords.timerToggleHint(phase: .running, duration: 180).hasPrefix("Pauses the example timer"))
        XCTAssertEqual(DemoWords.timerToggleHint(phase: .done, duration: 180),
                       "Restarts the example timer from 3 minutes.")
        XCTAssertEqual(DemoWords.timerResetHint(duration: 180), "Sets the example timer back to 3 minutes.")
    }

    func testEveryTimerChangeHasASpokenAnnouncement() {
        XCTAssertEqual(DemoWords.timerAnnouncement(.started, remaining: 180), "Example timer started. 3 minutes left.")
        XCTAssertEqual(DemoWords.timerAnnouncement(.paused, remaining: 95), "Example timer paused. 1 minute 35 seconds left.")
        XCTAssertEqual(DemoWords.timerAnnouncement(.reset, remaining: 180), "Example timer reset to 3 minutes.")
        XCTAssertEqual(DemoWords.timerAnnouncement(.finished, remaining: 0), "Example timer done.")
    }

    // MARK: Cameras, desktop and pad

    func testSampleStillsAreCaptionedAsExamplesNeverAsLive() {
        XCTAssertEqual(DemoWords.cameraCaption(updated: "Updated 2 min ago"), "Example still · Updated 2 min ago")
        XCTAssertEqual(DemoWords.cameraCaption(place: "Entry", updated: "Updated just now"),
                       "Entry · Example still · Updated just now")
        let spoken = DemoWords.cameraSpoken(name: "Front door", updated: "Updated just now")
        XCTAssertTrue(spoken.hasPrefix("Example camera still: Front door."), spoken)
        XCTAssertTrue(spoken.contains("Drawn on this device"), spoken)
        XCTAssertTrue(DemoWords.cameraRefreshHint.contains("No camera is contacted"))
        XCTAssertEqual(DemoWords.cameraRefreshTitle, "Refresh sample still")
    }

    func testDesktopIsAnExampleNotAnOnlineComputer() {
        XCTAssertEqual(DemoWords.desktopStatus(windows: 3), "Example · 3 sample windows")
        XCTAssertEqual(DemoWords.desktopSpoken(name: "Sample desktop", windows: 3),
                       "Example desktop: Sample desktop. 3 sample windows.")
        XCTAssertTrue(DemoWords.desktopHint.contains("not a real computer"))
        XCTAssertTrue(DemoWords.switchHint.contains("never a real light or lock"))
        XCTAssertTrue(DemoWords.reminderHint.contains("Nothing is scheduled"))
    }

    func testPadResultsAreExamplesAndOnlyClicksAndSendsAreSpoken() {
        let events: [DemoWords.PadEvent] = [.moved, .leftClick, .rightClick, .sent]
        for event in events {
            XCTAssertTrue(DemoWords.padResult(event).hasPrefix("Example · "), "\(event)")
        }
        XCTAssertEqual(DemoWords.padResult(.sent), "Example · Text shown on the sample desktop")
        XCTAssertNil(DemoWords.padAnnouncement(.moved), "a drag would repeat every frame")
        XCTAssertEqual(DemoWords.padAnnouncement(.leftClick), "Example left click.")
        XCTAssertEqual(DemoWords.padAnnouncement(.rightClick), "Example right click.")
        XCTAssertEqual(DemoWords.padAnnouncement(.sent), "Example text shown on the sample desktop.")
        XCTAssertEqual(DemoWords.padIdle, "Your phone as a trackpad and keyboard for your computer. Drag to move, tap to click")
        XCTAssertTrue(DemoWords.padSurfaceHint.contains("Nothing reaches a real computer"))
        XCTAssertTrue(DemoWords.padSendHint.contains("sample desktop only"))
    }

    func testLinkPinAndConnectHintsSayWhatHappens() {
        XCTAssertEqual(DemoWords.pinHint(pinned: false), "Pins this example page to the top of the sample list.")
        XCTAssertEqual(DemoWords.pinHint(pinned: true), "Unpins this example page.")
        XCTAssertTrue(DemoWords.connectHint.contains("Nothing is connected yet"))
    }

    // MARK: Wording stays honest

    private static let liveOrOnline = try! NSRegularExpression(pattern: #"\b(?:live|online)\b"#, options: [.caseInsensitive])
    /// Phrases that deny a live connection are the one allowed use of the word.
    private static let denials = ["not a live camera", "not a live connection", "not a live desktop"]

    private func claimsLiveOrOnline(_ text: String) -> Bool {
        var cleaned = text.lowercased()
        for phrase in Self.denials { cleaned = cleaned.replacingOccurrences(of: phrase, with: "") }
        let range = NSRange(cleaned.startIndex..., in: cleaned)
        return Self.liveOrOnline.firstMatch(in: cleaned, options: [], range: range) != nil
    }

    func testNoDemoWordCallsSampleStateLiveOrOnline() {
        var words: [String] = [
            DemoWords.exampleTag, DemoWords.reminderHint, DemoWords.switchHint,
            DemoWords.cameraRefreshTitle, DemoWords.cameraRefreshHint, DemoWords.desktopHint,
            DemoWords.padIdle, DemoWords.padSurfaceLabel, DemoWords.padSurfaceHint, DemoWords.padClickHint,
            DemoWords.padSendHint, DemoWords.scheduleFooter, DemoWords.timerFooter, DemoWords.desktopFooter,
            DemoWords.cameraFooter, DemoWords.roomsFooter, DemoWords.connectHint,
            DemoWords.desktopStatus(windows: 3), DemoWords.desktopSpoken(name: "Sample desktop", windows: 3),
            DemoWords.cameraCaption(place: "Entry", updated: "Updated just now"),
            DemoWords.cameraSpoken(name: "Front door", updated: "Updated 2 min ago"),
            DemoWords.pinHint(pinned: true), DemoWords.pinHint(pinned: false),
            DemoWords.timerResetHint(duration: 180), DemoWords.timerClockSpoken(42)
        ]
        for phase in [DemoWords.TimerPhase.ready, .running, .done] {
            words.append(DemoWords.timerSpoken(name: "Tea", phase: phase))
            words.append(DemoWords.timerToggleHint(phase: phase, duration: 180))
        }
        for event in [DemoWords.TimerEvent.started, .paused, .reset, .finished] {
            words.append(DemoWords.timerAnnouncement(event, remaining: 120))
        }
        for event in [DemoWords.PadEvent.moved, .leftClick, .rightClick, .sent] {
            words.append(DemoWords.padResult(event))
            if let spoken = DemoWords.padAnnouncement(event) { words.append(spoken) }
        }
        for word in words {
            XCTAssertFalse(claimsLiveOrOnline(word), "sample wording claims a live or online state: \(word)")
        }
    }

    // MARK: Plain page purpose lines

    func testEveryDemoTabStatesItsPurposeInPlainWords() {
        let lines = [DemoWords.todayPurpose, DemoWords.homePurpose, DemoWords.shopPurpose, DemoWords.linksPurpose]
        let insider = ["median", "collector", "json", "api key", "workspace", "mcp", "token", "harness"]
        for line in lines {
            XCTAssertFalse(line.isEmpty)
            XCTAssertLessThanOrEqual(line.count, 110, "a purpose line is one short sentence group: \(line)")
            XCTAssertTrue(line.hasSuffix("."), line)
            XCTAssertFalse(line.contains("—"), line)
            for word in insider { XCTAssertFalse(line.lowercased().contains(word), "\(word) in \(line)") }
        }
        XCTAssertEqual(Set(lines).count, lines.count, "each tab says something different")
    }

    func testPadIdleLineExplainsThePadAndStillTellsHowToUseIt() {
        XCTAssertTrue(DemoWords.padIdle.hasPrefix("Your phone as a trackpad and keyboard for your computer."))
        XCTAssertTrue(DemoWords.padIdle.hasSuffix("Drag to move, tap to click"))
        XCTAssertFalse(claimsLiveOrOnline(DemoWords.padIdle))
    }

    func testDemoPagesOpenWithThePurposeRowAndLetTheLongPadLineWrap() {
        guard let pages = demoSource("DemoPages.swift") else { return }
        let body = code(pages)
        for words in ["todayPurpose", "homePurpose", "shopPurpose", "linksPurpose"] {
            XCTAssertTrue(body.contains("DemoPurposeSection(DemoWords.\(words))"), "\(words) is not shown")
        }
        // Phone layout and two-column layout each carry the row: today, home and shop twice, links once.
        XCTAssertGreaterThanOrEqual(body.components(separatedBy: "DemoPurposeSection(").count - 1, 7)
        // The Pad status line is long now, so it must not be cut to one line.
        XCTAssertFalse(body.contains(".lineLimit(1)"))
        guard let view = demoSource("DemoDeckView.swift") else { return }
        XCTAssertTrue(code(view).contains(#"accessibilityIdentifier("demo.purpose")"#))
    }

    // MARK: Source guards (the SwiftUI views cannot run on Linux)

    private func demoSource(_ name: String, file: StaticString = #filePath, line: UInt = #line) -> String? {
        let test = URL(fileURLWithPath: "\(file)").resolvingSymlinksInPath()
        let url = test.deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("OmarchyDeck").appendingPathComponent(name)
        guard let text = try? String(contentsOf: url, encoding: .utf8) else {
            XCTFail("cannot read \(url.path)", file: file, line: line)
            return nil
        }
        return text
    }

    /// Source without whole-line comments, so a doc comment about "no WebView" is not mistaken for code.
    private func code(_ source: String) -> String {
        source.split(separator: "\n", omittingEmptySubsequences: false)
            .filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("//") }
            .joined(separator: "\n")
    }

    private func stringLiterals(_ source: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: #""(?:[^"\\\n]|\\.)*""#) else { return [] }
        let range = NSRange(source.startIndex..., in: source)
        return regex.matches(in: source, options: [], range: range).compactMap {
            Range($0.range, in: source).map { String(source[$0]) }
        }
    }

    private static let demoFiles = ["DemoDeck.swift", "DemoStills.swift", "DemoPages.swift",
                                    "DemoDeckView.swift", "DemoConnectSheet.swift", "DemoTheme.swift"]

    func testNoVisibleOrSpokenDemoStringCallsSampleStateLiveOrOnline() {
        for name in Self.demoFiles {
            guard let source = demoSource(name) else { continue }
            for literal in stringLiterals(code(source)) {
                XCTAssertFalse(claimsLiveOrOnline(literal), "\(name) says live or online: \(literal)")
            }
        }
    }

    func testDemoSourcesNeverReachTheNetworkAWebViewOrARealDesktop() {
        let forbidden = ["URLSession", "URLRequest", "WKWebView", "WebView(", "UIApplication", "openURL",
                         "OpenURLAction", "NWConnection", "Process(", "SSHSession", "WebSocket"]
        for name in Self.demoFiles {
            guard let source = demoSource(name) else { continue }
            let body = code(source)
            for token in forbidden {
                XCTAssertFalse(body.contains(token), "\(name) uses \(token)")
            }
        }
    }

    func testDemoPagesWireTheExampleWordingAndKeepEveryControlReachable() {
        guard let pages = demoSource("DemoPages.swift") else { return }
        let body = code(pages)
        // The old live-looking strings are gone.
        XCTAssertFalse(body.contains("Online · 3 windows"))
        XCTAssertFalse(body.contains("Refresh snapshot"))
        XCTAssertFalse(body.contains(#"?? "Drag to move"#))
        XCTAssertFalse(body.contains("padStatus?.label"))
        // Every drawn still and desktop carries the Example stamp: today desktop and camera, home desktop and tile,
        // camera sheet, pad desktop.
        XCTAssertGreaterThanOrEqual(body.components(separatedBy: ".demoExampleTag()").count - 1, 6)
        // Timer, camera, desktop and pad speak through the shared words.
        for call in ["DemoWords.timerToggleHint", "DemoWords.timerAnnouncement", "DemoWords.cameraSpoken",
                     "DemoWords.cameraCaption", "DemoWords.desktopSpoken", "DemoWords.padResult",
                     "DemoWords.padAnnouncement", "DemoWords.switchHint"] {
            XCTAssertTrue(body.contains(call), "DemoPages no longer uses \(call)")
        }
        // A pushed sample page keeps the way out; the demo exit was only on the list behind it.
        XCTAssertTrue(body.contains(#"accessibilityIdentifier("demo.connect.open")"#))
    }

    func testDemoMotionAlwaysGoesThroughReduceMotion() {
        for name in ["DemoPages.swift", "DemoDeckView.swift"] {
            guard let source = demoSource(name) else { continue }
            for line in code(source).split(separator: "\n") {
                if line.contains("withAnimation(") || line.contains(".animation(") {
                    XCTAssertTrue(line.contains("DemoMotion.animation(reduceMotion"),
                                  "\(name) animates without Reduce Motion: \(line)")
                }
            }
        }
    }
}
