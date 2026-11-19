import Foundation
#if canImport(SwiftUI)
import SwiftUI
#endif

/// Everything the demo says about its own sample state, kept free of UI types so it is spoken the same way
/// on every screen and can be checked without a simulator. Every simulated result is called Example: nothing
/// here names a live camera, an online desktop or a real device, because the demo never reaches one.
enum DemoWords {
    static let exampleTag = "Example"

    // MARK: Timer

    enum TimerPhase: Equatable { case ready, running, done }

    enum TimerEvent: Equatable { case started, paused, reset, finished }

    /// The countdown as shown: `3:00`.
    static func clock(_ remaining: TimeInterval) -> String {
        let total = wholeSeconds(remaining)
        return String(format: "%ld:%02ld", total / 60, total % 60)
    }

    /// The same countdown as VoiceOver should say it. `2:59` read aloud sounds like a time of day.
    static func spokenDuration(_ remaining: TimeInterval) -> String {
        let total = wholeSeconds(remaining)
        let minutes = total / 60
        let seconds = total % 60
        var parts: [String] = []
        if minutes > 0 { parts.append(minutes == 1 ? "1 minute" : "\(minutes) minutes") }
        if seconds > 0 || minutes == 0 { parts.append(seconds == 1 ? "1 second" : "\(seconds) seconds") }
        return parts.joined(separator: " ")
    }

    static func timerStatus(_ phase: TimerPhase) -> String {
        switch phase {
        case .done: "Done"
        case .running: "Running"
        case .ready: "Ready"
        }
    }

    /// What VoiceOver says for the timer's title block: it is an example, its name and its state.
    static func timerSpoken(name: String, phase: TimerPhase) -> String {
        "Example timer, \(name). \(timerStatus(phase))."
    }

    static func timerClockSpoken(_ remaining: TimeInterval) -> String {
        "\(spokenDuration(remaining)) remaining"
    }

    static func timerToggleHint(phase: TimerPhase, duration: TimeInterval) -> String {
        switch phase {
        case .ready: "Starts the example timer. It runs in this demo only."
        case .running: "Pauses the example timer."
        case .done: "Restarts the example timer from \(spokenDuration(duration))."
        }
    }

    static func timerResetHint(duration: TimeInterval) -> String {
        "Sets the example timer back to \(spokenDuration(duration))."
    }

    /// Spoken once when a timer control changes state, so the new state is heard without hunting for it.
    static func timerAnnouncement(_ event: TimerEvent, remaining: TimeInterval) -> String {
        switch event {
        case .started: "Example timer started. \(spokenDuration(remaining)) left."
        case .paused: "Example timer paused. \(spokenDuration(remaining)) left."
        case .reset: "Example timer reset to \(spokenDuration(remaining))."
        case .finished: "Example timer done."
        }
    }

    // MARK: Reminders and rooms

    static let reminderHint = "Example reminder. Nothing is scheduled on your device."
    static let switchHint = "Example switch. It changes this demo only, never a real light or lock."

    // MARK: Cameras

    /// The line under a sample still. It says Example so a still cannot read as a live picture.
    static func cameraCaption(place: String? = nil, updated: String) -> String {
        [place, "Example still", updated].compactMap { $0 }.joined(separator: " · ")
    }

    static func cameraSpoken(name: String, updated: String) -> String {
        "Example camera still: \(name). \(updated). Drawn on this device, not a live camera."
    }

    static let cameraRefreshTitle = "Refresh sample still"
    static let cameraRefreshHint = "Swaps this example still between day and dusk. No camera is contacted."

    // MARK: Desktop

    static func desktopStatus(windows: Int) -> String {
        "Example · \(windows) sample windows"
    }

    static func desktopSpoken(name: String, windows: Int) -> String {
        "Example desktop: \(name). \(windows) sample windows."
    }

    static let desktopHint = "Opens the illustrated desktop on the Home tab. It is not a real computer."

    // MARK: Pad

    enum PadEvent: Equatable { case moved, leftClick, rightClick, sent }

    static let padIdle = "Your phone as a trackpad and keyboard for your computer. Drag to move, tap to click"

    /// A simulated click or typed line is an example, not a result from a computer.
    static func padResult(_ event: PadEvent) -> String {
        switch event {
        case .moved: "Example · Moving the pointer"
        case .leftClick: "Example · Left click"
        case .rightClick: "Example · Right click"
        case .sent: "Example · Text shown on the sample desktop"
        }
    }

    /// Spoken after a click or send. A drag is silent: it would repeat for every frame.
    static func padAnnouncement(_ event: PadEvent) -> String? {
        switch event {
        case .moved: nil
        case .leftClick: "Example left click."
        case .rightClick: "Example right click."
        case .sent: "Example text shown on the sample desktop."
        }
    }

    static let padSurfaceLabel = "Example trackpad"
    static let padSurfaceHint = "Drag to move the sample pointer. Double tap to click. With VoiceOver, move the pointer from the rotor actions. Nothing reaches a real computer."
    static let padClickHint = "Example click on the sample desktop."
    static let padSendHint = "Shows the text on the sample desktop only."

    /// VoiceOver rotor actions on the pad surface; a drag is touch-only.
    static let padNudgeLeft = "Move pointer left"
    static let padNudgeRight = "Move pointer right"
    static let padNudgeUp = "Move pointer up"
    static let padNudgeDown = "Move pointer down"

    /// Spoken after a rotor nudge, so the VoiceOver user hears where the sample pointer landed.
    static func padPosition(_ point: CGPoint) -> String {
        let x = DeckFeedParser.whole((point.x * 100).rounded()), y = DeckFeedParser.whole((point.y * 100).rounded())
        return "Example pointer \(x) percent right, \(y) percent down."
    }

    // MARK: Links

    static func pinHint(pinned: Bool) -> String {
        pinned ? "Unpins this example page." : "Pins this example page to the top of the sample list."
    }

    // MARK: Shop

    /// Whole dollars, so a sample price never shows cents or a locale guess. Generic so a magnitude (UInt)
    /// formats through the same path: negating Int.min would trap, its magnitude will not.
    static func price<I: BinaryInteger>(_ dollars: I) -> String { "$\(dollars)" }

    /// The 7 day move: `Down $50 this week`, `Up $10 this week`, `Same as last week`.
    static func weekChange(_ dollars: Int) -> String {
        if dollars < 0 { return "Down \(price(dollars.magnitude)) this week" }
        if dollars > 0 { return "Up \(price(dollars)) this week" }
        return "Same as last week"
    }

    /// The 30 day line under an item. At or under the low it says so instead of repeating the price.
    static func lowLine(price current: Int, low30: Int, weekChange change: Int) -> String {
        let low = current <= low30 ? "At its 30 day low" : "30 day low \(price(low30))"
        return "\(low) · \(weekChange(change))"
    }

    static func itemSpoken(title: String, price current: Int, store: String, low30: Int, weekChange change: Int) -> String {
        "Example item: \(title). Best price \(price(current)) at \(store). "
            + "\(lowLine(price: current, low30: low30, weekChange: change).replacingOccurrences(of: " · ", with: ". "))."
    }

    static func alertHint(on: Bool) -> String {
        on ? "Turns off the example price drop alert." : "Turns on an example price drop alert. Nothing is sent from this demo."
    }

    /// How a store answered the last price check. A store that blocks automated search, or one waiting for keys,
    /// is skipped on purpose: it is not a failure and it does not count against the stores answering. The demo
    /// never shows a store failing: it reports skips instead.
    enum StoreState: Equatable {
        case answering, skipped, needsSetup
    }

    static func storeStatus(_ state: StoreState) -> String {
        switch state {
        case .answering: "Answering"
        case .skipped: "Skipped. The site blocks automated search and has no official API."
        case .needsSetup: "Needs setup. Add this store's access keys on your server."
        }
    }

    /// The Coverage headline and its note, counting only the stores the deck actually asks.
    static func coverage(_ states: [StoreState]) -> (title: String, detail: String) {
        let answering = states.filter { $0 == .answering }.count
        let skipped = states.filter { $0 == .skipped }.count
        let setup = states.filter { $0 == .needsSetup }.count
        let notes = [skipped > 0 ? "\(skipped) skipped" : nil,
                     setup > 0 ? (setup == 1 ? "1 needs setup" : "\(setup) need setup") : nil].compactMap { $0 }
        let title = answering == 0 ? "No stores checked" : "\(answering) of \(answering) stores answering"
        let quiet = answering == 0 ? "Nothing to show yet" : "Every store answered"
        return (title, notes.isEmpty ? quiet : notes.joined(separator: " · "))
    }

    static let watchlistFooter = "Example prices for invented items. Your deck tracks the items you watch."
    static let coverageFooter = "Example stores. A store that blocks automated search is skipped, never counted as a failure."

    // MARK: Section footers

    static let scheduleFooter = "Example events. Your deck shows your own calendar."
    static let timerFooter = "An example timer. It runs in this demo only."
    static let desktopFooter = "An example desktop. It is not a connection to a computer."
    static let cameraFooter = "An example still drawn on this device."
    static let roomsFooter = "Example switches. They change this demo only, never a real light or lock."

    // MARK: What each tab is for

    static let todayPurpose = "Your day at a glance: weather, next events, a timer, your computer and your cameras."
    static let homePurpose = "Your cameras, your computer's screen and the switches in your rooms."
    static let shopPurpose = "Prices on the items you watch, and which stores your deck checked."
    static let linksPurpose = "Pages you saved on your own server, one tap away. Pin the ones you use most."

    // MARK: Connect

    static let connectHint = "Opens the connection sheet. Nothing is connected yet."

    private static func wholeSeconds(_ remaining: TimeInterval) -> Int {
        guard remaining.isFinite, remaining > 0 else { return 0 }
        return DeckFeedParser.whole(remaining.rounded(.up))
    }
}

#if canImport(SwiftUI)
/// The demo's colors and type. Colors are the shell's `DeckColors` (final deck tokens, `wave2/tokens.json`):
/// one tinted neutral ramp, one interaction tint, and red/amber/green for status only.
enum DemoPalette {
    static let bg = DeckColors.bg
    static let raised = DeckColors.panel
    static let line = DeckColors.line
    static let text1 = DeckColors.fg
    static let text2 = DeckColors.dim
    static let text3 = DeckColors.faint
    static let tint = DeckColors.signal
    static let ok = DeckColors.ok
    static let bad = DeckColors.bad

}

/// The demo's type is the shared Geist scale (`DeckTypeRole`), anchored to text styles so Dynamic Type scales it.
/// display 26/600, title 19/600, body 17, meta 15, micro 13/600: nothing under 13 pt.
enum DemoType {
    static var display: Font { .custom(DeckFontFiles.name(mono: false, weight: 600), size: 26, relativeTo: .title) }
    static var title: Font { DeckFont.font(.heading) }
    static var body: Font { DeckFont.font(.body) }
    static var bodyStrong: Font { DeckFont.font(.body, weight: 600) }
    static var meta: Font { DeckFont.font(.meta) }
    static var micro: Font { DeckFont.font(.micro, weight: 600) }
}

enum DemoMotion {
    /// Reduce Motion turns demo motion off: state changes apply at once. Otherwise a short smooth spring.
    static func animation(reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : Animation.smooth(duration: 0.28)
    }
}

/// 120 ms press feedback for tappable surfaces. Reduce Motion keeps the dim and drops the scale.
struct DemoPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// A quiet label: it says this is a sample without competing with the content.
/// From iOS 26 the toolbar draws the capsule itself; earlier systems get a hairline outline.
struct DemoBadge: View {
    private var label: some View {
        Text("Demo")
            .font(DemoType.micro)
            .foregroundStyle(DemoPalette.text2)
            .fixedSize()
            .padding(.horizontal, 10)
            .frame(minHeight: 28)
    }

    var body: some View {
        Group {
            if #available(iOS 26, *) {
                label
            } else {
                label.overlay(Capsule().strokeBorder(DemoPalette.line, lineWidth: 1))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Demo, sample data")
        .accessibilityIdentifier("demo.badge")
    }
}

/// A corner stamp on a drawn still or desktop, so a screenshot of the demo cannot pass for a live picture.
/// It is decorative for VoiceOver: the picture's own label already says Example. The type stops growing
/// at xxxLarge so the stamp never covers a thumbnail.
struct DemoExampleTag: View {
    var body: some View {
        Text(DemoWords.exampleTag)
            .font(DemoType.micro)
            .foregroundStyle(Color.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Color.black.opacity(0.72), in: Capsule())
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .accessibilityHidden(true)
    }
}

extension View {
    func demoExampleTag() -> some View {
        overlay(alignment: .topLeading) { DemoExampleTag().padding(6) }
    }
}
#endif
