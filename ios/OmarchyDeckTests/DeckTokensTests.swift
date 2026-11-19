import Foundation
import XCTest
@testable import OmarchyDeck

/// One token set for every native screen, equal to the web deck's tokens v3. Text holds 4.5:1 on every surface it sits
/// on in both schemes, control edges and the signal hold 3:1, nothing in the type scale is under 13 pt, and the font
/// files the scale names are the ones the app bundles and registers.
final class DeckTokensTests: XCTestCase {
    func testDarkGroundEqualsTheWebGroundAndTheLaunchColor() throws {
        XCTAssertEqual(DeckTokens.dark.ground, 0x0A0B0D)
        XCTAssertEqual(DeckTokens.dark.signal, 0xFF6B1A)
        let root = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath().deletingLastPathComponent().deletingLastPathComponent()
        let launch = try String(contentsOf: root.appendingPathComponent("OmarchyDeck/Assets.xcassets/LaunchBackground.colorset/Contents.json"),
                                encoding: .utf8)
        XCTAssertTrue(launch.contains(#""red":"0x0A","green":"0x0B","blue":"0x0D""#), "the launch screen is the web ground: no flash")
    }

    func testTextMeetsAAOnEverySurfaceInBothSchemes() {
        for (scheme, ramp) in [("dark", DeckTokens.dark), ("light", DeckTokens.light)] {
            for (surfaceName, surface) in [("ground", ramp.ground), ("bar", ramp.bar), ("raised", ramp.raised), ("raised2", ramp.raised2)] {
                for (textName, text) in [("text1", ramp.text1), ("text2", ramp.text2), ("text3", ramp.text3),
                                         ("signalText", ramp.signalText)] {
                    let ratio = DeckTokens.contrast(text, surface)
                    XCTAssertGreaterThanOrEqual(ratio, 4.5, "\(textName) on \(surfaceName) in \(scheme): \(ratio)")
                }
                for (name, status) in [("ok", ramp.ok), ("warn", ramp.warn), ("bad", ramp.bad)] where surfaceName != "raised2" {
                    XCTAssertGreaterThanOrEqual(DeckTokens.contrast(status, surface), 4.5, "\(name) on \(surfaceName) in \(scheme)")
                }
            }
            XCTAssertGreaterThanOrEqual(DeckTokens.contrast(ramp.onSignal, ramp.signal), 4.5, "label on the signal fill in \(scheme)")
        }
    }

    func testControlEdgesAndTheSignalMeetNonTextContrast() {
        for (scheme, ramp) in [("dark", DeckTokens.dark), ("light", DeckTokens.light)] {
            for surface in [ramp.ground, ramp.bar, ramp.raised, ramp.raised2] {
                XCTAssertGreaterThanOrEqual(DeckTokens.contrast(ramp.lineStrong, surface), 3, "control edge in \(scheme)")
                XCTAssertGreaterThanOrEqual(DeckTokens.contrast(ramp.signal, surface), 3, "signal in \(scheme)")
            }
        }
    }

    func testTypeScaleHasNothingUnderThirteenPointsAndBeatsTheOldBody() {
        for role in DeckTypeRole.allCases {
            XCTAssertGreaterThanOrEqual(role.spec.size, DeckTypeRole.floor, "\(role) is under 13 pt")
        }
        XCTAssertGreaterThanOrEqual(DeckTypeRole.body.spec.size, 17, "body text is larger than the old 15 pt subheadline")
        XCTAssertTrue(DeckTypeRole.figure.spec.mono && DeckTypeRole.data.spec.mono && DeckTypeRole.figureRow.spec.mono,
                      "figures are Geist Mono")
        XCTAssertFalse(DeckTypeRole.body.spec.mono)
    }

    func testFontFilesAreBundledRegisteredAndLicensed() throws {
        let root = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath().deletingLastPathComponent().deletingLastPathComponent()
        let fonts = root.appendingPathComponent("OmarchyDeck/Fonts")
        for file in DeckFontFiles.all {
            XCTAssertTrue(FileManager.default.fileExists(atPath: fonts.appendingPathComponent(file).path), "\(file) is bundled")
        }
        let license = try String(contentsOf: fonts.appendingPathComponent("OFL-Geist.txt"), encoding: .utf8)
        XCTAssertTrue(license.contains("SIL OPEN FONT LICENSE Version 1.1"))
        let plist = try Data(contentsOf: root.appendingPathComponent("OmarchyDeck/Info.plist"))
        let info = try XCTUnwrap(try PropertyListSerialization.propertyList(from: plist, format: nil) as? [String: Any])
        XCTAssertEqual(Set(info["UIAppFonts"] as? [String] ?? []), Set(DeckFontFiles.all))
        let spec = try String(contentsOf: root.appendingPathComponent("project.yml"), encoding: .utf8)
        for file in DeckFontFiles.all { XCTAssertTrue(spec.contains("- \(file)"), "project.yml registers \(file)") }
    }

    func testWeightsPickTheNearestBundledFile() {
        XCTAssertEqual(DeckFontFiles.name(mono: false, weight: 600), "Geist-SemiBold")
        XCTAssertEqual(DeckFontFiles.name(mono: false, weight: 650), "Geist-SemiBold")
        XCTAssertEqual(DeckFontFiles.name(mono: true, weight: 700), "GeistMono-SemiBold")
        XCTAssertEqual(DeckFontFiles.name(mono: true, weight: 300), "GeistMono-Regular")
    }
}
