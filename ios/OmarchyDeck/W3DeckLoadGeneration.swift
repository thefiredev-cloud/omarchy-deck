import Foundation

/// One bounded navigation. It holds no URL, request, cookie or credential.
@MainActor
final class W3DeckLoadGeneration {
    nonisolated static let timeoutNanoseconds: UInt64 = 30_000_000_000
    nonisolated static let timeoutReason = "The deck did not finish loading in time. Try again."

    struct Ticket: Equatable {
        fileprivate let generation: UInt64
        fileprivate let view: ObjectIdentifier
    }

    private(set) var active: Ticket?
    private(set) var deadlineTask: Task<Void, Never>?
    private var generation: UInt64 = 0
    private var navigation: AnyObject?

    deinit { deadlineTask?.cancel() }

    @discardableResult
    func begin(in view: AnyObject, timeoutNanoseconds: UInt64 = timeoutNanoseconds,
               sleep: @escaping @MainActor (UInt64) async throws -> Void = { try await Task.sleep(nanoseconds: $0) },
               onTimeout: @escaping @MainActor (Ticket) -> Void) -> Ticket {
        cancel()
        generation += 1
        let ticket = Ticket(generation: generation, view: ObjectIdentifier(view))
        active = ticket
        deadlineTask = Task { @MainActor [weak self] in
            do { try await sleep(timeoutNanoseconds) } catch { return }
            guard !Task.isCancelled, let self, self.active == ticket else { return }
            self.cancel()
            onTimeout(ticket)
        }
        return ticket
    }

    func bind(navigation: AnyObject?, to ticket: Ticket) {
        guard active == ticket else { return }
        self.navigation = navigation
    }

    func accepts(navigation: AnyObject?, in view: AnyObject) -> Bool {
        guard let active, active.view == ObjectIdentifier(view),
              let navigation, let expected = self.navigation else { return false }
        return navigation === expected
    }

    func accepts(ticket: Ticket, in view: AnyObject) -> Bool {
        active == ticket && ticket.view == ObjectIdentifier(view)
    }

    func cancel() {
        deadlineTask?.cancel()
        deadlineTask = nil
        navigation = nil
        active = nil
    }
}
