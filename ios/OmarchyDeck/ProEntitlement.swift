import Combine
import Foundation
import StoreKit

@MainActor
final class ProEntitlement: ObservableObject {
    static let productID = "net.meshchat.deck.pro"

    @Published private(set) var isPro = false
    @Published private(set) var product: Product?
    @Published private(set) var message: String?
    @Published private(set) var isWorking = false
    /// Whether the App Store price has arrived. The UI shows a calm placeholder until it does; it never reports an error at rest.
    @Published private(set) var catalog: Catalog = .loading

    enum Catalog: Equatable { case loading, ready, unavailable }

    private var updates: Task<Void, Never>?
    private var started = false
    private var refreshVersion = 0
    private var loadVersion = 0
    private let lookup: @MainActor () async throws -> Product?
    private let catalogTimeout: Duration

    /// How long the price may stay a placeholder before the card offers "Check again".
    nonisolated static let defaultCatalogTimeout: Duration = .seconds(12)

    /// Real connections start StoreKit on demand; the offline demo does not.
    /// `lookup` and `catalogTimeout` are test seams; the defaults ask the App Store.
    init(startsAutomatically: Bool = true,
         catalogTimeout: Duration = ProEntitlement.defaultCatalogTimeout,
         lookup: (@MainActor () async throws -> Product?)? = nil) {
        self.catalogTimeout = catalogTimeout
        self.lookup = lookup ?? {
            try await Product.products(for: [ProEntitlement.productID]).first { $0.type == .nonConsumable }
        }
        if startsAutomatically { start() }
    }

    func start() {
        guard !started else { return }
        started = true
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                guard case .verified(let transaction) = result,
                      transaction.productID == Self.productID,
                      transaction.productType == .nonConsumable else { continue }
                await self?.refresh()
                self?.message = nil
                await transaction.finish()
            }
        }
        Task { await refresh(); await loadProduct() }
    }
    deinit { updates?.cancel() }

    /// Never infer ownership from a purchase result or local preferences.
    func refresh() async {
        refreshVersion += 1
        let version = refreshVersion
        var ownsProduct = false
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result,
                  transaction.productID == Self.productID,
                  transaction.productType == .nonConsumable,
                  transaction.revocationDate == nil,
                  transaction.expirationDate == nil else { continue }
            ownsProduct = true
        }
        if version == refreshVersion { isPro = ownsProduct }
    }

    /// StoreKit can sit on a product request for minutes with a poor connection. The card must not show
    /// "Price loading" forever: after `catalogTimeout` it offers "Check again". A price that arrives later
    /// still replaces the placeholder. Only the newest request may change the state.
    func loadProduct() async {
        loadVersion += 1
        let version = loadVersion
        catalog = .loading
        let timeout = catalogTimeout
        let watchdog = Task { [weak self] in
            try? await Task.sleep(for: timeout)
            guard !Task.isCancelled, let self, self.loadVersion == version, self.catalog == .loading else { return }
            self.catalog = .unavailable
        }
        defer { watchdog.cancel() }
        do {
            let found = try await lookup()
            guard version == loadVersion else { return }
            product = found
            catalog = found == nil ? .unavailable : .ready
            if found != nil { message = nil }
        } catch {
            guard version == loadVersion else { return }
            product = nil
            catalog = .unavailable
        }
    }

    func buy() async {
        guard let product, !isWorking else {
            message = "Pro is still loading. Try again in a moment."
            return
        }
        isWorking = true
        defer { isWorking = false }
        do {
            switch try await product.purchase() {
            case .success(let result):
                guard case .verified(let transaction) = result,
                      transaction.productID == Self.productID,
                      transaction.productType == .nonConsumable,
                      transaction.revocationDate == nil else {
                    message = "The purchase could not be verified. No Pro access was granted."
                    await refresh()
                    return
                }
                await transaction.finish()
                await refresh()
                message = isPro ? "Pro is active." : "The App Store has not confirmed Pro for this Apple Account yet."
            case .pending:
                message = "The purchase is pending approval. Pro unlocks when the App Store confirms it."
            case .userCancelled:
                message = "Purchase cancelled. Your deck is unchanged."
            @unknown default:
                message = "The App Store did not complete the purchase."
            }
        } catch {
            message = Self.purchaseFailureMessage(for: error)
            await refresh()
        }
    }

    func restore() async {
        guard !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            try await AppStore.sync()
            await refresh()
            message = isPro ? "Pro is restored." : "No active Pro purchase was found for this Apple Account."
        } catch {
            await refresh()
            message = isPro ? "Pro is restored." : Self.restoreFailureMessage(for: error)
        }
    }

    /// Closing the Apple Account sheet is a choice, not a network failure. Say which one happened.
    nonisolated static func restoreFailureMessage(for error: Error) -> String {
        switch error as? StoreKitError {
        case .userCancelled: "Restore cancelled. Your deck is unchanged."
        case .networkError: "Could not reach the App Store. Check your connection, then tap Restore purchases."
        default: "The App Store could not restore purchases right now. Try again later."
        }
    }

    nonisolated static func purchaseFailureMessage(for error: Error) -> String {
        switch error as? StoreKitError {
        case .userCancelled: "Purchase cancelled. Your deck is unchanged."
        case .networkError: "Could not reach the App Store. Check your connection, then try again."
        default: "The purchase did not go through. Try again later."
        }
    }
}
