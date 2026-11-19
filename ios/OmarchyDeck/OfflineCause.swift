import Foundation

/// Why the deck did not open, in the customer's words. `DeckModel` hands the offline screen one sentence
/// (`DeckPhase.offline(reason:)`); this turns it into a calm title and one instruction. The raw sentence stays
/// available behind a Details disclosure for support.
enum OfflineCause: Equatable, CaseIterable {
    case noNetwork
    case unreachable
    case tailscaleOff
    case secureConnection
    case serverError
    case signInExpired
    case deviceProblem

    /// The sentence for a name lookup that failed. A `.ts.net` name only resolves while Tailscale runs on this
    /// device, so that failure names Tailscale (I12); any other host keeps the plain sentence.
    static func nameDidNotResolveReason(host: String?) -> String {
        let name = (host ?? "").lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
        return name.hasSuffix(".ts.net") ? tailscaleReason : "The deck server name did not resolve."
    }

    static let tailscaleReason = "The deck's Tailscale name did not resolve on this device."

    init(reason: String) {
        let text = reason.lowercased()
        if let code = Self.httpStatus(in: text) {
            self = (code == 401 || code == 403) ? .signInExpired : .serverError
        } else if text.contains("no network connection") {
            self = .noNetwork
        } else if text.contains("tailscale name") {
            self = .tailscaleOff
        } else if text.contains("secure connection") {
            self = .secureConnection
        } else if text.contains("limit the app") || text.contains("stopped unexpectedly") {
            self = .deviceProblem
        } else {
            self = .unreachable
        }
    }

    private static func httpStatus(in text: String) -> Int? {
        guard let range = text.range(of: "http ") else { return nil }
        let digits = text[range.upperBound...].prefix { $0.isNumber }
        return Int(digits)
    }

    var title: String {
        switch self {
        case .noNetwork: "You're offline"
        case .unreachable: "Can't reach your deck"
        case .tailscaleOff: "Turn on Tailscale on this device"
        case .secureConnection: "Can't make a secure connection"
        case .serverError: "Your deck hit a problem"
        case .signInExpired: "Sign in again"
        case .deviceProblem: "Couldn't open this deck"
        }
    }

    var guidance: String {
        switch self {
        case .noNetwork:
            "This device isn't connected to the internet. When you're back online, tap Retry."
        case .unreachable:
            "Your server isn't answering. Check that it's running and, if you use a VPN, that it's on. Then tap Retry."
        case .tailscaleOff:
            "Your deck's address only works while the Tailscale app is connected on this device. Open Tailscale, turn it on, then tap Retry."
        case .secureConnection:
            "This device could not make a secure connection to your server. Ask whoever runs the server to check its security certificate, then tap Retry."
        case .serverError:
            "Your server answered but couldn't open the deck. This is often temporary. Tap Retry in a moment."
        case .signInExpired:
            "Your deck signed this device out. Sign in again with your deck token."
        case .deviceProblem:
            "Something on this device stopped the deck from opening. Tap Retry."
        }
    }

    var symbol: String {
        switch self {
        case .noNetwork: "wifi.slash"
        case .unreachable: "network.slash"
        case .tailscaleOff: "point.3.connected.trianglepath.dotted"
        case .secureConnection: "lock.slash"
        case .serverError: "exclamationmark.triangle"
        case .signInExpired: "person.crop.circle.badge.exclamationmark"
        case .deviceProblem: "exclamationmark.circle"
        }
    }
}

/// The one filled action on the offline screen. Reconnect exists only while the model says the deck answered
/// (`DeckModel.reconnectReady`); every other state offers Retry. Both call `DeckModel.retry()`.
enum OfflinePrimaryAction: Equatable {
    case retry
    case reconnect

    init(reconnectReady: Bool) {
        self = reconnectReady ? .reconnect : .retry
    }

    var title: String {
        switch self {
        case .retry: "Retry"
        case .reconnect: "Reconnect"
        }
    }

    var identifier: String {
        switch self {
        case .retry: "offline.retry"
        case .reconnect: "reconnect.open"
        }
    }
}

/// Where the primary action sits so it never scrolls out of reach while the cause and next steps wrap.
/// A phone held sideways has little height, so there the action moves beside the text instead of under it.
enum OfflineActionPlacement: Equatable {
    case bottomBar
    case trailingColumn

    init(isCompactHeight: Bool) {
        self = isCompactHeight ? .trailingColumn : .bottomBar
    }
}

/// What VoiceOver focuses when the recovery screen appears.
enum OfflineFocusTarget: Equatable {
    case cause
    case banner
}

/// Says recovery once. Focus lands on the cause (or on the Deck is back banner when the deck already answered) and
/// VoiceOver reads it there; an announcement is only for a banner that appears while the screen is already up.
/// It stays silent when the banner drops back and speaks again if the banner returns.
struct OfflineSpeechGate: Equatable {
    private var bannerSpoken = false

    mutating func focusOnAppear(reconnectReady: Bool) -> OfflineFocusTarget {
        bannerSpoken = reconnectReady
        return reconnectReady ? .banner : .cause
    }

    /// True when the banner appeared since the last call and has not been spoken yet.
    mutating func shouldAnnounceBanner(reconnectReady: Bool) -> Bool {
        guard reconnectReady else {
            bannerSpoken = false
            return false
        }
        guard !bannerSpoken else { return false }
        bannerSpoken = true
        return true
    }
}
