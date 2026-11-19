import SwiftUI
import UIKit

/// 8 pt grid. Every padding, gap and height in the native screens comes from here.
enum DeckSpace {
    static let xs: CGFloat = 4
    static let s: CGFloat = 8
    static let m: CGFloat = 16
    static let l: CGFloat = 24
    static let xl: CGFloat = 32
    /// Apple's minimum tap target is 44 pt. Controls use 48 so they sit on the grid.
    static let control: CGFloat = 48
    static let minTap: CGFloat = 44
    /// Readable column width on iPad and landscape.
    static let column: CGFloat = 520
}

/// Geist and Geist Mono at the `DeckTypeRole` sizes, each anchored to its text style so Dynamic Type scales it. A font
/// file that failed to register falls back to the system font of the same style, weight and design.
enum DeckFont {
    private static let lock = NSLock()
    private static var available: [String: Bool] = [:]

    private static func isAvailable(_ name: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if let known = available[name] { return known }
        let found = UIFont(name: name, size: 12) != nil
        available[name] = found
        return found
    }

    static func font(_ role: DeckTypeRole, weight: Int? = nil) -> Font {
        let spec = role.spec
        let w = weight ?? spec.weight
        let name = DeckFontFiles.name(mono: spec.mono, weight: w)
        if isAvailable(name) {
            return .custom(name, size: spec.size, relativeTo: textStyle(spec.style))
        }
        return .system(textStyle(spec.style), design: spec.mono ? .monospaced : .default, weight: systemWeight(w))
    }

    static func textStyle(_ style: DeckTextStyle) -> Font.TextStyle {
        switch style {
        case .largeTitle: return .largeTitle
        case .title: return .title
        case .title2: return .title2
        case .title3: return .title3
        case .headline: return .headline
        case .body: return .body
        case .callout: return .callout
        case .subheadline: return .subheadline
        case .footnote: return .footnote
        }
    }

    static func systemWeight(_ weight: Int) -> Font.Weight {
        switch weight {
        case ..<450: return .regular
        case ..<550: return .medium
        case ..<650: return .semibold
        default: return .bold
        }
    }
}

extension View {
    /// The one way native text picks a size: a role from the scale, optionally another weight (400 to 700).
    func deckFont(_ role: DeckTypeRole, weight: Int? = nil) -> some View {
        font(DeckFont.font(role, weight: weight))
    }
}

/// Named text styles for the first-run, token, offline and demo screens, all on the shared scale.
enum DeckType {
    /// One weight for every SF Symbol on the native screens.
    static let iconWeight: Font.Weight = .regular

    static var eyebrow: Font { DeckFont.font(.micro, weight: 600) }
    static var title: Font { DeckFont.font(.title) }
    static var body: Font { DeckFont.font(.body) }
    static var caption: Font { DeckFont.font(.meta) }
    static var captionStrong: Font { DeckFont.font(.meta, weight: 600) }
    static var mono: Font { DeckFont.font(.figureRow, weight: 400) }
    static var monoSmall: Font { DeckFont.font(.data) }
    static let heroIcon = Font.system(.largeTitle, weight: iconWeight)
    static let inlineIcon = Font.system(.footnote, weight: iconWeight)
}

extension View {
    /// Small label above a title: sentence case, no tracking.
    func deckEyebrow() -> some View {
        font(DeckType.eyebrow).foregroundStyle(DeckColors.dim)
    }

    /// Screen title.
    func deckTitle() -> some View {
        font(DeckType.title).foregroundStyle(DeckColors.fg).multilineTextAlignment(.center)
    }

    /// Supporting copy under a title. Wraps instead of truncating at large type sizes.
    func deckBody() -> some View {
        font(DeckType.body).foregroundStyle(DeckColors.dim)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// An SF Symbol at the shared weight. `hero` is the large mark above a screen title.
struct DeckIcon: View {
    let name: String
    var hero = false

    var body: some View {
        Image(systemName: name)
            .font(hero ? DeckType.heroIcon : DeckType.inlineIcon)
            .accessibilityHidden(true)
    }
}
