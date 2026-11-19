import CoreGraphics
import Foundation
import Observation

/// An in-memory sample. No URL, session, WebView, socket or disk storage belongs to this type.
/// Every figure is invented: no names, hosts, paths or accounts from a real deck.
/// Each control that changes sample state also bumps exactly one feedback counter, which the
/// views turn into a haptic with `.sensoryFeedback`.
@MainActor @Observable
final class DemoDeck {
    enum Tab: String, CaseIterable, Identifiable {
        case today, home, shop, links, pad

        var id: String { rawValue }
        var title: String {
            switch self {
            case .today: "Today"
            case .home: "Home"
            case .shop: "Shop"
            case .links: "Links"
            case .pad: "Pad"
            }
        }
        var symbol: String {
            switch self {
            case .today: "sun.max"
            case .home: "house"
            case .shop: "cart"
            case .links: "link"
            case .pad: "hand.draw"
            }
        }
    }

    struct Event: Identifiable, Equatable {
        let id: String
        let title: String
        let detail: String
        let start: Date
    }

    struct Camera: Identifiable, Hashable {
        let id: String
        let name: String
        let place: String
        let scene: DemoScene
    }

    struct Switch: Identifiable, Hashable {
        let id: String
        let title: String
        let onDetail: String
        let offDetail: String
        let onSymbol: String
        let offSymbol: String
    }

    struct SampleLink: Identifiable, Hashable {
        let id: String
        let title: String
        let detail: String
        let symbol: String
        let paragraphs: [String]
    }

    /// An invented item on the watchlist. Prices are whole dollars.
    struct WatchItem: Identifiable, Hashable {
        let id: String
        let title: String
        let store: String
        let price: Int
        let low30: Int
        let weekChange: Int
        let symbol: String
    }

    struct SampleStore: Identifiable, Hashable {
        let id: String
        let name: String
        let state: DemoWords.StoreState
    }

    enum PadStatus: Equatable {
        case moved, leftClick, rightClick, sent
    }

    enum Click { case left, right }

    let desktopName = "Sample desktop"
    let cameras = [
        Camera(id: "front-door", name: "Front door", place: "Entry", scene: .frontDoor),
        Camera(id: "garden", name: "Back garden", place: "Outside", scene: .garden),
        Camera(id: "garage", name: "Garage", place: "Driveway", scene: .garage)
    ]
    let switches = [
        Switch(id: "living-room", title: "Living room lights", onDetail: "On", offDetail: "Off",
               onSymbol: "lightbulb.fill", offSymbol: "lightbulb"),
        Switch(id: "porch", title: "Porch light", onDetail: "On", offDetail: "Off",
               onSymbol: "light.recessed.fill", offSymbol: "light.recessed"),
        Switch(id: "front-door-lock", title: "Front door", onDetail: "Locked", offDetail: "Unlocked",
               onSymbol: "lock.fill", offSymbol: "lock.open")
    ]
    let links = [
        SampleLink(id: "sample-notes", title: "Sample notes", detail: "A page in the demo, not a website",
                   symbol: "note.text",
                   paragraphs: ["Notes you keep on your deck open here, one tap from the glance.",
                                "This page is a local preview. Nothing is loaded from the internet."]),
        SampleLink(id: "example-project", title: "Example project", detail: "An invented project board",
                   symbol: "folder",
                   paragraphs: ["Pin the pages you open every day, such as a project board or a dashboard.",
                                "In your own deck these links open the pages you saved on your server."]),
        SampleLink(id: "reading-list", title: "Reading list", detail: "Three sample articles",
                   symbol: "books.vertical",
                   paragraphs: ["Long reads wait here until you have a quiet minute.",
                                "Swipe a row to pin it to the top of the list."])
    ]
    let watchlist = [
        WatchItem(id: "headphones", title: "Noise-cancelling headphones", store: "Electronics store",
                  price: 249, low30: 229, weekChange: -50, symbol: "headphones"),
        WatchItem(id: "grinder", title: "Espresso grinder", store: "Kitchen shop",
                  price: 139, low30: 139, weekChange: -10, symbol: "cup.and.saucer"),
        WatchItem(id: "monitor", title: "27 inch monitor", store: "Refurb shop",
                  price: 329, low30: 299, weekChange: 10, symbol: "display")
    ]
    /// The stores the sample checks. One blocks automated search and one waits for keys: both are skipped calmly.
    let stores = [
        SampleStore(id: "electronics", name: "Electronics store", state: .answering),
        SampleStore(id: "kitchen", name: "Kitchen shop", state: .answering),
        SampleStore(id: "refurb", name: "Refurb shop", state: .answering),
        SampleStore(id: "hardware", name: "Hardware store", state: .answering),
        SampleStore(id: "warehouse", name: "Warehouse club", state: .skipped),
        SampleStore(id: "marketplace", name: "Marketplace", state: .needsSetup)
    ]
    let timerDuration: TimeInterval = 180

    private(set) var events: [Event]
    var activeTab: Tab = .today
    var selectedCamera: Camera?

    private(set) var remindedEventIDs: Set<String> = []
    private(set) var onSwitchIDs: Set<String> = ["living-room", "front-door-lock"]
    private(set) var pinnedLinkIDs: Set<String> = []
    private(set) var alertItemIDs: Set<String> = ["headphones"]
    private(set) var openedLinkID: String?
    private(set) var cameraLight: [String: DemoLight] = [:]
    private(set) var cameraRefreshedAt: [String: Date] = [:]

    private(set) var timerEndsAt: Date?
    private(set) var timerPausedRemaining: TimeInterval

    private(set) var pointer = CGPoint(x: 0.5, y: 0.5)
    private(set) var padStatus: PadStatus?
    private(set) var sentMessages: [String] = []

    private(set) var selectionCount = 0
    private(set) var impactCount = 0
    private(set) var successCount = 0

    init(now: Date = .now) {
        events = Self.makeEvents(now: now)
        timerPausedRemaining = timerDuration
    }

    /// Times are relative to launch so the sample always reads as "today".
    static func makeEvents(now: Date) -> [Event] {
        func start(minutes: Double) -> Date {
            let t = now.addingTimeInterval(minutes * 60).timeIntervalSinceReferenceDate
            return Date(timeIntervalSinceReferenceDate: (t / 300).rounded(.up) * 300)
        }
        return [
            Event(id: "design-review", title: "Design review", detail: "Room 2 · 30 min", start: start(minutes: 45)),
            Event(id: "focus-block", title: "Focus block", detail: "Do not disturb · 90 min", start: start(minutes: 150)),
            Event(id: "dinner", title: "Dinner reservation", detail: "Table for four", start: start(minutes: 390))
        ]
    }

    // MARK: Today

    func toggleReminder(_ event: Event) {
        if remindedEventIDs.remove(event.id) == nil { remindedEventIDs.insert(event.id) }
        selectionCount += 1
    }

    var timerRunning: Bool { timerEndsAt != nil }

    func timerRemaining(at now: Date) -> TimeInterval {
        if let end = timerEndsAt { return max(0, end.timeIntervalSince(now)) }
        return timerPausedRemaining
    }

    func timerFinished(at now: Date) -> Bool { timerRunning && timerRemaining(at: now) == 0 }

    /// The countdown reached zero and was settled: stopped, showing Done.
    var timerDone: Bool { !timerRunning && timerPausedRemaining <= 0 }

    /// Stops the countdown once it reaches zero, so nothing keeps ticking after Done. Fires one success haptic.
    func settleFinishedTimer(now: Date) {
        guard timerFinished(at: now) else { return }
        timerEndsAt = nil
        timerPausedRemaining = 0
        successCount += 1
    }

    /// Start, pause, or restart after the countdown finished.
    func toggleTimer(now: Date = .now) {
        if timerRunning {
            let remaining = timerRemaining(at: now)
            timerEndsAt = nil
            timerPausedRemaining = remaining == 0 ? timerDuration : remaining
        } else {
            let remaining = timerPausedRemaining <= 0 ? timerDuration : timerPausedRemaining
            timerEndsAt = now.addingTimeInterval(remaining)
        }
        impactCount += 1
    }

    func resetTimer() {
        timerEndsAt = nil
        timerPausedRemaining = timerDuration
        selectionCount += 1
    }

    // MARK: Home

    func isOn(_ id: String) -> Bool { onSwitchIDs.contains(id) }

    func setSwitch(_ id: String, on: Bool) {
        guard isOn(id) != on else { return }
        if on { onSwitchIDs.insert(id) } else { onSwitchIDs.remove(id) }
        selectionCount += 1
    }

    func light(for camera: Camera) -> DemoLight { cameraLight[camera.id] ?? .day }

    /// A new sample snapshot: the same scene in the other light.
    func refreshSnapshot(_ camera: Camera, now: Date = .now) {
        cameraLight[camera.id] = light(for: camera) == .day ? .dusk : .day
        cameraRefreshedAt[camera.id] = now
        selectionCount += 1
    }

    /// The caption ages with the clock: a still refreshed a minute ago no longer reads "just now".
    func updatedLabel(for camera: Camera, now: Date = .now) -> String {
        guard let refreshed = cameraRefreshedAt[camera.id] else { return "Updated 2 min ago" }
        let minutes = DeckFeedParser.whole(now.timeIntervalSince(refreshed) / 60)
        guard minutes >= 1 else { return "Updated just now" }
        return "Updated \(minutes) min ago"
    }

    func open(_ camera: Camera) {
        selectedCamera = camera
        selectionCount += 1
    }

    // MARK: Shop

    func hasAlert(_ item: WatchItem) -> Bool { alertItemIDs.contains(item.id) }

    func toggleAlert(_ item: WatchItem) {
        if alertItemIDs.remove(item.id) == nil { alertItemIDs.insert(item.id) }
        selectionCount += 1
    }

    var coverage: (title: String, detail: String) { DemoWords.coverage(stores.map(\.state)) }

    // MARK: Links

    func isPinned(_ link: SampleLink) -> Bool { pinnedLinkIDs.contains(link.id) }

    func togglePin(_ link: SampleLink) {
        if pinnedLinkIDs.remove(link.id) == nil { pinnedLinkIDs.insert(link.id) }
        selectionCount += 1
    }

    /// Pinned links first, otherwise in the original order.
    var orderedLinks: [SampleLink] {
        links.filter(isPinned) + links.filter { !isPinned($0) }
    }

    func openLink(_ link: SampleLink) {
        openedLinkID = link.id
        selectionCount += 1
    }

    // MARK: Pad

    /// Moves the pointer by a fraction of the pad, like a relative trackpad.
    func movePointer(dx: CGFloat, dy: CGFloat) {
        // NaN passes through min/max unchanged; a NaN pointer would stick and trap `Int(_:)` in `DemoWords.padPosition`.
        guard dx.isFinite, dy.isFinite else { return }
        pointer = CGPoint(x: min(max(pointer.x + dx, 0), 1), y: min(max(pointer.y + dy, 0), 1))
        padStatus = .moved
    }

    func click(_ click: Click) {
        padStatus = click == .left ? .leftClick : .rightClick
        impactCount += 1
    }

    @discardableResult
    func sendText(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        sentMessages.append(trimmed)
        if sentMessages.count > 3 { sentMessages.removeFirst() }
        padStatus = .sent
        successCount += 1
        return true
    }
}
