import UIKit
import WebKit

/// The styles the web deck may ask for. Anything else is ignored.
enum DeckHaptic: String {
    case selection, light, medium, success, warning, error
}

@MainActor
protocol HapticPlaying {
    func play(_ style: DeckHaptic)
}

/// UIKit generators, created on first use and kept for the life of the app so the Taptic Engine stays warm.
@MainActor
final class UIKitHapticPlayer: HapticPlaying {
    private lazy var selection = UISelectionFeedbackGenerator()
    private lazy var light = UIImpactFeedbackGenerator(style: .light)
    private lazy var medium = UIImpactFeedbackGenerator(style: .medium)
    private lazy var notification = UINotificationFeedbackGenerator()

    func play(_ style: DeckHaptic) {
        switch style {
        case .selection: selection.selectionChanged()
        case .light: light.impactOccurred()
        case .medium: medium.impactOccurred()
        case .success: notification.notificationOccurred(.success)
        case .warning: notification.notificationOccurred(.warning)
        case .error: notification.notificationOccurred(.error)
        }
    }
}

/// At most `limit` events in any `window` seconds. A runaway page script cannot hammer the motor.
struct HapticRateLimiter {
    static let limit = 20
    static let window: TimeInterval = 1
    private var accepted: [TimeInterval] = []

    mutating func allow(at now: TimeInterval) -> Bool {
        accepted.removeAll { now - $0 >= Self.window }
        guard accepted.count < Self.limit else { return false }
        accepted.append(now)
        return true
    }
}

/// Web to native haptics: `window.webkit.messageHandlers.deckHaptic.postMessage({style})`.
/// Only the style names above play, only from the main frame, and never more than 20 a second.
@MainActor
final class HapticBridge: NSObject, WKScriptMessageHandler {
    static let handlerName = "deckHaptic"

    private let player: HapticPlaying
    private let now: () -> TimeInterval
    private var limiter = HapticRateLimiter()

    init(player: HapticPlaying? = nil,
         now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
        self.player = player ?? UIKitHapticPlayer()
        self.now = now
    }

    /// The style a message asks for, or nil when the body is not `{style: <known name>}`.
    nonisolated static func style(from body: Any) -> DeckHaptic? {
        guard let dictionary = body as? [String: Any], let name = dictionary["style"] as? String else { return nil }
        return DeckHaptic(rawValue: name)
    }

    /// True when a haptic played.
    @discardableResult
    func handle(body: Any) -> Bool {
        guard let style = Self.style(from: body), limiter.allow(at: now()) else { return false }
        player.play(style)
        return true
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame else { return }
        handle(body: message.body)
    }
}

/// WKUserContentController keeps its handlers alive for as long as it lives, and the model owns the
/// controller through the web view. Registering this proxy keeps the bridge from being retained by WebKit.
@MainActor
final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
