import Foundation

struct WatchAction: Equatable, Identifiable {
    let id: String
    let label: String

    /// Workspaces the Deck server accepts on `/api/ws` (1 to 5 only; see its allowlist).
    static let workspaceNumbers = [1, 2, 3, 4, 5]

    static let available: [WatchAction] = {
        var rows = [
            WatchAction(id: "play-pause", label: "Play or pause"),
            WatchAction(id: "mute", label: "Mute or unmute"),
            WatchAction(id: "lock", label: "Lock computer")
        ]
        for number in workspaceNumbers {
            rows.append(WatchAction(id: "ws-\(number)", label: "Switch to desktop \(number)"))
        }
        return rows
    }()

    /// Actions the deck refuses for a guest token (pixel-deck `guest.rs` allowlist): Lock is owner only.
    static let ownerOnlyIDs: Set<String> = ["lock"]

    /// What the watch offers. A guest never sees an action the deck will refuse; an unknown role keeps the full list,
    /// and the phone still turns a refusal into `WatchActionMessage.notAllowed`.
    static func available(guest: Bool) -> [WatchAction] {
        guest ? available.filter { !ownerOnlyIDs.contains($0.id) } : available
    }

    static func label(for id: String) -> String {
        available.first { $0.id == id }?.label ?? "Action"
    }
}

/// The one fixed Deck server request each watch action may run. Nothing else is ever built from watch input.
struct WatchActionEndpoint: Equatable {
    let path: String
    let query: [String: String]

    static func forAction(_ id: String) -> WatchActionEndpoint? {
        switch id {
        case "play-pause": return .init(path: "/api/media-act", query: ["v": "play-pause"])
        case "mute": return .init(path: "/api/mute", query: [:])
        case "lock": return .init(path: "/api/lock", query: [:])
        default:
            let parts = id.split(separator: "-")
            guard parts.count == 2, parts[0] == "ws", let number = Int(parts[1]),
                  WatchAction.workspaceNumbers.contains(number), id == "ws-\(number)" else { return nil }
            return .init(path: "/api/ws", query: ["v": String(number)])
        }
    }
}

enum WatchActionCodec {
    static func context(_ actions: [WatchAction]) -> [String: Any] {
        ["actions": actions.map { ["id": $0.id, "label": $0.label] }]
    }

    static func actions(from context: [String: Any]) -> [WatchAction] {
        guard let rows = context["actions"] as? [[String: String]] else { return [] }
        return rows.compactMap { row in
            guard let id = row["id"], let label = row["label"],
                  WatchAction.available.contains(where: { $0.id == id && $0.label == label }) else { return nil }
            return WatchAction(id: id, label: label)
        }
    }

    static func request(id: String) -> [String: Any] { ["type": "runAction", "id": id] }

    static func actionID(from message: [String: Any]) -> String? {
        guard message.count == 2, message["type"] as? String == "runAction", let id = message["id"] as? String,
              WatchAction.available.contains(where: { $0.id == id }) else { return nil }
        return id
    }

    static func reply(error: String? = nil) -> [String: Any] {
        if let error { return ["ok": false, "error": error] }
        return ["ok": true]
    }

    static func result(from reply: [String: Any]) -> Result<Void, WatchActionError> {
        if reply["ok"] as? Bool == true { return .success(()) }
        return .failure(.message(reply["error"] as? String ?? "The iPhone could not run this action. Try again."))
    }
}

enum WatchActionError: Error, Equatable {
    case message(String)
}

/// Phone-side failure text. The watch matches these exact strings to tell a Deck that is not connected from other failures.
enum WatchActionMessage {
    static let openDeck = "Open Omarchy Deck on your iPhone, then try again."
    static let signIn = "Sign in on your iPhone, then try again."
    static let desktopNoResponse = "The desktop did not respond. Try again."
    static let desktopUnavailable = "The desktop is unavailable. Try again."
    static let notAvailable = "That action is not available. Update Omarchy Deck on your iPhone."
    /// The deck answered 403: this device's token (a guest) may not run that action.
    static let notAllowed = "Not allowed for this device."
    static let desktopFailed = "The desktop could not run this action. Try again."

    /// The watch line for a non-200 answer from the deck. 401 means sign in again; 403 means this device's token
    /// (a guest) may not run that action, so trying again will not help.
    static func failure(status: Int) -> String {
        switch status {
        case 401: signIn
        case 403: notAllowed
        default: desktopFailed
        }
    }
    static let notNearby = "Your iPhone is not nearby. Open Omarchy Deck on your iPhone, then try again."
    static let deckNotConnected = "Your desktop is not connected to Omarchy Deck. Open Omarchy Deck on your iPhone, then try again."
    static let deckOfflineReasons: Set<String> = [openDeck, desktopNoResponse, desktopUnavailable]
}

/// What the watch shows for one action request.
enum WatchDeckStatus: Equatable {
    case idle
    case phoneUnreachable
    case deckOffline
    case sending(String)
    case done(String)
    case failed(String, reason: String)

    /// Whether the machine starts a request right now. An unreachable phone refuses until reachability returns.
    var acceptsRequest: Bool {
        switch self {
        case .sending, .phoneUnreachable: false
        case .idle, .deckOffline, .done, .failed: true
        }
    }

    /// True only while a request is in flight. Every other state, including an unreachable phone, leaves the buttons tappable.
    /// A tap re-reads reachability first, so a timeout never locks the owner out of retrying.
    var isSending: Bool {
        if case .sending = self { return true }
        return false
    }

    /// The one line the watch shows for this state. Done and failures name the action.
    var line: String {
        switch self {
        case .idle: "Confirm each action before it runs."
        case .phoneUnreachable: WatchActionMessage.notNearby
        case .deckOffline: WatchActionMessage.deckNotConnected
        case .sending(let id): "Sending \(WatchAction.label(for: id)) to iPhone..."
        case .done(let id): "Done: \(WatchAction.label(for: id))."
        case .failed(let id, let reason): "\(WatchAction.label(for: id)) did not run. \(reason)"
        }
    }

    /// Spoken once when a request ends. Nil for idle and in-flight states.
    var announcement: String? {
        switch self {
        case .idle, .sending: nil
        case .phoneUnreachable, .deckOffline, .done, .failed: line
        }
    }
}

/// Pure transitions for the watch. WatchModel adds WatchConnectivity, the timer and haptics.
/// Each request gets a token; replies and timeouts for an older token are ignored.
struct WatchDeckMachine: Equatable {
    static let responseTimeout: TimeInterval = 8

    private(set) var status: WatchDeckStatus = .idle
    private(set) var token = 0

    /// Returns the token to send with, or nil when a request is in flight or the phone is unreachable.
    mutating func start(_ id: String) -> Int? {
        guard status.acceptsRequest else { return nil }
        token += 1
        status = .sending(id)
        return token
    }

    mutating func replied(_ result: Result<Void, WatchActionError>, token reply: Int) {
        guard reply == token, case .sending(let id) = status else { return }
        switch result {
        case .success:
            status = .done(id)
        case .failure(.message(let text)):
            status = WatchActionMessage.deckOfflineReasons.contains(text) ? .deckOffline : .failed(id, reason: text)
        }
    }

    /// The reply timed out, or WatchConnectivity could not deliver the message.
    mutating func undelivered(token reply: Int) {
        guard reply == token, case .sending = status else { return }
        status = .phoneUnreachable
    }

    mutating func reachability(_ reachable: Bool) {
        if !reachable {
            status = .phoneUnreachable
        } else if status == .phoneUnreachable {
            status = .idle
        }
    }
}

@MainActor
protocol DeckActionExecuting {
    func runAction(id: String) async throws
}
