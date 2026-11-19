import Foundation
import WatchConnectivity

/// The phone alone owns the network connection and authenticates every action.
/// Mirrors the watch side (`WatchModel`): the session delegate publishes on the main actor.
@MainActor
final class WatchBridge: NSObject, WCSessionDelegate {
    private let client: any DeckActionExecuting
    private let session: WCSession?
    /// The actions this device may run, for the role the deck reported (guests get no Lock).
    private let actions: @MainActor () -> [WatchAction]

    init(client: any DeckActionExecuting, session: WCSession? = WCSession.isSupported() ? .default : nil,
         actions: @escaping @MainActor () -> [WatchAction] = { WatchAction.available }) {
        self.client = client
        self.session = session
        self.actions = actions
        super.init()
        session?.delegate = self
        session?.activate()
    }

    // WCSession calls its delegate on a background queue, so these callbacks are nonisolated (as in `WatchModel`) and
    // hop to the main actor before they touch `session` or `actions`. A main-actor witness called off-queue is a data
    // race today and an isolation trap under Swift 6.
    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        guard state == .activated else { return }
        Task { @MainActor in self.publishActions() }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    /// The watch app can finish installing after the phone app launches, so publish again when the pairing changes.
    nonisolated func sessionWatchStateDidChange(_ session: WCSession) {
        Task { @MainActor in self.publishActions() }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in self.publishActions() }
    }

    /// Sends the current action list. Also called when the signed-in role changes.
    func publishActions() {
        guard let session, session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
        try? session.updateApplicationContext(WatchActionCodec.context(actions()))
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any],
                             replyHandler: @escaping ([String: Any]) -> Void) {
        guard let id = WatchActionCodec.actionID(from: message) else {
            replyHandler(WatchActionCodec.reply(error: WatchActionMessage.notAvailable))
            return
        }
        Task { @MainActor in
            do {
                try await client.runAction(id: id)
                replyHandler(WatchActionCodec.reply())
            } catch let error as WatchActionError {
                if case .message(let text) = error { replyHandler(WatchActionCodec.reply(error: text)) }
            } catch {
                replyHandler(WatchActionCodec.reply(error: WatchActionMessage.desktopUnavailable))
            }
        }
    }
}
