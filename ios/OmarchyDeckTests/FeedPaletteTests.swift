import Foundation
import SwiftUI
import XCTest
@testable import OmarchyDeck

/// The Feeds palette resolves the token ramps through SwiftUI in both schemes, so this runs on the Mini, not on the
/// Linux harness (DeckTokensTests checks the raw ramps there). Text holds 4.5:1 on the page and on cards; the signal
/// and control edges hold 3:1.
final class FeedPaletteTests: XCTestCase {
    private func resolved(_ color: Color, _ scheme: ColorScheme) -> (r: Double, g: Double, b: Double) {
        var environment = EnvironmentValues()
        environment.colorScheme = scheme
        let value = color.resolve(in: environment)
        return (Double(value.red), Double(value.green), Double(value.blue))
    }

    private func luminance(_ color: (r: Double, g: Double, b: Double)) -> Double {
        func linear(_ channel: Double) -> Double {
            channel <= 0.03928 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)
    }

    private func contrast(_ foreground: Color, _ background: Color, _ scheme: ColorScheme) -> Double {
        let a = luminance(resolved(foreground, scheme))
        let b = luminance(resolved(background, scheme))
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }

    func testTextMeetsAAOnPageAndCardsInBothSchemes() {
        let texts = [("text1", FeedPalette.text1), ("text2", FeedPalette.text2), ("text3", FeedPalette.text3),
                     ("signalText", FeedPalette.signalText), ("ok", FeedPalette.ok), ("warn", FeedPalette.warn)]
        for scheme in [ColorScheme.light, .dark] {
            for (textName, text) in texts {
                for (surfaceName, surface) in [("bg", FeedPalette.bg), ("raised", FeedPalette.raised)] {
                    let ratio = contrast(text, surface, scheme)
                    XCTAssertGreaterThanOrEqual(ratio, 4.5, "\(textName) on \(surfaceName) in \(scheme): \(ratio)")
                }
            }
        }
    }

    func testSignalAndControlEdgesMeetNonTextContrast() {
        for scheme in [ColorScheme.light, .dark] {
            XCTAssertGreaterThanOrEqual(contrast(FeedPalette.signal, FeedPalette.bg, scheme), 3.0)
            XCTAssertGreaterThanOrEqual(contrast(FeedPalette.lineStrong, FeedPalette.raised, scheme), 3.0)
            XCTAssertGreaterThanOrEqual(contrast(FeedPalette.onSignal, FeedPalette.signal, scheme), 4.5)
        }
    }

    func testDarkIsTheWebGroundAndLightIsBone() {
        XCTAssertLessThan(luminance(resolved(FeedPalette.bg, .dark)), 0.01)
        XCTAssertGreaterThan(luminance(resolved(FeedPalette.bg, .light)), 0.8)
        let ground = resolved(FeedPalette.bg, .dark)
        XCTAssertEqual([ground.r, ground.g, ground.b].map { Int(($0 * 255).rounded()) }, [0x0a, 0x0b, 0x0d])
    }
}
