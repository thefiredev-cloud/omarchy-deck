import SwiftUI

/// Pro, presented the same way on first run and in the Decks sheet. It is always on screen, never an error:
/// while StoreKit loads it shows a placeholder price, and Restore is reachable in every state until Pro is on.
struct ProCard: View {
    @EnvironmentObject var deck: DeckModel
    @EnvironmentObject var pro: ProEntitlement
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                // The app's own deck glyph with a plus: Pro adds decks. Not the generic AI sparkle.
                Image(systemName: pro.isPro ? "checkmark.circle.fill" : "rectangle.stack.badge.plus")
                    .foregroundStyle(DeckColors.signal)
                    .accessibilityHidden(true)
                Text(pro.isPro ? "Pro is on" : "Omarchy Deck Pro")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(DeckColors.fg)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("pro.title")
            }
            Text(summary)
                .font(.footnote)
                .foregroundStyle(DeckColors.dim)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("pro.summary")
            if !pro.isPro && deck.connections.count > 1 {
                Text("Your other decks are kept safe. Restore Pro to use them.")
                    .font(.footnote)
                    .foregroundStyle(DeckColors.dim)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !pro.isPro {
                let layout = typeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                    : AnyLayout(HStackLayout(spacing: 12))
                layout {
                    purchase
                    Button("Restore purchases") { Task { await pro.restore() } }
                        .buttonStyle(DeckQuietButtonStyle())
                        .disabled(pro.isWorking)
                        .accessibilityIdentifier("pro.restore")
                }
            }
            if let message = pro.message {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(DeckColors.dim)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("pro.status")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // Idempotent. The first-run screen needs the price, so StoreKit starts when the card appears.
        .task { pro.start() }
    }

    private var summary: String {
        pro.isPro
            ? "Switch between your saved decks any time."
            : "Free includes one deck. Pro adds more decks and quick switching, in one purchase."
    }

    @ViewBuilder
    private var purchase: some View {
        if let product = pro.product {
            Button("Unlock Pro · \(product.displayPrice)") { Task { await pro.buy() } }
                .buttonStyle(DeckSecondaryButtonStyle())
                .disabled(pro.isWorking)
                .accessibilityIdentifier("pro.buy")
        } else if pro.catalog == .unavailable {
            VStack(alignment: .leading, spacing: 2) {
                Text("The price shows up once the App Store answers.")
                    .font(DeckType.caption)
                    .foregroundStyle(DeckColors.faint)
                Button("Check again") { Task { await pro.loadProduct() } }
                    .buttonStyle(DeckQuietButtonStyle())
                    .accessibilityIdentifier("pro.refresh")
            }
        } else {
            Text("Unlock Pro · Price loading")
                .font(.body.weight(.semibold))
                .redacted(reason: .placeholder)
                .frame(maxWidth: .infinity, minHeight: 50)
                .background(DeckColors.panel, in: .rect(cornerRadius: DeckStyle.controlRadius))
                .overlay(RoundedRectangle(cornerRadius: DeckStyle.controlRadius).strokeBorder(DeckColors.line, lineWidth: 1))
                .accessibilityElement()
                .accessibilityLabel("Pro price loading")
                .accessibilityIdentifier("pro.loading")
        }
    }
}
