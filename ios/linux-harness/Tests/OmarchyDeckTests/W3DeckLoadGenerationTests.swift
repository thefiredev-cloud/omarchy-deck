import XCTest
@testable import OmarchyDeck

final class W3DeckLoadGenerationTests: XCTestCase {
    @MainActor
    private final class Clock {
        var pending: CheckedContinuation<Void, Never>?
        var entered: XCTestExpectation?

        func sleep(_ delay: UInt64) async throws {
            try Task.checkCancellation()
            await withCheckedContinuation { continuation in
                pending = continuation
                entered?.fulfill()
            }
        }

        func release() {
            let continuation = pending
            pending = nil
            continuation?.resume()
        }
    }

    @MainActor
    func testTimeoutClearsExpiredLoadBeforeStartingReplacement() async throws {
        let clock = Clock()
        let load = W3DeckLoadGeneration()
        let view = NSObject()
        clock.entered = expectation(description: "Expired load is waiting")

        var replacement: W3DeckLoadGeneration.Ticket?
        let expired = load.begin(in: view, sleep: clock.sleep) { _ in
            XCTAssertNil(load.active)
            XCTAssertNil(load.deadlineTask)
            replacement = load.begin(in: view, sleep: clock.sleep) { _ in
                XCTFail("Replacement load expired unexpectedly")
            }
        }
        let expiredTask = try XCTUnwrap(load.deadlineTask)
        await fulfillment(of: [try XCTUnwrap(clock.entered)], timeout: 1)

        clock.entered = expectation(description: "Replacement load is waiting")
        clock.release()
        await fulfillment(of: [try XCTUnwrap(clock.entered)], timeout: 1)
        await expiredTask.value

        let replacementTicket = try XCTUnwrap(replacement)
        XCTAssertFalse(load.accepts(ticket: expired, in: view))
        XCTAssertTrue(load.accepts(ticket: replacementTicket, in: view))

        let replacementTask = try XCTUnwrap(load.deadlineTask)
        load.cancel()
        clock.release()
        await replacementTask.value
    }

    @MainActor
    func testOnlyTheBoundNavigationOfTheActiveViewIsAccepted() {
        let load = W3DeckLoadGeneration()
        let view = NSObject()
        let navigation = NSObject()
        let ticket = load.begin(in: view) { _ in XCTFail("Load expired unexpectedly") }
        XCTAssertFalse(load.accepts(navigation: navigation, in: view), "Nothing is accepted before a navigation is bound")
        load.bind(navigation: navigation, to: ticket)
        XCTAssertTrue(load.accepts(navigation: navigation, in: view))
        XCTAssertFalse(load.accepts(navigation: NSObject(), in: view), "A different navigation is not this load")
        XCTAssertFalse(load.accepts(navigation: navigation, in: NSObject()), "Another view cannot complete this load")
        XCTAssertFalse(load.accepts(navigation: nil, in: view))
        load.cancel()
    }

    @MainActor
    func testStartingAnotherLoadRetiresTheOldTicketAndItsNavigation() {
        let load = W3DeckLoadGeneration()
        let view = NSObject()
        let navigation = NSObject()
        let old = load.begin(in: view) { _ in XCTFail("Replaced load expired") }
        load.bind(navigation: navigation, to: old)
        let replacement = load.begin(in: view) { _ in XCTFail("Replacement load expired unexpectedly") }
        XCTAssertNotEqual(old, replacement)
        XCTAssertFalse(load.accepts(ticket: old, in: view))
        XCTAssertTrue(load.accepts(ticket: replacement, in: view))
        XCTAssertFalse(load.accepts(navigation: navigation, in: view), "The old navigation cannot complete the replacement")
        load.cancel()
    }

    @MainActor
    func testStaleTicketCannotBindANavigationOntoTheReplacement() {
        let load = W3DeckLoadGeneration()
        let view = NSObject()
        let navigation = NSObject()
        let old = load.begin(in: view) { _ in XCTFail("Replaced load expired") }
        let replacement = load.begin(in: view) { _ in XCTFail("Replacement load expired unexpectedly") }
        load.bind(navigation: navigation, to: old)
        XCTAssertFalse(load.accepts(navigation: navigation, in: view))
        XCTAssertTrue(load.accepts(ticket: replacement, in: view))
        load.cancel()
    }

    @MainActor
    func testCancelForgetsTheTicketNavigationAndDeadline() {
        let load = W3DeckLoadGeneration()
        let view = NSObject()
        let navigation = NSObject()
        let ticket = load.begin(in: view) { _ in XCTFail("Cancelled load expired") }
        load.bind(navigation: navigation, to: ticket)
        load.cancel()
        XCTAssertNil(load.active)
        XCTAssertNil(load.deadlineTask)
        XCTAssertFalse(load.accepts(ticket: ticket, in: view))
        XCTAssertFalse(load.accepts(navigation: navigation, in: view))
    }

    @MainActor
    func testExpiredLoadExpiresOnceAndForgetsItsNavigation() async throws {
        let load = W3DeckLoadGeneration()
        let view = NSObject()
        let navigation = NSObject()
        var expired: [W3DeckLoadGeneration.Ticket] = []
        let ticket = load.begin(in: view, sleep: { _ in }) { expired.append($0) }
        load.bind(navigation: navigation, to: ticket)
        let deadline = try XCTUnwrap(load.deadlineTask)
        await deadline.value
        XCTAssertEqual(expired, [ticket])
        XCTAssertNil(load.active)
        XCTAssertFalse(load.accepts(navigation: navigation, in: view), "A late finish for the expired load is ignored")
    }
}
