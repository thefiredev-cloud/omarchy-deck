import Foundation

/// Layout choices that follow the window's size classes. Foundation only, so the Linux harness checks them for
/// every window an iPad or iPhone can give the app, including Split View and Slide Over.
///
/// iPad full screen is regular width and height. Split View at one half or one third, and Slide Over, are compact
/// width with regular height. iPhone portrait is compact width; large iPhones in landscape are regular width with
/// compact height.
enum DeckLayout {
    /// The demo shows a sidebar beside its pages only when the window has room for both: regular width, and not a
    /// landscape phone. Everything else keeps the tab bar.
    static func demoUsesSidebar(regularWidth: Bool, compactHeight: Bool) -> Bool {
        regularWidth && !compactHeight
    }

    /// The demo's pages sit their cards in two columns only when the detail column is wide enough that each
    /// column still reads: a 13 inch iPad in landscape, or a wide Split View. A portrait iPad detail column
    /// (about 820 points) keeps one column, so the cards fill the width instead of leaving an L-shaped void.
    static let demoTwoColumnWidth: CGFloat = 900

    static func demoUsesTwoColumns(detailWidth: CGFloat) -> Bool {
        detailWidth >= demoTwoColumnWidth
    }

    /// First run puts the intro beside the connect card on wide or short windows, and stacks one column at
    /// accessibility text sizes where two columns would leave each too narrow to read.
    static func firstRunUsesTwoColumns(regularWidth: Bool, compactHeight: Bool, accessibilityText: Bool) -> Bool {
        !accessibilityText && (regularWidth || compactHeight)
    }

    /// The Feeds sheet puts its sections in a sidebar when the window is regular width and wide enough for the
    /// sidebar plus a two-column page (every iPad full screen, both orientations, and wide Split View). Phones, Slide
    /// Over and narrow Split View keep the tab strip.
    static let feedsSidebarWidth: CGFloat = 220
    static let feedsSidebarMinWindow: CGFloat = 760

    static func feedsUsesSidebar(regularWidth: Bool, windowWidth: CGFloat) -> Bool {
        regularWidth && windowWidth >= feedsSidebarMinWindow
    }

    /// Two columns once each column keeps about 280 points; never wider than `feedsContentMax`, so lines stay readable
    /// on a 13 inch iPad in landscape.
    static let feedsTwoColumnWidth: CGFloat = 560
    static let feedsContentMax: CGFloat = 1180

    static func feedsColumns(contentWidth: CGFloat) -> Int {
        contentWidth >= feedsTwoColumnWidth ? 2 : 1
    }

    /// A grid of figure or title tiles keeps its column count until the text reaches an accessibility size, where
    /// each cell would be too narrow to hold a word and the tile stacks in one column.
    static func tileColumns(wanted: Int, accessibilityText: Bool) -> Int {
        accessibilityText ? 1 : max(1, wanted)
    }

    /// Only a keyboard covering the window's bottom edge needs a scrolling bottom inset.
    /// Floating or other-window keyboards must not lift the entire token form above their top edge.
    /// A docked keyboard's reported frame can stop short of the window bottom. That still reserves
    /// the covered band plus one action row, so Done does not sit on the help text.
    static let keyboardAccessoryReserve: CGFloat = 48

    static func keyboardBottomClearance(window: CGRect, keyboard: CGRect, safeAreaBottom: CGFloat) -> CGFloat {
        let covered = window.intersection(keyboard)
        guard !covered.isNull, !covered.isEmpty, covered.width >= window.width - 1 else { return 0 }
        if covered.maxY >= window.maxY {
            return max(0, covered.height - safeAreaBottom)
        }
        let gap = window.maxY - covered.maxY
        guard gap <= safeAreaBottom + keyboardAccessoryReserve, covered.minY > window.minY else { return 0 }
        return max(0, window.maxY - covered.minY + keyboardAccessoryReserve - safeAreaBottom)
    }
}
