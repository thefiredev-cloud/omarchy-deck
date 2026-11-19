import StoreKit
import XCTest
@testable import OmarchyDeck

/// The Pro card's price never stays a placeholder forever, and StoreKit failures are worded by cause.
@MainActor
final class ProCatalogTests: XCTestCase {
    private struct Offline: Error {}
    @MainActor private final class Counter { var calls = 0 }

    func testHungCatalogRequestOffersCheckAgain() async throws {
        let pro = ProEntitlement(startsAutomatically: false, catalogTimeout: .milliseconds(50)) {
            try await Task.sleep(for: .seconds(30))
            return nil
        }
        let load = Task { await pro.loadProduct() }
        XCTAssertEqual(pro.catalog, .loading)
        for _ in 0..<100 where pro.catalog == .loading { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertEqual(pro.catalog, .unavailable, "A hung StoreKit request must fall back to Check again")
        load.cancel()
        await load.value
        XCTAssertEqual(pro.catalog, .unavailable)
    }

    func testFailedOrEmptyCatalogIsUnavailable() async {
        let failing = ProEntitlement(startsAutomatically: false) { throw Offline() }
        await failing.loadProduct()
        XCTAssertEqual(failing.catalog, .unavailable)
        XCTAssertNil(failing.product)

        let empty = ProEntitlement(startsAutomatically: false) { nil }
        await empty.loadProduct()
        XCTAssertEqual(empty.catalog, .unavailable)
    }

    func testOnlyTheNewestCatalogRequestChangesState() async throws {
        let counter = Counter()
        let pro = ProEntitlement(startsAutomatically: false, catalogTimeout: .seconds(30)) {
            counter.calls += 1
            if counter.calls == 1 {
                // The first request fails late, after "Check again" started a newer one.
                try await Task.sleep(for: .milliseconds(150))
                throw Offline()
            }
            try await Task.sleep(for: .seconds(30))
            return nil
        }
        let first = Task { await pro.loadProduct() }
        try await Task.sleep(for: .milliseconds(20))
        let second = Task { await pro.loadProduct() }
        await first.value
        XCTAssertEqual(pro.catalog, .loading, "A stale failure must not replace the newer request's state")
        second.cancel()
        await second.value
    }

    func testStoreKitFailuresAreWordedByCause() {
        XCTAssertEqual(ProEntitlement.restoreFailureMessage(for: StoreKitError.userCancelled),
                       "Restore cancelled. Your deck is unchanged.")
        XCTAssertEqual(ProEntitlement.restoreFailureMessage(for: StoreKitError.networkError(URLError(.notConnectedToInternet))),
                       "Could not reach the App Store. Check your connection, then tap Restore purchases.")
        XCTAssertEqual(ProEntitlement.restoreFailureMessage(for: Offline()),
                       "The App Store could not restore purchases right now. Try again later.")
        XCTAssertEqual(ProEntitlement.purchaseFailureMessage(for: StoreKitError.userCancelled),
                       "Purchase cancelled. Your deck is unchanged.")
        XCTAssertEqual(ProEntitlement.purchaseFailureMessage(for: StoreKitError.networkError(URLError(.timedOut))),
                       "Could not reach the App Store. Check your connection, then try again.")
    }
}
