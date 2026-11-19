import XCTest
@testable import OmarchyDeck

final class AppVersionTests: XCTestCase {
    func testDisplayIncludesShortVersionAndBuild() {
        XCTAssertEqual(AppVersion.display(short: "1.0", build: "5"), "Version 1.0 (5)")
        XCTAssertEqual(AppVersion.display(short: "2.3.1", build: "42"), "Version 2.3.1 (42)")
    }

    func testDisplayFromMissingKeysUsesUnknown() {
        XCTAssertEqual(
            AppVersion.display(from: [
                "CFBundleShortVersionString": "1.1",
                "CFBundleVersion": "5",
            ]),
            "Version 1.1 (5)"
        )
        XCTAssertEqual(AppVersion.display(from: [:]), "Version Unknown (Unknown)")
        XCTAssertEqual(
            AppVersion.display(from: ["CFBundleVersion": "5"]),
            "Version Unknown (5)"
        )
        XCTAssertEqual(
            AppVersion.display(from: ["CFBundleShortVersionString": "1.1"]),
            "Version 1.1 (Unknown)"
        )
        XCTAssertEqual(
            AppVersion.display(from: [
                "CFBundleShortVersionString": 11,
                "CFBundleVersion": 5,
            ]),
            "Version Unknown (Unknown)"
        )
    }

    func testCopyrightNoticeIsExactAndHasNoLegalEntity() {
        XCTAssertEqual(AppCopyright.notice, "© 2026 thefiredev-cloud")
        XCTAssertFalse(AppCopyright.notice.contains("TheFire" + "Dev"))
        XCTAssertFalse(AppCopyright.notice.contains("LL" + "C"))
        XCTAssertFalse(AppCopyright.notice.lowercased().contains("db" + "a"))
    }

    func testBuiltAppIncludesEveryRequiredReasonDeclaration() throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "PrivacyInfo", withExtension: "xcprivacy"))
        let data = try Data(contentsOf: url)
        let manifest = try XCTUnwrap(try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
        let declarations = try XCTUnwrap(manifest["NSPrivacyAccessedAPITypes"] as? [[String: Any]])
        let reasons = Dictionary(uniqueKeysWithValues: try declarations.map { entry in
            (try XCTUnwrap(entry["NSPrivacyAccessedAPIType"] as? String),
             try XCTUnwrap(entry["NSPrivacyAccessedAPITypeReasons"] as? [String]))
        })
        XCTAssertEqual(reasons["NSPrivacyAccessedAPICategoryUserDefaults"], ["CA92.1"])
        XCTAssertEqual(reasons["NSPrivacyAccessedAPICategorySystemBootTime"], ["35F9.1"])
        XCTAssertEqual(reasons["NSPrivacyAccessedAPICategoryFileTimestamp"], ["DDA9.1"])
        XCTAssertEqual(manifest["NSPrivacyTracking"] as? Bool, false)
    }
}
