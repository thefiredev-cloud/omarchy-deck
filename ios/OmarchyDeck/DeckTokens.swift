import Foundation

/// The one token set every native screen draws from. Values mirror the web deck's design tokens v3 (2026-11-14,
/// pixel-deck `static/tokens.css`): a carbon ground, bone text in three levels, one signal accent, and status hues
/// used only for status. Foundation only, so the Linux harness checks contrast and the type floor without SwiftUI.
enum DeckTokens {
    /// One scheme's colors as 0xRRGGBB.
    struct Ramp: Equatable {
        /// The page. Dark equals the web `--c-ground`, so the launch screen, the web view and native screens match.
        let ground: UInt32
        /// A band one step up: bars, the sidebar.
        let bar: UInt32
        /// Cards and sheets.
        let raised: UInt32
        /// Selected rows, input fills, hover.
        let raised2: UInt32
        /// Hairline dividers. Decoration only, never the only edge of a control.
        let line: UInt32
        /// Control edges: 3:1 or better on every surface.
        let lineStrong: UInt32
        let text1: UInt32
        let text2: UInt32
        let text3: UInt32
        /// The one accent: where you are, the primary action, focus, the now marker.
        let signal: UInt32
        /// The accent used as text (deeper on light grounds so it holds 4.5:1).
        let signalText: UInt32
        /// Text and glyphs on a signal fill.
        let onSignal: UInt32
        let ok: UInt32
        let warn: UInt32
        let bad: UInt32
    }

    static let dark = Ramp(ground: 0x0A0B0D, bar: 0x111317, raised: 0x171A1F, raised2: 0x1F232A,
                           line: 0x2A2F37, lineStrong: 0x6E7784,
                           text1: 0xF1EFEA, text2: 0xB5B2AA, text3: 0x8F8C85,
                           signal: 0xFF6B1A, signalText: 0xFF6B1A, onSignal: 0x0A0B0D,
                           ok: 0x3DD68C, warn: 0xF2C230, bad: 0xFF5C77)

    /// Bone page and paper cards, ink text. The signal orange is under 3:1 on bone, so light uses its ink step.
    static let light = Ramp(ground: 0xF1EFEA, bar: 0xE8E5DE, raised: 0xFAF9F6, raised2: 0xE3DFD6,
                            line: 0xD8D4CB, lineStrong: 0x7A766D,
                            text1: 0x0A0B0D, text2: 0x3A3D43, text3: 0x5C5F66,
                            signal: 0xA93C05, signalText: 0xA93C05, onSignal: 0xFAF9F6,
                            ok: 0x12693F, warn: 0x765300, bad: 0xB0102D)

    static func ramp(light isLight: Bool) -> Ramp { isLight ? light : dark }

    // MARK: Contrast (WCAG 2.x)

    static func luminance(_ rgb: UInt32) -> Double {
        func linear(_ channel: UInt32) -> Double {
            let c = Double(channel & 0xff) / 255
            return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(rgb >> 16) + 0.7152 * linear(rgb >> 8) + 0.0722 * linear(rgb)
    }

    static func contrast(_ a: UInt32, _ b: UInt32) -> Double {
        let x = luminance(a), y = luminance(b)
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }
}

/// Dynamic Type text styles the scale is anchored to. Mirrors SwiftUI's `Font.TextStyle` without importing it.
enum DeckTextStyle: String, CaseIterable {
    case largeTitle, title, title2, title3, headline, body, callout, subheadline, footnote
}

/// The type scale. Geist for words, Geist Mono for figures, each size anchored to a text style so Dynamic Type
/// scales it (`Font.custom(_:size:relativeTo:)`). Nothing is smaller than 13 pt at the default text size.
enum DeckTypeRole: String, CaseIterable {
    /// The big page title.
    case display
    /// A section or sheet title.
    case title
    /// A card heading.
    case heading
    /// Running text.
    case body
    /// Secondary lines under a heading: places, reasons, small facts.
    case meta
    /// The smallest words: chips, axis labels, the freshness mark.
    case micro
    /// The one big number on a card or tile.
    case figure
    /// A number in a row.
    case figureRow
    /// Small numbers: counts on chips, axis values, table cells.
    case data

    struct Spec: Equatable {
        let size: Double
        let style: DeckTextStyle
        let mono: Bool
        /// 400 regular, 500 medium, 600 semibold, 700 bold.
        let weight: Int
    }

    static let floor: Double = 13

    var spec: Spec {
        switch self {
        case .display: return Spec(size: 32, style: .largeTitle, mono: false, weight: 600)
        case .title: return Spec(size: 22, style: .title2, mono: false, weight: 600)
        case .heading: return Spec(size: 19, style: .title3, mono: false, weight: 600)
        case .body: return Spec(size: 17, style: .body, mono: false, weight: 400)
        case .meta: return Spec(size: 15, style: .subheadline, mono: false, weight: 400)
        case .micro: return Spec(size: 13, style: .footnote, mono: false, weight: 500)
        case .figure: return Spec(size: 30, style: .title, mono: true, weight: 500)
        case .figureRow: return Spec(size: 18, style: .body, mono: true, weight: 500)
        case .data: return Spec(size: 14, style: .subheadline, mono: true, weight: 400)
        }
    }
}

/// The bundled font files. PostScript names, one file per weight (official Geist release v1.9.2, SIL OFL 1.1).
enum DeckFontFiles {
    static let sans: [Int: String] = [400: "Geist-Regular", 500: "Geist-Medium", 600: "Geist-SemiBold", 700: "Geist-Bold"]
    static let mono: [Int: String] = [400: "GeistMono-Regular", 500: "GeistMono-Medium", 600: "GeistMono-SemiBold"]

    /// The file for a weight: the nearest bundled weight at or below it, else the lightest.
    static func name(mono: Bool, weight: Int) -> String {
        let table = mono ? self.mono : sans
        let below = table.keys.filter { $0 <= weight }.max() ?? table.keys.min() ?? 400
        return table[below] ?? (mono ? "GeistMono-Regular" : "Geist-Regular")
    }

    /// Every file the Info.plist must register under `UIAppFonts`.
    static var all: [String] {
        (sans.values.sorted() + mono.values.sorted()).map { $0 + ".ttf" }
    }
}
