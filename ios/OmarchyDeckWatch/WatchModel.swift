import Foundation
import SwiftUI
import WatchConnectivity
import WatchKit

@MainActor
final class WatchModel: NSObject, ObservableObject {
    @Published private(set) var actions: [WatchAction] = []
    @Published private(set) var status: WatchDeckStatus = .idle
    private var machine = WatchDeckMachine()
    private var timeout: Task<Void, Never>?
    private let session: WCSession?

    override init() {
        session = WCSession.isSupported() ? .default : nil
        super.init()
        session?.delegate = self
        session?.activate()
        refresh()
    }

    func refresh() {
        actions = Self.actionList(from: session?.receivedApplicationContext ?? [:])
        apply { $0.reachability(session?.isReachable ?? false) }
    }

    /// The action set is fixed and the iPhone checks every request, so the list shows before the first sync arrives.
    private static func actionList(from context: [String: Any]) -> [WatchAction] {
        let synced = WatchActionCodec.actions(from: context)
        return synced.isEmpty ? WatchAction.available : synced
    }

    func run(_ id: String) {
        refresh()
        var token: Int?
        apply { token = $0.start(id) }
        guard let token else { return }
        guard let session else {
            apply { $0.undelivered(token: token) }
            return
        }
        timeout = Task { [weak self] in
            try? await Task.sleep(for: .seconds(WatchDeckMachine.responseTimeout))
            guard !Task.isCancelled else { return }
            self?.apply { $0.undelivered(token: token) }
        }
        session.sendMessage(WatchActionCodec.request(id: id), replyHandler: { [weak self] reply in
            Task { @MainActor in self?.apply { $0.replied(WatchActionCodec.result(from: reply), token: token) } }
        }, errorHandler: { [weak self] _ in
            Task { @MainActor in self?.apply { $0.undelivered(token: token) } }
        })
    }

    /// Publishes the new status. Only the transition that ends an in-flight request cancels the timer, buzzes and announces the result once.
    private func apply(_ change: (inout WatchDeckMachine) -> Void) {
        let wasSending = status.isSending
        change(&machine)
        status = machine.status
        guard wasSending, !status.isSending else { return }
        timeout?.cancel()
        timeout = nil
        if case .done = status {
            WKInterfaceDevice.current().play(.success)
        } else {
            WKInterfaceDevice.current().play(.failure)
        }
        if let announcement = status.announcement {
            AccessibilityNotification.Announcement(announcement).post()
        }
    }
}

extension WatchModel: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        Task { @MainActor in self.refresh() }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
        Task { @MainActor in self.actions = WatchModel.actionList(from: context) }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in self.refresh() }
    }
}
