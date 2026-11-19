import XCTest
@testable import OmarchyDeck

/// The offline screen titles by cause, never by a raw status code. The reason strings below are the
/// exact sentences `DeckModel` produces (`describe(_:)`, the HTTP >= 500 branch and the rule-list failure).
final class OfflineCauseTests: XCTestCase {
    func testEveryDeckModelReasonMapsToAHumanCause() {
        let cases: [(String, OfflineCause)] = [
            ("This device has no network connection.", .noNetwork),
            ("The deck server name did not resolve.", .unreachable),
            ("The deck did not answer in time.", .unreachable),
            ("The deck refused the connection.", .unreachable),
            ("The secure connection to the deck failed.", .secureConnection),
            ("Network error -1005.", .unreachable),
            ("The deck server returned HTTP 503.", .serverError),
            ("The deck server returned HTTP 500.", .serverError),
            ("The deck server returned HTTP 401.", .signInExpired),
            ("The deck server returned HTTP 403.", .signInExpired),
            ("Could not limit the app to this deck's address.", .deviceProblem),
            (OfflineCause.tailscaleReason, .tailscaleOff),
        ]
        for (reason, expected) in cases {
            XCTAssertEqual(OfflineCause(reason: reason), expected, reason)
        }
    }

    func testCausesAreNamedAndNeverShowARawStatusCode() {
        XCTAssertEqual(OfflineCause(reason: "The deck server returned HTTP 503.").title, "Your deck hit a problem")
        XCTAssertEqual(OfflineCause(reason: "The deck refused the connection.").title, "Can't reach your deck")
        XCTAssertEqual(OfflineCause(reason: "The deck server returned HTTP 401.").title, "Sign in again")
        XCTAssertEqual(Set(OfflineCause.allCases.map(\.title)).count, OfflineCause.allCases.count,
                       "Each cause needs its own title")
        for cause in OfflineCause.allCases {
            XCTAssertFalse(cause.title.contains("HTTP"), cause.title)
            XCTAssertFalse(cause.guidance.contains("HTTP "), cause.guidance)
            XCTAssertFalse(cause.guidance.isEmpty)
        }
    }

    /// I12: a `.ts.net` deck whose name does not resolve means Tailscale is off on this device.
    func testTailnetNameFailureSaysTurnOnTailscale() {
        for host in ["pc-desktop.example.ts.net", "PC-Desktop.Example.TS.NET", "deck.example.ts.net."] {
            let reason = OfflineCause.nameDidNotResolveReason(host: host)
            XCTAssertEqual(reason, OfflineCause.tailscaleReason, host)
            let cause = OfflineCause(reason: reason)
            XCTAssertEqual(cause, .tailscaleOff, host)
            XCTAssertEqual(cause.title, "Turn on Tailscale on this device")
            XCTAssertTrue(cause.guidance.contains("Tailscale"), cause.guidance)
            XCTAssertTrue(cause.guidance.contains("Retry"), cause.guidance)
        }
        // Any other host, or no host, keeps the plain sentence and the generic unreachable cause.
        for host in ["deck.example.com", "ts.net.example.com", "notts.net.example", nil] as [String?] {
            let reason = OfflineCause.nameDidNotResolveReason(host: host)
            XCTAssertEqual(reason, "The deck server name did not resolve.", String(describing: host))
            XCTAssertEqual(OfflineCause(reason: reason), .unreachable, String(describing: host))
        }
    }

    /// The certificate sentence must stay true for expired, failed-handshake and client-certificate errors too,
    /// so it says the secure connection failed instead of claiming the device does not trust the certificate.
    func testSecureConnectionGuidanceCoversEveryCertificateFailure() {
        XCTAssertEqual(OfflineCause(reason: "The secure connection to the deck failed."), .secureConnection)
        let guidance = OfflineCause.secureConnection.guidance
        XCTAssertTrue(guidance.contains("secure connection"), guidance)
        XCTAssertTrue(guidance.contains("security certificate"), guidance)
        XCTAssertTrue(guidance.contains("Retry"), guidance)
        XCTAssertFalse(guidance.contains("trust"), guidance)
    }
}
