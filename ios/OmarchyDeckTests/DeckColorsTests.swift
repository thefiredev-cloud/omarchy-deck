import SwiftUI
import UIKit
import XCTest
@testable import OmarchyDeck

/// The shell palette is the web palette (tokens v3, `DeckTokens`). Warn has its own hue so a warning is never the
/// same colour as the signal accent.
final class DeckColorsTests: XCTestCase {
    private func rgb(_ color: UIColor) -> [Int] {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        return [r, g, b].map { Int(($0 * 255).rounded()) }
    }

    func testWarnIsItsOwnHueAndTheSignalIsTheOneAccent() {
        XCTAssertEqual(rgb(UIColor(DeckColors.warn)), [0xf2, 0xc2, 0x30])
        XCTAssertEqual(rgb(DeckColors.uiSignal), [0xff, 0x6b, 0x1a])
        XCTAssertNotEqual(rgb(UIColor(DeckColors.warn)), rgb(DeckColors.uiSignal))
    }

    func testBackgroundMatchesTheWebGround() {
        XCTAssertEqual(rgb(DeckColors.uiBackground), [0x0a, 0x0b, 0x0d])
    }

    private func luminance(_ color: UIColor) -> Double {
        func linear(_ channel: Double) -> Double {
            channel <= 0.03928 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4)
        }
        let c = rgb(color).map { linear(Double($0) / 255) }
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }

    private func contrast(_ a: Color, _ b: Color) -> Double {
        let x = luminance(UIColor(a)), y = luminance(UIColor(b))
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }

    /// A text field's outline is its only boundary, so it needs the 3:1 non-text ratio (WCAG 1.4.11) on the page and on a card.
    func testFieldEdgeMeetsNonTextContrastOnBackgroundAndPanel() {
        XCTAssertGreaterThanOrEqual(contrast(DeckColors.fieldEdge, DeckColors.bg), 3.0)
        XCTAssertGreaterThanOrEqual(contrast(DeckColors.fieldEdge, DeckColors.panel), 3.0)
    }
}
