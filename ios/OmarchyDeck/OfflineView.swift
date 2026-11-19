import SwiftUI

struct OfflineView: View {
    /// The banner copy lives here once: the Text views render these strings and VoiceOver announces the same ones.
    enum Banner {
        static let title = "Deck is back"
        static let action = OfflinePrimaryAction.reconnect.title
        static let subtitle = "Your server answered. Tap \(action) to open it."
        static let announcement = "\(title). \(subtitle)"
    }

    @EnvironmentObject var deck: DeckModel
    let reason: String
    @Environment(\.verticalSizeClass) private var verticalSize
    @State private var confirmingSignOut = false
    @State private var speech = OfflineSpeechGate()
    @AccessibilityFocusState private var focus: OfflineFocusTarget?

    private var cause: OfflineCause { OfflineCause(reason: reason) }

    var body: some View {
        DeckInsetReader { inset in
            // The cause and next steps scroll and wrap at any text size. The one filled action never scrolls away:
            // under the text on a tall screen, beside it on a short one.
            switch OfflineActionPlacement(isCompactHeight: verticalSize == .compact) {
            case .bottomBar:
                VStack(spacing: 0) {
                    recovery(inset, bottom: DeckSpace.m, trailing: max(inset.trailing, DeckSpace.l))
                    primaryAction
                        .padding(.top, DeckSpace.s + DeckSpace.xs)
                        .padding(.bottom, inset.bottom)
                        .padding(.leading, max(inset.leading, DeckSpace.l))
                        .padding(.trailing, max(inset.trailing, DeckSpace.l))
                        .frame(maxWidth: DeckSpace.column)
                        .frame(maxWidth: .infinity)
                        .background(DeckColors.bg)
                        .overlay(alignment: .top) {
                            Rectangle().fill(DeckColors.line).frame(height: 1).accessibilityHidden(true)
                        }
                }
            case .trailingColumn:
                HStack(spacing: 0) {
                    recovery(inset, bottom: inset.bottom, trailing: DeckSpace.m)
                    primaryAction
                        .fixedSize(horizontal: true, vertical: false)
                        .padding(.leading, DeckSpace.s)
                        .padding(.trailing, max(inset.trailing, DeckSpace.l))
                        .padding(.vertical, max(inset.top, inset.bottom))
                }
            }
        }
        .background(DeckColors.bg)
        .alert("Sign in again?", isPresented: $confirmingSignOut) {
            Button("Sign in again", role: .destructive) { Task { await deck.signOut() } }
                .accessibilityIdentifier("offline.signout.confirm")
            Button("Keep waiting", role: .cancel) {}
        } message: {
            Text("This signs this device out of your deck. You'll need your deck token to open it again.")
        }
        // The screen replaces Loading, so VoiceOver focus would be lost with it. Put focus on the cause: it reads there
        // once. A banner that appears later has no focus change, so it is announced. Silent when the state drops back.
        .onAppear {
            let target = speech.focusOnAppear(reconnectReady: deck.reconnectReady)
            Task { @MainActor in focus = target }
        }
        .onChange(of: deck.reconnectReady) { _, ready in
            if speech.shouldAnnounceBanner(reconnectReady: ready) {
                UIAccessibility.post(notification: .announcement, argument: Banner.announcement)
            }
        }
        .sensoryFeedback(trigger: deck.reconnectReady) { _, ready in ready ? .success : nil }
    }

    /// Reconnect only while the model says the deck answered; Retry otherwise. Both ask the model to load again.
    private var primaryAction: some View {
        let action = OfflinePrimaryAction(reconnectReady: deck.reconnectReady)
        return Button(action.title) { deck.retry() }
            .buttonStyle(DeckPrimaryButtonStyle())
            .keyboardShortcut(.defaultAction)
            .accessibilityIdentifier(action.identifier)
    }

    private func recovery(_ inset: EdgeInsets, bottom: CGFloat, trailing: CGFloat) -> some View {
        ScrollView {
            VStack(spacing: DeckSpace.m) {
                if verticalSize != .compact {
                    DeckIcon(name: cause.symbol, hero: true)
                        .foregroundStyle(DeckColors.warn)
                        .padding(.top, DeckSpace.l)
                }
                Text(cause.title)
                    .deckTitle()
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityFocused($focus, equals: .cause)
                    .accessibilityIdentifier("offline.title")
                // Several decks can be saved, so the screen names the one that did not answer.
                if let origin = deck.selectedOrigin {
                    Text(origin.absoluteString)
                        .font(DeckType.caption)
                        .foregroundStyle(DeckColors.dim)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("offline.server")
                }
                if deck.reconnectReady {
                    VStack(alignment: .leading, spacing: DeckSpace.s) {
                        Text(Banner.title)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(DeckColors.fg)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityFocused($focus, equals: .banner)
                            .accessibilityIdentifier("reconnect.banner")
                        Text(Banner.subtitle)
                            .font(DeckType.caption)
                            .foregroundStyle(DeckColors.dim)
                            .accessibilityIdentifier("reconnect.detail")
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(DeckSpace.s + DeckSpace.xs)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(DeckColors.panel, in: .rect(cornerRadius: DeckStyle.cardRadius))
                    .overlay(RoundedRectangle(cornerRadius: DeckStyle.cardRadius).strokeBorder(DeckColors.signal, lineWidth: 1))
                }
                // One instruction per state: the banner above already says Reconnect, so the cause text waits.
                if !deck.reconnectReady {
                    Text(cause.guidance)
                        .deckBody()
                        .accessibilityIdentifier("offline.notice")
                }
                // The pinned action is Reconnect while the banner is up; Retry stays one tap away as the quiet second choice.
                if deck.reconnectReady {
                    Button(OfflinePrimaryAction.retry.title) { deck.retry() }
                        .buttonStyle(DeckSecondaryButtonStyle())
                        .accessibilityIdentifier(OfflinePrimaryAction.retry.identifier)
                }
                // The raw sentence is for support, not for the first look. It wraps in full at every text size.
                DisclosureGroup("Details") {
                    Text(reason)
                        .font(DeckType.monoSmall)
                        .foregroundStyle(DeckColors.dim)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, DeckSpace.s)
                        .textSelection(.enabled)
                        .accessibilityIdentifier("offline.reason")
                }
                .font(DeckType.captionStrong)
                .foregroundStyle(DeckColors.dim)
                .tint(DeckColors.dim)
                Button("Sign in again") { confirmingSignOut = true }
                    .buttonStyle(DeckQuietButtonStyle())
                    .accessibilityIdentifier("offline.signout")
            }
            .padding(.top, inset.top)
            .padding(.bottom, bottom)
            .padding(.leading, max(inset.leading, DeckSpace.l))
            .padding(.trailing, trailing)
            .frame(maxWidth: DeckSpace.column)
            .frame(maxWidth: .infinity)
        }
        .accessibilityIdentifier("screen.offline")
    }
}
