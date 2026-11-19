import SwiftUI

/// The first thing a new customer, or an App Review tester, sees: what the app is, a demo that needs nothing,
/// then the way to connect a real deck. Two columns in landscape and on iPad; one column in portrait and at
/// accessibility text sizes. Only the right column scrolls.
struct FirstRunView: View {
    @EnvironmentObject var deck: DeckModel
    @Environment(\.verticalSizeClass) private var verticalSize
    @Environment(\.horizontalSizeClass) private var horizontalSize
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @FocusState private var addressFocused: Bool
    @State private var demoTick = 0
    /// The app glyph tile grows with the title so it does not shrink into a dot at accessibility sizes.
    @ScaledMetric(relativeTo: .largeTitle) private var badgeSize: CGFloat = 52

    private static let connectCard = "firstrun.connect"

    private var twoColumns: Bool {
        DeckLayout.firstRunUsesTwoColumns(regularWidth: horizontalSize == .regular,
                                          compactHeight: verticalSize == .compact,
                                          accessibilityText: typeSize.isAccessibilitySize)
    }

    var body: some View {
        DeckInsetReader { inset in
            ScrollViewReader { scroller in
                Group {
                    if twoColumns {
                        HStack(alignment: .top, spacing: DeckSpace.xl) {
                            intro(compact: verticalSize == .compact)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            ScrollView {
                                connect
                                    .padding(.vertical, 1)
                                    .dismissesKeyboardOnBackgroundTap(action: dismissKeyboard)
                            }
                            .scrollIndicators(.hidden)
                            .scrollDismissesKeyboard(.interactively)
                            .frame(maxWidth: 420)
                        }
                        .padding(.top, inset.top)
                        .padding(.bottom, inset.bottom)
                        .padding(.leading, max(inset.leading, DeckSpace.l))
                        .padding(.trailing, max(inset.trailing, DeckSpace.l))
                        .frame(maxWidth: 960)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 28) {
                                intro(compact: false)
                                connect
                            }
                            .padding(.top, inset.top + DeckSpace.m)
                            .padding(.bottom, inset.bottom)
                            .padding(.leading, max(inset.leading, DeckSpace.l))
                            .padding(.trailing, max(inset.trailing, DeckSpace.l))
                            .frame(maxWidth: DeckSpace.column)
                            .frame(maxWidth: .infinity)
                            .dismissesKeyboardOnBackgroundTap(action: dismissKeyboard)
                        }
                        .scrollDismissesKeyboard(.interactively)
                    }
                }
                // The keyboard covers the lower half of a phone. Bring the whole card up, button and note included.
                .onChange(of: addressFocused) { _, focused in
                    guard focused else { return }
                    withAnimation(reduceMotion ? nil : .smooth(duration: 0.3)) {
                        scroller.scrollTo(Self.connectCard, anchor: .top)
                    }
                }
            }
        }
        .dismissesKeyboardOnBackgroundTap(action: dismissKeyboard)
        .deckKeyboardDoneButton(action: dismissKeyboard)
        .background {
            KeyboardShortcutButton(title: "Add Deck", key: "n") { addressFocused = true }
        }
        .background(DeckColors.bg)
        .sensoryFeedback(.selection, trigger: demoTick)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screen.firstrun")
    }

    private func dismissKeyboard() { addressFocused = false }

    /// Brand, one line of what the app is, the demo, and the legal links.
    private func intro(compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: compact ? 12 : DeckSpace.m) {
            HStack(spacing: 14) {
                Image(systemName: "rectangle.grid.2x2")
                    .font(.title2.weight(.regular))
                    .foregroundStyle(DeckColors.signal)
                    .frame(width: badgeSize, height: badgeSize)
                    .background(DeckColors.panel, in: .rect(cornerRadius: DeckStyle.controlRadius))
                    .overlay(RoundedRectangle(cornerRadius: DeckStyle.controlRadius).strokeBorder(DeckColors.line, lineWidth: 1))
                    .accessibilityHidden(true)
                Text("Omarchy Deck")
                    .font(.largeTitle.weight(.semibold))
                    .foregroundStyle(DeckColors.fg)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("firstrun.title")
            }
            Text("Open the dashboard your own computer serves, on your \(UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"). Depending on your setup it can show things like your day, cameras, prices you watch and saved links.")
                .font(.body)
                .foregroundStyle(DeckColors.dim)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("firstrun.tagline")
            Text("That dashboard is called a deck. It comes from a Deck server that runs on your own computer. This app has no server of its own.")
                .font(DeckType.caption)
                .foregroundStyle(DeckColors.dim)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("firstrun.needs")
            VStack(alignment: .leading, spacing: DeckSpace.s) {
                Button {
                    demoTick += 1
                    addressFocused = false
                    deck.beginDemo()
                } label: {
                    Label("Try the demo", systemImage: "play.fill")
                }
                .buttonStyle(DeckPrimaryButtonStyle())
                .accessibilityIdentifier("demo.try")
                Text("Look around with sample data on this device. No server or sign-in needed.")
                    .font(DeckType.caption)
                    .foregroundStyle(DeckColors.faint)
                    .fixedSize(horizontal: false, vertical: true)
            }
            DeckLegalLinks()
                .padding(.top, DeckSpace.xs)
            Text(AppCopyright.notice)
                .font(DeckType.caption)
                .foregroundStyle(DeckColors.faint)
                .accessibilityIdentifier("deck.about.copyright")
        }
    }

    /// The way to connect a real deck, then Pro.
    private var connect: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Connect your deck")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(DeckColors.fg)
                    .accessibilityAddTraits(.isHeader)
                AddressEntry(focus: $addressFocused)
            }
            .padding(DeckSpace.m)
            .background(DeckColors.panel, in: .rect(cornerRadius: DeckStyle.cardRadius))
            .overlay(RoundedRectangle(cornerRadius: DeckStyle.cardRadius).strokeBorder(DeckColors.line, lineWidth: 1))
            .id(Self.connectCard)
            ProCard()
                .padding(.horizontal, DeckSpace.xs)
        }
    }
}
