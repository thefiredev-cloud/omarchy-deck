import SwiftUI
import UIKit

/// The shell's palette is the web deck's palette (`DeckTokens`, tokens v3): a carbon ground, bone text, one signal
/// accent, and green, yellow and rose for status only. `bg` is the page: the launch screen, the web view,
/// `underPageBackgroundColor` and every native screen use it, so there is no seam or flash between shell and page.
enum DeckColors {
    static func ui(_ rgb: UInt32) -> UIColor {
        UIColor(red: CGFloat((rgb >> 16) & 0xff) / 255, green: CGFloat((rgb >> 8) & 0xff) / 255,
                blue: CGFloat(rgb & 0xff) / 255, alpha: 1)
    }

    private static let ramp = DeckTokens.dark

    // UIKit surfaces (web view, scroll view, refresh control) read these; SwiftUI reads the Color twins below.
    static let uiBackground = ui(ramp.ground)
    static let uiSignal = ui(ramp.signal)

    static let bg = Color(uiColor: uiBackground)
    /// Cards, fields, sheets: the step above `bg`.
    static let panel = Color(uiColor: ui(ramp.raised))
    /// Hairlines and card strokes. Not for a text field's only outline: see `fieldEdge`.
    static let line = Color(uiColor: ui(ramp.line))
    /// The outline of a text field: 3:1 against both `bg` and `panel` (WCAG 1.4.11).
    static let fieldEdge = Color(uiColor: ui(ramp.lineStrong))
    /// Text 1, 2 and 3.
    static let fg = Color(uiColor: ui(ramp.text1))
    static let dim = Color(uiColor: ui(ramp.text2))
    static let faint = Color(uiColor: ui(ramp.text3))
    /// The one accent.
    static let signal = Color(uiColor: uiSignal)
    /// Text and glyphs that sit on the signal fill.
    static let onSignal = Color(uiColor: ui(ramp.onSignal))
    /// Status only, always with a glyph and a word.
    static let ok = Color(uiColor: ui(ramp.ok))
    static let warn = Color(uiColor: ui(ramp.warn))
    static let bad = Color(uiColor: ui(ramp.bad))
}

/// Light and dark twins for the Feeds sheet, from the same token ramps. Dark is the deck's own; light is bone paper
/// and ink, with the signal deepened to its ink step so text and glyphs on it keep contrast.
enum FeedPalette {
    private static func dynamic(_ pick: @escaping (DeckTokens.Ramp) -> UInt32) -> Color {
        Color(uiColor: UIColor { DeckColors.ui(pick(DeckTokens.ramp(light: $0.userInterfaceStyle == .light))) })
    }

    static let bg = dynamic(\.ground)
    static let bar = dynamic(\.bar)
    static let raised = dynamic(\.raised)
    static let raised2 = dynamic(\.raised2)
    static let line = dynamic(\.line)
    static let lineStrong = dynamic(\.lineStrong)
    static let text1 = dynamic(\.text1)
    static let text2 = dynamic(\.text2)
    static let text3 = dynamic(\.text3)
    static let signal = dynamic(\.signal)
    static let signalText = dynamic(\.signalText)
    static let onSignal = dynamic(\.onSignal)
    static let ok = dynamic(\.ok)
    static let warn = dynamic(\.warn)
    static let bad = dynamic(\.bad)
}

extension FeedAppearance {
    var scheme: ColorScheme { self == .light ? .light : .dark }
}
