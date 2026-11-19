/// Light or Dark for the sections screen, kept across launches. Dark is the default, like the deck and its shell. There
/// is no "Match system": the shell pins the window scene dark (`preferredColorScheme(.dark)` at the root, matching the
/// web deck), so the app cannot read the device setting truthfully, and a switch that guesses would be worse than none.
/// Foundation only, so the Linux harness can test it. The SwiftUI `ColorScheme` mapping lives in DeckFeedsView.swift.
enum FeedAppearance: String, CaseIterable, Identifiable {
    case dark, light
    var id: String { rawValue }
    var title: String { self == .light ? "Light" : "Dark" }
}
