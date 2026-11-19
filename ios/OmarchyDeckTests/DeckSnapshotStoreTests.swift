import UIKit
import WebKit
import XCTest
@testable import OmarchyDeck

/// The last picture of a deck is private to that deck's origin.
@MainActor
final class DeckSnapshotStoreTests: XCTestCase {
    private let first = URL(string: "https://a.example.com/")!
    private let samePortOther = URL(string: "https://a.example.com:10443/")!
    private let other = URL(string: "https://b.example.com/")!
    private var directory: URL!

    override func setUp() {
        super.setUp()
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("DeckSnapshotStoreTests-\(UUID().uuidString)")
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
        super.tearDown()
    }

    private func jpeg(_ color: UIColor) throws -> Data {
        let image = UIGraphicsImageRenderer(size: CGSize(width: 24, height: 48)).image { context in
            color.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 24, height: 48))
        }
        return try XCTUnwrap(image.jpegData(compressionQuality: 0.7))
    }

    func testOnePicturePerOriginAndNeverAnotherOriginsPicture() throws {
        let store = DeckSnapshotStore(directory: directory)
        store.save(jpeg: try jpeg(.red), for: first, shape: .portrait)

        XCTAssertNotNil(store.image(for: first, shape: .portrait))
        XCTAssertNil(store.image(for: first, shape: .landscape))
        XCTAssertNil(store.image(for: other, shape: .portrait), "Another host must not find this deck's picture")
        XCTAssertNil(store.image(for: samePortOther, shape: .portrait), "Another port is another deck")
        XCTAssertEqual(store.snapshots(for: other).count, 0)

        let urls = Set(DeckSnapshotStore.Shape.allCases.flatMap { shape in
            [first, samePortOther, other].map { store.url(for: $0, shape: shape) }
        })
        XCTAssertEqual(urls.count, 6, "Every origin and shape has its own file")
        XCTAssertFalse(store.url(for: first, shape: .portrait).lastPathComponent.contains("example"),
                       "The file name is a hash, never the deck's address")
    }

    func testRemovingOneOriginKeepsTheOthers() throws {
        let store = DeckSnapshotStore(directory: directory)
        for origin in [first, other] {
            for shape in DeckSnapshotStore.Shape.allCases {
                store.save(jpeg: try jpeg(.blue), for: origin, shape: shape)
            }
        }
        store.remove(origin: first)
        XCTAssertEqual(store.snapshots(for: first).count, 0)
        XCTAssertEqual(store.snapshots(for: other).count, 2)
    }

    func testShapeFollowsTheViewSize() {
        XCTAssertEqual(DeckSnapshotStore.shape(of: CGSize(width: 440, height: 956)), .portrait)
        XCTAssertEqual(DeckSnapshotStore.shape(of: CGSize(width: 956, height: 440)), .landscape)
    }

    // MARK: Model

    private func model(selecting selected: URL, store: DeckSnapshotStore) throws -> (DeckModel, UserDefaults, String) {
        let suite = "DeckSnapshotStoreTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defaults.set([first.absoluteString, other.absoluteString], forKey: "deck.savedOrigins.v1")
        defaults.set(selected.absoluteString, forKey: "deck.selectedOrigin.v1")
        let model = DeckModel(defaults: defaults, startsAutomatically: false,
                              pro: ProEntitlement(startsAutomatically: false),
                              retryAction: {}, refreshOnActivation: {}, snapshots: store)
        return (model, defaults, suite)
    }

    /// The launch-picture preload runs off the main actor; wait for it instead of racing it.
    private func awaitLaunchSnapshots(_ deck: DeckModel,
                                      file: StaticString = #filePath,
                                      line: UInt = #line) async throws -> [DeckSnapshotStore.Shape: DeckSnapshotStore.Snapshot] {
        for _ in 0..<200 {
            if !deck.launchSnapshots.isEmpty { return deck.launchSnapshots }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTFail("Launch snapshots never loaded", file: file, line: line)
        return deck.launchSnapshots
    }

    func testSelectedDeckShowsOnlyItsOwnPicture() async throws {
        let store = DeckSnapshotStore(directory: directory)
        store.save(jpeg: try jpeg(.red), for: first, shape: .portrait)
        store.save(jpeg: try jpeg(.green), for: other, shape: .landscape)

        let (selectedFirst, defaultsA, suiteA) = try model(selecting: first, store: store)
        defer { defaultsA.removePersistentDomain(forName: suiteA) }
        let firstSnapshots = try await awaitLaunchSnapshots(selectedFirst)
        XCTAssertEqual(Set(firstSnapshots.keys), [.portrait])

        let (selectedOther, defaultsB, suiteB) = try model(selecting: other, store: store)
        defer { defaultsB.removePersistentDomain(forName: suiteB) }
        let otherSnapshots = try await awaitLaunchSnapshots(selectedOther)
        XCTAssertEqual(Set(otherSnapshots.keys), [.landscape])
    }

    /// The loading screen labels the picture with its age, so the date must survive a relaunch: it is the file's date.
    func testRelaunchedDeckKnowsWhenItsPictureWasSaved() async throws {
        let store = DeckSnapshotStore(directory: directory)
        store.save(jpeg: try jpeg(.red), for: first, shape: .portrait)
        let threeHoursAgo = Date(timeIntervalSinceNow: -3 * 3600)
        try FileManager.default.setAttributes([.modificationDate: threeHoursAgo],
                                              ofItemAtPath: store.url(for: first, shape: .portrait).path)

        let (deck, defaults, suite) = try model(selecting: first, store: store)
        defer { defaults.removePersistentDomain(forName: suite) }
        let launchSnapshots = try await awaitLaunchSnapshots(deck)
        let saved = try XCTUnwrap(launchSnapshots[.portrait]?.savedAt)
        XCTAssertEqual(saved.timeIntervalSince1970, threeHoursAgo.timeIntervalSince1970, accuracy: 1)
        XCTAssertEqual(SnapshotAge.label(savedAt: saved, now: Date()), "Picture from 3 h ago")
    }

    func testSigningOutDropsOnlyThatDecksPicture() throws {
        let store = DeckSnapshotStore(directory: directory)
        for origin in [first, other] { store.save(jpeg: try jpeg(.red), for: origin, shape: .portrait) }
        let (deck, defaults, suite) = try model(selecting: first, store: store)
        defer { defaults.removePersistentDomain(forName: suite) }

        deck.phase = .needsToken(notice: nil)
        XCTAssertTrue(deck.launchSnapshots.isEmpty)
        XCTAssertNil(store.image(for: first, shape: .portrait), "A signed-out deck keeps no picture of itself")
        XCTAssertNotNil(store.image(for: other, shape: .portrait), "Another deck's picture is untouched")
    }

    func testSignOutThenSwitchClearsCapturedOriginsPicturesAndCookiesOnly() async throws {
        let first = try XCTUnwrap(URL(string: "https://signedout.invalid/"))
        let other = try XCTUnwrap(URL(string: "https://retained.invalid/"))
        // Free's supported replacement changes selection while cleanup is suspended, without requiring
        // StoreKit in an injected XCTest host. Pro switching is separately exercised by ProConnectionUITests.
        let pro = ProEntitlement(startsAutomatically: false)

        let suite = "SnapshotSignOutRace.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let firstID = UUID(), otherID = UUID()
        defaults.set([first.absoluteString], forKey: "deck.savedOrigins.v1")
        defaults.set(first.absoluteString, forKey: "deck.selectedOrigin.v1")
        defaults.set([first.absoluteString: firstID.uuidString, other.absoluteString: otherID.uuidString],
                     forKey: "deck.originStoreIDs.v1")
        defaults.set(true, forKey: DeckModel.legacyMigrationKey(for: first))
        let snapshots = DeckSnapshotStore(directory: directory)
        var beganRemoval = false
        var resumeRemoval: CheckedContinuation<Void, Never>?
        let deck = DeckModel(defaults: defaults, pro: pro, snapshots: snapshots, sessionRemoval: { store in
            if !beganRemoval {
                beganRemoval = true
                await withCheckedContinuation { resumeRemoval = $0 }
            }
            await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
        })
        let prepared = await waitUntil { deck.webView != nil && deck.phase == .needsToken(notice: nil) }
        XCTAssertTrue(prepared)
        let firstStore = try XCTUnwrap(deck.webView?.configuration.websiteDataStore)
        let otherStore = WKWebsiteDataStore(forIdentifier: otherID)
        for (origin, store) in [(first, firstStore), (other, otherStore)] {
            let cookie = try XCTUnwrap(HTTPCookie(properties: [
                .name: "pdeck", .value: "snapshot-race-fixture-0000", .domain: origin.host!,
                .path: "/", .secure: "TRUE", .expires: Date().addingTimeInterval(3600)
            ]))
            await store.httpCookieStore.setCookie(cookie)
            for shape in DeckSnapshotStore.Shape.allCases {
                snapshots.save(jpeg: try jpeg(.green), for: origin, shape: shape)
            }
        }
        deck.phase = .ready
        let signingOut = Task { await deck.signOut() }
        let suspended = await waitUntil { beganRemoval }
        XCTAssertTrue(suspended)
        XCTAssertTrue(snapshots.snapshots(for: first).isEmpty,
                      "Sign-out must remove the captured origin's pictures before the cleanup await")
        XCTAssertTrue(deck.launchSnapshots.isEmpty)
        XCTAssertNil(deck.saveConnection(other.absoluteString, replacing: true))
        XCTAssertEqual(deck.selectedOrigin, other)
        resumeRemoval?.resume()
        await signingOut.value
        XCTAssertTrue(snapshots.snapshots(for: first).isEmpty, "A quick switch must not leave the signed-out deck's JPEGs")
        XCTAssertEqual(snapshots.snapshots(for: other).count, 2, "The newly selected deck keeps both of its pictures")
        let firstCookies = await firstStore.httpCookieStore.allCookies()
        let otherCookies = await otherStore.httpCookieStore.allCookies()
        XCTAssertFalse(firstCookies.contains { $0.name == "pdeck" })
        XCTAssertTrue(otherCookies.contains { $0.name == "pdeck" })
        XCTAssertEqual(deck.selectedOrigin, other, "Completion of the old sign-out must not change the new selection")
        deck.webView?.stopLoading()
    }

    /// Sign-out used to return early when no web view was alive, which left the signed-in cookie on disk.
    func testSignOutWipesTheSelectedDecksStoreWithoutALiveWebView() async throws {
        let origin = try XCTUnwrap(URL(string: "https://dormant.invalid/"))
        let suite = "SignOutWithoutView.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let identifier = UUID()
        defaults.set([origin.absoluteString], forKey: "deck.savedOrigins.v1")
        defaults.set(origin.absoluteString, forKey: "deck.selectedOrigin.v1")
        defaults.set([origin.absoluteString: identifier.uuidString], forKey: "deck.originStoreIDs.v1")
        defaults.set(true, forKey: DeckModel.legacyMigrationKey(for: origin))
        var wiped: [UUID?] = []
        let deck = DeckModel(defaults: defaults, startsAutomatically: false,
                             pro: ProEntitlement(startsAutomatically: false),
                             snapshots: DeckSnapshotStore(directory: directory),
                             sessionRemoval: { store in wiped.append(store.identifier) })
        XCTAssertEqual(deck.selectedOrigin, origin)
        XCTAssertNil(deck.webView, "This test covers the no-live-view state")

        await deck.signOut()

        XCTAssertEqual(wiped, [identifier], "Sign-out must wipe the selected origin's own store")
        XCTAssertEqual(deck.phase, .needsToken(notice: nil))
    }

    func testRemovingAnUnselectedDeckDeletesItsPictureAndKeepsTheSelectedOne() async throws {
        let store = DeckSnapshotStore(directory: directory)
        for origin in [first, other] { store.save(jpeg: try jpeg(.red), for: origin, shape: .portrait) }
        let (deck, defaults, suite) = try model(selecting: first, store: store)
        defer { defaults.removePersistentDomain(forName: suite) }
        _ = try await awaitLaunchSnapshots(deck)

        deck.removeConnection(other)
        XCTAssertNil(store.image(for: other, shape: .portrait))
        XCTAssertNotNil(store.image(for: first, shape: .portrait))
        XCTAssertEqual(Set(deck.launchSnapshots.keys), [.portrait])
    }

    func testFeedbackCountersMoveOnlyOnEnteringReadyAndOffline() throws {
        let store = DeckSnapshotStore(directory: directory)
        let (deck, defaults, suite) = try model(selecting: first, store: store)
        defer { defaults.removePersistentDomain(forName: suite) }

        deck.phase = .loading
        XCTAssertEqual(deck.readyCount, 0)
        deck.phase = .ready
        deck.phase = .ready
        XCTAssertEqual(deck.readyCount, 1, "A reload that finishes while ready is not a new arrival")
        deck.showOffline(reason: "x", probeHost: false)
        deck.showOffline(reason: "y", probeHost: false)
        XCTAssertEqual(deck.offlineCount, 1, "A second miss while offline is the same offline state")
        deck.phase = .ready
        XCTAssertEqual(deck.readyCount, 2)
    }
}
